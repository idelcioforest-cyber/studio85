import { z } from 'zod';
import { VehicleSizeCategory } from '../enums';

export const ServicePriceRuleSchema = z.object({
  sizeCategory: z.nativeEnum(VehicleSizeCategory),
  priceCents: z.number().int().min(0, 'O valor não pode ser negativo'),
  durationMinutes: z.number().int().min(5, 'A duração mínima é de 5 minutos'),
});

export type ServicePriceRuleInput = z.infer<typeof ServicePriceRuleSchema>;

export const CreateServiceCategorySchema = z.object({
  name: z.string().trim().min(2, 'Nome da categoria deve conter no mínimo 2 caracteres').max(80),
  description: z.string().trim().max(255).optional().nullable(),
  icon: z.string().trim().max(50).optional().nullable(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export type CreateServiceCategoryInput = z.infer<typeof CreateServiceCategorySchema>;

export const UpdateServiceCategorySchema = CreateServiceCategorySchema.partial();
export type UpdateServiceCategoryInput = z.infer<typeof UpdateServiceCategorySchema>;

export const CreateServiceSchema = z.object({
  categoryId: z.string().uuid('ID de categoria inválido'),
  name: z.string().trim().min(3, 'Nome do serviço deve conter no mínimo 3 caracteres').max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  basePriceCents: z.number().int().min(0, 'O preço base não pode ser negativo'),
  baseDurationMinutes: z.number().int().min(5, 'A duração base mínima é de 5 minutos'),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
  priceRules: z.array(ServicePriceRuleSchema).optional().default([]),
});

export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

export const UpdateServiceSchema = CreateServiceSchema.partial();
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;
