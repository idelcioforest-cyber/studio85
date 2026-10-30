import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, MessageCircle, Pencil, Plus, RefreshCw, Search, Trash2, XCircle } from 'lucide-react';
import { MAX_PLAN_SERVICES, OnlineFeeRates, VehicleSizeCategory, cardCharge } from '@autowash/shared';
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { centsToInput, formatDateShort, formatPhone, formatPlate, formatPrice, parsePriceInput, sizeLabels } from '../lib/format';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  washesPerMonth: number;
  isActive: boolean;
  services: { id: string; name: string; isActive: boolean }[];
  prices: { sizeCategory: VehicleSizeCategory; priceCents: number }[];
  subscribers: number;
}

type SubStatus = 'PENDING_CARD' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

interface Subscription {
  id: string;
  planName: string;
  status: SubStatus;
  washesPerMonth: number;
  used: number;
  priceCents: number;
  customerFeeCents: number;
  chargedCents: number;
  card: { brand: string | null; last4: string } | null;
  periodEnd: string | null;
  processing: boolean;
  linkActive: boolean;
  linkExpiresAt: string | null;
  lastError: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  customer: { id: string; name: string; phone: string | null };
  vehicle: { id: string; label: string; plate: string | null };
}

interface CatalogCategory {
  id: string;
  name: string;
  services: { id: string; name: string; isActive: boolean }[];
}

interface CustomerSearch {
  clients: {
    id: string;
    name: string;
    phone: string;
    vehicles: { id: string; plate: string | null; make: string; model: string; color: string | null; sizeCategory: VehicleSizeCategory }[];
  }[];
}

interface LinkResult {
  setupUrl: string;
  customerName: string;
  phone: string | null;
}

const ALL_SIZES = [
  VehicleSizeCategory.SMALL,
  VehicleSizeCategory.MEDIUM,
  VehicleSizeCategory.SUV,
  VehicleSizeCategory.PICKUP,
  VehicleSizeCategory.SPECIAL,
];

const STATUS: Record<SubStatus, { label: string; className: string }> = {
  PENDING_CARD: { label: 'Aguardando cartão', className: 'bg-warning/10 text-warning' },
  ACTIVE: { label: 'Ativa', className: 'bg-success/10 text-success' },
  PAST_DUE: { label: 'Pagamento atrasado', className: 'bg-danger/10 text-danger' },
  CANCELED: { label: 'Cancelada', className: 'bg-subtle text-ink-muted' },
};

const formatDate = (iso: string | null) => (iso ? formatDateShort(iso) : '—');

export default function AdminAssinaturasPage() {
  const [tab, setTab] = useState<'subscribers' | 'plans'>('subscribers');
  const [link, setLink] = useState<LinkResult | null>(null);
  const plans = useQuery({ queryKey: ['admin', 'subscription-plans'], queryFn: () => api<Plan[]>('/admin/subscriptions/plans') });
  const subs = useQuery({
    queryKey: ['admin', 'subscriptions'],
    queryFn: () => api<Subscription[]>('/admin/subscriptions'),
    refetchInterval: 30_000,
  });

  // Sem nenhum plano ainda, começa por montar um
  useEffect(() => {
    if (plans.data && plans.data.length === 0) setTab('plans');
  }, [plans.data]);

  return (
    <div className="animate-fadeIn mx-auto max-w-5xl space-y-6">
      <header>
        <p className="eyebrow">Painel</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Assinaturas</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Você monta os planos e ativa para cada cliente. A mensalidade é cobrada todo mês no cartão pelo Pagar.me, e as lavagens do plano
          saem de graça quando o cliente agenda. O site não divulga os planos.
        </p>
      </header>

      <div className="flex gap-1 rounded-xl bg-subtle p-1" role="tablist" aria-label="Seções de assinaturas">
        {(
          [
            ['subscribers', 'Assinantes'],
            ['plans', 'Planos'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'plans' ? (
        <PlansTab plans={plans.data} loading={plans.isLoading} />
      ) : (
        <SubscribersTab subs={subs.data} loading={subs.isLoading} plans={plans.data ?? []} onLink={setLink} />
      )}

      <LinkModal link={link} onClose={() => setLink(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- assinantes

function SubscribersTab({
  subs,
  loading,
  plans,
  onLink,
}: {
  subs: Subscription[] | undefined;
  loading: boolean;
  plans: Plan[];
  onLink: (link: LinkResult) => void;
}) {
  const queryClient = useQueryClient();
  const [activating, setActivating] = useState(false);
  const [canceling, setCanceling] = useState<Subscription | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });

  const regenerate = useMutation({
    mutationFn: (s: Subscription) => api<{ setupUrl: string }>(`/admin/subscriptions/${s.id}/link`, { method: 'POST' }).then((r) => ({ r, s })),
    onSuccess: ({ r, s }) => {
      refresh();
      onLink({ setupUrl: r.setupUrl, customerName: s.customer.name, phone: s.customer.phone });
    },
  });
  const sync = useMutation({
    mutationFn: (id: string) => api(`/admin/subscriptions/${id}/refresh`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const activePlans = plans.filter((p) => p.isActive);
  const error = regenerate.error || sync.error;

  return (
    <section className="space-y-4" aria-label="Assinantes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {subs ? `${subs.filter((s) => s.status === 'ACTIVE').length} ativa(s)` : ' '}
        </p>
        <button type="button" onClick={() => setActivating(true)} disabled={activePlans.length === 0} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Ativar assinatura
        </button>
      </div>
      {activePlans.length === 0 && !loading && (
        <p className="rounded-xl border border-line bg-subtle p-3 text-sm text-ink-muted">Monte um plano na aba Planos para poder ativar.</p>
      )}
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error.message}
        </p>
      )}
      {loading && <p className="py-10 text-center text-sm text-ink-muted">Carregando…</p>}
      {subs && subs.length === 0 && <p className="card p-6 text-center text-sm text-ink-muted">Nenhum assinante ainda.</p>}

      <ul className="space-y-3">
        {subs?.map((s) => (
          <li key={s.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-ink">{s.customer.name}</p>
                <p className="text-sm text-ink-muted">
                  {s.vehicle.label} · {formatPlate(s.vehicle.plate)}
                  {s.customer.phone ? ` · ${formatPhone(s.customer.phone)}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[s.status].className}`}>
                {s.processing ? 'Confirmando pagamento' : STATUS[s.status].label}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-ink-muted">Plano</dt>
                <dd className="font-semibold text-ink">{s.planName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Mensalidade</dt>
                <dd className="font-semibold text-ink">{formatPrice(s.chargedCents)}</dd>
                {s.customerFeeCents > 0 && <dd className="text-xs text-ink-muted">inclui {formatPrice(s.customerFeeCents)} de taxa</dd>}
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Lavagens no mês</dt>
                <dd className="font-semibold text-ink">
                  {s.status === 'ACTIVE' ? `${s.used} de ${s.washesPerMonth}` : `${s.washesPerMonth} por mês`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{s.status === 'CANCELED' ? 'Cancelada em' : 'Pago até'}</dt>
                <dd className="font-semibold text-ink">{formatDate(s.status === 'CANCELED' ? s.canceledAt : s.periodEnd)}</dd>
                {s.card && (
                  <dd className="text-xs text-ink-muted">
                    {s.card.brand ?? 'Cartão'} final {s.card.last4}
                  </dd>
                )}
              </div>
            </dl>

            {s.lastError && s.status !== 'CANCELED' && (
              <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-2.5 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {s.lastError}
              </p>
            )}
            {s.status === 'PENDING_CARD' && !s.processing && (
              <p className="text-xs text-ink-muted">
                {s.linkActive
                  ? `Link enviado ao cliente vale até ${formatDate(s.linkExpiresAt)}. Para mandar de novo, gere outro.`
                  : 'O link expirou: gere outro para o cliente cadastrar o cartão.'}
              </p>
            )}
            {s.cancelReason && s.status === 'CANCELED' && <p className="text-xs text-ink-muted">Motivo: {s.cancelReason}</p>}

            {s.status !== 'CANCELED' && (
              <div className="flex flex-wrap gap-2">
                {s.status === 'PENDING_CARD' && !s.processing && (
                  <button type="button" onClick={() => regenerate.mutate(s)} disabled={regenerate.isPending} className="btn-secondary px-3 py-2">
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    Gerar link do cartão
                  </button>
                )}
                {(s.status !== 'PENDING_CARD' || s.processing) && (
                  <button type="button" onClick={() => sync.mutate(s.id)} disabled={sync.isPending} className="btn-secondary px-3 py-2">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {sync.isPending && sync.variables === s.id ? 'Consultando…' : 'Atualizar'}
                  </button>
                )}
                <button type="button" onClick={() => setCanceling(s)} className="btn-secondary px-3 py-2 text-danger">
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Cancelar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ActivateModal
        open={activating}
        plans={activePlans}
        onClose={() => setActivating(false)}
        onActivated={(result) => {
          setActivating(false);
          refresh();
          onLink(result);
        }}
      />
      <CancelModal subscription={canceling} onClose={() => setCanceling(null)} onDone={refresh} />
    </section>
  );
}

function ActivateModal({
  open,
  plans,
  onClose,
  onActivated,
}: {
  open: boolean;
  plans: Plan[];
  onClose: () => void;
  onActivated: (link: LinkResult) => void;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const { data: settings } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ onlineFees: OnlineFeeRates }>('/settings/admin') });

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(id);
  }, [term]);
  useEffect(() => {
    if (!open) {
      setTerm('');
      setClientId(null);
      setVehicleId(null);
      setPlanId(null);
    }
  }, [open]);

  const search = useQuery({
    queryKey: ['admin', 'customer-search', debounced],
    queryFn: () => api<CustomerSearch>(`/admin/customers/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
  });
  const client = search.data?.clients.find((c) => c.id === clientId) ?? null;
  const vehicle = client?.vehicles.find((v) => v.id === vehicleId) ?? null;
  const options = vehicle ? plans.filter((p) => p.prices.some((pr) => pr.sizeCategory === vehicle.sizeCategory)) : [];

  const activate = useMutation({
    mutationFn: () =>
      api<{ setupUrl: string }>('/admin/subscriptions', { method: 'POST', body: { planId, userId: clientId, vehicleId } }),
    onSuccess: (r) => onActivated({ setupUrl: r.setupUrl, customerName: client!.name, phone: client!.phone }),
  });

  return (
    <Modal open={open} onClose={onClose} title="Ativar assinatura" description="Escolha o cliente, o carro e o plano. Depois é só mandar o link do cartão." size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          activate.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="sub-search" className="label">Cliente (nome, telefone, e-mail ou placa)</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              id="sub-search"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setClientId(null);
                setVehicleId(null);
                setPlanId(null);
              }}
              className="field pl-9"
              autoComplete="off"
            />
          </div>
        </div>

        {!client && debounced.length >= 2 && (
          <ul className="max-h-56 space-y-1 overflow-y-auto" aria-label="Clientes encontrados">
            {search.isLoading && <li className="text-sm text-ink-muted">Buscando…</li>}
            {search.data?.clients.length === 0 && <li className="text-sm text-ink-muted">Nenhum cliente cadastrado com esse dado.</li>}
            {search.data?.clients.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setClientId(c.id);
                    setVehicleId(c.vehicles.length === 1 ? c.vehicles[0].id : null);
                  }}
                  className="w-full rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-accent"
                >
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {formatPhone(c.phone)} · {c.vehicles.length} veículo(s)
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {client && (
          <fieldset className="space-y-2">
            <legend className="label">Veículo de {client.name}</legend>
            {client.vehicles.length === 0 && <p className="text-sm text-ink-muted">Esse cliente não tem veículo cadastrado.</p>}
            {client.vehicles.map((v) => (
              <label key={v.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-accent">
                <input
                  type="radio"
                  name="sub-vehicle"
                  checked={vehicleId === v.id}
                  onChange={() => {
                    setVehicleId(v.id);
                    setPlanId(null);
                  }}
                  className="accent-amber-500"
                />
                <span className="text-ink">
                  {[v.make, v.model, v.color].filter(Boolean).join(' ')} · {formatPlate(v.plate)} · {sizeLabels[v.sizeCategory]}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {vehicle && (
          <fieldset className="space-y-2">
            <legend className="label">Plano</legend>
            {options.length === 0 && (
              <p className="text-sm text-ink-muted">Nenhum plano ativo tem preço para {sizeLabels[vehicle.sizeCategory]}. Ajuste o plano na aba Planos.</p>
            )}
            {options.map((p) => {
              const price = p.prices.find((pr) => pr.sizeCategory === vehicle.sizeCategory)!.priceCents;
              const charge = settings ? cardCharge(price, 1, settings.onlineFees) : null;
              return (
                <label key={p.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-accent">
                  <input type="radio" name="sub-plan" checked={planId === p.id} onChange={() => setPlanId(p.id)} className="mt-1 accent-amber-500" />
                  <span>
                    <span className="font-semibold text-ink">{p.name}</span>
                    <span className="block text-ink-muted">
                      {p.washesPerMonth} lavagem(ns) por mês · {p.services.map((s) => s.name).join(', ')}
                    </span>
                    <span className="block text-ink">
                      {formatPrice(price)} por mês
                      {charge && charge.feeCents > 0 ? ` · cliente paga ${formatPrice(charge.totalCents)} com a taxa do cartão` : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        {activate.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {activate.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Voltar
          </button>
          <button type="submit" disabled={!planId || !vehicleId || activate.isPending} className="btn-primary">
            <Check className="h-4 w-4" aria-hidden="true" />
            {activate.isPending ? 'Ativando…' : 'Ativar e gerar link'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LinkModal({ link, onClose }: { link: LinkResult | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link?.setupUrl]);
  if (!link) return null;
  const firstName = link.customerName.split(' ')[0];
  const message = `Olá, ${firstName}! Para ativar sua assinatura do Studio 85, cadastre o cartão neste link: ${link.setupUrl}`;
  const phone = (link.phone ?? '').replace(/\D/g, '');
  const whatsapp = phone ? `https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}?text=${encodeURIComponent(message)}` : null;

  return (
    <Modal open onClose={onClose} title="Link do cartão" description={`Mande para ${link.customerName}. Vale por 7 dias e só funciona para essa assinatura.`}>
      <div className="space-y-3">
        <label htmlFor="sub-link" className="sr-only">
          Link do cartão
        </label>
        <input id="sub-link" readOnly value={link.setupUrl} onFocus={(e) => e.target.select()} className="field font-mono text-xs" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(link.setupUrl).catch(() => undefined);
              setCopied(true);
            }}
            className="btn-secondary"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? 'Copiado' : 'Copiar link'}
          </button>
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noreferrer" className="btn-primary">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Enviar no WhatsApp
            </a>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Quando o cliente cadastrar o cartão, a primeira mensalidade é cobrada na hora e a assinatura fica ativa.
        </p>
      </div>
    </Modal>
  );
}

function CancelModal({ subscription, onClose, onDone }: { subscription: Subscription | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [subscription?.id]);
  const cancel = useMutation({
    mutationFn: () => api(`/admin/subscriptions/${subscription!.id}/cancel`, { method: 'POST', body: { reason: reason.trim() || null } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  if (!subscription) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Cancelar assinatura"
      description={`${subscription.customer.name} · ${subscription.planName}. O Pagar.me para de cobrar; o que já foi pago não é devolvido automaticamente.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          cancel.mutate();
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="sub-cancel-reason" className="label">Motivo (opcional)</label>
          <input id="sub-cancel-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="field" />
        </div>
        <p className="text-xs text-ink-muted">Lavagens já agendadas continuam cobertas. Para devolver uma mensalidade, use Estornar em Caixa → Pagamentos online.</p>
        {cancel.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {cancel.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Voltar
          </button>
          <button type="submit" disabled={cancel.isPending} className="btn-primary bg-danger hover:bg-danger/90">
            {cancel.isPending ? 'Cancelando…' : 'Cancelar assinatura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- planos

function PlansTab({ plans, loading }: { plans: Plan[] | undefined; loading: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/subscriptions/plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'subscription-plans'] }),
  });

  return (
    <section className="space-y-4" aria-label="Planos">
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing('new')} className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo plano
        </button>
      </div>
      {remove.error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {remove.error.message}
        </p>
      )}
      {loading && <p className="py-10 text-center text-sm text-ink-muted">Carregando…</p>}
      {plans && plans.length === 0 && (
        <div className="card p-6 text-center">
          <p className="font-semibold text-ink">Nenhum plano ainda</p>
          <p className="mt-1 text-sm text-ink-muted">
            Monte o primeiro: até {MAX_PLAN_SERVICES} serviços, quantas lavagens por mês e o preço para cada porte de carro.
          </p>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {plans?.map((p) => (
          <li key={p.id} className={`card space-y-3 p-4 ${p.isActive ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-ink">{p.name}</p>
                {p.description && <p className="text-sm text-ink-muted">{p.description}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.isActive ? 'bg-success/10 text-success' : 'bg-subtle text-ink-muted'}`}>
                {p.isActive ? 'Ativo' : 'Desativado'}
              </span>
            </div>
            <p className="text-sm text-ink">
              <strong>{p.washesPerMonth}</strong> lavagem(ns) por mês: {p.services.map((s) => s.name).join(', ')}
            </p>
            <ul className="space-y-0.5 text-sm">
              {p.prices.map((pr) => (
                <li key={pr.sizeCategory} className="flex justify-between gap-3">
                  <span className="text-ink-muted">{sizeLabels[pr.sizeCategory]}</span>
                  <span className="font-semibold text-ink">{formatPrice(pr.priceCents)}/mês</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">{p.subscribers} assinante(s)</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(p)} className="btn-secondary px-3 py-2">
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </button>
              {p.subscribers === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Excluir o plano ${p.name}?`)) remove.mutate(p.id);
                  }}
                  className="btn-secondary px-3 py-2 text-danger"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Excluir
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <PlanModal plan={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function PlanModal({ plan, onClose }: { plan: Plan | 'new' | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const open = plan !== null;
  const existing = plan && plan !== 'new' ? plan : null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [washes, setWashes] = useState('4');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(true);

  const catalog = useQuery({
    queryKey: ['admin', 'services'],
    queryFn: () => api<CatalogCategory[]>('/admin/services'),
    enabled: open,
  });
  const { data: settings } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ onlineFees: OnlineFeeRates }>('/settings/admin'), enabled: open });

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setWashes(String(existing?.washesPerMonth ?? 4));
    setServiceIds(existing?.services.map((s) => s.id) ?? []);
    setPrices(Object.fromEntries((existing?.prices ?? []).map((p) => [p.sizeCategory, centsToInput(p.priceCents)])));
    setIsActive(existing?.isActive ?? true);
  }, [open, existing]);

  const services = useMemo(
    () => (catalog.data ?? []).flatMap((c) => c.services.filter((s) => s.isActive || serviceIds.includes(s.id)).map((s) => ({ ...s, category: c.name }))),
    [catalog.data, serviceIds],
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        washesPerMonth: Number(washes),
        serviceIds,
        prices: ALL_SIZES.filter((size) => prices[size]?.trim()).map((size) => ({ sizeCategory: size, priceCents: parsePriceInput(prices[size]) ?? 0 })),
        isActive,
      };
      return existing
        ? api(`/admin/subscriptions/plans/${existing.id}`, { method: 'PUT', body })
        : api('/admin/subscriptions/plans', { method: 'POST', body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subscription-plans'] });
      onClose();
    },
  });

  const toggleService = (id: string) =>
    setServiceIds((current) => (current.includes(id) ? current.filter((s) => s !== id) : current.length < MAX_PLAN_SERVICES ? [...current, id] : current));

  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Editar plano' : 'Novo plano'}
      description={existing ? 'Quem já assina continua com as regras de quando foi ativado.' : 'Tudo livre: você escolhe os serviços, a quantidade e os preços.'}
      size="lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div>
            <label htmlFor="plan-name" className="label">Nome do plano</label>
            <input id="plan-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="field" />
          </div>
          <div>
            <label htmlFor="plan-washes" className="label">Lavagens por mês</label>
            <input id="plan-washes" type="number" min={1} max={31} required value={washes} onChange={(e) => setWashes(e.target.value)} className="field" />
          </div>
        </div>
        <div>
          <label htmlFor="plan-desc" className="label">Descrição (opcional)</label>
          <input id="plan-desc" maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)} className="field" />
        </div>

        <fieldset className="space-y-2">
          <legend className="label">
            Serviços incluídos ({serviceIds.length} de {MAX_PLAN_SERVICES})
          </legend>
          {catalog.isLoading && <p className="text-sm text-ink-muted">Carregando serviços…</p>}
          <div className="grid max-h-60 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {services.map((s) => {
              const checked = serviceIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${checked ? 'border-accent' : 'border-line'} ${
                    !checked && serviceIds.length >= MAX_PLAN_SERVICES ? 'opacity-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && serviceIds.length >= MAX_PLAN_SERVICES}
                    onChange={() => toggleService(s.id)}
                    className="accent-amber-500"
                  />
                  <span className="text-ink">
                    {s.name}
                    <span className="block text-xs text-ink-muted">{s.category}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="label">Preço por mês para cada porte (deixe vazio o porte que o plano não atende)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALL_SIZES.map((size) => {
              const cents = parsePriceInput(prices[size] ?? '');
              const charge = cents && settings ? cardCharge(cents, 1, settings.onlineFees) : null;
              return (
                <div key={size}>
                  <label htmlFor={`plan-price-${size}`} className="text-xs font-semibold text-ink">
                    {sizeLabels[size]} (R$)
                  </label>
                  <input
                    id={`plan-price-${size}`}
                    inputMode="decimal"
                    placeholder="Não atende"
                    value={prices[size] ?? ''}
                    onChange={(e) => setPrices({ ...prices, [size]: e.target.value })}
                    className="field"
                  />
                  {charge && charge.feeCents > 0 && (
                    <p className="mt-0.5 text-xs text-ink-muted">Cliente paga {formatPrice(charge.totalCents)} com a taxa do cartão</p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5 accent-amber-500" />
          Plano ativo (aparece para ativar em clientes)
        </label>

        {save.error && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Voltar
          </button>
          <button type="submit" disabled={save.isPending || serviceIds.length === 0} className="btn-primary">
            <Check className="h-4 w-4" aria-hidden="true" />
            {save.isPending ? 'Salvando…' : 'Salvar plano'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
