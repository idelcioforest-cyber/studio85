import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, CreditCard, QrCode } from 'lucide-react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { Appointment } from '../lib/types';

export interface OnlineConfig {
  enabled: boolean;
  publicKey: string | null;
  maxInstallments: number;
}

interface OnlinePayment {
  id: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'DISPUTED';
  method: 'PIX' | 'CREDIT_CARD';
  amountCents: number;
  failureReason: string | null;
  card: { brand: string | null; last4: string } | null;
  pix: { qrCode: string; qrCodeImage: string; expiresAt: string } | null;
}

/** Pagamento online disponível? (Pagar.me configurado e recebedor do lava-jato liberado) */
export function useOnlinePayment() {
  return useQuery({
    queryKey: ['payments-online-config'],
    queryFn: () => api<OnlineConfig>('/payments/online/config'),
    staleTime: 60_000,
  });
}

/** O número do cartão vai direto para o Pagar.me; o nosso servidor só recebe o token */
async function tokenizeCard(publicKey: string, card: { number: string; holder: string; expiry: string; cvv: string }) {
  const [month, year] = card.expiry.split('/').map((v) => v.trim());
  const response = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'card',
      card: {
        number: card.number.replace(/\D/g, ''),
        holder_name: card.holder.trim(),
        exp_month: Number(month),
        exp_year: Number(year?.length === 2 ? `20${year}` : year),
        cvv: card.cvv.replace(/\D/g, ''),
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error('Confira os dados do cartão e tente de novo.');
  return data.id as string;
}

function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PayOnlineModal({ appointment, config, onClose }: { appointment: Appointment | null; config: OnlineConfig | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [payment, setPayment] = useState<OnlinePayment | null>(null);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  const [card, setCard] = useState({ number: '', holder: '', expiry: '', cvv: '', installments: 1 });

  useEffect(() => {
    setTab('PIX');
    setPayment(null);
    setCopied(false);
    setCard({ number: '', holder: '', expiry: '', cvv: '', installments: 1 });
  }, [appointment?.id]);

  const pix = useMutation({
    mutationFn: () => api<OnlinePayment>(`/appointments/${appointment!.id}/payments/pix`, { method: 'POST' }),
    onSuccess: setPayment,
  });

  const payCard = useMutation({
    mutationFn: async () => {
      const cardToken = await tokenizeCard(config!.publicKey!, card);
      return api<OnlinePayment>(`/appointments/${appointment!.id}/payments/card`, {
        method: 'POST',
        body: { cardToken, installments: card.installments },
      });
    },
    onSuccess: setPayment,
  });

  // Acompanha o Pix a cada 5 s até ser pago ou expirar
  const pixPending = payment?.method === 'PIX' && payment.status === 'PENDING';
  useEffect(() => {
    if (!pixPending || !payment) return;
    const poll = setInterval(async () => {
      try {
        const next = await api<OnlinePayment>(`/payments/${payment.id}`);
        setPayment(next);
      } catch {
        // tenta de novo no próximo ciclo
      }
    }, 5000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [pixPending, payment?.id]);

  useEffect(() => {
    if (payment?.status === 'PAID') {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    }
  }, [payment?.status, queryClient]);

  if (!appointment) return null;
  const total = formatPrice(appointment.totalPriceCents);

  if (payment?.status === 'PAID') {
    return (
      <Modal open onClose={onClose} title="Pagamento confirmado">
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden="true" />
          <p className="text-sm text-ink" role="status">
            Recebemos {formatPrice(payment.amountCents)}
            {payment.card ? ` no cartão final ${payment.card.last4}` : ' pelo Pix'}. É só levar o carro no horário marcado.
          </p>
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  const failed = payment && ['FAILED', 'EXPIRED'].includes(payment.status);
  const error = pix.error || payCard.error;

  return (
    <Modal open onClose={onClose} title="Pagar agora" description={`Total de ${total}. Se preferir, você também pode pagar na loja.`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Forma de pagamento">
          {(
            [
              ['PIX', 'Pix', QrCode],
              ['CREDIT_CARD', 'Cartão de crédito', CreditCard],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                setPayment(null);
                pix.reset();
                payCard.reset();
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                tab === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {error.message}
          </p>
        )}
        {failed && (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="alert">
            {payment!.status === 'EXPIRED' ? 'O Pix expirou. Gere um novo para pagar.' : payment!.failureReason || 'Pagamento não aprovado.'}
          </p>
        )}

        {tab === 'PIX' &&
          (payment?.pix ? (
            <div className="space-y-3 text-center">
              <img src={payment.pix.qrCodeImage} alt="QR code do Pix" width={240} height={240} className="mx-auto rounded-xl bg-white p-2" />
              <p className="text-sm text-ink-muted">
                Abra o app do banco, escolha <strong className="text-ink">Pix → Ler QR code</strong> ou use o copia e cola.
              </p>
              <div className="flex items-stretch gap-2">
                <label htmlFor="pix-code" className="sr-only">
                  Código Pix copia e cola
                </label>
                <input id="pix-code" readOnly value={payment.pix.qrCode} onFocus={(e) => e.target.select()} className="field min-w-0 flex-1 font-mono text-xs" />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(payment.pix!.qrCode).catch(() => undefined);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                  className="btn-secondary px-3"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-xs text-ink-muted" aria-live="polite">
                Aguardando o pagamento… expira em {remaining(payment.pix.expiresAt)}. Esta tela atualiza sozinha.
              </p>
            </div>
          ) : (
            <button type="button" onClick={() => pix.mutate()} disabled={pix.isPending} className="btn-primary w-full">
              <QrCode className="h-4 w-4" aria-hidden="true" />
              {pix.isPending ? 'Gerando Pix…' : `Gerar Pix de ${total}`}
            </button>
          ))}

        {tab === 'CREDIT_CARD' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              payCard.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <label htmlFor="card-number" className="label">Número do cartão</label>
              <input
                id="card-number"
                inputMode="numeric"
                autoComplete="cc-number"
                required
                value={card.number}
                onChange={(e) => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '').slice(0, 23) })}
                className="field font-mono"
              />
            </div>
            <div>
              <label htmlFor="card-holder" className="label">Nome impresso no cartão</label>
              <input
                id="card-holder"
                autoComplete="cc-name"
                required
                value={card.holder}
                onChange={(e) => setCard({ ...card, holder: e.target.value })}
                className="field"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="card-expiry" className="label">Validade (MM/AA)</label>
                <input
                  id="card-expiry"
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="08/29"
                  required
                  value={card.expiry}
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCard({ ...card, expiry: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d });
                  }}
                  className="field font-mono"
                />
              </div>
              <div>
                <label htmlFor="card-cvv" className="label">CVV</label>
                <input
                  id="card-cvv"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  required
                  value={card.cvv}
                  onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className="field font-mono"
                />
              </div>
            </div>
            {(config?.maxInstallments ?? 1) > 1 && (
              <div>
                <label htmlFor="card-installments" className="label">Parcelas</label>
                <select
                  id="card-installments"
                  value={card.installments}
                  onChange={(e) => setCard({ ...card, installments: Number(e.target.value) })}
                  className="field"
                >
                  {Array.from({ length: config!.maxInstallments }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}x de {formatPrice(Math.ceil(appointment.totalPriceCents / n))}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-ink-muted">Os dados do cartão vão direto para o Pagar.me, com segurança. O Studio 85 não guarda o número.</p>
            <button type="submit" disabled={payCard.isPending} className="btn-primary w-full">
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              {payCard.isPending ? 'Processando…' : `Pagar ${total}`}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
