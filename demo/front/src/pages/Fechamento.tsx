// Home of the closing, FloQast-style: what needs you now, where the month stands, its values and the checklist.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Run } from '../api/agent';
import { core, downloads } from '../api/core';
import { Checklist, isDone } from '../components/Checklist';
import { Icon, type IconName } from '../components/Icon';
import { RunLauncher } from '../components/RunLauncher';
import { TopbarSlot } from '../components/TopbarSlot';
import { Badge, Callout, Loading, Money, PageHead, RunId, StatusBadge, Tip } from '../components/ui';
import { capitalize, count, dateBR, dateTimeBR, moneyShort, periodLong, periodShort, plural } from '../lib/format';
import { progressOf } from '../state/runEvents';
import { keys, rememberComp, useAppState, useApprovalSummary, useChecklist, useCompetencias, useInsights, useRun, useRuns, useRunEvents } from '../state/queries';
import { useAction } from '../state/useAction';
import { Menu } from '../workbench/Menu';
import { CloseMonthModal, ReopenModal } from './fechamento/ClosingModals';
import { CommissionsPanel } from './fechamento/CommissionsPanel';
import { DivergencesPanel } from './fechamento/DivergencesPanel';

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
          <span className="stage-dot">{stage.done && <Icon name="check" />}</span>
          <span>{stage.label}</span>
        </li>
      ))}
    </ol>
  );
}

type Need = { key: string; tone: 'critical' | 'warning' | 'gate' | 'info'; icon: IconName; text: ReactNode; action: ReactNode };

/** "Precisa de você": the few things that block the month, each with its one next step. */
function NeedsYou({ needs }: { needs: Need[] }) {
  if (!needs.length) {
    return (
      <section className="needs needs-clear" aria-label="Precisa de você">
        <Icon name="check" /><span>Nada aguarda você agora. O checklist abaixo mostra o restante do mês.</span>
      </section>
    );
  }
  return (
    <section className="needs" aria-label="Precisa de você">
      <h2 className="needs-title">Precisa de você</h2>
      <ul className="needs-list">
        {needs.map(need => (
          <li key={need.key} className={`need ${need.tone}`}>
            <Icon name={need.icon} />
            <span className="grow">{need.text}</span>
            {need.action}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExportMenu({ latest }: { latest?: Run }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  const { run: act, busy } = useAction();
  return (
    <>
      <button className="btn" aria-haspopup="menu" aria-expanded={!!at} onClick={event => {
        const box = event.currentTarget.getBoundingClientRect();
        setAt({ x: box.left, y: box.bottom + 4 });
      }}><Icon name="download" />Exportar<Icon name="chevronDown" size={14} /></button>
      {at && (
        <Menu x={at.x} y={at.y} title="Relatório de conferência" onClose={() => setAt(null)} items={[
          { label: 'Abrir relatório imprimível', icon: 'file', onSelect: () => window.open(downloads.report, '_blank', 'noopener') },
          { label: 'Baixar pacote (6 CSVs + relatório)', icon: 'download', onSelect: () => { window.location.href = downloads.zip; } },
          {
            label: 'Preparar e-mail do relatório', icon: 'mail', disabled: !!busy, onSelect: async () => {
              const result = await act('report', () => core.draftEmail({ report: true }), { success: 'Rascunho do relatório preparado.', invalidate: [keys.state] });
              const id = result?.id || result?.email?.id;
              if (result) navigate(`/comunicacoes${id ? `?email=${id}` : ''}`);
            },
          },
          ...(latest ? [{ label: 'Trilha de auditoria do run', icon: 'audit' as const, onSelect: () => navigate(`/runs/${latest.id}/auditoria`) }] : []),
        ]} />
      )}
    </>
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
  const reviewOpen = !!latest && ['awaiting_approval', 'approved'].includes(latest.status);

  const needs: Need[] = [];
  if (hasData && !closed) {
    if (!latestRef) {
      needs.push({ key: 'run', tone: 'info', icon: 'play', text: <>O agente ainda não rodou em {periodShort(comp)}. As tarefas do agente ficam pendentes até o primeiro run.</>, action: <button className="btn sm primary" onClick={() => setLaunch(true)}>Rodar fechamento</button> });
    } else if (latest?.status === 'failed') {
      const failed = latest.steps.find(step => step.status === 'failed');
      needs.push({ key: 'failed', tone: 'critical', icon: 'x', text: <>O agente parou em <strong>{failed?.title || 'um passo'}</strong>.</>, action: <Link className="btn sm" to={`/runs/${latest.id}`}>Abrir execução</Link> });
    } else if (latest && ['running', 'pending'].includes(latest.status)) {
      const progress = progressOf(latest);
      needs.push({ key: 'running', tone: 'info', icon: 'refresh', text: <>O agente está rodando: <span className="num">{progress.done} de {progress.total}</span> passos.</>, action: <Link className="btn sm" to={`/runs/${latest.id}`}>Acompanhar</Link> });
    }
    if (latest?.status === 'awaiting_approval' && summary) {
      const open = summary.total - summary.decided;
      needs.push(open
        ? { key: 'review', tone: summary.open_blocking ? 'critical' : 'gate', icon: 'alert', text: <><strong>{plural(open, 'exceção aguarda', 'exceções aguardam')}</strong> sua revisão{summary.open_blocking ? `, ${count(summary.open_blocking)} bloqueantes` : ''}.</>, action: <Link className="btn sm primary" to={`/runs/${latest.id}/revisao`}>Revisar</Link> }
        : { key: 'approve', tone: 'gate', icon: 'pause', text: <>Todas as exceções foram decididas. O lote aguarda sua aprovação.</>, action: <Link className="btn sm primary" to={`/runs/${latest.id}/revisao`}>Aprovar</Link> });
    }
    if (p && p.open_count > 0 && latest?.status !== 'awaiting_approval') {
      needs.push({ key: 'pend', tone: 'warning', icon: 'alert', text: <><strong className="num">{moneyShort(p.open_brl)}</strong> em {plural(p.open_count, 'pendência aberta', 'pendências abertas')}.</>, action: reviewOpen ? <Link className="btn sm" to={`/runs/${latest!.id}/revisao`}>Ver pendências</Link> : <button className="btn sm" onClick={() => openPanel('divergencias')}>Ver divergências</button> });
    }
    if (daysLeft !== null && daysLeft <= 1) {
      needs.push({ key: 'deadline', tone: daysLeft < 0 ? 'critical' : 'warning', icon: 'clock', text: <>Prazo do fechamento {daysLeft < 0 ? `vencido há ${plural(-daysLeft, 'dia', 'dias')}` : daysLeft === 0 ? 'é hoje' : 'é amanhã'} ({dateBR(deadline)}).</>, action: <button className="btn sm" onClick={() => setClosing('close')}>Concluir</button> });
    }
  }

  return (
    <>
      <TopbarSlot>
        <span>Fechamento</span>
        <span className="crumb-sep">/</span>
        <select className="select sm crumb-select" value={comp} aria-label="Competência"
          onChange={event => navigate(`/competencias/${event.target.value}`)}>
          {(comps || [{ comp, has_data: hasData, current: true }]).map(item => <option key={item.comp} value={item.comp}>{periodShort(item.comp)}{item.has_data ? '' : ' · sem dados'}</option>)}
        </select>
        {!hasData ? <Badge tone="neutral" dot>Sem dados</Badge> : closed ? <Badge tone="good" dot>Concluído</Badge> : <Badge tone="warning" dot>Em revisão</Badge>}
      </TopbarSlot>

      <PageHead
        title={capitalize(periodLong(comp))}
        sub={<>
          <strong className="num">{taskStats.done} de {taskStats.total}</strong> tarefas concluídas
          {deadline && hasData && <> · prazo {dateBR(deadline)}{daysLeft !== null && <span className={daysLeft <= 1 ? 'deadline-hot' : ''}> ({daysLeft < 0 ? `${-daysLeft} dias atrasado` : daysLeft === 0 ? 'hoje' : `em ${plural(daysLeft, 'dia', 'dias')}`})</span>}</>}
        </>}
        actions={<>
          {hasData && <ExportMenu latest={latest} />}
          {hasData && (closed
            ? <button className="btn" onClick={() => setClosing('reopen')}><Icon name="refresh" />Reabrir mês</button>
            : <button className="btn" onClick={() => setClosing('close')}><Icon name="lock" />Concluir fechamento</button>)}
          <button className="btn primary" onClick={() => setLaunch(true)}><Icon name="play" />Rodar fechamento</button>
        </>}
      />

      {!hasData && <div className="section-gap"><Callout tone="warning" icon="alert">Competência nova: não há data pack de {periodShort(comp)} no servidor. Rode o fechamento enviando os arquivos ou importando uma pasta.</Callout></div>}

      {hasData && <NeedsYou needs={needs} />}

      {hasData && (
        <section className="card status-strip" aria-label="Situação do mês">
          <Stages run={latest} closed={closed} reviewDone={!!summary && summary.total > 0 && summary.decided === summary.total} />
          <div className="status-run">
            {latest ? (
              <>
                <span className="muted">Último run</span>
                <RunId id={latest.id} />
                <StatusBadge status={latest.status} />
                <span className="muted nowrap">{dateTimeBR(latest.created_at)}</span>
                <Link className="link" to={`/runs/${latest.id}`}>Abrir <Icon name="arrowRight" size={14} /></Link>
              </>
            ) : <span className="muted">Nenhum run nesta competência</span>}
          </div>
        </section>
      )}

      {hasData && (
        <section className="section" aria-label="Valores do mês">
          <h2 className="section-title">
            Valores do mês
            <Tip text="Conferência dos dados e cadastros atuais. Cada execução preserva seus próprios cálculos e decisões. Comissões, divergências e pendências são visões das mesmas operações: não some os valores."><Icon name="info" size={14} className="muted" /></Tip>
          </h2>
          <div className="kpi-strip">
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
        </section>
      )}

      <section className="section" aria-label="Checklist do fechamento">
        <div className="section-title row between">
          <span>Checklist</span>
          <span className="section-note">Tarefas do agente seguem o run mais recente; tarefas manuais são editáveis.</span>
        </div>
        {tasks ? <Checklist tasks={tasks} comp={comp} /> : <Loading />}
      </section>

      {panel === 'comissoes' && <CommissionsPanel state={state} line={params.get('linha') || undefined} onClose={closePanel} />}
      {panel === 'divergencias' && <DivergencesPanel state={state} insights={insights} run={latestRef && ['awaiting_approval', 'approved'].includes(latestRef.status) ? latestRef : undefined} onClose={closePanel} />}
      {launch && <RunLauncher comp={comp} onClose={() => setLaunch(false)} />}
      {closing === 'close' && <CloseMonthModal period={state.period} openIssues={s.open_issues} onClose={() => setClosing(null)} />}
      {closing === 'reopen' && <ReopenModal onClose={() => setClosing(null)} />}
    </>
  );
}
