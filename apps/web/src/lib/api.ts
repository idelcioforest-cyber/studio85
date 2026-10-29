export const SESSION_EXPIRED_EVENT = 'studio85:session-expired';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
  }

  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((e) => e.field === field)?.message;
  }
}

/**
 * Cliente HTTP da API. A sessão vai no cookie HttpOnly emitido pelo login,
 * então nenhum token fica acessível ao JavaScript da página.
 */
export async function api<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor. Verifique sua conexão.', 0);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const fieldErrors = Array.isArray(data?.errors) ? data.errors : [];
    const message =
      fieldErrors[0]?.message ||
      (typeof data?.message === 'string' ? data.message : 'Algo deu errado. Tente novamente.');
    throw new ApiError(message, response.status, fieldErrors);
  }

  return data as T;
}

/**
 * Envio de arquivo (multipart). O navegador define o Content-Type com o boundary.
 */
export async function uploadFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append('file', file);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method: 'POST', credentials: 'include', body });
  } catch {
    throw new ApiError('Não foi possível enviar o arquivo. Verifique sua conexão.', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(typeof data?.message === 'string' ? data.message : 'Não foi possível enviar o arquivo.', response.status);
  }
  return data as T;
}

export const MAX_RECEIPT_MB = 5;
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Algo deu errado. Tente novamente.';
}
