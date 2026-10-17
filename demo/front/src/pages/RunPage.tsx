// /runs/:runId — the agent's header (live line, step track, next action), tabs Passos · Revisão · Auditoria and seal.
import { lazy, Suspense } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { AgentHeader } from '../components/AgentHeader';
import { Icon } from '../components/Icon';
import { TopbarSlot } from '../components/TopbarSlot';
import { Empty, Loading, RunId } from '../components/ui';
import { periodShort, plural } from '../lib/format';
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
  const reviewable = !!run && (['awaiting_approval', 'approved', 'rejected'].includes(run.status) || (run.draft && run.status === 'done'));
  const { data: summary } = useApprovalSummary(runId, reviewable);

  if (isLoading) return <Loading page label="Carregando o run…" />;
  if (error || !run) return <Empty icon="alert" title="Run não encontrado">{error?.message} <Link className="link" to="/">Voltar ao fechamento</Link></Empty>;
  const open = summary ? summary.total - summary.decided : 0;

  return (
    <>
      <TopbarSlot>
        <Link to={`/competencias/${run.comp}`} className="row link-plain" style={{ gap: 6 }}><Icon name="arrowLeft" />Fechamento {periodShort(run.comp)}</Link>
        <span className="muted">/</span>
        <RunId id={run.id} />
      </TopbarSlot>

      <AgentHeader run={run} summary={summary} elapsed={elapsed} gateAt={gateAt} />

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
