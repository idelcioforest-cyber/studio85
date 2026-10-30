import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerSubscription, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import {
  ActivateSubscriptionInput,
  SubscriptionPlanInput,
  SubscriptionSetupInput,
  cardCharge,
} from '@autowash/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptSensitiveData } from '../../common/utils/crypto.util';
import { PagarmeRecipientService } from '../pagarme/pagarme-recipient.service';
import { PagarmeSubscriptionsService } from '../pagarme/pagarme-subscriptions.service';
import { pagarmeConfig } from '../pagarme/pagarme.config';

type Db = PrismaService | Prisma.TransactionClient;

const SETUP_LINK_DAYS = 7;
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const vehicleLabelOf = (v: { make: string; model: string; color: string | null }) => [v.make, v.model, v.color].filter(Boolean).join(' ');
const serviceIdsOf = (sub: { serviceIdsJson: string }) => JSON.parse(sub.serviceIdsJson) as string[];

/** Situação mostrada no painel: "ativa" só enquanto o período pago não acabou */
function effectiveStatus(sub: CustomerSubscription): 'PENDING_CARD' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' {
  if (sub.status !== 'ACTIVE') return sub.status;
  return sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now() ? 'ACTIVE' : 'PAST_DUE';
}

const PLAN_INCLUDE = {
  services: { include: { service: { select: { id: true, name: true, isActive: true } } } },
  prices: { orderBy: { priceCents: 'asc' } },
  _count: { select: { subscriptions: { where: { status: { not: 'CANCELED' } } } } },
} satisfies Prisma.SubscriptionPlanInclude;

/**
 * Assinaturas montadas e ativadas pelo dono, só no painel. O site não divulga planos:
 * o cliente só fica sabendo pelo link que o dono manda e, depois, vê a lavagem coberta ao agendar.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private pagarme: PagarmeSubscriptionsService,
    private recipients: PagarmeRecipientService,
  ) {}

  // ---------------------------------------------------------------- planos

  async listPlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({ include: PLAN_INCLUDE, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return plans.map((p) => this.planDto(p));
  }

  async createPlan(input: SubscriptionPlanInput) {
    await this.assertServices(input.serviceIds);
    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: input.name,
        description: input.description || null,
        washesPerMonth: input.washesPerMonth,
        isActive: input.isActive,
        services: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
        prices: { create: input.prices },
      },
      include: PLAN_INCLUDE,
    });
    return this.planDto(plan);
  }

  /** Mudar o plano não altera quem já assina: as regras ficam congeladas na ativação */
  async updatePlan(id: string, input: SubscriptionPlanInput) {
    await this.findPlan(id);
    await this.assertServices(input.serviceIds);
    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPlanService.deleteMany({ where: { planId: id } });
      await tx.subscriptionPlanPrice.deleteMany({ where: { planId: id } });
      return tx.subscriptionPlan.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description || null,
          washesPerMonth: input.washesPerMonth,
          isActive: input.isActive,
          services: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
          prices: { create: input.prices },
        },
        include: PLAN_INCLUDE,
      });
    });
    return this.planDto(plan);
  }

  async deletePlan(id: string) {
    await this.findPlan(id);
    if (await this.prisma.customerSubscription.count({ where: { planId: id } })) {
      throw new ConflictException('Este plano já foi usado por clientes. Desative-o em vez de excluir.');
    }
    await this.prisma.subscriptionPlan.delete({ where: { id } });
    return { success: true };
  }

  // ---------------------------------------------------------------- assinantes

  async list() {
    const subs = await this.prisma.customerSubscription.findMany({
      include: { user: { select: { name: true, phone: true } }, vehicle: { select: { make: true, model: true, color: true, plate: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const used = await this.usageByPeriod(this.prisma, subs);
    return subs.map((s) => ({
      ...this.subscriptionDto(s, used.get(s.id) ?? 0),
      customer: { id: s.userId, name: s.user.name, phone: s.user.phone },
      vehicle: { id: s.vehicleId, label: vehicleLabelOf(s.vehicle), plate: s.vehicle.plate },
    }));
  }

  /** O dono ativa o plano para um veículo do cliente e recebe o link para o cliente cadastrar o cartão */
  async activate(input: ActivateSubscriptionInput) {
    const [plan, vehicle, settings] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({ where: { id: input.planId }, include: { services: true, prices: true } }),
      this.prisma.vehicle.findFirst({ where: { id: input.vehicleId, userId: input.userId, status: 'ACTIVE' } }),
      this.prisma.businessSettings.findFirst({ select: { subscriptionsEnabled: true, onlinePaymentsEnabled: true } }),
    ]);
    if (!settings?.subscriptionsEnabled) throw new BadRequestException('Libere as assinaturas em Configurações antes de ativar.');
    if (!settings.onlinePaymentsEnabled) {
      throw new BadRequestException('Ligue o pagamento no app em Configurações: a mensalidade é cobrada no cartão pelo Pagar.me.');
    }
    if (!plan || !plan.isActive) throw new NotFoundException('Plano não encontrado ou desativado.');
    if (!vehicle) throw new NotFoundException('Veículo não encontrado na garagem desse cliente.');
    const price = plan.prices.find((p) => p.sizeCategory === vehicle.sizeCategory);
    if (!price) throw new BadRequestException('Este plano não tem preço para o porte desse veículo.');
    const open = await this.prisma.customerSubscription.findFirst({ where: { vehicleId: vehicle.id, status: { not: 'CANCELED' } } });
    if (open) throw new ConflictException('Esse veículo já tem uma assinatura. Cancele a atual antes de ativar outra.');

    // Mensalidade no cartão em 1x: a taxa do Pagar.me fica com o cliente
    const charge = cardCharge(price.priceCents, 1, pagarmeConfig.feeRates);
    const washer = await this.recipients.activeWasher();
    const token = crypto.randomBytes(24).toString('base64url');
    const sub = await this.prisma.customerSubscription.create({
      data: {
        planId: plan.id,
        userId: input.userId,
        vehicleId: vehicle.id,
        planNameSnapshot: plan.name,
        washesPerMonth: plan.washesPerMonth,
        serviceIdsJson: JSON.stringify(plan.services.map((s) => s.serviceId)),
        sizeCategory: vehicle.sizeCategory,
        priceCents: charge.baseCents,
        customerFeeCents: charge.feeCents,
        chargedCents: charge.totalCents,
        platformFeePercent: washer ? this.recipients.feePercentFor(washer) : pagarmeConfig.platformFeePercent,
        setupTokenHash: sha256(token),
        setupTokenExpiresAt: new Date(Date.now() + SETUP_LINK_DAYS * 86_400_000),
      },
    });
    return { subscription: this.subscriptionDto(sub, 0), setupUrl: this.setupUrl(token) };
  }

  /** Link novo (o anterior para de funcionar), enquanto o cliente não cadastrou o cartão */
  async regenerateLink(id: string) {
    const sub = await this.findSubscription(id);
    if (sub.status !== 'PENDING_CARD') throw new BadRequestException('O cliente já cadastrou o cartão.');
    const token = crypto.randomBytes(24).toString('base64url');
    const updated = await this.prisma.customerSubscription.update({
      where: { id },
      data: { setupTokenHash: sha256(token), setupTokenExpiresAt: new Date(Date.now() + SETUP_LINK_DAYS * 86_400_000) },
    });
    return { subscription: this.subscriptionDto(updated, 0), setupUrl: this.setupUrl(token) };
  }

  async cancel(id: string, reason: string | null) {
    const sub = await this.findSubscription(id);
    const updated = await this.pagarme.cancel(sub, reason);
    return this.subscriptionDto(updated, 0);
  }

  async refresh(id: string) {
    await this.findSubscription(id);
    const updated = (await this.pagarme.sync(id))!;
    const used = await this.usageByPeriod(this.prisma, [updated]);
    return this.subscriptionDto(updated, used.get(id) ?? 0);
  }

  // ---------------------------------------------------------------- link do cliente (público)

  async setupView(token: string) {
    const sub = await this.findByToken(token);
    const [user, vehicle, services] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: sub.userId }, select: { name: true, email: true, cpfEncrypted: true, phone: true } }),
      this.prisma.vehicle.findUniqueOrThrow({ where: { id: sub.vehicleId }, select: { make: true, model: true, color: true, plate: true } }),
      this.prisma.service.findMany({ where: { id: { in: serviceIdsOf(sub) } }, select: { name: true } }),
    ]);
    const enabled = await this.recipients.isActive();
    return {
      status: effectiveStatus(sub),
      processing: sub.status === 'PENDING_CARD' && Boolean(sub.pagarmeSubscriptionId),
      lastError: sub.status === 'PENDING_CARD' ? sub.lastError : null,
      firstName: user.name.split(' ')[0],
      planName: sub.planNameSnapshot,
      washesPerMonth: sub.washesPerMonth,
      services: services.map((s) => s.name),
      vehicle: { label: vehicleLabelOf(vehicle), plate: vehicle.plate },
      priceCents: sub.priceCents,
      customerFeeCents: sub.customerFeeCents,
      chargedCents: sub.chargedCents,
      card: sub.cardLast4 ? { brand: sub.cardBrand, last4: sub.cardLast4 } : null,
      periodEnd: sub.currentPeriodEnd,
      // Só pede o que falta no cadastro
      needs: { email: !user.email, cpf: !user.cpfEncrypted, phone: (user.phone ?? '').replace(/\D/g, '').length < 10 },
      publicKey: enabled ? pagarmeConfig.publicKey : null,
    };
  }

  async setupSubmit(token: string, input: SubscriptionSetupInput) {
    const sub = await this.findByToken(token);
    if (sub.status !== 'PENDING_CARD') throw new BadRequestException('Esta assinatura já está ativa.');
    const [user, vehicle] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: sub.userId }, select: { name: true, email: true, cpfEncrypted: true, phone: true } }),
      this.prisma.vehicle.findUniqueOrThrow({ where: { id: sub.vehicleId }, select: { make: true, model: true, color: true } }),
    ]);
    const email = user.email || input.email;
    const cpf = user.cpfEncrypted ? decryptSensitiveData(user.cpfEncrypted) : input.cpf;
    const phone = ((user.phone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') || input.phone) ?? '';
    if (!email) throw new BadRequestException('Informe seu e-mail.');
    if (!cpf) throw new BadRequestException('Informe seu CPF.');
    if (phone.length < 10) throw new BadRequestException('Informe seu celular com DDD.');

    await this.pagarme.start(sub, vehicleLabelOf(vehicle), { name: user.name, email, cpf, phone }, input.cardToken);
    return this.setupView(token);
  }

  // ---------------------------------------------------------------- cliente logado

  /** Só quem assina recebe algo aqui; para os demais a lista vem vazia e nada aparece no app */
  async mine(userId: string) {
    const subs = await this.prisma.customerSubscription.findMany({ where: { userId, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } } });
    const used = await this.usageByPeriod(this.prisma, subs);
    return subs.map((s) => ({
      id: s.id,
      vehicleId: s.vehicleId,
      planName: s.planNameSnapshot,
      serviceIds: serviceIdsOf(s),
      washesPerMonth: s.washesPerMonth,
      remaining: Math.max(0, s.washesPerMonth - (used.get(s.id) ?? 0)),
      periodStart: s.currentPeriodStart,
      periodEnd: s.currentPeriodEnd,
    }));
  }

  // ---------------------------------------------------------------- uso nas lavagens

  /**
   * Na criação do agendamento (dentro da transação): se o veículo tem assinatura com o período pago
   * cobrindo a data e ainda há lavagens no mês, os serviços do plano saem do total.
   * A linha da assinatura fica travada até o fim da transação, então duas reservas juntas não passam do limite.
   */
  async coverage(tx: Prisma.TransactionClient, args: { userId: string | null; vehicleId: string | null; startsAt: Date; serviceIds: string[] }) {
    if (!args.userId || !args.vehicleId) return null;
    const sub = await tx.customerSubscription.findFirst({
      where: {
        userId: args.userId,
        vehicleId: args.vehicleId,
        status: 'ACTIVE',
        currentPeriodStart: { lte: args.startsAt },
        currentPeriodEnd: { gt: args.startsAt },
      },
    });
    if (!sub) return null;
    const planServices = new Set(serviceIdsOf(sub));
    const covered = new Set(args.serviceIds.filter((id) => planServices.has(id)));
    if (covered.size === 0) return null;

    await tx.$queryRaw`SELECT id FROM customer_subscriptions WHERE id = ${sub.id} FOR UPDATE`;
    const used = (await this.usageByPeriod(tx, [sub])).get(sub.id) ?? 0;
    if (used >= sub.washesPerMonth) return null;
    return { subscriptionId: sub.id, covered };
  }

  // ---------------------------------------------------------------- apoio

  /** Lavagens já usadas no período pago atual (cancelada devolve a lavagem) */
  private async usageByPeriod(db: Db, subs: CustomerSubscription[]) {
    const result = new Map<string, number>();
    for (const s of subs) {
      if (!s.currentPeriodStart || !s.currentPeriodEnd) continue;
      result.set(
        s.id,
        await db.appointment.count({
          where: { subscriptionId: s.id, status: { not: 'CANCELLED' }, startsAt: { gte: s.currentPeriodStart, lt: s.currentPeriodEnd } },
        }),
      );
    }
    return result;
  }

  private subscriptionDto(s: CustomerSubscription, used: number) {
    const linkActive = s.status === 'PENDING_CARD' && Boolean(s.setupTokenHash) && (s.setupTokenExpiresAt?.getTime() ?? 0) > Date.now();
    return {
      id: s.id,
      planId: s.planId,
      planName: s.planNameSnapshot,
      status: effectiveStatus(s),
      washesPerMonth: s.washesPerMonth,
      used,
      serviceIds: serviceIdsOf(s),
      sizeCategory: s.sizeCategory,
      priceCents: s.priceCents,
      customerFeeCents: s.customerFeeCents,
      chargedCents: s.chargedCents,
      card: s.cardLast4 ? { brand: s.cardBrand, last4: s.cardLast4 } : null,
      periodStart: s.currentPeriodStart,
      periodEnd: s.currentPeriodEnd,
      processing: s.status === 'PENDING_CARD' && Boolean(s.pagarmeSubscriptionId),
      linkActive,
      linkExpiresAt: linkActive ? s.setupTokenExpiresAt : null,
      lastError: s.lastError,
      canceledAt: s.canceledAt,
      cancelReason: s.cancelReason,
      createdAt: s.createdAt,
    };
  }

  private planDto(p: Prisma.SubscriptionPlanGetPayload<{ include: typeof PLAN_INCLUDE }>) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      washesPerMonth: p.washesPerMonth,
      isActive: p.isActive,
      services: p.services.map((s) => ({ id: s.service.id, name: s.service.name, isActive: s.service.isActive })),
      prices: p.prices.map((pr) => ({ sizeCategory: pr.sizeCategory, priceCents: pr.priceCents })),
      subscribers: p._count.subscriptions,
    };
  }

  private async assertServices(ids: string[]) {
    const count = await this.prisma.service.count({ where: { id: { in: ids }, isActive: true } });
    if (count !== ids.length) throw new BadRequestException('Um dos serviços escolhidos não existe ou está desativado.');
  }

  private async findPlan(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plano não encontrado.');
    return plan;
  }

  private async findSubscription(id: string) {
    const sub = await this.prisma.customerSubscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Assinatura não encontrada.');
    return sub;
  }

  private async findByToken(token: string) {
    const sub = await this.prisma.customerSubscription.findUnique({ where: { setupTokenHash: sha256(token) } });
    if (!sub) throw new NotFoundException('Link inválido. Peça um novo ao lava-jato.');
    if (sub.status === 'CANCELED') throw new GoneException('Esta assinatura foi cancelada.');
    if (sub.status === 'PENDING_CARD' && (sub.setupTokenExpiresAt?.getTime() ?? 0) < Date.now()) {
      throw new GoneException('Este link expirou. Peça um novo ao lava-jato.');
    }
    return sub;
  }

  private setupUrl(token: string) {
    return `${(process.env.FRONTEND_URL || 'https://studio85poa.com.br').replace(/\/+$/, '')}/assinatura/${token}`;
  }
}
