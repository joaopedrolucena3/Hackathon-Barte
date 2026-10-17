// Pure data-desk logic: display text, filters, sort and selection statistics. Numbers are compared and
// summed as exact decimals (BigInt units), never as floats.
import type { DataColumn, DataKind, DataValue, StepTable } from '../api/agent';
import { count, dateBR, decimal, money, percent } from '../lib/format';
import type { FilterOp, GridFilter, Rid, SelectionStats, SortSpec } from './contract';

export const NUMERIC_KINDS = new Set<DataKind>(['money', 'percent', 'decimal', 'number', 'integer']);
export const EXCEPTIONS_COLUMN = '__exception_ids';

export const OPS: Record<FilterOp, string> = {
  eq: 'igual a', neq: 'diferente de', contains: 'contém', gt: 'maior que', gte: 'maior ou igual a',
  lt: 'menor que', lte: 'menor ou igual a', empty: 'vazio', filled: 'preenchido',
};

/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function letter(index: number): string {
  let text = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
}

interface Exact { units: bigint; scale: number }
const DECIMAL = /^(-)?(\d+)(?:\.(\d*))?$/;

/** "1234.5" → 12345n at scale 1. Accepts numbers (integers from Parquet int64). */
export function exact(value: DataValue | undefined): Exact | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object') return null;
  const match = DECIMAL.exec(String(value).trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(whole + fraction);
  return { units: sign ? -units : units, scale: fraction.length };
}

const scaleTo = (value: Exact, scale: number) => value.units * 10n ** BigInt(scale - value.scale);

export function compareExact(a: Exact, b: Exact) {
  const scale = Math.max(a.scale, b.scale);
  const x = scaleTo(a, scale), y = scaleTo(b, scale);
  return x === y ? 0 : x > y ? 1 : -1;
}

function toText(units: bigint, scale: number) {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return negative ? `-${text}` : text;
}

/** Analyst input in pt-BR ("1.234,56") or plain decimal ("1234.56") → canonical decimal text. */
export function parseInput(text: string): string | null {
  let value = text.trim().replace(/^R\$\s*/i, '').replace(/%$/, '').replace(/\s/g, '');
  if (value.includes(',')) value = value.replaceAll('.', '').replace(',', '.');
  return DECIMAL.test(value) ? value : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
function dateInput(text: string) {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return br ? `${br[3]}-${br[2]}-${br[1]}` : text.trim();
}

export function isEmpty(value: DataValue | undefined) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** Display text for one cell, in pt-BR, straight from the stored decimal text. */
export function display(kind: DataKind, value: DataValue | undefined): string {
  if (isEmpty(value)) return '';
  switch (kind) {
    case 'money': return money(value as string);
    case 'percent': return percent(value as string, 2, 6);
    case 'decimal': return decimal(value as string, 0, 6);
    case 'number': return decimal(value as string, 2, 4);
    case 'integer': return String(value);
    case 'date': return typeof value === 'string' && ISO.test(value) ? dateBR(value.slice(0, 10)) : String(value);
    case 'boolean': return value === true ? 'Sim' : value === false ? 'Não' : String(value);
    default:
      if (Array.isArray(value)) return value.every(item => typeof item === 'string') ? value.join(', ') : JSON.stringify(value);
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
}

/** Text placed on the clipboard: decimal comma so it pastes as a number in Excel pt-BR. */
export function copyText(kind: DataKind, value: DataValue | undefined): string {
  if (isEmpty(value)) return '';
  if (NUMERIC_KINDS.has(kind) && typeof value !== 'boolean') return String(value).replace('.', ',');
  return display(kind, value);
}

export function matches(kind: DataKind, value: DataValue | undefined, filter: GridFilter): boolean {
  if (filter.op === 'empty') return isEmpty(value);
  if (filter.op === 'filled') return !isEmpty(value);
  const wanted = filter.value ?? '';
  if (filter.op === 'contains') return display(kind, value).toLocaleLowerCase('pt-BR').includes(wanted.trim().toLocaleLowerCase('pt-BR'))
    || String(value ?? '').toLocaleLowerCase('pt-BR').includes(wanted.trim().toLocaleLowerCase('pt-BR'));
  if (isEmpty(value)) return filter.op === 'neq';
  let order: number | null = null;
  if (NUMERIC_KINDS.has(kind)) {
    const a = exact(value), b = exact(parseInput(wanted));
    if (a && b) order = compareExact(a, b);
  } else if (kind === 'boolean') {
    const target = ['sim', 'true', '1'].includes(wanted.trim().toLocaleLowerCase('pt-BR'));
    order = value === target ? 0 : 1;
  } else if (kind === 'date') {
    const a = String(value).slice(0, 10), b = dateInput(wanted);
    order = a === b ? 0 : a > b ? 1 : -1;
  } else {
    const a = display(kind, value).toLocaleLowerCase('pt-BR'), b = wanted.trim().toLocaleLowerCase('pt-BR');
    order = a === b || String(value).toLocaleLowerCase('pt-BR') === b ? 0 : a.localeCompare(b, 'pt-BR');
  }
  if (order === null) return filter.op === 'neq';
  switch (filter.op) {
    case 'eq': return order === 0;
    case 'neq': return order !== 0;
    case 'gt': return order > 0;
    case 'gte': return order >= 0;
    case 'lt': return order < 0;
    case 'lte': return order <= 0;
  }
  return false;
}

export function exceptionIds(table: Pick<StepTable, 'columns' | 'rows'>, rid: Rid): string[] {
  const index = table.columns.findIndex(column => column.name === EXCEPTIONS_COLUMN);
  const value = index < 0 ? null : table.rows[rid]?.[index];
  return Array.isArray(value) ? value.map(String) : [];
}

export interface ViewOptions {
  filters: GridFilter[];
  sort: SortSpec | null;
  onlyExceptions: boolean;
  /** Chat filter: keep only these rows. */
  rids?: Set<Rid> | null;
}

/** Rows of the current view, in display order. Stable sort; empty values always last. */
export function viewRids(table: Pick<StepTable, 'columns' | 'rows'>, options: ViewOptions): Rid[] {
  const index = new Map(table.columns.map((column, i) => [column.name, i]));
  const filters = options.filters.filter(filter => index.has(filter.column));
  const exceptionsAt = index.get(EXCEPTIONS_COLUMN);
  const result: Rid[] = [];
  for (let rid = 0; rid < table.rows.length; rid++) {
    if (options.rids && !options.rids.has(rid)) continue;
    const row = table.rows[rid];
    if (options.onlyExceptions && (exceptionsAt === undefined || isEmpty(row[exceptionsAt]))) continue;
    if (filters.every(filter => { const i = index.get(filter.column)!; return matches(table.columns[i].kind, row[i], filter); })) result.push(rid);
  }
  const sort = options.sort;
  const at = sort ? index.get(sort.column) : undefined;
  if (!sort || at === undefined) return result;
  const kind = table.columns[at].kind, direction = sort.dir === 'asc' ? 1 : -1;
  const keyed = result.map(rid => {
    const value = table.rows[rid][at];
    const key = isEmpty(value) ? null : NUMERIC_KINDS.has(kind) ? exact(value) : kind === 'boolean' ? (value ? 1 : 0) : display(kind, value);
    return { rid, key };
  });
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === b.key ? a.rid - b.rid : a.key === null ? 1 : -1;
    let order: number;
    if (typeof a.key === 'object' && typeof b.key === 'object') order = compareExact(a.key, b.key);
    else if (typeof a.key === 'number' && typeof b.key === 'number') order = a.key - b.key;
    else order = kind === 'date' ? String(table.rows[a.rid][at]).localeCompare(String(table.rows[b.rid][at])) : String(a.key).localeCompare(String(b.key), 'pt-BR', { numeric: true });
    return order * direction || a.rid - b.rid;
  });
  return keyed.map(item => item.rid);
}

/** Excel-like status bar: sum, average and count of the selected cells, exact. */
export function selectionStats(cells: Iterable<{ kind: DataKind; value: DataValue | undefined }>): SelectionStats {
  let total: Exact = { units: 0n, scale: 0 }, filled = 0, numeric = 0, onlyMoney = true;
  for (const { kind, value } of cells) {
    if (isEmpty(value)) continue;
    filled++;
    if (!NUMERIC_KINDS.has(kind) || typeof value === 'boolean') continue;
    const parsed = exact(value);
    if (!parsed) continue;
    numeric++;
    if (kind !== 'money') onlyMoney = false;
    const scale = Math.max(total.scale, parsed.scale);
    total = { units: scaleTo(total, scale) + scaleTo(parsed, scale), scale };
  }
  if (!numeric) return { cells: filled, numeric: 0, money: false };
  const scale = Math.max(total.scale, 2);
  const sum = toText(scaleTo(total, scale), scale);
  // Average rounded ROUND_HALF_UP (away from zero) at the display scale.
  const target = onlyMoney ? 2 : Math.min(scale, 6);
  const numerator = total.units * 10n ** BigInt(target + 1) / (10n ** BigInt(total.scale) * BigInt(numeric));
  const rounded = (numerator < 0n ? numerator - 5n : numerator + 5n) / 10n;
  return { cells: filled, numeric, sum, avg: toText(rounded, target), money: onlyMoney };
}

export function formatStat(value: string | undefined, isMoney: boolean) {
  return value === undefined ? '—' : isMoney ? money(value) : decimal(value, 0, 6);
}

export function describeView(columns: DataColumn[], options: ViewOptions, shown: number) {
  const label = (name: string) => columns.find(column => column.name === name)?.label || name;
  const parts = options.filters.map(filter => `${label(filter.column)} ${OPS[filter.op]}${filter.op === 'empty' || filter.op === 'filled' ? '' : ` “${filter.value}”`}`);
  if (options.onlyExceptions) parts.push('só linhas com exceção');
  if (options.rids) parts.push(`linhas indicadas pelo chat (${count(options.rids.size)})`);
  if (options.sort) parts.push(`ordenado por ${label(options.sort.column)} ${options.sort.dir === 'asc' ? 'crescente' : 'decrescente'}`);
  return `${parts.length ? parts.join('; ') : 'Sem filtros'} · ${count(shown)} linhas`;
}

/** Performance mode: the same rows repeated up to `target`. Synthetic, never exported. */
export function replicate(table: StepTable, target: number): StepTable {
  if (!table.rows.length || target <= table.rows.length) return table;
  const rows = Array.from({ length: target }, (_, index) => table.rows[index % table.rows.length]);
  return { ...table, rows, row_count: rows.length };
}
