import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActor } from '../../../lib/actor';
import type { AppState, Pendencia } from '../../types';
import type { Run } from '../contract';

const fixtures = vi.hoisted(() => ({ loadState: vi.fn(), refreshState: vi.fn(), decide: vi.fn() }));
vi.mock('../../core', () => ({ core: { decide: fixtures.decide } }));
vi.mock('./data', async importOriginal => ({
  ...await importOriginal<typeof import('./data')>(),
  loadState: fixtures.loadState,
  refreshState: fixtures.refreshState,
}));
vi.mock('./store', () => ({ loadAdjustments: () => ({}), saveAdjustment: vi.fn() }));
import { decideMany, listExceptions } from './review';

const run = {
  id: 'review-run', status: 'awaiting_approval',
  steps: [{ type: 'comissao_checkout', status: 'done', params: {} }],
} as Run;
const note = 'Mesmo problema e identidade conferidos.';

function useBlockers(cnpjs: Array<string | undefined>, kinds = ['CONTRATO_AUSENTE', 'CONTRATO_AUSENTE']) {
  const pendencias: Pendencia[] = cnpjs.map((cnpj, index) => ({
    id_saida: `issue-${index}`, tipo: kinds[index], ref_origem: `operation-${index}`, cnpj,
    valor_brl: '10.00', motivo: 'Contrato precisa de confirmação', quem_decide: 'Comercial',
    severity: 'bloqueante', status: 'open', decision: null,
  }));
  const state: AppState = {
    period: '2026-09', closing: { status: 'open' },
    summary: {
      checkout_brl: '0.00', checkout_count: 0, remessa_brl: '0.00', remessa_count: 0,
      divergencias_brl: '0.00', divergencias_abs_brl: '0.00', divergencias_count: 0,
      notas_brl: '0.00', notas_count: 0, pendencias_count: pendencias.length, bank_count: 0,
      open_issues: pendencias.length, resolved_issues: 0, blocking_issues: pendencias.length,
    },
    results: {
      pendencias, divergencias: [], lancamentos: [], comissoes: [], notas: [], rastro: [],
      details: pendencias.map(item => ({
        id_saida: item.id_saida, ref_origem: item.ref_origem, arquivo_origem: '01_orbe.csv',
        entrada: { id: item.ref_origem, name: 'Mesmo nome comercial' },
      })),
    },
    merchants: cnpjs.filter((cnpj): cnpj is string => !!cnpj).map(cnpj => ({ cnpj, name: 'Mesmo nome comercial', active: false })),
    rates: [], accounts: [], parameters: {}, contacts: [], notifications: [], emails: [], audit: [], sources: [], assumptions: [],
    validation: { errors: [], warnings: [] },
  };
  fixtures.loadState.mockResolvedValue(state);
  fixtures.refreshState.mockResolvedValue(state);
  return pendencias.map(item => item.id_saida);
}

beforeEach(() => {
  vi.clearAllMocks();
  setActor('Analista de teste');
  fixtures.decide.mockResolvedValue({});
});

describe('mock bulk blocker identity', () => {
  it.each([
    { label: 'missing', cnpjs: [undefined, undefined] },
    { label: 'empty', cnpjs: ['', ''] },
    { label: 'blank', cnpjs: [' ', ' '] },
    { label: 'different', cnpjs: ['12345678000199', '98765432000100'] },
  ])('rejects $label CNPJs despite identical merchant names before writing any decision', async ({ cnpjs }) => {
    const ids = useBlockers(cnpjs);
    expect((await listExceptions(run)).map(item => item.merchant)).toEqual(['Mesmo nome comercial', 'Mesmo nome comercial']);
    await expect(decideMany(run, ids, { action: 'accept', note })).rejects.toMatchObject({ status: 400 });
    expect(fixtures.decide).not.toHaveBeenCalled();
  });

  it('accepts a single issue type for the same exact CNPJ', async () => {
    const ids = useBlockers(['12345678000199', '12345678000199']);
    await expect(decideMany(run, ids, { action: 'accept', note })).resolves.toEqual({ decided: 2 });
    expect(fixtures.decide.mock.calls.map(([input]) => input)).toEqual(ids.map(id => ({ id, action: 'confirm', note })));
  });

  it('rejects different issue types even for the same exact CNPJ', async () => {
    const ids = useBlockers(['12345678000199', '12345678000199'], ['CONTRATO_AUSENTE', 'TAXA_NAO_ENCONTRADA']);
    await expect(decideMany(run, ids, { action: 'accept', note })).rejects.toMatchObject({ status: 400 });
    expect(fixtures.decide).not.toHaveBeenCalled();
  });
});
