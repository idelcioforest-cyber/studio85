/**
 * Título e descrição de cada página, usados pelo servidor (HTML inicial que o Google lê)
 * e pelo site (título da aba ao navegar).
 */
export interface PageMeta {
  title: string;
  description: string;
  /** false = página pessoal ou do painel: o Google não deve indexar */
  index: boolean;
}

export const SITE_NAME = 'Studio 85';

const HOME: PageMeta = {
  title: 'Studio 85 — Lavagem e Estética Automotiva em Porto Alegre',
  description:
    'Lavagem e estética automotiva na Cavalhada, Zona Sul de Porto Alegre. Produtos Vonixx e Dub Boyz, sem diesel, com equipamentos profissionais. Veja os valores para o seu carro e agende online.',
  index: true,
};

const PUBLIC_PAGES: Record<string, PageMeta> = {
  '/': HOME,
  '/agenda': {
    title: 'Agendar lavagem online — Studio 85 Porto Alegre',
    description:
      'Escolha o serviço, veja o valor para o porte do seu carro e reserve um horário livre no Studio 85, na Cavalhada, em Porto Alegre.',
    index: true,
  },
  '/termos': {
    title: 'Termos de Uso — Studio 85',
    description: 'Termos de uso do app e do agendamento online do Studio 85, estética automotiva em Porto Alegre.',
    index: true,
  },
  '/privacidade': {
    title: 'Política de Privacidade — Studio 85',
    description: 'Como o Studio 85 trata os seus dados pessoais, conforme a LGPD.',
    index: true,
  },
  '/cancelamento': {
    title: 'Política de Cancelamento — Studio 85',
    description: 'Regras de cancelamento e reembolso dos agendamentos no Studio 85.',
    index: true,
  },
};

const PRIVATE_TITLES: [RegExp, string][] = [
  [/^\/meus-agendamentos/, 'Meus agendamentos'],
  [/^\/garagem/, 'Minha garagem'],
  [/^\/enderecos/, 'Meus endereços'],
  [/^\/admin\/patio/, 'Pátio'],
  [/^\/admin\/agenda/, 'Agenda e capacidade'],
  [/^\/admin\/servicos/, 'Serviços'],
  [/^\/admin\/financeiro/, 'Caixa'],
  [/^\/admin\/pagamentos/, 'Pagamentos online'],
  [/^\/admin\/receita/, 'Receita'],
  [/^\/admin\/configuracoes/, 'Configurações'],
  [/^\/admin\/assinaturas/, 'Assinaturas'],
  [/^\/assinatura\//, 'Cartão da assinatura'],
];

/** Páginas que entram no sitemap */
export const SITEMAP_PATHS: { path: string; priority: string; changefreq: string }[] = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/agenda', priority: '0.9', changefreq: 'daily' },
  { path: '/termos', priority: '0.2', changefreq: 'yearly' },
  { path: '/privacidade', priority: '0.2', changefreq: 'yearly' },
  { path: '/cancelamento', priority: '0.2', changefreq: 'yearly' },
];

export function pageMeta(pathname: string): PageMeta {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const page = PUBLIC_PAGES[path];
  if (page) return page;
  const privateTitle = PRIVATE_TITLES.find(([re]) => re.test(path))?.[1];
  return privateTitle
    ? { title: `${privateTitle} — ${SITE_NAME}`, description: HOME.description, index: false }
    : { ...HOME, index: false };
}
