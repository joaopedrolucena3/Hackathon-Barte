import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActor } from '../../lib/actor';
import { ApiError } from '../http';
import { adaptAudit, adaptCatalog, adaptChecklist, adaptPreview, adaptRun, adaptRunEvent } from './adapters';
import { httpAgent, previewParams } from './http';
import type { PipelineStep, RunEvent } from './contract';

const snapshot = {
  id: 'run-1', competencia: '2026-09', status: 'awaiting_approval', draft: false,
  created_at: '2026-10-17T10:00:00Z', created_by: 'João 李', pipeline_id: 'fechamento-tarvo', pipeline_version: 2,
  source: 'upload', exports: [], approval: null,
  snapshot: {
    definition: { id: 'fechamento-tarvo', version: 2, title: 'Fechamento mensal Tarvo' },
    code: { content_hash: 'code-sha' }, step_versions: { conferir_mdr: '1.0+code-sha' },
    sources: [{ file_id: 'file-1', name: '01_orbe.csv', sha256: 'source-sha', rows_read: 2, rows_discarded: 1 }],
  },
  steps: [
    { id: 's4', type: 'conferir_mdr', status: 'done_with_exceptions', params: { tolerancia_pp: 0 }, metrics: { rows_in: 2, rows_out: 2, exceptions: 1 }, output_hash: 'output-sha' },
    { id: 's9', type: 'aprovacao', status: 'running', params: {}, metrics: {} },
    { id: 's10', type: 'exportar_erp', status: 'pending', params: {}, metrics: {} },
  ],
};
const exception = {
  id: 'exception-1', step_id: 's4', tipo: 'DIVERGENCIA_TAXA', severidade: 'alerta',
  descricao: 'Taxa diferente da contratada', impacto_rs: '90071992547409.91', ref_origem: 'ORBE-1',
  origens: [{ arquivo: '01_orbe.csv', linha: 42, ref: 'ORBE-1' }], decision: null,
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const steps: PipelineStep[] = [{ id: 's4', type: 'conferir_mdr', enabled: true, params: { tolerancia_pp: 0 } }];

beforeEach(() => { setActor('João 李'); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('persisted workflow adapters', () => {
  it('preserves immutable sources, decimal values and workflow state', () => {
    const run = adaptRun(snapshot);
    expect(run).toMatchObject({ id: 'run-1', comp: '2026-09', created_by: 'João 李', source: 'upload', pipeline: { version: 2 }, code_version: 'code-sha' });
    expect(run.files[0]).toMatchObject({ id: 'file-1', rows: 2, discarded: 1 });
    expect(run.steps.map(step => step.status)).toEqual(['exceptions', 'awaiting_approval', 'pending']);
    expect(run.steps[0].output_hash).toBe('output-sha');
    const approved = adaptRun({ ...snapshot, status: 'done', approval: { decisao: 'aprovar', actor: 'João 李', at: 'now', comentario: 'Conferido' } });
    expect(approved.status).toBe('approved');
    expect(approved.steps[1].status).toBe('approved');
    expect(adaptRun({ ...snapshot, status: 'approved' }).status).toBe('running');
    expect(adaptRun({ ...snapshot, status: 'done', draft: true }).status).toBe('done');
  });

  it('uses native catalog dependencies and marks immutable financial parameters read-only', () => {
    const catalog = adaptCatalog([
      { type: 'ler_arquivos', title: 'Ler', inputs: [], outputs: ['raw_orbe'], params_schema: { properties: {} } },
      { type: 'conferir_mdr', title: 'Conferir', inputs: ['raw_orbe'], outputs: ['mdr'], params_schema: { properties: { tolerancia_pp: { type: 'number', const: 0, default: 0 }, fallback: { type: 'string', enum: ['cnpj', 'nenhum'], default: 'cnpj' } } } },
      { type: 'aprovacao', title: 'Aprovar', inputs: ['mdr'], outputs: [], params_schema: { properties: {} } },
    ]);
    expect(catalog[1].requires).toEqual(['ler_arquivos']);
    expect(catalog[1].params_schema[0]).toMatchObject({ readonly: true, default: 0, type: 'number' });
    expect(catalog[1].params_schema[1]).toMatchObject({ type: 'select', options: [{ value: 'cnpj' }, { value: 'nenhum' }] });
    expect(catalog[2]).toMatchObject({ locked: true, kind: 'gate' });
  });

  it('maps preview schema without losing precision or inventing totals', () => {
    const page = adaptPreview({ step_id: 's4', total: 10, page: 2, page_size: 1,
      schema: [{ name: 'amount', type: 'money', is_new: true }, { name: 'diferenca_pp', type: 'percent' }, { name: '__exception_ids', type: 'text' }],
      rows: [{ id: 'A', amount: '90071992547409.91', diferenca_pp: '0.002', evidence: [{ ref: 'A' }] }],
      totals: { page: { amount: '90071992547409.91' }, all: { amount: '900719925474099.10' } },
    }, { page: 2, page_size: 1 });
    expect(page.schema.map(column => column.type)).toEqual(['money', 'pp']);
    expect(page.rows[0]).toMatchObject({ amount: '90071992547409.91', evidence: '[{"ref":"A"}]' });
    expect(page.totals.all.amount).toBe('900719925474099.10');
    expect(page.total_rows).toBe(10);
  });

  it('maps checklist vocabulary and audit records with the original analyst', () => {
    expect(adaptChecklist({ id: '2026-09:manual', competencia: '2026-09', area: 'Comercial', title: 'Revisar', manual: true, status: 'em_andamento', responsavel: 'João 李', comentario: 'Aguardando' })).toMatchObject({ kind: 'manual', status: 'running', owner: 'João 李', comment: 'Aguardando' });
    const trail = adaptAudit({ records: [{ action: 'exception_decision', at: '2026-10-17T12:00:00Z', actor: 'João 李', details: {
      before: exception, after: { ...exception, decision: { acao: 'ajustar', valor: '1.01', justificativa: 'Fonte conferida', actor: 'João 李', at: '2026-10-17T12:00:00Z' } },
    } }] }, adaptRun(snapshot));
    expect(trail.entries.find(entry => entry.kind === 'decision')).toMatchObject({ actor: 'João 李', action: 'adjust', note: 'Fonte conferida', after: 'Ajustada · 1.01' });
  });

  it('normalizes native SSE statuses and gate counts', () => {
    expect(adaptRunEvent({ type: 'step_finished', step_id: 's4', status: 'done_with_exceptions', metrics: { exceptions: 2 }, at: 'now', duration_ms: 5 })).toMatchObject({ type: 'step_finished', status: 'exceptions', metrics: { exceptions: 2 } });
    expect(adaptRunEvent({ type: 'awaiting_approval', exceptions_total: 18, blocking_open: 2 })).toEqual({ type: 'awaiting_approval', exceptions: 18, blocking: 2 });
  });
});

describe('real HTTP contract', () => {
  it('encodes Unicode attribution in headers and sends native strict request fields', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ run_id: 'run-1' }, 202)).mockResolvedValueOnce(response(snapshot));
    vi.stubGlobal('fetch', fetcher);
    const run = await httpAgent.createRun({ comp: '2026-09', source: 'folder', folder: '/dados/setembro', draft: true, steps });
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe('/api/runs');
    expect(options.headers).toMatchObject({ 'X-User': encodeURIComponent('João 李'), 'X-User-Encoding': 'percent-utf8' });
    expect(JSON.parse(options.body)).toEqual({ pipeline_id: 'fechamento-tarvo', competencia: '2026-09', source_dir: '/dados/setembro', draft: true, steps: [{ id: 's4', type: 'conferir_mdr', params: { tolerancia_pp: 0 } }] });
    expect(run.id).toBe('run-1');
  });

  it('loads accounting choices from the run snapshot instead of the mutable closing state', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ accounts: [{ code: '1.1.01', name: 'Conta do arquivo enviado', postable: true }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(httpAgent.getRunAccounts('run-1')).resolves.toEqual([{ code: '1.1.01', name: 'Conta do arquivo enviado', postable: true }]);
    expect(fetcher.mock.calls[0][0]).toBe('/api/runs/run-1/accounts');
  });

  it('requires server file identifiers instead of treating a local checksum as an upload', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(httpAgent.createRun({ comp: '2026-09', source: 'upload', files: [{ name: 'a.csv', sha256: 'hash' }] })).rejects.toThrow('Envie os seis arquivos');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the singular multipart file field and keeps upload identifiers', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ file_id: 'file-1', name: '01_orbe.csv', size: 2, sha256: 'sha' }, 201));
    vi.stubGlobal('fetch', fetcher);
    const files = await httpAgent.uploadFiles([new File(['oi'], '01_orbe.csv')]);
    expect(files[0]).toMatchObject({ id: 'file-1', name: '01_orbe.csv' });
    expect([...fetcher.mock.calls[0][1].body.keys()]).toEqual(['file']);
    expect(fetcher.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  it('maps preview filters and resolves builder types to immutable run step IDs', async () => {
    const query = { dataset: 'mdr_conferido', page: 1, page_size: 50, sort: { key: 'amount', dir: 'desc' as const }, filters: [{ key: 'amount', op: 'gt' as const, value: '1.01' }] };
    const params = new URLSearchParams(previewParams(query));
    expect(params.get('sort_dir')).toBe('desc');
    expect(params.get('dataset')).toBe('mdr_conferido');
    expect(JSON.parse(params.get('filters')!)).toEqual([{ column: 'amount', op: 'gt', value: '1.01' }]);
    const fetcher = vi.fn().mockResolvedValueOnce(response(snapshot)).mockResolvedValueOnce(response({ step_id: 's4', schema: [], rows: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await httpAgent.getPreview('run-1', 'conferir_mdr', { ...query, params_override: { tolerancia_pp: 0 } });
    expect(fetcher.mock.calls[1][0]).toContain('/steps/s4/preview?');
    expect(fetcher.mock.calls[1][0]).not.toContain('params_override');
  });

  it('reads every page of exceptions and keeps evidence links and amounts', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(snapshot))
      .mockResolvedValueOnce(response({ exceptions: [exception], total: 2 }))
      .mockResolvedValueOnce(response({ exceptions: [{ ...exception, id: 'exception-2' }], total: 2 }));
    vi.stubGlobal('fetch', fetcher);
    const exceptions = await httpAgent.listExceptions('run-1');
    expect(exceptions).toHaveLength(2);
    expect(fetcher.mock.calls[2][0]).toContain('page=2');
    expect(exceptions[0]).toMatchObject({ step_type: 'conferir_mdr', impact_brl: '90071992547409.91', evidence: [{ arquivo: '01_orbe.csv', linha: 42 }] });
  });

  it('turns structured validation failures into builder issues without requesting analyst identity', async () => {
    setActor('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'PIPELINE_INVALID', message: 'Pipeline inválido', details: [{ step_id: 's4', path: 'tolerancia_pp', message: 'Deve ser zero' }] } }, 422)));
    await expect(httpAgent.validatePipeline(steps)).resolves.toEqual({ ok: false, issues: [{ step_id: 's4', field: 'tolerancia_pp', message: 'Deve ser zero' }] });
  });

  it('submits bulk alert decisions atomically and preserves exact adjustment targets', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ decided: 2 }))
      .mockResolvedValueOnce(response({ ...exception, decision: { acao: 'ajustar', valor: '1.01', entry_id: 'entry-1', justificativa: 'Conferido', actor: 'João 李', at: 'now' } }))
      .mockResolvedValueOnce(response(snapshot));
    vi.stubGlobal('fetch', fetcher);
    const progress = vi.fn();
    await expect(httpAgent.decideMany('run-1', ['a', 'b', 'a'], { action: 'accept', note: 'Conferido na origem' }, progress)).resolves.toEqual({ decided: 2 });
    expect(fetcher.mock.calls[0][0]).toBe('/api/runs/run-1/exceptions/decisions');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ ids: ['a', 'b'], acao: 'aceitar', justificativa: 'Conferido na origem' });
    expect(progress).toHaveBeenCalledExactlyOnceWith(2);
    const decided = await httpAgent.decide('run-1', 'exception-1', { action: 'adjust', note: 'Conferido', amount: '1.01', entry_id: 'entry-1' });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ acao: 'ajustar', justificativa: 'Conferido', valor: '1.01', entry_id: 'entry-1' });
    expect(decided.decision).toMatchObject({ amount: '1.01', entry_id: 'entry-1' });
  });

  it('surfaces the real API error and blocks downloading unapproved files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'EXPORT_NOT_APPROVED', message: 'Aprovação necessária', details: [] } }, 409)));
    await expect(httpAgent.downloadExport('run-1', 'lancamentos_fenix.csv')).rejects.toMatchObject({ name: 'ApiError', message: 'Aprovação necessária', status: 409 });
    await expect(httpAgent.getRun('run-1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('resumable run stream', () => {
  it('resumes after the last event, deduplicates replay and stops reconnecting once finished', () => {
    vi.useFakeTimers();
    class Stream {
      static instances: Stream[] = [];
      handlers = new Map<string, (event: MessageEvent) => void>();
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(readonly url: string) { Stream.instances.push(this); }
      addEventListener(type: string, handler: (event: MessageEvent) => void) { this.handlers.set(type, handler); }
      emit(type: string, sequence: number, data: object) { this.handlers.get(type)?.({ data: JSON.stringify(data), lastEventId: String(sequence) } as MessageEvent); }
    }
    vi.stubGlobal('EventSource', Stream);
    const events: RunEvent[] = [], reconnected = vi.fn();
    const unsubscribe = httpAgent.subscribeRun('run-1', event => events.push(event), reconnected);
    const first = Stream.instances[0];
    first.emit('step_started', 12, { step_id: 's4', at: 'now' });
    first.onerror?.();
    vi.advanceTimersByTime(1000);
    const second = Stream.instances[1];
    expect(second.url).toBe('/api/runs/run-1/events?after=12');
    second.onopen?.();
    expect(reconnected).toHaveBeenCalledTimes(1);
    second.emit('step_started', 12, { step_id: 's4', at: 'now' });
    second.emit('run_finished', 13, { status: 'done', at: 'later' });
    expect(events).toHaveLength(2);
    expect(second.close).toHaveBeenCalled();
    second.onerror?.();
    vi.advanceTimersByTime(60_000);
    expect(Stream.instances).toHaveLength(2);
    unsubscribe();
  });
});
