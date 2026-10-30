import { z } from 'zod';
import { VehicleSizeCategory } from '../enums';
import { isValidCPF, cleanCPF } from '../utils/cpf';

export const MAX_PLAN_SERVICES = 4;

/**
 * Plano de assinatura montado pelo dono: nada vem pronto.
 * Até 4 serviços do catálogo, lavagens por mês e um preço mensal para cada porte atendido.
 */
export const SubscriptionPlanSchema = z
  .object({
    name: z.string().trim().min(2, 'Dê um nome ao plano').max(80),
    description: z.string().trim().max(255).optional().nullable(),
    washesPerMonth: z.number().int().min(1, 'Pelo menos 1 lavagem por mês').max(31, 'No máximo 31 por mês'),
    serviceIds: z
      .array(z.string().uuid())
      .min(1, 'Escolha pelo menos 1 serviço')
      .max(MAX_PLAN_SERVICES, `No máximo ${MAX_PLAN_SERVICES} serviços por plano`),
    prices: z
      .array(
        z.object({
          sizeCategory: z.nativeEnum(VehicleSizeCategory),
          priceCents: z.number().int().min(100, 'Preço mínimo de R$ 1,00').max(10_000_000),
        }),
      )
      .min(1, 'Informe o preço mensal de pelo menos um porte'),
    isActive: z.boolean().default(true),
  })
  .refine((v) => new Set(v.serviceIds).size === v.serviceIds.length, { message: 'Serviço repetido', path: ['serviceIds'] })
  .refine((v) => new Set(v.prices.map((p) => p.sizeCategory)).size === v.prices.length, {
    message: 'Porte repetido',
    path: ['prices'],
  });

export type SubscriptionPlanInput = z.infer<typeof SubscriptionPlanSchema>;

/** O dono ativa o plano para um cliente e um veículo da garagem dele */
export const ActivateSubscriptionSchema = z.object({
  planId: z.string().uuid('Escolha o plano'),
  userId: z.string().uuid('Escolha o cliente'),
  vehicleId: z.string().uuid('Escolha o veículo'),
});

export type ActivateSubscriptionInput = z.infer<typeof ActivateSubscriptionSchema>;

export const CancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(200).optional().nullable(),
});

export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionSchema>;

/**
 * Página do link enviado pelo dono: o cliente cadastra o cartão (token gerado no navegador).
 * E-mail, CPF e celular só são pedidos quando faltam no cadastro.
 */
export const SubscriptionSetupSchema = z.object({
  cardToken: z.string().regex(/^token_[A-Za-z0-9]+$/, 'Cartão inválido. Digite os dados de novo.'),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(150).optional().nullable(),
  cpf: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || isValidCPF(v), 'CPF inválido')
    .transform((v) => (v ? cleanCPF(v) : null)),
  phone: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => !v || v.length === 10 || v.length === 11, 'Celular com DDD'),
});

export type SubscriptionSetupInput = z.infer<typeof SubscriptionSetupSchema>;
