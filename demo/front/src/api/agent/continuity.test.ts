import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpAgent } from './http';
import { adaptFile, adaptRun } from './adapters';
import { setActor } from '../../lib/actor';
import { core } from '../core';

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const raw = { id: 'successor', competencia: '2026-09', status: 'queued', parent_run_id: 'original', snapshot: { sources: [] }, steps: [], approval: null };
beforeEach(() => setActor('Analista de teste'));
afterEach(() => vi.unstubAllGlobals());
describe('complement ingestion contract', () => {
  it('sends all seven source identifiers without using filename conventions', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ run_id: 'successor' }, 202)).mockResolvedValueOnce(reply(raw));
    vi.stubGlobal('fetch', fetcher);
    const files = Array.from({ length: 7 }, (_, i) => ({ id: `file-${i}`, name: i < 2 ? 'mesmo-nome.csv' : `nome-livre-${i}`, sha256: `hash-${i}` }));
    const run = await httpAgent.createRun({ comp: '2026-09', source: 'upload', files });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).file_ids).toEqual(files.map(file => file.id));
    expect(run.approval).toBeUndefined();
  });
  it('creates a successor using only its new complement while the server inherits prior inputs', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ run_id: 'successor' }, 202)).mockResolvedValueOnce(reply(raw));
    vi.stubGlobal('fetch', fetcher);
    await httpAgent.createRun({ comp: '2026-09', source: 'upload', files: [{ id: 'complement', name: '06_orbe_ajustes_tardios_set2026.csv', sha256: 'hash' }], parent_run_id: 'original', operational_parameters: { closing_deadline: '2026-10-25' } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ pipeline_id: 'fechamento-tarvo', competencia: '2026-09', draft: false, file_ids: ['complement'], parent_run_id: 'original', operational_parameters: { closing_deadline: '2026-10-25' } });
    expect(adaptRun(raw).parent_run_id).toBe('original');
    expect(adaptRun(raw).approval).toBeUndefined();
  });
  it('uploads unrestricted extensions and preserves same-name receipts and rejected inputs instead of abandoning a batch', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ id: 'a', name: 'livre.bin', role: 'orbe', status: 'accepted', rows_received: 3, rows_valid: 3, sha256: 'one' }, 201))
      .mockResolvedValueOnce(reply({ id: 'b', name: 'livre.bin', status: 'rejected', validation_reason: 'Arquivo vazio', rows_received: 0, rows_valid: 0, sha256: 'two' }, 201))
      .mockResolvedValueOnce(reply({ error: { code: 'TOO_LARGE', message: 'Arquivo acima do limite' } }, 413))
      .mockResolvedValueOnce(reply({ id: 'd', name: 'quarto.csv', role: 'orbe', status: 'accepted', sha256: 'four' }, 201));
    vi.stubGlobal('fetch', fetcher);
    const result = await httpAgent.uploadFiles([new File(['a'], 'livre.bin'), new File([], 'livre.bin'), new File(['x'], 'grande.csv'), new File(['d'], 'quarto.csv')]);
    expect(result).toHaveLength(4); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result[0]).toMatchObject({ id: 'a', role: 'orbe', rows_received: 3 });
    expect(result[1]).toMatchObject({ id: 'b', status: 'rejected', validation_reason: 'Arquivo vazio', rows_received: 0 });
    expect(result[2]).toMatchObject({ name: 'grande.csv', status: 'rejected', validation_reason: 'Arquivo acima do limite' });
    expect(result[3].id).toBe('d');
  });
  it('retains structured validation reasons and individual row counts', () => {
    expect(adaptFile({ id: 'h', original_name: 'cabecalho.csv', sha256: 'hash', validation: { status: 'header_only', reason: 'Cabeçalhos válidos sem operações', rows_received: 0, rows_valid: 0 }, rows_unique: 0, rows_duplicated: 0, rows_conflicting: 0 })).toMatchObject({ name: 'cabecalho.csv', status: 'header_only', validation_reason: 'Cabeçalhos válidos sem operações', rows_received: 0, rows_valid: 0, rows_unique: 0, rows_duplicated: 0, rows_conflicting: 0 });
  });
  it('uses the imported manifest, preserving duplicate receipts and inheritance', () => {
    const run = adaptRun({ ...raw, snapshot: { sources: [{ id: 'x', inherited_from: 'original', name: 'same.csv', sha256: 'hash', rows_read: 9 }], input_manifest: [{ id: 'x', name: 'same.csv', sha256: 'hash', status: 'valid', import_action: 'duplicate_receipt', duplicate_of: 'prior', rows_received: 10, rows_valid: 9, rows_discarded: 1 }], ingestion_counts: { by_role: { orbe: { rows_received: 20, rows_unique: 9, rows_duplicate: 9 } } } } });
    expect(run.files[0]).toMatchObject({ inherited: true, import_action: 'duplicate_receipt', duplicate_of: 'prior', rows_received: 10, rows_valid: 9, discarded: 1 });
    expect(run.ingestion_counts?.by_role?.orbe.rows_unique).toBe(9);
  });
  it('requests insights and checklist for the selected historical execution', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ comp: '2026-09' })).mockResolvedValueOnce(reply({ tasks: [] }));
    vi.stubGlobal('fetch', fetcher);
    await httpAgent.getInsights('2026-09', 'original'); await httpAgent.getChecklist('2026-09', 'original');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/insights?comp=2026-09&run_id=original', '/api/competencias/2026-09/checklist?run_id=original']);
  });
  it('saves a month-specific operational deadline without financial parameters', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ competencia: '2026-10', closing_deadline: '2026-11-05' }));
    vi.stubGlobal('fetch', fetcher);
    await core.saveOperationalConfig('2026-10', { closing_deadline: '2026-11-05', reason: 'Prazo operacional confirmado' });
    expect(fetcher.mock.calls[0][0]).toBe('/api/competencias/2026-10/config');
    expect(fetcher.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ closing_deadline: '2026-11-05', reason: 'Prazo operacional confirmado' });
  });
});
