import { describe, expect, it, vi, afterEach } from 'vitest';
import { scopeFromLocation, scopedUrl, updateSearch } from './scope';
import { core, downloads } from '../api/core';
import { keys } from '../state/queries';

afterEach(() => vi.unstubAllGlobals());
describe('immutable closing selection', () => {
  it('uses the route month and selected run, including copied URLs and reloads', () => {
    expect(scopeFromLocation('/competencias/2026-10', '?comp=2026-09&run_id=run-old')).toEqual({ comp: '2026-10', run_id: 'run-old' });
    expect(scopeFromLocation('/runs/run-original/auditoria', '?run_id=another')).toEqual({ comp: undefined, run_id: 'run-original' });
    expect(scopeFromLocation('/notas-bancos', '?comp=2026-09&run_id=original&aba=bancos')).toEqual({ comp: '2026-09', run_id: 'original' });
  });
  it('preserves month and run when opening panels or changing tabs', () => {
    const query = new URLSearchParams('comp=2026-09&run_id=old&aba=notas');
    expect(updateSearch(query, { aba: 'bancos', painel: 'comissoes' }).toString()).toBe('comp=2026-09&run_id=old&aba=bancos&painel=comissoes');
    expect(query.toString()).toBe('comp=2026-09&run_id=old&aba=notas');
    expect(scopedUrl('/notas-bancos?aba=bancos', { comp: '2026-10', run_id: 'new' })).toBe('/notas-bancos?aba=bancos&comp=2026-10&run_id=new');
  });
  it('isolates cached state, insights, checklist and identical trace IDs by run', () => {
    const a = { comp: '2026-09', run_id: 'old' }, b = { comp: '2026-09', run_id: 'successor' };
    expect(keys.scopedState(a)).not.toEqual(keys.scopedState(b));
    expect(keys.insights(a.comp, a.run_id)).not.toEqual(keys.insights(b.comp, b.run_id));
    expect(keys.checklist(a.comp, a.run_id)).not.toEqual(keys.checklist(b.comp, b.run_id));
    expect(keys.trace('COM-same', a)).not.toEqual(keys.trace('COM-same', b));
  });
  it('keeps old-run scope on every official output and trace request', async () => {
    const scope = { comp: '2026-09', run_id: 'run/older' };
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await core.state(scope); await core.trace('COM-1', scope);
    expect(fetcher.mock.calls[0][0]).toBe('/api/state?comp=2026-09&run_id=run%2Folder');
    expect(fetcher.mock.calls[1][0]).toBe('/api/trace?comp=2026-09&run_id=run%2Folder&id=COM-1');
    for (const url of [downloads.csv('rastro.csv', scope), downloads.zip(scope), downloads.report(scope), downloads.reportDownload(scope)]) {
      expect(new URL(url, 'http://localhost').searchParams.get('run_id')).toBe('run/older');
      expect(new URL(url, 'http://localhost').searchParams.get('comp')).toBe('2026-09');
    }
  });
});
