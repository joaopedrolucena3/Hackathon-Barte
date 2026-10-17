// Human review (B5): backend pendencies become run exceptions; decisions go to the real /api/decisions.
import { ensureActor } from '../../../lib/actor';
import { absUnits, cents, fromCents, toUnits } from '../../../lib/decimal';
import { money } from '../../../lib/format';
import { core } from '../../core';
import { ApiError } from '../../http';
import type { Pendencia } from '../../types';
import type { ApprovalSummary, ReviewDecision, ReviewException, Run } from '../contract';
import { stepTitle } from './catalog';
import { indexState, loadState, merchantName, refreshState, type DataIndex } from './data';
import { fenixEntries, severityOf } from './outputs';
import { loadAdjustments, saveAdjustment, type AdjustmentNote } from './store';

export const EXCLUDE_TAG = '[Excluído do lote]';
const OUTPUT_STATUSES = ['done', 'exceptions'];

function tolerance(run: Run) {
  const value = Number(run.steps.find(step => step.type === 'conferir_mdr')?.params.tolerancia_pp ?? 0);
  return Number.isFinite(value) && value > 0 ? toUnits(value.toFixed(6), 6) : 0n;
}

/** Pendencies raised by the steps this run executed, honoring the run's parameters. */
export function activePendencias(index: DataIndex, run: Run, onlyFinished = false): Pendencia[] {
  const steps = new Set(run.steps.filter(step => !onlyFinished || OUTPUT_STATUSES.includes(step.status)).map(step => step.type));
  const limit = tolerance(run);
  return index.state.results.pendencias.filter(p => {
    const step = index.stepOfPendencia.get(p.id_saida) || '';
    if (!steps.has(step)) return false;
    if (limit && step === 'conferir_mdr' && p.tipo === 'DIVERGENCIA_TAXA') {
      const divergence = index.divergenceById.get(p.divergence_id || '');
      if (divergence) {
        const diff = toUnits(divergence.taxa_aplicada_pct, 6) - toUnits(divergence.taxa_contratada_pct, 6);
        if (absUnits(diff) <= limit) return false;
      }
    }
    return true;
  });
}

function decisionOf(p: Pendencia, adjustment?: AdjustmentNote): ReviewDecision | null {
  const d = p.decision;
  if (!d || d.action === 'reject' || p.status !== 'resolved') return null;
  const base = { actor: d.actor, at: d.at, before_amount: adjustment?.before, before_account: adjustment?.before_account };
  if (d.action === 'confirm') return { ...base, action: 'accept', note: d.note };
  if (d.note.startsWith(EXCLUDE_TAG)) return { ...base, action: 'exclude', note: d.note.slice(EXCLUDE_TAG.length).trim() };
  return { ...base, action: 'adjust', note: d.note, account_code: d.account_code || undefined, amount: adjustment?.amount };
}

export function toException(p: Pendencia, index: DataIndex, adjustments = loadAdjustments()): ReviewException {
  const step = index.stepOfPendencia.get(p.id_saida) || 'comissao_checkout';
  const orbe = index.orbeById.get(p.ref_origem);
  const remittance = index.remittanceById.get(p.ref_origem);
  const bank = index.bankByRef.get(p.ref_origem);
  const line = index.lancamentoByRef.get(p.ref_origem);
  const isBank = step === 'classificar_bancos' && !!line;
  return {
    id: p.id_saida,
    step_type: step,
    step_title: stepTitle(step),
    kind: p.tipo,
    title: p.tipo,
    severity: severityOf(p),
    original_severity: p.severity,
    merchant: p.cnpj ? merchantName(index, p.cnpj, orbe?.name || remittance?.name) : orbe?.name || remittance?.name || (bank ? `Banco ${bank.bank}` : '—'),
    cnpj: p.cnpj,
    date: orbe?.date || remittance?.contracted_date || bank?.date,
    amount: orbe?.gross || remittance?.gross_brl || bank?.amount || undefined,
    impact_brl: p.valor_brl,
    description: p.motivo,
    suggestion: p.suggestion,
    rule: p.rule,
    who_decides: p.quem_decide,
    ref_origem: p.ref_origem,
    evidence: p.evidence || [],
    bank_line_id: isBank ? line!.id_saida : undefined,
    current_account: isBank ? line!.conta_codigo : undefined,
    decision: decisionOf(p, adjustments[p.id_saida]),
  };
}

export async function listExceptions(run: Run): Promise<ReviewException[]> {
  const index = indexState(await loadState());
  const adjustments = loadAdjustments();
  return activePendencias(index, run, true).map(p => toException(p, index, adjustments));
}

export async function excludedRefs(run: Run) {
  const list = await listExceptions(run);
  return new Set(list.filter(item => item.decision?.action === 'exclude' && item.bank_line_id).map(item => item.ref_origem));
}

export async function approvalSummary(run: Run): Promise<ApprovalSummary> {
  const index = indexState(await loadState());
  const list = await listExceptions(run);
  const excluded = new Set(list.filter(item => item.decision?.action === 'exclude' && item.bank_line_id).map(item => item.ref_origem));
  const entries = fenixEntries(index, excluded);
  const total = entries.reduce((sum, entry) => sum + cents(entry.valor), 0n);
  const blocking = list.filter(item => item.severity === 'bloqueante');
  const open = list.filter(item => !item.decision);
  return {
    total: list.length,
    blocking: blocking.length,
    alerts: list.length - blocking.length,
    decided: list.length - open.length,
    open_blocking: open.filter(item => item.severity === 'bloqueante').length,
    open_alerts: open.filter(item => item.severity === 'alerta').length,
    impact_brl: fromCents(list.reduce((sum, item) => sum + absUnits(cents(item.impact_brl)), 0n)),
    open_impact_brl: fromCents(open.reduce((sum, item) => sum + absUnits(cents(item.impact_brl)), 0n)),
    // Each Fênix entry debits and credits the same amount, so the batch balances by construction.
    batch: { entries: entries.length, excluded: excluded.size, debit_brl: fromCents(total), credit_brl: fromCents(total), balanced: true },
  };
}

export async function decide(
  run: Run, exceptionId: string, input: { action: ReviewDecision['action']; note: string; account_code?: string; amount?: string },
): Promise<ReviewException> {
  await ensureActor();
  if (run.status !== 'awaiting_approval') throw new ApiError('A revisão só aceita decisões enquanto o run aguarda aprovação.', 409);
  const current = (await listExceptions(run)).find(item => item.id === exceptionId);
  if (!current) throw new ApiError('Exceção não encontrada neste run.', 404);
  const note = input.note.trim();
  if (input.action !== 'accept' && !note) throw new ApiError('A justificativa é obrigatória para ajustar ou excluir do lote.', 400);
  if (input.action === 'adjust' && !input.account_code && !input.amount) {
    throw new ApiError('Informe a nova conta ou o valor ajustado.', 400);
  }
  if (input.amount) cents(input.amount);

  let text = note || `Aceito na revisão do ${run.id}.`;
  if (input.action === 'adjust' && input.amount) text = `${text} Valor proposto: ${money(input.amount)} (antes ${money(current.impact_brl)}).`;
  if (input.action === 'exclude') text = `${EXCLUDE_TAG} ${text}`;
  await core.decide({
    id: exceptionId,
    action: input.action === 'accept' ? 'confirm' : 'adjust',
    note: text,
    ...(input.action === 'adjust' && input.account_code ? { account_code: input.account_code } : {}),
  });
  saveAdjustment(exceptionId, input.action === 'adjust'
    ? { amount: input.amount || '', before: current.impact_brl, before_account: current.current_account, at: new Date().toISOString() }
    : null);
  const index = indexState(await refreshState());
  const updated = index.state.results.pendencias.find(p => p.id_saida === exceptionId);
  if (!updated) throw new ApiError('A exceção mudou depois do recálculo. Recarregue a revisão.', 409);
  return toException(updated, index);
}
