import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as path from 'path';
import { createTransport, Transporter } from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentEmailData, AppointmentEmailKind, EmailContent, LOGO_CID, ShopInfo, appointmentEmail, codeEmail } from './email-templates';

// apps/api/assets/email-logo.png (mesmo caminho a partir de src/ e de dist/)
const LOGO_PATH = path.resolve(__dirname, '../../../assets/email-logo.png');

export interface EmailPhoto {
  content: Buffer;
  mimeType: string;
}

/**
 * E-mails transacionais com o visual do Studio 85.
 * MAIL_DRIVER=mock só registra no log (desenvolvimento); MAIL_DRIVER=smtp envia de verdade,
 * por exemplo por uma caixa criada em Hostinger → E-mails (smtp.hostinger.com, porta 465).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private logo: Buffer | null | undefined;

  constructor(private prisma: PrismaService) {}

  get driver(): 'smtp' | 'mock' {
    return process.env.MAIL_DRIVER === 'smtp' ? 'smtp' : 'mock';
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const host = process.env.SMTP_HOST;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASSWORD;
      if (!host || !user || !pass) {
        throw new Error('SMTP não configurado: defina SMTP_HOST, SMTP_USER e SMTP_PASSWORD.');
      }
      const port = Number(process.env.SMTP_PORT) || 465;
      this.transporter = createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
        auth: { user, pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }

  private logoAttachment(): Attachment[] {
    if (this.logo === undefined) {
      try {
        this.logo = readFileSync(LOGO_PATH);
      } catch {
        this.logger.warn(`Logo do e-mail não encontrado em ${LOGO_PATH}; enviando sem imagem.`);
        this.logo = null;
      }
    }
    return this.logo ? [{ filename: 'studio85.png', content: this.logo, cid: LOGO_CID, contentType: 'image/png' }] : [];
  }

  async shopInfo(): Promise<ShopInfo> {
    const settings = await this.prisma.businessSettings.findFirst();
    const company = settings?.companyName || process.env.APP_NAME || 'Studio 85';
    const address = settings?.address || 'R. Amapá, 16 - Cavalhada, Porto Alegre - RS, 91740-460';
    const phone = (settings?.phone || '555192198686').replace(/\D/g, '');
    const local = phone.startsWith('55') ? phone.slice(2) : phone;
    const whatsappDisplay =
      local.length === 11
        ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
        : local.length === 10
          ? `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
          : phone;
    return {
      company,
      address,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${company}, ${address}`)}`,
      whatsappUrl: `https://wa.me/${phone}`,
      whatsappDisplay,
      appUrl: process.env.FRONTEND_URL || 'https://studio85poa.com.br',
    };
  }

  /** Lança erro se o envio falhar; quem chama decide como avisar o usuário. */
  async sendVerificationCode(to: string, name: string, code: string): Promise<void> {
    if (this.driver === 'mock') {
      this.logger.log(`[E-MAIL SIMULADO] Código de verificação para ${to}: ${code}`);
      return;
    }
    await this.send(to, codeEmail(await this.shopInfo(), 'verify', firstName(name), code), 'verificação');
  }

  async sendPasswordResetCode(to: string, name: string, code: string): Promise<void> {
    if (this.driver === 'mock') {
      this.logger.log(`[E-MAIL SIMULADO] Código de nova senha para ${to}: ${code}`);
      return;
    }
    await this.send(to, codeEmail(await this.shopInfo(), 'reset', firstName(name), code), 'nova senha');
  }

  /** Agendamento confirmado ou carro pronto (este com as fotos de depois, se houver) */
  async sendAppointmentEmail(
    to: string,
    kind: AppointmentEmailKind,
    data: Omit<AppointmentEmailData, 'photoCids'>,
    photos: EmailPhoto[] = [],
  ): Promise<void> {
    if (this.driver === 'mock') {
      this.logger.log(`[E-MAIL SIMULADO] ${kind} para ${to} (${data.code}, ${photos.length} foto(s))`);
      return;
    }
    const photoAttachments: Attachment[] = photos.map((photo, i) => ({
      filename: `foto-${i + 1}.${photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'}`,
      content: photo.content,
      contentType: photo.mimeType,
      cid: `foto${i + 1}@studio85`,
    }));
    const content = appointmentEmail(await this.shopInfo(), kind, {
      ...data,
      photoCids: photoAttachments.map((a) => a.cid!),
    });
    const label = { CAR_READY: 'carro pronto', APPOINTMENT_CONFIRMED: 'agendamento confirmado', APPOINTMENT_CANCELLED: 'agendamento desmarcado' }[kind];
    await this.send(to, content, label, photoAttachments);
  }

  private async send(to: string, content: EmailContent, label: string, extra: Attachment[] = []): Promise<void> {
    const company = process.env.APP_NAME || 'Studio 85';
    await this.getTransporter().sendMail({
      from: { name: process.env.MAIL_FROM_NAME || company, address: (process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER)! },
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      attachments: [...this.logoAttachment(), ...extra],
    });
    this.logger.log(`E-mail de ${label} enviado para ${to}`);
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
