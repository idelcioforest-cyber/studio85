export interface SplitRule {
  type: 'percentage';
  amount: number;
  recipient_id: string;
  options: { liable: boolean; charge_processing_fee: boolean; charge_remainder_fee: boolean };
}

/**
 * Regras de split, sempre em percentual somando 100:
 * o lava-jato paga todas as taxas, os centavos de arredondamento e responde por chargeback e estorno;
 * a plataforma fica só com a comissão limpa.
 */
export function buildSplit(washerRecipientId: string, platformRecipientId: string, platformFeePercent: number): SplitRule[] {
  if (!Number.isInteger(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100) {
    throw new Error(`Comissão da plataforma inválida: ${platformFeePercent}. Use um inteiro de 0 a 100.`);
  }
  if (!washerRecipientId) throw new Error('Recebedor do lava-jato não cadastrado.');

  const washer: SplitRule = {
    type: 'percentage',
    amount: 100 - platformFeePercent,
    recipient_id: washerRecipientId,
    options: { liable: true, charge_processing_fee: true, charge_remainder_fee: true },
  };
  if (platformFeePercent === 0) return [{ ...washer, amount: 100 }];
  if (!platformRecipientId) throw new Error('PAGARME_PLATFORM_RECIPIENT_ID não configurado.');

  return [
    washer,
    {
      type: 'percentage',
      amount: platformFeePercent,
      recipient_id: platformRecipientId,
      options: { liable: false, charge_processing_fee: false, charge_remainder_fee: false },
    },
  ];
}

/** Parte da plataforma em centavos (o arredondamento fica com o lava-jato) */
export function platformShareCents(amountCents: number, platformFeePercent: number): number {
  return Math.floor((amountCents * platformFeePercent) / 100);
}
