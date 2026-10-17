// Home of the closing (A2 + visual summary + B3): progress, value in pendencies, last run, KPIs and checklist.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChecklistTask, Run, Status } from '../api/agent';
import { core, downloads } from '../api/core';
import { HBarChart, SegmentMeter, StackedBar, STATUS_COLORS } from '../components/charts/Bars';
import { Checklist, isDone } from '../components/Checklist';
import { Icon } from '../components/Icon';
import { RunLauncher } from '../components/RunLauncher';
import { TopbarSlot } from '../components/TopbarSlot';
import { Badge, Callout, Empty, Loading, Money, PageHead, STATUS, StatusBadge, Tip } from '../components/ui';
import { capitalize, count, dateBR, dateTimeBR, duration, moneyShort, periodLong, periodShort, plural } from '../lib/format';
import { progressOf } from '../state/runEvents';
import { keys, rememberComp, useAppState, useApprovalSummary, useChecklist, useCompetencias, useElapsed, useInsights, useRun, useRuns, useRunEvents } from '../state/queries';
import { useAction } from '../state/useAction';
import { CloseMonthModal, ReopenModal } from './fechamento/ClosingModals';
import { CommissionsPanel } from './fechamento/CommissionsPanel';
import { DivergencesPanel } from './fechamento/DivergencesPanel';

const LEGEND: { status: Status[]; label: string; color: string }[] = [
  { status: ['done', 'approved'], label: 'Concluídas', color: STATUS_COLORS.done },
  { status: ['exceptions'], label: 'Com exceções', color: STATUS_COLORS.exceptions },
  { status: ['awaiting_approval'], label: 'Aguardando aprovação', color: STATUS_COLORS.awaiting_approval },
  { status: ['running'], label: 'Rodando', color: STATUS_COLORS.running },
  { status: ['failed', 'rejected'], label: 'Falhou ou reprovada', color: STATUS_COLORS.failed },
  { status: ['pending', 'skipped'], label: 'Pendentes', color: '#d9ded9' },
];
const colorOf = (status: Status) => LEGEND.find(item => item.status.includes(status))?.color || '#d9ded9';

function Stages({ run, closed, reviewDone }: { run?: Run; closed: boolean; reviewDone: boolean }) {
  const finished = (type: string) => !!run?.steps.find(step => step.type === type && ['done', 'exceptions', 'approved'].includes(step.status));
  const calcs = run?.steps.filter(step => step.kind === 'calc') || [];
  const stages = [
    { label: 'Importar', done: finished('ler_arquivos') },
    { label: 'Calcular', done: !!calcs.length && calcs.every(step => ['done', 'exceptions'].includes(step.status)) },
    { label: 'Revisar', done: reviewDone || run?.approval?.status === 'approved' },
    { label: 'Aprovar', done: run?.approval?.status === 'approved' },
    { label: 'Exportar', done: finished('exportar_erp') },
    { label: 'Concluir', done: closed },
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

function LastRunCard({ run, onRun }: { run?: Run; onRun: () => void }) {
  const elapsed = useElapsed(run?.created_at, run?.finished_at);
  const { data: summary } = useApprovalSummary(run?.id || '', run?.status === 'awaiting_approval');
  if (!run) {
    return (
      <div className="card fill">
        <div className="card-head"><div><h3 className="card-title">Último run</h3><p className="card-sub">O agente ainda não rodou nesta competência</p></div></div>
        <div className="card-body">
          <Empty icon="play" title="Nenhum run ainda">As tarefas do agente ficam pendentes até o primeiro run.</Empty>
          <button className="btn primary" style={{ width: '100%' }} onClick={onRun}><Icon name="play" />Rodar fechamento</button>
        </div>
      </div>
    );
  }
  const progress = progressOf(run);
  return (
    <div className="card fill">
      <div className="card-head">
        <div><h3 className="card-title">Último run · <span className="mono">{run.id}</span></h3><p className="card-sub">{run.created_by} · {dateTimeBR(run.created_at)}{run.draft ? ' · teste' : ''}</p></div>
        <StatusBadge status={run.status} />
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="step-dots" aria-label="Passos do run">
          {run.steps.map(step => (
            <Tip key={step.id} text={<><strong>{step.title}</strong><br />{STATUS[step.status].label}</>}>
              <Link to={`/runs/${run.id}?step=${step.id}`} className={`step-dot ${step.kind}`} style={{ background: colorOf(step.status) }} aria-label={`${step.title}: ${STATUS[step.status].label}`} />
            </Tip>
          ))}
        </div>
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
          <Link className="btn sm" to={`/runs/${run.id}`}><Icon name="run" />Abrir run</Link>
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
  const { data: state } = useAppState();
  const { data: comps } = useCompetencias();
  const { data: insights } = useInsights(comp);
  const { data: tasks } = useChecklist(comp);
  const { data: runs } = useRuns(comp);
  const latestRef = runs?.find(run => !run.draft);
  const { data: latest } = useRun(latestRef?.id || '');
  useRunEvents(latestRef?.id || '');
  const { data: summary } = useApprovalSummary(latest?.id || '', !!latest && ['awaiting_approval', 'approved'].includes(latest.status));
  const [launch, setLaunch] = useState(false);
  const [closing, setClosing] = useState<'close' | 'reopen' | null>(null);
  const { run: act, busy } = useAction();
  useEffect(() => { if (comp) rememberComp(comp); }, [comp]);

  const panel = params.get('painel');
  const closePanel = () => { params.delete('painel'); params.delete('linha'); setParams(params, { replace: true }); };
  const openPanel = (name: string, line?: string) => setParams(line ? { painel: name, linha: line } : { painel: name });

  const taskStats = useMemo(() => {
    const list = tasks || [];
    return { done: list.filter(task => isDone(task.status)).length, total: list.length };
  }, [tasks]);

  if (!state) return <Loading page />;
  const hasData = comp === state.period;
  const closed = state.closing.status === 'closed' && hasData;
  const s = state.summary;
  const deadline = state.parameters.closing_deadline;
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = deadline ? Math.round((new Date(`${deadline}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000) : null;
  const p = insights?.pendencias;

  return (
    <>
      <TopbarSlot>
        <Icon name="calendar" />
        <span>Competência</span>
        <select className="select sm" style={{ width: 'auto', minWidth: 120 }} value={comp} aria-label="Competência"
          onChange={event => navigate(`/competencias/${event.target.value}`)}>
          {(comps || [{ comp, has_data: hasData, current: true }]).map(item => <option key={item.comp} value={item.comp}>{periodShort(item.comp)}{item.has_data ? '' : ' · sem dados'}</option>)}
        </select>
        {!hasData ? <Badge tone="neutral" dot>Sem dados</Badge> : closed ? <Badge tone="good" dot>Mês concluído</Badge> : <Badge tone="warning" dot>Em revisão</Badge>}
      </TopbarSlot>

      <PageHead
        eyebrow="Fechamento mensal"
        title={capitalize(periodLong(comp))}
        sub={<>
          <strong className="num">{taskStats.done} de {taskStats.total}</strong> tarefas concluídas
          {deadline && hasData && <> · prazo {dateBR(deadline)}{daysLeft !== null && <span className={daysLeft <= 1 ? 'deadline-hot' : ''}> ({daysLeft < 0 ? `${-daysLeft} dias atrasado` : daysLeft === 0 ? 'hoje' : `em ${plural(daysLeft, 'dia', 'dias')}`})</span>}</>}
        </>}
        actions={<>
          {hasData && (closed
            ? <button className="btn" onClick={() => setClosing('reopen')}><Icon name="refresh" />Reabrir mês</button>
            : <button className="btn" onClick={() => setClosing('close')}><Icon name="lock" />Concluir fechamento</button>)}
          <button className={`btn primary lg ${!latestRef ? 'pulse' : ''}`} onClick={() => setLaunch(true)}><Icon name="play" />Rodar fechamento</button>
        </>}
      />

      {params.get('sem-run') && !latestRef && <div style={{ marginBottom: 16 }}><Callout tone="info">Ainda não há run em {periodShort(comp)}. Clique em <strong>Rodar fechamento</strong> para o agente executar os passos.</Callout></div>}
      {!hasData && <div style={{ marginBottom: 16 }}><Callout tone="warning" icon="alert">Competência nova: não há data pack de {periodShort(comp)} no servidor. Rode o fechamento enviando os arquivos ou importando uma pasta.</Callout></div>}

      <div className="summary-grid">
        <div className="card fill">
          <div className="card-head"><div><h3 className="card-title">Progresso do fechamento</h3><p className="card-sub">Tarefas do checklist por situação</p></div></div>
          <div className="card-body stack" style={{ gap: 16 }}>
            <div className="hero-num num">{taskStats.done}<small>de {taskStats.total} tarefas</small></div>
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
            <div><h3 className="card-title">Valor em pendências</h3><p className="card-sub">Exposição em R$ (valores absolutos) por situação</p></div>
          </div>
          <div className="card-body stack" style={{ gap: 16 }}>
            {p ? (
              <>
                <div>
                  <div className="hero-num num"><Money value={p.open_brl} /></div>
                  <p className="muted" style={{ marginTop: 6 }}>{plural(p.open_count, 'pendência aberta', 'pendências abertas')} · {plural(p.resolved_count, 'decidida', 'decididas')}</p>
                </div>
                <StackedBar tall ariaLabel="Pendências por situação"
                  segments={p.by_state.map(slice => ({
                    key: slice.key, label: slice.label, value: Number(slice.brl), display: moneyShort(slice.brl), sub: count(slice.count),
                    color: slice.key === 'bloqueante' ? 'var(--st-critical)' : slice.key === 'alerta' ? 'var(--st-warning)' : 'var(--st-good)',
                  }))} />
                {latest && ['awaiting_approval', 'approved'].includes(latest.status)
                  ? <Link className="btn sm" to={`/runs/${latest.id}/revisao`}><Icon name="arrowRight" />Revisar exceções</Link>
                  : <p className="help">A revisão abre quando o run chega à aprovação humana.</p>}
              </>
            ) : hasData ? <div className="skeleton" style={{ height: 160 }} /> : <Empty icon="info" title="Sem dados nesta competência" />}
          </div>
        </div>

        <LastRunCard run={latest} onRun={() => setLaunch(true)} />
      </div>

      {hasData && (
        <div className="grid grid-4 section">
          <button className="kpi" onClick={() => openPanel('comissoes', 'CHECKOUT')}>
            <span className="kpi-label">Comissão de checkout <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.checkout_brl} /></span>
            <span className="kpi-detail">{count(s.checkout_count)} transações na origem</span>
          </button>
          <button className="kpi" onClick={() => openPanel('comissoes', 'REMESSA')}>
            <span className="kpi-label">Comissão de remessa <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.remessa_brl} /></span>
            <span className="kpi-detail">{count(s.remessa_count)} operações únicas</span>
          </button>
          <button className="kpi attention" onClick={() => openPanel('divergencias')}>
            <span className="kpi-label">Divergências de taxa <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.divergencias_abs_brl} /></span>
            <span className="kpi-detail">{count(s.divergencias_count)} diferenças · exposição absoluta</span>
          </button>
          <Link className="kpi" to="/notas-bancos">
            <span className="kpi-label">Notas a emitir <Icon name="arrowRight" className="kpi-go" /></span>
            <span className="kpi-value"><Money value={s.notas_brl} /></span>
            <span className="kpi-detail">{count(s.notas_count)} notas propostas</span>
          </Link>
        </div>
      )}
      {hasData && <p className="help" style={{ marginTop: 8 }}>Conferência dos dados e cadastros atuais. Cada execução preserva seus próprios cálculos e decisões; consulte a Revisão para o lote ERP. Comissões, divergências e pendências são visões das mesmas operações: não some os cartões.</p>}

      {hasData && (
        <div className="grid section" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
          <div className="card">
            <div className="card-head">
              <div><h3 className="card-title">Pendências abertas por tipo</h3><p className="card-sub">Exposição em R$ · cor indica a severidade · clique para revisar</p></div>
            </div>
            <div className="card-body">
              <HBarChart ariaLabel="Pendências abertas por tipo" labelWidth={240}
                legend={<><span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--st-critical)' }} />Bloqueante</span><span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--st-warning)' }} />Alerta</span></>}
                data={(p?.by_type || []).filter(item => item.open_count > 0).map(item => ({
                  key: item.key, label: item.label, value: Number(item.brl) || 0.01, display: moneyShort(item.brl), sub: plural(item.open_count, 'item', 'itens'),
                  color: item.severity === 'bloqueante' ? 'var(--st-critical)' : 'var(--st-warning)',
                }))}
                onSelect={latest && ['awaiting_approval', 'approved'].includes(latest.status) ? key => navigate(`/runs/${latest.id}/revisao?tipo=${key}`) : undefined}
                empty={<Empty icon="check" title="Nenhuma pendência aberta" />} />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><h3 className="card-title">Relatório de conferência</h3><p className="card-sub">Dados atuais · {state.sources.filter(src => !src.embedded).length} arquivos de origem com SHA-256. O pacote ERP fica na Revisão do run aprovado.</p></div></div>
            <div className="card-body stack" style={{ gap: 8 }}>
              <a className="btn" href={downloads.report} target="_blank" rel="noopener"><Icon name="file" />Abrir relatório imprimível</a>
              <a className="btn" href={downloads.zip} download><Icon name="download" />Baixar pacote (6 CSVs + relatório)</a>
              <button className="btn" disabled={!!busy} onClick={async () => {
                const result = await act('report', () => core.draftEmail({ report: true }), { success: 'Rascunho do relatório preparado.', invalidate: [keys.state] });
                const id = result?.id || result?.email?.id;
                if (result) navigate(`/comunicacoes${id ? `?email=${id}` : ''}`);
              }}><Icon name="mail" />Preparar e-mail do relatório</button>
              {latest && <Link className="link" to={`/runs/${latest.id}/auditoria`} style={{ marginTop: 6 }}>Trilha de auditoria do {latest.id} <Icon name="arrowRight" /></Link>}
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Checklist do fechamento</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>Tarefas do agente seguem o run mais recente; tarefas manuais são editáveis.</span>
        </div>
        {tasks ? <Checklist tasks={tasks} comp={comp} /> : <Loading />}
      </div>

      {panel === 'comissoes' && <CommissionsPanel state={state} line={params.get('linha') || undefined} onClose={closePanel} />}
      {panel === 'divergencias' && <DivergencesPanel state={state} insights={insights} run={latestRef && ['awaiting_approval', 'approved'].includes(latestRef.status) ? latestRef : undefined} onClose={closePanel} />}
      {launch && <RunLauncher comp={comp} onClose={() => setLaunch(false)} />}
      {closing === 'close' && <CloseMonthModal period={state.period} openIssues={s.open_issues} onClose={() => setClosing(null)} />}
      {closing === 'reopen' && <ReopenModal onClose={() => setClosing(null)} />}
    </>
  );
}
