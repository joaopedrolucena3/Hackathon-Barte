// Mock implementation of the agent contract. Reads real data from /api/state; agent-only state lives in
// localStorage; human decisions, recalculation, import and parameters go to the real backend.
import { ensureActor } from '../../../lib/actor';
import { downloadText, sha256 } from '../../../lib/storage';
import { core, downloads } from '../../core';
import { ApiError } from '../../http';
import type { AgentApi, InputFile, ParamValue, PipelineStep, PipelineVersion, PreviewPage } from '../contract';
import { buildAudit, compare } from './audit';
import { CATALOG, PIPELINE_ID, catalogByType, defaultSteps, stepTitle, validateSteps } from './catalog';
import { getChecklist, updateTask } from './checklist';
import { indexState, loadState, nextPeriod, refreshState } from './data';
import { buildInsights, emptyInsights } from './insights';
import { buildOutput, fenixEntries } from './outputs';
import { queryOutput } from './query';
import { activePendencias, approvalSummary, decide, decideMany, excludedRefs, listExceptions } from './review';
import { createRun, decideGate, fenixCsv, resumeInterrupted, subscribe } from './runner';
import { getStoredRun, latestPipeline, loadRuns, loadVersions, saveVersion } from './store';

let resumed = false;
function boot() {
  if (resumed) return;
  resumed = true;
  resumeInterrupted();
}

function requireRun(id: string) {
  boot();
  const run = getStoredRun(id);
  if (!run) throw new ApiError(`Run ${id} não encontrado neste navegador.`, 404);
  return run;
}

async function ensurePipeline(): Promise<PipelineVersion> {
  const latest = latestPipeline() as PipelineVersion | undefined;
  if (latest) return latest;
  const state = await loadState();
  const first: PipelineVersion = {
    id: PIPELINE_ID, name: PIPELINE_ID, version: 1, steps: defaultSteps(state.parameters.remittance_tolerance_pp),
    updated_at: new Date().toISOString(), author: 'Configuração inicial',
    changes: ['Versão inicial com os passos do motor de fechamento.'],
  };
  saveVersion(first);
  return first;
}

function paramOf(steps: PipelineStep[], type: string, key: string): ParamValue | undefined {
  return steps.find(step => step.type === type)?.params[key];
}

function describeChanges(before: PipelineStep[], after: PipelineStep[]) {
  const changes: string[] = [];
  const beforeTypes = new Set(before.map(step => step.type)), afterTypes = new Set(after.map(step => step.type));
  for (const step of after) if (!beforeTypes.has(step.type)) changes.push(`Passo adicionado: ${stepTitle(step.type)}.`);
  for (const step of before) if (!afterTypes.has(step.type)) changes.push(`Passo removido: ${stepTitle(step.type)}.`);
  const common = (list: PipelineStep[]) => list.filter(step => beforeTypes.has(step.type) && afterTypes.has(step.type)).map(step => step.type).join('>');
  if (common(before) !== common(after)) changes.push('Ordem dos passos alterada.');
  for (const step of after) {
    const old = before.find(item => item.type === step.type);
    if (!old) continue;
    const title = stepTitle(step.type);
    if (old.enabled !== step.enabled) changes.push(`${title}: ${step.enabled ? 'ligado' : 'desligado'}.`);
    for (const field of catalogByType.get(step.type)?.params_schema || []) {
      const a = old.params[field.key], b = step.params[field.key];
      if (String(a) !== String(b)) changes.push(`${title}: ${field.label.toLocaleLowerCase('pt-BR')} ${a}${field.unit ? ` ${field.unit}` : ''} → ${b}${field.unit ? ` ${field.unit}` : ''}.`);
    }
  }
  return changes;
}

async function preview(runId: string, stepId: string, query: Parameters<AgentApi['getPreview']>[2]): Promise<PreviewPage> {
  const run = requireRun(runId);
  const step = run.steps.find(item => item.id === stepId) || run.steps.find(item => item.type === stepId);
  const base: PreviewPage = {
    step_id: stepId, state: 'pending', schema: [], rows: [], total_rows: 0, page: 1, page_size: query.page_size,
    totals: { page: {}, all: {} },
  };
  if (!step) return { ...base, message: 'Este passo não faz parte deste run.' };
  if (step.kind === 'gate') return { ...base, state: 'not_tabular', gate: await approvalSummary(run) };
  if (!query.params_override) {
    if (step.status === 'pending') return { ...base, message: step.kind === 'export' ? 'A exportação roda depois da aprovação humana.' : 'Este passo ainda não rodou.' };
    if (step.status === 'skipped') return { ...base, message: 'Passo pulado: um passo anterior falhou ou o run foi reprovado.' };
    if (step.status === 'running') return { ...base, state: 'running', progress: step.metrics.progress };
    if (step.status === 'failed') return { ...base, state: 'failed', message: step.error };
  }
  const index = indexState(await loadState());
  const params = { ...step.params, ...(query.params_override || {}) };
  const effective = query.params_override ? { ...run, steps: run.steps.map(item => (item.id === step.id ? { ...item, params } : item)) } : run;
  const raised = activePendencias(index, effective).filter(p => index.stepOfPendencia.get(p.id_saida) === step.type);
  const output = buildOutput(step.type, index, params, raised, step.type === 'exportar_erp' ? await excludedRefs(run) : undefined);
  if (!output) return { ...base, state: 'not_tabular' };
  const result = queryOutput(output, query);
  return {
    ...base, ...result, state: 'ready', step_id: step.id, schema: output.schema, input_rows: output.input_rows,
    message: output.rows.length ? undefined : 'Nenhuma linha. Isso é esperado?',
  };
}

async function hashFile(file: File): Promise<InputFile> {
  const buffer = await file.arrayBuffer();
  const text = /\.(csv|ofx)$/i.test(file.name) ? new TextDecoder('latin1').decode(buffer) : '';
  return { name: file.name, size: file.size, sha256: await sha256(buffer), rows: text ? Math.max(text.split(/\r?\n/).filter(Boolean).length - 1, 0) : undefined };
}

export const mockAgent: AgentApi = {
  mode: 'mock',

  async listCompetencias() {
    boot();
    const state = await loadState();
    const comps = new Set([state.period, nextPeriod(state.period), ...loadRuns().map(run => run.comp)]);
    return [...comps].sort().reverse().map(comp => ({ comp, has_data: comp === state.period, current: comp === state.period }));
  },
  async getInsights(comp) {
    const state = await loadState();
    return comp === state.period ? buildInsights(indexState(state)) : emptyInsights(comp);
  },

  getChecklist: async comp => { boot(); return getChecklist(comp); },
  updateChecklistTask: async (id, patch) => { await ensureActor(); return updateTask(id, patch); },

  uploadFiles: files => Promise.all(files.map(hashFile)),
  async createRun(input) {
    boot();
    return createRun(input, await ensurePipeline());
  },
  async listRuns(comp) {
    boot();
    return loadRuns()
      .filter(run => !comp || run.comp === comp)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ id, comp: c, status, created_at, created_by, draft, pipeline }) => ({ id, comp: c, status, created_at, created_by, draft, pipeline }));
  },
  getRun: async id => structuredClone(requireRun(id)),
  subscribeRun: (id, onEvent) => { boot(); return subscribe(id, onEvent); },
  getPreview: preview,

  listExceptions: async runId => listExceptions(requireRun(runId)),
  getApprovalSummary: async runId => approvalSummary(requireRun(runId)),
  decide: async (runId, exceptionId, decision) => decide(requireRun(runId), exceptionId, decision),
  decideMany: async (runId, ids, decision, onProgress) => decideMany(requireRun(runId), ids, decision.note, onProgress),
  approve: (runId, comment) => decideGate(runId, 'approved', comment),
  reject: (runId, comment) => decideGate(runId, 'rejected', comment),
  getAudit: async runId => buildAudit(requireRun(runId)),
  async downloadExport(runId, name) {
    const run = requireRun(runId);
    if (name === 'lancamentos_fenix.csv') {
      const index = indexState(await loadState());
      downloadText(name, fenixCsv(fenixEntries(index, await excludedRefs(run))), 'text/csv;charset=utf-8');
    } else if (name === 'auditoria.json') {
      downloadText(name, JSON.stringify(await buildAudit(run), null, 2), 'application/json');
    } else {
      window.location.assign(downloads.csv('pendencias.csv'));
    }
  },
  compareRuns: async (a, b) => compare(requireRun(a), requireRun(b)),

  getCatalog: async () => CATALOG,
  async getPipeline(version) {
    const latest = await ensurePipeline();
    if (!version || version === latest.version) return latest;
    const found = loadVersions().find(item => item.version === version);
    if (!found) throw new ApiError(`Versão v${version} não encontrada.`, 404);
    return found;
  },
  async listPipelineVersions() {
    await ensurePipeline();
    return [...loadVersions()].reverse();
  },
  validatePipeline: async steps => validateSteps(steps),
  async savePipeline(steps) {
    const actor = await ensureActor();
    const validation = validateSteps(steps);
    if (!validation.ok) throw new ApiError('Corrija os erros do pipeline antes de salvar.', 400, { issues: validation.issues });
    const previous = await ensurePipeline();
    const changes = describeChanges(previous.steps, steps);
    if (!changes.length) throw new ApiError(`Nada mudou desde a v${previous.version}.`, 400);
    const before = paramOf(previous.steps, 'spread_remessa', 'tolerancia_pp');
    const after = paramOf(steps, 'spread_remessa', 'tolerancia_pp');
    if (after !== undefined && String(after) !== String(before)) {
      // This parameter already exists in the engine: keep it in sync so the next run uses it.
      const state = await loadState();
      await core.saveParameters({
        remittance_tolerance_pp: String(after), closing_deadline: state.parameters.closing_deadline || '',
        reason: `Pipeline v${previous.version + 1}: tolerância de spread alterada no construtor.`,
      });
      await refreshState();
    }
    const next: PipelineVersion = {
      ...previous, version: previous.version + 1, steps: structuredClone(steps), updated_at: new Date().toISOString(), author: actor, changes,
    };
    saveVersion(next);
    return next;
  },
};
