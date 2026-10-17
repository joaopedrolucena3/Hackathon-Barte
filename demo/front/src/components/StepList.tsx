// B1 + B4: the agent's steps in order, with live state, metrics and progress.
import type { Status, StepRun } from '../api/agent';
import { count, duration, plural } from '../lib/format';
import { Icon } from './Icon';
import { STATUS } from './ui';

export function StepIcon({ status }: { status: Status }) {
  if (status === 'running') return <span className="step-icon running"><span className="spin" /></span>;
  const symbol: Record<Status, string> = {
    pending: '', running: '', done: 'check', approved: 'check', exceptions: '!', failed: 'x', rejected: 'x', awaiting_approval: 'pause', skipped: '–',
  };
  const value = symbol[status];
  return (
    <span className={`step-icon ${status}`} aria-hidden>
      {value === 'check' ? <Icon name="check" /> : value === 'x' ? <Icon name="x" /> : value === 'pause' ? <Icon name="pause" /> : value}
    </span>
  );
}

export function stepSummary(step: StepRun) {
  const m = step.metrics;
  const parts: string[] = [];
  if (step.kind === 'gate') {
    if (m.exceptions !== undefined) parts.push(plural(m.exceptions, 'exceção', 'exceções'));
    if (m.blocking) parts.push(`${count(m.blocking)} bloqueantes`);
  } else {
    if (step.type === 'ler_arquivos' && typeof m.extra?.files === 'number') parts.push(plural(m.extra.files, 'arquivo', 'arquivos'));
    if (m.rows_out !== undefined) parts.push(plural(m.rows_out, 'linha', 'linhas'));
    if (m.exceptions) parts.push(plural(m.exceptions, 'exceção', 'exceções'));
  }
  if (step.duration_ms !== undefined && step.kind !== 'gate') parts.push(duration(step.duration_ms));
  return parts.join(' · ');
}

export function StepList({ steps, selected, onSelect, onDetails }: {
  steps: StepRun[]; selected?: string; onSelect: (id: string) => void; onDetails?: (id: string) => void;
}) {
  return (
    <ol className="step-list" aria-label="Passos do agente">
      {steps.map((step, index) => {
        const progress = step.metrics.progress;
        return (
          <li key={step.id}>
            <button type="button" className={`step-item ${step.kind} ${step.status} ${selected === step.id ? 'selected' : ''}`}
              onClick={() => onSelect(step.id)} aria-current={selected === step.id ? 'step' : undefined}
              aria-label={`${index + 1}. ${step.title}: ${STATUS[step.status].label}`}>
              <StepIcon status={step.status} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="step-title">{step.title}</span>
                <span className="step-meta">
                  {step.status === 'running' && progress ? `${count(progress.done)} / ${count(progress.total)}`
                    : step.status === 'pending' ? (step.kind === 'gate' ? 'Portão: decisão humana' : 'Pendente')
                      : step.status === 'skipped' ? 'Pulado'
                        : step.status === 'awaiting_approval' ? `Aguardando aprovação · ${stepSummary(step)}`
                          : stepSummary(step) || STATUS[step.status].label}
                </span>
                {step.status === 'running' && progress && (
                  <span className="progress info" style={{ marginTop: 6 }}><span style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></span>
                )}
                {step.status === 'failed' && step.error && (
                  <span className="step-error">{step.error}{onDetails && <span role="link" tabIndex={0} className="link" onClick={event => { event.stopPropagation(); onDetails(step.id); }}> Ver detalhes</span>}</span>
                )}
              </span>
              {step.kind === 'gate' && <Icon name="lock" className="muted" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
