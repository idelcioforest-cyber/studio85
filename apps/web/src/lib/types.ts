import { VehicleSizeCategory } from '@autowash/shared';

export interface CatalogService {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
  isFlatPrice: boolean;
  priceRules: { sizeCategory: VehicleSizeCategory; priceCents: number; durationMinutes: number }[];
}

export interface CatalogCategory {
  id: string;
  name: string;
  description: string | null;
  services: CatalogService[];
}

export interface Vehicle {
  id: string;
  plate: string | null;
  internalCode: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  sizeCategory: VehicleSizeCategory;
  notes: string | null;
}

export interface Address {
  id: string;
  label: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  referencePoint: string | null;
  isDefault: boolean;
}

export type AppointmentStatus =
  | 'CONFIRMED'
  | 'CHECK_IN'
  | 'IN_PROGRESS'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'DRAFT'
  | 'PENDING_PAYMENT';

export interface Appointment {
  id: string;
  code: string;
  status: AppointmentStatus;
  source: 'APP' | 'WHATSAPP' | 'WALK_IN';
  startsAt: string;
  endsAt: string;
  totalPriceCents: number;
  telebuscaFeeCents: number;
  isTelebusca: boolean;
  customerName: string;
  customerPhone: string | null;
  vehiclePlate: string | null;
  vehicleLabel: string;
  vehicleSize: VehicleSizeCategory;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason?: string | null;
  services: { name: string; priceCents: number; durationMinutes: number }[];
  payment:
    | {
        status: 'PAID';
        method: PaymentMethod;
        // ON_DELIVERY = recebido na loja; PAGARME = pago online pelo app
        provider: 'ON_DELIVERY' | 'PAGARME' | 'MERCADO_PAGO' | 'STONE';
        amountCents: number;
        refundedCents: number;
        // Diferença do total no caixa: positivo = desconto, negativo = acréscimo
        adjustmentCents: number;
        adjustmentReason: string | null;
        paidAt: string;
        hasReceipt: boolean;
      }
    | { status: 'PENDING' };
  // NONE = cadastro rápido sem login, PENDING = senha provisória enviada, ACTIVE = usa o app
  customer: { id: string; appAccess: 'NONE' | 'PENDING' | 'ACTIVE' } | null;
  photos: { id: string; category: 'BEFORE' | 'AFTER' }[];
  createdAt: string;
}

export type PaymentMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH';

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CREDIT_CARD: 'Crédito',
  DEBIT_CARD: 'Débito',
  CASH: 'Dinheiro',
};

export interface PublicSettings {
  companyName: string;
  phone?: string | null;
  telebuscaEnabled: boolean;
  telebuscaFeeCents: number;
  cancellationLimitHours: number;
}

export interface OpeningHours {
  bookingWindowDays: number;
  today: string;
  days: { dayOfWeek: number; isOpen: boolean; periods: { start: string; end: string }[] }[];
  // Datas com horário extra ou fechamento: valem no lugar da grade semanal
  specialDays: { date: string; isOpen: boolean; periods: { start: string; end: string }[] }[];
}

export type SlotStatus = 'AVAILABLE' | 'LIMITED' | 'FULL';

export interface Availability {
  date: string;
  isOpen: boolean;
  freeTime: boolean;
  durationMinutes: number;
  slots: { time: string; shift: 'MANHA' | 'TARDE' | 'NOITE' | 'EXTRA'; status: SlotStatus }[];
}

export const statusLabels: Record<AppointmentStatus, string> = {
  CONFIRMED: 'Agendado',
  CHECK_IN: 'Carro recebido',
  IN_PROGRESS: 'Em lavagem',
  READY: 'Pronto para retirada',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
  DRAFT: 'Rascunho',
  PENDING_PAYMENT: 'Aguardando pagamento',
};

/** Classes de selo por status (cores com contraste AA nos dois temas) */
export const statusBadge: Record<AppointmentStatus, string> = {
  CONFIRMED: 'bg-info/10 text-info border-info/30',
  CHECK_IN: 'bg-warning/10 text-warning border-warning/30',
  IN_PROGRESS: 'bg-accent-text/10 text-accent-text border-accent-text/30',
  READY: 'bg-success/10 text-success border-success/30',
  DELIVERED: 'bg-subtle text-ink-muted border-line',
  CANCELLED: 'bg-danger/10 text-danger border-danger/30',
  NO_SHOW: 'bg-danger/10 text-danger border-danger/30',
  DRAFT: 'bg-subtle text-ink-muted border-line',
  PENDING_PAYMENT: 'bg-warning/10 text-warning border-warning/30',
};

export const ACTIVE_STATUSES: AppointmentStatus[] = ['CONFIRMED', 'CHECK_IN', 'IN_PROGRESS', 'READY'];
