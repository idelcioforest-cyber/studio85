import { Injectable, Logger } from '@nestjs/common';
import { SITEMAP_PATHS, SITE_NAME, pageMeta } from '@autowash/shared';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CACHE_MS = 10 * 60 * 1000;
// Bloco do apps/web/index.html que o servidor troca pelas tags de cada página
const SEO_BLOCK = /<!--seo-->[\s\S]*?<!--\/seo-->/;

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * SEO do site servido pela API: título/descrição por página no HTML inicial, dados estruturados
 * da empresa (AutoWash, com horário vindo da agenda), Open Graph para prévias no WhatsApp,
 * robots.txt e sitemap.xml.
 */
@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);
  private jsonLdCache: { at: number; value: string } | null = null;

  constructor(private prisma: PrismaService) {}

  get origin(): string {
    return (process.env.FRONTEND_URL || 'https://studio85poa.com.br').replace(/\/+$/, '');
  }

  async renderIndex(template: string, pathname: string): Promise<string> {
    if (!SEO_BLOCK.test(template)) return template;
    const meta = pageMeta(pathname);
    const url = `${this.origin}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`;
    const image = `${this.origin}/og-image.png`;

    const tags = [
      `<title>${escapeAttr(meta.title)}</title>`,
      `<meta name="description" content="${escapeAttr(meta.description)}" />`,
      `<meta name="robots" content="${meta.index ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}" />`,
    ];
    if (meta.index) {
      tags.push(
        `<link rel="canonical" href="${escapeAttr(url)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${SITE_NAME}" />`,
        `<meta property="og:locale" content="pt_BR" />`,
        `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
        `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
        `<meta property="og:url" content="${escapeAttr(url)}" />`,
        `<meta property="og:image" content="${escapeAttr(image)}" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta property="og:image:alt" content="Studio 85 — lavagem e estética automotiva em Porto Alegre" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
      );
      const jsonLd = await this.businessJsonLd().catch((error) => {
        this.logger.warn(`Dados estruturados indisponíveis: ${(error as Error).message}`);
        return null;
      });
      if (jsonLd) tags.push(`<script type="application/ld+json">${jsonLd}</script>`);
    }
    if (process.env.GOOGLE_SITE_VERIFICATION) {
      tags.push(`<meta name="google-site-verification" content="${escapeAttr(process.env.GOOGLE_SITE_VERIFICATION)}" />`);
    }

    return template.replace(SEO_BLOCK, tags.join('\n    '));
  }

  robotsTxt(): string {
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /meus-agendamentos',
      'Disallow: /garagem',
      'Disallow: /enderecos',
      'Disallow: /api/',
      '',
      `Sitemap: ${this.origin}/sitemap.xml`,
      '',
    ].join('\n');
  }

  sitemapXml(): string {
    const urls = SITEMAP_PATHS.map(
      (p) => `  <url>
    <loc>${this.origin}${p.path}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`,
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  }

  /** Ficha da empresa para o Google (schema.org/AutoWash), com cache de 10 minutos */
  private async businessJsonLd(): Promise<string> {
    if (this.jsonLdCache && Date.now() - this.jsonLdCache.at < CACHE_MS) return this.jsonLdCache.value;

    const [settings, days, services] = await Promise.all([
      this.prisma.businessSettings.findFirst(),
      this.prisma.businessSchedule.findMany({
        where: { isActive: true },
        include: { shifts: { where: { isActive: true }, orderBy: { startTime: 'asc' } } },
        orderBy: { dayOfWeek: 'asc' },
      }),
      this.prisma.service.findMany({ where: { isActive: true }, include: { priceRules: true } }),
    ]);

    const company = settings?.companyName || SITE_NAME;
    const rawAddress = settings?.address || 'R. Amapá, 16 - Cavalhada, Porto Alegre - RS, 91740-460';
    // "R. Amapá, 16 - Cavalhada, Porto Alegre - RS, 91740-460"
    const parts = rawAddress.match(/^(.+?) - (.+?), (.+?) - ([A-Z]{2}),\s*(\d{5}-?\d{3})$/);
    const address = parts
      ? {
          '@type': 'PostalAddress',
          streetAddress: `${parts[1]} - ${parts[2]}`,
          addressLocality: parts[3],
          addressRegion: parts[4],
          postalCode: parts[5],
          addressCountry: 'BR',
        }
      : { '@type': 'PostalAddress', streetAddress: rawAddress, addressCountry: 'BR' };

    const digits = (settings?.phone || '555192198686').replace(/\D/g, '');
    const local = digits.startsWith('55') ? digits.slice(2) : digits;
    const telephone = `+55 ${local.slice(0, 2)} ${local.slice(2, local.length - 4)}-${local.slice(-4)}`;

    // Um bloco por turno (respeita a pausa do almoço), agrupando dias com o mesmo horário
    const byHours = new Map<string, string[]>();
    for (const day of days) {
      for (const shift of day.shifts) {
        const key = `${shift.startTime}-${shift.endTime}`;
        byHours.set(key, [...(byHours.get(key) ?? []), DAY_NAMES[day.dayOfWeek]]);
      }
    }
    const openingHoursSpecification = [...byHours.entries()].map(([hours, dayOfWeek]) => {
      const [opens, closes] = hours.split('-');
      return { '@type': 'OpeningHoursSpecification', dayOfWeek, opens, closes };
    });

    const prices = services.flatMap((s) => [s.basePriceCents, ...s.priceRules.map((r) => r.priceCents)]).filter((c) => c > 0);
    const brl = (cents: number) => `R$ ${Math.round(cents / 100)}`;
    const priceRange = prices.length ? `${brl(Math.min(...prices))} – ${brl(Math.max(...prices))}` : undefined;

    const data = {
      '@context': 'https://schema.org',
      '@type': 'AutoWash',
      '@id': `${this.origin}/#empresa`,
      name: company,
      alternateName: `${company} Porto Alegre`,
      description: pageMeta('/').description,
      url: `${this.origin}/`,
      logo: `${this.origin}/logo-480.png`,
      image: `${this.origin}/og-image.png`,
      telephone,
      address,
      areaServed: { '@type': 'City', name: 'Porto Alegre' },
      hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${company}, ${rawAddress}`)}`,
      ...(openingHoursSpecification.length ? { openingHoursSpecification } : {}),
      ...(priceRange ? { priceRange } : {}),
      paymentAccepted: 'Pix, cartão de crédito, cartão de débito, dinheiro',
      currenciesAccepted: 'BRL',
    };

    // "<" escapado: nenhum texto vindo do banco consegue fechar a tag <script>
    const value = JSON.stringify(data).replace(/</g, '\\u003c');
    this.jsonLdCache = { at: Date.now(), value };
    return value;
  }
}
