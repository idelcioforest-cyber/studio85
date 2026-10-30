import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { CardPaymentInput, RefundPaymentInput } from '@autowash/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSensitiveData } from '../../common/utils/crypto.util';
import { addDays, toZonedDateString, zonedTimeToUtc } from '../../common/utils/timezone.util';
import { PagarmeCharge, PagarmeClient, PagarmeError, PagarmeOrder } from './pagarme.client';
import { pagarmeConfig } from './pagarme.config';
import { PagarmeRecipientService } from './pagarme-recipient.service';
import { buildSplit, platformShareCents } from './split-builder';

const PIX_EXPIRES_IN_SECONDS = 1800;
const SYNC_MIN_INTERVAL_MS = 5000;
const TIME_ZONE = 'America/Sao_Paulo';
// Atendimentos que ainda podem ser pagos online
const PAYABLE_STATUSES = ['CONFIRMED', 'CHECK_IN', 'IN_PROGRESS', 'READY'];
// Status em que o dinheiro entrou (mesmo que depois estornado ou contestado)
const SETTLED: PaymentStatus[] = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'];

type PaymentWithAppointment = Prisma.PaymentGetPayload<{ include: { order: { include: { appointment: true } } } }>;

/**
 * Pagamento online (Pix e cartão) com split no Pagar.me. Opcional: quem não paga online paga na loja.
 * O status sempre vem da API (resposta da criação, consulta ou webhook reconsultado), nunca do navegador.
 */
@Injectable()
export class PagarmePaymentsService {
  private readonly logger = new Logger(PagarmePaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private client: PagarmeClient,
    private recipients: PagarmeRecipientService,
  ) {}

  /** O site só mostra "Pagar agora" com Pagar.me configurado e o recebedor do lava-jato liberado */
  async onlineConfig() {
    const enabled = await this.recipients.isActive();
    return {
      enabled,
      publicKey: enabled ? pagarmeConfig.publicKey : null,
      maxInstallments: pagarmeConfig.maxInstallments,
    };
  }

  async createPix(userId: string, appointmentId: string) {
    const { appointment, user, order } = await this.loadPayable(userId, appointmentId);

    const reusable = await this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        provider: 'PAGARME',
        method: 'PIX',
        status: 'PENDING',
        expiresAt: { gt: new Date(Date.now() + 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable) return this.view(reusable);

    return this.createOnline(appointment, user, order, 'PIX', (split) => ({
      payment_method: 'pix',
      pix: { expires_in: PIX_EXPIRES_IN_SECONDS },
      split,
    }));
  }

  async createCard(userId: string, appointmentId: string, input: CardPaymentInput) {
    const { appointment, user, order } = await this.loadPayable(userId, appointmentId);
    const installments = Math.min(input.installments, pagarmeConfig.maxInstallments);
    return this.createOnline(appointment, user, order, 'CREDIT_CARD', (split) => ({
      payment_method: 'credit_card',
      credit_card: { installments, statement_descriptor: 'STUDIO85', card_token: input.cardToken },
      split,
    }));
  }

  /** Consulta do cliente (polling do Pix): reconsulta a API no máximo a cada 5 s enquanto estiver pendente */
  async getForClient(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, provider: 'PAGARME', order: { appointment: { userId } } },
    });
    if (!payment) throw new NotFoundException('Pagamento não encontrado.');

    if (
      payment.status === 'PENDING' &&
      payment.externalOrderId &&
      (!payment.lastSyncedAt || Date.now() - payment.lastSyncedAt.getTime() > SYNC_MIN_INTERVAL_MS)
    ) {
      try {
        const updated = await this.applyOrder(await this.client.getOrder(payment.externalOrderId));
        if (updated) return this.view(updated);
      } catch (error) {
        this.logger.warn(`Consulta do pedido ${payment.externalOrderId} falhou: ${(error as Error).message}`);
      }
    }
    return this.view(payment);
  }

  /** Aplica o pedido reconsultado na API ao pagamento local (criação, consulta e webhook) */
  async applyOrder(order: PagarmeOrder): Promise<Payment | null> {
    const charge = order.charges?.[0];
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: 'PAGARME',
        OR: [{ externalOrderId: order.id }, ...(order.metadata?.payment_id ? [{ id: order.metadata.payment_id }] : [])],
      },
    });
    if (!payment || !charge) return payment;
    return this.applyCharge({ ...charge, order: { id: order.id, metadata: order.metadata } }, payment.id);
  }

  /** Aplica a cobrança reconsultada: status, estornos e lançamentos no caixa, numa transação com trava */
  async applyCharge(charge: PagarmeCharge, knownPaymentId?: string): Promise<Payment | null> {
    const located =
      knownPaymentId ??
      (
        await this.prisma.payment.findFirst({
          where: {
            provider: 'PAGARME',
            OR: [{ providerTransactionId: charge.id }, ...(charge.order?.id ? [{ externalOrderId: charge.order.id }] : [])],
          },
          select: { id: true },
        })
      )?.id;
    if (!located) return null;

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${located} FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: located }, include: { order: { include: { appointment: true } } } });
        const next = this.mapCharge(charge, payment);
        const tx0 = charge.last_transaction;

        const becamePaid = !SETTLED.includes(payment.status) && SETTLED.includes(next.status);
        const refundDelta = next.refundedCents - payment.refundedCents;
        const label = `${payment.order.appointment?.readableCode ?? 'Online'} · Pagar.me ${payment.method === 'PIX' ? 'Pix' : 'cartão'}`;

        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: next.status,
            providerTransactionId: charge.id,
            refundedCents: next.refundedCents,
            paidAt: becamePaid ? (charge.paid_at ? new Date(charge.paid_at) : new Date()) : payment.paidAt,
            failureReason: next.failureReason,
            cardBrand: tx0?.card?.brand ?? payment.cardBrand,
            cardLast4: tx0?.card?.last_four_digits ?? payment.cardLast4,
            lastSyncedAt: new Date(),
            rawResponseJson: JSON.stringify(charge).slice(0, 60_000),
          },
        });

        if (becamePaid) {
          await tx.financialEntry.create({
            data: { paymentId: payment.id, entryType: 'SALE', amountCents: payment.amountCents, description: label.slice(0, 255) },
          });
        }
        if (refundDelta > 0) {
          await tx.financialEntry.create({
            data: { paymentId: payment.id, entryType: 'REFUND', amountCents: -refundDelta, description: `Estorno · ${label}`.slice(0, 255) },
          });
        }
        if (becamePaid || refundDelta > 0) {
          const orderStatus =
            next.status === 'REFUNDED' ? 'REFUNDED' : next.status === 'PARTIALLY_REFUNDED' ? 'PARTIALLY_REFUNDED' : 'PAID';
          await tx.order.update({ where: { id: payment.orderId }, data: { status: orderStatus } });
        }
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  /** Estorno total ou parcial pelo admin. O Pagar.me desfaz o split proporcionalmente. */
  async refund(paymentId: string, input: RefundPaymentInput, adminUserId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.provider !== 'PAGARME') throw new NotFoundException('Pagamento online não encontrado.');
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status) || !payment.providerTransactionId) {
      throw new BadRequestException('Só dá para estornar pagamentos online já pagos.');
    }
    const remaining = payment.amountCents - payment.refundedCents;
    const amount = input.amountCents ?? remaining;
    if (amount > remaining) throw new BadRequestException(`O máximo para estornar é ${formatBRL(remaining)}.`);

    let charge: PagarmeCharge;
    try {
      charge = await this.client.cancelCharge(payment.providerTransactionId, amount === remaining && !input.amountCents ? undefined : amount);
    } catch (error) {
      throw new BadRequestException(error instanceof PagarmeError ? `Pagar.me recusou o estorno: ${error.message}` : 'Falha ao estornar.');
    }

    await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: amount,
        reason: (input.reason || 'Estorno pelo admin').slice(0, 255),
        providerRefundId: charge.id,
        status: 'PROCESSED',
        approvedById: adminUserId,
      },
    });
    const updated = await this.applyCharge(charge, payment.id);
    return { success: true, message: `Estorno de ${formatBRL(amount)} enviado ao Pagar.me.`, payment: this.adminRow(updated!) };
  }

  async list(from?: string, to?: string) {
    const range = this.range(from, to);
    const payments = await this.prisma.payment.findMany({
      where: { provider: 'PAGARME', createdAt: { gte: range.start, lt: range.end } },
      include: { order: { include: { appointment: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return payments.map((p) => this.adminRow(p));
  }

  async summary(from?: string, to?: string) {
    const range = this.range(from, to);
    const payments = await this.prisma.payment.findMany({
      where: { provider: 'PAGARME', createdAt: { gte: range.start, lt: range.end } },
      select: { status: true, amountCents: true, refundedCents: true, platformFeePercent: true },
    });
    let soldCents = 0;
    let refundedCents = 0;
    let platformCents = 0;
    const pending = { count: 0, cents: 0 };
    const chargebacks = { count: 0, cents: 0 };
    for (const p of payments) {
      if (p.status === 'PENDING') {
        pending.count++;
        pending.cents += p.amountCents;
      }
      if (!SETTLED.includes(p.status)) continue;
      soldCents += p.amountCents;
      refundedCents += p.refundedCents;
      // Estorno desfaz o split na proporção: a comissão incide só sobre o que ficou
      platformCents += platformShareCents(p.amountCents - p.refundedCents, p.platformFeePercent ?? 0);
      if (p.status === 'DISPUTED') {
        chargebacks.count++;
        chargebacks.cents += p.amountCents;
      }
    }
    const netCents = soldCents - refundedCents;
    return {
      from: range.from,
      to: range.to,
      soldCents,
      refundedCents,
      netCents,
      platformCents,
      washerCents: netCents - platformCents,
      pending,
      chargebacks,
    };
  }

  async view(p: Payment) {
    return {
      id: p.id,
      status: p.status,
      method: p.method,
      amountCents: p.amountCents,
      refundedCents: p.refundedCents,
      paidAt: p.paidAt,
      failureReason: p.failureReason,
      card: p.cardLast4 ? { brand: p.cardBrand, last4: p.cardLast4 } : null,
      pix:
        p.method === 'PIX' && p.status === 'PENDING' && p.pixQrCode
          ? {
              qrCode: p.pixQrCode,
              qrCodeImage: await QRCode.toDataURL(p.pixQrCode, { margin: 1, width: 300, errorCorrectionLevel: 'M' }),
              expiresAt: p.expiresAt,
            }
          : null,
    };
  }

  private adminRow(p: PaymentWithAppointment | Payment) {
    const appointment = 'order' in p ? (p as PaymentWithAppointment).order.appointment : null;
    const net = p.amountCents - p.refundedCents;
    const fee = p.platformFeePercent ?? 0;
    return {
      id: p.id,
      status: p.status,
      method: p.method,
      amountCents: p.amountCents,
      refundedCents: p.refundedCents,
      platformFeePercent: fee,
      platformCents: SETTLED.includes(p.status) ? platformShareCents(net, fee) : 0,
      washerCents: SETTLED.includes(p.status) ? net - platformShareCents(net, fee) : 0,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      failureReason: p.failureReason,
      card: p.cardLast4 ? { brand: p.cardBrand, last4: p.cardLast4 } : null,
      chargeId: p.providerTransactionId,
      appointment: appointment
        ? {
            code: appointment.readableCode,
            customerName: appointment.customerName,
            vehicleLabel: appointment.vehicleLabel,
            vehiclePlate: appointment.vehiclePlate,
            startsAt: appointment.startsAt,
          }
        : null,
    };
  }

  private async loadPayable(userId: string, appointmentId: string) {
    if (!(await this.recipients.isActive())) {
      throw new ServiceUnavailableException('O pagamento online está indisponível no momento. Você pode pagar na loja.');
    }
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, userId },
      include: { services: true, order: { include: { payments: true } }, user: true },
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');
    if (!PAYABLE_STATUSES.includes(appointment.status)) throw new BadRequestException('Este agendamento não pode mais ser pago.');
    if (appointment.order?.payments.some((p) => ['PAID', 'PARTIALLY_REFUNDED'].includes(p.status))) {
      throw new ConflictException('Este agendamento já está pago.');
    }

    const user = appointment.user!;
    const phone = (user.phone || appointment.customerPhone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (!user.email || !user.cpfEncrypted || phone.length < 10) {
      throw new BadRequestException('Complete seu cadastro (CPF e celular) para pagar online.');
    }

    const order =
      appointment.order ??
      (await this.prisma.order.create({
        data: {
          appointmentId: appointment.id,
          userId,
          subtotalCents: appointment.totalPriceCents - appointment.telebuscaFeeCents,
          telebuscaFeeCents: appointment.telebuscaFeeCents,
          totalCents: appointment.totalPriceCents,
        },
        include: { payments: true },
      }));

    return {
      appointment,
      order,
      user: { name: user.name, email: user.email, cpf: decryptSensitiveData(user.cpfEncrypted), phone },
    };
  }

  private async createOnline(
    appointment: Awaited<ReturnType<PagarmePaymentsService['loadPayable']>>['appointment'],
    user: { name: string; email: string; cpf: string; phone: string },
    order: { id: string },
    method: 'PIX' | 'CREDIT_CARD',
    paymentFor: (split: ReturnType<typeof buildSplit>) => Record<string, unknown>,
  ) {
    const recipient = (await this.recipients.current())!;
    const feePercent = this.recipients.feePercentFor(recipient);
    const split = buildSplit(recipient.pagarmeRecipientId!, pagarmeConfig.platformRecipientId, feePercent);
    const amount = appointment.totalPriceCents;
    const platformCents = platformShareCents(amount, feePercent);

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'PAGARME',
        method,
        amountCents: amount,
        status: 'PENDING',
        platformFeePercent: feePercent,
        platformFeeCents: platformCents,
        recipientCents: amount - platformCents,
      },
    });

    const services = appointment.services.map((s) => s.serviceNameSnapshot).join(' + ');
    const body = {
      code: payment.id,
      customer: {
        name: user.name,
        email: user.email,
        type: 'individual',
        document: user.cpf,
        document_type: 'CPF',
        phones: { mobile_phone: { country_code: '55', area_code: user.phone.slice(0, 2), number: user.phone.slice(2) } },
      },
      items: [{ amount, description: `${services} · ${appointment.vehicleLabel}`.slice(0, 250), quantity: 1, code: appointment.readableCode }],
      metadata: {
        source: pagarmeConfig.sourceTag,
        appointment_id: appointment.id,
        booking_code: appointment.readableCode,
        payment_id: payment.id,
      },
      payments: [paymentFor(split)],
    };

    let remote: PagarmeOrder;
    try {
      remote = await this.client.createOrder(body);
    } catch (error) {
      const message = error instanceof PagarmeError ? error.message : 'Falha ao falar com o Pagar.me.';
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: message.slice(0, 255) } });
      throw new BadRequestException(method === 'PIX' ? 'Não foi possível gerar o Pix agora. Tente de novo.' : `Pagamento não aprovado: ${message}`);
    }

    const charge = remote.charges?.[0];
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        externalOrderId: remote.id,
        providerTransactionId: charge?.id ?? null,
        pixQrCode: charge?.last_transaction?.qr_code ?? null,
        expiresAt: charge?.last_transaction?.expires_at ? new Date(charge.last_transaction.expires_at) : null,
      },
    });
    const updated = (await this.applyOrder(remote)) ?? payment;
    return this.view(updated);
  }

  private mapCharge(charge: PagarmeCharge, payment: Payment): { status: PaymentStatus; refundedCents: number; failureReason: string | null } {
    const refunded = Math.min(charge.canceled_amount ?? 0, payment.amountCents);
    const wasSettled = SETTLED.includes(payment.status) || (charge.paid_amount ?? 0) > 0;
    const refundState = (): PaymentStatus => (refunded >= payment.amountCents ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : 'PAID');
    const tx = charge.last_transaction;
    const reason = tx?.acquirer_message || tx?.gateway_response?.errors?.map((e) => e.message).filter(Boolean).join('; ') || null;

    switch (charge.status) {
      case 'paid':
      case 'overpaid':
      case 'underpaid':
        return { status: refundState(), refundedCents: refunded, failureReason: null };
      case 'chargedback':
        return { status: 'DISPUTED', refundedCents: refunded, failureReason: 'Chargeback (contestação do cliente)' };
      case 'failed':
        return { status: 'FAILED', refundedCents: 0, failureReason: reason || 'Pagamento não aprovado.' };
      case 'canceled':
        if (wasSettled) return { status: refunded > 0 ? refundState() : 'REFUNDED', refundedCents: refunded || payment.amountCents, failureReason: null };
        return { status: payment.method === 'PIX' ? 'EXPIRED' : 'FAILED', refundedCents: 0, failureReason: payment.method === 'PIX' ? 'Pix expirado' : reason };
      default:
        return { status: 'PENDING', refundedCents: refunded, failureReason: null };
    }
  }

  private range(from?: string, to?: string) {
    const today = toZonedDateString(new Date(), TIME_ZONE);
    const start = from || `${today.slice(0, 8)}01`;
    const end = to || today;
    return { from: start, to: end, start: zonedTimeToUtc(start, '00:00', TIME_ZONE), end: zonedTimeToUtc(addDays(end, 1), '00:00', TIME_ZONE) };
  }
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
