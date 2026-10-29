/**
 * Conversões de data/hora local do estabelecimento (ex: America/Sao_Paulo) <-> UTC
 * sem dependências externas, usando a base de fusos do Intl.
 */

function offsetMinutes(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/**
 * Converte "AAAA-MM-DD" + "HH:MM" no fuso informado para um instante UTC
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  return new Date(naive.getTime() - offsetMinutes(naive, timeZone) * 60000);
}

/**
 * Data local "AAAA-MM-DD" de um instante no fuso informado
 */
export function toZonedDateString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Dia da semana (0 = Domingo) de uma data "AAAA-MM-DD"
 */
export function dayOfWeekOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Soma dias a uma data "AAAA-MM-DD"
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
