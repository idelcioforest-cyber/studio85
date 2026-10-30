import { z } from 'zod';

export const MESSAGE_TEMPLATE_KEYS = ['APPOINTMENT_CONFIRMED', 'CAR_READY', 'APPOINTMENT_CANCELLED'] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export const UpdateMessageTemplateSchema = z.object({
  body: z.string().trim().min(5, 'A mensagem está muito curta').max(1500, 'A mensagem está muito longa'),
  isActive: z.boolean(),
  attachPhotos: z.boolean().default(false),
});

export type UpdateMessageTemplateInput = z.infer<typeof UpdateMessageTemplateSchema>;

export const WhatsAppTestSchema = z.object({
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length >= 10 && v.length <= 13, 'Informe o celular com DDD'),
});

export type WhatsAppTestInput = z.infer<typeof WhatsAppTestSchema>;

export const NotifyAppointmentSchema = z.object({
  templateKey: z.enum(MESSAGE_TEMPLATE_KEYS),
});

export type NotifyAppointmentInput = z.infer<typeof NotifyAppointmentSchema>;
