/**
 * Configuração do Pagar.me lida do ambiente a cada uso. Só a chave pública (pk_) vai para o navegador.
 * A conta é compartilhada com outros sistemas: tudo que este cria leva metadata.source = PAGARME_SOURCE_TAG.
 */
export const pagarmeConfig = {
  get baseUrl(): string {
    return (process.env.PAGARME_BASE_URL || 'https://api.pagar.me/core/v5').replace(/\/+$/, '');
  },
  get secretKey(): string {
    return process.env.PAGARME_SECRET_KEY || '';
  },
  get publicKey(): string {
    return process.env.PAGARME_PUBLIC_KEY || '';
  },
  /** Recebedor da plataforma (comissão) */
  get platformRecipientId(): string {
    return process.env.PAGARME_PLATFORM_RECIPIENT_ID || '';
  },
  /** Comissão da plataforma: 2% (o restante, 98%, é do lava-jato, que paga as taxas e responde pelo risco) */
  get platformFeePercent(): number {
    const value = Number(process.env.PAGARME_PLATFORM_FEE_PERCENT ?? 2);
    return Number.isInteger(value) && value >= 0 && value <= 100 ? value : 2;
  },
  get sourceTag(): string {
    return process.env.PAGARME_SOURCE_TAG || 'studio85';
  },
  get webhookUser(): string {
    return process.env.PAGARME_WEBHOOK_USER || '';
  },
  get webhookPass(): string {
    return process.env.PAGARME_WEBHOOK_PASS || '';
  },
  /** Parcelas no cartão (padrão 1x) */
  get maxInstallments(): number {
    const value = Number(process.env.PAGARME_MAX_INSTALLMENTS ?? 1);
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value : 1;
  },
  /**
   * Temporário: enquanto o lava-jato não tem recebedor liberado, o pagamento online cai inteiro
   * na conta da plataforma, sem divisão. Com o recebedor liberado, a divisão volta sozinha.
   */
  get fallbackToPlatform(): boolean {
    return process.env.PAGARME_FALLBACK_TO_PLATFORM === 'true';
  },
  /** Basta a chave secreta para cadastrar e consultar o recebedor do lava-jato */
  get apiReady(): boolean {
    return Boolean(this.secretKey);
  },
  /** Checkout: também precisa da chave pública e do recebedor da plataforma (split) */
  get configured(): boolean {
    return Boolean(this.secretKey && this.publicKey && this.platformRecipientId);
  },
};
