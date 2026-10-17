import { actorHeaders } from './http';
import type { Pendencia } from './types';

export type Counterparty = 'orbe' | 'ponte';
export type MailStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'uncertain';
export interface MailIdentity { email: string; sub: string; connection_id: string }
export interface MailAccount {
  configured: boolean; connected: boolean; authorized: boolean; email?: string | null;
  missing_config: string[]; provider_mode: string; connection?: MailIdentity | null;
  provider?: 'gmail_smtp' | 'gmail_oauth'; smtp_available?: boolean; oauth_configured?: boolean;
}
export const DEMO_MAILBOX = 'financeirotarvo@gmail.com';
export interface DemoMailInput extends MailFields { counterparty: Counterparty; request_id: string }
export interface MailDelivery {
  id: string; request_id?: string; status: 'accepted' | 'failed' | 'uncertain' | 'sending' | 'unavailable'; recipient: string;
  subject: string; body?: string; counterparty?: Counterparty; created_at: string;
  run_id?: string; event?: string; provider_message_id?: string; provider_mode?: string;
  error?: { code?: string; message: string } | string;
}
export interface MailNotificationSettings { enabled: boolean; recipient: string; connection_id?: string | null }
export interface MailContact { id: string; counterparty: Counterparty; name: string; email: string; enabled: boolean }
export interface MailAttachment { id: string; name: string; content_type: string; size: number; sha256: string; url: string }
export interface MailDraft {
  id: string; issue_id: string; period: string; counterparty: Counterparty | null; counterparty_reason?: string;
  to: string; subject: string; body: string; version: number; content_hash: string; evidence_hash: string;
  sender: MailIdentity | null; current_sender?: MailIdentity | null; issue?: Pendencia;
  status: MailStatus; attachments: MailAttachment[]; stale: boolean;
  blockers: { code: string; message: string }[]; created_at: string; updated_at: string;
  provider_message_id?: string; provider_mode?: string; error?: { code: string; message: string };
  approval?: { at: string; declared_actor: string; google_account: MailIdentity; version: number };
}
export interface MailEvent {
  id: number; type: string; at: string; actor: string; version: number; status: MailStatus;
  draft_id: string; google_account?: MailIdentity; provider_message_id?: string;
  error?: { code: string; message: string }; content_hash?: string;
}
export interface MailFields { to: string; subject: string; body: string }
export interface MailEdit extends Partial<MailFields> {
  version: number; refresh_evidence?: boolean; counterparty?: Counterparty; counterparty_reason?: string;
}

// The authorization token stays in this module's memory. OAuth tokens never reach the browser.
let csrfToken = '';
const enc = encodeURIComponent;

export async function mailRequest<T>(path: string, body?: object, method = 'POST', declaredActor = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    if (declaredActor) {
      Object.assign(headers, await actorHeaders());
    }
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : method, credentials: 'same-origin', cache: 'no-store', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => { throw new Error('Não foi possível confirmar a resposta do servidor. Consulte o estado antes de outra ação.'); });
  // Failed/uncertain delivery records carry their own error and must remain inspectable.
  const deliveryRecord = typeof data.id === 'string' && ['draft', 'sending', 'sent', 'accepted', 'failed', 'uncertain', 'unavailable'].includes(data.status);
  if (!response.ok || (data.error && !deliveryRecord)) {
    const error = data.error;
    const details = error?.details || data.detail;
    const explanation = Array.isArray(details) ? details.map(item => typeof item === 'string' ? item : item.message || item.msg || '').filter(Boolean).join(' ') : '';
    throw new Error([typeof error === 'string' ? error : error?.message || `Não foi possível concluir a operação (${response.status}).`, explanation].filter(Boolean).join(' '));
  }
  return data as T;
}

const request = mailRequest;

export const mail = {
  async account(): Promise<MailAccount> {
    const { csrf_token, ...account } = await request<MailAccount & { csrf_token?: string }>('/api/mail/account');
    csrfToken = csrf_token || '';
    return account;
  },
  connect: () => request<{ authorization_url: string }>('/api/mail/oauth/start', {}, 'POST', false),
  async connectSmtp(email: string, app_password: string): Promise<MailAccount> {
    const { csrf_token, ...account } = await request<MailAccount & { csrf_token?: string }>('/api/mail/smtp/connect', { email, app_password }, 'POST', false);
    csrfToken = csrf_token || '';
    return account;
  },
  async disconnect() {
    const result = await request<{ disconnected: boolean; revocation_confirmed?: boolean; manual_revocation_required?: boolean }>('/api/mail/disconnect', {}, 'POST', false);
    csrfToken = '';
    return result;
  },
  contacts: async () => (await request<{ contacts: MailContact[] }>('/api/mail/contacts')).contacts,
  saveContact: (party: Counterparty, value: Omit<MailContact, 'counterparty' | 'id'> & { id?: string }) => request<MailContact>(`/api/mail/contacts/${party}`, value, 'PUT'),
  drafts: async () => (await request<{ drafts: MailDraft[] }>('/api/mail/drafts')).drafts,
  draft: (id: string) => request<MailDraft>(`/api/mail/drafts/${enc(id)}`),
  create: (issue_id: string) => request<MailDraft>('/api/mail/drafts', { issue_id }),
  save: (id: string, edit: MailEdit) => request<MailDraft>(`/api/mail/drafts/${enc(id)}`, edit, 'PUT'),
  approveSend: (draft: MailDraft) => request<MailDraft>(`/api/mail/drafts/${enc(draft.id)}/approve-send`, { version: draft.version, content_hash: draft.content_hash, permission: true }),
  history: (issueId: string) => request<MailEvent[]>(`/api/mail/issues/${enc(issueId)}/history`),
  sendDemo: (message: DemoMailInput) => request<MailDelivery>('/api/mail/demo/send', message),
  demoDeliveries: async () => (await request<{ deliveries: MailDelivery[] }>('/api/mail/demo/deliveries')).deliveries,
  notifications: () => request<MailNotificationSettings>('/api/mail/notifications'),
  saveNotifications: (settings: Pick<MailNotificationSettings, 'enabled' | 'recipient'>) => request<MailNotificationSettings>('/api/mail/notifications', settings, 'PUT'),
  testNotification: () => request<MailDelivery>('/api/mail/notifications/test', {}),
  notificationDeliveries: async () => (await request<{ deliveries: MailDelivery[] }>('/api/mail/notifications/deliveries')).deliveries,
};

export const isTestProvider = (mode?: string) => ['test', 'mock', 'fake', 'simulated', 'simulation', 'sandbox', 'injected', 'injected_test'].includes(mode || '');

export function deliveryLabel(delivery: MailDelivery) {
  if (delivery.status === 'accepted') return isTestProvider(delivery.provider_mode) ? 'Simulado · aceito pelo provedor de teste' : 'Aceito pelo servidor de e-mail';
  return { failed: 'Falha no envio', uncertain: 'Resultado incerto', sending: 'Envio em andamento', unavailable: 'Nenhum envio · conta indisponível' }[delivery.status];
}

export function acceptedMailLabel(draft: MailDraft) {
  return isTestProvider(draft.provider_mode) ? 'Aceito pelo provedor de teste' : draft.provider_mode === 'gmail_smtp' ? 'Aceito pelo servidor de e-mail' : draft.provider_mode === 'gmail' ? 'Aceito pelo Gmail' : 'Aceito pelo provedor';
}

function immutableSnapshot(draft: MailDraft) {
  return JSON.stringify({
    sender: draft.sender && [draft.sender.email, draft.sender.sub, draft.sender.connection_id],
    evidence_hash: draft.evidence_hash, counterparty: draft.counterparty,
    attachments: draft.attachments.map(a => [a.name, a.sha256, a.content_type, a.size]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

/** Save may bind a different sender or refresh evidence; neither may be approved without a new review. */
export function matchesReviewedVersion(original: MailDraft, saved: MailDraft, fields: MailFields) {
  return saved.id === original.id && saved.issue_id === original.issue_id && saved.status === 'draft'
    && saved.version === original.version + 1 && /^[a-f0-9]{64}$/.test(saved.content_hash)
    && !saved.stale && !saved.blockers.length && immutableSnapshot(saved) === immutableSnapshot(original)
    && saved.to === fields.to && saved.subject === fields.subject && saved.body === fields.body;
}
