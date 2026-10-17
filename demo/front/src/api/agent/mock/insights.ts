// Aggregates for the visual summary. Stands in for a backend GET /api/insights: the UI never sums money.
import { absUnits, cents, fromCents } from '../../../lib/decimal';
import { readable } from '../../../lib/format';
import type { Insights } from '../contract';
import { merchantName, type DataIndex } from './data';

type Acc = { count: number; total: bigint };
const acc = (): Acc => ({ count: 0, total: 0n });

export function emptyInsights(comp: string): Insights {
  return {
    comp,
    pendencias: { open_brl: '0.00', resolved_brl: '0.00', open_count: 0, resolved_count: 0, by_state: [], by_type: [] },
    divergencias_por_lojista: [], bancos: [], contas: [],
    notas: { total_brl: '0.00', count: 0, by_line: [] },
  };
}

export function buildInsights(index: DataIndex): Insights {
  const { state } = index;
  const r = state.results;

  const states = { bloqueante: acc(), alerta: acc(), resolvido: acc() };
  const types = new Map<string, Acc & { open: number; blocking: boolean }>();
  for (const p of r.pendencias) {
    const value = absUnits(cents(p.valor_brl));
    const bucket = p.status === 'resolved' ? states.resolvido : p.severity === 'bloqueante' ? states.bloqueante : states.alerta;
    bucket.count += 1; bucket.total += value;
    const type = types.get(p.tipo) || { ...acc(), open: 0, blocking: false };
    type.count += 1;
    if (p.status !== 'resolved') { type.open += 1; type.total += value; }
    type.blocking ||= p.severity === 'bloqueante';
    types.set(p.tipo, type);
  }

  const divergences = new Map<string, { count: number; signed: bigint; abs: bigint }>();
  for (const row of r.divergencias) {
    const item = divergences.get(row.cnpj) || { count: 0, signed: 0n, abs: 0n };
    const value = cents(row.diferenca_brl);
    item.count += 1; item.signed += value; item.abs += absUnits(value);
    divergences.set(row.cnpj, item);
  }
  const names = new Map(r.divergencias.map(row => [row.cnpj, row.lojista]));

  const banks = new Map<string, { account: string; count: number; inflow: bigint; outflow: bigint; daily: Map<string, { inflow: bigint; outflow: bigint }> }>();
  const accounts = new Map<string, { name: string; count: number; abs: bigint; inflow: bigint; outflow: bigint }>();
  for (const line of r.lancamentos) {
    const value = cents(line.valor);
    const bank = banks.get(line.banco) || { account: line.conta_bancaria || '', count: 0, inflow: 0n, outflow: 0n, daily: new Map() };
    const day = bank.daily.get(line.data) || { inflow: 0n, outflow: 0n };
    bank.count += 1;
    if (value >= 0n) { bank.inflow += value; day.inflow += value; } else { bank.outflow -= value; day.outflow -= value; }
    bank.daily.set(line.data, day);
    banks.set(line.banco, bank);
    const account = accounts.get(line.conta_codigo) || { name: line.conta_descricao || line.conta_codigo, count: 0, abs: 0n, inflow: 0n, outflow: 0n };
    account.count += 1; account.abs += absUnits(value);
    if (value >= 0n) account.inflow += value; else account.outflow -= value;
    accounts.set(line.conta_codigo, account);
  }

  const lines = new Map<string, Acc>();
  let notesTotal = 0n;
  for (const nota of r.notas) {
    const line = lines.get(nota.linha_negocio) || acc();
    line.count += 1; line.total += cents(nota.valor_brl);
    lines.set(nota.linha_negocio, line);
    notesTotal += cents(nota.valor_brl);
  }

  const open = states.bloqueante.total + states.alerta.total;
  return {
    comp: state.period,
    pendencias: {
      open_brl: fromCents(open),
      resolved_brl: fromCents(states.resolvido.total),
      open_count: states.bloqueante.count + states.alerta.count,
      resolved_count: states.resolvido.count,
      by_state: [
        { key: 'bloqueante', label: 'Bloqueantes abertas', count: states.bloqueante.count, brl: fromCents(states.bloqueante.total) },
        { key: 'alerta', label: 'Alertas abertos', count: states.alerta.count, brl: fromCents(states.alerta.total) },
        { key: 'resolvido', label: 'Decididas', count: states.resolvido.count, brl: fromCents(states.resolvido.total) },
      ],
      by_type: [...types].map(([key, value]) => ({
        key, label: readable(key), count: value.count, open_count: value.open, brl: fromCents(value.total),
        severity: value.blocking ? 'bloqueante' as const : 'alerta' as const,
      })).sort((a, b) => Number(cents(b.brl) - cents(a.brl)) || b.open_count - a.open_count),
    },
    divergencias_por_lojista: [...divergences].map(([cnpj, value]) => ({
      cnpj, lojista: names.get(cnpj) || merchantName(index, cnpj), count: value.count,
      signed_brl: fromCents(value.signed), abs_brl: fromCents(value.abs),
    })).sort((a, b) => Number(cents(b.abs_brl) - cents(a.abs_brl))),
    bancos: [...banks].map(([bank, value]) => ({
      bank, account: value.account, count: value.count,
      in_brl: fromCents(value.inflow), out_brl: fromCents(value.outflow), net_brl: fromCents(value.inflow - value.outflow),
      daily: [...value.daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({
        date, in_brl: fromCents(day.inflow), out_brl: fromCents(day.outflow),
      })),
    })).sort((a, b) => a.bank.localeCompare(b.bank)),
    contas: [...accounts].map(([code, value]) => ({
      code, name: value.name, count: value.count, abs_brl: fromCents(value.abs),
      in_brl: fromCents(value.inflow), out_brl: fromCents(value.outflow),
    })).sort((a, b) => Number(cents(b.abs_brl) - cents(a.abs_brl))),
    notas: {
      total_brl: fromCents(notesTotal), count: r.notas.length,
      by_line: [...lines].map(([line, value]) => ({ line, count: value.count, brl: fromCents(value.total) })),
    },
  };
}
