import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CalendarX, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { formatDateLong, todayISO } from '../lib/format';

interface ScheduleException {
  id: string;
  date: string;
  type: 'OPEN' | 'CLOSED';
  startTime: string | null;
  endTime: string | null;
  capacity: number;
  note: string | null;
}

const emptyForm = { type: 'OPEN' as 'OPEN' | 'CLOSED', date: '', allDay: true, startTime: '08:00', endTime: '12:00', capacity: 1, note: '' };

/**
 * Dias especiais: abrir um horário extra ou fechar o dia/um período numa data específica.
 * Vale só para a data escolhida e tem prioridade sobre a grade semanal.
 */
export function SpecialDays() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [warning, setWarning] = useState<string | null>(null);

  const { data: exceptions = [], isLoading } = useQuery({
    queryKey: ['admin', 'schedule-exceptions'],
    queryFn: () => api<ScheduleException[]>('/admin/schedule/exceptions'),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'schedule-exceptions'] });
    queryClient.invalidateQueries({ queryKey: ['opening-hours'] });
    queryClient.invalidateQueries({ queryKey: ['availability'] });
  };

  const create = useMutation({
    mutationFn: () => {
      const closedAllDay = form.type === 'CLOSED' && form.allDay;
      return api<{ affectedAppointments: number }>('/admin/schedule/exceptions', {
        method: 'POST',
        body: {
          date: form.date,
          type: form.type,
          allDay: closedAllDay,
          ...(closedAllDay ? {} : { startTime: form.startTime, endTime: form.endTime }),
          ...(form.type === 'OPEN' ? { capacity: form.capacity } : {}),
          note: form.note.trim() || undefined,
        },
      });
    },
    onSuccess: (res) => {
      setWarning(
        res.affectedAppointments > 0
          ? `Já existem ${res.affectedAppointments} agendamento(s) nesse período. Eles continuam marcados: confira no Pátio e desmarque se precisar.`
          : null,
      );
      setForm({ ...emptyForm, type: form.type });
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/schedule/exceptions/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const fieldError = (field: string) => (create.error instanceof ApiError ? create.error.fieldError(field) : undefined);
  const needsTimes = form.type === 'OPEN' || !form.allDay;

  return (
    <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="dias-especiais">
      <div>
        <h2 id="dias-especiais" className="text-lg font-bold text-ink">Dias especiais</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Abra um horário extra numa data (ex.: um domingo) ou feche o dia inteiro ou um período (feriado, folga). Vale só
          para a data escolhida; os outros dias seguem a grade acima.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4 rounded-xl border border-line p-4"
        noValidate
      >
        <fieldset>
          <legend className="label">O que fazer</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ['OPEN', 'Abrir horário extra', CalendarPlus],
                ['CLOSED', 'Fechar dia ou período', CalendarX],
              ] as const
            ).map(([value, label, Icon]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-semibold transition focus-within:ring-2 focus-within:ring-accent ${
                  form.type === value ? 'border-accent bg-accent/10 text-ink' : 'border-line-strong text-ink hover:border-accent'
                }`}
              >
                <input
                  type="radio"
                  name="exception-type"
                  checked={form.type === value}
                  onChange={() => setForm({ ...form, type: value })}
                  className="sr-only"
                />
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="exc-date" label="Data" error={fieldError('date')}>
            <input
              id="exc-date"
              type="date"
              min={todayISO()}
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="field"
            />
          </Field>
          {form.type === 'CLOSED' && (
            <label className="flex items-start gap-2.5 self-end pb-1 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-line-strong accent-amber-500"
              />
              <span>
                Fechar o dia inteiro
                <span className="block text-xs text-ink-muted">Horários extras da mesma data continuam abertos.</span>
              </span>
            </label>
          )}
        </div>

        {needsTimes && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field id="exc-start" label={form.type === 'OPEN' ? 'Abre às' : 'Fecha das'} error={fieldError('startTime')}>
              <input
                id="exc-start"
                type="time"
                step={900}
                required
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                className="field"
              />
            </Field>
            <Field id="exc-end" label={form.type === 'OPEN' ? 'Fecha às' : 'Até as'} error={fieldError('endTime')}>
              <input
                id="exc-end"
                type="time"
                step={900}
                required
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                className="field"
              />
            </Field>
            {form.type === 'OPEN' && (
              <Field id="exc-capacity" label="Carros ao mesmo tempo" error={fieldError('capacity')}>
                <input
                  id="exc-capacity"
                  type="number"
                  min={1}
                  max={20}
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })}
                  className="field"
                />
              </Field>
            )}
          </div>
        )}

        <Field id="exc-note" label="Observação (opcional)" error={fieldError('note')}>
          <input
            id="exc-note"
            maxLength={120}
            placeholder={form.type === 'OPEN' ? 'Ex.: plantão de fim de ano' : 'Ex.: feriado'}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="field"
          />
        </Field>

        {create.error && !(create.error instanceof ApiError && create.error.fieldErrors.length > 0) && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {create.error.message}
          </p>
        )}
        {warning && (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning" role="status">
            {warning}
          </p>
        )}

        <button type="submit" disabled={create.isPending || !form.date} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {create.isPending ? 'Salvando…' : form.type === 'OPEN' ? 'Abrir horário' : 'Fechar'}
        </button>
      </form>

      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-muted">Próximos dias especiais</h3>
        {isLoading ? (
          <p className="mt-2 text-sm text-ink-muted">Carregando…</p>
        ) : exceptions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nenhum. Todos os dias seguem a grade semanal.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {exceptions.map((e) => {
              const open = e.type === 'OPEN';
              const period = e.startTime ? `${e.startTime} às ${e.endTime}` : 'Dia inteiro';
              return (
                <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                          open ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'
                        }`}
                      >
                        {open ? 'Horário extra' : 'Fechado'}
                      </span>
                      <p className="text-sm font-semibold text-ink first-letter:uppercase">{formatDateLong(e.date)}</p>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {period}
                      {open && ` · ${e.capacity} carro(s) ao mesmo tempo`}
                      {e.note && ` · ${e.note}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={remove.isPending && remove.variables === e.id}
                    onClick={() => {
                      if (window.confirm(`Remover este dia especial? ${formatDateLong(e.date)} volta a seguir a grade semanal.`)) {
                        remove.mutate(e.id);
                      }
                    }}
                    className="btn-secondary self-start px-3 py-2 sm:self-auto"
                    aria-label={`Remover dia especial de ${formatDateLong(e.date)}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Remover
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactElement }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {React.cloneElement(children, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
