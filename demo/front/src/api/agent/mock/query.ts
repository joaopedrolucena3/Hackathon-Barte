// Server-side paging, sorting, filtering and totals for the mocked preview endpoint.
import { cents, fromCents } from '../../../lib/decimal';
import type { ColumnFilter, ColumnSchema, PreviewQuery, PreviewRow } from '../contract';
import type { StepOutput } from './outputs';

const numeric = new Set(['money', 'percent', 'pp', 'number']);

function matches(row: PreviewRow, filter: ColumnFilter, column?: ColumnSchema) {
  const value = row[filter.key];
  if (value === null || value === undefined || value === '') return false;
  if (filter.op === 'contains') {
    return String(value).toLocaleLowerCase('pt-BR').includes(filter.value.toLocaleLowerCase('pt-BR'));
  }
  if (column && numeric.has(column.type)) {
    const a = Number(value), b = Number(String(filter.value).replace(/\./g, '').replace(',', '.'));
    if (Number.isNaN(b)) return true;
    return filter.op === 'eq' ? a === b : filter.op === 'gt' ? a > b : a < b;
  }
  const a = String(value), b = column?.type === 'date' ? toIso(filter.value) : filter.value;
  return filter.op === 'eq' ? a.toLocaleLowerCase('pt-BR') === b.toLocaleLowerCase('pt-BR') : filter.op === 'gt' ? a > b : a < b;
}

/** Accepts dd/mm/aaaa typed by the user. */
function toIso(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function compare(a: PreviewRow, b: PreviewRow, key: string, isNumeric: boolean) {
  const x = a[key], y = b[key];
  if (x === y) return 0;
  if (x === null || x === undefined || x === '') return 1;
  if (y === null || y === undefined || y === '') return -1;
  if (isNumeric) return Number(x) - Number(y);
  return String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
}

function totals(rows: PreviewRow[], schema: ColumnSchema[]) {
  const out: Record<string, string> = {};
  for (const column of schema.filter(c => c.type === 'money')) {
    let sum = 0n;
    for (const row of rows) sum += cents(row[column.key] as string | null);
    out[column.key] = fromCents(sum);
  }
  return out;
}

export function queryOutput(output: StepOutput, query: PreviewQuery) {
  const columns = new Map(output.schema.map(column => [column.key, column]));
  let rows = output.rows;
  if (query.only_exceptions) rows = rows.filter(row => row._exception);
  for (const filter of query.filters || []) rows = rows.filter(row => matches(row, filter, columns.get(filter.key)));
  if (query.sort) {
    const { key, dir } = query.sort;
    const isNumeric = numeric.has(columns.get(key)?.type || '');
    rows = [...rows].sort((a, b) => compare(a, b, key, isNumeric) * (dir === 'desc' ? -1 : 1));
  }
  if (query.diff) {
    rows = rows.map(row => ({ ...row, _diff: 'same' as const }));
    if (!query.only_exceptions) rows = [...rows, ...(output.removed || []).map(row => ({ ...row, _diff: 'removed' as const }))];
  }
  const size = Math.max(1, Math.min(query.page_size || 100, 500));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(1, query.page || 1), pages);
  const pageRows = rows.slice((page - 1) * size, page * size);
  const counted = rows.filter(row => row._diff !== 'removed');
  return {
    rows: pageRows,
    total_rows: rows.length,
    page,
    page_size: size,
    totals: { page: totals(pageRows.filter(row => row._diff !== 'removed'), output.schema), all: totals(counted, output.schema) },
    exceptions_total: output.rows.filter(row => row._exception).length,
    diff_summary: { added: 0, removed: output.removed?.length || 0 },
  };
}
