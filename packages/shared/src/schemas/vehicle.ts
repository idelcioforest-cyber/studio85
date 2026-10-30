import { z } from 'zod';
import { VehicleSizeCategory } from '../enums';
import { isValidBrazilianPlate, cleanPlate } from '../utils/plate';

export const CreateVehicleSchema = z.object({
  plate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || isValidBrazilianPlate(val), {
      message: 'Placa inválida. Utilize o formato Mercosul (ABC1D23) ou tradicional (ABC-1234).',
    })
    .transform((val) => (val ? cleanPlate(val) : null)),
  make: z
    .string()
    .trim()
    .min(2, 'A marca do veículo deve conter no mínimo 2 caracteres')
    .max(60, 'Marca muito longa'),
  model: z
    .string()
    .trim()
    .min(2, 'O modelo do veículo deve conter no mínimo 2 caracteres')
    .max(80, 'Modelo muito longo'),
  year: z
    .number()
    .int()
    .min(1950, 'Ano inválido')
    .max(new Date().getFullYear() + 2, 'Ano futuro inválido')
    .optional()
    .nullable(),
  color: z
    .string()
    .trim()
    .max(40, 'Cor muito longa')
    .optional()
    .nullable(),
  sizeCategory: z
    .nativeEnum(VehicleSizeCategory, {
      error: 'Selecione uma categoria de porte válida',
    })
    .default(VehicleSizeCategory.MEDIUM),
  notes: z
    .string()
    .trim()
    .max(1000, 'Observações muito longas')
    .optional()
    .nullable(),
});

export type CreateVehicleInput = z.input<typeof CreateVehicleSchema>;
export type CreateVehicleOutput = z.output<typeof CreateVehicleSchema>;

export const UpdateVehicleSchema = z.object({
  plate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || isValidBrazilianPlate(val), {
      message: 'Placa inválida. Utilize o formato Mercosul (ABC1D23) ou tradicional (ABC-1234).',
    })
    .transform((val) => (val ? cleanPlate(val) : null)),
  make: z.string().trim().min(2).max(60).optional(),
  model: z.string().trim().min(2).max(80).optional(),
  year: z.number().int().min(1950).max(new Date().getFullYear() + 2).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  sizeCategory: z.nativeEnum(VehicleSizeCategory).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export type UpdateVehicleInput = z.input<typeof UpdateVehicleSchema>;
export type UpdateVehicleOutput = z.output<typeof UpdateVehicleSchema>;
