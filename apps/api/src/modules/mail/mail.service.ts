import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

/**
 * E-mails transacionais (código de verificação).
 * MAIL_DRIVER=mock só registra no log (desenvolvimento); MAIL_DRIVER=smtp envia de verdade,
 * por exemplo por uma caixa criada em Hostinger → E-mails (smtp.hostinger.com, porta 465).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

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

  /** Lança erro se o envio falhar; quem chama decide como avisar o usuário. */
  async sendVerificationCode(to: string, name: string, code: string): Promise<void> {
    if (this.driver === 'mock') {
      this.logger.log(`[E-MAIL SIMULADO] Código de verificação para ${to}: ${code}`);
      return;
    }

    const company = process.env.APP_NAME || 'Studio 85';
    const firstName = name.trim().split(/\s+/)[0] || name;
    const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER;
    const fromName = process.env.MAIL_FROM_NAME || company;

    await this.getTransporter().sendMail({
      from: { name: fromName, address: fromAddress! },
      to,
      subject: `${code} é o seu código de verificação — ${company}`,
      text: [
        `Olá, ${firstName}!`,
        '',
        `Seu código de verificação do ${company} é: ${code}`,
        '',
        'Ele vale por 15 minutos. Se você não pediu este cadastro, ignore este e-mail.',
      ].join('\n'),
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#18181b">
  <p>Olá, ${escapeHtml(firstName)}!</p>
  <p>Seu código de verificação do ${escapeHtml(company)} é:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
  <p>Ele vale por 15 minutos. Se você não pediu este cadastro, ignore este e-mail.</p>
</div>`,
    });
    this.logger.log(`E-mail de verificação enviado para ${to}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
