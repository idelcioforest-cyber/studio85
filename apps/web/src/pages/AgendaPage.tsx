import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, MessageCircle, Plus } from 'lucide-react';
import { VehicleSizeCategory, arrivalNotice } from '@autowash/shared';
import { useAuth } from '../context/AuthContext';
import { SizeSelector } from '../components/SizeSelector';
import { VehicleForm } from '../components/VehicleForm';
import { PayOnlineModal, useOnlinePayment } from '../components/PayOnlineModal';
import { api, ApiError } from '../lib/api';
import { track } from '../lib/analytics';
import { useCatalog, useMyAddresses, useMyVehicles, usePublicSettings } from '../lib/queries';
import {
  addDaysISO,
  dayOfWeekISO,
  formatDateLong,
  formatDateTime,
  formatDayChip,
  formatDuration,
  formatPlate,
  formatPrice,
  sizeLabels,
  whatsappLink,
  SHOP_TIMEZONE,
} from '../lib/format';
import { Appointment, Availability, OpeningHours, SlotStatus } from '../lib/types';

interface MySubscription {
  vehicleId: string;
  planName: string;
  serviceIds: string[];
  remaining: number;
  periodStart: string | null;
  periodEnd: string | null;
}

const shopDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE }).format(new Date(iso));

const DAYS_SHOWN = 14;
const shiftLabels: Record<string, string> = { MANHA: 'Manhã', TARDE: 'Tarde', NOITE: 'Noite', EXTRA: 'Horário extra' };

function currentShopTime(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: SHOP_TIMEZONE,
  }).format(new Date());
}

/** Dia aberto para agendamento: funciona nesse dia da semana, está no prazo e, se for hoje, o expediente não acabou */
function isDayOpen(hours: OpeningHours, iso: string): boolean {
  if (iso < hours.today || iso > addDaysISO(hours.today, hours.bookingWindowDays)) return false;
  // Dia especial (horário extra ou fechamento) vale no lugar da grade semanal
  const info = hours.specialDays?.find((d) => d.date === iso) ?? hours.days.find((d) => d.dayOfWeek === dayOfWeekISO(iso));
  if (!info?.isOpen) return false;
  if (iso === hours.today) {
    const lastEnd = info.periods[info.periods.length - 1]?.end;
    if (lastEnd && currentShopTime() >= lastEnd) return false;
  }
  return true;
}

function isSize(value: string | null | undefined): value is VehicleSizeCategory {
  return Boolean(value) && (Object.values(VehicleSizeCategory) as string[]).includes(value as string);
}

// Rascunho da escolha na aba atual: sobrevive ao login/cadastro e à navegação até confirmar
const DRAFT_KEY = 'studio85_booking_draft';

interface BookingDraft {
  serviceIds?: string[];
  size?: VehicleSizeCategory;
  date?: string | null;
  time?: string | null;
}

function readDraft(): BookingDraft {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeDraft(draft: BookingDraft | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Armazenamento indisponível: a escolha continua apenas em memória
  }
}

export default function AgendaPage() {
  const { isLoggedIn, isAdmin, openAuthModal } = useAuth();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [draft] = useState(readDraft);

  // Link do catálogo tem prioridade; dia e horário do rascunho só valem se o serviço do link já estava escolhido
  const urlService = params.get('servico');
  const urlSize = params.get('porte');
  const draftServices = Array.isArray(draft.serviceIds) ? draft.serviceIds : [];
  const useDraftSlot = !urlService || draftServices.includes(urlService);

  const [size, setSize] = useState<VehicleSizeCategory>(
    isSize(urlSize) ? urlSize : isSize(draft.size) ? draft.size : VehicleSizeCategory.MEDIUM,
  );
  // Um ou mais serviços no mesmo horário
  const [serviceIds, setServiceIds] = useState<string[]>(() =>
    urlService ? (useDraftSlot ? draftServices : [urlService]) : draftServices,
  );
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [date, setDate] = useState<string | null>(useDraftSlot ? draft.date ?? null : null);
  const [dayView, setDayView] = useState<'list' | 'calendar'>('list');
  const [time, setTime] = useState<string | null>(useDraftSlot ? draft.time ?? null : null);
  const [customTime, setCustomTime] = useState('');
  const [notes, setNotes] = useState('');
  const [telebusca, setTelebusca] = useState(false);
  const [addressId, setAddressId] = useState('');
  const [confirmed, setConfirmed] = useState<Appointment | null>(null);
  const [payingNow, setPayingNow] = useState(false);
  const { data: onlineConfig } = useOnlinePayment();

  const { data: settings } = usePublicSettings();
  const telebuscaAvailable = Boolean(settings?.telebuscaEnabled);
  const { data: hours } = useQuery({
    queryKey: ['opening-hours'],
    queryFn: () => api<OpeningHours>('/schedule/hours'),
  });
  const { data: vehicles = [], isLoading: loadingVehicles } = useMyVehicles(isLoggedIn);
  const { data: addresses = [] } = useMyAddresses(isLoggedIn && telebuscaAvailable);

  // Com login, o porte vem do veículo escolhido; sem login, do seletor
  useEffect(() => {
    if (!isLoggedIn) {
      setVehicleId(null);
      return;
    }
    if (vehicles.length > 0 && !vehicles.some((v) => v.id === vehicleId)) {
      setVehicleId(vehicles[0].id);
    }
  }, [isLoggedIn, vehicles, vehicleId]);

  useEffect(() => {
    if (addresses.length > 0 && !addresses.some((a) => a.id === addressId)) {
      setAddressId((addresses.find((a) => a.isDefault) ?? addresses[0]).id);
    }
  }, [addresses, addressId]);

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const effectiveSize = vehicle?.sizeCategory ?? size;

  const { data: categories = [], isLoading: loadingServices } = useCatalog(effectiveSize);
  const services = categories.flatMap((c) => c.services);
  // Serviços escolhidos que atendem o porte atual (na ordem do catálogo)
  const selected = services.filter((s) => serviceIds.includes(s.id));
  const unavailableCount = loadingServices ? 0 : serviceIds.length - selected.length;
  const selectedKey = selected.map((s) => s.id).sort().join(',');
  const servicesPrice = selected.reduce((acc, s) => acc + s.priceCents, 0);
  const servicesDuration = selected.reduce((acc, s) => acc + s.durationMinutes, 0);

  const toggleService = (id: string) =>
    setServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const days = useMemo(() => {
    if (!hours) return [];
    return Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const iso = addDaysISO(hours.today, i);
      return { iso, isOpen: isDayOpen(hours, iso) };
    });
  }, [hours]);

  // Sem dia escolhido (ou o dia salvo já não está aberto): usa o primeiro dia disponível
  useEffect(() => {
    if (!hours || days.length === 0) return;
    if (!date || !isDayOpen(hours, date)) {
      setDate(days.find((d) => d.isOpen)?.iso ?? null);
      setTime(null);
    }
  }, [hours, days, date]);

  useEffect(() => {
    writeDraft({ serviceIds, size, date, time });
  }, [serviceIds, size, date, time]);

  const chooseDate = (iso: string) => {
    setDate(iso);
    setTime(null);
    setCustomTime('');
  };

  const availabilityQuery = useQuery({
    queryKey: ['availability', date, selectedKey, effectiveSize],
    queryFn: () =>
      api<Availability>(`/availability?date=${date}&serviceIds=${selectedKey}&sizeCategory=${effectiveSize}`),
    enabled: Boolean(date && selectedKey),
    refetchInterval: 60_000,
  });
  const availability = availabilityQuery.data;

  // O horário escolhido continua marcado (inclusive depois do login) enquanto existir e tiver vaga.
  // Se trocar o serviço ou o veículo e o horário deixar de caber, ele é desmarcado.
  useEffect(() => {
    if (!availability || !time) return;
    const slot = availability.slots.find((s) => s.time === time);
    if (!slot || slot.status === 'FULL') setTime(null);
  }, [availability, time]);

  const selectedTime = time ?? (availability?.freeTime && /^\d{2}:\d{2}$/.test(customTime) ? customTime : null);
  const telebuscaFee = telebusca ? settings?.telebuscaFeeCents ?? 0 : 0;

  // Medição anônima do funil: abriu o agendamento e escolheu serviço e horário (a equipe não conta)
  const slotTracked = useRef(false);
  useEffect(() => {
    if (!isAdmin) track('booking_open');
  }, [isAdmin]);
  useEffect(() => {
    if (isAdmin || slotTracked.current || selected.length === 0 || !selectedTime) return;
    slotTracked.current = true;
    track('booking_slot');
  }, [isAdmin, selected.length, selectedTime]);

  // Só quem assina recebe algo aqui; para os demais a lista vem vazia e nada muda na tela.
  // É uma prévia: o servidor confirma ao agendar (data dentro do período pago e lavagens sobrando).
  const { data: mySubscriptions = [] } = useQuery({
    queryKey: ['subscriptions', 'mine'],
    queryFn: () => api<MySubscription[]>('/subscriptions/mine'),
    enabled: isLoggedIn,
  });
  const subscription = vehicle ? mySubscriptions.find((s) => s.vehicleId === vehicle.id) : undefined;
  const subscriptionCoversDate = Boolean(
    subscription &&
      subscription.remaining > 0 &&
      date &&
      (!subscription.periodStart || date >= shopDay(subscription.periodStart)) &&
      (!subscription.periodEnd || date < shopDay(subscription.periodEnd)),
  );
  const coveredIds = new Set(subscriptionCoversDate ? subscription!.serviceIds : []);
  const coveredCents = selected.filter((s) => coveredIds.has(s.id)).reduce((acc, s) => acc + s.priceCents, 0);
  const total = servicesPrice - coveredCents + telebuscaFee;

  const missing = [
    selected.length === 0 && 'serviço',
    !vehicle && 'veículo',
    !date && 'dia',
    !selectedTime && 'horário',
    telebusca && !addressId && 'endereço de coleta',
  ].filter(Boolean) as string[];

  const book = useMutation({
    mutationFn: () =>
      api<{ appointment: Appointment }>('/appointments', {
        method: 'POST',
        body: {
          serviceIds: selected.map((s) => s.id),
          vehicleId: vehicle?.id,
          date,
          time: selectedTime,
          notes: notes.trim() || null,
          telebusca,
          pickupAddressId: telebusca ? addressId : null,
        },
      }),
    onSuccess: (data) => {
      if (!isAdmin) track('booking_done');
      setConfirmed(data.appointment);
      writeDraft(null);
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions', 'mine'] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setTime(null);
        availabilityQuery.refetch();
      }
    },
  });

  const whatsappMessage = `Olá! Gostaria de agendar ${
    selected.length > 0 ? selected.map((s) => s.name).join(' + ') : 'um serviço'
  }${
    date ? ` para ${formatDateLong(date)}` : ''
  }${selectedTime ? ` às ${selectedTime}` : ''}.`;

  if (confirmed) {
    const when = formatDateTime(confirmed.startsAt);
    return (
      <div className="card animate-fadeIn mx-auto max-w-lg p-6 text-center sm:p-8">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-bold text-ink">Agendamento confirmado</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Código <strong className="font-mono text-ink">{confirmed.code}</strong>
        </p>
        <dl className="mt-6 space-y-2 rounded-xl bg-subtle p-4 text-left text-sm">
          <SummaryRow
            label={confirmed.services.length > 1 ? 'Serviços' : 'Serviço'}
            value={confirmed.services.map((s) => s.name).join(' + ') || '—'}
          />
          <SummaryRow label="Veículo" value={`${confirmed.vehicleLabel} · ${formatPlate(confirmed.vehiclePlate)}`} />
          <SummaryRow label="Data" value={when.date} />
          <SummaryRow label="Horário" value={when.time} />
          {confirmed.subscriptionCoveredCents > 0 && (
            <SummaryRow label="Pela assinatura" value={`- ${formatPrice(confirmed.subscriptionCoveredCents)}`} />
          )}
          <SummaryRow label="Total" value={formatPrice(confirmed.totalPriceCents)} />
        </dl>
        <ArrivalNotice text={arrivalNotice(when.time, confirmed.isTelebusca)} className="mt-4" />
        <p className="mt-4 text-sm text-ink-muted">
          {onlineConfig?.enabled
            ? 'Pague agora pelo app (Pix ou cartão) ou no local, na retirada.'
            : 'Pagamento no local, na retirada.'}{' '}
          Você pode cancelar pelo app enquanto o atendimento não começar e não estiver pago.
        </p>
        {onlineConfig?.enabled && confirmed.payment.status !== 'PAID' && confirmed.totalPriceCents > 0 && (
          <button type="button" onClick={() => setPayingNow(true)} className="btn-primary mt-4 w-full">
            Pagar agora com Pix ou cartão
          </button>
        )}
        <PayOnlineModal appointment={payingNow ? confirmed : null} config={onlineConfig} onClose={() => setPayingNow(false)} />
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link to="/meus-agendamentos" className="btn-primary">
            Ver meus agendamentos
          </Link>
          <button
            type="button"
            onClick={() => {
              setConfirmed(null);
              setTime(null);
              setNotes('');
            }}
            className="btn-secondary"
          >
            Agendar outro serviço
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn space-y-6">
      <header>
        <p className="eyebrow">Agenda</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Agendar horário</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Escolha os serviços, o dia e um horário livre.
          {!isLoggedIn && ' Para confirmar, entre ou crie sua conta.'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <Step number={1} title="Serviços">
            {loadingServices ? (
              <p className="text-sm text-ink-muted">Carregando serviços…</p>
            ) : (
              <fieldset>
                <legend className="mb-3 text-sm text-ink-muted">
                  Marque um ou mais. Todos são feitos no mesmo horário e o tempo é somado.
                </legend>
                {unavailableCount > 0 && (
                  <p className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                    {unavailableCount === 1 ? 'Um serviço escolhido não está disponível' : 'Alguns serviços escolhidos não estão disponíveis'}{' '}
                    para {sizeLabels[effectiveSize].toLowerCase()} e ficou fora do agendamento.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {services.map((s) => (
                    <OptionCard
                      key={s.id}
                      type="checkbox"
                      name="services"
                      checked={serviceIds.includes(s.id)}
                      onChange={() => toggleService(s.id)}
                      title={s.name}
                      subtitle={`Cerca de ${formatDuration(s.durationMinutes)}`}
                      aside={formatPrice(s.priceCents)}
                    />
                  ))}
                </div>
              </fieldset>
            )}
          </Step>

          <Step number={2} title={isLoggedIn ? 'Veículo' : 'Porte do veículo'}>
            {!isLoggedIn && (
              <>
                <SizeSelector value={size} onChange={setSize} label="Qual é o porte do seu veículo?" />
                <p className="mt-3 text-xs text-ink-muted">Você cadastra a placa e o modelo ao confirmar.</p>
              </>
            )}

            {isLoggedIn && loadingVehicles && <p className="text-sm text-ink-muted">Carregando sua garagem…</p>}

            {isLoggedIn && !loadingVehicles && (vehicles.length === 0 || addingVehicle) && (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  {vehicles.length === 0
                    ? 'Cadastre o veículo que será atendido.'
                    : 'Cadastre outro veículo.'}
                </p>
                <VehicleForm
                  defaultSize={size}
                  submitLabel="Salvar veículo"
                  onCancel={vehicles.length > 0 ? () => setAddingVehicle(false) : undefined}
                  onSaved={(v) => {
                    setVehicleId(v.id);
                    setAddingVehicle(false);
                  }}
                />
              </div>
            )}

            {isLoggedIn && !loadingVehicles && vehicles.length > 0 && !addingVehicle && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Veículo">
                  {vehicles.map((v) => (
                    <OptionCard
                      key={v.id}
                      name="vehicle"
                      checked={v.id === vehicleId}
                      onChange={() => setVehicleId(v.id)}
                      title={`${v.make} ${v.model}`}
                      subtitle={`${formatPlate(v.plate)} · ${sizeLabels[v.sizeCategory]}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAddingVehicle(true)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Adicionar outro veículo
                </button>
              </div>
            )}
          </Step>

          <Step number={3} title="Dia">
            {hours && (
              <div className="mb-4 inline-grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1" role="group" aria-label="Forma de exibição dos dias">
                {(
                  [
                    ['list', 'Próximos dias'],
                    ['calendar', 'Calendário'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={dayView === value}
                    onClick={() => setDayView(value)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      dayView === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {!hours ? (
              <p className="text-sm text-ink-muted">Carregando agenda…</p>
            ) : dayView === 'calendar' ? (
              <MonthCalendar hours={hours} selected={date} onSelect={chooseDate} />
            ) : (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {days.map((d) => {
                  const chip = formatDayChip(d.iso);
                  const selected = d.iso === date;
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      disabled={!d.isOpen}
                      aria-pressed={selected}
                      aria-label={`${formatDateLong(d.iso)}${d.isOpen ? '' : ', fechado'}`}
                      onClick={() => chooseDate(d.iso)}
                      className={`flex min-w-[64px] flex-col items-center rounded-xl border px-3 py-2 text-sm transition ${
                        selected
                          ? 'border-accent bg-accent text-accent-ink'
                          : d.isOpen
                            ? 'border-line-strong bg-surface text-ink hover:border-accent'
                            : 'cursor-not-allowed border-line bg-subtle text-ink-muted'
                      }`}
                    >
                      <span className="text-xs font-semibold capitalize">{chip.weekday}</span>
                      <span className="font-bold">{chip.day}</span>
                      {!d.isOpen && <span className="text-[10px]">Fechado</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </Step>

          <Step number={4} title="Horário">
            <SlotPicker
              hasService={selected.length > 0}
              query={availabilityQuery}
              selected={time}
              onSelect={(t) => {
                setTime(t);
                setCustomTime('');
              }}
              customTime={customTime}
              onCustomTime={(t) => {
                setCustomTime(t);
                setTime(null);
              }}
            />
          </Step>

          {isLoggedIn && (
            <Step number={5} title="Observações" optional>
              <label htmlFor="booking-notes" className="sr-only">Observações</label>
              <textarea
                id="booking-notes"
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: atenção com o adesivo do vidro traseiro, pelos de animal no banco…"
                className="field"
              />

              {telebuscaAvailable && (
                <div className="mt-4 space-y-3 rounded-xl border border-line p-4">
                  <label className="flex items-start gap-2.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={telebusca}
                      onChange={(e) => setTelebusca(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-amber-500"
                    />
                    <span>
                      <strong className="font-semibold">Buscar e entregar meu carro (Telebusca)</strong>
                      <span className="block text-ink-muted">
                        Taxa de {formatPrice(settings?.telebuscaFeeCents ?? 0)}.
                      </span>
                    </span>
                  </label>
                  {telebusca &&
                    (addresses.length > 0 ? (
                      <div>
                        <label htmlFor="pickup-address" className="label">Endereço de coleta</label>
                        <select
                          id="pickup-address"
                          value={addressId}
                          onChange={(e) => setAddressId(e.target.value)}
                          className="field"
                        >
                          {addresses.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label} — {a.street}, {a.number}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-muted">
                        Você ainda não tem endereço cadastrado.{' '}
                        <Link to="/enderecos" className="font-semibold text-accent-text underline">
                          Cadastrar endereço
                        </Link>
                      </p>
                    ))}
                </div>
              )}
            </Step>
          )}
        </div>

        <aside className="card space-y-4 p-5 lg:sticky lg:top-24" aria-labelledby="resumo-titulo">
          <h2 id="resumo-titulo" className="font-bold text-ink">Resumo</h2>
          <dl className="space-y-2 text-sm">
            {selected.length === 0 && <SummaryRow label="Serviço" value="—" />}
            {selected.map((s) => (
              <SummaryRow key={s.id} label={s.name} value={coveredIds.has(s.id) ? 'Incluso na assinatura' : formatPrice(s.priceCents)} />
            ))}
            <SummaryRow
              label="Veículo"
              value={vehicle ? `${vehicle.make} ${vehicle.model}` : sizeLabels[effectiveSize]}
            />
            <SummaryRow label="Data" value={date ? formatDateLong(date) : '—'} />
            <SummaryRow label="Horário" value={selectedTime ?? '—'} />
            {selected.length > 0 && (
              <SummaryRow label="Duração" value={`cerca de ${formatDuration(servicesDuration)}`} />
            )}
            {telebusca && <SummaryRow label="Telebusca" value={formatPrice(telebuscaFee)} />}
          </dl>
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm font-semibold text-ink">Total</span>
            <span className="text-2xl font-extrabold text-ink">{selected.length > 0 ? formatPrice(total) : '—'}</span>
          </div>
          {subscription && (
            <p className="text-xs font-semibold text-success">
              {subscription.remaining > 0
                ? `Assinatura ${subscription.planName}: ${subscription.remaining} lavagem(ns) restante(s) neste período.`
                : `Assinatura ${subscription.planName}: as lavagens deste período já foram usadas.`}
            </p>
          )}
          {selectedTime && <ArrivalNotice text={arrivalNotice(selectedTime, telebusca)} />}
          <p className="text-xs text-ink-muted">
            {onlineConfig?.enabled
              ? 'Depois de confirmar, pague online com Pix ou cartão, ou no local, na retirada do veículo.'
              : 'Pagamento no local, na retirada do veículo.'}
          </p>

          {book.error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
              {book.error.message}
            </p>
          )}

          {isLoggedIn ? (
            <>
              <button
                type="button"
                disabled={missing.length > 0 || book.isPending}
                onClick={() => book.mutate()}
                className="btn-primary w-full py-3"
              >
                {book.isPending ? 'Confirmando…' : 'Confirmar agendamento'}
              </button>
              {missing.length > 0 && (
                <p className="text-xs text-ink-muted">Falta escolher: {missing.join(', ')}.</p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => openAuthModal('register', 'Crie sua conta para confirmar o agendamento.')}
                className="btn-primary w-full py-3"
              >
                Criar conta e agendar
              </button>
              <button
                type="button"
                onClick={() => openAuthModal('login', 'Entre para confirmar o agendamento.')}
                className="btn-secondary w-full"
              >
                Já tenho conta
              </button>
            </div>
          )}

          <a
            href={whatsappLink(whatsappMessage)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Prefere agendar pelo WhatsApp?
          </a>
        </aside>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  optional,
  children,
}: {
  number: number;
  title: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const id = `step-${number}`;
  return (
    <section aria-labelledby={id} className="card p-5">
      <h2 id={id} className="mb-4 flex items-center gap-2.5 font-bold text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-xs font-bold text-ink">
          {number}
        </span>
        {title}
        {optional && <span className="text-xs font-normal text-ink-muted">(opcional)</span>}
      </h2>
      {children}
    </section>
  );
}

function OptionCard({
  type = 'radio',
  name,
  checked,
  onChange,
  title,
  subtitle,
  aside,
}: {
  type?: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle?: string;
  aside?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 transition focus-within:ring-2 focus-within:ring-accent ${
        checked ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-accent'
      }`}
    >
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        {subtitle && <span className="block text-xs text-ink-muted">{subtitle}</span>}
      </span>
      {aside && <span className="text-sm font-bold text-ink">{aside}</span>}
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink first-letter:uppercase">{value}</dd>
    </div>
  );
}

const slotClasses: Record<SlotStatus, string> = {
  AVAILABLE: 'border-line-strong bg-surface text-ink hover:border-accent',
  LIMITED: 'border-line-strong bg-surface text-ink hover:border-accent',
  FULL: 'cursor-not-allowed border-line bg-subtle text-ink-muted',
};

function SlotPicker({
  hasService,
  query,
  selected,
  onSelect,
  customTime,
  onCustomTime,
}: {
  hasService: boolean;
  query: { data?: Availability; isLoading: boolean; isError: boolean; error: Error | null };
  selected: string | null;
  onSelect: (time: string) => void;
  customTime: string;
  onCustomTime: (time: string) => void;
}) {
  if (!hasService) return <p className="text-sm text-ink-muted">Escolha um serviço para ver os horários.</p>;
  if (query.isLoading) return <p className="text-sm text-ink-muted">Carregando horários…</p>;
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-danger" role="alert">
        {query.error?.message ?? 'Não foi possível carregar os horários.'}
      </p>
    );
  }

  const availability = query.data;
  if (!availability.isOpen) return <p className="text-sm text-ink-muted">Não abrimos neste dia. Escolha outra data.</p>;
  if (availability.slots.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Não há mais horários neste dia. Escolha outra data ou fale com a gente pelo WhatsApp.
      </p>
    );
  }

  const groups = availability.slots.reduce<Record<string, Availability['slots']>>((acc, slot) => {
    (acc[slot.shift] ??= []).push(slot);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([shift, slots]) => (
        <div key={shift}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-muted">{shiftLabels[shift]}</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {slots.map((slot) => {
              const isSelected = selected === slot.time;
              const status = slot.status === 'FULL' ? ', lotado' : slot.status === 'LIMITED' ? ', poucas vagas' : '';
              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={slot.status === 'FULL'}
                  aria-pressed={isSelected}
                  aria-label={`${slot.time}${status}`}
                  onClick={() => onSelect(slot.time)}
                  className={`rounded-xl border px-2 py-2 text-center transition ${
                    isSelected ? 'border-accent bg-accent text-accent-ink' : slotClasses[slot.status]
                  }`}
                >
                  <span className={`block font-mono text-sm font-bold ${slot.status === 'FULL' ? 'line-through' : ''}`}>
                    {slot.time}
                  </span>
                  {slot.status === 'LIMITED' && (
                    <span className={`block text-[10px] font-semibold ${isSelected ? '' : 'text-warning'}`}>
                      Poucas vagas
                    </span>
                  )}
                  {slot.status === 'FULL' && <span className="block text-[10px]">Lotado</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {availability.freeTime && (
        <div className="max-w-[200px]">
          <label htmlFor="custom-time" className="label">Ou informe outro horário</label>
          <input
            id="custom-time"
            type="time"
            value={customTime}
            onChange={(e) => onCustomTime(e.target.value)}
            className="field font-mono"
          />
        </div>
      )}
    </div>
  );
}

const weekdayHeaders = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function MonthCalendar({
  hours,
  selected,
  onSelect,
}: {
  hours: OpeningHours;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const maxDate = addDaysISO(hours.today, hours.bookingWindowDays);
  const [month, setMonth] = useState((selected ?? hours.today).slice(0, 7));
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const leadingBlanks = dayOfWeekISO(`${month}-01`);
  const title = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 15)),
  );

  const shiftMonth = (delta: number) =>
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7));

  return (
    <div className="max-w-sm">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={month <= hours.today.slice(0, 7)}
          aria-label="Mês anterior"
          className="rounded-lg p-2 text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="font-bold capitalize text-ink" aria-live="polite">{title}</p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={month >= maxDate.slice(0, 7)}
          aria-label="Próximo mês"
          className="rounded-lg p-2 text-ink transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdayHeaders.map((w) => (
          <span key={w} className="py-1 text-xs font-semibold text-ink-muted" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`;
          const open = isDayOpen(hours, iso);
          const isSelected = iso === selected;
          const isToday = iso === hours.today;
          return (
            <button
              key={iso}
              type="button"
              disabled={!open}
              aria-pressed={isSelected}
              aria-label={`${formatDateLong(iso)}${open ? '' : ', indisponível'}`}
              onClick={() => onSelect(iso)}
              className={`aspect-square rounded-lg text-sm font-semibold transition ${
                isSelected
                  ? 'bg-accent text-accent-ink'
                  : open
                    ? 'border border-line-strong text-ink hover:border-accent hover:bg-subtle'
                    : 'cursor-not-allowed text-ink-muted opacity-50'
              } ${isToday && !isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Dias apagados estão fechados ou fora do prazo de agendamento ({hours.bookingWindowDays} dias).
      </p>
    </div>
  );
}

function ArrivalNotice({ text, className = '' }: { text: string; className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-left text-sm font-semibold text-warning ${className}`}>
      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}
