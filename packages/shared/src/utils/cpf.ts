/**
 * Limpa qualquer caractere não numérico da string de CPF
 */
export function cleanCPF(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

/**
 * Valida o formato e os dígitos verificadores de um CPF brasileiro
 */
export function isValidCPF(cpf: string): boolean {
  const cleaned = cleanCPF(cpf);

  if (cleaned.length !== 11) {
    return false;
  }

  // Rejeita sequências conhecidas de números repetidos (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(cleaned)) {
    return false;
  }

  // Validação do 1º dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cleaned.charAt(9), 10)) {
    return false;
  }

  // Validação do 2º dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cleaned.charAt(10), 10)) {
    return false;
  }

  return true;
}

/**
 * Formata CPF para exibição padrão: 000.000.000-00
 */
export function formatCPF(cpf: string): string {
  const cleaned = cleanCPF(cpf);
  if (cleaned.length !== 11) return cpf;
  return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Mascara o CPF para privacidade (LGPD e ForestSecurity): 123.***.***-45
 */
export function maskCPF(cpf: string): string {
  const cleaned = cleanCPF(cpf);
  if (cleaned.length !== 11) return '***.***.***-**';
  return `${cleaned.slice(0, 3)}.***.***-${cleaned.slice(9, 11)}`;
}
