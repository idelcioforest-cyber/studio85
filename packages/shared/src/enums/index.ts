/**
 * Papéis de usuário (RBAC)
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  ATTENDANT = 'ATTENDANT',
  WASHER = 'WASHER',
  CLIENT = 'CLIENT',
}

/**
 * Categorias de porte de veículo
 */
export enum VehicleSizeCategory {
  SMALL = 'SMALL',         // Compactos (ex: HB20, Onix, Mobi)
  MEDIUM = 'MEDIUM',       // Sedans / Hatchs médios (ex: Corolla, Civic, Cruze)
  SUV = 'SUV',             // SUVs e Crossovers (ex: Compass, T-Cross, Renegade)
  PICKUP = 'PICKUP',       // Picapes e Caminhonetes (ex: Hilux, Ranger, Toro)
  SPECIAL = 'SPECIAL',     // Vans, Utilitários ou Especiais
}

/**
 * Status do agendamento
 */
export enum AppointmentStatus {
  DRAFT = 'DRAFT',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  CHECK_IN = 'CHECK_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

/**
 * Origem do agendamento
 */
export enum AppointmentSource {
  APP = 'APP',
  WHATSAPP = 'WHATSAPP',
  WALK_IN = 'WALK_IN',
}

/**
 * Status da ordem de serviço operacional
 */
export enum WorkOrderStatus {
  CHECK_IN = 'CHECK_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

/**
 * Status de pagamento
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  DISPUTED = 'DISPUTED',
}

/**
 * Provedores de pagamento integrados
 */
export enum PaymentProviderType {
  MERCADO_PAGO = 'MERCADO_PAGO',
  STONE = 'STONE',
  ON_DELIVERY = 'ON_DELIVERY', // Pagar na retirada
}

/**
 * Métodos de pagamento
 */
export enum PaymentMethod {
  PIX = 'PIX',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  CASH = 'CASH',
  POS_MACHINE = 'POS_MACHINE',
}

/**
 * Categorias de fotos da ordem de serviço
 */
export enum MediaCategory {
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
  DAMAGE = 'DAMAGE', // Avarias pré-existentes no check-in
  DURING = 'DURING',
}

/**
 * Visibilidade das fotos
 */
export enum MediaVisibility {
  CLIENT_VISIBLE = 'CLIENT_VISIBLE',
  ADMIN_ONLY = 'ADMIN_ONLY',
}

/**
 * Status de Telebusca (Leva-e-Traz)
 */
export enum TelebuscaStatus {
  PENDING = 'PENDING',
  PICKUP_EN_ROUTE = 'PICKUP_EN_ROUTE',
  AT_SHOP = 'AT_SHOP',
  DELIVERY_EN_ROUTE = 'DELIVERY_EN_ROUTE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/**
 * Turnos de funcionamento (modelo inspirado em Luara)
 */
export enum ShiftType {
  MANHA = 'MANHA',
  TARDE = 'TARDE',
  NOITE = 'NOITE',
}
