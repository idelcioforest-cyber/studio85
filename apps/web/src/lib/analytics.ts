import type { SiteEventType } from '@autowash/shared';

const SESSION_KEY = 'studio85_session';

/** Código aleatório que vale só enquanto a aba está aberta (não identifica a pessoa) */
function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '');
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * Medição anônima de uso: visita e etapas do agendamento. Nunca atrapalha a tela (erros são ignorados);
 * cada etapa conta uma vez por aba por dia no servidor.
 */
export function track(type: SiteEventType) {
  const id = sessionId();
  if (!id) return;
  fetch('/api/v1/analytics/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, sessionId: id }),
    keepalive: true,
  }).catch(() => undefined);
}
