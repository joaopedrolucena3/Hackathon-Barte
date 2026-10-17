import { actorHeaders, ApiError, getJSON, parseResponse, sendAuthorizedJSON } from '../http';
import {
  adaptAudit, adaptCatalog, adaptChecklist, adaptException, adaptFile, adaptPipeline, adaptPreview,
  adaptRun, adaptRunEvent, adaptValidation, array, object, type RecordData,
} from './adapters';
import { downloadBlob } from '../../lib/storage';
import type { AgentApi, PipelineStep, PreviewPage, PreviewQuery, ReviewDecision, ReviewException, Run, RunComparison, StepTable } from './contract';

const PIPELINE = 'fechamento-tarvo';
const enc = encodeURIComponent;
const runPath = (id: string) => `/api/runs/${enc(id)}`;
const workflowSteps = (steps: PipelineStep[]) => steps.filter(step => step.enabled).map(({ id, type, params }) => ({ id, type, params }));
const errorCode = (error: unknown) => error instanceof ApiError ? object(error.data?.error).code : undefined;

export function previewParams(query: PreviewQuery) {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.page_size) });
  if (query.dataset) params.set('dataset', query.dataset);
  if (query.sort) { params.set('sort_by', query.sort.key); params.set('sort_dir', query.sort.dir); }
  if (query.filters?.length) params.set('filters', JSON.stringify(query.filters.map(({ key, op, value }) => ({ column: key, op, value }))));
  if (query.only_exceptions) params.set('only_exceptions', 'true');
  if (query.diff) params.set('diff', 'true');
  if (query.params_override) params.set('params_override', JSON.stringify(query.params_override));
  return params.toString();
}

async function getRun(id: string): Promise<Run> { return adaptRun(await getJSON(runPath(id))); }

async function rawExceptions(runId: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let page = 1;
  while (true) {
    const response = await getJSON<RecordData>(`${runPath(runId)}/exceptions?page=${page}&page_size=500`);
    const batch = array(response.exceptions ?? response.items);
    items.push(...batch);
    if (!batch.length || items.length >= Number(response.total ?? items.length)) return items;
    page++;
  }
}
async function exceptionsFor(run: Run): Promise<ReviewException[]> {
  return (await rawExceptions(run.id)).map(value => adaptException(value, run));
}

function pendingPreview(run: Run, stepId: string, query: PreviewQuery): PreviewPage {
  const step = run.steps.find(step => step.id === stepId);
  return {
    step_id: stepId, state: step?.status === 'running' ? 'running' : step?.status === 'failed' ? 'failed' : step?.kind === 'gate' ? 'not_tabular' : 'pending',
    schema: [], rows: [], total_rows: 0, page: query.page, page_size: query.page_size, totals: { page: {}, all: {} },
    progress: step?.metrics.progress, message: step?.error || (step?.status === 'skipped' ? 'Etapa não executada neste run.' : step?.kind === 'gate' ? 'Consulte a aba Revisão para analisar e aprovar o lote.' : undefined),
  };
}

async function sendDecision(runId: string, exceptionId: string, decision: Pick<ReviewDecision, 'action' | 'note' | 'account_code' | 'amount' | 'entry_id'>) {
  return sendAuthorizedJSON(`${runPath(runId)}/exceptions/${enc(exceptionId)}/decision`, {
    acao: { accept: 'aceitar', adjust: 'ajustar', exclude: 'excluir' }[decision.action], justificativa: decision.note,
    ...(decision.entry_id ? { entry_id: decision.entry_id } : {}),
    ...(decision.amount !== undefined ? { valor: decision.amount } : {}), ...(decision.account_code ? { conta: decision.account_code } : {}),
  });
}

export const httpAgent: AgentApi = {
  mode: 'http',
  listCompetencias: () => getJSON('/api/competencias'),
  getInsights: comp => getJSON(`/api/insights?comp=${enc(comp)}`),

  async getChecklist(comp) {
    const data = await getJSON<RecordData>(`/api/competencias/${enc(comp)}/checklist`);
    return array(data.tasks).map(adaptChecklist);
  },
  async updateChecklistTask(id, patch) {
    const status = patch.status === undefined ? undefined : ({ pending: 'pendente', running: 'em_andamento', done: 'concluida' } as Record<string, string>)[patch.status];
    if (patch.status !== undefined && !status) throw new Error('A tarefa manual pode estar pendente, em andamento ou concluída.');
    return adaptChecklist(await sendAuthorizedJSON(`/api/checklist/${enc(id)}`, {
      ...(status ? { status } : {}), ...(patch.owner !== undefined ? { responsavel: patch.owner } : {}), ...(patch.comment !== undefined ? { comentario: patch.comment } : {}),
    }, 'PATCH'));
  },

  async uploadFiles(files) {
    const headers = await actorHeaders(), uploaded = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      uploaded.push(adaptFile(await parseResponse(await fetch('/api/files', { method: 'POST', headers, body: form }))));
    }
    return uploaded;
  },
  async createRun(input) {
    if (input.source === 'upload' && (input.files?.length !== 6 || input.files.some(file => !file.id))) {
      throw new Error('Envie os seis arquivos ao servidor antes de iniciar a execução.');
    }
    const started = await sendAuthorizedJSON<RecordData>('/api/runs', {
      pipeline_id: PIPELINE, competencia: input.comp, draft: input.draft === true,
      ...(input.source === 'upload' ? { file_ids: input.files!.map(file => file.id) } : {}),
      ...(input.source === 'folder' ? { source_dir: input.folder } : {}),
      ...(input.steps ? { steps: workflowSteps(input.steps) } : {}),
    });
    return getRun(String(started.run_id ?? started.id));
  },
  async listRuns(comp) {
    const response = await getJSON<RecordData>(`/api/runs${comp ? `?competencia=${enc(comp)}` : ''}`);
    return array(response.runs).map(adaptRun);
  },
  getRun,
  async getRunAccounts(id) {
    const response = await getJSON<RecordData>(`${runPath(id)}/accounts`);
    return array(response.accounts).map(value => { const account = object(value); return { code: String(account.code), name: String(account.name), postable: account.postable === true }; });
  },

  subscribeRun(id, onEvent, onReconnect) {
    let source: EventSource | null = null, closed = false, dropped = false, retry = 1000, cursor = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const types = ['step_started', 'step_progress', 'step_finished', 'awaiting_approval', 'run_finished', 'run_started', 'export_started', 'exception_decided', 'approval_decided'];
    const connect = () => {
      if (closed) return;
      source = new EventSource(`${runPath(id)}/events?after=${cursor}`);
      source.onopen = () => {
        retry = 1000;
        if (dropped) { dropped = false; onReconnect?.(); }
      };
      for (const type of types) {
        source.addEventListener(type, message => {
          try {
            const raw = object(JSON.parse((message as MessageEvent).data));
            const sequence = Number((message as MessageEvent).lastEventId || raw.seq || raw.sequence || raw.id || 0);
            if (sequence && sequence <= cursor) return;
            cursor = Math.max(cursor, sequence);
            const event = adaptRunEvent({ ...raw, type });
            if (event) onEvent(event);
            else onReconnect?.();
            if (event?.type === 'run_finished') {
              closed = true;
              clearTimeout(timer);
              source?.close();
            }
          } catch {
            // Reload the consolidated state if an event cannot be decoded.
            onReconnect?.();
          }
        });
      }
      source.onerror = () => {
        source?.close();
        if (closed) return;
        dropped = true;
        timer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); source?.close(); };
  },
  async getPreview(runId, stepId, query) {
    const run = await getRun(runId);
    const step = run.steps.find(step => step.id === stepId) || run.steps.find(step => step.type === stepId);
    if (!step) throw new Error('Este passo não fazia parte da execução selecionada. Use Testar para executar o pipeline alterado.');
    if (step.kind === 'gate' || ['pending', 'running', 'failed', 'skipped'].includes(step.status)) return pendingPreview(run, step.id, query);
    const effective = { ...query };
    // Identical parameters show recorded data; changed parameters require an independent draft.
    if (query.params_override && Object.entries(query.params_override).every(([key, value]) => step.params[key] === value)) delete effective.params_override;
    try {
      const response = await getJSON<RecordData>(`${runPath(runId)}/steps/${enc(step.id)}/preview?${previewParams(effective)}`);
      const hasExceptions = array(response.rows).some(value => array(object(value).__exception_ids).length);
      return adaptPreview(response, query, hasExceptions ? await exceptionsFor(run) : []);
    } catch (error) {
      if (errorCode(error) === 'DATASET_NOT_READY') return pendingPreview(run, step.id, query);
      throw error;
    }
  },

  async listExceptions(runId) { return exceptionsFor(await getRun(runId)); },
  getApprovalSummary: runId => getJSON(`${runPath(runId)}/approval-summary`),
  async decide(runId, exceptionId, decision) {
    const response = await sendDecision(runId, exceptionId, decision);
    return adaptException(response, await getRun(runId));
  },
  async decideMany(runId, ids, decision, onProgress) {
    if (!decision.note.trim()) throw new Error('Registre a justificativa para aceitar os alertas selecionados.');
    const result = await sendAuthorizedJSON<{ decided: number }>(`${runPath(runId)}/exceptions/decisions`, {
      ids: [...new Set(ids)], acao: 'aceitar', justificativa: decision.note,
    });
    onProgress?.(result.decided);
    return result;
  },
  async approve(runId, comment) { return adaptRun(await sendAuthorizedJSON(`${runPath(runId)}/approval`, { decisao: 'aprovar', comentario: comment })); },
  async reject(runId, comment) { return adaptRun(await sendAuthorizedJSON(`${runPath(runId)}/approval`, { decisao: 'reprovar', comentario: comment })); },
  async getAudit(runId) {
    const [audit, run] = await Promise.all([getJSON(`${runPath(runId)}/audit`), getRun(runId)]);
    return adaptAudit(audit, run);
  },
  async downloadExport(runId, name) {
    const response = await fetch(`${runPath(runId)}/exports/${enc(name)}`, { cache: 'no-store' });
    if (!response.ok) { await parseResponse(response); return; }
    downloadBlob(name, await response.blob());
  },
  getStepTable: (runId, stepId, dataset) =>
    getJSON<StepTable>(`${runPath(runId)}/steps/${enc(stepId)}/data${dataset ? `?dataset=${enc(dataset)}` : ''}`),
  async exportView(runId, stepId, input) {
    const response = await fetch(`${runPath(runId)}/steps/${enc(stepId)}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) { await parseResponse(response); return; }
    const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || `${input.dataset}.${input.formato}`;
    downloadBlob(name, await response.blob());
  },
  async compareRuns(a, b) {
    const response = await getJSON<RecordData>(`/api/runs/compare?a=${enc(a)}&b=${enc(b)}`);
    return { a: adaptRun(response.a), b: adaptRun(response.b), steps: array(response.steps) as RunComparison['steps'], reproducible: response.reproducible === true };
  },

  async getCatalog() { return adaptCatalog(array((await getJSON<RecordData>('/api/steps/catalog')).steps)); },
  async getPipeline(version) { return adaptPipeline(await getJSON(`/api/pipelines/${PIPELINE}${version ? `?version=${version}` : ''}`)); },
  async listPipelineVersions() {
    const response = await getJSON<RecordData>(`/api/pipelines/${PIPELINE}/versions`);
    return Promise.all(array(response.versions).map(async value => {
      const version = object(value), pipeline = await httpAgent.getPipeline(Number(version.version));
      return { ...pipeline, changes: [Number(version.version) === 1 ? 'Definição inicial do pipeline.' : 'Nova versão registrada pelo responsável.'] };
    }));
  },
  async validatePipeline(steps) {
    try {
      const result = await parseResponse<RecordData>(await fetch(`/api/pipelines/${PIPELINE}/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: PIPELINE, version: 1, steps: workflowSteps(steps) }),
      }));
      return { ok: result.valid === true, issues: adaptValidation(result.errors) };
    } catch (error) {
      if (error instanceof ApiError && ['PIPELINE_INVALID', 'INVALID_PIPELINE'].includes(String(errorCode(error)))) {
        return { ok: false, issues: adaptValidation(object(error.data?.error).details) };
      }
      throw error;
    }
  },
  async savePipeline(steps) {
    const current = await httpAgent.getPipeline();
    return adaptPipeline(await sendAuthorizedJSON(`/api/pipelines/${PIPELINE}`, { id: PIPELINE, version: current.version, title: current.name, steps: workflowSteps(steps) }, 'PUT'));
  },
};
