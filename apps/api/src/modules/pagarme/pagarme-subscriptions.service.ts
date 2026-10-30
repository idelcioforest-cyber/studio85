import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CustomerSubscription, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PagarmeCharge, PagarmeClient, PagarmeError, PagarmeInvoice, PagarmeSubscription } from './pagarme.client';
import { pagarmeConfig } from './pagarme.config';
import { PagarmePaymentsService } from './pagarme-payments.service';
import { PagarmeRecipientService } from './pagarme-recipient.service';
import { buildSplit, platformShareCents } from './split-builder';

// Ativa: reconfere a cada 6 h; aguardando a 1ª cobrança: a cada rodada; período vencido: a cada 30 min
const SYNC_ACTIVE_MS = 6 * 3600_000;
const SYNC_PENDING_MS = 2 * 60_000;
const SYNC_EXPIRED_MS = 30 * 60_000;
const RECONCILE_BATCH = 10;
const FIRST_CHARGE_REFUSED = 'Cartão recusado na primeira cobrança. Tente outro cartão pelo mesmo link.';

export interface SubscriptionCustomer {
  name: string;
  email: string;
  cpf: string;
  phone: string;
}

const addMonth = (date: Date) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
};

/**
 * Recorrência das assinaturas no Pagar.me: cobrança mensal no cartão com a mesma divisão do avulso.
 * Cada fatura paga vira um pagamento no caixa; o período pago define quais lavagens a assinatura cobre.
 * Como no avulso, o status sempre vem da API (resposta, webhook reconsultado ou conferência periódica).
 */
@Injectable()
export class PagarmeSubscriptionsService {
  private readonly logger = new Logger(PagarmeSubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private client: PagarmeClient,
    private payments: PagarmePaymentsService,
    private recipients: PagarmeRecipientService,
  ) {}

  /** Cria a recorrência com o cartão do cliente (token do navegador) e já confere a 1ª cobrança */
  async start(sub: CustomerSubscription, vehicleLabel: string, customer: SubscriptionCustomer, cardToken: string) {
    if (!(await this.recipients.isActive())) {
      throw new ServiceUnavailableException('O pagamento online está indisponível no momento. Fale com o lava-jato.');
    }
    if (sub.pagarmeSubscriptionId) throw new ConflictException('O cartão já foi enviado. Aguarde a confirmação do pagamento.');

    const washer = await this.recipients.activeWasher();
    // Modo temporário sem recebedor do lava-jato: tudo na conta da plataforma, sem divisão
    const feePercent = washer ? this.recipients.feePercentFor(washer) : 100;
    const rules = washer ? buildSplit(washer.pagarmeRecipientId!, pagarmeConfig.platformRecipientId, feePercent) : null;
    // Na recorrência o Pagar.me só aceita divisão entre 2 recebedores ou mais
    if (rules && rules.length < 2) {
      throw new ServiceUnavailableException('Assinatura indisponível: a comissão da plataforma está zerada.');
    }

    const description = `Assinatura ${sub.planNameSnapshot} · ${vehicleLabel}`.slice(0, 250);
    const body = {
      code: sub.id,
      payment_method: 'credit_card',
      card_token: cardToken,
      customer: {
        name: customer.name.slice(0, 64),
        email: customer.email,
        type: 'individual',
        document: customer.cpf,
        document_type: 'CPF',
        phones: { mobile_phone: { country_code: '55', area_code: customer.phone.slice(0, 2), number: customer.phone.slice(2) } },
      },
      interval: 'month',
      interval_count: 1,
      billing_type: 'prepaid',
      installments: 1,
      currency: 'BRL',
      statement_descriptor: 'STUDIO85',
      items: [
        { description, quantity: 1, pricing_scheme: { scheme_type: 'unit', price: sub.priceCents } },
        // Taxa do cartão, paga pelo cliente
        ...(sub.customerFeeCents > 0
          ? [{ description: 'Taxa do pagamento online', quantity: 1, pricing_scheme: { scheme_type: 'unit', price: sub.customerFeeCents } }]
          : []),
      ],
      ...(rules ? { split: { enabled: true, rules } } : {}),
      metadata: { source: pagarmeConfig.sourceTag, subscription_id: sub.id },
    };

    let remote: PagarmeSubscription;
    try {
      remote = await this.client.createSubscription(body);
    } catch (error) {
      const message = error instanceof PagarmeError ? error.message : 'Falha ao falar com o Pagar.me.';
      await this.prisma.customerSubscription.update({ where: { id: sub.id }, data: { lastError: message.slice(0, 255) } });
      throw new BadRequestException(`Cartão não aceito: ${message}`);
    }

    await this.prisma.customerSubscription.update({
      where: { id: sub.id },
      data: {
        pagarmeSubscriptionId: remote.id,
        platformFeePercent: feePercent,
        cardBrand: remote.card?.brand ?? null,
        cardLast4: remote.card?.last_four_digits ?? null,
        lastError: null,
      },
    });
    return this.sync(sub.id);
  }

  /** Reconsulta a recorrência e as últimas faturas e aplica no banco */
  async sync(id: string) {
    const sub = await this.prisma.customerSubscription.findUnique({ where: { id } });
    if (!sub?.pagarmeSubscriptionId) return sub;
    const remoteId = sub.pagarmeSubscriptionId;
    await this.applyRemote(await this.client.getSubscription(remoteId));
    const invoices = await this.client.listInvoices(remoteId);
    invoices.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
    for (const invoice of invoices) await this.applyInvoice({ ...invoice, subscription: invoice.subscription ?? { id: remoteId } });
    return this.prisma.customerSubscription.findUnique({ where: { id } });
  }

  /** Status e cartão da recorrência reconsultada (webhook subscription.* e conferência) */
  async applyRemote(remote: PagarmeSubscription) {
    const sub = await this.prisma.customerSubscription.findUnique({ where: { pagarmeSubscriptionId: remote.id } });
    if (!sub) return null;
    const data: Prisma.CustomerSubscriptionUpdateInput = {
      lastSyncedAt: new Date(),
      cardBrand: remote.card?.brand ?? sub.cardBrand,
      cardLast4: remote.card?.last_four_digits ?? sub.cardLast4,
    };
    if (remote.status === 'canceled' && sub.status !== 'CANCELED') {
      Object.assign(data, { status: 'CANCELED', canceledAt: new Date(), cancelReason: sub.cancelReason ?? 'Cancelada no Pagar.me', setupTokenHash: null });
    }
    if (remote.status === 'failed' && sub.status === 'PENDING_CARD') {
      Object.assign(data, { pagarmeSubscriptionId: null, cardBrand: null, cardLast4: null, lastError: FIRST_CHARGE_REFUSED });
    }
    return this.prisma.customerSubscription.update({ where: { id: sub.id }, data });
  }

  /** Fatura reconsultada: paga entra no caixa e libera o período; recusada na 1ª vez reabre o link */
  async applyInvoice(invoice: PagarmeInvoice) {
    const remoteId = invoice.subscription?.id;
    if (!remoteId) return null;
    const sub = await this.prisma.customerSubscription.findUnique({ where: { pagarmeSubscriptionId: remoteId } });
    if (!sub) return null;

    if (invoice.status === 'paid') {
      await this.recordPaidInvoice(sub, invoice);
      const start = invoice.cycle?.start_at ? new Date(invoice.cycle.start_at) : new Date(invoice.charge?.paid_at ?? Date.now());
      const end = invoice.cycle?.end_at ? new Date(invoice.cycle.end_at) : addMonth(start);
      const advances = !sub.currentPeriodEnd || end > sub.currentPeriodEnd;
      return this.prisma.customerSubscription.update({
        where: { id: sub.id },
        data: {
          ...(sub.status === 'PENDING_CARD' ? { status: 'ACTIVE' } : {}),
          ...(advances ? { currentPeriodStart: start, currentPeriodEnd: end } : {}),
          lastError: null,
        },
      });
    }

    if (invoice.status === 'failed') {
      if (sub.status === 'PENDING_CARD') {
        // 1ª cobrança recusada: encerra essa recorrência para o cliente tentar outro cartão pelo mesmo link
        await this.client.cancelSubscription(remoteId).catch((error) => this.logger.warn(`Cancelar ${remoteId}: ${(error as Error).message}`));
        return this.prisma.customerSubscription.update({
          where: { id: sub.id },
          data: { pagarmeSubscriptionId: null, cardBrand: null, cardLast4: null, lastError: FIRST_CHARGE_REFUSED },
        });
      }
      const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date());
      return this.prisma.customerSubscription.update({
        where: { id: sub.id },
        data: { lastError: `Cobrança recusada em ${day}. O Pagar.me tenta de novo nos próximos dias.` },
      });
    }
    return sub;
  }

  /** Cancela no Pagar.me (sem novas cobranças) e no sistema. As lavagens já agendadas continuam cobertas. */
  async cancel(sub: CustomerSubscription, reason: string | null) {
    if (sub.status === 'CANCELED') return sub;
    if (sub.pagarmeSubscriptionId) {
      try {
        await this.client.cancelSubscription(sub.pagarmeSubscriptionId);
      } catch (error) {
        const remote = await this.client.getSubscription(sub.pagarmeSubscriptionId).catch(() => null);
        if (remote?.status !== 'canceled') {
          throw new BadRequestException(`O Pagar.me não cancelou: ${error instanceof PagarmeError ? error.message : 'tente de novo.'}`);
        }
      }
    }
    return this.prisma.customerSubscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: reason, setupTokenHash: null, setupTokenExpiresAt: null },
    });
  }

  /** Rede de segurança dos webhooks: confere as recorrências que podem ter mudado */
  async reconcile(): Promise<number> {
    if (!pagarmeConfig.apiReady) return 0;
    const now = Date.now();
    const due = await this.prisma.customerSubscription.findMany({
      where: {
        pagarmeSubscriptionId: { not: null },
        status: { in: ['PENDING_CARD', 'ACTIVE'] },
        OR: [
          { lastSyncedAt: null },
          { status: 'PENDING_CARD', lastSyncedAt: { lt: new Date(now - SYNC_PENDING_MS) } },
          { currentPeriodEnd: { lt: new Date(now) }, lastSyncedAt: { lt: new Date(now - SYNC_EXPIRED_MS) } },
          { lastSyncedAt: { lt: new Date(now - SYNC_ACTIVE_MS) } },
        ],
      },
      orderBy: { lastSyncedAt: 'asc' },
      take: RECONCILE_BATCH,
      select: { id: true },
    });
    for (const { id } of due) {
      try {
        await this.sync(id);
      } catch (error) {
        this.logger.warn(`Conferência da assinatura ${id} falhou: ${(error as Error).message}`);
      }
    }
    return due.length;
  }

  /** Mensalidade paga: pedido + pagamento (uma vez por fatura) e lançamento no caixa */
  private async recordPaidInvoice(sub: CustomerSubscription, invoice: PagarmeInvoice) {
    if (await this.prisma.payment.findUnique({ where: { externalInvoiceId: invoice.id }, select: { id: true } })) return;

    const chargeId = invoice.charge?.id;
    const charge: PagarmeCharge = chargeId
      ? await this.client.getCharge(chargeId)
      : { id: invoice.id, status: 'paid', amount: invoice.amount, paid_amount: invoice.amount, paid_at: new Date().toISOString() };
    const amount = invoice.amount;
    // A taxa repassada acompanha o valor cobrado (normalmente igual ao da ativação)
    const fee = sub.chargedCents > 0 ? Math.round((sub.customerFeeCents * amount) / sub.chargedCents) : 0;
    const platformCents = platformShareCents(amount, sub.platformFeePercent);

    let paymentId: string;
    try {
      const order = await this.prisma.order.create({
        data: {
          userId: sub.userId,
          subscriptionId: sub.id,
          subtotalCents: amount - fee,
          totalCents: amount,
          payments: {
            create: {
              provider: 'PAGARME',
              method: 'CREDIT_CARD',
              amountCents: amount,
              status: 'PENDING',
              externalInvoiceId: invoice.id,
              providerTransactionId: chargeId ?? null,
              platformFeePercent: sub.platformFeePercent,
              platformFeeCents: platformCents,
              recipientCents: amount - platformCents,
              customerFeeCents: fee,
              installments: 1,
            },
          },
        },
        include: { payments: { select: { id: true } } },
      });
      paymentId = order.payments[0].id;
    } catch (error) {
      // Webhook e conferência chegando juntos: o unique da fatura garante um só pagamento
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
    await this.payments.applyCharge(charge, paymentId);
  }
}
