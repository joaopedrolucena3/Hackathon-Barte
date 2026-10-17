// Endpoints that already exist in back/src/app.py.
import { getJSON, sendJSON, sendAuthorizedJSON } from './http';
import type { AppState, Trace } from './types';
import { scopedUrl, type DataScope } from '../lib/scope';

export interface OperationalConfig { competencia: string; closing_deadline?: string | null; reason?: string; updated_by?: string; updated_at?: string }

type Ok = { ok: true; id?: string; email?: { id: string } };

export const core = {
  state: (scope: DataScope = {}) => getJSON<AppState>(scopedUrl('/api/state', scope)),
  trace: (id: string, scope: DataScope = {}) => getJSON<Trace>(scopedUrl('/api/trace', scope, { id })),
  operationalConfig: (comp: string) => getJSON<OperationalConfig>(`/api/competencias/${encodeURIComponent(comp)}/config`),
  saveOperationalConfig: (comp: string, body: { closing_deadline: string | null; reason: string }) => sendAuthorizedJSON<OperationalConfig>(`/api/competencias/${encodeURIComponent(comp)}/config`, body, 'PUT'),

  recalculate: (period: string) => sendJSON<Ok>('/api/recalculate', { period }),
  importDir: (source_dir: string, period: string) => sendJSON<Ok>('/api/import', { source_dir, period }),
  decide: (body: { id: string; action: 'confirm' | 'reject' | 'adjust'; note: string; account_code?: string }) =>
    sendJSON<Ok>('/api/decisions', body),
  close: (allow_open: boolean, reason: string) => sendJSON<Ok>('/api/close', { allow_open, reason }),
  reopen: (reason: string) => sendJSON<Ok>('/api/reopen', { reason }),

  saveRate: (body: { id?: string; cnpj: string; product: string; start: string; end: string; rate_pct: string; reason: string }) =>
    sendJSON<Ok>('/api/rates', body),
  saveMerchant: (body: { cnpj: string; name: string; ec: string; active: boolean; reason: string; candidate?: boolean; identity_confirmed?: boolean }) =>
    sendJSON<Ok>('/api/merchants', body),
  saveParameters: (body: { remittance_tolerance_pp: string; closing_deadline: string; reason: string }) =>
    sendJSON<Ok>('/api/parameters', body),
  saveContact: (body: { id?: string; name: string; email: string; kind: string; cnpj?: string; min_severity: string; frequency: string; enabled: boolean }) =>
    sendJSON<Ok>('/api/contacts', body),

  draftEmail: (body: { invoice_id?: string; issue_id?: string; report?: boolean }) => sendJSON<Ok>('/api/emails/draft', body),
  saveEmail: (body: { id: string; to: string; subject: string; body: string }) => sendJSON<Ok>('/api/emails/save', body),
  approveEmail: (id: string) => sendJSON<Ok>('/api/emails/approve', { id }),
  sendEmail: (id: string) => sendJSON<Ok>('/api/emails/send', { id }),
  runNotifications: () => sendJSON<Ok>('/api/notifications/run', {}),
};

export const downloads = {
  csv: (file: string, scope: DataScope = {}) => scopedUrl('/api/export', scope, { file }),
  report: (scope: DataScope = {}) => scopedUrl('/api/report', scope),
  reportDownload: (scope: DataScope = {}) => scopedUrl('/api/report', scope, { download: '1' }),
  zip: (scope: DataScope = {}) => scopedUrl('/api/export.zip', scope),
};

export const OFFICIAL_EXPORTS: [file: string, title: string, subtitle: string][] = [
  ['comissoes_por_lojista.csv', 'Comissões por lojista', 'Checkout e remessa'],
  ['divergencias_taxa.csv', 'Divergências de taxa', 'Diferenças por transação'],
  ['notas_a_emitir.csv', 'Notas a emitir', 'Tomadores e discriminação'],
  ['lancamentos_classificados.csv', 'Lançamentos classificados', 'Contas e método'],
  ['pendencias.csv', 'Pendências', 'Motivo, decisão e responsável'],
  ['rastro.csv', 'Rastro completo', 'Origem de cada valor'],
];
