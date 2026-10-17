import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunComparison } from '../../api/agent';
import { httpAgent } from '../../api/agent/http';
import { ComparisonOutcome } from './ComparisonOutcome';
afterEach(() => vi.unstubAllGlobals());
const run = { id: 'a', competencia: '2026-09', status: 'awaiting_approval', steps: [], snapshot: { sources: [] } };

describe('comparação econômica e binária', () => {
  it('retains independent API outcomes when unique financial results match but source receipts differ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ a: run, b: { ...run, id: 'b' }, reproducible: true, binary_identical: false, business_hash_a: 'same', business_hash_b: 'same', comparison_basis: 'Critério declarado pelo motor', steps: [{ type: 'normalizar_orbe', title: 'Normalizar Orbe', hash_a: 'one', hash_b: 'two', match: false }] }), { headers: { 'content-type': 'application/json' } })));
    const result = await httpAgent.compareRuns('a', 'b');
    expect(result).toMatchObject({ reproducible: true, binary_identical: false, business_hash_a: 'same', business_hash_b: 'same', comparison_basis: 'Critério declarado pelo motor' });
    expect(result.steps[0].match).toBe(false);
    const html = renderToStaticMarkup(createElement(ComparisonOutcome, { result }));
    expect(html).toContain('Resultados e regras equivalentes.');
    expect(html).toContain('Arquivos ou snapshots diferentes');
    expect(html).not.toContain('Os hashes de saída batem');
    expect(html).not.toContain('Há diferenças nos resultados ou regras.');
  });
  it('reports economic differences from the explicit API signal', () => {
    const result = { reproducible: false, binary_identical: false, steps: [] } as unknown as RunComparison;
    const html = renderToStaticMarkup(createElement(ComparisonOutcome, { result }));
    expect(html).toContain('Há diferenças nos resultados ou regras.');
    expect(html).not.toContain('Resultados e regras equivalentes.');
  });
});
