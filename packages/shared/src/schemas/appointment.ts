import { z } from 'zod';
import { AppointmentStatus, VehicleSizeCategory } from '../enums';
import { isValidBrazilianPlate, cleanPlate } from '../utils/plate';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Um ou mais serviços feitos no mesmo horário: o tempo soma, mas ocupa a vaga de 1 carro
export const MAX_SERVICES_PER_BOOKING = 6;

const ServiceIdsSchema = z
  .array(z.string().uuid('Serviço inválido'))
  .min(1, 'Selecione ao menos um serviço')
  .max(MAX_SERVICES_PER_BOOKING, `Selecione no máximo ${MAX_SERVICES_PER_BOOKING} serviços`)
  .transform((ids) => [...new Set(ids)]);

/**
 * Consulta pública de disponibilidade (não expõe dados de clientes ou veículos)
 */
export const AvailabilityQuerySchema = z.object({
  date: z.string().regex(DATE_REGEX, 'Data deve estar no formato AAAA-MM-DD'),
  // Lista separada por vírgula: ?serviceIds=id1,id2
  serviceIds: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((id) => id.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid('Serviço inválido')).max(MAX_SERVICES_PER_BOOKING))
    .transform((ids) => [...new Set(ids)]),
  sizeCategory: z.nativeEnum(VehicleSizeCategory).optional(),
});

export type AvailabilityQueryInput = z.infer<typeof AvailabilityQuerySchema>;

/**
 * Agendamento feito pelo cliente cadastrado no app
 */
export const CreateAppointmentSchema = z.object({
  serviceIds: ServiceIdsSchema,
  vehicleId: z.string().uuid('Selecione um veículo da sua garagem'),
  date: z.string().regex(DATE_REGEX, 'Data deve estar no formato AAAA-MM-DD'),
  time: z.string().regex(TIME_REGEX, 'Horário deve estar no formato HH:MM'),
  notes: z.string().trim().max(500, 'Observações muito longas').optional().nullable(),
  telebusca: z.boolean().default(false),
  pickupAddressId: z.string().uuid('Endereço inválido').optional().nullable(),
});

export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;

/**
 * Entrada de cliente de balcão registrada pela equipe (sem conta no app)
 */
export const WalkInAppointmentSchema = z.object({
  serviceIds: ServiceIdsSchema,
  // Preenchidos quando a equipe escolhe um cliente já cadastrado na busca
  userId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  customerName: z.string().trim().min(2, 'Informe o nome do cliente').max(120),
  customerPhone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .transform((val) => (val ? val.replace(/\D/g, '') : null)),
  plate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || isValidBrazilianPlate(val), {
      message: 'Placa inválida. Utilize o formato Mercosul (ABC1D23) ou tradicional (ABC-1234).',
    })
    .transform((val) => (val ? cleanPlate(val) : null)),
  vehicleLabel: z.string().trim().min(2, 'Informe o modelo do veículo').max(160),
  vehicleSize: z.nativeEnum(VehicleSizeCategory),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type WalkInAppointmentInput = z.infer<typeof WalkInAppointmentSchema>;

const OptionalPlateSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((val) => !val || isValidBrazilianPlate(val), {
    message: 'Placa inválida. Utilize o formato Mercosul (ABC1D23) ou tradicional (ABC-1234).',
  })
  .transform((val) => (val ? cleanPlate(val) : null));

const OptionalPhoneSchema = z
  .string()
  .trim()
  .max(20)
  .optional()
  .nullable()
  .transform((val) => (val ? val.replace(/\D/g, '') : null));

/**
 * Agendamento lançado pela equipe (ex.: pedido recebido no WhatsApp).
 * Cliente cadastrado: userId (+ vehicleId). Cliente novo: cadastro rápido com nome e veículo.
 * A equipe pode usar a tolerância de vagas e qualquer horário dentro do turno.
 */
export const AdminCreateAppointmentSchema = z
  .object({
    serviceIds: ServiceIdsSchema,
    date: z.string().regex(DATE_REGEX, 'Data deve estar no formato AAAA-MM-DD'),
    time: z.string().regex(TIME_REGEX, 'Horário deve estar no formato HH:MM'),
    notes: z.string().trim().max(500).optional().nullable(),
    userId: z.string().uuid().optional().nullable(),
    vehicleId: z.string().uuid().optional().nullable(),
    customerName: z.string().trim().max(120).optional().nullable(),
    customerPhone: OptionalPhoneSchema,
    plate: OptionalPlateSchema,
    vehicleLabel: z.string().trim().max(80).optional().nullable(),
    vehicleSize: z.nativeEnum(VehicleSizeCategory).optional().nullable(),
  })
  .refine((d) => d.userId || d.vehicleId || (d.customerName && d.customerName.length >= 2), {
    message: 'Escolha um cliente na busca ou informe o nome do cliente novo',
    path: ['customerName'],
  })
  .refine((d) => d.vehicleId || (d.vehicleLabel && d.vehicleLabel.length >= 2 && d.vehicleSize), {
    message: 'Informe o modelo e o porte do veículo',
    path: ['vehicleLabel'],
  });

export type AdminCreateAppointmentInput = z.infer<typeof AdminCreateAppointmentSchema>;

/**
 * Liberação de acesso ao app para cliente cadastrado pela equipe
 */
export const GrantAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail em formato inválido').max(150),
});

export type GrantAccessInput = z.infer<typeof GrantAccessSchema>;

export const PhotoCategorySchema = z.enum(['BEFORE', 'AFTER'], {
  error: 'Informe se a foto é de antes ou depois',
});

export const CustomerSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Digite ao menos 2 caracteres').max(60),
});

export type CustomerSearchQueryInput = z.infer<typeof CustomerSearchQuerySchema>;

/**
 * Recebimento no balcão (pagamento na retirada)
 */
export const PayAppointmentSchema = z.object({
  method: z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'], {
    error: 'Escolha a forma de pagamento',
  }),
  // Valor final cobrado no caixa (desconto ou acréscimo na hora). Sem ele, vale o total do agendamento.
  amountCents: z
    .number({ error: 'Informe o valor cobrado' })
    .int('Valor inválido')
    .min(0, 'O valor não pode ser negativo')
    .max(10_000_000, 'Valor muito alto')
    .optional(),
  adjustmentReason: z.string().trim().max(120, 'Motivo com no máximo 120 caracteres').optional(),
});

export type PayAppointmentInput = z.infer<typeof PayAppointmentSchema>;

export const AdminAppointmentsQuerySchema = z.object({
  date: z.string().regex(DATE_REGEX, 'Data deve estar no formato AAAA-MM-DD').optional(),
});

export type AdminAppointmentsQueryInput = z.infer<typeof AdminAppointmentsQuerySchema>;

export const UpdateAppointmentStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
  // Só ao desmarcar: motivo (fica no histórico) e se o cliente deve ser avisado
  reason: z.string().trim().max(200, 'Motivo com no máximo 200 caracteres').optional(),
  notifyClient: z.boolean().optional(),
});

export type UpdateAppointmentStatusInput = z.infer<typeof UpdateAppointmentStatusSchema>;

/**
 * Grade semanal de funcionamento (turnos e capacidade simultânea)
 */
export const ScheduleShiftSchema = z
  .object({
    shiftName: z.enum(['MANHA', 'TARDE', 'NOITE']),
    startTime: z.string().regex(TIME_REGEX, 'Horário inicial inválido'),
    endTime: z.string().regex(TIME_REGEX, 'Horário final inválido'),
    simultaneousCapacity: z.number().int().min(1, 'Capacidade mínima de 1 veículo').max(20),
    // Vagas extras que só a equipe usa (o cliente vê o horário como lotado)
    overbookTolerance: z.number().int().min(0).max(10).default(0),
    isActive: z.boolean(),
  })
  .refine((s) => s.startTime < s.endTime, {
    message: 'O horário de término deve ser depois do início',
    path: ['endTime'],
  });

export const ScheduleDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isActive: z.boolean(),
  slotIntervalMinutes: z.number().int().refine((v) => [0, 15, 30, 45, 60, 90, 120].includes(v), {
    message: 'Intervalo inválido',
  }),
  shifts: z.array(ScheduleShiftSchema).max(3),
});

export const UpdateScheduleSchema = z.object({
  days: z.array(ScheduleDaySchema).min(1).max(7),
});

export type ScheduleDayInput = z.infer<typeof ScheduleDaySchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;

/**
 * Dia especial: abre um horário extra ou fecha o dia/um período numa data específica
 */
export const ScheduleExceptionSchema = z
  .object({
    date: z.string().regex(DATE_REGEX, 'Escolha a data'),
    type: z.enum(['OPEN', 'CLOSED'], { error: 'Escolha se vai abrir ou fechar' }),
    // Só para fechar: true = o dia inteiro
    allDay: z.boolean().optional(),
    startTime: z.string().regex(TIME_REGEX, 'Horário inicial inválido').optional(),
    endTime: z.string().regex(TIME_REGEX, 'Horário final inválido').optional(),
    capacity: z.number().int().min(1, 'Pelo menos 1 carro').max(20).optional(),
    note: z.string().trim().max(120, 'Observação com no máximo 120 caracteres').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'CLOSED' && v.allDay) return;
    if (!v.startTime) ctx.addIssue({ code: 'custom', message: 'Informe o horário inicial', path: ['startTime'] });
    if (!v.endTime) ctx.addIssue({ code: 'custom', message: 'Informe o horário final', path: ['endTime'] });
    if (v.startTime && v.endTime && v.startTime >= v.endTime) {
      ctx.addIssue({ code: 'custom', message: 'O horário final deve ser depois do inicial', path: ['endTime'] });
    }
  });

export type ScheduleExceptionInput = z.infer<typeof ScheduleExceptionSchema>;
