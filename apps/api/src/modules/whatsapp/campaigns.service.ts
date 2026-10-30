import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CampaignRecipientStatus } from '@prisma/client';
import { CAMPAIGN_INTERVAL_SECONDS, CampaignInput, SendCampaignInput, displayName } from '@autowash/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppBridgeService } from './whatsapp-bridge.service';
import { NotificationsService } from './notifications.service';

const TICK_EVERY_MS = 10_000;
const INTERVAL_MS = CAMPAIGN_INTERVAL_SECONDS * 1000;
// Mensagem que ficou "enviando" (o servidor reiniciou no meio): não reenvia sozinha para não duplicar
const STUCK_AFTER_MS = 5 * 60 * 1000;
const OPEN: CampaignRecipientStatus[] = ['QUEUED', 'SENDING'];

// Variáveis aceitas na mensagem do aviso
export const CAMPAIGN_VARIABLES = ['primeiro_nome', 'nome', 'empresa'] as const;

export interface CampaignContact {
  phone: string;
  name: string;
  lastVisit: string | null;
  hasAccount: boolean;
}

function countByStatus(recipients: { status: CampaignRecipientStatus }[]) {
  const counts: Record<CampaignRecipientStatus, number> = { QUEUED: 0, SENDING: 0, SENT: 0, FAILED: 0, CANCELED: 0 };
  for (const r of recipients) counts[r.status]++;
  return counts;
}

/**
 * Aviso em massa pelo WhatsApp: o dono escreve a mensagem e escolhe até 20 contatos por vez.
 * A fila manda uma mensagem por minuto, só com o número conectado, e o mesmo número nunca
 * recebe o mesmo aviso duas vezes.
 */
@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private prisma: PrismaService,
    private bridge: WhatsAppBridgeService,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.warn(`Fila de avisos: ${(error as Error).message}`));
    }, TICK_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Clientes com celular válido, com conta ou de balcão, um por número (o nome do cadastro tem preferência) */
  async contacts(): Promise<CampaignContact[]> {
    const [clients, walkIns] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          roles: { some: { role: { name: 'CLIENT' } } },
          status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
          phone: { not: null },
        },
        select: { name: true, phone: true, appointments: { select: { startsAt: true }, orderBy: { startsAt: 'desc' }, take: 1 } },
      }),
      this.prisma.appointment.findMany({
        where: { userId: null, customerPhone: { not: null } },
        select: { customerName: true, customerPhone: true, startsAt: true },
        orderBy: { startsAt: 'desc' },
      }),
    ]);

    const byPhone = new Map<string, CampaignContact>();
    for (const client of clients) {
      const phone = this.bridge.normalizePhone(client.phone);
      if (!phone || byPhone.has(phone)) continue;
      byPhone.set(phone, { phone, name: client.name, lastVisit: client.appointments[0]?.startsAt.toISOString() ?? null, hasAccount: true });
    }
    for (const walkIn of walkIns) {
      const phone = this.bridge.normalizePhone(walkIn.customerPhone);
      if (!phone) continue;
      const visit = walkIn.startsAt.toISOString();
      const known = byPhone.get(phone);
      if (!known) byPhone.set(phone, { phone, name: walkIn.customerName, lastVisit: visit, hasAccount: false });
      else if (!known.lastVisit || known.lastVisit < visit) known.lastVisit = visit;
    }
    return [...byPhone.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async list() {
    const [campaigns, queue] = await Promise.all([
      this.prisma.whatsAppCampaign.findMany({ orderBy: { createdAt: 'desc' }, include: { recipients: { select: { status: true } } } }),
      this.queueInfo(),
    ]);
    return {
      campaigns: campaigns.map(({ recipients, ...campaign }) => ({ ...campaign, counts: countByStatus(recipients) })),
      queue,
      variables: CAMPAIGN_VARIABLES,
    };
  }

  /** O aviso com todos os contatos e a situação de cada um neste aviso */
  async detail(id: string) {
    const campaign = await this.prisma.whatsAppCampaign.findUnique({ where: { id }, include: { recipients: true } });
    if (!campaign) throw new NotFoundException('Aviso não encontrado.');
    const contacts = await this.contacts();
    const byPhone = new Map(campaign.recipients.map((r) => [r.phone, r]));
    const rows = contacts.map((c) => {
      const r = byPhone.get(c.phone);
      return { ...c, status: r?.status ?? null, error: r?.error ?? null, sentAt: r?.sentAt ?? null };
    });
    // Quem já está no aviso mas saiu da lista (ex.: trocou de celular) continua aparecendo
    const listed = new Set(contacts.map((c) => c.phone));
    for (const r of campaign.recipients) {
      if (!listed.has(r.phone)) rows.push({ phone: r.phone, name: r.name, lastVisit: null, hasAccount: false, status: r.status, error: r.error, sentAt: r.sentAt });
    }
    const { recipients, ...rest } = campaign;
    return { campaign: { ...rest, counts: countByStatus(recipients) }, contacts: rows, queue: await this.queueInfo() };
  }

  create(input: CampaignInput) {
    return this.prisma.whatsAppCampaign.create({ data: input });
  }

  async update(id: string, input: CampaignInput) {
    await this.find(id);
    return this.prisma.whatsAppCampaign.update({ where: { id }, data: input });
  }

  async remove(id: string) {
    await this.find(id);
    const open = await this.prisma.whatsAppCampaignRecipient.count({ where: { campaignId: id, status: { in: OPEN } } });
    if (open > 0) throw new ConflictException('Pare o envio deste aviso antes de excluir.');
    await this.prisma.whatsAppCampaign.delete({ where: { id } });
    return { success: true };
  }

  /** Coloca até 20 contatos na fila. Quem já recebeu é pulado; quem falhou ou foi parado volta para a fila */
  async send(id: string, input: SendCampaignInput) {
    await this.find(id);
    await this.requireConnected();
    // Um lote por vez: o próximo só depois que o atual terminar
    const pending = await this.prisma.whatsAppCampaignRecipient.count({ where: { status: { in: OPEN } } });
    if (pending > 0) {
      throw new ConflictException(`Ainda há ${pending} mensagem(ns) na fila. Espere terminar para mandar para mais contatos.`);
    }

    const contacts = new Map((await this.contacts()).map((c) => [c.phone, c]));
    const chosen = input.phones.map((phone) => contacts.get(phone)).filter((c): c is CampaignContact => Boolean(c));
    if (chosen.length === 0) throw new BadRequestException('Nenhum dos contatos escolhidos tem celular válido.');

    const existing = await this.prisma.whatsAppCampaignRecipient.findMany({
      where: { campaignId: id, phone: { in: chosen.map((c) => c.phone) } },
    });
    const known = new Set(existing.map((r) => r.phone));
    const fresh = chosen.filter((c) => !known.has(c.phone));
    const retry = existing.filter((r) => r.status === 'FAILED' || r.status === 'CANCELED');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.whatsAppCampaignRecipient.createMany({
        data: fresh.map((c) => ({ campaignId: id, phone: c.phone, name: c.name.slice(0, 120), queuedAt: now })),
        skipDuplicates: true,
      }),
      this.prisma.whatsAppCampaignRecipient.updateMany({
        where: { id: { in: retry.map((r) => r.id) } },
        // attemptedAt fica: o intervalo de 1 minuto conta a partir da última tentativa real
        data: { status: 'QUEUED', error: null, queuedAt: now, sentAt: null },
      }),
    ]);

    const queued = fresh.length + retry.length;
    return { queued, alreadySent: chosen.length - queued, minutes: Math.ceil((queued * CAMPAIGN_INTERVAL_SECONDS) / 60) };
  }

  /** Para o envio: quem ainda estava na fila fica livre para ser escolhido depois */
  async cancel(id: string) {
    await this.find(id);
    const { count } = await this.prisma.whatsAppCampaignRecipient.updateMany({
      where: { campaignId: id, status: 'QUEUED' },
      data: { status: 'CANCELED' },
    });
    return { canceled: count };
  }

  /** Manda a próxima mensagem da fila: no máximo uma por minuto e só com o número conectado */
  async tick(now = new Date()): Promise<'SENT' | 'FAILED' | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      await this.prisma.whatsAppCampaignRecipient.updateMany({
        where: { status: 'SENDING', attemptedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
        data: { status: 'FAILED', error: 'Envio interrompido. Confira no WhatsApp antes de mandar de novo.' },
      });

      const next = await this.prisma.whatsAppCampaignRecipient.findFirst({
        where: { status: 'QUEUED' },
        orderBy: [{ queuedAt: 'asc' }, { name: 'asc' }],
        include: { campaign: true },
      });
      if (!next) return null;
      const last = await this.lastAttempt();
      if (last && now.getTime() - last.getTime() < INTERVAL_MS) return null;
      // Número desconectado: a fila espera ele voltar
      if (!this.bridge.enabled || !this.bridge.configured) return null;
      if ((await this.bridge.getStatus()).status !== 'CONNECTED') return null;

      const claimed = await this.prisma.whatsAppCampaignRecipient.updateMany({
        where: { id: next.id, status: 'QUEUED' },
        data: { status: 'SENDING', attemptedAt: now },
      });
      if (claimed.count !== 1) return null;

      const settings = await this.prisma.businessSettings.findFirst({ select: { companyName: true } });
      const name = displayName(next.name);
      const body = this.notifications.render(next.campaign.body, {
        nome: name,
        primeiro_nome: name.split(' ')[0],
        empresa: settings?.companyName || 'Studio 85',
      });

      try {
        const sent = await this.bridge.sendText(next.phone, body);
        await this.prisma.whatsAppCampaignRecipient.update({ where: { id: next.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
        await this.prisma.whatsAppMessage.create({ data: { templateKey: 'AVISO', phone: next.phone, body, status: 'SENT', externalId: sent.id } });
        return 'SENT';
      } catch (error) {
        const message = (error as Error).message.slice(0, 500);
        this.logger.warn(`Aviso "${next.campaign.title}" não enviado para ${next.phone}: ${message}`);
        await this.prisma.whatsAppCampaignRecipient.update({ where: { id: next.id }, data: { status: 'FAILED', error: message } });
        await this.prisma.whatsAppMessage.create({ data: { templateKey: 'AVISO', phone: next.phone, body, status: 'FAILED', error: message } });
        return 'FAILED';
      }
    } finally {
      this.busy = false;
    }
  }

  private async find(id: string) {
    const campaign = await this.prisma.whatsAppCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Aviso não encontrado.');
    return campaign;
  }

  private async requireConnected() {
    if (!this.bridge.enabled || !this.bridge.configured) {
      throw new BadRequestException('O WhatsApp está desligado no servidor. Fale com o suporte.');
    }
    if ((await this.bridge.getStatus()).status !== 'CONNECTED') {
      throw new BadRequestException('Conecte o número do WhatsApp em Configurações antes de enviar.');
    }
  }

  private async lastAttempt(): Promise<Date | null> {
    const last = await this.prisma.whatsAppCampaignRecipient.findFirst({
      where: { attemptedAt: { not: null } },
      orderBy: { attemptedAt: 'desc' },
      select: { attemptedAt: true },
    });
    return last?.attemptedAt ?? null;
  }

  /** Quantas mensagens faltam na fila e quando sai a próxima */
  private async queueInfo() {
    const [pending, last] = await Promise.all([
      this.prisma.whatsAppCampaignRecipient.count({ where: { status: { in: OPEN } } }),
      this.lastAttempt(),
    ]);
    const nextAt = pending > 0 ? new Date(Math.max(Date.now(), (last?.getTime() ?? 0) + INTERVAL_MS)).toISOString() : null;
    return { pending, nextAt };
  }
}
