import { VehicleSizeCategory } from '@autowash/shared';

export const SHOP_TIMEZONE = 'America/Sao_Paulo';
export const WHATSAPP_NUMBER = '555192198686';
export const WHATSAPP_DISPLAY = '(51) 9219-8686';
export const SHOP_ADDRESS = 'R. Amapá, 16 - Cavalhada, Porto Alegre - RS, 91740-460';
export const SHOP_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Studio 85, ${SHOP_ADDRESS}`)}`;

export function whatsappLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/** "Desconto de R$ 10,00" (positivo) ou "Acréscimo de R$ 5,00" (negativo) */
export function adjustmentLabel(adjustmentCents: number): string {
  return `${adjustmentCents > 0 ? 'Desconto' : 'Acréscimo'} de ${formatPrice(Math.abs(adjustmentCents))}`;
}

/** Valor para editar num campo: 7000 → "70,00" */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Lê o que foi digitado ("60", "60,50", "R$ 1.234,56", "60.5") em centavos; null se não for um valor válido */
export function parsePriceInput(value: string): number | null {
  let v = value.replace(/R\$|\s/g, '');
  if (!v) return null;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export const sizeLabels: Record<VehicleSizeCategory, string> = {
  [VehicleSizeCategory.SMALL]: 'Compacto',
  [VehicleSizeCategory.MEDIUM]: 'Sedan / Médio',
  [VehicleSizeCategory.SUV]: 'SUV',
  [VehicleSizeCategory.PICKUP]: 'Picape',
  [VehicleSizeCategory.SPECIAL]: 'Van / Especial',
};

export const sizeExamples: Record<VehicleSizeCategory, string> = {
  [VehicleSizeCategory.SMALL]: 'Gol, Onix, HB20, Mobi',
  [VehicleSizeCategory.MEDIUM]: 'Civic, Corolla, Cruze, Virtus',
  [VehicleSizeCategory.SUV]: 'Compass, HR-V, T-Cross, Creta',
  [VehicleSizeCategory.PICKUP]: 'Hilux, Toro, Strada, S10',
  [VehicleSizeCategory.SPECIAL]: 'Vans e utilitários',
};

// Portes oferecidos ao cliente no catálogo e na agenda
export const publicSizes: VehicleSizeCategory[] = [
  VehicleSizeCategory.SMALL,
  VehicleSizeCategory.MEDIUM,
  VehicleSizeCategory.SUV,
  VehicleSizeCategory.PICKUP,
];

export function formatPlate(plate: string | null | undefined): string {
  if (!plate) return 'Sem placa';
  return /^[A-Z]{3}[0-9]{4}$/.test(plate) ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate;
}

/** Data de hoje no fuso do estabelecimento, no formato AAAA-MM-DD */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE }).format(new Date());
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeekISO(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "qui., 30/10" para datas AAAA-MM-DD */
export function formatDayChip(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(d).replace('.', ''),
    day: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d),
  };
}

/** "quinta-feira, 30 de outubro" para datas AAAA-MM-DD */
export function formatDateLong(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** Data e hora de um instante ISO no fuso do estabelecimento */
export function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: SHOP_TIMEZONE,
    }).format(d),
    time: new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: SHOP_TIMEZONE,
    }).format(d),
  };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '';
  const d = digits.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}
