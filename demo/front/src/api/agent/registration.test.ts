import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptAudit, adaptDecision, adaptException, adaptRun } from './adapters';
import { httpAgent } from './http';
import { setActor } from '../../lib/actor';

const rawRun = { id: 'run-cadastro', competencia: '2026-09', status: 'awaiting_approval', steps: [{ id: 's3', type: 'resolver_lojista', status: 'done_with_exceptions' }] };
const run = adaptRun(rawRun);
const operations = [
  { id: 'orbe-1', ref: 'REF-1', arquivo: 'orbe.csv', linha: 4, date: '2026-09-01', business: 'CHECKOUT', exposure_brl: '90071992547409.91', exposure_basis: 'reported_fee' },
  { id: 'remessa-1', ref: 'REF-1', arquivo: 'ponte.csv', linha: 12, date: '2026-09-25', business: 'REMESSA', exposure_brl: null, exposure_basis: 'spread_brl' },
];
const group = {
  id: 'cadastro-grupo', step_id: 's3', tipo: 'CADASTRO_NAO_CONFIRMADO', severidade: 'bloqueante',
  group_scope: 'merchant_period', period: '2026-09', cnpj: '12345678000199', merchant_name: 'Empresa Atlas',
  operation_count: 2, affected_operations: operations, source_fingerprint: 'source-hash',
  ref_origem: 'CADASTRO:12345678000199:2026-09', motivo: 'Cadastro não confirmado.',
  impacto_rs: null, valor_brl: null, exposure_status: 'partial', known_exposure_brl: '90071992547409.91', missing_exposure_count: 1,
  // A stale endpoint might also include a first-row sample. It must not describe the whole group.
  data: '2026-09-01', amount: '999.99',
  origens: operations.map(({ arquivo, linha, ref }) => ({ arquivo, linha, ref })),
};
const rawDecision = { acao: 'aceitar', justificativa: 'Cadastro ainda pendente; responsável Comercial.', actor: 'Analista', at: '2026-10-17T12:00:00Z',
  group_scope: group.group_scope, period: group.period, cnpj: group.cnpj, operation_count: group.operation_count,
  affected_operations: operations, source_fingerprint: group.source_fingerprint, billing_authorized: false };

afterEach(() => vi.unstubAllGlobals());

describe('registration group contract', () => {
  it('preserves the backend scope, exact exposure and every member/source without selecting a first operation', () => {
    const item = adaptException(group, run);
    expect(item).toMatchObject({ merchant: 'Empresa Atlas', group_scope: 'merchant_period', period: '2026-09', cnpj: group.cnpj,
      operation_count: 2, source_fingerprint: 'source-hash', impact_brl: null, known_exposure_brl: '90071992547409.91', exposure_status: 'partial', missing_exposure_count: 1 });
    expect(item.date).toBeUndefined();
    expect(item.amount).toBeUndefined();
    expect(item.affected_operations).toEqual(operations);
    expect(item.evidence).toEqual(group.origens);
    expect(adaptException({ ...group, impacto_rs: null, valor_brl: '0.00' }, run).impact_brl).toBeNull();
    expect(adaptException({ ...group, impacto_rs: '90071992547409.92', valor_brl: '90071992547409.92', exposure_status: 'complete' }, run).impact_brl).toBe('90071992547409.92');
  });

  it('keeps legacy line-level exceptions and their decisions readable without inventing group membership', () => {
    const item = adaptException({ id: 'legacy', tipo: 'CADASTRO_NAO_CONFIRMADO', ref_origem: 'REF-1', lojista: 'Atlas antigo', data: '2026-09-01', amount: '25.01', valor_brl: '3.77' }, run);
    expect(item).toMatchObject({ merchant: 'Atlas antigo', date: '2026-09-01', amount: '25.01', impact_brl: '3.77' });
    expect(item.group_scope).toBeUndefined();
    expect(item.affected_operations).toBeUndefined();
    const decision = adaptDecision({ acao: 'aceitar', justificativa: 'Conferido', actor: 'Analista', at: 'antes' });
    expect(decision).toMatchObject({ action: 'accept', note: 'Conferido', actor: 'Analista' });
    expect(decision?.group_scope).toBeUndefined();
  });

  it('records the exact decision membership and keeps lack of billing authorization in audit history', () => {
    expect(adaptDecision(rawDecision)).toMatchObject({ action: 'accept', operation_count: 2, affected_operations: operations, billing_authorized: false, source_fingerprint: 'source-hash' });
    const trail = adaptAudit({ records: [{ action: 'exception_decision', actor: rawDecision.actor, at: rawDecision.at,
      details: { before: group, after: { ...group, decision: rawDecision } } }] }, run);
    expect(trail.entries.find(entry => entry.kind === 'decision')).toMatchObject({ group_scope: 'merchant_period', period: group.period,
      cnpj: group.cnpj, operation_count: 2, affected_operations: operations, after: 'Aceita como ressalva; sem faturamento' });
  });

  it('submits one decision for the persisted group, never one action per member', async () => {
    setActor('Analista');
    const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...group, decision: rawDecision })).mockResolvedValueOnce(response(rawRun));
    vi.stubGlobal('fetch', fetcher);
    const result = await httpAgent.decide(run.id, group.id, { action: 'accept', note: rawDecision.justificativa });
    const mutations = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(mutations).toHaveLength(1);
    expect(mutations[0][0]).toBe('/api/runs/run-cadastro/exceptions/cadastro-grupo/decision');
    expect(JSON.parse(mutations[0][1].body)).toEqual({ acao: 'aceitar', justificativa: rawDecision.justificativa });
    expect(result.decision).toMatchObject({ operation_count: 2, affected_operations: operations, billing_authorized: false });
  });
});
