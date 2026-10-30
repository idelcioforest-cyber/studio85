import { Injectable, Logger } from '@nestjs/common';
import { pagarmeConfig } from './pagarme.config';

export class PagarmeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// Respostas da API v5 (só os campos que o sistema usa)
export interface PagarmeTransaction {
  id?: string;
  status?: string;
  qr_code?: string;
  qr_code_url?: string;
  expires_at?: string;
  acquirer_message?: string;
  gateway_response?: { code?: string; errors?: { message?: string }[] };
  card?: { brand?: string; last_four_digits?: string };
}
export interface PagarmeCharge {
  id: string;
  status: string; // pending, paid, canceled, processing, failed, overpaid, underpaid, chargedback
  amount: number;
  paid_amount?: number;
  canceled_amount?: number;
  paid_at?: string;
  payment_method?: string;
  order?: { id: string; metadata?: Record<string, string> };
  metadata?: Record<string, string>;
  last_transaction?: PagarmeTransaction;
}
export interface PagarmeOrder {
  id: string;
  code?: string;
  status: string; // pending, paid, canceled, failed
  amount: number;
  metadata?: Record<string, string>;
  charges?: PagarmeCharge[];
}
export interface PagarmeRecipient {
  id: string;
  status: string;
  code?: string;
  metadata?: Record<string, string>;
  kyc_details?: { status?: string; status_reason?: string };
}
export interface PagarmeKycLink {
  url: string;
  base64_qrcode?: string;
  expires_at?: string;
}

const RETRY_DELAYS_MS = [0, 300, 600];

/**
 * Cliente HTTP da API v5 do Pagar.me: Basic Auth com a sk_, JSON, 20s de limite e até 2 novas
 * tentativas em falha de rede, 429 ou 5xx. Os erros são registrados com status e corpo, nunca com a chave.
 */
@Injectable()
export class PagarmeClient {
  private readonly logger = new Logger(PagarmeClient.name);

  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    if (!pagarmeConfig.secretKey) throw new PagarmeError('Pagar.me não configurado (PAGARME_SECRET_KEY).', 503);
    const auth = Buffer.from(`${pagarmeConfig.secretKey}:`).toString('base64');
    let lastError: unknown;

    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const response = await fetch(`${pagarmeConfig.baseUrl}${path}`, {
          method,
          headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
        const text = await response.text();
        const data = text ? safeJson(text) : null;
        if (response.ok) return data as T;

        this.logger.warn(`Pagar.me ${method} ${path} → ${response.status}: ${text.slice(0, 1500)}`);
        const error = new PagarmeError(errorMessage(data, response.status), response.status, data);
        if (response.status === 429 || response.status >= 500) {
          lastError = error;
          continue;
        }
        throw error;
      } catch (error) {
        if (error instanceof PagarmeError && error.status < 500 && error.status !== 429) throw error;
        lastError = error;
        if (!(error instanceof PagarmeError)) this.logger.warn(`Pagar.me ${method} ${path}: falha de rede (${(error as Error).message})`);
      }
    }
    throw lastError instanceof PagarmeError ? lastError : new PagarmeError('Não foi possível falar com o Pagar.me agora.', 503);
  }

  createRecipient(body: unknown) {
    return this.request<PagarmeRecipient>('POST', '/recipients', body);
  }
  getRecipient(id: string) {
    return this.request<PagarmeRecipient>('GET', `/recipients/${encodeURIComponent(id)}`);
  }
  updateRecipientBankAccount(id: string, bankAccount: unknown) {
    return this.request<unknown>('PATCH', `/recipients/${encodeURIComponent(id)}/default-bank-account`, { bank_account: bankAccount });
  }
  createKycLink(id: string) {
    return this.request<PagarmeKycLink>('POST', `/recipients/${encodeURIComponent(id)}/kyc_link`);
  }
  createOrder(body: unknown) {
    return this.request<PagarmeOrder>('POST', '/orders', body);
  }
  getOrder(id: string) {
    return this.request<PagarmeOrder>('GET', `/orders/${encodeURIComponent(id)}`);
  }
  getCharge(id: string) {
    return this.request<PagarmeCharge>('GET', `/charges/${encodeURIComponent(id)}`);
  }
  /** Estorno total (sem valor) ou parcial (amount em centavos) */
  cancelCharge(id: string, amount?: number) {
    return this.request<PagarmeCharge>('DELETE', `/charges/${encodeURIComponent(id)}`, amount ? { amount } : undefined);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function errorMessage(data: unknown, status: number): string {
  const body = data as { message?: string; errors?: Record<string, string[]> } | null;
  const details = body?.errors
    ? Object.entries(body.errors)
        .map(([field, msgs]) => `${field}: ${(msgs || []).join(', ')}`)
        .join('; ')
    : '';
  const base = body?.message || `Erro ${status} no Pagar.me`;
  return details ? `${base} (${details})` : base;
}
