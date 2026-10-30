import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { FinanceNav } from '../components/FinanceNav';
import { ChartCard, ColumnChart, GrowthChart, LineChart, RankedBars } from '../components/charts';
import { api } from '../lib/api';
import { formatPrice, todayISO } from '../lib/format';
import { PaymentMethod, paymentMethodLabels } from '../lib/types';

interface Comparison {
  label: string;
  current: number;
  before: number;
  diff: number;
  money: boolean;
  percent: number | null;
}

interface RevenueReport {
  from: string;
  to: string;
  previous: { from: string; to: string };
  totals: {
    grossCents: number;
    refundsCents: number;
    netCents: number;
    storeCents: number;
    onlineCents: number;
    commissionCents: number;
    washerCents: number;
    discountCents: number;
    paidCount: number;
    avgTicketCents: number;
    customers: number;
    newClients: number;
  };
  statement: { label: string; cents: number; type: 'in' | 'total' | 'out' | 'result' }[];
  series: { granularity: 'day' | 'month'; points: { key: string; storeCents: number; onlineCents: number; count: number }[] };
  byMethod: { method: PaymentMethod; cents: number; count: number }[];
  byService: { name: string; cents: number; count: number; percent: number }[];
  monthly: { month: string; netCents: number; washerCents: number; commissionCents: number; paidCount: number; growthPercent: number | null; partial: boolean }[];
  comparison: Comparison[];
}

// Mesmos períodos do financeiro do AuroraPrompts
const PERIODS = [
  ['today', 'Hoje'],
  ['last7', 'Últimos 7 dias'],
  ['month', 'Mês atual'],
  ['last_month', 'Mês anterior'],
  ['last3', 'Últimos 3 meses'],
  ['last6', 'Últimos 6 meses'],
  ['last12', 'Últimos 12 meses'],
  ['year', 'Ano atual'],
  ['custom', 'Período personalizado'],
] as const;
type PeriodKey = (typeof PERIODS)[number][0];

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function shiftMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolvePeriod(key: PeriodKey, custom: { from: string; to: string }) {
  const today = todayISO();
  const monthStart = `${today.slice(0, 8)}01`;
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDaysISO(today, -6), to: today };
    case 'last_month': {
      const start = shiftMonths(monthStart, -1);
      return { from: start, to: addDaysISO(monthStart, -1) };
    }
    case 'last3':
      return { from: shiftMonths(monthStart, -2), to: today };
    case 'last6':
      return { from: shiftMonths(monthStart, -5), to: today };
    case 'last12':
      return { from: shiftMonths(monthStart, -11), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return custom;
    default:
      return { from: monthStart, to: today };
  }
}

const brDate = (iso: string) => iso.split('-').reverse().join('/');
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const axisMoney = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);

export default function AdminReceitaPage() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState({ from: `${todayISO().slice(0, 8)}01`, to: todayISO() });
  const range = useMemo(() => resolvePeriod(period, custom), [period, custom]);

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['admin', 'revenue', range.from, range.to],
    queryFn: () => api<RevenueReport>(`/admin/revenue?from=${range.from}&to=${range.to}`),
    placeholderData: (prev) => prev,
  });

  const t = data?.totals;
  const daily = data?.series.granularity === 'day';
  const seriesPoints = (data?.series.points ?? []).map((p) => ({
    label: daily ? p.key.slice(8, 10) : monthLabel(p.key),
    title: daily ? brDate(p.key) : monthLabel(p.key),
    values: [p.storeCents, p.onlineCents],
    count: p.count,
  }));
  const netComparison = data?.comparison.find((c) => c.label === 'Faturamento líquido');

  return (
    <div className="animate-fadeIn mx-auto max-w-6xl space-y-6">
      <FinanceNav />
      <header>
        <p className="eyebrow">Financeiro</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Receita</h1>
        <p className="mt-1 text-sm text-ink-muted">Tudo o que entrou, na loja e online pelo app, já descontados os estornos.</p>
      </header>

      {/* Filtros: uma linha acima de tudo o que eles afetam */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rev-period" className="label">Período</label>
          <select id="rev-period" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} className="field">
            {PERIODS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div>
              <label htmlFor="rev-from" className="label">De</label>
              <input id="rev-from" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} className="field" />
            </div>
            <div>
              <label htmlFor="rev-to" className="label">Até</label>
              <input id="rev-to" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} className="field" />
            </div>
          </>
        )}
        {data && (
          <p className="pb-2.5 text-sm text-ink-muted">
            {brDate(data.from)} a {brDate(data.to)}
          </p>
        )}
      </div>

      {isError && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
          Não foi possível carregar a receita.
        </p>
      )}
      {isLoading && <p className="py-10 text-center text-sm text-ink-muted">Carregando receita…</p>}

      {data && t && (
        <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`} aria-busy={isFetching}>
          {/* Número principal + indicadores */}
          <section className="card p-5 sm:p-6" aria-labelledby="rev-hero">
            <p id="rev-hero" className="text-sm font-semibold text-ink-muted">Faturamento líquido</p>
            <p className="mt-1 text-5xl font-extrabold tracking-tight text-ink">{formatPrice(t.netCents)}</p>
            {netComparison && <Delta c={netComparison} vs={`${brDate(data.previous.from)} a ${brDate(data.previous.to)}`} />}
          </section>

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Atendimentos pagos', t.paidCount.toLocaleString('pt-BR'), null],
              ['Ticket médio', formatPrice(t.avgTicketCents), null],
              ['Recebido na loja', formatPrice(t.storeCents), null],
              ['Recebido online', formatPrice(t.onlineCents), 'Pix e cartão pelo app'],
              ['Receita do lava-jato', formatPrice(t.washerCents), 'depois da comissão'],
              ['Comissão da plataforma', formatPrice(t.commissionCents), 'só pagamentos online'],
              ['Estornos', formatPrice(t.refundsCents), null],
              ['Descontos dados', formatPrice(t.discountCents), 'no caixa'],
              ['Clientes atendidos', t.customers.toLocaleString('pt-BR'), 'no período'],
              ['Clientes novos', t.newClients.toLocaleString('pt-BR'), 'cadastros no app'],
            ].map(([label, value, hint]) => (
              <div key={label} className="card min-w-0 p-4">
                <dt className="truncate text-xs font-semibold text-ink-muted">{label}</dt>
                <dd className="mt-1 truncate text-xl font-extrabold text-ink">{value}</dd>
                {hint && <dd className="truncate text-xs text-ink-muted">{hint}</dd>}
              </div>
            ))}
          </dl>

          {/* Demonstrativo */}
          <section className="card overflow-hidden" aria-labelledby="rev-statement">
            <h2 id="rev-statement" className="border-b border-line px-4 py-3 text-sm font-bold text-ink">
              Demonstrativo do período
            </h2>
            <dl className="divide-y divide-line px-4">
              {data.statement.map((line) => (
                <div
                  key={line.label}
                  className={`flex items-center justify-between gap-3 py-2.5 text-sm ${line.type === 'result' ? 'font-extrabold text-ink' : line.type === 'total' ? 'font-bold text-ink' : 'text-ink-muted'}`}
                >
                  <dt className="min-w-0">
                    {line.type === 'out' ? '(−) ' : line.type === 'result' || line.type === 'total' ? '= ' : '(+) '}
                    {line.label}
                  </dt>
                  <dd className="flex-shrink-0 font-semibold text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatPrice(Math.abs(line.cents))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
              As taxas do Pix e do cartão são cobradas pelo Pagar.me direto na parte do lava-jato, antes do repasse diário.
            </p>
          </section>

          {/* Gráficos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title={`Faturamento ${daily ? 'por dia' : 'por mês'}`} subtitle="Na loja e online, já descontados os estornos">
              <ColumnChart
                points={seriesPoints}
                series={[
                  { name: 'Na loja', color: 'var(--viz-1)' },
                  { name: 'Online', color: 'var(--viz-2)' },
                ]}
                format={formatPrice}
                axisFormat={axisMoney}
                ariaLabel={`Faturamento ${daily ? 'por dia' : 'por mês'}: total de ${formatPrice(t.netCents)}`}
              />
            </ChartCard>
            <ChartCard title={`Atendimentos pagos ${daily ? 'por dia' : 'por mês'}`}>
              <LineChart
                points={seriesPoints.map((p) => ({ label: p.label, title: p.title, value: p.count }))}
                color="var(--viz-1)"
                seriesName="atendimentos"
                format={(v) => v.toLocaleString('pt-BR')}
                axisFormat={(v) => v.toLocaleString('pt-BR')}
                ariaLabel={`Atendimentos pagos: ${t.paidCount} no período`}
              />
            </ChartCard>
            <ChartCard title="Últimos 12 meses" subtitle="Receita do lava-jato e comissão da plataforma (o mês atual ainda está em andamento)">
              <ColumnChart
                points={data.monthly.map((m) => ({ label: monthLabel(m.month), title: `${monthLabel(m.month)}${m.partial ? ' (em andamento)' : ''}`, values: [m.washerCents, m.commissionCents] }))}
                series={[
                  { name: 'Lava-jato', color: 'var(--viz-1)' },
                  { name: 'Comissão da plataforma', color: 'var(--viz-2)' },
                ]}
                format={formatPrice}
                axisFormat={axisMoney}
                ariaLabel="Receita dos últimos 12 meses"
              />
            </ChartCard>
            <ChartCard title="Crescimento mês a mês" subtitle="Faturamento líquido sobre o mês anterior">
              <GrowthChart
                points={data.monthly.map((m) => ({ label: monthLabel(m.month), title: monthLabel(m.month), value: m.growthPercent }))}
                ariaLabel="Crescimento mês a mês em percentual"
              />
            </ChartCard>
            <ChartCard title="Formas de pagamento" subtitle="Quanto entrou por cada uma no período">
              <RankedBars
                rows={data.byMethod.map((m) => ({ label: paymentMethodLabels[m.method], value: m.cents, detail: `${m.count} pagamento(s)` }))}
                color="var(--viz-1)"
                format={formatPrice}
              />
            </ChartCard>
            <ChartCard title="Faturamento por serviço" subtitle="Atendimento com vários serviços é dividido pelo preço de cada um">
              <RankedBars
                rows={data.byService.map((s) => ({ label: s.name, value: s.cents, detail: `${s.count}× · ${s.percent.toLocaleString('pt-BR')}%` }))}
                color="var(--viz-1)"
                format={formatPrice}
              />
            </ChartCard>
          </div>

          {/* Comparação automática */}
          <section className="card p-4 sm:p-5" aria-labelledby="rev-compare">
            <h2 id="rev-compare" className="text-sm font-bold text-ink">Comparação automática</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {brDate(data.from)} a {brDate(data.to)} contra o período anterior de mesmo tamanho ({brDate(data.previous.from)} a {brDate(data.previous.to)}).
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
              {data.comparison.map((c) => (
                <div key={c.label} className="rounded-xl border border-line p-3">
                  <dt className="text-xs font-semibold text-ink-muted">{c.label}</dt>
                  <dd className="mt-1 text-lg font-extrabold text-ink">{c.money ? formatPrice(c.current) : c.current.toLocaleString('pt-BR')}</dd>
                  <dd className="text-xs text-ink-muted">antes: {c.money ? formatPrice(c.before) : c.before.toLocaleString('pt-BR')}</dd>
                  <dd>
                    <Delta c={c} compact />
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Os mesmos números em tabela (os gráficos nunca são a única forma de ler um valor) */}
          <details className="card p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-bold text-ink">Ver os números em tabela</summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="mb-2 text-left text-xs text-ink-muted">Faturamento {daily ? 'por dia' : 'por mês'} no período</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="py-2 pr-3 font-semibold">{daily ? 'Dia' : 'Mês'}</th>
                    <th className="py-2 pr-3 text-right font-semibold">Na loja</th>
                    <th className="py-2 pr-3 text-right font-semibold">Online</th>
                    <th className="py-2 pr-3 text-right font-semibold">Total</th>
                    <th className="py-2 text-right font-semibold">Atendimentos</th>
                  </tr>
                </thead>
                <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {seriesPoints
                    .filter((p) => p.values[0] + p.values[1] > 0 || p.count > 0)
                    .map((p) => (
                      <tr key={p.title} className="border-b border-line/60 text-ink">
                        <td className="py-1.5 pr-3">{p.title}</td>
                        <td className="py-1.5 pr-3 text-right">{formatPrice(p.values[0])}</td>
                        <td className="py-1.5 pr-3 text-right">{formatPrice(p.values[1])}</td>
                        <td className="py-1.5 pr-3 text-right font-semibold">{formatPrice(p.values[0] + p.values[1])}</td>
                        <td className="py-1.5 text-right">{p.count}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <table className="mt-6 w-full min-w-[420px] text-sm">
                <caption className="mb-2 text-left text-xs text-ink-muted">Últimos 12 meses</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="py-2 pr-3 font-semibold">Mês</th>
                    <th className="py-2 pr-3 text-right font-semibold">Líquido</th>
                    <th className="py-2 pr-3 text-right font-semibold">Lava-jato</th>
                    <th className="py-2 pr-3 text-right font-semibold">Comissão</th>
                    <th className="py-2 text-right font-semibold">Crescimento</th>
                  </tr>
                </thead>
                <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {data.monthly.map((m) => (
                    <tr key={m.month} className="border-b border-line/60 text-ink">
                      <td className="py-1.5 pr-3">
                        {monthLabel(m.month)}
                        {m.partial && <span className="text-ink-muted"> (parcial)</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{formatPrice(m.netCents)}</td>
                      <td className="py-1.5 pr-3 text-right">{formatPrice(m.washerCents)}</td>
                      <td className="py-1.5 pr-3 text-right">{formatPrice(m.commissionCents)}</td>
                      <td className="py-1.5 text-right">{m.growthPercent === null ? '—' : `${m.growthPercent > 0 ? '+' : ''}${m.growthPercent.toLocaleString('pt-BR')}%`}</td>
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

/** Variação com ícone + texto (nunca só cor) */
function Delta({ c, vs, compact }: { c: Comparison; vs?: string; compact?: boolean }) {
  if (c.diff === 0) return <p className="mt-1 text-xs text-ink-muted">igual ao período anterior</p>;
  const up = c.diff > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const amount = c.money ? formatPrice(Math.abs(c.diff)) : Math.abs(c.diff).toLocaleString('pt-BR');
  return (
    <p className={`mt-1 flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'} font-semibold ${up ? 'text-success' : 'text-danger'}`}>
      <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      {up ? 'subiu' : 'caiu'} {amount}
      {c.percent !== null && ` (${up ? '+' : ''}${c.percent.toLocaleString('pt-BR')}%)`}
      {vs && <span className="font-normal text-ink-muted"> · vs {vs}</span>}
    </p>
  );
}
