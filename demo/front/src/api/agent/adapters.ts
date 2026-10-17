// Translate the persisted workflow API into the display contract. Monetary values stay decimal strings.
import { readable } from '../../lib/format';
import type {
  Approval, Area, AuditEntry, AuditTrail, ChecklistTask, ColumnSchema, ExportFile, InputFile,
  ParamField, ParamValue, Pipeline, PreviewPage, PreviewQuery, PreviewRow, ReviewDecision,
  RegistrationScope, ReviewException, Run, RunEvent, Status, StepCatalogItem, StepKind, StepMetrics, StepRun, ValidationIssue,
} from './contract';

export type RecordData = Record<string, unknown>;
export const object = (value: unknown): RecordData => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ''): string => value == null ? fallback : String(value);
const optionalString = (value: unknown): string | undefined => value == null ? undefined : String(value);
const optionalNumber = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined;
const numeric = (value: unknown, fallback = 0): number => typeof value === 'number' ? value : fallback;

const TITLES: Record<string, string> = {
  ler_arquivos: 'Ler arquivos', normalizar_orbe: 'Normalizar Orbe', resolver_lojista: 'Resolver lojista',
  conferir_mdr: 'Conferir MDR', vincular_estornos: 'Vincular estornos', conciliar_aurora: 'Conferir bancos',
  processar_cambio: 'Processar câmbio', gerar_lancamentos: 'Gerar lançamentos', aprovacao: 'Aprovação humana',
  exportar_erp: 'Exportar para o Fênix',
};
const AREAS: Record<string, Area> = {
  ler_arquivos: 'Contabilidade', normalizar_orbe: 'Adquirência', resolver_lojista: 'Comercial',
  conferir_mdr: 'Adquirência', vincular_estornos: 'Adquirência', conciliar_aurora: 'Bancos',
  processar_cambio: 'Câmbio', gerar_lancamentos: 'Contabilidade', aprovacao: 'Contabilidade', exportar_erp: 'Contabilidade',
};
const PARAM_LABELS: Record<string, string> = {
  fallback: 'Vínculo alternativo', sugerir_nome: 'Sugerir vínculo pelo nome', tolerancia_pp: 'Tolerância em pontos percentuais',
  janela_dias: 'Janela em dias', conciliar_parcelas_orbe: 'Conciliar parcelas Orbe', participacao_spread: 'Participação no spread',
  spread_padrao_pct: 'Spread padrão (%)', mapa: 'Mapa contábil', calcular_tributos: 'Calcular tributos', formato: 'Formato da exportação',
};
const STATUS: Record<string, Status> = {
  queued: 'pending', pending: 'pending', running: 'running', exporting: 'running', done: 'done',
  done_with_exceptions: 'exceptions', exceptions: 'exceptions', failed: 'failed', awaiting_approval: 'awaiting_approval',
  approved: 'approved', rejected: 'rejected', skipped: 'skipped', pendente: 'pending', em_andamento: 'running',
  concluida: 'done', com_excecoes: 'exceptions', aguardando_aprovacao: 'awaiting_approval',
};
export function adaptStatus(value: unknown): Status {
  const status = STATUS[string(value)];
  if (!status) throw new Error(`Estado de execução não reconhecido: ${string(value)}`);
  return status;
}
export const stepKind = (type: string): StepKind => type === 'aprovacao' ? 'gate' : type === 'exportar_erp' ? 'export' : 'calc';

export function adaptFile(value: unknown): InputFile {
  const raw = object(value);
  return {
    id: optionalString(raw.file_id ?? raw.id), name: string(raw.original_name ?? raw.name ?? raw.filename), sha256: string(raw.sha256),
    role: optionalString(raw.role ?? object(raw.validation).role), status: optionalString(raw.validation_status ?? raw.status ?? object(raw.validation).status),
    validation_reason: optionalString(raw.validation_reason ?? raw.reason ?? object(raw.validation).reason ?? object(raw.validation).message),
    rows_received: optionalNumber(raw.rows_received ?? object(raw.validation).rows_received), rows_valid: optionalNumber(raw.rows_valid ?? object(raw.validation).rows_valid), rows_unique: optionalNumber(raw.rows_unique),
    rows_duplicated: optionalNumber(raw.rows_duplicated ?? raw.rows_duplicate ?? raw.duplicate_rows), rows_conflicting: optionalNumber(raw.rows_conflicting ?? raw.conflicting_rows),
    import_action: optionalString(raw.import_action), duplicate_of: optionalString(raw.duplicate_of),
    inherited: raw.inherited === true || !!raw.inherited_from,
    size: optionalNumber(raw.size), rows: optionalNumber(raw.rows_read ?? raw.rows ?? raw.row_count), discarded: optionalNumber(raw.rows_discarded ?? raw.discarded),
  };
}
export function adaptExport(value: unknown, runId: string): ExportFile {
  const raw = object(value);
  return { name: string(raw.name), sha256: string(raw.sha256), rows: optionalNumber(raw.rows), href: `/api/runs/${encodeURIComponent(runId)}/exports/${encodeURIComponent(string(raw.name))}` };
}
export function adaptApproval(value: unknown): Approval | undefined {
  if (!value) return undefined;
  const raw = object(value);
  return { status: raw.decisao === 'aprovar' || raw.status === 'approved' ? 'approved' : 'rejected', actor: string(raw.actor), at: string(raw.at), comment: string(raw.comentario ?? raw.comment) };
}
export function adaptMetrics(value: unknown): StepMetrics {
  const raw = object(value);
  const extra = Object.fromEntries(Object.entries(raw).filter(([key, entry]) => !['rows_in', 'rows_out', 'exceptions', 'blocking', 'progress'].includes(key) && (typeof entry === 'number' || typeof entry === 'string'))) as Record<string, string | number>;
  return {
    rows_in: optionalNumber(raw.rows_in), rows_out: optionalNumber(raw.rows_out), exceptions: optionalNumber(raw.exceptions ?? raw.exceptions_open),
    blocking: optionalNumber(raw.blocking ?? raw.blocking_open), ...(Object.keys(extra).length ? { extra } : {}),
    ...(raw.progress ? { progress: { done: numeric(object(raw.progress).done), total: numeric(object(raw.progress).total) } } : {}),
  };
}
export function adaptStep(value: unknown, snapshot: RecordData, runStatus?: Status): StepRun {
  const raw = object(value), type = string(raw.type);
  let status = adaptStatus(raw.status);
  if (type === 'aprovacao' && runStatus === 'awaiting_approval') status = 'awaiting_approval';
  return {
    id: string(raw.id), type, title: string(raw.title, TITLES[type] || readable(type)), kind: stepKind(type), status,
    params: object(raw.params) as Record<string, ParamValue>, metrics: adaptMetrics(raw.metrics),
    code_version: string(object(snapshot.step_versions)[type], string(object(snapshot.code).content_hash)),
    started_at: optionalString(raw.started_at), finished_at: optionalString(raw.finished_at), duration_ms: optionalNumber(raw.duration_ms),
    output_hash: optionalString(raw.output_hash), error: typeof raw.error === 'string' ? raw.error : optionalString(object(raw.error).message),
    log: array(raw.logs ?? raw.log).map(item => string(item)),
  };
}
export function adaptRun(value: unknown): Run {
  const raw = object(value), snapshot = object(raw.snapshot), definition = object(snapshot.definition);
  const status = raw.status === 'done' && raw.draft !== true && object(raw.approval).decisao === 'aprovar' ? 'approved' : raw.status === 'approved' ? 'running' : adaptStatus(raw.status);
  const source: Run['source'] = raw.source === 'upload' || raw.source === 'folder' ? raw.source : 'pack';
  const run: Run = {
    id: string(raw.id ?? raw.run_id), comp: string(raw.competencia ?? raw.period ?? raw.comp), status,
    created_at: string(raw.created_at), created_by: string(raw.created_by), finished_at: optionalString(raw.finished_at), draft: raw.draft === true,
    pipeline: { id: string(raw.pipeline_id ?? definition.id), name: string(definition.title, 'Fechamento mensal Tarvo'), version: numeric(raw.pipeline_version ?? definition.version, 1) },
    code_version: string(object(snapshot.code).content_hash, string(snapshot.git_commit)), source,
    parent_run_id: optionalString(raw.parent_run_id ?? snapshot.parent_run_id), folder: optionalString(raw.source_dir), files: array(snapshot.input_manifest ?? snapshot.sources).map((value, index) => adaptFile({ ...object(array(snapshot.sources)[index]), ...object(value) })),
    ingestion_counts: (snapshot.ingestion_counts ?? object(object(array(raw.steps).find(value => object(value).type === 'ler_arquivos')).metrics).ingestion_counts) as Run['ingestion_counts'],
    steps: array(raw.steps).map(step => adaptStep(step, snapshot, status)), approval: adaptApproval(raw.approval),
    exports: array(raw.exports).map(file => adaptExport(file, string(raw.id ?? raw.run_id))),
  };
  if (run.approval) run.steps = run.steps.map(step => step.kind === 'gate' ? { ...step, status: run.approval!.status } : step);
  // The gate's own metrics only count its step; the run carries what waits for a human, the same figures the
  // awaiting_approval event sends. Without this a refetch after the event put the gate back to 0 exceptions.
  if (raw.exceptions_total !== undefined || raw.exceptions_open !== undefined) {
    const exceptions = numeric(raw.exceptions_total ?? raw.exceptions_open), blocking = optionalNumber(raw.blocking_open);
    run.steps = run.steps.map(step => step.kind === 'gate' ? { ...step, metrics: { ...step.metrics, exceptions, blocking } } : step);
  }
  const failure = object(raw.error);
  if (failure.message) run.steps = run.steps.map(step => step.id === failure.step_id ? { ...step, error: string(failure.message) } : step);
  return run;
}

export function adaptPipeline(value: unknown): Pipeline {
  const raw = object(value);
  return {
    id: string(raw.id), name: string(raw.title ?? raw.name, 'Fechamento mensal Tarvo'), version: numeric(raw.version, 1),
    author: string(raw.created_by ?? raw.author), updated_at: string(raw.created_at ?? raw.updated_at),
    steps: array(raw.steps).map(value => {
      const step = object(value);
      return { id: string(step.id), type: string(step.type), enabled: step.enabled !== false, params: object(step.params) as Record<string, ParamValue> };
    }),
  };
}
export function adaptCatalog(values: unknown[]): StepCatalogItem[] {
  const raw = values.map(object);
  const producers = new Map<string, string>();
  raw.forEach(item => array(item.outputs).forEach(output => producers.set(string(output), string(item.type))));
  return raw.map(item => {
    const type = string(item.type);
    const params: ParamField[] = Object.entries(object(object(item.params_schema).properties)).map(([key, value]) => {
      const field = object(value), options = array(field.enum);
      const kind: ParamField['type'] = options.length ? 'select' : field.type === 'boolean' ? 'boolean' : field.type === 'number' || field.type === 'integer' ? 'number' : 'text';
      return {
        key, label: PARAM_LABELS[key] || readable(key), type: kind, help: string(field.description),
        default: (field.default ?? field.const ?? (kind === 'boolean' ? false : kind === 'number' ? 0 : '')) as ParamValue,
        readonly: 'const' in field, min: optionalNumber(field.minimum), max: optionalNumber(field.maximum),
        step: field.type === 'integer' ? 1 : field.type === 'number' ? 0.001 : undefined,
        options: options.length ? options.map(value => ({ value: string(value), label: readable(string(value)) })) : undefined,
      };
    });
    return {
      type, title: string(item.title), description: string(item.description), area: AREAS[type] || 'Contabilidade', kind: stepKind(type),
      requires: [...new Set(array(item.inputs).map(input => producers.get(string(input))).filter((type): type is string => !!type))],
      params_schema: params, locked: type === 'aprovacao' || type === 'exportar_erp',
    };
  });
}
export function adaptValidation(values: unknown): ValidationIssue[] {
  return array(values).map(value => {
    const raw = object(value);
    return { message: string(raw.message), step_id: optionalString(raw.step_id), field: optionalString(raw.field ?? raw.path) };
  });
}
export function adaptChecklist(value: unknown): ChecklistTask {
  const raw = object(value);
  return {
    id: string(raw.id), comp: string(raw.competencia ?? raw.comp), area: string(raw.area, 'Contabilidade') as Area,
    title: string(raw.title ?? raw.titulo), kind: raw.manual ? 'manual' : 'agent', owner: string(raw.responsavel ?? raw.owner),
    reviewer: optionalString(raw.reviewer), status: adaptStatus(raw.status), step_types: raw.step_type ? [string(raw.step_type)] : undefined,
    run_id: optionalString(raw.run_id), step_id: optionalString(raw.step_id), exceptions: optionalNumber(raw.exceptions),
    comment: optionalString(raw.comentario ?? raw.comment), updated_at: optionalString(raw.updated_at), updated_by: optionalString(raw.updated_by),
  };
}
function registrationScope(raw: RecordData): RegistrationScope {
  if (raw.group_scope !== 'merchant_period') return {};
  return {
    group_scope: 'merchant_period', period: optionalString(raw.period), cnpj: optionalString(raw.cnpj),
    operation_count: optionalNumber(raw.operation_count), source_fingerprint: optionalString(raw.source_fingerprint),
    affected_operations: array(raw.affected_operations).map(value => {
      const operation = object(value);
      return {
        id: string(operation.id), ref: string(operation.ref), arquivo: string(operation.arquivo), linha: Number(operation.linha) || 0,
        date: optionalString(operation.date), business: string(operation.business),
        exposure_brl: operation.exposure_brl == null ? null : string(operation.exposure_brl),
        exposure_basis: operation.exposure_basis === 'reported_fee' || operation.exposure_basis === 'spread_brl' ? operation.exposure_basis : undefined,
      };
    }),
  };
}

export function adaptDecision(value: unknown): ReviewDecision | null {
  if (!value) return null;
  const raw = object(value);
  const action = ({ aceitar: 'accept', ajustar: 'adjust', excluir: 'exclude' } as const)[string(raw.acao) as 'aceitar' | 'ajustar' | 'excluir'];
  if (!action) throw new Error('Decisão de revisão não reconhecida.');
  return { action, actor: string(raw.actor), at: string(raw.at), note: string(raw.justificativa), account_code: optionalString(raw.conta), amount: optionalString(raw.valor), entry_id: optionalString(raw.entry_id),
    ...registrationScope(raw), billing_authorized: typeof raw.billing_authorized === 'boolean' ? raw.billing_authorized : undefined };
}
export function adaptException(value: unknown, run: Run): ReviewException {
  const raw = object(value), step = run.steps.find(step => step.id === raw.step_id), kind = string(raw.tipo ?? raw.kind), ref = string(raw.ref_origem);
  const scope = registrationScope(raw), grouped = scope.group_scope === 'merchant_period';
  const impact = raw.impacto_rs !== undefined ? raw.impacto_rs : raw.valor_brl;
  return {
    id: string(raw.id ?? raw.id_saida), step_type: step?.type || string(raw.step_type), step_title: step?.title || string(raw.step_id),
    kind, title: readable(kind), severity: raw.severidade === 'bloqueante' ? 'bloqueante' : 'alerta', original_severity: string(raw.severity ?? raw.severidade),
    ...scope,
    merchant: string(raw.merchant_name ?? raw.lojista ?? raw.merchant, 'Não informado'), cnpj: optionalString(raw.cnpj), date: grouped ? undefined : optionalString(raw.data ?? raw.date),
    amount: grouped ? undefined : optionalString(raw.amount ?? raw.valor_operacao), impact_brl: impact == null ? null : string(impact), description: string(raw.descricao ?? raw.motivo),
    exposure_status: raw.exposure_status === 'complete' || raw.exposure_status === 'partial' || raw.exposure_status === 'unavailable' ? raw.exposure_status : undefined,
    known_exposure_brl: optionalString(raw.known_exposure_brl), missing_exposure_count: optionalNumber(raw.missing_exposure_count),
    suggestion: optionalString(raw.sugestao ?? raw.suggestion), rule: optionalString(raw.regra ?? raw.rule), who_decides: optionalString(raw.quem_decide ?? raw.who_decides), ref_origem: ref,
    evidence: array(raw.origens ?? raw.evidence).map(value => { const origin = object(value); return { arquivo: string(origin.arquivo ?? origin.source_file), linha: Number(origin.linha ?? origin.physical_row) || 0, ref: string(origin.ref ?? origin.ref_origem) }; }),
    associated_entries: array(raw.associated_entries).map(value => { const entry = object(value); return { entry_id: string(entry.entry_id), account_code: string(entry.account_code), amount: string(entry.amount), event: string(entry.event) }; }),
    bank_line_id: optionalString(raw.bank_line_id), current_account: optionalString(raw.current_account ?? raw.conta_codigo), decision: adaptDecision(raw.decision),
  };
}

function previewColumn(value: unknown): ColumnSchema {
  const raw = object(value), key = string(raw.name ?? raw.key);
  const allowed: ColumnSchema['type'][] = ['text', 'code', 'money', 'percent', 'pp', 'date', 'number', 'hash', 'status'];
  const type = allowed.includes(raw.type as ColumnSchema['type']) ? raw.type as ColumnSchema['type'] : 'text';
  return { key, label: string(raw.label, key === 'foreign_amount' ? 'Valor em moeda estrangeira' : readable(key)), type: key === 'foreign_amount' ? 'number' : key.endsWith('_pp') ? 'pp' : type, is_new: raw.is_new === true || raw.new === true };
}
export function adaptPreview(value: unknown, query: PreviewQuery, exceptions: ReviewException[] = []): PreviewPage {
  const raw = object(value), page = numeric(raw.page, query.page), pageSize = numeric(raw.page_size, query.page_size);
  const byId = new Map(exceptions.map(exception => [exception.id, exception]));
  const rows: PreviewRow[] = array(raw.rows).map((value, index) => {
    const row = object(value);
    const cells = Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')).map(([key, value]) => [key, value == null || ['string', 'number', 'boolean'].includes(typeof value) ? value : JSON.stringify(value)]));
    const ids = array(row.__exception_ids).map(value => string(value));
    const exception = ids.map(id => byId.get(id)).find(item => item?.severity === 'bloqueante') || byId.get(ids[0]);
    return {
      ...cells, _id: `${string(row.id ?? row.id_saida ?? row.source_ref ?? row.ref_origem, 'row')}:${(page - 1) * pageSize + index}`,
      ...(exception ? { _exception: { id: exception.id, severity: exception.severity, description: exception.description, count: ids.length } } : {}),
    } as PreviewRow;
  });
  const totals = object(raw.totals), diff = object(raw.diff_summary ?? raw.diff);
  return {
    dataset: optionalString(raw.dataset), datasets: array(raw.datasets).map(value => string(value)),
    step_id: string(raw.step_id), state: 'ready', schema: array(raw.schema).map(previewColumn).filter(column => !column.key.startsWith('__')),
    rows, total_rows: numeric(raw.total_rows ?? raw.total), page, page_size: pageSize,
    totals: { page: object(totals.page) as Record<string, string>, all: object(totals.all) as Record<string, string> },
    input_rows: optionalNumber(raw.input_rows), exceptions_total: optionalNumber(raw.exceptions_total),
    ...(query.diff ? { diff_summary: { added: numeric(diff.added), removed: numeric(diff.removed) } } : {}),
  };
}

export function adaptRunEvent(value: unknown): RunEvent | null {
  const raw = object(value), type = string(raw.type), step_id = string(raw.step_id), at = string(raw.at);
  switch (type) {
    case 'step_started': return { type, step_id, at };
    case 'step_progress': return { type, step_id, done: numeric(raw.done), total: numeric(raw.total) };
    case 'step_finished': return { type, step_id, at, status: adaptStatus(raw.status), duration_ms: numeric(raw.duration_ms), metrics: adaptMetrics(raw.metrics), output_hash: optionalString(raw.output_hash), error: optionalString(raw.error) };
    case 'awaiting_approval': return { type, exceptions: numeric(raw.exceptions_total ?? raw.exceptions_open ?? raw.exceptions), blocking: numeric(raw.blocking_open ?? raw.blocking) };
    case 'run_finished': return { type, at, status: adaptStatus(raw.status) };
    default: return null;
  }
}

export function adaptAudit(value: unknown, run: Run): AuditTrail {
  const raw = object(value);
  const entries: AuditEntry[] = [
    ...run.files.map(file => ({ kind: 'input_file' as const, at: run.created_at, file })),
    { kind: 'pipeline', at: run.created_at, actor: run.created_by, pipeline: run.pipeline, code_version: run.code_version },
  ];
  for (const value of array(raw.records)) {
    const record = object(value), detail = object(record.details ?? record.detail), at = string(record.at), actor = string(record.actor);
    if (record.action === 'step_finished') {
      const step = run.steps.find(step => step.id === detail.step_id);
      if (step) entries.push({ kind: 'step', at, step });
    } else if (record.action === 'exception_decision') {
      const before = object(detail.before), after = object(detail.after), decision = adaptDecision(after.decision);
      if (decision) entries.push({
        ...registrationScope(object(after.decision)),
        kind: 'decision', at, actor, exception_id: string(after.id), title: string(after.tipo), action: decision.action,
        before: string(object(before.decision).acao, 'Aberta'), after: [decision.action === 'accept' ? decision.group_scope === 'merchant_period' ? 'Aceita como ressalva; sem faturamento' : 'Aceita' : decision.action === 'adjust' ? 'Ajustada' : decision.group_scope === 'merchant_period' ? 'Grupo excluído do lote' : 'Excluída', decision.amount, decision.account_code].filter(Boolean).join(' · '), note: decision.note,
      });
    } else if (record.action === 'approval_decision') {
      const approval = adaptApproval(detail.after);
      if (approval) entries.push({ kind: 'approval', at, approval });
    } else if (record.action === 'run_finished') {
      entries.push(...array(detail.exports).map(file => ({ kind: 'export' as const, at, file: adaptExport(file, run.id) })));
    } else if (record.action === 'audit_file_exported') {
      entries.push({ kind: 'export', at, file: adaptExport(detail, run.id) });
    }
  }
  for (const step of run.steps.filter(step => step.status === 'failed')) entries.push({ kind: 'step', at: step.finished_at || run.finished_at || run.created_at, step });
  return { run, entries: entries.sort((a, b) => a.at.localeCompare(b.at)) };
}
