// Real backend adapter. Enable with VITE_AGENT_API=http once the endpoints in front/API_PENDENTE.md exist.
import { ensureActor } from '../../lib/actor';
import { ApiError, getJSON, sendJSON } from '../http';
import type { AgentApi, InputFile, PreviewQuery, RunEvent } from './contract';

const PIPELINE = 'fechamento-tarvo';
const enc = encodeURIComponent;

function previewParams(query: PreviewQuery) {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.page_size) });
  if (query.sort) { params.set('sort', query.sort.key); params.set('dir', query.sort.dir); }
  if (query.filters?.length) params.set('filters', JSON.stringify(query.filters));
  if (query.only_exceptions) params.set('only_exceptions', 'true');
  if (query.diff) params.set('diff', 'true');
  if (query.params_override) params.set('params', JSON.stringify(query.params_override));
  return params.toString();
}

export const httpAgent: AgentApi = {
  mode: 'http',
  listCompetencias: () => getJSON('/api/competencias'),
  getInsights: comp => getJSON(`/api/insights?comp=${enc(comp)}`),

  getChecklist: comp => getJSON(`/api/competencias/${enc(comp)}/checklist`),
  updateChecklistTask: (id, patch) => sendJSON(`/api/checklist/${enc(id)}`, patch, 'PATCH'),

  async uploadFiles(files) {
    const actor = await ensureActor();
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    form.append('actor', actor);
    const response = await fetch('/api/files', { method: 'POST', body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(body.error || 'Falha no envio dos arquivos.', response.status, body);
    return body.files as InputFile[];
  },
  createRun: input => sendJSON('/api/runs', input),
  listRuns: comp => getJSON(`/api/runs${comp ? `?comp=${enc(comp)}` : ''}`),
  getRun: id => getJSON(`/api/runs/${enc(id)}`),

  subscribeRun(id, onEvent, onReconnect) {
    let source: EventSource | null = null, closed = false, dropped = false, retry = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const types: RunEvent['type'][] = ['step_started', 'step_progress', 'step_finished', 'awaiting_approval', 'run_finished'];
    const connect = () => {
      source = new EventSource(`/api/runs/${enc(id)}/events`);
      source.onopen = () => {
        retry = 1000;
        // The stream may have missed events while down: the consolidated run is the source of truth.
        if (dropped) { dropped = false; onReconnect?.(); }
      };
      for (const type of types) {
        source.addEventListener(type, message => onEvent({ type, ...JSON.parse((message as MessageEvent).data) } as RunEvent));
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
  getPreview: (runId, stepId, query) => getJSON(`/api/runs/${enc(runId)}/steps/${enc(stepId)}/preview?${previewParams(query)}`),

  listExceptions: runId => getJSON(`/api/runs/${enc(runId)}/exceptions`),
  getApprovalSummary: runId => getJSON(`/api/runs/${enc(runId)}/approval-summary`),
  decide: (runId, exceptionId, decision) => sendJSON(`/api/runs/${enc(runId)}/exceptions/${enc(exceptionId)}/decision`, decision),
  approve: (runId, comment) => sendJSON(`/api/runs/${enc(runId)}/approval`, { decision: 'approve', comment }),
  reject: (runId, comment) => sendJSON(`/api/runs/${enc(runId)}/approval`, { decision: 'reject', comment }),
  getAudit: runId => getJSON(`/api/runs/${enc(runId)}/audit`),
  downloadExport: async (runId, name) => { window.location.assign(`/api/runs/${enc(runId)}/exports/${enc(name)}`); },
  compareRuns: (a, b) => getJSON(`/api/runs/compare?a=${enc(a)}&b=${enc(b)}`),

  getCatalog: () => getJSON('/api/steps/catalog'),
  getPipeline: version => getJSON(`/api/pipelines/${PIPELINE}${version ? `?version=${version}` : ''}`),
  listPipelineVersions: () => getJSON(`/api/pipelines/${PIPELINE}/versions`),
  validatePipeline: steps => sendJSON(`/api/pipelines/${PIPELINE}/validate`, { steps }),
  savePipeline: steps => sendJSON(`/api/pipelines/${PIPELINE}`, { steps }, 'PUT'),
};
