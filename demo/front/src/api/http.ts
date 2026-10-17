import { ensureActor } from '../lib/actor';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function parseResponse<T>(response: Response): Promise<T> {
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* A proxy can return a non-JSON error page. */ }
  if (!response.ok || body.error) {
    const error = body.error;
    const message = typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message) : typeof error === 'string' ? error : `Não foi possível concluir a ação (${response.status}).`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

/** Headers are ASCII on the wire; the API explicitly decodes the declared UTF-8 analyst name. */
export async function actorHeaders(): Promise<Record<string, string>> {
  return { 'X-User': encodeURIComponent(await ensureActor()), 'X-User-Encoding': 'percent-utf8' };
}

export async function getJSON<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(path, { cache: 'no-store' }));
}

/** Workflow and Gmail APIs use strict bodies and identify the analyst through headers. */
export async function sendAuthorizedJSON<T>(path: string, body: object = {}, method = 'POST'): Promise<T> {
  return parseResponse<T>(await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...await actorHeaders() },
    body: JSON.stringify(body),
  }));
}

/** The original closing API still expects the declared analyst in the JSON body. */
export async function sendJSON<T>(path: string, body: object = {}, method = 'POST'): Promise<T> {
  const actor = await ensureActor();
  return parseResponse<T>(await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User': encodeURIComponent(actor), 'X-User-Encoding': 'percent-utf8' },
    body: JSON.stringify({ ...body, actor }),
  }));
}
