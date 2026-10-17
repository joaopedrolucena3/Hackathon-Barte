// B1 + B4: the agent's plan — steps in order on a rail, with live state, metrics and progress.
import { motion, useReducedMotion } from 'motion/react';
import type { Status, StepRun } from '../api/agent';
import { count, duration, plural } from '../lib/format';
import { Icon } from './Icon';
import { TextShimmer } from './motion';
import { STATUS } from './ui';

export function StepIcon({ status }: { status: Status }) {
  const reduce = useReducedMotion();
  if (status === 'running') return <span className="step-icon running"><span className="spin" /></span>;
  const symbol: Record<Status, string> = {
    pending: '', running: '', done: 'check', approved: 'check', exceptions: '!', failed: 'x', rejected: 'x', awaiting_approval: 'pause', skipped: '–',
  };
  const value = symbol[status];
  // Keyed by status so a step that finishes "pops" its new state instead of swapping colors silently.
  return (
    <motion.span key={status} className={`step-icon ${status}`} aria-hidden
      initial={reduce || status === 'pending' ? false : { scale: .5, opacity: .4 }} animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}>
      {value === 'check' ? <Icon name="check" /> : value === 'x' ? <Icon name="x" /> : value === 'pause' ? <Icon name="pause" /> : value}
    </motion.span>
  );
}

/** Volume line under the title; duration lives on the title row so this never wraps into a third line. */
export function stepSummary(step: StepRun) {
  const m = step.metrics;
  const parts: string[] = [];
  if (step.kind === 'gate') {
    if (m.exceptions !== undefined) parts.push(plural(m.exceptions, 'exceção', 'exceções'));
  } else {
    if (step.type === 'ler_arquivos' && typeof m.extra?.files === 'number') parts.push(plural(m.extra.files, 'arquivo', 'arquivos'));
    if (m.rows_out !== undefined) parts.push(plural(m.rows_out, 'linha', 'linhas'));
  }
  return parts.join(' · ');
}

function StepMeta({ step }: { step: StepRun }) {
  const progress = step.metrics.progress;
  if (step.status === 'running') return <>{progress ? `${count(progress.done)} de ${count(progress.total)} linhas` : 'Em andamento'}</>;
  if (step.status === 'pending') return <>{step.kind === 'gate' ? 'Portão: decisão humana' : 'Na fila'}</>;
  if (step.status === 'skipped') return <>Pulado</>;
  const summary = stepSummary(step);
  const exceptions = step.kind === 'gate' ? step.metrics.blocking : step.metrics.exceptions;
  return (
    <>
      {summary || STATUS[step.status].label}
      {!!exceptions && <span className={`step-flag ${step.kind === 'gate' ? 'critical' : 'warning'}`}>{count(exceptions)}{step.kind === 'gate' ? ' bloq.' : ' exc.'}</span>}
    </>
  );
}

export function StepList({ steps, selected, onSelect, onDetails }: {
  steps: StepRun[]; selected?: string; onSelect: (id: string) => void; onDetails?: (id: string) => void;
}) {
  return (
    <ol className="step-list plan" aria-label="Plano do agente">
      {steps.map((step, index) => {
        const progress = step.metrics.progress;
        const finished = ['done', 'exceptions', 'approved'].includes(step.status);
        return (
          <li key={step.id} className={`plan-item ${finished ? 'finished' : ''} ${step.status}`}>
            <button type="button" className={`step-item ${step.kind} ${step.status} ${selected === step.id ? 'selected' : ''}`}
              onClick={() => onSelect(step.id)} aria-current={selected === step.id ? 'step' : undefined}
              aria-label={`${index + 1}. ${step.title}: ${STATUS[step.status].label}`}>
              <StepIcon status={step.status} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="step-head">
                  {step.status === 'running' ? <TextShimmer className="step-title">{step.title}</TextShimmer> : <span className="step-title" title={step.title}>{step.title}</span>}
                  {step.duration_ms !== undefined && step.kind !== 'gate' && step.status !== 'running' && <span className="step-time">{duration(step.duration_ms)}</span>}
                  {step.kind === 'gate' && <Icon name="lock" className="muted" size={13} />}
                </span>
                <span className="step-meta"><StepMeta step={step} /></span>
                {step.status === 'running' && progress && (
                  <span className="progress info live" style={{ marginTop: 6 }}><span style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></span>
                )}
                {step.status === 'failed' && step.error && (
                  <span className="step-error">{step.error}{onDetails && <span role="link" tabIndex={0} className="link" onClick={event => { event.stopPropagation(); onDetails(step.id); }}> Ver detalhes</span>}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
