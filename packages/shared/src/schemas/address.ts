import { z } from 'zod';

export const CreateAddressSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, 'O rótulo do endereço deve conter no mínimo 2 caracteres (ex: Casa, Trabalho)')
    .max(50, 'Rótulo muito longo')
    .default('Residencial'),
  street: z
    .string()
    .trim()
    .min(3, 'O logradouro/rua deve conter no mínimo 3 caracteres')
    .max(150, 'Logradouro muito longo')
    .toUpperCase(),
  number: z
    .string()
    .trim()
    .min(1, 'Número é obrigatório (ou S/N)')
    .max(20, 'Número muito longo'),
  complement: z
    .string()
    .trim()
    .max(100, 'Complemento muito longo')
    .toUpperCase()
    .optional()
    .nullable(),
  neighborhood: z
    .string()
    .trim()
    .min(2, 'Bairro é obrigatório')
    .max(100, 'Bairro muito longo')
    .toUpperCase(),
  city: z
    .string()
    .trim()
    .min(2, 'Cidade é obrigatória')
    .max(100, 'Cidade muito longa')
    .toUpperCase(),
  state: z
    .string()
    .trim()
    .length(2, 'UF do estado deve conter 2 letras')
    .toUpperCase(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}-?\d{3}$/, 'CEP deve estar no formato 00000-000 ou 00000000')
    .transform((val) => val.replace(/\D/g, '')),
  referencePoint: z
    .string()
    .trim()
    .max(255, 'Ponto de referência muito longo')
    .toUpperCase()
    .optional()
    .nullable(),
  isDefault: z.boolean().default(false),
});

export type CreateAddressInput = z.infer<typeof CreateAddressSchema>;

export const UpdateAddressSchema = CreateAddressSchema.partial();
export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>;
