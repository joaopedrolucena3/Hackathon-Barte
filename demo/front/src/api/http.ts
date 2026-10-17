import { ensureActor } from '../lib/actor';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data?: Record<string, unknown>) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* non-JSON error page */ }
  if (!response.ok || body.error) {
    throw new ApiError(String(body.error || `Não foi possível concluir a ação (${response.status}).`), response.status, body);
  }
  return body as T;
}

export async function getJSON<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { cache: 'no-store' }));
}

/** Every mutation carries the declared analyst, as the backend requires. */
export async function sendJSON<T>(path: string, body: object = {}, method = 'POST'): Promise<T> {
  const actor = await ensureActor();
  return parse<T>(await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, actor }),
  }));
}
