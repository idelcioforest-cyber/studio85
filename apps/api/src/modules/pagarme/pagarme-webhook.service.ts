import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PagarmeClient } from './pagarme.client';
import { pagarmeConfig } from './pagarme.config';
import { PagarmePaymentsService } from './pagarme-payments.service';
import { PagarmeRecipientService } from './pagarme-recipient.service';
import { PagarmeSubscriptionsService } from './pagarme-subscriptions.service';

interface WebhookBody {
  id?: string;
  type?: string;
  data?: {
    id?: string;
    metadata?: Record<string, string>;
    order?: { id?: string; metadata?: Record<string, string> };
    charge?: { id?: string; order?: { id?: string }; metadata?: Record<string, string> };
    subscription?: { id?: string; metadata?: Record<string, string> };
  };
}

const MAX_ATTEMPTS = 5;
const SWEEP_EVERY_MS = 5 * 60 * 1000;
const RECONCILE_EVERY_MS = 2 * 60 * 1000;

/**
 * Webhook do Pagar.me. A conta é compartilhada com outros sistemas, então:
 * - eventos que não são deste sistema recebem 200 e são ignorados (nunca 4xx/5xx);
 * - o payload nunca é confiado: o recurso é reconsultado na API antes de mudar o banco;
 * - cada event_id é processado uma vez só; falhas são refeitas com espera crescente (até 5 vezes).
 */
@Injectable()
export class PagarmeWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PagarmeWebhookService.name);
  private sweeper: NodeJS.Timeout | null = null;
  private reconciler: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private client: PagarmeClient,
    private payments: PagarmePaymentsService,
    private recipients: PagarmeRecipientService,
    private subscriptions: PagarmeSubscriptionsService,
  ) {}

  onModuleInit() {
    // Retoma eventos pendentes (ex.: o processo reiniciou no meio)
    this.sweeper = setInterval(() => this.sweep().catch(() => undefined), SWEEP_EVERY_MS);
    this.sweeper.unref();
    // Pagamentos em aberto são conferidos na API mesmo sem webhook (aviso perdido ou não cadastrado)
    this.reconciler = setInterval(() => {
      this.payments.reconcilePending().catch(() => undefined);
      this.subscriptions.reconcile().catch(() => undefined);
    }, RECONCILE_EVERY_MS);
    this.reconciler.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    if (this.reconciler) clearInterval(this.reconciler);
  }

  /** Basic Auth opcional: só é exigido com PAGARME_WEBHOOK_USER definido */
  assertAuthorized(authorization: string | undefined) {
    if (!pagarmeConfig.webhookUser) return;
    const expected = Buffer.from(`Basic ${Buffer.from(`${pagarmeConfig.webhookUser}:${pagarmeConfig.webhookPass}`).toString('base64')}`);
    const received = Buffer.from(authorization || '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException('Credenciais do webhook inválidas.');
    }
  }

  /** Grava e agenda o processamento; responde rápido */
  async receive(body: WebhookBody): Promise<{ received: true; status: 'stored' | 'duplicate' | 'ignored' }> {
    const eventId = body?.id;
    const type = body?.type;
    if (!eventId || !type) return { received: true, status: 'ignored' };

    if (await this.prisma.pagarmeWebhookEvent.findUnique({ where: { eventId }, select: { id: true } })) {
      return { received: true, status: 'duplicate' };
    }
    if (!(await this.belongsToUs(type, body.data))) return { received: true, status: 'ignored' };

    let stored: { id: string };
    try {
      stored = await this.prisma.pagarmeWebhookEvent.create({
        data: { eventId, type, resourceId: this.resourceId(type, body.data), payloadJson: JSON.stringify(body).slice(0, 500_000) },
        select: { id: true },
      });
    } catch {
      // Mesma entrega chegando em paralelo: o unique de event_id garante uma só
      return { received: true, status: 'duplicate' };
    }
    setImmediate(() => this.process(stored.id).catch(() => undefined));
    return { received: true, status: 'stored' };
  }

  async process(id: string): Promise<void> {
    const event = await this.prisma.pagarmeWebhookEvent.findUnique({ where: { id } });
    if (!event || event.processedAt) return;
    const attempts = event.attempts + 1;
    try {
      await this.handle(event.type, JSON.parse(event.payloadJson) as WebhookBody);
      await this.prisma.pagarmeWebhookEvent.update({ where: { id }, data: { attempts, processedAt: new Date(), error: null } });
    } catch (error) {
      const message = (error as Error).message || 'Erro desconhecido';
      await this.prisma.pagarmeWebhookEvent.update({ where: { id }, data: { attempts, error: message.slice(0, 5000) } });
      this.logger.warn(`Webhook ${event.type} (${event.eventId}) falhou na tentativa ${attempts}: ${message}`);
      if (attempts < MAX_ATTEMPTS) {
        const delay = 30_000 * 2 ** (attempts - 1); // 30s, 1min, 2min, 4min
        setTimeout(() => this.process(id).catch(() => undefined), delay).unref();
      }
    }
  }

  async reprocess(id: string) {
    const event = await this.prisma.pagarmeWebhookEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Evento não encontrado.');
    await this.prisma.pagarmeWebhookEvent.update({ where: { id }, data: { attempts: 0, processedAt: null, error: null } });
    await this.process(id);
    return this.prisma.pagarmeWebhookEvent.findUnique({ where: { id }, select: { id: true, eventId: true, type: true, processedAt: true, attempts: true, error: true } });
  }

  list(limit = 100) {
    return this.prisma.pagarmeWebhookEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 300),
      select: { id: true, eventId: true, type: true, resourceId: true, attempts: true, processedAt: true, error: true, createdAt: true },
    });
  }

  /** Reconsulta o recurso na API e só então atualiza o banco */
  private async handle(type: string, body: WebhookBody) {
    const data = body.data ?? {};
    if (type.startsWith('order.')) {
      if (!data.id) return;
      await this.payments.applyOrder(await this.client.getOrder(data.id));
      return;
    }
    if (type.startsWith('charge.')) {
      if (!data.id) return;
      await this.payments.applyCharge(await this.client.getCharge(data.id));
      return;
    }
    if (type.startsWith('chargeback.')) {
      const chargeId = data.charge?.id;
      if (!chargeId) return;
      const charge = await this.payments.applyCharge(await this.client.getCharge(chargeId));
      if (charge) this.logger.warn(`Chargeback no pagamento ${charge.id}: o lava-jato é o responsável (liable).`);
      return;
    }
    if (type.startsWith('recipient.')) {
      if (!data.id) return;
      await this.recipients.applyRemote(await this.client.getRecipient(data.id));
      return;
    }
    if (type.startsWith('subscription.')) {
      if (!data.id) return;
      await this.subscriptions.applyRemote(await this.client.getSubscription(data.id));
      return;
    }
    if (type.startsWith('invoice.')) {
      if (!data.id) return;
      await this.subscriptions.applyInvoice(await this.client.getInvoice(data.id));
      return;
    }
  }

  private async belongsToUs(type: string, data: WebhookBody['data']): Promise<boolean> {
    const tag = pagarmeConfig.sourceTag;
    const sources = [data?.metadata?.source, data?.order?.metadata?.source, data?.charge?.metadata?.source, data?.subscription?.metadata?.source];
    if (sources.includes(tag)) return true;

    const ids = [data?.id, data?.order?.id, data?.charge?.id, data?.charge?.order?.id, data?.subscription?.id].filter((v): v is string =>
      Boolean(v),
    );
    if (ids.length === 0) return false;
    if (type.startsWith('recipient.')) {
      return (await this.prisma.paymentRecipient.count({ where: { pagarmeRecipientId: { in: ids } } })) > 0;
    }
    if (type.startsWith('subscription.') || type.startsWith('invoice.')) {
      return (await this.prisma.customerSubscription.count({ where: { pagarmeSubscriptionId: { in: ids } } })) > 0;
    }
    return (
      (await this.prisma.payment.count({
        where: { provider: 'PAGARME', OR: [{ externalOrderId: { in: ids } }, { providerTransactionId: { in: ids } }] },
      })) > 0
    );
  }

  private resourceId(type: string, data: WebhookBody['data']): string | null {
    if (type.startsWith('chargeback.')) return data?.charge?.id ?? null;
    return data?.id ?? null;
  }

  private async sweep() {
    const pending = await this.prisma.pagarmeWebhookEvent.findMany({
      where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS }, createdAt: { gt: new Date(Date.now() - 3 * 86_400_000) } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    for (const { id } of pending) await this.process(id);
  }
}
