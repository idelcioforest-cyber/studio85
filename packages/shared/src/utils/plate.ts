/**
 * Utilitários para placas de veículos brasileiras (Mercosul e formato antigo)
 */

/**
 * Limpa formatação da placa deixando apenas caracteres alfanuméricos em caixa alta
 */
export function cleanPlate(plate: string): string {
  return plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Valida se uma placa é válida no formato Mercosul (ex: ABC1D23) ou antigo (ex: ABC1234)
 */
export function isValidBrazilianPlate(plate: string): boolean {
  const cleaned = cleanPlate(plate);

  // Deve ter exatamente 7 caracteres
  if (cleaned.length !== 7) {
    return false;
  }

  // Padrão antigo: 3 letras seguidas de 4 números (ABC1234)
  const isOldPattern = /^[A-Z]{3}[0-9]{4}$/.test(cleaned);

  // Padrão Mercosul: 3 letras, 1 número, 1 letra, 2 números (ABC1D23)
  const isMercosulPattern = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(cleaned);

  return isOldPattern || isMercosulPattern;
}

/**
 * Formata a placa com hífen se for formato antigo (ABC-1234) ou sem hífen se Mercosul (ABC1D23)
 */
export function formatPlate(plate: string): string {
  const cleaned = cleanPlate(plate);
  if (/^[A-Z]{3}[0-9]{4}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  }
  return cleaned;
}
