// /runs/:runId — the agent's header (live line, step track, next action), tabs Passos · Revisão · Auditoria and seal.
import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, useParams, useNavigate } from 'react-router-dom';
import { scopedUrl } from '../lib/scope';
import { RunLauncher } from '../components/RunLauncher';
import { AgentHeader } from '../components/AgentHeader';
import { Icon } from '../components/Icon';
import { TopbarSlot } from '../components/TopbarSlot';
import { Empty, Loading, RunId } from '../components/ui';
import { periodShort, plural } from '../lib/format';
import { useApprovalSummary, useElapsed, useRun, useRunEvents, useRuns } from '../state/queries';
import { StepsTab } from './run/StepsTab';

const ReviewTab = lazy(() => import('./run/ReviewTab'));
const AuditTab = lazy(() => import('./run/AuditTab'));
const RecommendationsTab = lazy(() => import('./run/RecommendationsTab'));

export default function RunPage({ tab }: { tab: 'passos' | 'revisao' | 'hipoteses' | 'auditoria' }) {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const [complement, setComplement] = useState(false);
  const { data: run, error, isLoading } = useRun(runId);
  useRunEvents(runId);
  const { data: versions } = useRuns(run?.comp);
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
        <Link to={scopedUrl(`/competencias/${run.comp}`, { run_id: run.id })} className="row link-plain" style={{ gap: 6 }}><Icon name="arrowLeft" />Fechamento {periodShort(run.comp)}</Link>
        <span className="muted">/</span>
        <RunId id={run.id} />
        <select className="select sm" style={{ maxWidth: 260 }} aria-label="Versão da execução" value={run.id} onChange={event => { setComplement(false); navigate(`/runs/${event.target.value}${tab === 'passos' ? '' : `/${tab}`}`); }}>{(versions || [run]).filter(item => item.comp === run.comp).map(item => <option key={item.id} value={item.id}>{item.id.slice(0, 13)} · {item.created_at.slice(0, 16).replace('T', ' ')}{item.draft ? ' · teste' : ''}</option>)}</select>
      </TopbarSlot>

      {!run.draft && <div className="row between wrap" style={{ marginBottom: 12 }}><p className="help">{run.parent_run_id ? <>Versão sucessora de <Link className="link" to={`/runs/${run.parent_run_id}`}>{run.parent_run_id.slice(0, 13)}</Link>. Revisão e aprovação independentes.</> : 'Esta execução mantém os arquivos, contratos e resultados capturados na sua criação.'}</p><button className="btn sm" onClick={() => setComplement(true)}><Icon name="plus" />Adicionar complemento</button></div>}
      <AgentHeader run={run} summary={summary} elapsed={elapsed} gateAt={gateAt} />

      <nav className="tabs" aria-label="Seções do run">
        <NavLink end to={`/runs/${run.id}`} className={() => `tab ${tab === 'passos' ? 'active' : ''}`}><Icon name="run" />Passos</NavLink>
        <NavLink to={`/runs/${run.id}/revisao`} className={() => `tab ${tab === 'revisao' ? 'active' : ''}`}><Icon name="alert" />Revisão{reviewable && summary && <span className="count">{open}</span>}</NavLink>
        <NavLink to={`/runs/${run.id}/hipoteses`} className={() => `tab ${tab === 'hipoteses' ? 'active' : ''}`}><Icon name="origin" />Hipóteses e sugestões</NavLink>
        <NavLink to={`/runs/${run.id}/auditoria`} className={() => `tab ${tab === 'auditoria' ? 'active' : ''}`}><Icon name="audit" />Auditoria</NavLink>
      </nav>

      {tab === 'passos' && <StepsTab key={run.id} run={run} />}
      <Suspense fallback={<Loading />}>
        {tab === 'revisao' && <ReviewTab key={run.id} run={run} />}
        {tab === 'hipoteses' && <RecommendationsTab key={run.id} run={run} />}
        {tab === 'auditoria' && <AuditTab key={run.id} run={run} />}
      </Suspense>

      {complement && <RunLauncher key={run.id} comp={run.comp} parentRun={run} onClose={() => setComplement(false)} />}
      <p className="run-seal mono">Pipeline {run.pipeline.name} v{run.pipeline.version} · código {run.code_version} · {plural(run.files.filter(file => !file.name.includes('::')).length, 'arquivo', 'arquivos')}</p>
    </>
  );
}
