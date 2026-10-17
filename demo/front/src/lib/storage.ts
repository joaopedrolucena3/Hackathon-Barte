// localStorage wrapper for the mock backend and per-viewer conveniences; failures fall back to memory.
const memory = new Map<string, string>();

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key) ?? memory.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try { localStorage.setItem(key, raw); } catch { /* quota or disabled storage */ }
}

export async function sha256(text: string | ArrayBuffer): Promise<string> {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([content], { type }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
