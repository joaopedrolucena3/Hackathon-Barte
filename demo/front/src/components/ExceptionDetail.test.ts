import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { adaptException, adaptRun } from '../api/agent/adapters';
import { exceptionSearchText, reviewActions } from '../lib/reviewScope';

vi.mock('../state/queries', () => ({ useAppState: () => ({}), useRunAccounts: () => ({ data: [] }), keys: {} }));
vi.mock('../state/useAction', () => ({ useAction: () => ({ run: vi.fn(), busy: false }) }));
import { ExceptionDetail } from './ExceptionDetail';
import { ExceptionExposure } from './ExceptionExposure';

const run = adaptRun({ id: 'r1', status: 'awaiting_approval', competencia: '2026-09', steps: [] });
const item = adaptException({ id: 'g1', tipo: 'CADASTRO_NAO_CONFIRMADO', group_scope: 'merchant_period', period: '2026-09', cnpj: '12345678000199',
  merchant_name: 'Atlas', operation_count: 2, exposure_status: 'partial', known_exposure_brl: '12.34', missing_exposure_count: 1, valor_brl: null,
  affected_operations: [
    { id: 'op1', ref: 'VENDA-1', arquivo: 'orbe.csv', linha: 3, date: '2026-09-01', business: 'CHECKOUT', exposure_brl: '12.34', exposure_basis: 'reported_fee' },
    { id: 'op2', ref: 'REMESSA-2', arquivo: 'ponte.csv', linha: 18, date: '2026-09-12', business: 'REMESSA', exposure_brl: null, exposure_basis: 'spread_brl' },
  ], origens: [{ arquivo: 'orbe.csv', linha: 3, ref: 'VENDA-1' }, { arquivo: 'ponte.csv', linha: 18, ref: 'REMESSA-2' }],
}, run);

describe('company registration review', () => {
  it('shows members, source lines, bounded scope and non-billing acceptance while requiring a reason', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ExceptionDetail, { exception: item, run, editable: true })));
    for (const phrase of ['Por empresa e competência', '2 operações', '09/2026', '12.345.678/0001-99', 'VENDA-1', 'REMESSA-2', 'linha 18', 'Subtotal conhecido', 'Não calculado', 'Aceitar como ressalva', 'Excluir grupo do lote', 'faturamento continua bloqueado', 'operações futuras', 'nova execução', 'Justificativa']) expect(html).toContain(phrase);
    expect(html).not.toContain('>Ajustar<');
    expect(html).not.toContain('Valor da operação</dt>');
    expect(html).toContain('disabled=""');
    expect(html).toContain('/cadastros?lojista=12345678000199');
  });

  it('never shows unavailable exposure as zero or a partial subtotal as a total', () => {
    const partial = renderToStaticMarkup(createElement(ExceptionExposure, { exception: item }));
    expect(partial).toContain('12,34');
    expect(partial).toContain('Subtotal conhecido');
    expect(partial).toContain('1 valor não calculado');
    const absent = renderToStaticMarkup(createElement(ExceptionExposure, { exception: { ...item, exposure_status: 'unavailable', known_exposure_brl: '0.00' } }));
    expect(absent).toContain('Não calculado');
    expect(absent).not.toContain('0,00');
  });

  it('can find a group by any member reference or source and never permits a group adjustment', () => {
    expect(exceptionSearchText(item)).toContain('remessa-2');
    expect(exceptionSearchText(item)).toContain('ponte.csv');
    expect(exceptionSearchText(item)).toContain('12.345.678/0001-99');
    const entries = [{ entry_id: 'e1', account_code: '1.01', amount: '3.00', event: 'commission' }];
    expect(reviewActions({ ...item, associated_entries: entries }).map(action => action.value)).toEqual(['accept', 'exclude']);
    expect(reviewActions({ ...item, group_scope: undefined, associated_entries: [] }).map(action => action.value)).toEqual(['accept', 'exclude']);
    expect(reviewActions({ ...item, kind: 'DIVERGENCIA_TAXA', group_scope: undefined, associated_entries: entries }).map(action => action.value)).toEqual(['accept', 'adjust', 'exclude']);
  });

  it('explains missing group membership rather than authorizing review from incomplete scope', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(ExceptionDetail, { exception: { ...item, affected_operations: [] }, run, editable: true })));
    expect(html).toContain('Os dados de abrangência do grupo estão incompletos');
    expect(html).toContain('A lista de operações deste grupo não está disponível');
  });
});
