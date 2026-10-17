// Audit trail of a run (B6) and run comparison by output hash.
import { money } from '../../../lib/format';
import type { AuditEntry, AuditTrail, ReviewException, Run, RunComparison } from '../contract';
import { loadState } from './data';
import { listExceptions } from './review';

const actionLabel: Record<string, string> = { accept: 'Aceita', adjust: 'Ajustada', exclude: 'Excluída do lote', reject: 'Rejeitada' };

function decisionAfter(item: ReviewException) {
  const d = item.decision!;
  const parts = [actionLabel[d.action]];
  if (d.account_code) parts.push(`conta ${d.account_code}`);
  if (d.amount) parts.push(money(d.amount));
  return parts.join(' · ');
}

function decisionBefore(item: ReviewException) {
  const parts = ['Aberta'];
  if (item.decision?.before_account || item.current_account) parts.push(`conta ${item.decision?.before_account || item.current_account}`);
  parts.push(money(item.decision?.before_amount || item.impact_brl));
  return parts.join(' · ');
}

export async function buildAudit(run: Run): Promise<AuditTrail> {
  const state = await loadState();
  const exceptions = await listExceptions(run);
  const known = new Set(exceptions.map(item => item.id));
  const entries: AuditEntry[] = [];
  for (const file of run.files) entries.push({ kind: 'input_file', at: run.created_at, file });
  entries.push({ kind: 'pipeline', at: run.created_at, pipeline: run.pipeline, code_version: run.code_version, actor: run.created_by });
  for (const step of run.steps) if (step.started_at) entries.push({ kind: 'step', at: step.started_at, step });

  // Reject decisions are history only: they keep the item open.
  for (const row of state.audit) {
    if (row.action !== 'decision' || row.at < run.created_at) continue;
    const id = String(row.detail.id || '');
    if (!known.has(id) || row.detail.action !== 'reject') continue;
    entries.push({ kind: 'decision', at: row.at, actor: row.actor, exception_id: id, title: exceptions.find(item => item.id === id)!.kind,
      action: 'reject', before: 'Aberta', after: 'Rejeitada · continua aberta', note: String(row.detail.note || '') });
  }
  for (const item of exceptions) {
    if (!item.decision) continue;
    // Decisions survive recalculation while the evidence is unchanged; they are carried into this run.
    const carried = item.decision.at < run.created_at;
    entries.push({ kind: 'decision', at: carried ? run.created_at : item.decision.at, actor: item.decision.actor, exception_id: item.id,
      title: item.kind, action: item.decision.action, before: decisionBefore(item),
      after: carried ? `${decisionAfter(item)} · mantida de revisão anterior` : decisionAfter(item), note: item.decision.note });
  }
  if (run.approval) entries.push({ kind: 'approval', at: run.approval.at, approval: run.approval });
  const exportedAt = run.steps.find(step => step.kind === 'export')?.finished_at;
  for (const file of run.exports || []) entries.push({ kind: 'export', at: exportedAt || run.finished_at || run.created_at, file });

  entries.sort((a, b) => a.at.localeCompare(b.at));
  const { steps: _steps, files: _files, exports: _exports, approval: _approval, ...ref } = run;
  return { run: ref, entries };
}

export function compare(a: Run, b: Run): RunComparison {
  const order = [...a.steps, ...b.steps.filter(step => !a.steps.some(other => other.type === step.type))];
  const steps = order.filter(step => step.kind !== 'gate').map(step => {
    const hashA = a.steps.find(item => item.type === step.type)?.output_hash;
    const hashB = b.steps.find(item => item.type === step.type)?.output_hash;
    return { type: step.type, title: step.title, hash_a: hashA, hash_b: hashB, match: !!hashA && hashA === hashB };
  });
  const strip = ({ steps: _s, files: _f, exports: _e, approval: _a, ...ref }: Run) => ref;
  const compared = steps.filter(step => step.hash_a && step.hash_b);
  return { a: strip(a), b: strip(b), steps, reproducible: compared.length > 0 && compared.every(step => step.match) };
}
