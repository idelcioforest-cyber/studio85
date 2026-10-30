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
  sendVerificationCode(to: string, name: string, code: string): Promise<void> {
    return this.sendCode(to, name, code, {
      kind: 'verificação',
      purpose: 'código de verificação',
      ignoreNote: 'Se você não pediu este cadastro, ignore este e-mail.',
    });
  }

  sendPasswordResetCode(to: string, name: string, code: string): Promise<void> {
    return this.sendCode(to, name, code, {
      kind: 'redefinição de senha',
      purpose: 'código para criar uma nova senha',
      ignoreNote: 'Se você não pediu para trocar a senha, ignore este e-mail: sua senha atual continua valendo.',
    });
  }

  private async sendCode(
    to: string,
    name: string,
    code: string,
    copy: { kind: string; purpose: string; ignoreNote: string },
  ): Promise<void> {
    if (this.driver === 'mock') {
      this.logger.log(`[E-MAIL SIMULADO] Código de ${copy.kind} para ${to}: ${code}`);
      return;
    }

    const company = process.env.APP_NAME || 'Studio 85';
    const firstName = name.trim().split(/\s+/)[0] || name;
    const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER;
    const fromName = process.env.MAIL_FROM_NAME || company;

    await this.getTransporter().sendMail({
      from: { name: fromName, address: fromAddress! },
      to,
      subject: `${code} é o seu ${copy.purpose} — ${company}`,
      text: [
        `Olá, ${firstName}!`,
        '',
        `Seu ${copy.purpose} do ${company} é: ${code}`,
        '',
        `Ele vale por 15 minutos. ${copy.ignoreNote}`,
      ].join('\n'),
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#18181b">
  <p>Olá, ${escapeHtml(firstName)}!</p>
  <p>Seu ${escapeHtml(copy.purpose)} do ${escapeHtml(company)} é:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
  <p>Ele vale por 15 minutos. ${escapeHtml(copy.ignoreNote)}</p>
</div>`,
    });
    this.logger.log(`E-mail de ${copy.kind} enviado para ${to}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
