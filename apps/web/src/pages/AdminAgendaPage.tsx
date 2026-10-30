import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Check, Sun, Sunset, Moon } from 'lucide-react';
import { api } from '../lib/api';
import { SpecialDays } from '../components/SpecialDays';

interface ShiftConfig {
  shiftName: 'MANHA' | 'TARDE' | 'NOITE';
  startTime: string;
  endTime: string;
  simultaneousCapacity: number;
  overbookTolerance: number;
  isActive: boolean;
}

interface DayConfig {
  dayOfWeek: number;
  isActive: boolean;
  slotIntervalMinutes: number;
  shifts: ShiftConfig[];
}

const dayLabels = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const displayOrder = [1, 2, 3, 4, 5, 6, 0];
const shiftMeta = {
  MANHA: { label: 'Manhã', icon: Sun },
  TARDE: { label: 'Tarde', icon: Sunset },
  NOITE: { label: 'Noite', icon: Moon },
};
const intervals = [0, 15, 30, 45, 60, 90, 120];

function intervalHelp(mins: number): string {
  if (mins === 0) {
    return 'Horário livre: a agenda sugere horários a cada 15 minutos e o cliente também pode digitar um horário exato. A capacidade simultânea continua valendo.';
  }
  return `Horários a cada ${mins} minutos a partir do início de cada turno.`;
}

export default function AdminAgendaPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'schedule'],
    queryFn: () => api<DayConfig[]>('/admin/schedule'),
  });

  const [days, setDays] = useState<DayConfig[]>([]);
  const [selectedDay, setSelectedDay] = useState(1);
  const [applyIntervalToAll, setApplyIntervalToAll] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setDays(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api<{ days: DayConfig[] }>('/admin/schedule', { method: 'PUT', body: { days } }),
    onSuccess: (res) => {
      setDays(res.days);
      queryClient.setQueryData(['admin', 'schedule'], res.days);
      queryClient.invalidateQueries({ queryKey: ['opening-hours'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const current = days.find((d) => d.dayOfWeek === selectedDay);
  const dirty = Boolean(data) && JSON.stringify(data) !== JSON.stringify(days);

  const updateDay = (patch: Partial<DayConfig>) =>
    setDays((prev) => prev.map((d) => (d.dayOfWeek === selectedDay ? { ...d, ...patch } : d)));

  const updateShift = (index: number, patch: Partial<ShiftConfig>) =>
    setDays((prev) =>
      prev.map((d) =>
        d.dayOfWeek === selectedDay
          ? { ...d, shifts: d.shifts.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
          : d,
      ),
    );

  const changeInterval = (mins: number) =>
    setDays((prev) =>
      prev.map((d) => (applyIntervalToAll || d.dayOfWeek === selectedDay ? { ...d, slotIntervalMinutes: mins } : d)),
    );

  const copyToOpenDays = () => {
    if (!current) return;
    setDays((prev) =>
      prev.map((d) =>
        d.isActive && d.dayOfWeek !== selectedDay
          ? { ...d, slotIntervalMinutes: current.slotIntervalMinutes, shifts: current.shifts.map((s) => ({ ...s })) }
          : d,
      ),
    );
  };

  return (
    <div className="animate-fadeIn mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Configuração</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Agenda e capacidade</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Dias de funcionamento, turnos, intervalo entre horários e quantos carros podem ser atendidos ao mesmo tempo.
          </p>
        </div>
        <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="btn-primary">
          <Save className="h-4 w-4" aria-hidden="true" />
          {save.isPending ? 'Salvando…' : 'Salvar agenda'}
        </button>
      </header>

      {saved && (
        <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success" role="status">
          <Check className="h-4 w-4" aria-hidden="true" />
          Agenda salva. Os novos horários já aparecem para os clientes.
        </p>
      )}
      {save.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {save.error.message}
        </p>
      )}
      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando agenda…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar a agenda.
        </p>
      )}

      {current && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Dia da semana">
            {displayOrder.map((dow) => {
              const d = days.find((x) => x.dayOfWeek === dow)!;
              const selected = dow === selectedDay;
              return (
                <button
                  key={dow}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setSelectedDay(dow)}
                  className={`min-w-[120px] flex-shrink-0 rounded-xl border p-3 text-left transition ${
                    selected ? 'border-ink bg-ink text-canvas' : 'border-line-strong bg-surface text-ink hover:bg-subtle'
                  }`}
                >
                  <span className="block text-sm font-bold">{dayLabels[dow].split('-')[0]}</span>
                  <span className={`block text-xs ${selected ? 'opacity-90' : 'text-ink-muted'}`}>
                    {d.isActive ? `${d.shifts.filter((s) => s.isActive).length} turno(s)` : 'Fechado'}
                  </span>
                </button>
              );
            })}
          </div>

          <section className="card space-y-6 p-5 sm:p-6" aria-label={dayLabels[selectedDay]}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <div>
                <h2 className="text-lg font-bold text-ink">{dayLabels[selectedDay]}</h2>
                <p className="text-sm text-ink-muted">
                  {current.isActive ? 'Aberto para agendamentos' : 'Fechado neste dia'}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  role="switch"
                  checked={current.isActive}
                  onChange={(e) => updateDay({ isActive: e.target.checked })}
                  className="h-5 w-5 accent-amber-500"
                />
                Aberto
              </label>
            </div>

            {current.isActive && (
              <>
                <fieldset className="space-y-3">
                  <legend className="font-bold text-ink">Intervalo entre horários</legend>
                  <div className="flex flex-wrap gap-2">
                    {intervals.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        aria-pressed={current.slotIntervalMinutes === mins}
                        onClick={() => changeInterval(mins)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                          current.slotIntervalMinutes === mins
                            ? 'border-accent bg-accent text-accent-ink'
                            : 'border-line-strong bg-surface text-ink hover:bg-subtle'
                        }`}
                      >
                        {mins === 0 ? 'Livre' : `${mins} min`}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={applyIntervalToAll}
                      onChange={(e) => setApplyIntervalToAll(e.target.checked)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    Aplicar o intervalo em todos os dias
                  </label>
                  <p className="text-sm text-ink-muted">{intervalHelp(current.slotIntervalMinutes)}</p>
                </fieldset>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-ink">Turnos e capacidade simultânea</h3>
                    <button type="button" onClick={copyToOpenDays} className="btn-secondary px-3 py-1.5 text-xs">
                      Copiar este dia para os outros dias abertos
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {current.shifts.map((shift, i) => {
                      const meta = shiftMeta[shift.shiftName];
                      const Icon = meta.icon;
                      const id = `shift-${selectedDay}-${shift.shiftName}`;
                      return (
                        <div
                          key={shift.shiftName}
                          className={`rounded-xl border p-4 ${shift.isActive ? 'border-line-strong' : 'border-dashed border-line'}`}
                        >
                          <label className="flex items-center justify-between gap-2 font-semibold text-ink">
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                              {meta.label}
                            </span>
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={`Turno da ${meta.label.toLowerCase()} ativo`}
                              checked={shift.isActive}
                              onChange={(e) => updateShift(i, { isActive: e.target.checked })}
                              className="h-4 w-4 accent-amber-500"
                            />
                          </label>
                          {shift.isActive ? (
                            <div className="mt-3 space-y-3">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label htmlFor={`${id}-start`} className="label">Início</label>
                                  <input
                                    id={`${id}-start`}
                                    type="time"
                                    value={shift.startTime}
                                    onChange={(e) => updateShift(i, { startTime: e.target.value })}
                                    className="field font-mono"
                                  />
                                </div>
                                <div>
                                  <label htmlFor={`${id}-end`} className="label">Término</label>
                                  <input
                                    id={`${id}-end`}
                                    type="time"
                                    value={shift.endTime}
                                    onChange={(e) => updateShift(i, { endTime: e.target.value })}
                                    className="field font-mono"
                                  />
                                </div>
                              </div>
                              <div>
                                <label htmlFor={`${id}-cap`} className="label">Carros ao mesmo tempo</label>
                                <input
                                  id={`${id}-cap`}
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={shift.simultaneousCapacity}
                                  onChange={(e) =>
                                    updateShift(i, { simultaneousCapacity: Math.max(1, Number(e.target.value) || 1) })
                                  }
                                  className="field w-24"
                                />
                              </div>
                              <div>
                                <label htmlFor={`${id}-tol`} className="label">Tolerância (só equipe)</label>
                                <input
                                  id={`${id}-tol`}
                                  type="number"
                                  min={0}
                                  max={10}
                                  value={shift.overbookTolerance ?? 0}
                                  aria-describedby={`${id}-tol-help`}
                                  onChange={(e) =>
                                    updateShift(i, { overbookTolerance: Math.min(10, Math.max(0, Number(e.target.value) || 0)) })
                                  }
                                  className="field w-24"
                                />
                                <p id={`${id}-tol-help`} className="mt-1 text-xs text-ink-muted">
                                  Vagas extras para a equipe encaixar (ex.: pedido no WhatsApp). O cliente vê o horário como lotado.
                                </p>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-ink-muted">Turno desativado</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <SpecialDays />
    </div>
  );
}
