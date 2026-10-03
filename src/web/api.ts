/** Thin fetch wrapper: JSON in/out, the demo profile header, and readable errors. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

let currentMemberId: string | null = null;

export function setApiMember(memberId: string | null): void {
  currentMemberId = memberId;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (currentMemberId) headers['x-demo-user'] = currentMemberId;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique se a aplicação está rodando e tente de novo.', 0, 'network');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(error?.message ?? `Erro ${response.status}`, response.status, error?.code ?? 'http', error?.details);
  }
  return payload as T;
}
