import { useState } from 'react';
import { FinanceNav } from '../components/FinanceNav';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, FileText, Paperclip } from 'lucide-react';
import { PaymentModal, validateReceipt } from '../components/PaymentModal';
import { api, uploadFile, RECEIPT_ACCEPT } from '../lib/api';
import { adjustmentLabel, formatDateLong, formatDateTime, formatPlate, formatPrice, todayISO } from '../lib/format';
import { Appointment, PaymentMethod, paymentMethodLabels, statusBadge, statusLabels } from '../lib/types';

interface CashSummary {
  date: string;
  totals: { receivedCents: number; pendingCents: number; discountCents: number; byMethod: Record<PaymentMethod, number> };
  received: Appointment[];
  pending: Appointment[];
}

function matches(a: Appointment, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  const plate = term.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return (
    a.customerName.toLowerCase().includes(t) ||
    a.vehicleLabel.toLowerCase().includes(t) ||
    a.code.toLowerCase().includes(t) ||
    (plate.length > 0 && (a.vehiclePlate ?? '').includes(plate))
  );
}

export default function AdminFinanceiroPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState<'pending' | 'received'>('pending');
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState<Appointment | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'cash', date],
    queryFn: () => api<CashSummary>(`/admin/cash?date=${date}`),
    refetchInterval: 20_000,
  });

  const unpay = useMutation({
    mutationFn: (id: string) => api(`/admin/appointments/${id}/pay`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });

  const pending = (data?.pending ?? []).filter((a) => matches(a, search.trim()));
  const received = (data?.received ?? []).filter((a) => matches(a, search.trim()));
  const totals = data?.totals;

  const metrics = totals
    ? [
        { label: 'Recebido', value: totals.receivedCents },
        { label: 'Pix', value: totals.byMethod.PIX },
        { label: 'Cartões', value: totals.byMethod.CREDIT_CARD + totals.byMethod.DEBIT_CARD },
        { label: 'Dinheiro', value: totals.byMethod.CASH },
        { label: 'A receber', value: totals.pendingCents },
        { label: 'Descontos', value: totals.discountCents },
      ]
    : [];

  return (
    <div className="animate-fadeIn mx-auto max-w-5xl space-y-6">
      <FinanceNav />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Caixa</h1>
          <p className="mt-1 text-sm capitalize text-ink-muted">{formatDateLong(date)}</p>
        </div>
        <div>
          <label htmlFor="cash-date" className="label">Dia</label>
          <input id="cash-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="field" />
        </div>
      </header>

      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar o caixa.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{m.label}</dt>
            <dd className="mt-1 text-xl font-extrabold text-ink">{formatPrice(m.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 sm:inline-grid" role="tablist" aria-label="Lançamentos">
          {(
            [
              ['pending', `A receber (${data?.pending.length ?? 0})`],
              ['received', `Recebidos (${data?.received.length ?? 0})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <label htmlFor="cash-search" className="sr-only">Buscar por placa, cliente ou código</label>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" aria-hidden="true" />
          <input
            id="cash-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Placa, cliente ou código"
            className="field pl-9"
          />
        </div>
      </div>

      {unpay.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {unpay.error.message}
        </p>
      )}

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando caixa…</p>}

      {!isLoading && tab === 'pending' && (
        pending.length === 0 ? (
          <p className="card p-10 text-center text-sm text-ink-muted">
            {search ? 'Nenhum atendimento encontrado.' : 'Nenhum atendimento a receber neste dia.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <li key={a.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <CarSummary appointment={a} />
                <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadge[a.status]}`}>
                    {statusLabels[a.status]}
                  </span>
                  <span className="text-xl font-extrabold text-ink">{formatPrice(a.totalPriceCents)}</span>
                  <button type="button" onClick={() => setPaying(a)} className="btn-primary px-4 py-2">
                    Receber
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      )}

      {!isLoading && tab === 'received' && (
        received.length === 0 ? (
          <p className="card p-10 text-center text-sm text-ink-muted">Nenhum recebimento neste dia.</p>
        ) : (
          <ul className="space-y-3">
            {received.map((a) => {
              if (a.payment.status !== 'PAID') return null;
              const paidAt = formatDateTime(a.payment.paidAt);
              return (
                <li key={a.id} className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start justify-between gap-3 lg:contents">
                    <CarSummary appointment={a} />
                    <div className="flex-shrink-0 text-right lg:order-last">
                      <p className="text-xl font-extrabold text-ink">{formatPrice(a.payment.amountCents)}</p>
                      <p className="text-xs font-semibold text-success">
                        {paymentMethodLabels[a.payment.method]} · {paidAt.time}
                      </p>
                      {a.payment.adjustmentCents !== 0 && (
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {adjustmentLabel(a.payment.adjustmentCents)} · era {formatPrice(a.totalPriceCents)}
                          {a.payment.adjustmentReason && <span className="block italic">“{a.payment.adjustmentReason}”</span>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3 lg:border-0 lg:pt-0">
                    {a.payment.method !== 'CASH' && <ReceiptActions appointment={a} hasReceipt={a.payment.hasReceipt} />}
                    {date === todayISO() && (
                      <button
                        type="button"
                        disabled={unpay.isPending && unpay.variables === a.id}
                        onClick={() => {
                          if (window.confirm(`Desfazer o recebimento de ${formatPlate(a.vehiclePlate)}? Use só se foi lançado por engano.`)) {
                            unpay.mutate(a.id);
                          }
                        }}
                        className="btn-secondary px-3 py-2"
                      >
                        Desfazer
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}

      <PaymentModal appointment={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

/**
 * Comprovante de Pix/cartão: ver o anexado ou anexar depois do recebimento
 */
function ReceiptActions({ appointment, hasReceipt }: { appointment: Appointment; hasReceipt: boolean }) {
  const queryClient = useQueryClient();
  const inputId = `receipt-${appointment.id}`;
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(`/admin/appointments/${appointment.id}/receipt`, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
    onError: (err) => setError(err.message),
  });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {hasReceipt && (
          <a
            href={`/api/v1/admin/appointments/${appointment.id}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary px-3 py-2"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Ver comprovante
          </a>
        )}
        <label htmlFor={inputId} className="btn-secondary cursor-pointer px-3 py-2 focus-within:ring-2 focus-within:ring-accent">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          {upload.isPending ? 'Enviando…' : hasReceipt ? 'Trocar' : 'Anexar comprovante'}
          <input
            id={inputId}
            type="file"
            accept={RECEIPT_ACCEPT}
            className="sr-only"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = '';
              const invalid = validateReceipt(file);
              setError(invalid);
              if (file && !invalid) upload.mutate(file);
            }}
          />
        </label>
      </div>
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function CarSummary({ appointment: a }: { appointment: Appointment }) {
  const when = formatDateTime(a.startsAt);
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border-2 border-ink px-2 py-0.5 font-mono text-sm font-bold text-ink">
          {formatPlate(a.vehiclePlate)}
        </span>
        <span className="font-bold text-ink">{a.vehicleLabel}</span>
      </p>
      <p className="text-sm text-ink-muted">
        {a.customerName} · {a.services.map((s) => s.name).join(', ')} · {when.time} ·{' '}
        <span className="font-mono">{a.code}</span>
      </p>
    </div>
  );
}
