// Run view as a data desk: steps on the left (B1/B4) with the run summary, the step's table as a spreadsheet
// in the center (C8) with the query chat below, step and exception details in a side sheet.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Run, StepRun } from '../../api/agent';
import { ExceptionDetail } from '../../components/ExceptionDetail';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Overlay';
import { StepList } from '../../components/StepList';
import { Callout, Empty, HashChip, StatusBadge } from '../../components/ui';
import { count, dateTimeBR, duration, plural, readable } from '../../lib/format';
import { useCatalog, useExceptions, useRunEvents } from '../../state/queries';
import { ChatSlot } from '../../workbench/ChatSlot';
import { RunSummaryCard } from '../../workbench/RunSummaryCard';
import { StepWorkspace } from '../../workbench/StepWorkspace';

function StepDetail({ run, step, onException }: { run: Run; step: StepRun; onException: (id: string) => void }) {
  const { data: catalog } = useCatalog();
  const { data: exceptions } = useExceptions(run.id, ['done', 'exceptions'].includes(step.status) || step.kind === 'gate');
  const item = catalog?.find(entry => entry.type === step.type);
  const list = (exceptions || []).filter(exception => step.kind === 'gate' || exception.step_type === step.type);
  const m = step.metrics;
  return (
    <div className="stack-lg">
      <div>
        <StatusBadge status={step.status} />
        {item && <p className="text-2" style={{ fontSize: 13, marginTop: 8 }}>{item.description}</p>}
      </div>
      {step.status === 'failed' && <Callout tone="critical" icon="alert"><strong>Falha:</strong> {step.error}</Callout>}
      <dl className="facts">
        {step.kind !== 'gate' && <div><dt>Linhas de entrada</dt><dd className="num">{m.rows_in !== undefined ? count(m.rows_in) : '—'}</dd></div>}
        {step.kind !== 'gate' && <div><dt>Linhas de saída</dt><dd className="num">{m.rows_out !== undefined ? count(m.rows_out) : '—'}</dd></div>}
        <div><dt>Exceções</dt><dd className="num">{m.exceptions !== undefined ? count(m.exceptions) : '—'}{m.blocking ? ` · ${count(m.blocking)} bloqueantes` : ''}</dd></div>
        <div><dt>Duração</dt><dd className="num">{duration(step.duration_ms)}</dd></div>
        <div><dt>Início</dt><dd>{dateTimeBR(step.started_at)}</dd></div>
        <div><dt>Fim</dt><dd>{dateTimeBR(step.finished_at)}</dd></div>
        <div><dt>Versão do código</dt><dd className="mono">{step.code_version}</dd></div>
        <div><dt>Hash da saída</dt><dd><HashChip hash={step.output_hash} /></dd></div>
      </dl>
      {m.extra && Object.keys(m.extra).length > 0 && (
        <dl className="facts">{Object.entries(m.extra).map(([key, value]) => <div key={key}><dt>{readable(key)}</dt><dd className="num">{typeof value === 'number' ? count(value) : String(value)}</dd></div>)}</dl>
      )}
      <div>
        <h4 className="section-title" style={{ fontSize: 13.5 }}><Icon name="sliders" />Parâmetros efetivos</h4>
        <div className="stack" style={{ gap: 6 }}>
          {(item?.params_schema || []).map(field => {
            const value = step.params[field.key];
            const shown = field.type === 'boolean' ? (value ? 'Sim' : 'Não') : field.type === 'select' ? field.options?.find(option => option.value === value)?.label || String(value) : `${String(value).replace('.', ',')}${field.unit ? ` ${field.unit}` : ''}`;
            return <div key={field.key} className="row between" style={{ fontSize: 12.5 }}><span className="text-2">{field.label}</span><strong className="num">{shown}</strong></div>;
          })}
          <Link className="link" to="/pipeline" style={{ fontSize: 12.5, marginTop: 4 }}>Ajustar no construtor <Icon name="arrowRight" /></Link>
        </div>
      </div>
      {list.length > 0 && (
        <div>
          <h4 className="section-title" style={{ fontSize: 13.5 }}><Icon name="alert" />{plural(list.length, 'exceção', 'exceções')}</h4>
          <div className="stack" style={{ gap: 4 }}>
            {list.slice(0, 12).map(exception => (
              <button key={exception.id} type="button" className="exception-mini" onClick={() => onException(exception.id)}>
                <span className={`mark-dot ${exception.severity}`} />
                <span className="grow" style={{ minWidth: 0 }}><strong>{readable(exception.kind)}</strong><span className="muted">{exception.merchant} · {exception.ref_origem}</span></span>
                {exception.decision ? <Icon name="check" className="muted" /> : null}
              </button>
            ))}
          </div>
          {['awaiting_approval', 'approved', 'rejected'].includes(run.status) && <Link className="link" style={{ fontSize: 12.5, marginTop: 8 }} to={`/runs/${run.id}/revisao?passo=${step.kind === 'gate' ? '' : step.type}`}>Ver todas na revisão <Icon name="arrowRight" /></Link>}
        </div>
      )}
    </div>
  );
}

function GateView({ run, step }: { run: Run; step: StepRun }) {
  return (
    <div className="card-body stack-lg">
      <div className="row" style={{ gap: 10 }}><strong style={{ fontSize: 14 }}>{step.title}</strong><StatusBadge status={step.status} /></div>
      {step.status === 'awaiting_approval' || run.status === 'awaiting_approval' ? (
        <Callout tone="gate" icon="pause">O agente parou antes do ERP. {plural(step.metrics.exceptions || 0, 'exceção aguarda', 'exceções aguardam')} decisão humana{step.metrics.blocking ? `, ${count(step.metrics.blocking)} bloqueantes` : ''}.</Callout>
      ) : step.status === 'approved' ? <Callout tone="good" icon="check">Lote aprovado por {run.approval?.actor} em {dateTimeBR(run.approval?.at)}.{run.approval?.comment && ` “${run.approval.comment}”`}</Callout>
        : step.status === 'rejected' ? <Callout tone="critical" icon="x">Reprovado por {run.approval?.actor}: “{run.approval?.comment}”.</Callout>
          : <Empty icon="lock" title="O portão de aprovação ainda não foi alcançado" />}
      {['awaiting_approval', 'approved', 'rejected'].includes(run.status) && <Link className="btn primary" style={{ alignSelf: 'flex-start' }} to={`/runs/${run.id}/revisao`}><Icon name="arrowRight" />Abrir a revisão</Link>}
    </div>
  );
}

export function StepsTab({ run }: { run: Run }) {
  const [params, setParams] = useSearchParams();
  const [details, setDetails] = useState(false);
  const [exceptionId, setExceptionId] = useState<string | null>(null);
  const manual = useRef(!!params.get('step'));
  const running = run.steps.find(step => step.status === 'running');
  const fallback = running || run.steps.find(step => step.status === 'awaiting_approval' || step.status === 'failed') || [...run.steps].reverse().find(step => step.status !== 'pending' && step.kind === 'calc') || run.steps[0];
  const selectedId = params.get('step') || fallback?.id;
  const step = run.steps.find(item => item.id === selectedId) || fallback;
  const ref = params.get('ref');

  useRunEvents(run.id, event => {
    // Follow the agent while the user has not picked a step.
    if (event.type === 'step_started' && !manual.current) setParams(current => { current.set('step', event.step_id); current.delete('ref'); current.delete('dataset'); return current; }, { replace: true });
  });
  useEffect(() => { setExceptionId(null); }, [step?.id]);
  const select = (id: string) => {
    manual.current = true;
    setParams(current => { const next = new URLSearchParams({ step: id }); const volume = current.get('volume'); if (volume) next.set('volume', volume); return next; }, { replace: true });
  };
  const { data: exceptions } = useExceptions(run.id, !!exceptionId);
  const exception = exceptions?.find(item => item.id === exceptionId);
  const filters = useMemo(() => (ref ? [{ column: 'id', op: 'eq' as const, value: ref }] : undefined), [ref]);

  if (!step) return <Empty title="Este run não tem passos" />;
  return (
    <div className="wb">
      <aside className="wb-side">
        <div className="card wb-steps">
          <div className="run-col-head"><span>Passos</span><span className="muted num">{run.steps.length}</span></div>
          <StepList steps={run.steps} selected={step.id} onSelect={select} onDetails={id => { select(id); setDetails(true); }} />
        </div>
        <RunSummaryCard run={run} />
      </aside>
      <section className="card wb-card">
        {step.kind === 'gate' ? <GateView run={run} step={step} />
          : <StepWorkspace run={run} step={step} initialFilters={filters} onException={setExceptionId} onDetails={() => setDetails(true)} chat={<ChatSlot />} />}
      </section>
      {exception ? (
        <Sheet eyebrow="Exceção" title={readable(exception.kind)} sub={`${exception.merchant} · ${exception.ref_origem}`} onClose={() => setExceptionId(null)}
          footer={run.status === 'awaiting_approval' && !run.draft
            ? <Link className="btn primary" to={`/runs/${run.id}/revisao?passo=${exception.step_type}`}><Icon name="arrowRight" />Decidir na revisão</Link> : undefined}>
          {/* The data desk is read-only: decisions happen in the Revisão tab. */}
          <ExceptionDetail exception={exception} run={run} editable={false} />
        </Sheet>
      ) : details ? (
        <Sheet eyebrow="Detalhes do passo" title={step.title} onClose={() => setDetails(false)}>
          <StepDetail run={run} step={step} onException={id => { setDetails(false); setExceptionId(id); }} />
        </Sheet>
      ) : null}
    </div>
  );
}
