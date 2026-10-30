import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Gráficos em SVG puro, seguindo as regras de visualização do projeto: barras finas (<= 24px) com
 * ponta arredondada só no lado do dado, 2px de folga entre segmentos, linhas de 2px, grade em linha
 * fina sólida, legenda sempre que houver 2+ séries, textos nas cores de texto (nunca na cor da série)
 * e dica de valores no hover, no toque e no foco do teclado. Os números também ficam na tabela da página.
 */

export interface Series {
  name: string;
  color: string; // ex.: 'var(--viz-1)'
}

const AXIS_TEXT = { fill: 'rgb(var(--ink-muted))', fontSize: 11 };
const GRID = { stroke: 'rgb(var(--line))', strokeWidth: 1 };
const PAD = { top: 12, right: 8, bottom: 26, left: 58 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(ref.current.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Escala "redonda": 0, 25, 50, 75, 100… com 4 a 5 divisões */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Retângulo com cantos de 4px só na ponta do dado (topo para cima, base para baixo); quadrado na linha de base */
function barPath(x: number, y: number, w: number, h: number, roundTop: boolean, roundBottom = false) {
  const r = Math.min(4, w / 2, h / 2);
  const tl = roundTop ? r : 0;
  const bl = roundBottom ? r : 0;
  return [
    `M${x},${y + tl}`,
    tl ? `Q${x},${y} ${x + tl},${y}` : '',
    `H${x + w - tl}`,
    tl ? `Q${x + w},${y} ${x + w},${y + tl}` : '',
    `V${y + h - bl}`,
    bl ? `Q${x + w},${y + h} ${x + w - bl},${y + h}` : '',
    `H${x + bl}`,
    bl ? `Q${x},${y + h} ${x},${y + h - bl}` : '',
    'Z',
  ].join(' ');
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

interface TooltipRow {
  name: string;
  value: string;
  color?: string;
}

function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: TooltipRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(160);
  useEffect(() => setW(ref.current?.offsetWidth ?? 160), [title, rows.length]);
  const left = Math.max(0, Math.min(width - w, x - w / 2));
  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ left }}
    >
      <p className="mb-1 font-semibold text-ink-muted">{title}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2 whitespace-nowrap">
          {row.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: row.color }} aria-hidden="true" />}
          <strong className="font-bold text-ink">{row.value}</strong>
          <span className="text-ink-muted">{row.name}</span>
        </p>
      ))}
    </div>
  );
}

function YAxis({ ticks, scale, width, format }: { ticks: number[]; scale: (v: number) => number; width: number; format: (v: number) => string }) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={scale(t)} y2={scale(t)} style={GRID} />
          <text x={PAD.left - 6} y={scale(t)} dy="0.32em" textAnchor="end" style={{ ...AXIS_TEXT, fontVariantNumeric: 'tabular-nums' }}>
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

export interface ColumnPoint {
  label: string; // rótulo curto do eixo
  title: string; // título completo na dica
  values: number[]; // um valor por série (empilhados)
}

/** Colunas empilhadas (ou simples, com 1 série) */
export function ColumnChart({
  points,
  series,
  format,
  axisFormat,
  height = 220,
  ariaLabel,
}: {
  points: ColumnPoint[];
  series: Series[];
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const totals = points.map((p) => p.values.reduce((a, b) => a + b, 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const max = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 52))));

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="group" aria-label={ariaLabel} className="block overflow-visible">
            <YAxis ticks={ticks} scale={y} width={width} format={axisFormat} />
            {points.map((p, i) => {
              const cx = PAD.left + band * i + band / 2;
              let top = y(0);
              const topIndex = p.values.reduce((last, v, k) => (v > 0 ? k : last), -1);
              return (
                <g key={p.label + i} opacity={active === null || active === i ? 1 : 0.55}>
                  {p.values.map((v, k) => {
                    if (v <= 0) return null;
                    const h = (v / max) * plotH;
                    const gap = k > 0 && top < y(0) ? 2 : 0;
                    const segTop = top - h;
                    const d = barPath(cx - barW / 2, segTop, barW, Math.max(1, h - gap), k === topIndex);
                    top = segTop;
                    return <path key={k} d={d} style={{ fill: series[k].color }} />;
                  })}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={height - 8} textAnchor="middle" style={AXIS_TEXT} aria-hidden="true">
                      {p.label}
                    </text>
                  )}
                  {/* Alvo do hover/foco: a faixa inteira, maior que a barra */}
                  <rect
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${p.title}: ${format(totals[i])}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    onClick={() => setActive(i)}
                    className="cursor-pointer outline-none focus-visible:stroke-[rgb(var(--ink))]"
                  />
                </g>
              );
            })}
            <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} style={{ stroke: 'rgb(var(--line-strong))', strokeWidth: 1 }} />
          </svg>
        )}
        {active !== null && points[active] && (
          <Tooltip
            x={PAD.left + band * active + band / 2}
            width={width}
            title={points[active].title}
            rows={[
              ...series.map((s, k) => ({ name: s.name, value: format(points[active].values[k] ?? 0), color: s.color })),
              ...(series.length > 1 ? [{ name: 'total', value: format(totals[active]) }] : []),
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** Linha de uma série com mira vertical que encontra o ponto mais próximo */
export function LineChart({
  points,
  color,
  format,
  axisFormat,
  height = 200,
  ariaLabel,
  seriesName,
}: {
  points: { label: string; title: string; value: number }[];
  color: string;
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  height?: number;
  ariaLabel: string;
  seriesName: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), 0));
  const max = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (plotW * i) / (points.length - 1) : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = points.length ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 52))));
  const nearest = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - PAD.left;
    return Math.max(0, Math.min(points.length - 1, Math.round((rel / Math.max(1, plotW)) * (points.length - 1))));
  };
  const last = points.length - 1;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          className="block overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onMouseMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onClick={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActive((a) => Math.min(last, (a ?? -1) + 1));
            if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? last + 1) - 1));
          }}
          onBlur={() => setActive(null)}
        >
          <YAxis ticks={ticks} scale={y} width={width} format={axisFormat} />
          <path d={area} style={{ fill: color, opacity: 0.1 }} />
          <path d={line} style={{ fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={p.label + i} x={x(i)} y={height - 8} textAnchor="middle" style={AXIS_TEXT} aria-hidden="true">
                {p.label}
              </text>
            ) : null,
          )}
          {active !== null && (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} style={{ stroke: 'rgb(var(--line-strong))', strokeWidth: 1 }} />
          )}
          {[active ?? last].filter((i) => points[i]).map((i) => (
            <circle key={i} cx={x(i)} cy={y(points[i].value)} r={4} style={{ fill: color, stroke: 'rgb(var(--surface))', strokeWidth: 2 }} />
          ))}
        </svg>
      )}
      {active !== null && points[active] && (
        <Tooltip x={x(active)} width={width} title={points[active].title} rows={[{ name: seriesName, value: format(points[active].value), color }]} />
      )}
    </div>
  );
}

/** Barras horizontais ordenadas (uma cor): parte do todo comparável com precisão */
export function RankedBars({ rows, color, format }: { rows: { label: string; value: number; detail?: string }[]; color: string; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0) return <p className="text-sm text-ink-muted">Sem dados no período.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = max > 0 ? (r.value / max) * 100 : 0;
        return (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">
                {r.label}
                {r.detail && <span className="text-ink-muted"> · {r.detail}</span>}
              </span>
              <strong className="flex-shrink-0 font-bold text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {format(r.value)}
              </strong>
            </div>
            <div className="mt-1 h-3.5" aria-hidden="true">
              {r.value > 0 && <div className="h-full rounded-r" style={{ width: `${Math.max(pct, 1.5)}%`, background: color }} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Crescimento em %: barra para cima (azul) ou para baixo (vermelho) a partir do zero */
export function GrowthChart({ points, height = 200, ariaLabel }: { points: { label: string; title: string; value: number | null }[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value ?? 0);
  const extent = Math.max(10, ...values.map((v) => Math.abs(v)));
  const ticksUp = niceTicks(extent, 2);
  const top = ticksUp[ticksUp.length - 1];
  const ticks = [...ticksUp.slice(1).map((t) => -t).reverse(), ...ticksUp];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = points.length ? plotW / points.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => PAD.top + plotH / 2 - (v / top) * (plotH / 2);
  const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 52))));

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda">
        {[
          ['Cresceu', 'var(--viz-1)'],
          ['Caiu', 'var(--viz-down)'],
        ].map(([name, c]) => (
          <li key={name} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="group" aria-label={ariaLabel} className="block overflow-visible">
            <YAxis ticks={ticks} scale={y} width={width} format={(v) => `${v > 0 ? '+' : ''}${v}%`} />
            {points.map((p, i) => {
              const cx = PAD.left + band * i + band / 2;
              const v = p.value;
              const h = v === null ? 0 : Math.abs(y(v) - y(0));
              return (
                <g key={p.label + i} opacity={active === null || active === i ? 1 : 0.55}>
                  {v !== null && v !== 0 && (
                    <path
                      d={barPath(cx - barW / 2, v > 0 ? y(v) : y(0), barW, Math.max(1, h), v > 0, v < 0)}
                      style={{ fill: v > 0 ? 'var(--viz-1)' : 'var(--viz-down)' }}
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={height - 8} textAnchor="middle" style={AXIS_TEXT} aria-hidden="true">
                      {p.label}
                    </text>
                  )}
                  <rect
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${p.title}: ${v === null ? 'sem base de comparação' : pct(v)}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    onClick={() => setActive(i)}
                    className="cursor-pointer outline-none"
                  />
                </g>
              );
            })}
            <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} style={{ stroke: 'rgb(var(--line-strong))', strokeWidth: 1 }} />
          </svg>
        )}
        {active !== null && points[active] && (
          <Tooltip
            x={PAD.left + band * active + band / 2}
            width={width}
            title={points[active].title}
            rows={[{ name: 'sobre o mês anterior', value: points[active].value === null ? 'sem base' : pct(points[active].value!) }]}
          />
        )}
      </div>
    </div>
  );
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card min-w-0 p-4 sm:p-5" aria-label={title}>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
