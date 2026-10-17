// Home of the closing (A2 + visual summary + B3): progress, value in pendencies, last run, KPIs and checklist.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/http';
import type { ChecklistTask, Run, Status } from '../api/agent';
import { scopedUrl, updateSearch } from '../lib/scope';
import { OperationalConfigModal } from '../components/OperationalConfig';
import { core, downloads } from '../api/core';
import { HBarChart, SegmentMeter, StackedBar, STATUS_COLORS } from '../components/charts/Bars';
import { StepTrack } from '../components/AgentHeader';
import { Checklist, isDone } from '../components/Checklist';
import { Icon } from '../components/Icon';
import { RunLauncher } from '../components/RunLauncher';
import { TopbarSlot } from '../components/TopbarSlot';
import { AgentOrb, moodOf } from '../components/motion';
import { Badge, Callout, Count, Empty, Loading, Money, PageHead, RunId, STATUS, StatusBadge } from '../components/ui';
import { capitalize, count, dateBR, dateTimeBR, duration, issueNames, moneyShort, periodLong, periodShort, plural, shortRunId } from '../lib/format';
import { progressOf } from '../state/runEvents';
import { keys, rememberComp, useAppState, useApprovalSummary, useChecklist, useCompetencias, useElapsed, useInsights, useRun, useRuns, useRunEvents, useOperationalConfig } from '../state/queries';
import { useAction } from '../state/useAction';
import { isUnstartedMonth, MonthSelector, UnstartedMonth } from './fechamento/MonthAvailability';
import { CloseMonthModal, ReopenModal } from './fechamento/ClosingModals';
import { CommissionsPanel } from './fechamento/CommissionsPanel';
import { DivergencesPanel } from './fechamento/DivergencesPanel';

const LEGEND: { status: Status[]; label: string; color: string }[] = [
  { status: ['done', 'approved'], label: 'Concluídas', color: STATUS_COLORS.done },
  { status: ['exceptions'], label: 'Com exceções', color: STATUS_COLORS.exceptions },
  { status: ['awaiting_approval'], label: 'Aguardando aprovação', color: STATUS_COLORS.awaiting_approval },
  { status: ['running'], label: 'Em andamento', color: STATUS_COLORS.running },
  { status: ['failed', 'rejected'], label: 'Falhou ou reprovada', color: STATUS_COLORS.failed },
  { status: ['pending', 'skipped'], label: 'Pendentes', color: '#e2dbdb' },
];
const colorOf = (status: Status) => LEGEND.find(item => item.status.includes(status))?.color || '#e2dbdb';

function Stages({ run, closed, reviewDone }: { run?: Run; closed: boolean; reviewDone: boolean }) {
  const finished = (type: string) => !!run?.steps.find(step => step.type === type && ['done', 'exceptions', 'approved'].includes(step.status));
  const calcs = run?.steps.filter(step => step.kind === 'calc') || [];
  const stages = [
    { label: 'Importar', done: finished('ler_arquivos') },
    { label: 'Calcular', done: !!calcs.length && calcs.every(step => ['done', 'exceptions'].includes(step.status)) },
    { label: 'Revisar', done: reviewDone || run?.approval?.status === 'approved' },
    { label: 'Aprovar', done: run?.approval?.status === 'approved' },
    { label: 'Exportar', done: finished('exportar_erp') },
    { label: 'Encerrar', done: closed },
  ];
  const current = stages.findIndex(stage => !stage.done);
  return (
    <ol className="stages" aria-label="Etapas do fechamento">
      {stages.map((stage, index) => (
        <li key={stage.label} className={stage.done ? 'done' : index === current ? 'current' : ''}>
          <span className="stage-dot">{stage.done ? <Icon name="check" /> : index + 1}</span>
          <span>{stage.label}</span>
        </li>
      ))}
    </ol>
  );
}

function LastRunCard({ run, onRun, selector }: { run?: Run; onRun: () => void; selector?: ReactNode }) {
  const elapsed = useElapsed(run?.created_at, run?.finished_at);
  const { data: summary } = useApprovalSummary(run?.id || '', run?.status === 'awaiting_approval');
  if (!run) {
    return (
      <div className="card fill">
        <div className="card-head"><h3 className="card-title">Execução</h3></div>
        <div className="card-body">
          {selector}
          <Empty icon="play" title="Nenhuma execução selecionada" />
          <button className="btn primary" style={{ width: '100%' }} onClick={onRun}><Icon name="play" />Calcular fechamento</button>
        </div>
      </div>
    );
  }
  const progress = progressOf(run);
  return (
    <div className="card fill">
      <div className="card-head">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <AgentOrb mood={moodOf(run.status)} size={28} />
          <div>
            <h3 className="card-title">Execução selecionada</h3>
            <p className="card-sub row wrap" style={{ gap: '2px 6px' }}><RunId id={run.id} /><span className="nowrap">{run.created_by}</span><span className="nowrap">{dateTimeBR(run.created_at)}{run.draft ? ' · teste' : ''}</span></p>
          </div>
        </div>
        <StatusBadge status={run.status} />
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {selector}
        <StepTrack run={run} link />
        <div className="row between muted" style={{ fontSize: 12.5 }}>
          <span className="num">{progress.done} de {progress.total} passos</span>
          <span className="num">{run.finished_at || run.status === 'awaiting_approval' ? `processamento ${duration(run.steps.filter(step => step.kind !== 'gate').reduce((sum, step) => sum + (step.duration_ms || 0), 0))}` : duration(elapsed)}</span>
        </div>
        {run.status === 'awaiting_approval' && summary && (
          <Callout tone="gate" icon="pause">
            {plural(summary.total - summary.decided, 'exceção aguarda', 'exceções aguardam')} sua revisão{summary.open_blocking ? `, ${count(summary.open_blocking)} bloqueantes` : ''}.
          </Callout>
        )}
        <div className="row wrap">
          <Link className="btn sm" to={`/runs/${run.id}`}><Icon name="run" />Ver execução</Link>
          {['awaiting_approval', 'approved', 'rejected'].includes(run.status) && <Link className="btn sm" to={`/runs/${run.id}/revisao`}><Icon name="alert" />Revisão</Link>}
          <Link className="btn sm ghost" to={`/runs/${run.id}/auditoria`}><Icon name="audit" />Auditoria</Link>
        </div>
      </div>
    </div>
  );
}

export default function Fechamento() {
  const { comp = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: comps } = useCompetencias();
  const { data: runs } = useRuns(comp);
  const requestedRun = params.get('run_id') || undefined;
  const latestRef = requestedRun ? runs?.find(run => run.id === requestedRun) : runs?.find(run => !run.draft);
  const selectedId = requestedRun || latestRef?.id;
  const { data: state, error: stateError, isFetching: stateFetching } = useAppState({ comp, run_id: selectedId }, runs !== undefined);
  const { data: insights } = useInsights(comp, selectedId, runs !== undefined);
  const { data: tasks } = useChecklist(comp, selectedId);
  const { data: latest } = useRun(selectedId || '');
  useRunEvents(selectedId || '');
  const { data: summary } = useApprovalSummary(selectedId || '', !!latest && ['awaiting_approval', 'approved', 'rejected'].includes(latest.status));
  const { data: operational } = useOperationalConfig(comp);
  useEffect(() => { if (!requestedRun && selectedId) setParams(current => updateSearch(current, { run_id: selectedId }), { replace: true }); }, [requestedRun, selectedId, setParams]);
  const [launch, setLaunch] = useState(false);
  const [complement, setComplement] = useState(false);
  const [configure, setConfigure] = useState(false);
  const [closing, setClosing] = useState<'close' | 'reopen' | null>(null);
  const { run: act, busy } = useAction();
  useEffect(() => { if (comp) rememberComp(comp); }, [comp]);

  const panel = params.get('painel');
  const closePanel = () => { params.delete('painel'); params.delete('linha'); setParams(params, { replace: true }); };
  const openPanel = (name: string, line?: string) => setParams(current => updateSearch(current, { painel: name, linha: line }));

  const taskStats = useMemo(() => {
    const list = tasks || [];
    return { done: list.filter(task => isDone(task.status)).length, total: list.length };
  }, [tasks]);

  const monthSelector = <MonthSelector comp={comp} months={comps} onChange={value => navigate(`/competencias/${value}`)} />;
  if (isUnstartedMonth(stateError, selectedId)) return <><TopbarSlot>{monthSelector}<Badge tone="neutral" dot>Sem execução</Badge></TopbarSlot><UnstartedMonth comp={comp} hasPack={comps?.find(item => item.comp === comp)?.has_pack} deadline={operational?.closing_deadline} onLaunch={() => setLaunch(true)} onConfigure={() => setConfigure(true)} />{launch && <RunLauncher key={comp} comp={comp} onClose={() => setLaunch(false)} />}{configure && <OperationalConfigModal key={comp} comp={comp} onClose={() => setConfigure(false)} />}</>;
  if (stateError instanceof ApiError && (stateError.data?.error as { code?: string })?.code === 'RESULT_NOT_READY') return <><TopbarSlot>{monthSelector}</TopbarSlot><div className="stack-lg"><PageHead eyebrow="Fechamento mensal" title={capitalize(periodLong(comp))} sub="Esta execução ainda está preparando os resultados." /><Callout tone="info" icon="info">Os valores desta execução serão exibidos quando o cálculo estiver disponível.</Callout><LastRunCard run={latest} onRun={() => navigate(`/runs/${selectedId}`)} />{selectedId && <Link className="btn primary" to={`/runs/${selectedId}`}>Acompanhar processamento</Link>}</div></>;
  if (stateError) return <><TopbarSlot>{monthSelector}</TopbarSlot><Empty icon="alert" title="Não foi possível abrir esta competência ou execução">{stateError.message} <button className="btn sm" onClick={() => navigate(`/competencias/${comp}`)}>Voltar à seleção do mês</button></Empty></>;
  if (!state) return <Loading page />;
  const scope = { comp, run_id: selectedId || state.run_id };
  const hasData = state.has_data !== false && comp === state.period && (!selectedId || state.run_id === selectedId);
  const monthInfo = comps?.find(item => item.comp === comp);
  const closed = state.closing.status === 'closed' && hasData;
  const s = state.summary;
  const deadline = selectedId ? state.parameters.closing_deadline : operational?.closing_deadline || undefined;
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = deadline ? Math.round((new Date(`${deadline}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000) : null;
  const p = insights?.pendencias;
  const incompleteStates = !!p?.by_state.some(item => item.brl === null);
  const incompleteTypes = !!p?.by_type.some(item => item.brl === null);
  const runSelector = <select className="select sm" aria-label="Execução do fechamento" style={{ width: '100%' }} value={selectedId || ''} onChange={event => setParams(current => updateSearch(current, { run_id: event.target.value || null, painel: null, linha: null }))}><option value="" disabled={!!runs?.length}>Conferência do mês</option>{runs?.map(run => <option key={run.id} value={run.id}>{dateTimeBR(run.created_at)} · {shortRunId(run.id)}{run.draft ? ' · teste' : ''}</option>)}</select>;

  return (
    <>
      <TopbarSlot>
        {monthSelector}
        {!hasData ? <Badge tone="neutral" dot>Sem dados</Badge> : closed ? <Badge tone="good" dot>Mês encerrado</Badge> : <Badge tone="warning" dot>Em revisão</Badge>}
      </TopbarSlot>

      <PageHead
        eyebrow="Fechamento mensal"
        title={capitalize(periodLong(comp))}
        sub={<>
          <strong className="num">{taskStats.done} de {taskStats.total}</strong> tarefas concluídas
          {deadline && hasData && <> · prazo {dateBR(deadline)}{daysLeft !== null && <span className={daysLeft <= 1 ? 'deadline-hot' : ''}> ({daysLeft < 0 ? `${-daysLeft} dias atrasado` : daysLeft === 0 ? 'hoje' : `em ${plural(daysLeft, 'dia', 'dias')}`})</span>}</>}
        </>}
        actions={<>
          {latest && !latest.draft && <button className="btn" onClick={() => setComplement(true)}><Icon name="plus" />Adicionar complemento</button>}
          <button className={`btn primary lg ${!latestRef ? 'pulse' : ''}`} onClick={() => setLaunch(true)}><Icon name="play" />Calcular fechamento</button>
        </>}
      />

      {params.get('sem-run') && !latestRef && <div style={{ marginBottom: 16 }}><Callout tone="info">Nenhuma execução em {periodShort(comp)}. Clique em <strong>Calcular fechamento</strong> para começar.</Callout></div>}
      {!hasData && <div style={{ marginBottom: 16 }}><Callout tone="info" icon="info">{monthInfo?.has_pack ? `Arquivos de ${periodShort(comp)} disponíveis. Calcule o fechamento para ver os resultados.` : 'Sem resultados. Envie arquivos ou indique uma pasta para calcular o fechamento.'}</Callout></div>}
      {stateFetching && <p className="help" role="status">Atualizando esta execução…</p>}

      <div className="summary-grid">
        <LastRunCard run={latest} onRun={() => setLaunch(true)} selector={runSelector} />
        <div className="card fill">
          <div className="card-head"><h3 className="card-title">Progresso do fechamento</h3></div>
          <div className="card-body stack" style={{ gap: 16 }}>
            <div className="hero-num num"><Count value={taskStats.done} animate /><small>de {taskStats.total} tarefas</small></div>
            {tasks ? (
              <SegmentMeter ariaLabel={`${taskStats.done} de ${taskStats.total} tarefas concluídas`}
                items={tasks.map((task: ChecklistTask) => ({ key: task.id, color: colorOf(task.status), title: `${task.title} · ${STATUS[task.status].label}` }))}
                legend={LEGEND.map(item => ({ label: item.label, color: item.color, count: tasks.filter(task => item.status.includes(task.status)).length }))} />
            ) : <div className="skeleton" style={{ height: 40 }} />}
            <Stages run={latest} closed={closed} reviewDone={!!summary && summary.total > 0 && summary.decided === summary.total} />
          </div>
        </div>

        <div className="card fill">
          <div className="card-head">
            <div><h3 className="card-title">Valor em pendências</h3><p className="card-sub">{incompleteStates ? 'Valores incompletos · distribuição por quantidade de pendências' : 'Exposição em R$ (valores absolutos) por situação'}</p></div>
          </div>
          <div className="card-body stack" style={{ gap: 16 }}>
            {p ? (
              <>
                <div>
                  <div className="hero-num num"><Money value={p.open_brl ?? p.known_open_brl} animate /></div>
                  {p.open_brl === null && <p className="help">Subtotal conhecido em aberto; há operações sem valor calculado. O total permanece indisponível.</p>}
                  <p className="muted" style={{ marginTop: 6 }}>{plural(p.open_count, 'pendência aberta', 'pendências abertas')} · {plural(p.resolved_count, 'decidida', 'decididas')}</p>
                </div>
                <StackedBar tall ariaLabel="Pendências por situação"
                  segments={p.by_state.map(slice => ({
                    key: slice.key, label: slice.label, value: incompleteStates ? slice.count : Number(slice.brl), display: incompleteStates ? plural(slice.count, 'pendência', 'pendências') : moneyShort(slice.brl), sub: incompleteStates ? slice.brl === null ? `Subtotal conhecido: ${moneyShort(slice.known_brl)}` : moneyShort(slice.brl) : count(slice.count),
                    color: slice.key === 'bloqueante' ? 'var(--st-critical)' : slice.key === 'alerta' ? 'var(--st-warning)' : 'var(--st-good)',
                  }))} />
                {latest && ['awaiting_approval', 'approved'].includes(latest.status)
                  ? <Link className="btn sm" to={`/runs/${latest.id}/revisao`}><Icon name="arrowRight" />Revisar exceções</Link>
                  : <p className="help">A revisão fica disponível após o processamento.</p>}
              </>
            ) : hasData ? <div className="skeleton" style={{ height: 160 }} /> : <Empty icon="info" title="Sem dados nesta competência" />}
          </div>
        </div>

      </div>

      {hasData && (
        <div className="grid grid-4 section">
          <button className="kpi" onClick={() => openPanel('comissoes', 'CHECKOUT')}>
            <span className="kpi-label">Comissão de checkout <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.checkout_brl} animate /></span>
            <span className="kpi-detail">{count(s.checkout_count)} transações na origem</span>
          </button>
          <button className="kpi" onClick={() => openPanel('comissoes', 'REMESSA')}>
            <span className="kpi-label">Comissão de remessa <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.remessa_brl} animate /></span>
            <span className="kpi-detail">{count(s.remessa_count)} operações únicas</span>
          </button>
          <button className="kpi attention" onClick={() => openPanel('divergencias')}>
            <span className="kpi-label">Divergências de taxa <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.divergencias_abs_brl} animate /></span>
            <span className="kpi-detail">{count(s.divergencias_count)} diferenças · exposição absoluta</span>
          </button>
          <Link className="kpi" to={scopedUrl('/notas-bancos', scope)}>
            <span className="kpi-label">Notas a emitir <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.notas_brl} animate /></span>
            <span className="kpi-detail">{count(s.notas_count)} notas propostas</span>
          </Link>
        </div>
      )}
      {hasData && <p className="help" style={{ marginTop: 8 }}>{selectedId ? 'Resultados da execução selecionada.' : 'Resultados do mês.'} Os valores se sobrepõem; não some os cartões.</p>}

      {hasData && (
          <div className="card section">
            <div className="card-head">
              <div><h3 className="card-title">Pendências abertas por tipo</h3><p className="card-sub">{incompleteTypes ? 'Quantidade de pendências · valores incompletos' : 'Exposição em R$ (valores absolutos)'}</p></div>
            </div>
            <div className="card-body">
              <HBarChart ariaLabel="Pendências abertas por tipo" labelWidth={240}
                legend={<><span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--st-critical)' }} />Bloqueante</span><span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--st-warning)' }} />Alerta</span></>}
                data={(p?.by_type || []).filter(item => item.open_count > 0).map(item => ({
                  key: item.key, label: issueNames[item.key] || item.label, value: incompleteTypes ? item.open_count : Number(item.brl) || 0.01, display: incompleteTypes ? plural(item.open_count, 'pendência', 'pendências') : moneyShort(item.brl), sub: incompleteTypes ? item.brl === null ? `Subtotal conhecido: ${moneyShort(item.known_brl)}` : moneyShort(item.brl) : plural(item.open_count, 'item', 'itens'),
                  color: item.severity === 'bloqueante' ? 'var(--st-critical)' : 'var(--st-warning)',
                }))}
                onSelect={latest && ['awaiting_approval', 'approved'].includes(latest.status) ? key => navigate(`/runs/${latest.id}/revisao?tipo=${key}`) : undefined}
                empty={<Empty icon="check" title="Nenhuma pendência aberta" />} />
            </div>
          </div>
      )}

      <div className="section">
        <div className="row between wrap" style={{ marginBottom: 12 }}>
          <div><h2 className="section-title" style={{ margin: 0 }}>Tarefas do fechamento</h2><p className="help">Automáticas: execução selecionada. Manuais: mês.</p></div>
          <button className="btn sm" onClick={() => setConfigure(true)}><Icon name="calendar" />Prazo do mês</button>
        </div>
        {tasks ? <Checklist tasks={tasks} comp={comp} /> : <Loading />}
        {hasData && !selectedId && !state.read_only && <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>{closed
          ? <button className="btn" onClick={() => setClosing('reopen')}><Icon name="refresh" />Reabrir mês</button>
          : <button className="btn" onClick={() => setClosing('close')}><Icon name="lock" />Encerrar mês</button>}</div>}
      </div>

      {hasData && <div className="card section">
        <div className="card-head"><div><h3 className="card-title">Relatório de conferência</h3><p className="card-sub">O pacote ERP fica na Revisão da execução aprovada.</p></div></div>
        <div className="card-body">
          <div className="actions">
            <a className="btn" href={downloads.report(scope)} target="_blank" rel="noopener"><Icon name="file" />Abrir relatório</a>
            <a className="btn" href={downloads.zip(scope)} download><Icon name="download" />Baixar relatório e CSVs</a>
            <button className="btn" disabled={!!busy || !!selectedId || state.read_only} title={selectedId ? 'Disponível na conferência atual. Baixe o relatório desta execução.' : undefined} onClick={async () => {
              const result = await act('report', () => core.draftEmail({ report: true }), { success: 'Rascunho do relatório preparado.', invalidate: [keys.state] });
              const id = result?.id || result?.email?.id;
              if (result) navigate(`/comunicacoes${id ? `?email=${id}` : ''}`);
            }}><Icon name="mail" />Preparar e-mail (simulado)</button>
            {latest && <Link className="btn ghost" to={`/runs/${latest.id}/auditoria`}><Icon name="audit" />Ver auditoria</Link>}
          </div>
        </div>
      </div>}

      {panel === 'comissoes' && <CommissionsPanel state={state} line={params.get('linha') || undefined} onClose={closePanel} />}
      {panel === 'divergencias' && <DivergencesPanel state={state} insights={insights} run={latestRef && ['awaiting_approval', 'approved'].includes(latestRef.status) ? latestRef : undefined} onClose={closePanel} />}
      {configure && <OperationalConfigModal comp={comp} onClose={() => setConfigure(false)} />}
      {complement && latest && <RunLauncher comp={comp} parentRun={latest} onClose={() => setComplement(false)} />}
      {launch && <RunLauncher comp={comp} onClose={() => setLaunch(false)} />}
      {closing === 'close' && <CloseMonthModal period={state.period} openIssues={s.open_issues} onClose={() => setClosing(null)} />}
      {closing === 'reopen' && <ReopenModal onClose={() => setClosing(null)} />}
    </>
  );
}
