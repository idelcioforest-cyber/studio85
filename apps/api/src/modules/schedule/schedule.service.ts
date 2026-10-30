import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleExceptionInput, UpdateScheduleInput, VehicleSizeCategory } from '@autowash/shared';
import { resolveSelectionPricing } from '../services/pricing.util';
import {
  zonedTimeToUtc,
  toZonedDateString,
  dayOfWeekOf,
  timeToMinutes,
  minutesToTime,
  addDays,
} from '../../common/utils/timezone.util';

type Db = PrismaService | Prisma.TransactionClient;

const SHIFT_ORDER = ['MANHA', 'TARDE', 'NOITE'] as const;
const DEFAULT_SHIFTS: Record<string, { startTime: string; endTime: string; simultaneousCapacity: number; overbookTolerance: number }> = {
  MANHA: { startTime: '08:00', endTime: '12:00', simultaneousCapacity: 2, overbookTolerance: 0 },
  TARDE: { startTime: '13:00', endTime: '18:00', simultaneousCapacity: 2, overbookTolerance: 0 },
  NOITE: { startTime: '18:00', endTime: '21:00', simultaneousCapacity: 1, overbookTolerance: 0 },
};

// Intervalo 0 = horário livre: a agenda sugere horários a cada 15 min, mas aceita qualquer minuto
const FREE_TIME_STEP_MINUTES = 15;
export const BOOKING_WINDOW_DAYS = 60;

// Agendamentos nestes status não ocupam vaga na agenda
export const NON_BLOCKING_STATUSES: AppointmentStatus[] = ['CANCELLED', 'NO_SHOW'];

const DAY_LABELS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
// Dias especiais podem ser marcados com até um ano de antecedência (ex.: feriados)
const EXCEPTION_WINDOW_DAYS = 365;

type OpenShift = { shiftName: string; start: number; end: number; capacity: number; tolerance: number };

interface OpenDay {
  dayOfWeek: number;
  intervalMinutes: number;
  shifts: OpenShift[];
}

/** Tira o período [start, end) dos turnos, dividindo o turno que ficar no meio */
function subtractRange(shifts: OpenShift[], start: number, end: number): OpenShift[] {
  return shifts.flatMap((s) => {
    if (end <= s.start || start >= s.end) return [s];
    const pieces: OpenShift[] = [];
    if (start > s.start) pieces.push({ ...s, end: start });
    if (end < s.end) pieces.push({ ...s, start: end });
    return pieces;
  });
}

export type SlotStatus = 'AVAILABLE' | 'LIMITED' | 'FULL';
// Para a equipe: TOLERANCE = lotado para o cliente, mas ainda dentro da tolerância
export type StaffSlotStatus = SlotStatus | 'TOLERANCE';

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async getTimezone(db: Db = this.prisma): Promise<string> {
    const settings = await db.businessSettings.findFirst({ select: { timezone: true } });
    return settings?.timezone || 'America/Sao_Paulo';
  }

  /**
   * Grade semanal completa (Domingo a Sábado), sempre com os 3 turnos
   */
  async getWeek() {
    const schedules = await this.prisma.businessSchedule.findMany({
      include: { shifts: true },
      orderBy: { dayOfWeek: 'asc' },
    });

    return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
      const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);
      return {
        dayOfWeek,
        isActive: schedule?.isActive ?? false,
        slotIntervalMinutes: schedule?.slotIntervalMinutes ?? 60,
        shifts: SHIFT_ORDER.map((shiftName) => {
          const shift = schedule?.shifts.find((s) => s.shiftName === shiftName);
          return shift
            ? {
                shiftName,
                startTime: shift.startTime,
                endTime: shift.endTime,
                simultaneousCapacity: shift.simultaneousCapacity,
                overbookTolerance: shift.overbookTolerance,
                isActive: shift.isActive,
              }
            : { shiftName, ...DEFAULT_SHIFTS[shiftName], isActive: false };
        }),
      };
    });
  }

  /**
   * Horário de funcionamento público (sem capacidade interna)
   */
  async getOpeningHours() {
    const week = await this.getWeek();
    const today = toZonedDateString(new Date(), await this.getTimezone());

    // Datas com dia especial dentro do prazo de agendamento: o site usa estes horários no lugar da grade
    const exceptionDates = await this.prisma.scheduleException.findMany({
      where: { date: { gte: today, lte: addDays(today, BOOKING_WINDOW_DAYS) } },
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'asc' },
    });
    const specialDays = await Promise.all(
      exceptionDates.map(async ({ date }) => {
        const day = await this.loadOpenDay(this.prisma, date);
        return {
          date,
          isOpen: Boolean(day),
          periods: (day?.shifts ?? []).map((s) => ({ start: minutesToTime(s.start), end: minutesToTime(s.end) })),
        };
      }),
    );

    return {
      bookingWindowDays: BOOKING_WINDOW_DAYS,
      today,
      days: week.map((day) => {
        const shifts = day.shifts.filter((s) => s.isActive);
        return {
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isActive && shifts.length > 0,
          periods: shifts.map((s) => ({ start: s.startTime, end: s.endTime })),
        };
      }),
      specialDays,
    };
  }

  /** Dias especiais de hoje em diante */
  async listExceptions() {
    const today = toZonedDateString(new Date(), await this.getTimezone());
    return this.prisma.scheduleException.findMany({
      where: { date: { gte: today } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }

  async createException(input: ScheduleExceptionInput) {
    const timeZone = await this.getTimezone();
    const today = toZonedDateString(new Date(), timeZone);
    if (input.date < today || input.date > addDays(today, EXCEPTION_WINDOW_DAYS)) {
      throw new BadRequestException('Escolha uma data de hoje até daqui a um ano.');
    }

    const allDay = input.type === 'CLOSED' && Boolean(input.allDay);
    if (input.type === 'OPEN') {
      // Abrir por cima de um horário que já está aberto duplicaria as vagas
      const current = await this.loadOpenDay(this.prisma, input.date);
      const start = timeToMinutes(input.startTime!);
      const end = timeToMinutes(input.endTime!);
      const clash = current?.shifts.find((s) => start < s.end && end > s.start);
      if (clash) {
        throw new BadRequestException(
          `Das ${minutesToTime(clash.start)} às ${minutesToTime(clash.end)} a agenda já está aberta nesse dia. ` +
            'Para receber mais carros nesse horário, aumente a capacidade ou a tolerância do turno.',
        );
      }
      const closedPeriod = await this.prisma.scheduleException.findFirst({
        where: { date: input.date, type: 'CLOSED', startTime: { lt: input.endTime! }, endTime: { gt: input.startTime! } },
      });
      if (closedPeriod) {
        throw new BadRequestException(
          `Das ${closedPeriod.startTime} às ${closedPeriod.endTime} esse dia está fechado. Remova o fechamento antes de abrir esse horário.`,
        );
      }
    }

    const exception = await this.prisma.scheduleException.create({
      data: {
        date: input.date,
        type: input.type,
        startTime: allDay ? null : input.startTime,
        endTime: allDay ? null : input.endTime,
        capacity: input.type === 'OPEN' ? input.capacity ?? 1 : 1,
        note: input.note || null,
      },
    });

    // Fechar não desmarca ninguém: a equipe vê quantos agendamentos já existem no período
    let affectedAppointments = 0;
    if (input.type === 'CLOSED') {
      const from = zonedTimeToUtc(input.date, allDay ? '00:00' : input.startTime!, timeZone);
      const to = allDay ? zonedTimeToUtc(addDays(input.date, 1), '00:00', timeZone) : zonedTimeToUtc(input.date, input.endTime!, timeZone);
      affectedAppointments = await this.prisma.appointment.count({
        where: { status: { notIn: [...NON_BLOCKING_STATUSES, 'DELIVERED'] }, startsAt: { lt: to }, endsAt: { gt: from } },
      });
    }

    return { success: true, exception, affectedAppointments };
  }

  async deleteException(id: string) {
    const exception = await this.prisma.scheduleException.findUnique({ where: { id } });
    if (!exception) throw new NotFoundException('Dia especial não encontrado.');
    await this.prisma.scheduleException.delete({ where: { id } });
    return { success: true };
  }

  async updateWeek(input: UpdateScheduleInput) {
    for (const day of input.days) {
      const active = day.shifts
        .filter((s) => s.isActive)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < active.length; i++) {
        if (active[i].startTime < active[i - 1].endTime) {
          throw new BadRequestException(`Os turnos de ${DAY_LABELS[day.dayOfWeek]} se sobrepõem. Ajuste os horários.`);
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const day of input.days) {
        const schedule = await tx.businessSchedule.upsert({
          where: { dayOfWeek: day.dayOfWeek },
          update: { isActive: day.isActive, slotIntervalMinutes: day.slotIntervalMinutes },
          create: {
            dayOfWeek: day.dayOfWeek,
            isActive: day.isActive,
            slotIntervalMinutes: day.slotIntervalMinutes,
          },
        });

        await tx.scheduleShift.deleteMany({ where: { businessScheduleId: schedule.id } });
        if (day.shifts.length > 0) {
          await tx.scheduleShift.createMany({
            data: day.shifts.map((s) => ({
              businessScheduleId: schedule.id,
              shiftName: s.shiftName,
              startTime: s.startTime,
              endTime: s.endTime,
              simultaneousCapacity: s.simultaneousCapacity,
              overbookTolerance: s.overbookTolerance,
              isActive: s.isActive,
            })),
          });
        }
      }
    });

    return {
      success: true,
      message: 'Grade de horários atualizada.',
      days: await this.getWeek(),
    };
  }

  /**
   * Duração do atendimento usada para montar a agenda
   */
  async resolveDuration(serviceIds: string[], sizeCategory?: VehicleSizeCategory): Promise<number> {
    if (serviceIds.length === 0) return 60;

    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds }, isActive: true },
      include: { priceRules: true },
    });
    if (services.length !== serviceIds.length) throw new NotFoundException('Serviço não encontrado.');

    // Vários serviços no mesmo atendimento: os tempos somam
    const selection = resolveSelectionPricing(services, sizeCategory);
    if (selection.unavailable.length > 0) {
      throw new BadRequestException(
        `${selection.unavailable.join(', ')} não está disponível para o porte selecionado.`,
      );
    }
    return selection.durationMinutes;
  }

  /**
   * Disponibilidade pública de um dia. Retorna apenas o estado de cada horário
   * (disponível, poucas vagas, lotado), nunca dados de clientes ou veículos.
   */
  async getAvailability(date: string, durationMinutes: number) {
    const result = await this.computeSlots(date, durationMinutes);
    return {
      ...result,
      slots: result.slots.map(({ time, shift, status }) => ({
        time,
        shift,
        // O cliente nunca vê a tolerância: para ele o horário está lotado
        status: (status === 'TOLERANCE' ? 'FULL' : status) as SlotStatus,
      })),
    };
  }

  /**
   * Disponibilidade para a equipe: mostra ocupação, capacidade e as vagas de tolerância
   */
  async getStaffAvailability(date: string, durationMinutes: number) {
    return this.computeSlots(date, durationMinutes);
  }

  private async computeSlots(date: string, durationMinutes: number) {
    const timeZone = await this.getTimezone();
    this.assertWithinBookingWindow(date, timeZone);

    const day = await this.loadOpenDay(this.prisma, date);
    if (!day) {
      return { date, isOpen: false, freeTime: false, durationMinutes, slots: [] };
    }

    const dayStart = zonedTimeToUtc(date, '00:00', timeZone);
    const dayEnd = zonedTimeToUtc(addDays(date, 1), '00:00', timeZone);
    const booked = await this.prisma.appointment.findMany({
      where: {
        status: { notIn: NON_BLOCKING_STATUSES },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: { startsAt: true, endsAt: true },
    });

    const now = Date.now();
    const step = day.intervalMinutes || FREE_TIME_STEP_MINUTES;
    const slots: {
      time: string;
      shift: string;
      status: StaffSlotStatus;
      used: number;
      capacity: number;
      tolerance: number;
    }[] = [];

    for (const shift of day.shifts) {
      for (let t = shift.start; t + durationMinutes <= shift.end; t += step) {
        const time = minutesToTime(t);
        const startsAt = zonedTimeToUtc(date, time, timeZone);
        if (startsAt.getTime() <= now) continue;

        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
        const used = booked.filter((b) => b.startsAt < endsAt && b.endsAt > startsAt).length;
        const remaining = shift.capacity - used;

        let status: StaffSlotStatus = 'AVAILABLE';
        if (remaining <= 0) status = used < shift.capacity + shift.tolerance ? 'TOLERANCE' : 'FULL';
        else if (remaining === 1 && shift.capacity > 1) status = 'LIMITED';

        slots.push({
          time,
          shift: shift.shiftName,
          status,
          used,
          capacity: shift.capacity,
          tolerance: shift.tolerance,
        });
      }
    }

    return { date, isOpen: true, freeTime: day.intervalMinutes === 0, durationMinutes, slots };
  }

  /**
   * Valida e reserva a vaga dentro de uma transação. Bloqueia a linha da grade do
   * dia (SELECT ... FOR UPDATE) para que duas reservas simultâneas não estourem a capacidade.
   */
  async reserveSlot(
    tx: Prisma.TransactionClient,
    date: string,
    time: string,
    durationMinutes: number,
    // Equipe: pode usar a tolerância de vagas e qualquer minuto dentro do turno
    options: { staff?: boolean } = {},
  ) {
    const dayOfWeek = dayOfWeekOf(date);
    await tx.$queryRaw`SELECT id FROM business_schedules WHERE day_of_week = ${dayOfWeek} FOR UPDATE`;

    const timeZone = await this.getTimezone(tx);
    this.assertWithinBookingWindow(date, timeZone);

    const day = await this.loadOpenDay(tx, date);
    if (!day) {
      throw new BadRequestException('Não abrimos nesta data. Escolha outro dia.');
    }

    const startMinutes = timeToMinutes(time);
    const shift = day.shifts.find(
      (s) => startMinutes >= s.start && startMinutes + durationMinutes <= s.end,
    );
    if (!shift) {
      throw new BadRequestException(
        'Este horário está fora do expediente ou o serviço não termina antes do fim do turno.',
      );
    }
    if (!options.staff && day.intervalMinutes > 0 && (startMinutes - shift.start) % day.intervalMinutes !== 0) {
      throw new BadRequestException('Escolha um dos horários disponíveis na agenda.');
    }

    const startsAt = zonedTimeToUtc(date, time, timeZone);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Este horário já passou. Escolha outro.');
    }

    const used = await tx.appointment.count({
      where: {
        status: { notIn: NON_BLOCKING_STATUSES },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    const limit = shift.capacity + (options.staff ? shift.tolerance : 0);
    if (used >= limit) {
      throw new ConflictException(
        options.staff
          ? 'Este horário já está lotado, inclusive na tolerância. Escolha outro.'
          : 'Esse horário acabou de ser preenchido. Escolha outro, por favor.',
      );
    }

    return { startsAt, endsAt };
  }

  private assertWithinBookingWindow(date: string, timeZone: string) {
    const today = toZonedDateString(new Date(), timeZone);
    if (date < today || date > addDays(today, BOOKING_WINDOW_DAYS)) {
      throw new BadRequestException(
        `Escolha uma data entre hoje e os próximos ${BOOKING_WINDOW_DAYS} dias.`,
      );
    }
  }

  /**
   * Turnos abertos numa data: a grade semanal do dia, menos os períodos fechados
   * e mais os horários extras cadastrados como dia especial.
   */
  private async loadOpenDay(db: Db, date: string): Promise<OpenDay | null> {
    const [schedule, exceptions] = await Promise.all([
      db.businessSchedule.findUnique({
        where: { dayOfWeek: dayOfWeekOf(date) },
        include: { shifts: { where: { isActive: true } } },
      }),
      db.scheduleException.findMany({ where: { date } }),
    ]);

    // "Fechar o dia inteiro" tira a grade normal; horários extras da mesma data continuam valendo
    const closedAllDay = exceptions.some((e) => e.type === 'CLOSED' && !e.startTime);
    let shifts: OpenShift[] =
      schedule?.isActive && !closedAllDay
        ? schedule.shifts.map((s) => ({
            shiftName: s.shiftName,
            start: timeToMinutes(s.startTime),
            end: timeToMinutes(s.endTime),
            capacity: s.simultaneousCapacity,
            tolerance: s.overbookTolerance,
          }))
        : [];

    for (const open of exceptions.filter((e) => e.type === 'OPEN' && e.startTime && e.endTime)) {
      shifts.push({ shiftName: 'EXTRA', start: timeToMinutes(open.startTime!), end: timeToMinutes(open.endTime!), capacity: open.capacity, tolerance: 0 });
    }
    // Período fechado corta tudo: grade normal e horários extras
    for (const closed of exceptions.filter((e) => e.type === 'CLOSED' && e.startTime && e.endTime)) {
      shifts = subtractRange(shifts, timeToMinutes(closed.startTime!), timeToMinutes(closed.endTime!));
    }
    if (shifts.length === 0) return null;

    return {
      dayOfWeek: dayOfWeekOf(date),
      intervalMinutes: schedule?.slotIntervalMinutes ?? 60,
      shifts: shifts.sort((a, b) => a.start - b.start),
    };
  }
}
