import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../http';
import {
  canApplyRecommendations, filterRecommendations, isEligibleRecommendation, isStaleRecommendationPreview,
  recommendationsApi, type Recommendation, type RecommendationPreview,
} from './recommendations';

const mode = vi.hoisted(() => ({ mode: 'http' }));
vi.mock('./index', () => ({ agent: mode }));
vi.mock('../../lib/actor', () => ({ ensureActor: async () => 'João revisão' }));

export const eligible: Recommendation = {
  id: 'recommendation-1', exception_id: 'exception-1', kind: 'DIVERGENCIA_TAXA', title: 'Taxa divergente',
  severity: 'alerta', fact: 'Taxa informada difere do contrato.', rule: 'Aplicar a taxa contratada.',
  assumption_ids: ['H02'], evidence: [{ arquivo: 'operacoes.csv', linha: 3, ref: 'OP1' }],
  suggested_action: 'accept', eligible: true, reason: 'O cálculo já usa a taxa contratada.',
  effect: 'Mantém os lançamentos calculados.', owner: 'Financeiro', missing_evidence: [],
  follow_up: 'Contestar a diferença e registrar a resposta.', exposure_brl: '12.30', status: 'open', ineligible_reason: '',
};
export const preview: RecommendationPreview = {
  run_id: 'run-1', policy_version: '1', snapshot_status: 'captured', can_apply: true, preview_token: 'exact-version',
  assumptions: [{ id: 'H02', question: 'Qual taxa aplicar?', decision: 'A taxa vigente do contrato.' }],
  recommendations: [eligible], summary: { total: 1, eligible: 1, waiting: 0, decided: 0 },
  effects: { entries_before: 2, entries_after: 2, debit_before: '20.00', debit_after: '20.00', credit_before: '20.00', credit_after: '20.00', balanced: true },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); mode.mode = 'http'; });

describe('eligibilidade das sugestões', () => {
  it('does not include missing-evidence, waiting, or already-decided recommendations even if eligible is inconsistent', () => {
    const waiting: Recommendation = { ...eligible, id: 'waiting', exception_id: 'wait', suggested_action: 'wait', eligible: false, missing_evidence: ['Contrato vigente'] };
    const decided: Recommendation = { ...eligible, id: 'decided', exception_id: 'done', status: 'decided' };
    const inconsistent: Recommendation = { ...eligible, id: 'inconsistent', exception_id: 'missing', missing_evidence: ['Confirmação'] };
    expect(filterRecommendations([eligible, waiting, decided, inconsistent], 'eligible')).toEqual([eligible]);
    expect(filterRecommendations([eligible, waiting, decided, inconsistent], 'waiting')).toEqual([waiting, inconsistent]);
    expect(filterRecommendations([eligible, waiting, decided], 'decided')).toEqual([decided]);
    expect(filterRecommendations([eligible, waiting, decided], 'all', 'wait')).toEqual([waiting]);
    expect(isEligibleRecommendation({ ...eligible, ineligible_reason: 'Outro bloqueio na operação' })).toBe(false);
  });
  it.each([
    ['legacy snapshot', { snapshot_status: 'legacy_unavailable' }],
    ['server denial', { can_apply: false }],
    ['missing preview token', { preview_token: '' }],
    ['zero eligible', { recommendations: [], summary: { total: 0, eligible: 0, waiting: 0, decided: 0 } }],
    ['inconsistent summary', { summary: { total: 2, eligible: 2, waiting: 0, decided: 0 } }],
    ['unbalanced batch', { effects: { ...preview.effects, balanced: false } }],
    ['unknown batch values', { effects: { ...preview.effects, debit_before: null } }],
  ])('blocks application for %s', (_, overrides) => {
    expect(canApplyRecommendations({ ...preview, ...overrides } as RecommendationPreview)).toBe(false);
  });
  it('permits only the complete eligible preview', () => expect(canApplyRecommendations(preview)).toBe(true));
});

describe('transporte da prévia por execução', () => {
  it('reads the selected run and sends exactly the reviewed token with the actor header', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ...preview, run_id: 'run/special' })).mockResolvedValueOnce(json({ applied: 1, already_applied: false }));
    vi.stubGlobal('fetch', fetcher);
    const result = await recommendationsApi.preview('run/special');
    expect(fetcher.mock.calls[0][0]).toBe('/api/runs/run%2Fspecial/recommendations');
    expect(result.recommendations[0].follow_up).toBe(eligible.follow_up);
    await recommendationsApi.apply('run/special', result.preview_token!);
    expect(fetcher.mock.calls[1][0]).toBe('/api/runs/run%2Fspecial/recommendations/apply');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ preview_token: 'exact-version' });
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ 'X-User': 'Jo%C3%A3o%20revis%C3%A3o', 'X-User-Encoding': 'percent-utf8' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects data from another execution instead of showing it in the selected run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...preview, run_id: 'another-run' })));
    await expect(recommendationsApi.preview('run-1')).rejects.toThrow('desta execução');
  });
  it('does not use live endpoints in mock mode', async () => {
    mode.mode = 'mock'; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(recommendationsApi.preview('run-1')).rejects.toThrow('modo conectado');
    await expect(recommendationsApi.apply('run-1', 'token')).rejects.toThrow('modo conectado');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires a new confirmation after a stale response without retrying the mutation', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: { code: 'STALE_RECOMMENDATION_PREVIEW', message: 'Atualize a prévia.' } }, 409));
    vi.stubGlobal('fetch', fetcher);
    const error = await recommendationsApi.apply('run-1', 'old-token').catch(value => value);
    expect(isStaleRecommendationPreview(error)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(isStaleRecommendationPreview(new ApiError('offline', 503))).toBe(false);
  });
});
