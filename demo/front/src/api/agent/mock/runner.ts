// Mock run executor (B3/B4): walks the pipeline step by step and publishes SSE-like events.
import { ensureActor } from '../../../lib/actor';
import { periodShort } from '../../../lib/format';
import { CODE_VERSION } from '../../../lib/queryClient';
import { sha256 } from '../../../lib/storage';
import { applyRunEvent, FINISHED } from '../../../state/runEvents';
import { core } from '../../core';
import { ApiError } from '../../http';
import type { CreateRunInput, ExportFile, Pipeline, Run, RunEvent, StepRun } from '../contract';
import { catalogByType, stepTitle } from './catalog';
import { expectedFiles, indexState, loadState, refreshState } from './data';
import { buildOutput, canonicalRows, fenixEntries } from './outputs';
import { activePendencias, approvalSummary, excludedRefs, listExceptions } from './review';
import { getStoredRun, loadRuns, nextRunId, saveRun, updateRun } from './store';

const STEP_MS: Record<string, number> = {
  ler_arquivos: 1100, normalizar_orbe: 1700, conferir_mdr: 1600, estornos: 800, comissao_checkout: 1100,
  duplicidade: 600, spread_remessa: 1200, classificar_bancos: 1200, propor_notas: 700, exportar_erp: 900,
};
const TICKS = 6;
const listeners = new Map<string, Set<(event: RunEvent) => void>>();
const active = new Set<string>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

export function subscribe(id: string, listener: (event: RunEvent) => void) {
  const set = listeners.get(id) || new Set();
  set.add(listener);
  listeners.set(id, set);
  return () => { set.delete(listener); };
}

function emit(id: string, event: RunEvent) {
  updateRun(id, run => applyRunEvent(run, event));
  listeners.get(id)?.forEach(listener => listener(event));
}

export async function createRun(input: CreateRunInput, pipeline: Pipeline): Promise<Run> {
  const actor = await ensureActor();
  const busy = loadRuns().find(run => run.comp === input.comp && (run.status === 'running' || run.status === 'pending'));
  if (busy) throw new ApiError(`Já existe um run em andamento para ${periodShort(input.comp)}.`, 409, { run_id: busy.id });
  const source = input.draft && input.steps ? input.steps : pipeline.steps;
  const steps: StepRun[] = source.filter(step => step.enabled).map(step => ({
    id: step.id, type: step.type, title: stepTitle(step.type), kind: catalogByType.get(step.type)?.kind || 'calc',
    status: 'pending', metrics: {}, params: step.params, code_version: CODE_VERSION,
  }));
  const run: Run = {
    id: nextRunId(), comp: input.comp, status: 'pending', created_at: now(), created_by: actor, draft: input.draft || undefined,
    pipeline: { id: pipeline.id, name: pipeline.name, version: pipeline.version }, code_version: CODE_VERSION,
    source: input.source, folder: input.folder, files: input.files || [], steps,
  };
  saveRun(run);
  void execute(run.id);
  return run;
}

/** Restarts runs interrupted by a page reload: the stored run is the consolidated state. */
export function resumeInterrupted() {
  for (const run of loadRuns()) {
    if (run.status !== 'running' && run.status !== 'pending') continue;
    updateRun(run.id, r => ({ ...r, steps: r.steps.map(step => (step.status === 'running' ? { ...step, status: 'pending' } : step)) }));
    void execute(run.id);
  }
}

async function readFiles(run: Run): Promise<string | null> {
  const state = await loadState();
  const expected = expectedFiles(run.comp);
  if (run.source === 'upload') {
    const missing = expected.filter(file => !run.files.some(item => item.name.startsWith(file.prefix)));
    if (missing.length) return `Arquivos esperados que não vieram: ${missing.map(file => file.name).join(', ')}.`;
  } else if (run.source === 'pack' && run.comp !== state.period) {
    const missing = expected.filter(file => file.monthly).map(file => file.name);
    return `Data pack de ${periodShort(run.comp)} não encontrado. Faltam: ${missing.join(', ')}.`;
  }
  try {
    if (run.source === 'folder') await core.importDir(run.folder || '', run.comp);
    else await core.recalculate(run.comp);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const fresh = await refreshState();
  if (run.source !== 'upload') {
    updateRun(run.id, r => ({ ...r, files: fresh.sources.map(source => ({ name: source.name, sha256: source.sha256, rows: source.rows })) }));
  }
  return null;
}

async function runStep(runId: string, step: StepRun) {
  const started = Date.now();
  emit(runId, { type: 'step_started', step_id: step.id, at: now() });
  const fail = (error: string) => {
    emit(runId, { type: 'step_finished', step_id: step.id, status: 'failed', at: now(), duration_ms: Date.now() - started, metrics: {}, error });
    emit(runId, { type: 'run_finished', status: 'failed', at: now() });
  };
  if (step.type === 'ler_arquivos') {
    const error = await readFiles(getStoredRun(runId)!);
    if (error) { fail(error); return false; }
  }
  const run = getStoredRun(runId)!;
  const index = indexState(await loadState());
  const raised = activePendencias(index, run).filter(p => index.stepOfPendencia.get(p.id_saida) === step.type);
  const excluded = step.type === 'exportar_erp' ? await excludedRefs(run) : new Set<string>();
  const output = buildOutput(step.type, index, step.params, raised, excluded);
  const total = output?.input_rows || 1;
  for (let tick = 1; tick <= TICKS; tick++) {
    await sleep((STEP_MS[step.type] || 800) / TICKS);
    emit(runId, { type: 'step_progress', step_id: step.id, done: Math.round((total * tick) / TICKS), total });
  }
  const hash = output ? await sha256(canonicalRows(output.rows)) : undefined;
  emit(runId, {
    type: 'step_finished', step_id: step.id, status: raised.length ? 'exceptions' : 'done', at: now(),
    duration_ms: Date.now() - started, output_hash: hash,
    metrics: {
      rows_in: output?.input_rows, rows_out: output?.rows.length, exceptions: raised.length,
      blocking: raised.filter(p => p.severity === 'bloqueante').length, extra: output?.extra,
    },
  });
  if (step.type === 'exportar_erp') await recordExports(runId, index, excluded);
  return true;
}

async function recordExports(runId: string, index: ReturnType<typeof indexState>, excluded: Set<string>) {
  const run = getStoredRun(runId)!;
  const entries = fenixEntries(index, excluded);
  const exceptions = await listExceptions(run);
  const files: ExportFile[] = [
    { name: 'lancamentos_fenix.csv', rows: entries.length, sha256: await sha256(fenixCsv(entries)) },
    { name: 'relatorio_excecoes.csv', rows: exceptions.length, sha256: await sha256(JSON.stringify(exceptions)), href: '/api/export?file=pendencias.csv' },
    { name: 'auditoria.json', rows: run.steps.length + exceptions.length, sha256: await sha256(JSON.stringify(run)) },
  ];
  updateRun(runId, r => ({ ...r, exports: files }));
}

export function fenixCsv(entries: ReturnType<typeof fenixEntries>) {
  const header = 'data;historico;conta_debito;conta_credito;valor;origem';
  const lines = entries.map(entry => [entry.data, entry.historico.replaceAll(';', ','), entry.conta_debito, entry.conta_credito, entry.valor, entry.origem].join(';'));
  return [header, ...lines].join('\n') + '\n';
}

export async function execute(runId: string) {
  if (active.has(runId)) return;
  active.add(runId);
  try {
    for (;;) {
      const run = getStoredRun(runId);
      if (!run || run.status === 'failed' || run.status === 'rejected') return;
      const step = run.steps.find(item => !FINISHED.includes(item.status));
      if (!step) {
        if (!FINISHED.includes(run.status)) {
          emit(runId, { type: 'run_finished', status: run.approval?.status === 'approved' ? 'approved' : 'done', at: now() });
        }
        return;
      }
      if (step.kind === 'gate') {
        if (step.status === 'awaiting_approval') return;
        emit(runId, { type: 'step_started', step_id: step.id, at: now() });
        const summary = await approvalSummary(getStoredRun(runId)!);
        emit(runId, { type: 'awaiting_approval', exceptions: summary.total, blocking: summary.open_blocking });
        return;
      }
      if (step.kind === 'export' && run.approval?.status !== 'approved') return;
      if (!(await runStep(runId, step))) return;
    }
  } catch (error) {
    console.error('[mock runner]', error);
    const run = getStoredRun(runId);
    const step = run?.steps.find(item => item.status === 'running');
    if (step) {
      emit(runId, { type: 'step_finished', step_id: step.id, status: 'failed', at: now(), duration_ms: 0, metrics: {}, error: error instanceof Error ? error.message : String(error) });
      emit(runId, { type: 'run_finished', status: 'failed', at: now() });
    }
  } finally {
    active.delete(runId);
  }
}

export async function decideGate(runId: string, decision: 'approved' | 'rejected', comment: string): Promise<Run> {
  const actor = await ensureActor();
  const run = getStoredRun(runId);
  if (!run) throw new ApiError('Run não encontrado.', 404);
  if (run.status !== 'awaiting_approval') throw new ApiError('Este run não está aguardando aprovação.', 409);
  if (!comment.trim() && decision === 'rejected') throw new ApiError('Informe o motivo da reprovação.', 400);
  if (decision === 'approved') {
    if (run.draft) throw new ApiError('Run de teste: vai só até a aprovação e não exporta.', 409);
    const summary = await approvalSummary(run);
    if (summary.open_blocking) throw new ApiError(`Ainda há ${summary.open_blocking} exceções bloqueantes sem decisão.`, 409);
  }
  const gate = run.steps.find(step => step.kind === 'gate')!;
  updateRun(runId, r => ({ ...r, approval: { status: decision, actor, at: now(), comment: comment.trim() } }));
  emit(runId, {
    type: 'step_finished', step_id: gate.id, status: decision, at: now(),
    duration_ms: Date.now() - new Date(gate.started_at || Date.now()).getTime(), metrics: gate.metrics,
  });
  if (decision === 'rejected') {
    for (const step of getStoredRun(runId)!.steps.filter(item => !FINISHED.includes(item.status))) {
      emit(runId, { type: 'step_finished', step_id: step.id, status: 'skipped', at: now(), duration_ms: 0, metrics: {} });
    }
    emit(runId, { type: 'run_finished', status: 'rejected', at: now() });
  } else {
    void execute(runId);
  }
  return getStoredRun(runId)!;
}
