import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Check } from 'lucide-react';
import { VehicleSizeCategory } from '@autowash/shared';
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { formatDuration, formatPrice, sizeExamples, sizeLabels } from '../lib/format';

type PricingType = 'FLAT' | 'BY_SIZE';

interface PriceRule {
  sizeCategory: VehicleSizeCategory;
  priceCents: number;
  durationMinutes: number;
}

interface AdminService {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  baseDurationMinutes: number;
  isActive: boolean;
  priceRules: PriceRule[];
}

interface AdminCategory {
  id: string;
  name: string;
  services: AdminService[];
}

const allSizes = [
  VehicleSizeCategory.SMALL,
  VehicleSizeCategory.MEDIUM,
  VehicleSizeCategory.SUV,
  VehicleSizeCategory.PICKUP,
  VehicleSizeCategory.SPECIAL,
];

type SizeOptions = Record<VehicleSizeCategory, { enabled: boolean; price: string; duration: string }>;

const toReais = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const toCents = (value: string) => Math.round(parseFloat(value.replace(/\./g, '').replace(',', '.') || '0') * 100);

function defaultSizeOptions(price = '45,00', duration = '45'): SizeOptions {
  return Object.fromEntries(
    allSizes.map((s) => [s, { enabled: s !== VehicleSizeCategory.SPECIAL, price, duration }]),
  ) as SizeOptions;
}

export default function AdminServicesPage() {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading, isError } = useQuery({
    queryKey: ['admin', 'services'],
    queryFn: () => api<AdminCategory[]>('/admin/services'),
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pricingType, setPricingType] = useState<PricingType>('FLAT');
  const [flatPrice, setFlatPrice] = useState('20,00');
  const [flatDuration, setFlatDuration] = useState('15');
  const [sizeOptions, setSizeOptions] = useState<SizeOptions>(defaultSizeOptions());

  const refresh = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'services'] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
    setSavedMessage(message);
    setTimeout(() => setSavedMessage(null), 3000);
  };

  const save = useMutation({
    mutationFn: () => {
      let basePriceCents: number;
      let baseDurationMinutes: number;
      let priceRules: PriceRule[] = [];

      if (pricingType === 'FLAT') {
        basePriceCents = toCents(flatPrice);
        baseDurationMinutes = Number(flatDuration) || 15;
      } else {
        priceRules = allSizes
          .filter((s) => sizeOptions[s].enabled)
          .map((s) => ({
            sizeCategory: s,
            priceCents: toCents(sizeOptions[s].price),
            durationMinutes: Number(sizeOptions[s].duration) || 45,
          }));
        if (priceRules.length === 0) throw new Error('Habilite pelo menos um porte de veículo.');
        const reference = priceRules.find((r) => r.sizeCategory === VehicleSizeCategory.MEDIUM) ?? priceRules[0];
        basePriceCents = reference.priceCents;
        baseDurationMinutes = reference.durationMinutes;
      }

      const body = {
        categoryId,
        name: name.trim(),
        description: description.trim() || null,
        basePriceCents,
        baseDurationMinutes,
        priceRules,
      };

      return editingId
        ? api(`/admin/services/${editingId}`, { method: 'PATCH', body })
        : api('/admin/services', { method: 'POST', body: { ...body, isActive: true } });
    },
    onSuccess: () => {
      setIsModalOpen(false);
      refresh('Serviço salvo. O catálogo já mostra os novos valores.');
    },
  });

  const toggleActive = useMutation({
    mutationFn: (service: AdminService) =>
      api(`/admin/services/${service.id}`, { method: 'PATCH', body: { isActive: !service.isActive } }),
    onSuccess: () => refresh('Disponibilidade do serviço atualizada.'),
  });

  const openNew = () => {
    setEditingId(null);
    setCategoryId(categories[0]?.id ?? '');
    setName('');
    setDescription('');
    setPricingType('FLAT');
    setFlatPrice('20,00');
    setFlatDuration('15');
    setSizeOptions(defaultSizeOptions());
    save.reset();
    setIsModalOpen(true);
  };

  const openEdit = (service: AdminService) => {
    setEditingId(service.id);
    setCategoryId(service.categoryId);
    setName(service.name);
    setDescription(service.description ?? '');
    setFlatPrice(toReais(service.basePriceCents));
    setFlatDuration(String(service.baseDurationMinutes));
    if (service.priceRules.length > 0) {
      setPricingType('BY_SIZE');
      const options = defaultSizeOptions(toReais(service.basePriceCents), String(service.baseDurationMinutes));
      allSizes.forEach((s) => {
        const rule = service.priceRules.find((r) => r.sizeCategory === s);
        options[s] = rule
          ? { enabled: true, price: toReais(rule.priceCents), duration: String(rule.durationMinutes) }
          : { ...options[s], enabled: false };
      });
      setSizeOptions(options);
    } else {
      setPricingType('FLAT');
      setSizeOptions(defaultSizeOptions(toReais(service.basePriceCents), String(service.baseDurationMinutes)));
    }
    save.reset();
    setIsModalOpen(true);
  };

  const updateSize = (size: VehicleSizeCategory, patch: Partial<SizeOptions[VehicleSizeCategory]>) =>
    setSizeOptions((prev) => ({ ...prev, [size]: { ...prev[size], ...patch } }));

  return (
    <div className="animate-fadeIn mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Serviços e preços</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Preço único para todos os veículos ou valores e tempos diferentes por porte.
          </p>
        </div>
        <button type="button" onClick={openNew} disabled={categories.length === 0} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo serviço
        </button>
      </header>

      {savedMessage && (
        <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success" role="status">
          <Check className="h-4 w-4" aria-hidden="true" />
          {savedMessage}
        </p>
      )}
      {toggleActive.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {toggleActive.error.message}
        </p>
      )}
      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando serviços…</p>}
      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar os serviços.
        </p>
      )}

      {categories.map((category) => (
        <section key={category.id} className="space-y-3" aria-labelledby={`cat-${category.id}`}>
          <h2 id={`cat-${category.id}`} className="text-sm font-bold uppercase tracking-wider text-ink-muted">
            {category.name}
          </h2>
          {category.services.length === 0 && <p className="text-sm text-ink-muted">Nenhum serviço nesta categoria.</p>}
          <ul className="space-y-3">
            {category.services.map((service) => (
              <li key={service.id} className={`card space-y-4 p-5 ${service.isActive ? '' : 'border-dashed'}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-ink">{service.name}</h3>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                          service.isActive
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'border-line bg-subtle text-ink-muted'
                        }`}
                      >
                        {service.isActive ? 'Disponível' : 'Pausado'}
                      </span>
                    </div>
                    {service.description && <p className="text-sm text-ink-muted">{service.description}</p>}
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => toggleActive.mutate(service)}
                      disabled={toggleActive.isPending}
                      className="btn-secondary px-3 py-1.5"
                    >
                      {service.isActive ? 'Pausar' : 'Ativar'}
                    </button>
                    <button type="button" onClick={() => openEdit(service)} className="btn-secondary px-3 py-1.5">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Editar
                    </button>
                  </div>
                </div>

                {service.priceRules.length === 0 ? (
                  <p className="text-sm text-ink">
                    <span className="text-lg font-extrabold">{formatPrice(service.basePriceCents)}</span>
                    <span className="text-ink-muted"> · preço único · cerca de {formatDuration(service.baseDurationMinutes)}</span>
                  </p>
                ) : (
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {service.priceRules.map((rule) => (
                      <div key={rule.sizeCategory} className="rounded-xl bg-subtle p-3">
                        <dt className="text-xs font-semibold text-ink-muted">{sizeLabels[rule.sizeCategory]}</dt>
                        <dd className="font-extrabold text-ink">{formatPrice(rule.priceCents)}</dd>
                        <dd className="text-xs text-ink-muted">{formatDuration(rule.durationMinutes)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Editar serviço' : 'Novo serviço'}
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5"
        >
          {save.error && (
            <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
              {save.error.message}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
            <div>
              <label htmlFor="svc-name" className="label">Nome do serviço</label>
              <input id="svc-name" required value={name} onChange={(e) => setName(e.target.value)} className="field" />
            </div>
            <div>
              <label htmlFor="svc-category" className="label">Categoria</label>
              <select id="svc-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="field">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="svc-desc" className="label">Descrição</label>
            <textarea
              id="svc-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que está incluso no serviço"
              className="field"
            />
          </div>

          <fieldset>
            <legend className="label">Como o serviço é cobrado?</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  ['FLAT', 'Preço único', 'Mesmo valor e tempo para qualquer veículo.'],
                  ['BY_SIZE', 'Por porte do veículo', 'Valor e tempo diferentes para cada porte.'],
                ] as const
              ).map(([value, title, text]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border p-3.5 transition focus-within:ring-2 focus-within:ring-accent ${
                    pricingType === value ? 'border-accent bg-accent/10' : 'border-line-strong hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name="pricing-type"
                    value={value}
                    checked={pricingType === value}
                    onChange={() => setPricingType(value)}
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="block text-xs text-ink-muted">{text}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {pricingType === 'FLAT' ? (
            <div className="grid grid-cols-2 gap-3">
              <MoneyField id="flat-price" label="Valor (R$)" value={flatPrice} onChange={setFlatPrice} />
              <div>
                <label htmlFor="flat-duration" className="label">Duração (min)</label>
                <input
                  id="flat-duration"
                  type="number"
                  min={5}
                  max={900}
                  required
                  value={flatDuration}
                  onChange={(e) => setFlatDuration(e.target.value)}
                  className="field"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {allSizes.map((size) => {
                const option = sizeOptions[size];
                return (
                  <div
                    key={size}
                    className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${
                      option.enabled ? 'border-line-strong' : 'border-dashed border-line'
                    }`}
                  >
                    <label className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={option.enabled}
                        onChange={(e) => updateSize(size, { enabled: e.target.checked })}
                        className="h-4 w-4 accent-amber-500"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-ink">{sizeLabels[size]}</span>
                        <span className="block text-xs text-ink-muted">{sizeExamples[size]}</span>
                      </span>
                    </label>
                    {option.enabled ? (
                      <div className="flex gap-2">
                        <MoneyField
                          id={`price-${size}`}
                          label={`Valor para ${sizeLabels[size]}`}
                          hideLabel
                          value={option.price}
                          onChange={(v) => updateSize(size, { price: v })}
                        />
                        <div className="w-24">
                          <label htmlFor={`dur-${size}`} className="sr-only">Duração para {sizeLabels[size]} em minutos</label>
                          <div className="relative">
                            <input
                              id={`dur-${size}`}
                              type="number"
                              min={5}
                              max={900}
                              required
                              value={option.duration}
                              onChange={(e) => updateSize(size, { duration: e.target.value })}
                              className="field pr-10"
                            />
                            <span className="pointer-events-none absolute right-3 top-2 text-sm text-ink-muted">min</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-ink-muted">Não atende este porte</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={save.isPending} className="btn-primary">
              {save.isPending ? 'Salvando…' : 'Salvar serviço'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MoneyField({
  id,
  label,
  hideLabel,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-32">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'label'}>{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-2 text-sm text-ink-muted">R$</span>
        <input
          id={id}
          inputMode="decimal"
          required
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          className="field pl-9"
        />
      </div>
    </div>
  );
}
