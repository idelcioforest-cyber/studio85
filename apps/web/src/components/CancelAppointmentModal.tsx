import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { formatDateTime, formatPlate } from '../lib/format';
import { Appointment } from '../lib/types';

/**
 * Desmarcar pela equipe: a vaga volta a ficar livre na hora. O motivo fica no histórico
 * (só a equipe vê) e o cliente pode ser avisado pelo WhatsApp e por e-mail.
 */
export function CancelAppointmentModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [notifyClient, setNotifyClient] = useState(true);

  useEffect(() => {
    setReason('');
    setNotifyClient(true);
  }, [appointment?.id]);

  const cancel = useMutation({
    mutationFn: () =>
      api(`/admin/appointments/${appointment!.id}/status`, {
        method: 'PATCH',
        body: { status: 'CANCELLED', reason: reason.trim() || undefined, notifyClient },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      onClose();
    },
  });

  if (!appointment) return null;
  const when = formatDateTime(appointment.startsAt);

  return (
    <Modal open onClose={onClose} title="Desmarcar agendamento" description="O horário volta a ficar livre na agenda.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          cancel.mutate();
        }}
        className="space-y-4"
      >
        <dl className="space-y-1.5 rounded-xl bg-subtle p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Quando</dt>
            <dd className="text-right font-semibold capitalize text-ink">
              {when.date} · {when.time}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Cliente</dt>
            <dd className="text-right font-semibold text-ink">{appointment.customerName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Veículo</dt>
            <dd className="text-right font-semibold text-ink">
              {appointment.vehicleLabel} · <span className="font-mono">{formatPlate(appointment.vehiclePlate)}</span>
            </dd>
          </div>
        </dl>

        <div>
          <label htmlFor="cancel-reason" className="label">
            Motivo <span className="font-normal text-ink-muted">(opcional, só a equipe vê)</span>
          </label>
          <input
            id="cancel-reason"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: cliente pediu para remarcar"
            className="field"
          />
        </div>

        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={notifyClient}
            onChange={(e) => setNotifyClient(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line-strong accent-amber-500"
          />
          <span>
            Avisar o cliente pelo WhatsApp e por e-mail
            <span className="block text-xs text-ink-muted">O texto do WhatsApp pode ser editado em Configurações.</span>
          </span>
        </label>

        {cancel.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {cancel.error.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Voltar
          </button>
          <button type="submit" disabled={cancel.isPending} className="btn-primary">
            {cancel.isPending ? 'Desmarcando…' : 'Desmarcar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
