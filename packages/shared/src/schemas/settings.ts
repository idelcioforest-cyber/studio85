import { z } from 'zod';

export const UpdateBusinessSettingsSchema = z.object({
  companyName: z.string().trim().min(2).max(120).optional(),
  tradeName: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email().max(150).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
  timezone: z.string().trim().max(50).default('America/Sao_Paulo'),
  telebuscaEnabled: z.boolean().optional(),
  telebuscaFeeCents: z.number().int().min(0).optional(),
  cancellationLimitHours: z.number().int().min(1).max(72).optional(),
  simultaneousSlotsDefault: z.number().int().min(1).max(20).optional(),
});

export type UpdateBusinessSettingsInput = z.infer<typeof UpdateBusinessSettingsSchema>;
