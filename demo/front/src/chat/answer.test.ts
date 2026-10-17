import { describe, expect, it } from 'vitest';
import type { ChatStatus } from '../api/chat';
import { formatCell as cell, sealLook, selectionKey, selectionLabel as label, suggestionsFor } from './answer';

// Money uses a no-break space after R$ (as Intl does); compare with plain spaces.
const plain = (text: string) => text.replace(/\s/g, ' ');
const formatCell = (...args: Parameters<typeof cell>) => plain(cell(...args));
const selectionLabel = (...args: Parameters<typeof label>) => plain(label(...args));

describe('Chat answer helpers', () => {
  it('formats table cells from the exact decimal text', () => {
    expect(formatCell('4715852.69', 'brl')).toBe('R$ 4.715.852,69');
    expect(formatCell('12345678901234567.89', 'brl')).toBe('R$ 12.345.678.901.234.567,89');
    expect(formatCell('2.590000', 'pct')).toBe('2,59%');
    expect(formatCell('-0.125', 'pp')).toBe('−0,125 p.p.');
    expect(formatCell(1943, 'int')).toBe('1.943');
    expect(formatCell('0.500000', 'num')).toBe('0,5');
    expect(formatCell('2026-09-30', 'data')).toBe('30/09/2026');
    expect(formatCell(null, 'brl')).toBe('—');
    expect(formatCell(true, 'texto')).toBe('sim');
  });

  it('suggests the focused column first, then the step, without repeats', () => {
    const status = { sugestoes: { por_passo: { conferir_mdr: ['A', 'B', 'C'] }, por_coluna: { impacto_rs: ['B', 'D'] } } } as unknown as ChatStatus;
    expect(suggestionsFor(status, 'conferir_mdr', 'impacto_rs')).toEqual(['B', 'D', 'A', 'C']);
    expect(suggestionsFor(status, 'conferir_mdr', undefined, 2)).toEqual(['A', 'B']);
    expect(suggestionsFor(undefined, 'conferir_mdr')).toEqual([]);
  });

  it('describes the selection the question will carry', () => {
    const selection = { dataset: 'mdr_conferido', columns: ['gross', 'net', 'brand'], rids: [1, 2, 3], stats: { cells: 9, numeric: 6, sum: '12.30', money: true } };
    expect(selectionLabel(selection, new Map([['gross', 'Bruto'], ['net', 'Líquido']]))).toBe('9 células em Bruto, Líquido e mais 1 · soma R$ 12,30');
    expect(selectionKey(selection)).toBe('mdr_conferido|gross,net,brand|3|1|3');
  });

  it('labels the seal by its status', () => {
    expect(sealLook({ status: 'ok', checks: [], resumo: '' })).toEqual({ tone: 'good', label: 'Conferido' });
    expect(sealLook({ status: 'falhou', checks: [], resumo: '' }).tone).toBe('bad');
    expect(sealLook({ status: 'sem_verificacao', checks: [], resumo: '' }).label).toBe('Sem verificação cruzada');
  });
});
