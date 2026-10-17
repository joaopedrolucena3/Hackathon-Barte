import { describe, expect, it } from 'vitest';
import type { ColumnSchema, PreviewRow } from '../contract';
import type { StepOutput } from './outputs';
import { queryOutput } from './query';

const schema: ColumnSchema[] = [
  { key: 'id', label: 'Transação', type: 'code' },
  { key: 'data', label: 'Data', type: 'date' },
  { key: 'valor', label: 'Valor', type: 'money', is_new: true },
];
const rows: PreviewRow[] = [
  { _id: 'a', id: 'TX1', data: '2026-09-01', valor: '10.10' },
  { _id: 'b', id: 'TX2', data: '2026-09-02', valor: '0.20', _exception: { id: 'P1', severity: 'alerta', description: 'x' } },
  { _id: 'c', id: 'TX3', data: '2026-09-03', valor: '-5.00' },
];
const output: StepOutput = { schema, rows, input_rows: 3, removed: [{ _id: 'c#dup', id: 'TX3', data: '2026-09-03', valor: '-5.00' }] };

describe('preview query (C8, mock server side)', () => {
  it('paginates and totals money exactly for the page and the dataset', () => {
    const page = queryOutput(output, { page: 1, page_size: 2 });
    expect(page.rows.map(row => row._id)).toEqual(['a', 'b']);
    expect(page.totals.page.valor).toBe('10.30');
    expect(page.totals.all.valor).toBe('5.30');
    expect(page.total_rows).toBe(3);
  });
  it('filters exceptions only, sorts numerically and filters dates typed as dd/mm/aaaa', () => {
    expect(queryOutput(output, { page: 1, page_size: 10, only_exceptions: true }).rows.map(row => row.id)).toEqual(['TX2']);
    expect(queryOutput(output, { page: 1, page_size: 10, sort: { key: 'valor', dir: 'desc' } }).rows.map(row => row.id)).toEqual(['TX1', 'TX2', 'TX3']);
    expect(queryOutput(output, { page: 1, page_size: 10, filters: [{ key: 'data', op: 'gt', value: '01/09/2026' }] }).rows.map(row => row.id)).toEqual(['TX2', 'TX3']);
    expect(queryOutput(output, { page: 1, page_size: 10, filters: [{ key: 'valor', op: 'lt', value: '0' }] }).rows.map(row => row.id)).toEqual(['TX3']);
  });
  it('shows removed rows only when comparing with the input, without counting them in totals', () => {
    const page = queryOutput(output, { page: 1, page_size: 10, diff: true });
    expect(page.rows.at(-1)).toMatchObject({ _id: 'c#dup', _diff: 'removed' });
    expect(page.totals.all.valor).toBe('5.30');
  });
});
