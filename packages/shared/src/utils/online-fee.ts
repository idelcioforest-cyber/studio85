/**
 * Taxa do pagamento online repassada ao cliente.
 * O dono informa as taxas do contrato dele com o Pagar.me; o valor cobrado é calculado para que,
 * descontada a taxa, sobre exatamente o preço do serviço.
 */
export interface OnlineFeeRates {
  /** Pix: percentual em centésimos de ponto (119 = 1,19%) */
  pixPercentBp: number;
  /** Pix: valor fixo por transação, em centavos */
  pixFixedCents: number;
  /** Cartão: valor fixo por transação, em centavos */
  cardFixedCents: number;
  /** Cartão: percentual por número de parcelas (posição 0 = 1x ... posição 11 = 12x) */
  cardPercentBp: number[];
  /** Até quantas vezes o cliente pode parcelar */
  maxInstallments: number;
}

export const DEFAULT_ONLINE_FEES: OnlineFeeRates = {
  pixPercentBp: 0,
  pixFixedCents: 0,
  cardFixedCents: 0,
  cardPercentBp: Array.from({ length: 12 }, () => 0),
  maxInstallments: 1,
};

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

/** Lê as taxas gravadas (JSON); qualquer valor ausente ou estranho volta ao padrão (sem taxa, só à vista) */
export function parseOnlineFees(json: string | null | undefined): OnlineFeeRates {
  let raw: Partial<OnlineFeeRates> = {};
  try {
    raw = json ? (JSON.parse(json) as Partial<OnlineFeeRates>) : {};
  } catch {
    raw = {};
  }
  return {
    pixPercentBp: clampInt(raw.pixPercentBp, 0, 3000, 0),
    pixFixedCents: clampInt(raw.pixFixedCents, 0, 2000, 0),
    cardFixedCents: clampInt(raw.cardFixedCents, 0, 2000, 0),
    cardPercentBp: Array.from({ length: 12 }, (_, i) => clampInt(raw.cardPercentBp?.[i], 0, 3000, 0)),
    maxInstallments: clampInt(raw.maxInstallments, 1, 12, 1),
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
  const index = Math.min(Math.max(installments, 1), 12) - 1;
  return withFee(baseCents, rates.cardPercentBp[index] ?? 0, rates.cardFixedCents);
}
