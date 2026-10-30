const LOWERCASE_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/** Os cadastros ficam em maiúsculas; nas mensagens o nome sai como se escreve: "MARIA DA SILVA" → "Maria da Silva" */
export function displayName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((word, i) => (i > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1)))
    .join(' ');
}
