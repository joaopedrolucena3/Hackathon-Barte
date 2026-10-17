import { describe, expect, it } from 'vitest';
import type { DataColumn, DataValue } from '../api/agent';
import { copyText, describeView, display, letter, matches, parseInput, selectionStats, viewRids } from './table';

const col = (name: string, kind: DataColumn['kind']): DataColumn => ({ name, label: name, kind, description: '', hidden: name.startsWith('__') });
const columns = [col('id', 'text'), col('gross', 'money'), col('date', 'date'), col('brand', 'text'), col('rate', 'percent'), col('ok', 'boolean'), col('__exception_ids', 'json')];
const rows: DataValue[][] = [
  ['A', '608.88', '2026-09-01', 'ELO', '2.69', true, []],
  ['B', '-5.50', '2026-08-21', 'VISA', '0.000', false, ['PEND-1']],
  ['C', '1830.48', '2026-09-12', 'ELO', '3.19', true, ['PEND-2']],
  ['D', null, '2026-09-02', '', '1.500200', null, []],
  ['E', '0.10', '2026-09-01', 'elo', '1.5', true, []],
];
const table = { columns, rows };

describe('spreadsheet helpers', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(letter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
  it('displays and copies values exactly', () => {
    expect(display('money', '4715852.69').replace(/\s/g, ' ')).toBe('R$ 4.715.852,69');
    expect(display('percent', '1.500200')).toBe('1,5002%');
    expect(display('date', '2026-09-01')).toBe('01/09/2026');
    expect(display('boolean', false)).toBe('Não');
    expect(display('json', ['PEND-1', 'PEND-2'])).toBe('PEND-1, PEND-2');
    expect(copyText('money', '1830.48')).toBe('1830,48');
  });
  it('parses analyst input in pt-BR', () => {
    expect(parseInput('R$ 1.234,56')).toBe('1234.56');
    expect(parseInput('1234.56')).toBe('1234.56');
    expect(parseInput('2,69%')).toBe('2.69');
    expect(parseInput('abc')).toBeNull();
  });
});

describe('filters and sort', () => {
  it('compares money exactly, not as text or float', () => {
    expect(matches('money', '608.88', { column: 'gross', op: 'gt', value: '99' })).toBe(true);
    expect(matches('money', '0.10', { column: 'gross', op: 'eq', value: '0,1' })).toBe(true);
    expect(matches('percent', '1.500200', { column: 'rate', op: 'eq', value: '1.5002' })).toBe(true);
    expect(matches('date', '2026-08-21', { column: 'date', op: 'lt', value: '01/09/2026' })).toBe(true);
    expect(matches('text', 'elo', { column: 'brand', op: 'eq', value: 'ELO' })).toBe(true);
  });
  it('filters, keeps exception rows and sorts with empty values last', () => {
    expect(viewRids(table, { filters: [{ column: 'brand', op: 'contains', value: 'elo' }], sort: null, onlyExceptions: false })).toEqual([0, 2, 4]);
    expect(viewRids(table, { filters: [], sort: null, onlyExceptions: true })).toEqual([1, 2]);
    expect(viewRids(table, { filters: [], sort: { column: 'gross', dir: 'desc' }, onlyExceptions: false })).toEqual([2, 0, 4, 1, 3]);
    expect(viewRids(table, { filters: [], sort: { column: 'gross', dir: 'asc' }, onlyExceptions: false })).toEqual([1, 4, 0, 2, 3]);
    expect(viewRids(table, { filters: [], sort: { column: 'date', dir: 'asc' }, onlyExceptions: false, rids: new Set([0, 1, 3]) })).toEqual([1, 0, 3]);
  });
  it('describes the view for the export file', () => {
    expect(describeView(columns, { filters: [{ column: 'brand', op: 'eq', value: 'ELO' }], sort: { column: 'gross', dir: 'desc' }, onlyExceptions: true }, 2))
      .toBe('brand igual a “ELO”; só linhas com exceção; ordenado por gross decrescente · 2 linhas');
  });
});

describe('volume', () => {
  it('filters and sorts 25 thousand rows exactly, fast enough for the grid', () => {
    const wide = [col('gross', 'money'), col('brand', 'text'), ...Array.from({ length: 36 }, (_, i) => col(`c${i}`, 'text'))];
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647);
    const brands = ['ELO', 'VISA', 'AMEX', 'MASTERCARD', 'HIPERCARD'];
    const big: DataValue[][] = Array.from({ length: 25_000 }, () => [
      `${random() % 100000}.${String(random() % 100).padStart(2, '0')}`, brands[random() % 5], ...Array.from({ length: 36 }, () => 'x'),
    ]);
    const started = performance.now();
    const rids = viewRids({ columns: wide, rows: big }, { filters: [{ column: 'brand', op: 'eq', value: 'ELO' }], sort: { column: 'gross', dir: 'desc' }, onlyExceptions: false });
    const elapsed = performance.now() - started;
    expect(rids.length).toBe(big.filter(row => row[1] === 'ELO').length);
    for (let i = 1; i < rids.length; i++) expect(matches('money', big[rids[i]][0], { column: 'gross', op: 'lte', value: String(big[rids[i - 1]][0]) })).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('selection statistics', () => {
  it('sums and averages money without float drift', () => {
    const stats = selectionStats([{ kind: 'money', value: '0.10' }, { kind: 'money', value: '0.20' }, { kind: 'money', value: null }, { kind: 'text', value: 'x' }]);
    expect(stats).toEqual({ cells: 3, numeric: 2, sum: '0.30', avg: '0.15', money: true });
    const many = selectionStats(Array.from({ length: 25_000 }, () => ({ kind: 'money' as const, value: '188.63' })));
    expect(many.sum).toBe('4715750.00');
    expect(many.avg).toBe('188.63');
  });
  it('rounds the average half up, away from zero', () => {
    expect(selectionStats([{ kind: 'money', value: '0.01' }, { kind: 'money', value: '0.00' }]).avg).toBe('0.01');
    expect(selectionStats([{ kind: 'money', value: '-0.01' }, { kind: 'money', value: '0.00' }]).avg).toBe('-0.01');
    expect(selectionStats([{ kind: 'money', value: '1.00' }, { kind: 'money', value: '1.00' }, { kind: 'money', value: '2.00' }]).avg).toBe('1.33');
  });
  it('mixes rates and money as plain decimals', () => {
    const stats = selectionStats([{ kind: 'percent', value: '1.500200' }, { kind: 'money', value: '2.00' }]);
    expect(stats.money).toBe(false);
    expect(stats.sum).toBe('3.500200');
  });
});
