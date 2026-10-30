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

// Aviso em massa: no máximo 20 contatos por envio, uma mensagem por minuto (protege o número de bloqueio)
export const MAX_CAMPAIGN_BATCH = 20;
export const CAMPAIGN_INTERVAL_SECONDS = 60;

export const CampaignSchema = z.object({
  title: z.string().trim().min(2, 'Dê um nome ao aviso').max(80, 'Nome muito longo'),
  body: z.string().trim().min(5, 'A mensagem está muito curta').max(1000, 'A mensagem está muito longa'),
});

export type CampaignInput = z.infer<typeof CampaignSchema>;

export const SendCampaignSchema = z.object({
  phones: z
    .array(z.string().regex(/^55\d{10,11}$/, 'Celular inválido'))
    .min(1, 'Escolha ao menos um contato')
    .max(MAX_CAMPAIGN_BATCH, `Escolha no máximo ${MAX_CAMPAIGN_BATCH} contatos por vez`)
    .transform((phones) => [...new Set(phones)]),
});

export type SendCampaignInput = z.infer<typeof SendCampaignSchema>;
