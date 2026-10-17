// Pure helpers for the chat dock: cell text by the server's style, the seal's look, suggestion chips.
import type { DataValue } from '../api/agent';
import type { ChatStatus, ChatStyle, Seal } from '../api/chat';
import { count, dateBR, decimal, money, percent, plural, pp } from '../lib/format';
import type { SelectionContext } from '../workbench/contract';
import { formatStat } from '../workbench/table';

/** Table cell text, from the exact decimal text the query returned. */
export function formatCell(value: DataValue | undefined, style: ChatStyle): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'object') return JSON.stringify(value);
  switch (style) {
    case 'brl': return money(value);
    case 'pct': return percent(value, 2, 4);
    case 'pp': return pp(value);
    case 'int': return count(value);
    case 'num': return decimal(value, 0, 6);
    case 'data': return dateBR(String(value).slice(0, 10));
    default: return String(value);
  }
}

export const NUMERIC_STYLES = new Set<ChatStyle>(['brl', 'pct', 'pp', 'int', 'num']);

export function sealLook(seal: Seal): { tone: 'good' | 'bad' | 'neutral'; label: string } {
  if (seal.status === 'ok') return { tone: 'good', label: 'Conferido' };
  if (seal.status === 'falhou') return { tone: 'bad', label: 'Não confere' };
  if (seal.status === 'incompleto') return { tone: 'neutral', label: 'Verificação incompleta' };
  return { tone: 'neutral', label: 'Sem verificação cruzada' };
}

/** Column suggestions first (the column in focus), then the step's; at most `limit`, no repeats. */
export function suggestionsFor(status: ChatStatus | undefined, stepType: string, column?: string, limit = 4): string[] {
  if (!status) return [];
  const list = [...(column ? status.sugestoes.por_coluna[column] || [] : []), ...(status.sugestoes.por_passo[stepType] || [])];
  return [...new Set(list)].slice(0, limit);
}

export function selectionLabel(selection: SelectionContext, labels: Map<string, string>) {
  const columns = selection.columns.map(name => labels.get(name) || name);
  const where = columns.length > 2 ? `${columns.slice(0, 2).join(', ')} e mais ${columns.length - 2}` : columns.join(', ');
  const sum = selection.stats.sum !== undefined ? ` · soma ${formatStat(selection.stats.sum, selection.stats.money)}` : '';
  return `${plural(selection.stats.cells, 'célula', 'células')} em ${where}${sum}`;
}

/** Same selection, same identity: used to remember that the analyst detached it from the next question. */
export function selectionKey(selection: SelectionContext) {
  return `${selection.dataset}|${selection.columns.join(',')}|${selection.rids.length}|${selection.rids[0]}|${selection.rids[selection.rids.length - 1]}`;
}

export function usd(value: string | undefined) {
  return value ? `US$ ${decimal(value, 2, 4)}` : '';
}
