import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Cliente da ponte de WhatsApp (services/whatsapp-bridge, Baileys).
 * Só a API conversa com a ponte; o navegador nunca recebe a chave dela.
 */
@Injectable()
export class WhatsAppBridgeService {
  private readonly logger = new Logger(WhatsAppBridgeService.name);

  constructor(private prisma: PrismaService) {}

  get enabled(): boolean {
    return process.env.WHATSAPP_ENABLED === 'true';
  }

  get configured(): boolean {
    return Boolean(process.env.WHATSAPP_BRIDGE_URL && (process.env.WHATSAPP_BRIDGE_TOKEN || '').length >= 32);
  }

  get instance(): string {
    return process.env.WHATSAPP_INSTANCE || 'studio85';
  }

  /**
   * Celular brasileiro no formato 55 + DDD + número. Aceita com ou sem DDI (inclusive DDD 55);
   * o nono dígito é conferido pela ponte direto no WhatsApp.
   */
  normalizePhone(raw: string | null | undefined): string | null {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
    return null;
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 20000): Promise<T> {
    if (!this.configured) {
      throw new WhatsAppSendError('A ponte de WhatsApp não está configurada no servidor.', false);
    }

    let response: Response;
    try {
      response = await fetch(`${process.env.WHATSAPP_BRIDGE_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: process.env.WHATSAPP_BRIDGE_TOKEN as string },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new WhatsAppSendError('Não foi possível falar com a ponte de WhatsApp.', true);
    }

    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      // 409 = número desconectado, 4xx = número inválido/sem WhatsApp: não adianta tentar de novo
      throw new WhatsAppSendError(data?.error || `Erro ${response.status} na ponte de WhatsApp.`, response.status >= 500);
    }
    return data;
  }

  private async saveStatus(state: 'open' | 'close' | 'connecting') {
    const status = state === 'open' ? 'CONNECTED' : state === 'connecting' ? 'CONNECTING' : 'DISCONNECTED';
    const settings = await this.prisma.businessSettings.findFirst({ select: { id: true } });
    if (settings) {
      await this.prisma.businessSettings.update({
        where: { id: settings.id },
        data: { whatsappStatus: status, whatsappStatusAt: new Date() },
      });
    }
    return status;
  }

  async getStatus() {
    if (!this.configured) {
      return { enabled: this.enabled, configured: false, status: 'DISCONNECTED' as const, phone: null };
    }
    try {
      const data = await this.request<{ instance: { state: 'open' | 'close' | 'connecting'; phone?: string | null } }>(
        'GET',
        `/instance/connectionState/${this.instance}`,
        undefined,
        8000,
      );
      const status = await this.saveStatus(data.instance.state);
      return { enabled: this.enabled, configured: true, status, phone: data.instance.phone ?? null };
    } catch (error) {
      this.logger.warn(`Ponte de WhatsApp indisponível: ${(error as Error).message}`);
      return { enabled: this.enabled, configured: true, status: 'UNREACHABLE' as const, phone: null };
    }
  }

  /**
   * Inicia o pareamento do número e devolve o QR code (data URL) para escanear no celular
   */
  async connect() {
    if (!this.configured) {
      throw new ServiceUnavailableException('Configure WHATSAPP_BRIDGE_URL e WHATSAPP_BRIDGE_TOKEN no servidor.');
    }
    try {
      const data = await this.request<{ instance: { state: string }; qrcode: { base64: string | null } }>(
        'POST',
        '/instance/create',
        { instanceName: this.instance },
        25000,
      );
      if (data.instance.state === 'open') await this.saveStatus('open');
      else await this.saveStatus('connecting');
      return { qr: data.qrcode.base64, status: data.instance.state === 'open' ? 'CONNECTED' : 'CONNECTING' };
    } catch (error) {
      throw new ServiceUnavailableException((error as Error).message);
    }
  }

  async getQr() {
    try {
      const data = await this.request<{ base64: string | null; state: 'open' | 'close' | 'connecting' }>(
        'GET',
        `/instance/connect/${this.instance}`,
        undefined,
        8000,
      );
      const status = data.state === 'open' ? await this.saveStatus('open') : 'CONNECTING';
      return { qr: data.base64, status };
    } catch (error) {
      throw new ServiceUnavailableException((error as Error).message);
    }
  }

  async disconnect() {
    try {
      await this.request('DELETE', `/instance/delete/${this.instance}`);
    } catch (error) {
      throw new ServiceUnavailableException((error as Error).message);
    }
    await this.saveStatus('close');
    return { success: true, message: 'Número desconectado.' };
  }

  async handleConnectionUpdate(state: string) {
    if (state === 'open' || state === 'close' || state === 'connecting') await this.saveStatus(state);
  }

  async sendText(phone: string, text: string) {
    return this.request<{ id: string | null }>('POST', `/message/sendText/${this.instance}`, { number: phone, text });
  }

  async sendImage(phone: string, image: Buffer, mimetype: string, caption?: string) {
    return this.request<{ id: string | null }>(
      'POST',
      `/message/sendMedia/${this.instance}`,
      { number: phone, mediatype: 'image', mimetype, media: image.toString('base64'), caption },
      45000,
    );
  }
}
