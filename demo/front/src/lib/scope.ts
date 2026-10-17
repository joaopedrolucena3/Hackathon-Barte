/** A closing view is identified by its month and immutable execution, never by a remembered label. */
export interface DataScope { comp?: string; run_id?: string }
export function scopeFromLocation(pathname: string, search = ''): DataScope {
  const params = new URLSearchParams(search);
  const month = /^\/competencias\/(\d{4}-\d{2})(?:\/|$)/.exec(pathname)?.[1];
  const run = /^\/runs\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  return { comp: month || params.get('comp') || undefined, run_id: run ? decodeURIComponent(run) : params.get('run_id') || undefined };
}
export function scopedUrl(path: string, scope: DataScope = {}, extra: Record<string, string | undefined> = {}) {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (scope.comp) params.set('comp', scope.comp);
  if (scope.run_id) params.set('run_id', scope.run_id);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) params.set(key, value);
  return `${base}${params.size ? `?${params}` : ''}`;
}
export function updateSearch(current: URLSearchParams, changes: Record<string, string | null | undefined>) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) value == null ? next.delete(key) : next.set(key, value);
  return next;
}
