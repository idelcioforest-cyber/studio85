import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MessageCircle, Check } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime, formatPlate, formatPrice, whatsappLink } from '../lib/format';
import {
  ACTIVE_STATUSES,
  Appointment,
  AppointmentStatus,
  paymentMethodLabels,
  statusBadge,
  statusLabels,
} from '../lib/types';

const progressSteps: { status: AppointmentStatus; label: string }[] = [
  { status: 'CONFIRMED', label: 'Agendado' },
  { status: 'CHECK_IN', label: 'Carro recebido' },
  { status: 'IN_PROGRESS', label: 'Em lavagem' },
  { status: 'READY', label: 'Pronto' },
];

const statusMessage: Partial<Record<AppointmentStatus, string>> = {
  CONFIRMED: 'Horário reservado. Traga o veículo no horário marcado.',
  CHECK_IN: 'Recebemos seu carro. Ele entra em lavagem em breve.',
  IN_PROGRESS: 'Seu carro está em lavagem. Avisamos quando estiver pronto.',
  READY: 'Seu carro está pronto. Pode vir buscar.',
};

export default function ClientAppointmentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');

  const { data: appointments = [], isLoading, isError } = useQuery({
    queryKey: ['appointments', 'mine'],
    queryFn: () => api<Appointment[]>('/appointments/my'),
    refetchInterval: 20_000,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });

  const upcoming = appointments
    .filter((a) => ACTIVE_STATUSES.includes(a.status))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const history = appointments.filter((a) => !ACTIVE_STATUSES.includes(a.status));
  const list = tab === 'upcoming' ? upcoming : history;

  return (
    <div className="animate-fadeIn mx-auto max-w-3xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Meus agendamentos</h1>
          <p className="mt-1 text-sm text-ink-muted">Acompanhe cada etapa do atendimento. A página atualiza sozinha.</p>
        </div>
        <Link to="/agenda" className="btn-primary">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          Novo agendamento
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 sm:inline-grid" role="tablist" aria-label="Agendamentos">
        {(
          [
            ['upcoming', `Próximos (${upcoming.length})`],
            ['history', `Histórico (${history.length})`],
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

      {cancel.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {cancel.error.message}
        </p>
      )}

      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando agendamentos…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar seus agendamentos. Tente novamente em instantes.
        </p>
      )}

      {!isLoading && !isError && list.length === 0 && (
        <div className="card p-8 text-center">
          <p className="font-semibold text-ink">
            {tab === 'upcoming' ? 'Você não tem agendamentos próximos.' : 'Nenhum atendimento no histórico ainda.'}
          </p>
          {tab === 'upcoming' && (
            <Link to="/agenda" className="btn-primary mt-4">
              Agendar horário
            </Link>
          )}
        </div>
      )}

      <ul className="space-y-4">
        {list.map((appointment) => (
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            cancelling={cancel.isPending && cancel.variables === appointment.id}
            onCancel={() => {
              if (window.confirm('Cancelar este agendamento? O horário volta a ficar disponível.')) {
                cancel.mutate(appointment.id);
              }
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function AppointmentCard({
  appointment,
  cancelling,
  onCancel,
}: {
  appointment: Appointment;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const when = formatDateTime(appointment.startsAt);
  const isActive = ACTIVE_STATUSES.includes(appointment.status);
  const currentStep = progressSteps.findIndex((s) => s.status === appointment.status);

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold capitalize text-ink-muted">
            {when.date} · {when.time}
          </p>
          <h2 className="mt-0.5 text-lg font-bold text-ink">{appointment.services.map((s) => s.name).join(' + ')}</h2>
          <p className="text-sm text-ink-muted">
            {appointment.vehicleLabel} · <span className="font-mono">{formatPlate(appointment.vehiclePlate)}</span>
          </p>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadge[appointment.status]}`}>
            {statusLabels[appointment.status]}
          </span>
          <p className="mt-1.5 text-lg font-extrabold text-ink">{formatPrice(appointment.totalPriceCents)}</p>
          {appointment.payment.status === 'PAID' && (
            <p className="text-xs font-semibold text-success">Pago · {paymentMethodLabels[appointment.payment.method]}</p>
          )}
        </div>
      </div>

      {isActive && (
        <>
          <ol className="mt-5 grid grid-cols-4 gap-1.5" aria-label="Etapas do atendimento">
            {progressSteps.map((step, i) => {
              const done = i < currentStep;
              const current = i === currentStep;
              return (
                <li key={step.status} aria-current={current ? 'step' : undefined}>
                  <div className={`h-1.5 rounded-full ${i <= currentStep ? 'bg-accent' : 'bg-subtle'}`} />
                  <p
                    className={`mt-1.5 flex items-center gap-1 text-[11px] font-semibold sm:text-xs ${
                      current ? 'text-ink' : 'text-ink-muted'
                    }`}
                  >
                    {done && <Check className="h-3 w-3" aria-hidden="true" />}
                    {step.label}
                  </p>
                </li>
              );
            })}
          </ol>
          {statusMessage[appointment.status] && (
            <p className="mt-4 rounded-xl bg-subtle p-3 text-sm text-ink">{statusMessage[appointment.status]}</p>
          )}
        </>
      )}

      {appointment.notes && <p className="mt-3 text-sm text-ink-muted">Observação: {appointment.notes}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-ink-muted">
          Código <span className="font-mono font-semibold text-ink">{appointment.code}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <a
              href={whatsappLink(`Olá! Tenho o agendamento ${appointment.code} e gostaria de falar sobre ele.`)}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary px-3 py-2"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp
            </a>
          )}
          {appointment.status === 'CONFIRMED' && (
            <button type="button" onClick={onCancel} disabled={cancelling} className="btn-danger px-3 py-2">
              {cancelling ? 'Cancelando…' : 'Cancelar'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
