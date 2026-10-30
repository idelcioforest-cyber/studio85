import { useState } from 'react';
import { FinanceNav } from '../components/FinanceNav';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, RotateCcw, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react';
import { Modal } from '../components/Modal';
import { RecipientForm, RecipientView } from '../components/RecipientForm';
import { api } from '../lib/api';
import { centsToInput, formatDateTime, formatPlate, formatPrice, parsePriceInput, todayISO } from '../lib/format';

interface RecipientState {
  configured: boolean;
  apiReady: boolean;
  fallbackToPlatform: boolean;
  missing: string[];
  platformFeePercent: number;
  recipient:
    | (RecipientView & {
        status: string | null;
        statusLabel: string;
        kyc: { url: string; qrCode: string | null; expiresAt: string } | null;
        kycExpired: boolean;
        lastError: string | null;
      })
    | null;
}

interface Summary {
  soldCents: number;
  refundedCents: number;
  netCents: number;
  platformCents: number;
  washerCents: number;
  pending: { count: number; cents: number };
  chargebacks: { count: number; cents: number };
}

interface OnlinePaymentRow {
  id: string;
  status: string;
  method: 'PIX' | 'CREDIT_CARD';
  amountCents: number;
  refundedCents: number;
  platformFeePercent: number;
  platformCents: number;
  washerCents: number;
  paidAt: string | null;
  createdAt: string;
  failureReason: string | null;
  card: { brand: string | null; last4: string } | null;
  appointment: { code: string; customerName: string; vehicleLabel: string; vehiclePlate: string | null; startsAt: string } | null;
}

interface WebhookEvent {
  id: string;
  eventId: string;
  type: string;
  resourceId: string | null;
  attempts: number;
  processedAt: string | null;
  error: string | null;
  createdAt: string;
}

const statusText: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Aguardando', tone: 'border-warning/30 bg-warning/10 text-warning' },
  PAID: { label: 'Pago', tone: 'border-success/30 bg-success/10 text-success' },
  PARTIALLY_REFUNDED: { label: 'Estorno parcial', tone: 'border-info/30 bg-info/10 text-info' },
  REFUNDED: { label: 'Estornado', tone: 'border-line-strong bg-subtle text-ink-muted' },
  FAILED: { label: 'Recusado', tone: 'border-danger/30 bg-danger/10 text-danger' },
  EXPIRED: { label: 'Pix expirado', tone: 'border-line-strong bg-subtle text-ink-muted' },
  DISPUTED: { label: 'Chargeback', tone: 'border-danger/30 bg-danger/10 text-danger' },
};

const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;

export default function AdminPagamentosPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'summary' | 'payments' | 'recipient' | 'events'>('summary');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [notice, setNotice] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<OnlinePaymentRow | null>(null);

  // Pagamentos confirmados pelo webhook aparecem sozinhos enquanto a tela está aberta
  const recipientQuery = useQuery({
    queryKey: ['admin', 'payments', 'recipient'],
    queryFn: () => api<RecipientState>('/admin/payments/recipient'),
    refetchInterval: 60_000,
  });
  const summary = useQuery({
    queryKey: ['admin', 'payments', 'summary', from, to],
    queryFn: () => api<Summary>(`/admin/payments/summary?from=${from}&to=${to}`),
    refetchInterval: 20_000,
  });
  const list = useQuery({
    queryKey: ['admin', 'payments', 'list', from, to],
    queryFn: () => api<OnlinePaymentRow[]>(`/admin/payments?from=${from}&to=${to}`),
    enabled: tab === 'payments',
    refetchInterval: 20_000,
  });
  const events = useQuery({
    queryKey: ['admin', 'payments', 'events'],
    queryFn: () => api<WebhookEvent[]>('/admin/payments/webhook-events'),
    enabled: tab === 'events',
    refetchInterval: 20_000,
  });

  const refresh = useMutation({
    mutationFn: () => api<RecipientState>('/admin/payments/recipient/refresh', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(['admin', 'payments', 'recipient'], data),
  });
  const kyc = useMutation({
    mutationFn: () => api<RecipientState>('/admin/payments/recipient/kyc-link', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(['admin', 'payments', 'recipient'], data),
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => api(`/admin/payments/webhook-events/${id}/reprocess`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] }),
  });

  const state = recipientQuery.data;
  const r = state?.recipient ?? null;

  return (
    <div className="animate-fadeIn mx-auto max-w-5xl space-y-6">
      <FinanceNav />
      <header>
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Pagamentos online</h1>
          <p className="mt-1 text-sm text-ink-muted">Pix e cartão pelo app, via Pagar.me, com a parte do lava-jato separada automaticamente.</p>
        </div>
      </header>

      <RecipientBanner state={state} loading={recipientQuery.isLoading} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
      {refresh.error && <Alert tone="danger">{refresh.error.message}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-subtle p-1" role="tablist" aria-label="Seções de pagamentos">
        {(
          [
            ['summary', 'Resumo'],
            ['payments', 'Pagamentos'],
            ['recipient', 'Recebedor'],
            ['events', 'Eventos'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === 'summary' || tab === 'payments') && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="pay-from" className="label">De</label>
            <input id="pay-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="field" />
          </div>
          <div>
            <label htmlFor="pay-to" className="label">Até</label>
            <input id="pay-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="field" />
          </div>
        </div>
      )}

      {tab === 'summary' && summary.data && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ['Vendido online', formatPrice(summary.data.soldCents)],
            ['Estornado', formatPrice(summary.data.refundedCents)],
            ['Líquido', formatPrice(summary.data.netCents)],
            ['Lava-jato', formatPrice(summary.data.washerCents)],
            [`Comissão da plataforma`, formatPrice(summary.data.platformCents)],
            ['Aguardando pagamento', `${summary.data.pending.count} · ${formatPrice(summary.data.pending.cents)}`],
            ['Chargebacks', `${summary.data.chargebacks.count} · ${formatPrice(summary.data.chargebacks.cents)}`],
          ].map(([label, value]) => (
            <div key={label} className="card p-4">
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</dt>
              <dd className="mt-1 text-lg font-extrabold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {tab === 'payments' &&
        (list.isLoading ? (
          <p className="py-10 text-center text-sm text-ink-muted">Carregando…</p>
        ) : !list.data?.length ? (
          <p className="card p-10 text-center text-sm text-ink-muted">Nenhum pagamento online neste período.</p>
        ) : (
          <ul className="space-y-3">
            {list.data.map((p) => {
              const s = statusText[p.status] ?? { label: p.status, tone: 'border-line bg-subtle text-ink-muted' };
              const when = formatDateTime(p.paidAt ?? p.createdAt);
              const canRefund = ['PAID', 'PARTIALLY_REFUNDED'].includes(p.status);
              return (
                <li key={p.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${s.tone}`}>{s.label}</span>
                      <span className="text-sm font-semibold text-ink">
                        {p.method === 'PIX' ? 'Pix' : `Cartão${p.card ? ` ${p.card.brand ?? ''} final ${p.card.last4}` : ''}`}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {when.date} · {when.time}
                      </span>
                    </div>
                    {p.appointment && (
                      <p className="text-sm text-ink-muted">
                        <span className="font-mono">{p.appointment.code}</span> · {p.appointment.customerName} · {p.appointment.vehicleLabel}{' '}
                        <span className="font-mono">{formatPlate(p.appointment.vehiclePlate)}</span>
                      </p>
                    )}
                    {['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'].includes(p.status) && (
                      <p className="text-xs text-ink-muted">
                        Lava-jato {formatPrice(p.washerCents)} · comissão {formatPrice(p.platformCents)} ({p.platformFeePercent}%)
                        {p.refundedCents > 0 && ` · estornado ${formatPrice(p.refundedCents)}`}
                      </p>
                    )}
                    {p.failureReason && <p className="text-xs text-danger">{p.failureReason}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                    <p className="text-lg font-extrabold text-ink">{formatPrice(p.amountCents)}</p>
                    {canRefund && (
                      <button type="button" onClick={() => setRefunding(p)} className="btn-secondary px-3 py-2">
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Estornar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {tab === 'recipient' && state && (
        <section className="space-y-6">
          {r?.pagarmeRecipientId && r.status !== 'active' && (
            <div className="card space-y-3 p-5">
              <h2 className="text-lg font-bold text-ink">Verificação de identidade</h2>
              <p className="text-sm text-ink">
                Faça a verificação de identidade (selfie + documento) para liberar seus recebimentos.
              </p>
              {r.kyc ? (
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  {r.kyc.qrCode && (
                    <img
                      src={r.kyc.qrCode.startsWith('data:') ? r.kyc.qrCode : `data:image/png;base64,${r.kyc.qrCode}`}
                      alt="QR code da verificação de identidade"
                      width={160}
                      height={160}
                      className="rounded-xl bg-white p-2"
                    />
                  )}
                  <div className="space-y-2">
                    <a href={r.kyc.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Abrir verificação
                    </a>
                    <p className="text-xs text-ink-muted">Válido até {formatDateTime(r.kyc.expiresAt).date} às {formatDateTime(r.kyc.expiresAt).time}.</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">{r.kycExpired ? 'O link expirou.' : 'Ainda não há link de verificação.'}</p>
              )}
              <button type="button" onClick={() => kyc.mutate()} disabled={kyc.isPending} className="btn-secondary">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {kyc.isPending ? 'Gerando…' : 'Gerar novo link'}
              </button>
              {kyc.error && <Alert tone="danger">{kyc.error.message}</Alert>}
            </div>
          )}
          {r?.lastError && <Alert tone="danger">Último erro do Pagar.me: {r.lastError}</Alert>}
          <div className="card p-5 sm:p-6">
            <RecipientForm
              key={r?.pagarmeRecipientId ?? 'novo'}
              recipient={r}
              onSaved={(message) => {
                setNotice(message);
                queryClient.invalidateQueries({ queryKey: ['admin', 'payments', 'recipient'] });
              }}
            />
          </div>
        </section>
      )}

      {tab === 'events' &&
        (events.isLoading ? (
          <p className="py-10 text-center text-sm text-ink-muted">Carregando…</p>
        ) : !events.data?.length ? (
          <p className="card p-10 text-center text-sm text-ink-muted">Nenhum evento do Pagar.me ainda.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {events.data.map((e) => {
              const when = formatDateTime(e.createdAt);
              return (
                <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {e.type} <span className="font-mono text-xs text-ink-muted">{e.resourceId}</span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      {when.date} · {when.time} · {e.processedAt ? 'processado' : e.error ? `falhou (${e.attempts} tentativa(s))` : 'na fila'}
                    </p>
                    {e.error && <p className="break-words text-xs text-danger">{e.error}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={reprocess.isPending && reprocess.variables === e.id}
                    onClick={() => reprocess.mutate(e.id)}
                    className="btn-secondary self-start px-3 py-2 sm:self-auto"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Reprocessar
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

      <RefundModal payment={refunding} onClose={() => setRefunding(null)} onDone={(m) => setNotice(m)} />
    </div>
  );
}

const MISSING_LABELS: Record<string, string> = {
  PAGARME_SECRET_KEY: 'a chave secreta do Pagar.me',
  PAGARME_PUBLIC_KEY: 'a chave pública do Pagar.me',
  PAGARME_PLATFORM_RECIPIENT_ID: 'o recebedor da plataforma',
};

function RecipientBanner({ state, loading, onRefresh, refreshing }: { state?: RecipientState; loading: boolean; onRefresh: () => void; refreshing: boolean }) {
  if (loading || !state) return null;
  const r = state.recipient;
  let tone: 'success' | 'warning' = 'warning';
  let text: string;
  const missing = state.missing.map((name) => MISSING_LABELS[name] ?? name).join(', ');
  if (!state.apiReady) {
    text = `Pagamento online desligado: falta configurar no servidor ${missing}.`;
  } else if (state.fallbackToPlatform && state.configured && r?.status !== 'active') {
    text =
      'Modo temporário: os clientes já podem pagar pelo app, mas o valor cai inteiro na conta da plataforma. Cadastre o recebedor do lava-jato (aba Recebedor) para ativar a divisão.';
  } else if (!r?.pagarmeRecipientId) {
    text = 'Cadastre o recebedor do lava-jato (aba Recebedor) para liberar o pagamento online.';
  } else if (r.status !== 'active') {
    text = `Recebedor ${r.statusLabel.toLowerCase()}: o pagamento online só abre quando ficar "Liberado". Faça a verificação de identidade na aba Recebedor.`;
  } else if (!state.configured) {
    text = `Recebedor liberado, mas o pagamento online segue desligado: falta configurar no servidor ${missing}.`;
  } else {
    tone = 'success';
    text = `Recebedor liberado: os clientes já podem pagar pelo app. Comissão da plataforma: ${state.platformFeePercent}%.`;
  }
  const Icon = tone === 'success' ? ShieldCheck : AlertTriangle;
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        tone === 'success' ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10'
      }`}
      role="status"
    >
      <p className={`flex items-start gap-2 text-sm font-semibold ${tone === 'success' ? 'text-success' : 'text-warning'}`}>
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </p>
      {state.apiReady && r?.pagarmeRecipientId && (
        <button type="button" onClick={onRefresh} disabled={refreshing} className="btn-secondary flex-shrink-0 px-3 py-2">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {refreshing ? 'Consultando…' : 'Atualizar status'}
        </button>
      )}
    </div>
  );
}

function RefundModal({ payment, onClose, onDone }: { payment: OnlinePaymentRow | null; onClose: () => void; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const remaining = payment ? payment.amountCents - payment.refundedCents : 0;
  const cents = parsePriceInput(value);

  const refund = useMutation({
    mutationFn: () =>
      api<{ message: string }>(`/admin/payments/${payment!.id}/refund`, {
        method: 'POST',
        body: { amountCents: cents !== null && cents < remaining ? cents : undefined, reason: reason.trim() || undefined },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      onDone(res.message);
      onClose();
    },
  });

  if (!payment) return null;
  const invalid = cents === null || cents <= 0 || cents > remaining;
  return (
    <Modal open onClose={onClose} title="Estornar pagamento" description="O dinheiro volta para o cliente pelo mesmo meio de pagamento.">
      <form
        key={payment.id}
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid && window.confirm(`Confirmar estorno de ${formatPrice(cents!)}? Isso não pode ser desfeito.`)) refund.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-ink">
          {payment.appointment?.customerName} · pago {formatPrice(payment.amountCents)}
          {payment.refundedCents > 0 && ` · já estornado ${formatPrice(payment.refundedCents)}`}
        </p>
        <div>
          <label htmlFor="refund-value" className="label">Valor a estornar (R$)</label>
          <input
            id="refund-value"
            inputMode="decimal"
            value={value}
            placeholder={centsToInput(remaining)}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => !value && setValue(centsToInput(remaining))}
            aria-describedby="refund-help"
            className="field"
          />
          <p id="refund-help" className="mt-1 text-xs text-ink-muted">
            Até {formatPrice(remaining)}. O Pagar.me desfaz o split na mesma proporção (a comissão desse valor também volta).
          </p>
        </div>
        <div>
          <label htmlFor="refund-reason" className="label">Motivo (opcional)</label>
          <input id="refund-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="field" />
        </div>
        {refund.error && <Alert tone="danger">{refund.error.message}</Alert>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Voltar
          </button>
          <button type="submit" disabled={invalid || refund.isPending} className="btn-primary">
            {refund.isPending ? 'Estornando…' : cents !== null && cents > 0 ? `Estornar ${formatPrice(cents)}` : 'Estornar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Alert({ tone, children }: { tone: 'danger' | 'success'; children: React.ReactNode }) {
  return (
    <p
      className={`rounded-xl border p-3 text-sm ${tone === 'danger' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success'}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}
