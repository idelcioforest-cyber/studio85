import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronRight, Phone, CalendarPlus, Camera, KeyRound, MessageCircle } from 'lucide-react';
import { PaymentModal } from '../components/PaymentModal';
import { WalkInModal } from '../components/WalkInModal';
import { PhotosModal } from '../components/PhotosModal';
import { GrantAccessModal } from '../components/GrantAccessModal';
import { CancelAppointmentModal } from '../components/CancelAppointmentModal';
import { api } from '../lib/api';
import {
  formatDateLong,
  formatDateTime,
  formatPhone,
  formatPlate,
  formatPrice,
  sizeLabels,
  todayISO,
  adjustmentLabel,
} from '../lib/format';
import { Appointment, AppointmentStatus, paymentMethodLabels, statusBadge, statusLabels } from '../lib/types';

const nextAction: Partial<Record<AppointmentStatus, { status: AppointmentStatus; label: string }>> = {
  CONFIRMED: { status: 'CHECK_IN', label: 'Registrar chegada' },
  CHECK_IN: { status: 'IN_PROGRESS', label: 'Iniciar lavagem' },
  IN_PROGRESS: { status: 'READY', label: 'Marcar como pronto' },
  READY: { status: 'DELIVERED', label: 'Registrar entrega' },
};

const filters: { key: string; label: string; statuses: AppointmentStatus[] }[] = [
  { key: 'ACTIVE', label: 'Em aberto', statuses: ['CONFIRMED', 'CHECK_IN', 'IN_PROGRESS', 'READY'] },
  { key: 'CONFIRMED', label: 'Agendados', statuses: ['CONFIRMED'] },
  { key: 'YARD', label: 'No pátio', statuses: ['CHECK_IN', 'IN_PROGRESS'] },
  { key: 'READY', label: 'Prontos', statuses: ['READY'] },
  { key: 'DONE', label: 'Finalizados', statuses: ['DELIVERED', 'CANCELLED', 'NO_SHOW'] },
];

export default function AdminPatioPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [filter, setFilter] = useState('ACTIVE');
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [paying, setPaying] = useState<Appointment | null>(null);
  const [photosFor, setPhotosFor] = useState<Appointment | null>(null);
  const [accessFor, setAccessFor] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{ ok: boolean; text: string } | null>(null);

  const notify = useMutation({
    mutationFn: (id: string) =>
      api<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error: string | null }>(`/admin/appointments/${id}/notify`, {
        method: 'POST',
        body: { templateKey: 'CAR_READY' },
      }),
    onSuccess: (res) =>
      setNotifyResult(
        res.status === 'SENT'
          ? { ok: true, text: 'Cliente avisado no WhatsApp.' }
          : { ok: false, text: `Mensagem não enviada: ${res.error ?? 'verifique o WhatsApp em Configurações.'}` },
      ),
    onError: (err) => setNotifyResult({ ok: false, text: err.message }),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'appointments', date],
    queryFn: () => api<{ date: string; appointments: Appointment[] }>(`/admin/appointments?date=${date}`),
    refetchInterval: 15_000,
  });
  const appointments = data?.appointments ?? [];

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      api(`/admin/appointments/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'appointments'] }),
  });

  const count = (statuses: AppointmentStatus[]) => appointments.filter((a) => statuses.includes(a.status)).length;
  const visible = appointments.filter((a) => filters.find((f) => f.key === filter)!.statuses.includes(a.status));

  const metrics = [
    { label: 'Agendados', value: count(['CONFIRMED']) },
    { label: 'No pátio', value: count(['CHECK_IN', 'IN_PROGRESS']) },
    { label: 'Prontos', value: count(['READY']) },
    { label: 'Entregues', value: count(['DELIVERED']) },
  ];

  return (
    <div className="animate-fadeIn space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Operação</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Pátio</h1>
          <p className="mt-1 text-sm capitalize text-ink-muted">{formatDateLong(date)}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="patio-date" className="label">Dia</label>
            <input id="patio-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="field" />
          </div>
          <button type="button" onClick={() => setIsBookingOpen(true)} className="btn-secondary">
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Agendar (WhatsApp)
          </button>
          <button type="button" onClick={() => setIsWalkInOpen(true)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Entrada de balcão
          </button>
        </div>
      </header>

      {notifyResult && (
        <p
          className={`rounded-xl border p-3 text-sm ${
            notifyResult.ok ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'
          }`}
          role="status"
        >
          {notifyResult.text}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{m.label}</dt>
            <dd className="mt-1 text-3xl font-extrabold text-ink">{m.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar por etapa">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              filter === f.key
                ? 'border-ink bg-ink text-canvas'
                : 'border-line-strong bg-surface text-ink-muted hover:text-ink'
            }`}
          >
            {f.label} ({count(f.statuses)})
          </button>
        ))}
      </div>

      {changeStatus.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {changeStatus.error.message}
        </p>
      )}

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando pátio…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar os agendamentos.
        </p>
      )}
      {!isLoading && !isError && visible.length === 0 && (
        <p className="card p-10 text-center text-sm text-ink-muted">Nenhum veículo nesta etapa.</p>
      )}

      <ul className="space-y-3">
        {visible.map((a) => {
          const action = nextAction[a.status];
          const when = formatDateTime(a.startsAt);
          const busy = changeStatus.isPending && changeStatus.variables?.id === a.id;
          return (
            <li key={a.id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-ink">{when.time}</span>
                  <span className="rounded-md border-2 border-ink px-2 py-0.5 font-mono text-sm font-bold text-ink">
                    {formatPlate(a.vehiclePlate)}
                  </span>
                  <span className="font-bold text-ink">{a.vehicleLabel}</span>
                  <span className="text-sm text-ink-muted">· {sizeLabels[a.vehicleSize]}</span>
                </div>
                <p className="text-sm text-ink">
                  <span className="font-semibold">{a.services.map((s) => s.name).join(', ')}</span>
                  <span className="text-ink-muted">
                    {' '}
                    · {formatPrice(a.payment.status === 'PAID' ? a.payment.amountCents : a.totalPriceCents)}
                    {a.payment.status === 'PAID' && a.payment.adjustmentCents !== 0 && ` (${adjustmentLabel(a.payment.adjustmentCents).toLowerCase()})`}
                  </span>
                  {a.isTelebusca && <span className="text-info"> · Telebusca</span>}
                </p>
                <p className="text-sm text-ink-muted">
                  <span className="font-medium text-ink">{a.customerName}</span>
                  {a.customerPhone && (
                    <a href={`tel:${a.customerPhone}`} className="ml-2 inline-flex items-center gap-1 whitespace-nowrap hover:text-ink">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatPhone(a.customerPhone)}
                    </a>
                  )}
                </p>
                <p className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="rounded border border-line px-1.5 py-0.5 font-semibold">
                    {a.source === 'WALK_IN' ? 'Balcão' : 'App'}
                  </span>
                  <span className="font-mono">{a.code}</span>
                </p>
                {a.notes && <p className="text-sm text-ink-muted">Obs.: {a.notes}</p>}
                {a.status === 'CANCELLED' && a.cancellationReason && (
                  <p className="text-sm text-ink-muted">{a.cancellationReason}</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => setPhotosFor(a)} className="btn-secondary px-2.5 py-1.5 text-xs">
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    Fotos{a.photos.length > 0 ? ` (${a.photos.length})` : ''}
                  </button>
                  {a.customer && a.customer.appAccess !== 'ACTIVE' && (
                    <button type="button" onClick={() => setAccessFor(a)} className="btn-secondary px-2.5 py-1.5 text-xs">
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      {a.customer.appAccess === 'PENDING' ? 'Reenviar acesso' : 'Liberar app'}
                    </button>
                  )}
                  {a.status === 'READY' && a.customerPhone && (
                    <button
                      type="button"
                      disabled={notify.isPending && notify.variables === a.id}
                      onClick={() => notify.mutate(a.id)}
                      className="btn-secondary px-2.5 py-1.5 text-xs"
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Avisar no WhatsApp
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 sm:justify-end sm:border-0 sm:pt-0">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadge[a.status]}`}>
                  {statusLabels[a.status]}
                </span>
                {a.payment.status === 'PAID' ? (
                  <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-bold text-success">
                    Pago · {paymentMethodLabels[a.payment.method]}
                  </span>
                ) : (
                  !['CANCELLED', 'NO_SHOW'].includes(a.status) && (
                    <button type="button" onClick={() => setPaying(a)} className="btn-secondary px-3 py-2">
                      Receber
                    </button>
                  )
                )}
                {['CONFIRMED', 'CHECK_IN'].includes(a.status) && a.payment.status !== 'PAID' && (
                  <button type="button" disabled={busy} onClick={() => setCancelling(a)} className="btn-secondary px-3 py-2">
                    Desmarcar
                  </button>
                )}
                {a.status === 'CONFIRMED' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Marcar como não compareceu? O horário será liberado.')) {
                        changeStatus.mutate({ id: a.id, status: 'NO_SHOW' });
                      }
                    }}
                    className="btn-secondary px-3 py-2"
                  >
                    Não veio
                  </button>
                )}
                {action && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus.mutate({ id: a.id, status: action.status })}
                    className="btn-primary px-3 py-2"
                  >
                    {action.label}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <WalkInModal
        open={isWalkInOpen}
        onClose={() => setIsWalkInOpen(false)}
        onCreated={() => {
          setIsWalkInOpen(false);
          setDate(todayISO());
          setFilter('ACTIVE');
          queryClient.invalidateQueries({ queryKey: ['admin', 'appointments'] });
        }}
      />
      <PaymentModal appointment={paying} onClose={() => setPaying(null)} />
      <PhotosModal appointment={photosFor} onClose={() => setPhotosFor(null)} />
      <GrantAccessModal appointment={accessFor} onClose={() => setAccessFor(null)} />
      <CancelAppointmentModal appointment={cancelling} onClose={() => setCancelling(null)} />
      <WalkInModal
        mode="booking"
        open={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        onCreated={() => {
          setIsBookingOpen(false);
          queryClient.invalidateQueries({ queryKey: ['admin'] });
        }}
      />
    </div>
  );
}
