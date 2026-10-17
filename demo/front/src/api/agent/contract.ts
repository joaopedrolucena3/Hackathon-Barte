// UI contract for the real closing workflow and the explicitly enabled demo adapter.

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
  dataset?: string;
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
  dataset?: string;
  datasets?: string[];
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

/** Data desk: the whole output table of a step, read-only. Decimals stay strings; `rid` is the row index in the file. */
export type DataKind = 'money' | 'percent' | 'decimal' | 'number' | 'integer' | 'boolean' | 'date' | 'json' | 'text';
export type DataValue = string | number | boolean | null | unknown[] | { [key: string]: unknown };

export interface DataColumn {
  name: string;
  label: string;
  kind: DataKind;
  description: string;
  /** Technical columns (e.g. `__exception_ids`) travel with the rows but are not shown as columns. */
  hidden: boolean;
}

export interface ControlTotal { column: string; label: string; value: string }

export interface InvariantSide { step_id: string; step_number: number; step_title: string; dataset: string | null; label: string; value: string }
export interface InvariantCheck { id: string; title: string; ok: boolean; sides: InvariantSide[] }

export interface StepTable {
  run_id: string;
  step_id: string;
  step_number: number;
  dataset: string;
  datasets: { name: string; rows: number; title?: string }[];
  sha256: string;
  row_count: number;
  columns: DataColumn[];
  rows: DataValue[][];
  totals: ControlTotal[];
  invariants: InvariantCheck[];
}

export interface ViewExportInput {
  dataset: string;
  /** Rows in the order shown on screen. */
  rids: number[];
  columns: string[];
  formato: 'xlsx' | 'csv';
  /** Human description of the filters and sort, written into the file. */
  descricao: string;
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
  /** Identifier returned by the upload API; hashes alone do not select a server file. */
  id?: string;
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
  rows?: number;
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
  entry_id?: string;
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
  associated_entries?: { entry_id: string; account_code: string; amount: string; event: string }[];
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
  /** Builder "Testar": run unsaved steps as a draft (no export). */
  steps?: PipelineStep[];
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
  getRunAccounts(id: string): Promise<{ code: string; name: string; postable: boolean }[]>;
  /** Live events (SSE). `onReconnect` fires after a dropped stream comes back: reload the consolidated run. */
  subscribeRun(id: string, onEvent: (event: RunEvent) => void, onReconnect?: () => void): () => void;
  getPreview(runId: string, stepId: string, query: PreviewQuery): Promise<PreviewPage>;
  getStepTable(runId: string, stepId: string, dataset?: string): Promise<StepTable>;
  /** Downloads the rows on screen as XLSX or CSV. */
  exportView(runId: string, stepId: string, input: ViewExportInput): Promise<void>;

  listExceptions(runId: string): Promise<ReviewException[]>;
  getApprovalSummary(runId: string): Promise<ApprovalSummary>;
  decide(runId: string, exceptionId: string, decision: Omit<ReviewDecision, 'actor' | 'at' | 'before_amount' | 'before_account'>): Promise<ReviewException>;
  /** Bulk accept of alerts, or one decision for blockers of the same issue and merchant. */
  decideMany(runId: string, ids: string[], decision: { action: 'accept' | 'exclude'; note: string }, onProgress?: (done: number) => void): Promise<{ decided: number }>;
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
