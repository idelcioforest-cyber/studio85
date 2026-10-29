// Aceita tanto o enum do Prisma quanto o do pacote compartilhado (mesmos valores em string)
type SizeCategory = `${import('@autowash/shared').VehicleSizeCategory}`;

interface PricedService {
  basePriceCents: number;
  baseDurationMinutes: number;
  priceRules: { sizeCategory: string; priceCents: number; durationMinutes: number }[];
}

/**
 * Resolve preço e duração de um serviço para o porte do veículo.
 * Serviços sem regras têm preço único; com regras, só atendem os portes cadastrados.
 * Retorna null quando o serviço não atende o porte informado.
 */
export function resolveServicePricing(
  service: PricedService,
  sizeCategory?: SizeCategory | null,
): { priceCents: number; durationMinutes: number } | null {
  if (service.priceRules.length === 0 || !sizeCategory) {
    return { priceCents: service.basePriceCents, durationMinutes: service.baseDurationMinutes };
  }

  const rule = service.priceRules.find((r) => r.sizeCategory === sizeCategory);
  return rule ? { priceCents: rule.priceCents, durationMinutes: rule.durationMinutes } : null;
}

/**
 * Combinação de serviços no mesmo atendimento: valores e tempos somados.
 * Lista em `unavailable` os serviços que não atendem o porte.
 */
export function resolveSelectionPricing<T extends PricedService & { name: string }>(
  services: T[],
  sizeCategory?: SizeCategory | null,
) {
  const items: (ReturnType<typeof resolveServicePricing> & object & { service: T })[] = [];
  const unavailable: string[] = [];

  for (const service of services) {
    const pricing = resolveServicePricing(service, sizeCategory);
    if (pricing) items.push({ service, ...pricing });
    else unavailable.push(service.name);
  }

  return {
    items,
    unavailable,
    priceCents: items.reduce((acc, i) => acc + i.priceCents, 0),
    durationMinutes: items.reduce((acc, i) => acc + i.durationMinutes, 0),
  };
}
