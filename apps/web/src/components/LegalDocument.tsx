import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type LegalSlug = 'terms_of_use' | 'privacy_policy' | 'cancellation_policy';

interface LegalDoc {
  slug: LegalSlug;
  version: string;
  title: string;
  contentMarkdown: string;
  publishedAt: string;
}

export function useLegalDocument(slug: LegalSlug) {
  return useQuery({
    queryKey: ['legal', slug],
    queryFn: () => api<LegalDoc>(`/legal/${slug}`),
    staleTime: 1000 * 60 * 30,
  });
}

/** Negrito com **texto**, renderizado como elementos React (sem HTML bruto) */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/**
 * Renderiza o subconjunto de Markdown usado nos documentos legais: títulos (##), listas (-) e parágrafos
 */
function renderMarkdown(markdown: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1.5 pl-5">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flushList();
    if (!line) continue;
    if (line.startsWith('## ')) {
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="pt-2 text-base font-bold text-ink">
          {line.slice(3)}
        </h3>,
      );
    } else if (!line.startsWith('# ')) {
      blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flushList();
  return blocks;
}

export function LegalDocumentBody({ slug, showTitle = true }: { slug: LegalSlug; showTitle?: boolean }) {
  const { data, isLoading, isError } = useLegalDocument(slug);

  if (isLoading) return <p className="text-sm text-ink-muted">Carregando documento…</p>;
  if (isError || !data) {
    return (
      <p className="text-sm text-danger" role="alert">
        Não foi possível carregar o documento agora. Tente novamente em instantes.
      </p>
    );
  }

  return (
    <article className="space-y-3 text-sm leading-relaxed text-ink-muted">
      {showTitle && <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{data.title}</h1>}
      <p className="text-xs">
        Versão {data.version} · vigente desde{' '}
        {new Date(data.publishedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
      </p>
      {renderMarkdown(data.contentMarkdown)}
    </article>
  );
}
