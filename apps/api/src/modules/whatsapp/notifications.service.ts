import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OutboundMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageTemplateKey, UpdateMessageTemplateInput } from '@autowash/shared';
import { WhatsAppBridgeService, WhatsAppSendError } from './whatsapp-bridge.service';
import { readStoredFile } from '../../common/utils/private-storage.util';

// Variáveis aceitas nos modelos de mensagem
export const TEMPLATE_VARIABLES = [
  'nome',
  'primeiro_nome',
  'veiculo',
  'placa',
  'servicos',
  'data',
  'hora',
  'total',
  'codigo',
  'endereco',
  'empresa',
] as const;

const MAX_PHOTOS_PER_MESSAGE = 6;
const RETRY_DELAYS_MS = [0, 2000, 6000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mensagens automáticas de WhatsApp (agendamento confirmado, carro pronto + fotos de depois)
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private bridge: WhatsAppBridgeService,
  ) {}

  render(body: string, values: Record<string, string>): string {
    return body.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
  }

  private async contextFor(appointmentId: string) {
    const [appointment, settings] = await Promise.all([
      this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          services: { orderBy: { durationMinutes: 'desc' } },
          mediaAssets: {
            where: { category: 'AFTER', visibility: 'CLIENT_VISIBLE' },
            orderBy: { createdAt: 'asc' },
            take: MAX_PHOTOS_PER_MESSAGE,
          },
        },
      }),
      this.prisma.businessSettings.findFirst(),
    ]);
    if (!appointment) throw new NotFoundException('Agendamento não encontrado.');

    const timeZone = settings?.timezone || 'America/Sao_Paulo';
    const plate = appointment.vehiclePlate
      ? /^[A-Z]{3}[0-9]{4}$/.test(appointment.vehiclePlate)
        ? `${appointment.vehiclePlate.slice(0, 3)}-${appointment.vehiclePlate.slice(3)}`
        : appointment.vehiclePlate
      : 'sem placa';

    const values: Record<string, string> = {
      nome: appointment.customerName,
      primeiro_nome: appointment.customerName.split(' ')[0],
      veiculo: appointment.vehicleLabel,
      placa: plate,
      servicos: appointment.services.map((s) => s.serviceNameSnapshot).join(' + '),
      data: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone }).format(
        appointment.startsAt,
      ),
      hora: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(appointment.startsAt),
      total: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(appointment.totalPriceCents / 100),
      codigo: appointment.readableCode,
      endereco: settings?.address || '',
      empresa: settings?.companyName || 'Studio 85',
    };

    return { appointment, values };
  }

  private async withRetry<T>(action: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await sleep(delay);
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (!(error instanceof WhatsAppSendError) || !error.retryable) break;
      }
    }
    throw lastError;
  }

  private async log(data: {
    appointmentId?: string | null;
    templateKey?: string | null;
    phone: string;
    body: string;
    status: OutboundMessageStatus;
    mediaCount?: number;
    externalId?: string | null;
    error?: string | null;
  }) {
    await this.prisma.whatsAppMessage.create({
      data: { ...data, error: data.error?.slice(0, 500) ?? null },
    });
    return { status: data.status, error: data.error ?? null };
  }

  /**
   * Envia a mensagem do modelo para o cliente do agendamento. `force` ignora o modelo desativado
   * (envio manual pela equipe). Nunca lança erro: o resultado fica registrado.
   */
  async notifyAppointment(appointmentId: string, key: MessageTemplateKey, options: { force?: boolean } = {}) {
    const template = await this.prisma.messageTemplate.findUnique({ where: { key } });
    if (!template || (!template.isActive && !options.force)) {
      return { status: 'SKIPPED' as const, error: 'Mensagem automática desativada.' };
    }

    const { appointment, values } = await this.contextFor(appointmentId);
    const body = this.render(template.body, values);
    const phone = this.bridge.normalizePhone(appointment.customerPhone);
    const base = { appointmentId, templateKey: key, body, phone: phone || appointment.customerPhone || '-' };

    if (!phone) return this.log({ ...base, status: 'SKIPPED', error: 'Cliente sem celular válido.' });
    if (!this.bridge.enabled || !this.bridge.configured) {
      return this.log({ ...base, status: 'SKIPPED', error: 'WhatsApp desligado no servidor.' });
    }

    try {
      const sent = await this.withRetry(() => this.bridge.sendText(phone, body));

      let mediaCount = 0;
      if (template.attachPhotos && key === 'CAR_READY') {
        for (const photo of appointment.mediaAssets) {
          const image = await readStoredFile(photo.storageKey);
          await this.withRetry(() => this.bridge.sendImage(phone, image, photo.mimeType));
          mediaCount++;
        }
      }

      return this.log({ ...base, status: 'SENT', externalId: sent.id, mediaCount });
    } catch (error) {
      this.logger.warn(`WhatsApp não enviado (${key}, ${appointment.readableCode}): ${(error as Error).message}`);
      return this.log({ ...base, status: 'FAILED', error: (error as Error).message });
    }
  }

  /** Dispara sem segurar a resposta da requisição */
  notifyInBackground(appointmentId: string, key: MessageTemplateKey) {
    this.notifyAppointment(appointmentId, key).catch((error) =>
      this.logger.error(`Falha inesperada ao notificar ${appointmentId}: ${(error as Error).message}`),
    );
  }

  async sendTest(rawPhone: string) {
    const phone = this.bridge.normalizePhone(rawPhone);
    const body = 'Teste do Studio 85: o WhatsApp está conectado e as mensagens automáticas vão funcionar.';
    if (!phone) return this.log({ phone: rawPhone, body, status: 'SKIPPED', error: 'Celular inválido.' });
    try {
      const sent = await this.bridge.sendText(phone, body);
      return this.log({ phone, body, status: 'SENT', externalId: sent.id });
    } catch (error) {
      return this.log({ phone, body, status: 'FAILED', error: (error as Error).message });
    }
  }

  listTemplates() {
    return this.prisma.messageTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  async updateTemplate(key: string, input: UpdateMessageTemplateInput) {
    const template = await this.prisma.messageTemplate.findUnique({ where: { key } });
    if (!template) throw new NotFoundException('Modelo de mensagem não encontrado.');
    return this.prisma.messageTemplate.update({
      where: { key },
      data: { body: input.body, isActive: input.isActive, attachPhotos: key === 'CAR_READY' ? input.attachPhotos : false },
    });
  }

  recentMessages(limit = 30) {
    return this.prisma.whatsAppMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: { appointment: { select: { readableCode: true, customerName: true } } },
    });
  }
}
