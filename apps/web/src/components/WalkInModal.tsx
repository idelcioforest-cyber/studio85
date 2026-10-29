import React, { useEffect, useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link2, X } from 'lucide-react';
import { VehicleSizeCategory } from '@autowash/shared';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useCatalog } from '../lib/queries';
import { formatDuration, formatPhone, formatPlate, formatPrice, publicSizes, sizeLabels, todayISO } from '../lib/format';

interface SearchResult {
  clients: {
    id: string;
    name: string;
    phone: string;
    email: string;
    vehicles: {
      id: string;
      plate: string | null;
      make: string;
      model: string;
      color: string | null;
      sizeCategory: VehicleSizeCategory;
    }[];
  }[];
  walkIns: {
    customerName: string;
    customerPhone: string | null;
    vehiclePlate: string | null;
    vehicleLabel: string;
    vehicleSize: VehicleSizeCategory;
  }[];
}

interface Suggestion {
  key: string;
  title: string;
  subtitle: string;
  tag: string;
  apply: () => void;
}

type SearchField = 'customerName' | 'customerPhone' | 'plate';

interface StaffSlot {
  time: string;
  shift: string;
  status: 'AVAILABLE' | 'LIMITED' | 'TOLERANCE' | 'FULL';
  used: number;
  capacity: number;
  tolerance: number;
}

const shiftLabels: Record<string, string> = { MANHA: 'Manhã', TARDE: 'Tarde', NOITE: 'Noite' };

const emptyForm = { customerName: '', customerPhone: '', plate: '', vehicleLabel: '', notes: '' };

/**
 * walk-in: cliente que chegou agora (entra direto no pátio).
 * booking: agendamento lançado pela equipe, por exemplo pedido recebido no WhatsApp
 * (escolhe dia e horário; pode usar as vagas de tolerância).
 */
export function WalkInModal({
  open,
  onClose,
  onCreated,
  mode = 'walk-in',
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  mode?: 'walk-in' | 'booking';
}) {
  const isBooking = mode === 'booking';
  const listId = useId();
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('');
  const [vehicleSize, setVehicleSize] = useState<VehicleSizeCategory>(VehicleSizeCategory.MEDIUM);
  // Um ou mais serviços no mesmo atendimento (ocupa a vaga de 1 carro)
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [form, setForm] = useState(emptyForm);
  // Cliente do app escolhido na busca: o atendimento fica vinculado à conta
  const [link, setLink] = useState<{ userId: string; vehicleId: string | null; name: string } | null>(null);
  const [activeField, setActiveField] = useState<SearchField | null>(null);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [highlight, setHighlight] = useState(0);

  const { data: categories = [] } = useCatalog(vehicleSize);
  const services = categories.flatMap((c) => c.services);
  const selectedServices = services.filter((s) => serviceIds.includes(s.id));
  const selectedTotal = selectedServices.reduce((acc, s) => acc + s.priceCents, 0);
  const selectedDuration = selectedServices.reduce((acc, s) => acc + s.durationMinutes, 0);
  const selectedKey = selectedServices.map((s) => s.id).sort().join(',');

  // Horários para a equipe: mostra ocupação e as vagas de tolerância
  const slotsQuery = useQuery({
    queryKey: ['admin', 'staff-availability', date, selectedKey, vehicleSize],
    queryFn: () =>
      api<{ isOpen: boolean; slots: StaffSlot[] }>(
        `/admin/availability?date=${date}&serviceIds=${selectedKey}&sizeCategory=${vehicleSize}`,
      ),
    enabled: open && isBooking && Boolean(selectedKey && date),
  });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const search = useQuery({
    queryKey: ['admin', 'customer-search', debounced],
    queryFn: () => api<SearchResult>(`/admin/customers/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2 && activeField !== null,
  });

  const reset = () => {
    setForm(emptyForm);
    setServiceIds([]);
    setTime('');
    setVehicleSize(VehicleSizeCategory.MEDIUM);
    setLink(null);
    setActiveField(null);
    setTerm('');
  };

  const suggestions: Suggestion[] = [];
  for (const client of search.data?.clients ?? []) {
    const title = `${client.name}${client.phone ? ` · ${formatPhone(client.phone)}` : ''}`;
    if (client.vehicles.length === 0) {
      suggestions.push({
        key: client.id,
        title,
        subtitle: 'Sem veículo cadastrado',
        tag: 'Cliente do app',
        apply: () => {
          setForm((f) => ({ ...f, customerName: client.name, customerPhone: client.phone ?? '' }));
          setLink({ userId: client.id, vehicleId: null, name: client.name });
        },
      });
    }
    for (const v of client.vehicles) {
      const label = [v.make, v.model, v.color].filter(Boolean).join(' ');
      suggestions.push({
        key: v.id,
        title,
        subtitle: `${label} · ${formatPlate(v.plate)} · ${sizeLabels[v.sizeCategory]}`,
        tag: 'Cliente do app',
        apply: () => {
          setForm((f) => ({
            ...f,
            customerName: client.name,
            customerPhone: client.phone ?? '',
            plate: v.plate ?? '',
            vehicleLabel: label,
          }));
          setVehicleSize(v.sizeCategory);
          setLink({ userId: client.id, vehicleId: v.id, name: client.name });
        },
      });
    }
  }
  (search.data?.walkIns ?? []).forEach((w, i) => {
    suggestions.push({
      key: `walkin-${i}`,
      title: `${w.customerName}${w.customerPhone ? ` · ${formatPhone(w.customerPhone)}` : ''}`,
      subtitle: `${w.vehicleLabel} · ${formatPlate(w.vehiclePlate)} · ${sizeLabels[w.vehicleSize]}`,
      tag: 'Já atendido no balcão',
      apply: () => {
        setForm((f) => ({
          ...f,
          customerName: w.customerName,
          customerPhone: w.customerPhone ?? '',
          plate: w.vehiclePlate ?? '',
          vehicleLabel: w.vehicleLabel,
        }));
        setVehicleSize(w.vehicleSize);
        setLink(null);
      },
    });
  });

  const showSuggestions = activeField !== null && debounced.length >= 2 && !link;

  const choose = (s: Suggestion) => {
    s.apply();
    setActiveField(null);
    setTerm('');
  };

  // Digitar em nome, telefone ou placa busca clientes; editar um cliente vinculado desfaz o vínculo
  const onSearchFieldChange = (field: SearchField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = field === 'plate' ? e.target.value.toUpperCase() : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    if (link) setLink(null);
    setActiveField(field);
    setTerm(value);
    setHighlight(0);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;
    // Esc fecha só a lista de sugestões, sem fechar o modal
    if (e.key === 'Escape') {
      e.stopPropagation();
      setActiveField(null);
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(suggestions[highlight]);
    }
  };

  const comboProps = (field: SearchField) => {
    const expanded = showSuggestions && activeField === field;
    return {
      role: 'combobox' as const,
      'aria-autocomplete': 'list' as const,
      'aria-expanded': expanded,
      'aria-controls': expanded ? listId : undefined,
      'aria-activedescendant': expanded && suggestions.length > 0 ? `${listId}-${highlight}` : undefined,
      autoComplete: 'off',
      onChange: onSearchFieldChange(field),
      onKeyDown: onSearchKeyDown,
      onBlur: () => setTimeout(() => setActiveField((f) => (f === field ? null : f)), 150),
    };
  };

  const suggestionList = (field: SearchField) =>
    showSuggestions && activeField === field ? (
      <ul
        id={listId}
        role="listbox"
        aria-label="Clientes encontrados"
        className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-xl"
      >
        {search.isFetching && suggestions.length === 0 && (
          <li className="px-3 py-2 text-sm text-ink-muted">Buscando…</li>
        )}
        {!search.isFetching && suggestions.length === 0 && (
          <li className="px-3 py-2 text-sm text-ink-muted">Nenhum cliente encontrado. Preencha os dados para um cliente novo.</li>
        )}
        {suggestions.map((s, i) => (
          <li
            key={s.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === highlight}
            // Mantém o foco no campo ao pressionar e escolhe no clique (funciona também com leitor de tela)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(s)}
            onMouseEnter={() => setHighlight(i)}
            className={`cursor-pointer rounded-lg px-3 py-2 ${i === highlight ? 'bg-subtle' : ''}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{s.title}</span>
              <span className="flex-shrink-0 text-[11px] font-semibold text-ink-muted">{s.tag}</span>
            </span>
            <span className="block text-xs text-ink-muted">{s.subtitle}</span>
          </li>
        ))}
      </ul>
    ) : null;

  const create = useMutation({
    mutationFn: () => {
      const common = {
        serviceIds: selectedServices.map((s) => s.id),
        customerPhone: form.customerPhone || null,
        plate: form.plate || null,
        notes: form.notes || null,
        vehicleSize,
        vehicleLabel: form.vehicleLabel,
        userId: link?.userId ?? null,
        vehicleId: link?.vehicleId ?? null,
      };
      return isBooking
        ? api('/admin/appointments', {
            method: 'POST',
            body: { ...common, date, time, customerName: link ? null : form.customerName },
          })
        : api('/admin/appointments/walk-in', { method: 'POST', body: { ...common, customerName: form.customerName } });
    },
    onSuccess: () => {
      reset();
      onCreated();
    },
  });

  const set = (field: 'vehicleLabel' | 'notes') =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (field === 'vehicleLabel' && link?.vehicleId) setLink(null);
      setForm({ ...form, [field]: e.target.value });
    };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isBooking ? 'Agendar pelo WhatsApp' : 'Entrada de balcão'}
      description={
        isBooking
          ? 'Busque o cliente pelo nome, telefone ou placa. Se for novo, basta o nome e o veículo.'
          : 'Digite o nome, o telefone ou a placa para encontrar um cliente que já veio antes.'
      }
      size="lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-3.5"
      >
        {create.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {create.error.message}
          </p>
        )}

        {link && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success" role="status">
            <span className="flex items-start gap-2">
              <Link2 className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>
                Vinculado à conta de <strong>{link.name}</strong>. O atendimento aparece no app do cliente.
              </span>
            </span>
            <button
              type="button"
              onClick={() => setLink(null)}
              className="inline-flex flex-shrink-0 items-center gap-1 font-semibold underline"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Desvincular
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="relative">
            <label htmlFor="wi-name" className="label">Nome do cliente</label>
            <input id="wi-name" required value={form.customerName} {...comboProps('customerName')} className="field" />
            {suggestionList('customerName')}
          </div>
          <div className="relative">
            <label htmlFor="wi-phone" className="label">Telefone <span className="font-normal text-ink-muted">(opcional)</span></label>
            <input id="wi-phone" type="tel" value={form.customerPhone} {...comboProps('customerPhone')} className="field" />
            {suggestionList('customerPhone')}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative">
            <label htmlFor="wi-plate" className="label">Placa</label>
            <input
              id="wi-plate"
              value={form.plate}
              maxLength={8}
              placeholder="ABC1D23"
              {...comboProps('plate')}
              className="field font-mono uppercase"
            />
            {suggestionList('plate')}
          </div>
          <div>
            <label htmlFor="wi-model" className="label">Modelo e cor</label>
            <input id="wi-model" required value={form.vehicleLabel} onChange={set('vehicleLabel')} placeholder="Corolla prata" className="field" />
          </div>
          <div>
            <label htmlFor="wi-size" className="label">Porte</label>
            <select
              id="wi-size"
              value={vehicleSize}
              onChange={(e) => {
                setVehicleSize(e.target.value as VehicleSizeCategory);
                if (link?.vehicleId) setLink(null);
              }}
              className="field"
            >
              {publicSizes.map((s) => (
                <option key={s} value={s}>{sizeLabels[s]}</option>
              ))}
            </select>
          </div>
        </div>
        <fieldset>
          <legend className="label">Serviços</legend>
          <p className="-mt-0.5 mb-2 text-xs text-ink-muted">Marque um ou mais. Valores para {sizeLabels[vehicleSize].toLowerCase()}.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {services.map((s) => {
              const checked = serviceIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-3 text-sm transition focus-within:ring-2 focus-within:ring-accent ${
                    checked ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-accent'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setServiceIds((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                      }
                      className="h-4 w-4 accent-amber-500"
                    />
                    <span className="font-semibold text-ink">{s.name}</span>
                  </span>
                  <span className="font-bold text-ink">{formatPrice(s.priceCents)}</span>
                </label>
              );
            })}
          </div>
          {selectedServices.length > 0 && (
            <p className="mt-2 text-sm text-ink">
              Total: <strong>{formatPrice(selectedTotal)}</strong> · cerca de {formatDuration(selectedDuration)}
            </p>
          )}
        </fieldset>

        {isBooking && (
          <fieldset className="space-y-3">
            <legend className="label">Dia e horário</legend>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="wi-date" className="sr-only">Dia</label>
                <input
                  id="wi-date"
                  type="date"
                  min={todayISO()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setTime('');
                  }}
                  className="field"
                />
              </div>
              <div>
                <label htmlFor="wi-time" className="text-xs font-semibold text-ink-muted">Ou digite o horário</label>
                <input id="wi-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field w-32 font-mono" />
              </div>
            </div>

            {selectedServices.length === 0 ? (
              <p className="text-sm text-ink-muted">Escolha os serviços para ver os horários.</p>
            ) : slotsQuery.isLoading ? (
              <p className="text-sm text-ink-muted">Carregando horários…</p>
            ) : slotsQuery.isError ? (
              <p className="text-sm text-danger" role="alert">{slotsQuery.error.message}</p>
            ) : !slotsQuery.data?.isOpen ? (
              <p className="text-sm text-ink-muted">Fechado neste dia. Você ainda pode digitar um horário se for um caso especial dentro de um turno.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(
                  slotsQuery.data.slots.reduce<Record<string, StaffSlot[]>>((acc, slot) => {
                    (acc[slot.shift] ??= []).push(slot);
                    return acc;
                  }, {}),
                ).map(([shift, slots]) => (
                  <div key={shift}>
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted">{shiftLabels[shift]}</p>
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                      {slots.map((slot) => {
                        const selected = time === slot.time;
                        const extra = slot.status === 'TOLERANCE';
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            disabled={slot.status === 'FULL'}
                            aria-pressed={selected}
                            aria-label={`${slot.time}, ${slot.used} de ${slot.capacity} vagas ocupadas${extra ? ', usando tolerância' : ''}${slot.status === 'FULL' ? ', lotado' : ''}`}
                            onClick={() => setTime(slot.time)}
                            className={`rounded-lg border px-2 py-1.5 text-center transition ${
                              selected
                                ? 'border-accent bg-accent text-accent-ink'
                                : slot.status === 'FULL'
                                  ? 'cursor-not-allowed border-line bg-subtle text-ink-muted'
                                  : extra
                                    ? 'border-warning/50 bg-warning/10 text-ink hover:border-accent'
                                    : 'border-line-strong text-ink hover:border-accent'
                            }`}
                          >
                            <span className="block font-mono text-sm font-bold">{slot.time}</span>
                            <span className={`block text-[10px] font-semibold ${selected ? '' : extra ? 'text-warning' : 'text-ink-muted'}`}>
                              {slot.status === 'FULL' ? 'Lotado' : extra ? 'Tolerância' : `${slot.used}/${slot.capacity}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-ink-muted">
                  “Tolerância” são vagas extras que só a equipe usa: para o cliente o horário aparece lotado.
                </p>
              </div>
            )}
          </fieldset>
        )}

        <div>
          <label htmlFor="wi-notes" className="label">Observações <span className="font-normal text-ink-muted">(opcional)</span></label>
          <textarea id="wi-notes" rows={2} value={form.notes} onChange={set('notes')} placeholder="Ex.: arranhão na porta traseira" className="field" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            type="submit"
            disabled={create.isPending || selectedServices.length === 0 || (isBooking && !time)}
            className="btn-primary"
          >
            {create.isPending ? 'Registrando…' : isBooking ? 'Confirmar agendamento' : 'Registrar entrada'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
