// /runs/:runId — header with live progress, tabs Passos · Revisão · Auditoria, approval banner and seal.
import { lazy, Suspense } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { TopbarSlot } from '../components/TopbarSlot';
import { Badge, Callout, Empty, Loading, StatusBadge } from '../components/ui';
import { capitalize, dateTimeBR, duration, periodLong, periodShort, plural } from '../lib/format';
import { progressOf } from '../state/runEvents';
import { useApprovalSummary, useElapsed, useRun, useRunEvents } from '../state/queries';
import { StepsTab } from './run/StepsTab';

const ReviewTab = lazy(() => import('./run/ReviewTab'));
const AuditTab = lazy(() => import('./run/AuditTab'));

export default function RunPage({ tab }: { tab: 'passos' | 'revisao' | 'auditoria' }) {
  const { runId = '' } = useParams();
  const { data: run, error, isLoading } = useRun(runId);
  useRunEvents(runId);
  // Agent time stops at the approval gate; waiting for a human is not processing time.
  const gateAt = run?.status === 'awaiting_approval' ? run.steps.find(step => step.kind === 'gate')?.started_at : undefined;
  const elapsed = useElapsed(run?.created_at, run?.finished_at || gateAt);
  const reviewable = !!run && ['awaiting_approval', 'approved', 'rejected'].includes(run.status);
  const { data: summary } = useApprovalSummary(runId, reviewable);

  if (isLoading) return <Loading page label="Carregando o run…" />;
  if (error || !run) return <Empty icon="alert" title="Run não encontrado">{error?.message} <Link className="link" to="/">Voltar ao fechamento</Link></Empty>;
  const progress = progressOf(run);
  const open = summary ? summary.total - summary.decided : 0;

  return (
    <>
      <TopbarSlot>
        <Link to={`/competencias/${run.comp}`} className="row link-plain" style={{ gap: 6 }}><Icon name="arrowLeft" />Fechamento {periodShort(run.comp)}</Link>
        <span className="muted">/</span>
        <strong className="mono">{run.id}</strong>
      </TopbarSlot>

      <div className="run-head">
        <div className="row between wrap" style={{ gap: 12 }}>
          <div>
            <p className="eyebrow">Execução do agente{run.draft ? ' · teste' : ''}</p>
            <h1 className="page-title row" style={{ gap: 12 }}>Run <span className="mono" style={{ fontSize: 22 }}>{run.id}</span> · {capitalize(periodLong(run.comp))}</h1>
          </div>
          <div className="row wrap">
            {run.draft && <Badge tone="gate">Rascunho de teste · não exporta</Badge>}
            <StatusBadge status={run.status} size="lg" />
          </div>
        </div>
        <div className="run-progress">
          <div className="progress" style={{ height: 8 }}><span style={{ width: `${progress.ratio * 100}%`, background: run.status === 'failed' || run.status === 'rejected' ? 'var(--st-critical)' : undefined }} /></div>
          <div className="row wrap muted" style={{ gap: 16, fontSize: 12.5, marginTop: 8 }}>
            <span className="num"><strong className="text-2">{progress.done} de {progress.total}</strong> passos concluídos</span>
            <span className="num"><Icon name="clock" size={13} /> {run.finished_at || gateAt ? `processamento ${duration(run.steps.filter(step => step.kind !== 'gate').reduce((sum, step) => sum + (step.duration_ms || 0), 0))}` : `${duration(elapsed)} decorridos`}</span>
            <span>Iniciado por {run.created_by} · {dateTimeBR(run.created_at)}</span>
          </div>
        </div>
      </div>

      {run.status === 'awaiting_approval' && tab !== 'revisao' && (
        <div className="banner" role="status">
          <Icon name="pause" />
          <p><strong>O agente terminou.</strong> {summary ? `${plural(open, 'exceção aguarda', 'exceções aguardam')} sua revisão${summary.open_blocking ? `, ${summary.open_blocking} bloqueantes` : ''}.` : 'As exceções aguardam sua revisão.'}</p>
          <Link className="btn primary" to={`/runs/${run.id}/revisao`}>Revisar</Link>
        </div>
      )}
      {run.status === 'failed' && <div style={{ marginBottom: 14 }}><Callout tone="critical" icon="alert"><strong>O run falhou.</strong> {run.steps.find(step => step.status === 'failed')?.error} <Link className="link" to={`/competencias/${run.comp}`}>Voltar e rodar de novo</Link></Callout></div>}

      <nav className="tabs" aria-label="Seções do run">
        <NavLink end to={`/runs/${run.id}`} className={() => `tab ${tab === 'passos' ? 'active' : ''}`}><Icon name="run" />Passos</NavLink>
        <NavLink to={`/runs/${run.id}/revisao`} className={() => `tab ${tab === 'revisao' ? 'active' : ''}`}><Icon name="alert" />Revisão{reviewable && summary && <span className="count">{open}</span>}</NavLink>
        <NavLink to={`/runs/${run.id}/auditoria`} className={() => `tab ${tab === 'auditoria' ? 'active' : ''}`}><Icon name="audit" />Auditoria</NavLink>
      </nav>

      {tab === 'passos' && <StepsTab run={run} />}
      <Suspense fallback={<Loading />}>
        {tab === 'revisao' && <ReviewTab run={run} />}
        {tab === 'auditoria' && <AuditTab run={run} />}
      </Suspense>

      <p className="run-seal mono">Pipeline {run.pipeline.name} v{run.pipeline.version} · código {run.code_version} · {plural(run.files.filter(file => !file.name.includes('::')).length, 'arquivo', 'arquivos')}</p>
    </>
  );
}
