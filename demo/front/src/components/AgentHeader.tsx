// The run as the agent's work: who it is, what it is doing right now, where it stopped and what it needs from you.
import { Link } from 'react-router-dom';
import type { Run, StepRun } from '../api/agent';
import { capitalize, count, dateTimeBR, duration, gerund, periodLong, plural } from '../lib/format';
import { progressOf } from '../state/runEvents';
import { Icon } from './Icon';
import { AgentOrb, BorderBeam, moodOf, TextShimmer } from './motion';
import { Badge, RunId, STATUS, StatusBadge } from './ui';

type Summary = { total: number; decided: number; open_blocking: number } | undefined;

function agentLine(run: Run, summary: Summary): string {
  const failed = run.steps.find(step => step.status === 'failed');
  const current = run.steps.find(step => step.status === 'running');
  if (run.status === 'running' || run.status === 'pending') {
    if (!current) return 'Preparando o próximo passo…';
    const progress = current.metrics.progress;
    return `${gerund(current.title)}…${progress ? ` ${count(progress.done)} de ${count(progress.total)}` : ''}`;
  }
  if (run.status === 'awaiting_approval') {
    if (!summary) return 'O agente terminou os cálculos e parou antes do ERP.';
    const open = summary.total - summary.decided;
    if (!open) return 'Todas as exceções foram decididas. O lote está pronto para sua aprovação.';
    return `O agente terminou os cálculos e parou antes do ERP: ${plural(open, 'exceção aguarda', 'exceções aguardam')} sua revisão${summary.open_blocking ? `, ${count(summary.open_blocking)} bloqueantes` : ''}.`;
  }
  if (run.status === 'failed') return `O agente parou em “${failed?.title || 'um passo'}”${failed?.error ? `: ${failed.error}` : '.'}`;
  if (run.status === 'rejected') return `Lote reprovado por ${run.approval?.actor || 'revisor'}${run.approval?.comment ? `: “${run.approval.comment}”` : '.'}`;
  if (run.status === 'approved') return `Lote aprovado por ${run.approval?.actor || 'revisor'}. Os arquivos do ERP estão na Auditoria.`;
  return run.draft ? 'Teste concluído. Nada foi aprovado nem exportado.' : 'O agente concluiu todos os passos.';
}

/** One segment per step: the whole run at a glance, colored by state, the running one animated. */
export function StepTrack({ run, link }: { run: Run; link?: boolean }) {
  return (
    <ol className="step-track" aria-label="Passos do run">
      {run.steps.map((step: StepRun, index) => {
        const label = `${index + 1}. ${step.title}: ${STATUS[step.status].label}`;
        const segment = <span className={`seg ${step.status} ${step.kind}`} />;
        return (
          <li key={step.id} title={label}>
            {link ? <Link to={`/runs/${run.id}?step=${step.id}`} aria-label={label}>{segment}</Link> : <span aria-label={label}>{segment}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function AgentHeader({ run, summary, elapsed, gateAt }: { run: Run; summary: Summary; elapsed: number; gateAt?: string }) {
  const mood = moodOf(run.status);
  const progress = progressOf(run);
  const line = agentLine(run, summary);
  const processing = run.steps.filter(step => step.kind !== 'gate').reduce((sum, step) => sum + (step.duration_ms || 0), 0);
  const reviewable = ['awaiting_approval', 'approved', 'rejected'].includes(run.status) || (run.draft && run.status === 'done');
  return (
    <section className={`agent-card ${mood}`} aria-live="polite">
      {mood === 'working' && <BorderBeam />}
      <div className="agent-card-top">
        <AgentOrb mood={mood} />
        <div className="grow">
          <p className="eyebrow">Execução do agente{run.draft ? ' · teste' : ''}</p>
          <h1 className="page-title">Fechamento de {periodLong(run.comp)}</h1>
          <p className="agent-line">{mood === 'working' ? <TextShimmer>{line}</TextShimmer> : line}</p>
        </div>
        <div className="agent-card-side">
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            {run.draft && <Badge tone="gate">Teste · não exporta</Badge>}
            <StatusBadge status={run.status} size="lg" />
          </div>
          {run.status === 'awaiting_approval' && !run.draft && <Link className="btn primary" to={`/runs/${run.id}/revisao`}><Icon name="alert" />Revisar exceções</Link>}
          {run.status === 'awaiting_approval' && !run.draft && <Link className="btn" to={`/runs/${run.id}/hipoteses`}><Icon name="origin" />Seguir sugestões do agente</Link>}
          {run.status === 'failed' && <Link className="btn" to={`/competencias/${run.comp}`}><Icon name="refresh" />Rodar de novo</Link>}
          {reviewable && run.status !== 'awaiting_approval' && <Link className="btn" to={`/runs/${run.id}/auditoria`}><Icon name="audit" />Auditoria</Link>}
        </div>
      </div>
      <StepTrack run={run} />
      <div className="agent-meta">
        <span className="num"><strong>{progress.done} de {progress.total}</strong> passos</span>
        <span className="num"><Icon name="clock" size={13} />{run.finished_at || gateAt ? `processamento ${duration(processing)}` : `${duration(elapsed)} decorridos`}</span>
        <span>{capitalize(run.created_by)} · {dateTimeBR(run.created_at)}</span>
        <RunId id={run.id} />
      </div>
    </section>
  );
}
