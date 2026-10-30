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
  subscriptionsEnabled: z.boolean().optional(),
  onlineFees: z
    .object({
      pixPercentBp: z.number().int().min(0).max(3000, 'Taxa do Pix acima de 30%'),
      pixFixedCents: z.number().int().min(0).max(2000),
      cardFixedCents: z.number().int().min(0).max(2000),
      cardPercentBp: z.array(z.number().int().min(0).max(3000, 'Taxa do cartão acima de 30%')).length(12),
      maxInstallments: z.number().int().min(1).max(12),
    })
    .optional(),
});

export type UpdateBusinessSettingsInput = z.infer<typeof UpdateBusinessSettingsSchema>;
