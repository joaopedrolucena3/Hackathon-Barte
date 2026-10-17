// Contract of the closing agent (A2, B1–B6, C1, C8). Implemented by mock/ today and by http.ts once
// the backend ships the endpoints listed in front/API_PENDENTE.md.

export type Area = 'Adquirência' | 'Bancos' | 'Câmbio' | 'Contabilidade' | 'Comercial';

/** Display vocabulary shared by steps, runs and checklist tasks (always rendered as text + color). */
export type Status =
  | 'pending' | 'running' | 'done' | 'exceptions' | 'failed'
  | 'awaiting_approval' | 'approved' | 'rejected' | 'skipped';

export type ColumnType = 'text' | 'code' | 'money' | 'percent' | 'pp' | 'date' | 'number' | 'hash' | 'status';

export interface ColumnSchema {
  key: string;
  label: string;
  type: ColumnType;
  /** Column created by this step: what the agent did. */
  is_new?: boolean;
}

export interface ExceptionRef {
  id: string;
  severity: ReviewSeverity;
  description: string;
  count?: number;
}

export type CellValue = string | number | boolean | null;

export interface PreviewRow {
  _id: string;
  _exception?: ExceptionRef | null;
  _diff?: 'added' | 'removed' | 'same';
  [column: string]: CellValue | ExceptionRef | undefined;
}

export interface ColumnFilter {
  key: string;
  op: 'contains' | 'eq' | 'gt' | 'lt';
  value: string;
}

export interface PreviewQuery {
  page: number;
  page_size: number;
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  filters?: ColumnFilter[];
  only_exceptions?: boolean;
  diff?: boolean;
  /** Pipeline builder: preview the step with draft parameters instead of the ones the run used. */
  params_override?: Record<string, ParamValue>;
}

export interface PreviewPage {
  step_id: string;
  state: 'ready' | 'pending' | 'running' | 'not_tabular' | 'failed';
  schema: ColumnSchema[];
  rows: PreviewRow[];
  total_rows: number;
  page: number;
  page_size: number;
  /** Sums of money columns: current page and the whole filtered dataset (provided by the backend). */
  totals: { page: Record<string, string>; all: Record<string, string> };
  input_rows?: number;
  exceptions_total?: number;
  progress?: { done: number; total: number };
  diff_summary?: { added: number; removed: number };
  gate?: ApprovalSummary;
  message?: string;
}

export interface StepMetrics {
  rows_in?: number;
  rows_out?: number;
  exceptions?: number;
  blocking?: number;
  progress?: { done: number; total: number };
  extra?: Record<string, string | number>;
}

export interface StepRun {
  id: string;
  type: string;
  title: string;
  kind: StepKind;
  status: Status;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  metrics: StepMetrics;
  params: Record<string, ParamValue>;
  code_version: string;
  output_hash?: string;
  error?: string;
  log?: string[];
}

export interface InputFile {
  name: string;
  size?: number;
  sha256: string;
  rows?: number;
  discarded?: number;
}

export interface Approval {
  status: 'approved' | 'rejected';
  actor: string;
  at: string;
  comment: string;
}

export interface ExportFile {
  name: string;
  sha256: string;
  rows: number;
  /** Where the browser downloads it from. */
  href?: string;
}

export interface RunRef {
  id: string;
  comp: string;
  status: Status;
  created_at: string;
  created_by: string;
  draft?: boolean;
  pipeline: { id: string; name: string; version: number };
}

export interface Run extends RunRef {
  code_version: string;
  finished_at?: string;
  source: 'pack' | 'upload' | 'folder';
  folder?: string;
  files: InputFile[];
  steps: StepRun[];
  approval?: Approval;
  exports?: ExportFile[];
}

export type RunEvent =
  | { type: 'step_started'; step_id: string; at: string }
  | { type: 'step_progress'; step_id: string; done: number; total: number }
  | { type: 'step_finished'; step_id: string; status: Status; at: string; duration_ms: number; metrics: StepMetrics; output_hash?: string; error?: string }
  | { type: 'awaiting_approval'; exceptions: number; blocking: number }
  | { type: 'run_finished'; status: Status; at: string };

export interface ChecklistTask {
  id: string;
  comp: string;
  area: Area;
  title: string;
  kind: 'agent' | 'manual';
  owner: string;
  reviewer?: string;
  status: Status;
  step_types?: string[];
  run_id?: string;
  step_id?: string;
  exceptions?: number;
  comment?: string;
  updated_at?: string;
  updated_by?: string;
}

export interface CompetenciaInfo {
  comp: string;
  has_data: boolean;
  current: boolean;
}

export type ReviewSeverity = 'bloqueante' | 'alerta';
export type ReviewAction = 'accept' | 'adjust' | 'exclude';

export interface ReviewDecision {
  action: ReviewAction;
  actor: string;
  at: string;
  note: string;
  account_code?: string;
  amount?: string;
  before_amount?: string;
  before_account?: string;
}

export interface ReviewException {
  id: string;
  step_type: string;
  step_title: string;
  kind: string;
  title: string;
  severity: ReviewSeverity;
  original_severity: string;
  merchant: string;
  cnpj?: string;
  date?: string;
  amount?: string;
  impact_brl: string;
  description: string;
  suggestion?: string;
  rule?: string;
  who_decides?: string;
  ref_origem: string;
  evidence: { arquivo: string; linha: number; ref: string }[];
  /** Bank line the exception refers to, when reclassification is possible. */
  bank_line_id?: string;
  current_account?: string;
  decision: ReviewDecision | null;
}

export interface ApprovalSummary {
  total: number;
  blocking: number;
  alerts: number;
  decided: number;
  open_blocking: number;
  open_alerts: number;
  impact_brl: string;
  open_impact_brl: string;
  batch: { entries: number; excluded: number; debit_brl: string; credit_brl: string; balanced: boolean };
}

export type AuditEntry =
  | { kind: 'input_file'; at: string; file: InputFile }
  | { kind: 'pipeline'; at: string; pipeline: RunRef['pipeline']; code_version: string; actor: string }
  | { kind: 'step'; at: string; step: StepRun }
  | { kind: 'decision'; at: string; actor: string; exception_id: string; title: string; action: ReviewAction | 'reject'; before: string; after: string; note: string }
  | { kind: 'approval'; at: string; approval: Approval }
  | { kind: 'export'; at: string; file: ExportFile };

export interface AuditTrail {
  run: RunRef;
  entries: AuditEntry[];
}

export interface RunComparison {
  a: RunRef;
  b: RunRef;
  steps: { type: string; title: string; hash_a?: string; hash_b?: string; match: boolean }[];
  reproducible: boolean;
}

export type StepKind = 'calc' | 'gate' | 'export';
export type ParamValue = string | number | boolean;

export interface ParamField {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'select' | 'text';
  help: string;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  readonly?: boolean;
}

export interface StepCatalogItem {
  type: string;
  title: string;
  description: string;
  area: Area;
  kind: StepKind;
  requires: string[];
  params_schema: ParamField[];
  /** Cannot be removed or disabled (approval gate). */
  locked?: boolean;
}

export interface PipelineStep {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export interface Pipeline {
  id: string;
  name: string;
  version: number;
  steps: PipelineStep[];
  updated_at: string;
  author: string;
}

export interface PipelineVersion extends Pipeline {
  changes: string[];
}

export interface ValidationIssue {
  step_id?: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface PendencySlice {
  key: string;
  label: string;
  count: number;
  brl: string;
}

export interface Insights {
  comp: string;
  pendencias: {
    open_brl: string;
    resolved_brl: string;
    open_count: number;
    resolved_count: number;
    by_state: PendencySlice[];
    by_type: (PendencySlice & { severity: ReviewSeverity; open_count: number })[];
  };
  divergencias_por_lojista: { cnpj: string; lojista: string; count: number; signed_brl: string; abs_brl: string }[];
  bancos: {
    bank: string;
    account: string;
    count: number;
    in_brl: string;
    out_brl: string;
    net_brl: string;
    daily: { date: string; in_brl: string; out_brl: string }[];
  }[];
  contas: { code: string; name: string; count: number; abs_brl: string; in_brl: string; out_brl: string }[];
  notas: { total_brl: string; count: number; by_line: { line: string; count: number; brl: string }[] };
}

export interface CreateRunInput {
  comp: string;
  source: Run['source'];
  files?: InputFile[];
  folder?: string;
  draft?: boolean;
}

export interface AgentApi {
  mode: 'mock' | 'http';
  listCompetencias(): Promise<CompetenciaInfo[]>;
  getInsights(comp: string): Promise<Insights>;

  getChecklist(comp: string): Promise<ChecklistTask[]>;
  updateChecklistTask(id: string, patch: Partial<Pick<ChecklistTask, 'status' | 'owner' | 'comment'>>): Promise<ChecklistTask>;

  uploadFiles(files: File[]): Promise<InputFile[]>;
  createRun(input: CreateRunInput): Promise<Run>;
  listRuns(comp?: string): Promise<RunRef[]>;
  getRun(id: string): Promise<Run>;
  /** Live events (SSE). `onReconnect` fires after a dropped stream comes back: reload the consolidated run. */
  subscribeRun(id: string, onEvent: (event: RunEvent) => void, onReconnect?: () => void): () => void;
  getPreview(runId: string, stepId: string, query: PreviewQuery): Promise<PreviewPage>;

  listExceptions(runId: string): Promise<ReviewException[]>;
  getApprovalSummary(runId: string): Promise<ApprovalSummary>;
  decide(runId: string, exceptionId: string, decision: Omit<ReviewDecision, 'actor' | 'at' | 'before_amount' | 'before_account'>): Promise<ReviewException>;
  approve(runId: string, comment: string): Promise<Run>;
  reject(runId: string, comment: string): Promise<Run>;
  getAudit(runId: string): Promise<AuditTrail>;
  /** Downloads one of the run's export files (lancamentos_fenix.csv, relatorio_excecoes.csv, auditoria.json). */
  downloadExport(runId: string, name: string): Promise<void>;
  compareRuns(a: string, b: string): Promise<RunComparison>;

  getCatalog(): Promise<StepCatalogItem[]>;
  getPipeline(version?: number): Promise<Pipeline>;
  listPipelineVersions(): Promise<PipelineVersion[]>;
  validatePipeline(steps: PipelineStep[]): Promise<ValidationResult>;
  savePipeline(steps: PipelineStep[]): Promise<Pipeline>;
}
