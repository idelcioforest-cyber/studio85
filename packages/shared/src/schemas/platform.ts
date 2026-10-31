import { z } from 'zod';

/**
 * Medição anônima de uso (sem cookie e sem dados pessoais): o navegador manda um código aleatório
 * que vale só enquanto a aba está aberta. Cada código conta uma vez por etapa por dia.
 */
export const SITE_EVENT_TYPES = ['visit', 'booking_open', 'booking_slot', 'booking_done'] as const;
export type SiteEventType = (typeof SITE_EVENT_TYPES)[number];

export const SiteEventSchema = z.object({
  type: z.enum(SITE_EVENT_TYPES),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, 'Código de sessão inválido'),
});

export type SiteEventInput = z.infer<typeof SiteEventSchema>;

export const PLATFORM_PERIODS = [7, 30, 90] as const;

export const PlatformOverviewQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => (PLATFORM_PERIODS as readonly number[]).includes(d), 'Período inválido')
    .default(30),
});

export type PlatformOverviewQuery = z.infer<typeof PlatformOverviewQuerySchema>;
