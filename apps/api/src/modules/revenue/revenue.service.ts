import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, toZonedDateString, zonedTimeToUtc } from '../../common/utils/timezone.util';
import { platformShareCents } from '../pagarme/split-builder';

type PaymentRow = Prisma.PaymentGetPayload<{ include: { order: { include: { appointment: { include: { services: true } } } } } }>;

const METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'] as const;
// Até ~2 meses o gráfico do período vai por dia; acima disso, por mês
const DAILY_LIMIT_DAYS = 62;

interface Totals {
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
}

/**
 * Receita do lava-jato: tudo o que entrou (na loja e online pelo Pagar.me), já descontados os estornos,
 * com a comissão da plataforma separada. Mesmo modelo do financeiro do AuroraPrompts.
 */
@Injectable()
export class RevenueService {
  constructor(private prisma: PrismaService) {}

  async report(from?: string, to?: string) {
    const timeZone = (await this.prisma.businessSettings.findFirst({ select: { timezone: true } }))?.timezone || 'America/Sao_Paulo';
    const today = toZonedDateString(new Date(), timeZone);
    const start = from || `${today.slice(0, 8)}01`;
    const end = to && to >= start ? to : today;
    const days = daysBetween(start, end) + 1;
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -(days - 1));

    const [payments, prevPayments, newClients, prevNewClients, monthly] = await Promise.all([
      this.load(start, end, timeZone),
      this.load(prevStart, prevEnd, timeZone),
      this.countNewClients(start, end, timeZone),
      this.countNewClients(prevStart, prevEnd, timeZone),
      this.monthly(today, timeZone),
    ]);

    const totals = this.totals(payments);
    const prevTotals = this.totals(prevPayments);
    const granularity: 'day' | 'month' = days <= DAILY_LIMIT_DAYS ? 'day' : 'month';

    return {
      from: start,
      to: end,
      previous: { from: prevStart, to: prevEnd },
      totals: { ...totals, newClients },
      statement: [
        { label: 'Recebido na loja', cents: totals.storeCents + this.refundsOf(payments, 'ON_DELIVERY'), type: 'in' },
        { label: 'Recebido online (Pix e cartão pelo app)', cents: totals.onlineCents + this.refundsOf(payments, 'PAGARME'), type: 'in' },
        { label: 'Faturamento bruto', cents: totals.grossCents, type: 'total' },
        { label: 'Estornos', cents: -totals.refundsCents, type: 'out' },
        { label: 'Comissão da plataforma (só pagamentos online)', cents: -totals.commissionCents, type: 'out' },
        { label: 'Receita do lava-jato', cents: totals.washerCents, type: 'result' },
      ],
      series: { granularity, points: this.series(payments, start, end, granularity, timeZone) },
      byMethod: METHODS.map((method) => ({
        method,
        cents: payments.filter((p) => p.method === method).reduce((acc, p) => acc + net(p), 0),
        count: payments.filter((p) => p.method === method).length,
      })).sort((a, b) => b.cents - a.cents),
      byService: this.byService(payments),
      monthly,
      comparison: [
        compare('Faturamento líquido', totals.netCents, prevTotals.netCents, true),
        compare('Atendimentos pagos', totals.paidCount, prevTotals.paidCount, false),
        compare('Ticket médio', totals.avgTicketCents, prevTotals.avgTicketCents, true),
        compare('Recebido online', totals.onlineCents, prevTotals.onlineCents, true),
        compare('Descontos dados', totals.discountCents, prevTotals.discountCents, true),
        compare('Clientes novos', newClients, prevNewClients, false),
      ],
    };
  }

  /** Pagamentos que entraram no período (online estornado depois continua no dia em que foi pago) */
  private load(from: string, to: string, timeZone: string) {
    return this.prisma.payment.findMany({
      where: {
        paidAt: { gte: zonedTimeToUtc(from, '00:00', timeZone), lt: zonedTimeToUtc(addDays(to, 1), '00:00', timeZone) },
        OR: [
          { provider: 'ON_DELIVERY', status: 'PAID' },
          { provider: 'PAGARME', status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'] } },
        ],
      },
      include: { order: { include: { appointment: { include: { services: true } } } } },
      orderBy: { paidAt: 'asc' },
    });
  }

  private totals(payments: PaymentRow[]): Totals {
    let grossCents = 0;
    let refundsCents = 0;
    let storeCents = 0;
    let onlineCents = 0;
    let commissionCents = 0;
    let discountCents = 0;
    const orders = new Set<string>();
    const customers = new Set<string>();
    for (const p of payments) {
      grossCents += p.amountCents;
      refundsCents += p.refundedCents;
      if (p.provider === 'PAGARME') {
        onlineCents += net(p);
        commissionCents += platformShareCents(net(p), p.platformFeePercent ?? 0);
      } else {
        storeCents += net(p);
        discountCents += Math.max(0, p.order.discountCents);
      }
      orders.add(p.orderId);
      const a = p.order.appointment;
      if (a) customers.add(a.userId ?? a.vehiclePlate ?? a.customerName.toLowerCase());
    }
    const netCents = grossCents - refundsCents;
    return {
      grossCents,
      refundsCents,
      netCents,
      storeCents,
      onlineCents,
      commissionCents,
      washerCents: netCents - commissionCents,
      discountCents,
      paidCount: orders.size,
      avgTicketCents: orders.size ? Math.round(netCents / orders.size) : 0,
      customers: customers.size,
    };
  }

  private refundsOf(payments: PaymentRow[], provider: 'ON_DELIVERY' | 'PAGARME') {
    return payments.filter((p) => p.provider === provider).reduce((acc, p) => acc + p.refundedCents, 0);
  }

  /** Um ponto por dia (ou mês) do período, inclusive os sem movimento */
  private series(payments: PaymentRow[], from: string, to: string, granularity: 'day' | 'month', timeZone: string) {
    const keyOf = (date: Date) => {
      const day = toZonedDateString(date, timeZone);
      return granularity === 'day' ? day : day.slice(0, 7);
    };
    const keys: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const key = granularity === 'day' ? d : d.slice(0, 7);
      if (keys[keys.length - 1] !== key) keys.push(key);
    }
    const points = new Map(keys.map((k) => [k, { key: k, storeCents: 0, onlineCents: 0, count: 0 }]));
    for (const p of payments) {
      const point = points.get(keyOf(p.paidAt!));
      if (!point) continue;
      if (p.provider === 'PAGARME') point.onlineCents += net(p);
      else point.storeCents += net(p);
      point.count++;
    }
    return [...points.values()];
  }

  /** Faturamento por serviço: o valor de cada atendimento é dividido na proporção do preço de cada serviço */
  private byService(payments: PaymentRow[]) {
    const services = new Map<string, { name: string; cents: number; count: number }>();
    for (const p of payments) {
      const items = p.order.appointment?.services ?? [];
      const base = items.reduce((acc, s) => acc + s.unitPriceCents, 0);
      for (const s of items) {
        const share = base > 0 ? Math.round((net(p) * s.unitPriceCents) / base) : Math.round(net(p) / items.length);
        const row = services.get(s.serviceNameSnapshot) ?? { name: s.serviceNameSnapshot, cents: 0, count: 0 };
        row.cents += share;
        row.count++;
        services.set(s.serviceNameSnapshot, row);
      }
    }
    const total = [...services.values()].reduce((acc, s) => acc + s.cents, 0);
    return [...services.values()]
      .sort((a, b) => b.cents - a.cents)
      .map((s) => ({ ...s, percent: total ? Math.round((s.cents / total) * 1000) / 10 : 0 }));
  }

  /** Últimos 12 meses (o atual incluso) com crescimento sobre o mês anterior */
  private async monthly(today: string, timeZone: string) {
    const currentMonth = today.slice(0, 7);
    const months: string[] = [];
    let [y, m] = currentMonth.split('-').map(Number);
    for (let i = 0; i < 13; i++) {
      months.unshift(`${y}-${String(m).padStart(2, '0')}`);
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
    }
    const payments = await this.load(`${months[0]}-01`, today, timeZone);
    const rows = months.map((month) => {
      const inMonth = payments.filter((p) => toZonedDateString(p.paidAt!, timeZone).startsWith(month));
      const t = this.totals(inMonth);
      return { month, netCents: t.netCents, washerCents: t.washerCents, commissionCents: t.commissionCents, paidCount: t.paidCount };
    });
    return rows.slice(1).map((row, i) => {
      const prev = rows[i].netCents;
      return { ...row, growthPercent: prev > 0 ? Math.round(((row.netCents - prev) / prev) * 1000) / 10 : null, partial: row.month === currentMonth };
    });
  }

  private countNewClients(from: string, to: string, timeZone: string) {
    return this.prisma.user.count({
      where: {
        createdAt: { gte: zonedTimeToUtc(from, '00:00', timeZone), lt: zonedTimeToUtc(addDays(to, 1), '00:00', timeZone) },
        roles: { some: { role: { name: 'CLIENT' } } },
      },
    });
  }
}

function net(p: { amountCents: number; refundedCents: number }) {
  return p.amountCents - p.refundedCents;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function compare(label: string, current: number, before: number, money: boolean) {
  const diff = current - before;
  return { label, current, before, diff, money, percent: before > 0 ? Math.round((diff / before) * 1000) / 10 : null };
}
