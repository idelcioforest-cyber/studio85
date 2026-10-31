import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChartCard, ColumnChart, LineChart, RankedBars } from '../components/charts';
import { api } from '../lib/api';
import { formatDateShort, formatPhone, formatPrice } from '../lib/format';

interface Overview {
  period: { from: string; to: string; days: number };
  users: {
    clients: number;
    signups: number;
    activeInPeriod: number;
    activeToday: number;
    pendingVerification: number;
    incompleteProfile: number;
    neverBooked: number;
  };
  funnel: { visits: number; bookingOpen: number; bookingSlot: number; bookingDone: number; abandoned: number };
  bookings: { total: number; app: number; staff: number; cancelled: number; noShow: number; delivered: number };
  catalog: { servicesActive: number; servicesInactive: number; categories: number };
  subscriptionsActive: number;
  online: { count: number; netCents: number; platformFeeCents: number };
  whatsappSent: number;
  topServices: { name: string; count: number }[];
  unfinishedSignups: { name: string; email: string | null; phone: string | null; createdAt: string; reason: string }[];
  series: { day: string; visits: number; activeUsers: number; signups: number; bookingsApp: number; bookingsStaff: number }[];
}

const PERIODS = [
  [7, 'Últimos 7 dias'],
  [30, 'Últimos 30 dias'],
  [90, 'Últimos 90 dias'],
] as const;

const n = (v: number) => v.toLocaleString('pt-BR');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const axisCount = (v: number) => (Number.isInteger(v) ? n(v) : '');

/**
 * Área do dono da plataforma: como o app está sendo usado. Os números da equipe do lava-jato não entram.
 */
export default function SuperAdminPage() {
  const [days, setDays] = useState<number>(30);
  const { data, isLoading, isError, isPlaceholderData } = useQuery({
    queryKey: ['super', 'overview', days],
    queryFn: () => api<Overview>(`/super/overview?days=${days}`),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });

  const points = (data?.series ?? []).map((p) => ({ ...p, label: shortDay(p.day), title: brDate(p.day) }));

  return (
    <div className="animate-fadeIn mx-auto max-w-6xl space-y-6">
      <header>
        <p className="eyebrow">Super admin</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Plataforma</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Como o app está sendo usado: visitas, clientes que entram, cadastros, agendamentos e onde as pessoas desistem.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="super-period" className="label">Período</label>
          <select id="super-period" value={days} onChange={(e) => setDays(Number(e.target.value))} className="field">
            {PERIODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {data && (
          <p className="pb-2.5 text-sm text-ink-muted">
            {brDate(data.period.from)} a {brDate(data.period.to)}
          </p>
        )}
      </div>

      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar os indicadores.
        </p>
      )}
      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando indicadores…</p>}

      {data && (
        <div className={`space-y-6 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={isPlaceholderData}>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              ['Visitas ao app', n(data.funnel.visits), 'abriram o site ou o app'],
              ['Clientes que entraram', n(data.users.activeInPeriod), `${n(data.users.activeToday)} hoje`],
              ['Novos cadastros', n(data.users.signups), `${n(data.users.clients)} clientes no total`],
              ['Agendamentos', n(data.bookings.total), `${n(data.bookings.app)} pelo app · ${n(data.bookings.staff)} pela equipe`],
              ['Serviços ativos', n(data.catalog.servicesActive), `${n(data.catalog.categories)} categoria(s)`],
              ['Pagamentos online', n(data.online.count), formatPrice(data.online.netCents)],
              ['Comissão da plataforma', formatPrice(data.online.platformFeeCents), 'nos pagamentos online'],
              ['Assinaturas ativas', n(data.subscriptionsActive), 'hoje'],
              ['Cancelados / não vieram', `${n(data.bookings.cancelled)} / ${n(data.bookings.noShow)}`, 'agendamentos do período'],
              ['Mensagens no WhatsApp', n(data.whatsappSent), 'enviadas no período'],
            ].map(([label, value, hint]) => (
              <div key={label} className="card min-w-0 p-4">
                <dt className="text-xs font-semibold leading-snug text-ink-muted">{label}</dt>
                <dd className="mt-1 truncate text-xl font-extrabold text-ink">{value}</dd>
                <dd className="text-xs leading-snug text-ink-muted">{hint}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="super-unfinished">
              <h2 id="super-unfinished" className="text-sm font-bold text-ink">Quem não finalizou</h2>
              <dl className="divide-y divide-line text-sm">
                {[
                  ['Abriram o agendamento e não confirmaram', data.funnel.abandoned, `${pct(data.funnel.abandoned, data.funnel.bookingOpen)} de quem abriu, no período`],
                  ['Cadastraram e não confirmaram o e-mail', data.users.pendingVerification, 'até hoje'],
                  ['Cadastro incompleto (CPF, celular ou senha)', data.users.incompleteProfile, 'até hoje'],
                  ['Cadastrados que nunca agendaram', data.users.neverBooked, 'até hoje'],
                ].map(([label, value, hint]) => (
                  <div key={label as string} className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="min-w-0 text-ink">
                      {label}
                      <span className="block text-xs text-ink-muted">{hint}</span>
                    </dt>
                    <dd className="flex-shrink-0 text-xl font-extrabold text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {n(value as number)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <ChartCard title="Do site até o agendamento" subtitle="Pessoas em cada etapa no período (a equipe do lava-jato não conta)">
              <RankedBars
                color="var(--viz-1)"
                format={n}
                rows={[
                  { label: 'Entraram no app', value: data.funnel.visits },
                  { label: 'Abriram o agendamento', value: data.funnel.bookingOpen, detail: pct(data.funnel.bookingOpen, data.funnel.visits) },
                  { label: 'Escolheram serviço e horário', value: data.funnel.bookingSlot, detail: pct(data.funnel.bookingSlot, data.funnel.visits) },
                  { label: 'Confirmaram o agendamento', value: data.funnel.bookingDone, detail: pct(data.funnel.bookingDone, data.funnel.visits) },
                ]}
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Visitas por dia" subtitle="Abas do site ou do app abertas (uma por dia)">
              <LineChart
                points={points.map((p) => ({ label: p.label, title: p.title, value: p.visits }))}
                color="var(--viz-1)"
                format={n}
                axisFormat={axisCount}
                ariaLabel="Visitas por dia"
                seriesName="visitas"
              />
            </ChartCard>
            <ChartCard title="Clientes que entraram por dia" subtitle="Clientes logados que usaram o app no dia">
              <LineChart
                points={points.map((p) => ({ label: p.label, title: p.title, value: p.activeUsers }))}
                color="var(--viz-1)"
                format={n}
                axisFormat={axisCount}
                ariaLabel="Clientes que entraram por dia"
                seriesName="clientes"
              />
            </ChartCard>
            <ChartCard title="Novos cadastros por dia">
              <ColumnChart
                points={points.map((p) => ({ label: p.label, title: p.title, values: [p.signups] }))}
                series={[{ name: 'cadastros', color: 'var(--viz-1)' }]}
                format={n}
                axisFormat={axisCount}
                ariaLabel="Novos cadastros por dia"
              />
            </ChartCard>
            <ChartCard title="Agendamentos por dia" subtitle="Feitos pelo cliente no app e lançados pela equipe">
              <ColumnChart
                points={points.map((p) => ({ label: p.label, title: p.title, values: [p.bookingsApp, p.bookingsStaff] }))}
                series={[
                  { name: 'Pelo app', color: 'var(--viz-1)' },
                  { name: 'Pela equipe', color: 'var(--viz-2)' },
                ]}
                format={n}
                axisFormat={axisCount}
                ariaLabel="Agendamentos por dia, pelo app e pela equipe"
              />
            </ChartCard>
          </div>

          <ChartCard title="Serviços mais agendados" subtitle={`No período · ${n(data.catalog.servicesActive)} serviço(s) ativo(s)${data.catalog.servicesInactive ? `, ${n(data.catalog.servicesInactive)} desativado(s)` : ''}`}>
            <RankedBars color="var(--viz-1)" format={n} rows={data.topServices.map((s) => ({ label: s.name, value: s.count }))} />
          </ChartCard>

          <section className="card overflow-hidden" aria-labelledby="super-signups">
            <h2 id="super-signups" className="border-b border-line px-4 py-3 text-sm font-bold text-ink">
              Cadastros não finalizados (mais recentes)
            </h2>
            {data.unfinishedSignups.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">Ninguém com cadastro pela metade.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.unfinishedSignups.map((u, i) => (
                  <li key={`${u.email}-${i}`} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{u.name}</span>
                      <span className="block truncate text-ink-muted">
                        {[u.email, u.phone ? formatPhone(u.phone) : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-ink-muted">
                      {u.reason} · {formatDateShort(u.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="card overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-ink">Números por dia (tabela)</summary>
            {/* Rola para o lado no celular: focável para quem usa o teclado */}
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Números por dia">
              <table className="w-full text-sm">
                <thead className="border-y border-line bg-subtle text-left text-xs text-ink-muted">
                  <tr>
                    {['Dia', 'Visitas', 'Clientes que entraram', 'Cadastros', 'Agend. app', 'Agend. equipe'].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {[...points].reverse().map((p) => (
                    <tr key={p.day}>
                      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-ink">
                        {p.title}
                      </th>
                      {[p.visits, p.activeUsers, p.signups, p.bookingsApp, p.bookingsStaff].map((v, k) => (
                        <td key={k} className="px-3 py-2 text-ink">
                          {n(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
