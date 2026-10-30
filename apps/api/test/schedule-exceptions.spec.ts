import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ScheduleService } from '../src/modules/schedule/schedule.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { addDays, dayOfWeekOf, toZonedDateString } from '../src/common/utils/timezone.util';

describe('ScheduleService (Dias especiais)', () => {
  let schedule: ScheduleService;
  let prisma: PrismaService;
  let sunday: string;
  let weekday: string;
  const created: string[] = [];

  // Próxima data, a partir de daqui a 40 dias, que cai no dia da semana pedido
  const dateFor = (dow: number) => {
    let date = addDays(toZonedDateString(new Date(), 'America/Sao_Paulo'), 40);
    while (dayOfWeekOf(date) !== dow) date = addDays(date, 1);
    return date;
  };
  const times = async (date: string, minutes: number) => {
    const day = await schedule.getAvailability(date, minutes);
    return day.isOpen ? day.slots.map((s) => `${s.time}${s.shift === 'EXTRA' ? '*' : ''}`) : null;
  };
  const add = async (input: Parameters<ScheduleService['createException']>[0]) => {
    const result = await schedule.createException(input);
    created.push(result.exception.id);
    return result;
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScheduleService, PrismaService],
    }).compile();
    schedule = module.get(ScheduleService);
    prisma = module.get(PrismaService);
    sunday = dateFor(0);
    weekday = dateFor(3);
    await prisma.scheduleException.deleteMany({ where: { date: { in: [sunday, weekday] } } });
  });

  afterAll(async () => {
    await prisma.scheduleException.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  it('1. Domingo fechado na grade abre só com horário extra, com a capacidade escolhida', async () => {
    expect(await times(sunday, 60)).toBeNull();
    await add({ date: sunday, type: 'OPEN', startTime: '08:00', endTime: '12:00', capacity: 2 });
    const day = await schedule.getStaffAvailability(sunday, 60);
    expect(day.slots.map((s) => s.time)).toEqual(['08:00', '09:00', '10:00', '11:00']);
    expect(day.slots.every((s) => s.shift === 'EXTRA' && s.capacity === 2)).toBe(true);
  });

  it('2. Fechar um período corta também o horário extra', async () => {
    await add({ date: sunday, type: 'CLOSED', startTime: '09:00', endTime: '10:00' });
    expect(await times(sunday, 60)).toEqual(['08:00*', '10:00*', '11:00*']);
    // Serviço de 85 min não cabe entre 08:00 e 09:00
    expect(await times(sunday, 85)).toEqual(['10:00*']);
  });

  it('3. Não abre horário extra por cima de horário aberto nem dentro de período fechado', async () => {
    await expect(add({ date: weekday, type: 'OPEN', startTime: '09:00', endTime: '10:00' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(add({ date: sunday, type: 'OPEN', startTime: '09:00', endTime: '09:30' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('4. Fechar o dia inteiro tira a grade normal, mas mantém o horário extra da data', async () => {
    expect(await times(weekday, 60)).not.toBeNull();
    await add({ date: weekday, type: 'CLOSED', allDay: true });
    expect(await times(weekday, 60)).toBeNull();
    await add({ date: weekday, type: 'OPEN', startTime: '08:00', endTime: '10:00' });
    expect(await times(weekday, 60)).toEqual(['08:00*', '09:00*']);
  });

  it('5. Remover o dia especial devolve a data à grade semanal', async () => {
    const extra = await prisma.scheduleException.findFirst({ where: { date: weekday, type: 'OPEN' } });
    const closed = await prisma.scheduleException.findFirst({ where: { date: weekday, type: 'CLOSED' } });
    await schedule.deleteException(extra!.id);
    await schedule.deleteException(closed!.id);
    const slots = await times(weekday, 60);
    expect(slots).not.toBeNull();
    expect(slots!.some((t) => t.endsWith('*'))).toBe(false);
  });
});
