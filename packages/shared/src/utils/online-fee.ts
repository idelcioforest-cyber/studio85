/**
 * Taxa do pagamento online repassada ao cliente.
 * As taxas do contrato com o Pagar.me são definidas pela plataforma; o valor cobrado é calculado para que,
 * descontada a taxa, sobre exatamente o preço do serviço.
 */
export interface OnlineFeeRates {
  /** Pix: percentual em centésimos de ponto (119 = 1,19%) */
  pixPercentBp: number;
  /** Pix: valor fixo por transação, em centavos */
  pixFixedCents: number;
  /** Cartão: valor fixo por transação, em centavos */
  cardFixedCents: number;
  /** Cartão: percentual por número de parcelas (posição 0 = 1x, 1 = 2x...); só as listadas são oferecidas */
  cardPercentBp: number[];
  /** Até quantas vezes o cliente pode parcelar */
  maxInstallments: number;
}

export interface FeeCharge {
  /** Preço do serviço */
  baseCents: number;
  /** Taxa paga pelo cliente */
  feeCents: number;
  /** Total cobrado */
  totalCents: number;
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;

/**
 * Confere as taxas: valor ausente ou estranho vira "sem taxa". As parcelas oferecidas vão só até a
 * última com taxa conhecida (sem nenhuma, só à vista).
 */
export function normalizeOnlineFees(raw: Partial<OnlineFeeRates> = {}): OnlineFeeRates {
  const known = (raw.cardPercentBp ?? []).slice(0, 12).map((value) => clampInt(value, 0, 3000, 0));
  const cardPercentBp = known.length > 0 ? known : [0];
  return {
    pixPercentBp: clampInt(raw.pixPercentBp, 0, 3000, 0),
    pixFixedCents: clampInt(raw.pixFixedCents, 0, 2000, 0),
    cardFixedCents: clampInt(raw.cardFixedCents, 0, 2000, 0),
    cardPercentBp,
    maxInstallments: clampInt(raw.maxInstallments, 1, cardPercentBp.length, cardPercentBp.length),
  };
}

/** Valor a cobrar para que, descontados o percentual e o fixo, sobre o preço do serviço */
export function withFee(baseCents: number, percentBp: number, fixedCents: number): FeeCharge {
  if (baseCents <= 0 || (percentBp <= 0 && fixedCents <= 0)) return { baseCents, feeCents: 0, totalCents: baseCents };
  const totalCents = Math.ceil((baseCents + fixedCents) / (1 - percentBp / 10_000));
  return { baseCents, feeCents: totalCents - baseCents, totalCents };
}

export function pixCharge(baseCents: number, rates: OnlineFeeRates): FeeCharge {
  return withFee(baseCents, rates.pixPercentBp, rates.pixFixedCents);
}

export function cardCharge(baseCents: number, installments: number, rates: OnlineFeeRates): FeeCharge {
  const index = Math.min(Math.max(installments, 1), rates.cardPercentBp.length) - 1;
  return withFee(baseCents, rates.cardPercentBp[index] ?? 0, rates.cardFixedCents);
}
