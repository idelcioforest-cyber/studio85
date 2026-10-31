import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SiteEventInput } from '@autowash/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, toZonedDateString, zonedTimeToUtc } from '../../common/utils/timezone.util';

// Os dias contam no fuso da loja (o mesmo do registro de acesso no login)
const TIMEZONE = 'America/Sao_Paulo';

// Só clientes: a equipe do lava-jato e o dono da plataforma não entram nos números
const CLIENTS: Prisma.UserWhereInput = {
  roles: { some: { role: { name: 'CLIENT' } } },
  NOT: { roles: { some: { role: { name: { in: ['ADMIN', 'MANAGER', 'ATTENDANT', 'WASHER', 'SUPER_ADMIN'] } } } } },
};

// Robôs de busca e prévias de link não contam como visita
const BOT_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp|curl|python|axios/i;

/**
 * Indicadores do dono da plataforma: uso do app, cadastros, agendamentos e funil do agendamento.
 */
@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  /** Registra uma etapa da medição anônima (uma vez por código de aba, por etapa, por dia) */
  async recordEvent(input: SiteEventInput, userAgent: string | undefined) {
    if (!userAgent || BOT_AGENT.test(userAgent)) return;
    const day = toZonedDateString(new Date(), TIMEZONE);
    await this.prisma.siteEvent.createMany({ data: [{ type: input.type, sessionId: input.sessionId, day }], skipDuplicates: true });
  }

  async overview(days: number) {
    const today = toZonedDateString(new Date(), TIMEZONE);
    const from = addDays(today, -(days - 1));
    const period = { gte: zonedTimeToUtc(from, '00:00', TIMEZONE), lt: zonedTimeToUtc(addDays(today, 1), '00:00', TIMEZONE) };
    const dayRange = { gte: from, lte: today };
    const dayOf = (instant: Date) => toZonedDateString(instant, TIMEZONE);

    const [
      clients,
      signups,
      pendingVerification,
      incompleteProfile,
      neverBooked,
      activity,
      events,
      appointments,
      services,
      categories,
      subscriptionsActive,
      online,
      whatsappSent,
      topServices,
      unfinished,
    ] = await Promise.all([
      this.prisma.user.count({ where: { ...CLIENTS, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } } }),
      this.prisma.user.findMany({ where: { ...CLIENTS, createdAt: period }, select: { createdAt: true } }),
      this.prisma.user.count({ where: { ...CLIENTS, status: 'PENDING_VERIFICATION' } }),
      this.prisma.user.count({ where: { ...CLIENTS, status: 'ACTIVE', OR: [{ profileIncomplete: true }, { mustChangePassword: true }] } }),
      this.prisma.user.count({ where: { ...CLIENTS, status: 'ACTIVE', appointments: { none: {} } } }),
      this.prisma.userActivityDay.findMany({ where: { day: dayRange, user: CLIENTS }, select: { userId: true, day: true } }),
      this.prisma.siteEvent.groupBy({ by: ['type', 'day'], where: { day: dayRange }, _count: { _all: true } }),
      this.prisma.appointment.findMany({ where: { createdAt: period }, select: { createdAt: true, source: true, status: true } }),
      this.prisma.service.groupBy({ by: ['isActive'], _count: { _all: true } }),
      this.prisma.serviceCategory.count({ where: { isActive: true } }),
      this.prisma.customerSubscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.payment.aggregate({
        where: { provider: 'PAGARME', status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paidAt: period },
        _count: { _all: true },
        _sum: { amountCents: true, refundedCents: true, platformFeeCents: true },
      }),
      this.prisma.whatsAppMessage.count({ where: { status: 'SENT', createdAt: period } }),
      this.prisma.appointmentService.groupBy({
        by: ['serviceNameSnapshot'],
        where: { appointment: { createdAt: period, status: { notIn: ['CANCELLED'] } } },
        _count: { _all: true },
        orderBy: { _count: { serviceNameSnapshot: 'desc' } },
        take: 8,
      }),
      this.prisma.user.findMany({
        where: { ...CLIENTS, OR: [{ status: 'PENDING_VERIFICATION' }, { status: 'ACTIVE', profileIncomplete: true }] },
        select: { name: true, email: true, phone: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    // Série por dia: visitas, clientes que entraram, cadastros e agendamentos (app e equipe)
    const series = new Map(
      Array.from({ length: days }, (_, i) => addDays(from, i)).map((day) => [
        day,
        { day, visits: 0, activeUsers: 0, signups: 0, bookingsApp: 0, bookingsStaff: 0 },
      ]),
    );
    const funnel = { visit: 0, booking_open: 0, booking_slot: 0, booking_done: 0 } as Record<string, number>;
    for (const e of events) {
      if (e.type in funnel) funnel[e.type] += e._count._all;
      if (e.type === 'visit') series.get(e.day)!.visits += e._count._all;
    }
    for (const a of activity) {
      const point = series.get(a.day);
      if (point) point.activeUsers++;
    }
    for (const s of signups) {
      const point = series.get(dayOf(s.createdAt));
      if (point) point.signups++;
    }
    const bookings = { total: appointments.length, app: 0, staff: 0, cancelled: 0, noShow: 0, delivered: 0 };
    for (const a of appointments) {
      const point = series.get(dayOf(a.createdAt));
      if (a.source === 'APP') {
        bookings.app++;
        if (point) point.bookingsApp++;
      } else {
        bookings.staff++;
        if (point) point.bookingsStaff++;
      }
      if (a.status === 'CANCELLED') bookings.cancelled++;
      if (a.status === 'NO_SHOW') bookings.noShow++;
      if (a.status === 'DELIVERED') bookings.delivered++;
    }

    const servicesActive = services.find((s) => s.isActive)?._count._all ?? 0;
    const servicesInactive = services.find((s) => !s.isActive)?._count._all ?? 0;
    const onlineNet = (online._sum.amountCents ?? 0) - (online._sum.refundedCents ?? 0);

    return {
      period: { from, to: today, days },
      users: {
        clients,
        signups: signups.length,
        activeInPeriod: new Set(activity.map((a) => a.userId)).size,
        activeToday: series.get(today)?.activeUsers ?? 0,
        pendingVerification,
        incompleteProfile,
        neverBooked,
      },
      funnel: {
        visits: funnel.visit,
        bookingOpen: funnel.booking_open,
        bookingSlot: funnel.booking_slot,
        bookingDone: funnel.booking_done,
        // Abriram o agendamento e não confirmaram
        abandoned: Math.max(0, funnel.booking_open - funnel.booking_done),
      },
      bookings,
      catalog: { servicesActive, servicesInactive, categories },
      subscriptionsActive,
      online: { count: online._count._all, netCents: onlineNet, platformFeeCents: online._sum.platformFeeCents ?? 0 },
      whatsappSent,
      topServices: topServices.map((s) => ({ name: s.serviceNameSnapshot, count: s._count._all })),
      unfinishedSignups: unfinished.map((u) => ({
        name: u.name,
        email: u.email,
        phone: u.phone,
        createdAt: u.createdAt,
        reason: u.status === 'PENDING_VERIFICATION' ? 'Não confirmou o e-mail' : 'Não completou o cadastro',
      })),
      series: [...series.values()],
    };
  }
}
