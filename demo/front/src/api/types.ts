// Shapes returned by the existing backend (GET /api/state). See back/docs/CONTRACT.md.
import type { RegistrationScope } from './agent/contract';

export type Severity = 'informativo' | 'atencao' | 'bloqueante';
export type IssueStatus = 'open' | 'resolved' | 'rejected';
export type LineOfBusiness = 'CHECKOUT' | 'REMESSA';

export interface Decision extends RegistrationScope {
  action: 'confirm' | 'reject' | 'adjust';
  actor: string;
  at: string;
  note: string;
  account_code?: string;
}

export interface Evidence { arquivo: string; linha: number; ref: string }

export interface Pendencia extends RegistrationScope {
  id_saida: string;
  tipo: string;
  ref_origem: string;
  valor_brl: string | null;
  merchant_name?: string;
  exposure_status?: 'complete' | 'partial' | 'unavailable';
  known_exposure_brl?: string;
  missing_exposure_count?: number;
  motivo: string;
  quem_decide: string;
  cnpj?: string;
  severity: Severity;
  suggestion?: string;
  evidence?: Evidence[];
  rule?: string;
  status: IssueStatus;
  decision: Decision | null;
  divergence_id?: string;
  invoice_id?: string;
}

export interface Comissao {
  id_saida: string;
  cnpj: string;
  lojista: string;
  linha_negocio: LineOfBusiness;
  comissao_brl: string;
  quantidade_origens?: number;
}

export interface Divergencia {
  id_saida: string;
  cnpj: string;
  lojista: string;
  linha_negocio: LineOfBusiness;
  produto?: string;
  ref_origem: string;
  taxa_contratada_pct: string;
  taxa_aplicada_pct: string;
  diferenca_brl: string;
  vigencia_inicio?: string;
  vigencia_fim?: string;
}

export interface Nota {
  id_saida: string;
  tomador_cnpj: string;
  tomador: string;
  linha_negocio: LineOfBusiness;
  valor_brl: string;
  discriminacao: string;
}

export interface Lancamento {
  id_saida: string;
  banco: string;
  ref_origem: string;
  data: string;
  descricao: string;
  valor: string;
  conta_codigo: string;
  conta_descricao?: string;
  conta_bancaria?: string;
  contrapartida_sentido?: 'C' | 'D';
  metodo: 'REGRA' | 'HUMANO' | 'IA';
  confianca: string;
  regra?: string;
  decisao?: string;
}

export interface RastroRow {
  id_saida: string;
  arquivo_origem: string;
  ref_origem: string;
  regra?: string;
  source_row?: number;
  valor: string | null;
}

export interface OrbeEntry {
  id: string;
  date: string;
  name: string;
  ec: string;
  type: string;
  modality: string;
  brand: string;
  installments: number;
  gross: string;
  net: string;
  applied_rate_pct: string;
  reported_fee?: string;
  original_date?: string;
  original_id?: string;
  physical_row?: number;
}

export interface RemittanceEntry {
  id: string;
  cnpj: string;
  name: string;
  currency: string;
  foreign_amount: string;
  ptax_rate: string;
  client_rate: string;
  gross_brl: string;
  spread_brl: string;
  estimated_spread_brl?: string;
  applied_rate_pct: string;
  contracted_date: string;
  settlement_date?: string;
  compliance?: string;
  observation?: string;
  physical_row?: number;
}

export interface BankEntry {
  id: string;
  bank: string;
  date: string;
  description: string;
  amount: string;
  balance?: string;
  ref_origem: string;
  physical_row?: number;
}

export interface Contract {
  id: string;
  cnpj: string;
  product: string;
  rate_pct: string;
  start: string;
  end: string;
  rule?: string;
  source_file?: string;
  source_ref?: string;
}

export interface Provenance { source_file?: string; source_id?: string; source_sha256?: string; source_ref?: string; physical_row?: number }
export interface OriginalEvidence extends Partial<OrbeEntry> { provenances?: Provenance[]; source_file?: string; source_sha256?: string; physical_row?: number }

export interface Detail {
  id_saida: string;
  arquivo_origem: string;
  ref_origem: string;
  regra?: string;
  formula?: string;
  motivo?: string;
  source_row?: number;
  valor?: string | null;
  contract?: Contract;
  entrada?: Partial<OrbeEntry & RemittanceEntry & BankEntry> & { id: string; provenances?: Provenance[]; original_evidence?: OriginalEvidence; original_resolution?: string; accumulated_reversal_brl?: string };
}

export interface Summary {
  period?: string;
  checkout_brl: string;
  checkout_count: number;
  remessa_brl: string;
  remessa_count: number;
  divergencias_brl: string;
  divergencias_abs_brl: string;
  divergencias_count: number;
  notas_brl: string;
  notas_count: number;
  pendencias_count: number;
  bank_count: number;
  open_issues: number;
  resolved_issues: number;
  blocking_issues: number;
  remittance_tolerance_pp?: string;
}

export interface Merchant {
  cnpj: string;
  name: string;
  ec?: string;
  active: boolean;
  candidate?: boolean;
  identity_rule?: string;
  source_file?: string;
  source_ref?: string;
}

export interface Rate {
  id: string;
  cnpj: string;
  product: string;
  start: string;
  end: string;
  rate_pct: string;
  rule?: string;
  source_file?: string;
  source_ref?: string;
}

export interface Account {
  code: string;
  name: string;
  nature?: 'D' | 'C';
  postable: boolean;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  kind: 'internal' | 'billing';
  cnpj?: string;
  min_severity: Severity;
  frequency: 'immediate' | 'digest';
  enabled: boolean;
}

export interface Email {
  id: string;
  kind: 'billing' | 'dispute' | 'internal';
  status: 'draft' | 'approved' | 'simulated' | 'sent';
  to: string;
  subject: string;
  body: string;
  related_id?: string;
  stale?: boolean;
  created_at?: string;
  approved_by?: string;
  approved_at?: string;
  sent_at?: string;
}

export interface Notification {
  id: string;
  at: string;
  title: string;
  body: string;
  severity: Severity;
  event?: string;
  link?: string;
  deliveries?: unknown[];
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface Source {
  name: string;
  sha256: string;
  rows?: number;
  embedded?: boolean;
  sheets?: string[];
}

export interface Assumption {
  id: string;
  question: string;
  source?: string;
  decision?: string;
  impact?: string;
  status?: string;
}

export interface Closing {
  status: 'open' | 'closed';
  actor?: string;
  closed_at?: string | null;
  reason?: string;
  waiver?: boolean;
}

export interface Parameters {
  closing_deadline?: string;
  remittance_tolerance_pp?: string;
  remittance_share_pct?: string;
  mode?: string;
}

export interface AppState {
  ingestion_counts?: import('./agent/contract').IngestionCounts;
  period: string;
  run_id?: string;
  read_only?: boolean;
  has_data?: boolean;
  scope?: { competencia?: string; run_id?: string | null };
  closing: Closing;
  summary: Summary;
  results: {
    comissoes: Comissao[];
    divergencias: Divergencia[];
    notas: Nota[];
    lancamentos: Lancamento[];
    pendencias: Pendencia[];
    rastro: RastroRow[];
    details: Detail[];
  };
  merchants: Merchant[];
  rates: Rate[];
  accounts: Account[];
  parameters: Parameters;
  contacts: Contact[];
  notifications: Notification[];
  emails: Email[];
  audit: AuditRow[];
  sources: Source[];
  source_dir?: string;
  assumptions: Assumption[];
  validation: { errors: unknown[]; warnings: unknown[]; trace_ok?: boolean; source_count?: number };
}

export interface Trace {
  rows: RastroRow[];
  details: Detail[];
}
