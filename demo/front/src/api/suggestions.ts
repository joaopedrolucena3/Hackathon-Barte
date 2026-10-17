import { isTestProvider, mailRequest, type Counterparty, type MailAccount, type MailAttachment, type MailFields, type MailIdentity } from './mail';

export interface MailSuggestion extends MailFields {
  id: string; run_id: string; period: string; counterparty: Counterparty; kind: string;
  title: string; justification: string; recommended_action: string; limitations: string[];
  items: { id: string; reference: string; reason: string; value_brl?: string | number | null }[];
  item_count: number; status: 'suggested' | 'dismissed' | 'sending' | 'sent' | 'failed' | 'uncertain';
  version: number; content_hash: string; evidence_hash: string; sender: MailIdentity | null;
  attachments: MailAttachment[]; blockers: { code: string; message: string }[];
  duplicate_of?: string; created_at: string; updated_at: string; provider_mode?: string;
  error?: { code?: string; message: string };
  approval?: { at: string; declared_actor: string; version: number; google_account?: MailIdentity };
}
export interface SuggestionRun { id: string; period: string; competencia?: string; draft: boolean; status: string; started_at?: string; finished_at?: string }
export interface SuggestionList {
  suggestions: MailSuggestion[];
  summary?: { run_id: string; prepared_at?: string; excluded: { id: string; kind: string; reason: string }[]; unavailable?: string | boolean | { code: string; message: string } };
}

const path = '/api/mail/suggestions';
export const suggestions = {
  runs: async () => (await mailRequest<{ runs: SuggestionRun[] }>(`${path}/runs`)).runs,
  list: (runId: string) => mailRequest<SuggestionList>(`${path}?run_id=${encodeURIComponent(runId)}`),
  prepare: (run_id: string) => mailRequest<SuggestionList>(`${path}/prepare`, { run_id }),
  get: (id: string) => mailRequest<MailSuggestion>(`${path}/${encodeURIComponent(id)}`),
  save: (draft: MailSuggestion, fields: MailFields) => mailRequest<MailSuggestion>(`${path}/${encodeURIComponent(draft.id)}`, { version: draft.version, ...fields }, 'PUT'),
  refresh: (draft: MailSuggestion) => mailRequest<MailSuggestion>(`${path}/${encodeURIComponent(draft.id)}`, { version: draft.version, refresh_evidence: true }, 'PUT'),
  dismiss: (draft: MailSuggestion, reason: string) => mailRequest<MailSuggestion>(`${path}/${encodeURIComponent(draft.id)}/dismiss`, { version: draft.version, reason }),
  approve: (draft: MailSuggestion, permission: boolean) => {
    if (!permission) return Promise.reject(new Error('Sua permissão explícita é necessária para enviar esta contestação.'));
    return mailRequest<MailSuggestion>(`${path}/${encodeURIComponent(draft.id)}/approve-send`, { version: draft.version, content_hash: draft.content_hash, permission: true });
  },
};

export function suggestionLabel(suggestion: MailSuggestion) {
  const labels = { suggested: 'Aguardando sua permissão', dismissed: 'Sugestão recusada', sending: 'Envio em andamento', sent: 'Aceito pelo servidor de e-mail', failed: 'Falha conhecida', uncertain: 'Resultado incerto' };
  return suggestion.status === 'sent' && isTestProvider(suggestion.provider_mode) ? 'Simulado · aceito pelo provedor de teste' : labels[suggestion.status];
}

/** Permission belongs to the exact saved message displayed to the reviewer. */
export function suggestionReviewKey(draft: MailSuggestion, fields: MailFields) {
  return JSON.stringify({ id: draft.id, version: draft.version, hash: draft.content_hash, evidence: draft.evidence_hash, sender: draft.sender, fields, attachments: draft.attachments.map(file => [file.id, file.sha256]) });
}

export function canAuthorizeSuggestion(draft: MailSuggestion, fields: MailFields, account?: MailAccount) {
  return draft.status === 'suggested' && !draft.blockers.length && !draft.duplicate_of
    && draft.to === fields.to && draft.subject === fields.subject && draft.body === fields.body
    && !!draft.to.trim() && !!draft.subject.trim() && !!draft.body.trim()
    && !!draft.content_hash && !!account?.authorized && !!account.connected
    && !!draft.sender && !!account.connection
    && draft.sender.connection_id === account.connection.connection_id
    && draft.sender.email === account.connection.email && draft.sender.sub === account.connection.sub;
}
