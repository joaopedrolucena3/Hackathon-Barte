// Run view: steps on the left (B1/B4), live preview in the center (C8), details on the right.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Run, StepRun } from '../../api/agent';
import { DataPreview } from '../../components/DataPreview';
import { ExceptionDetail } from '../../components/ExceptionDetail';
import { Icon } from '../../components/Icon';
import { StepList } from '../../components/StepList';
import { Callout, Empty, HashChip, StatusBadge } from '../../components/ui';
import { count, dateTimeBR, duration, plural, readable } from '../../lib/format';
import { useCatalog, useExceptions, useRunEvents } from '../../state/queries';

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
        <h3 className="overlay-title" style={{ marginTop: 8 }}>{step.title}</h3>
        {item && <p className="text-2" style={{ fontSize: 13, marginTop: 4 }}>{item.description}</p>}
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

export function StepsTab({ run }: { run: Run }) {
  const [params, setParams] = useSearchParams();
  const [panel, setPanel] = useState(true);
  const [exceptionId, setExceptionId] = useState<string | null>(null);
  const manual = useRef(!!params.get('step'));
  const running = run.steps.find(step => step.status === 'running');
  const fallback = running || run.steps.find(step => step.status === 'awaiting_approval' || step.status === 'failed') || [...run.steps].reverse().find(step => step.status !== 'pending') || run.steps[0];
  const selectedId = params.get('step') || fallback?.id;
  const step = run.steps.find(item => item.id === selectedId) || fallback;
  const ref = params.get('ref');

  useRunEvents(run.id, event => {
    // Follow the agent while the user has not picked a step.
    if (event.type === 'step_started' && !manual.current) setParams(current => { current.set('step', event.step_id); current.delete('ref'); return current; }, { replace: true });
  });
  useEffect(() => { setExceptionId(null); }, [step?.id]);
  const select = (id: string) => { manual.current = true; setParams({ step: id }, { replace: true }); };
  const { data: exceptions } = useExceptions(run.id, !!exceptionId);
  const exception = exceptions?.find(item => item.id === exceptionId);
  const filters = useMemo(() => (ref && step && step.type !== 'classificar_bancos' ? [{ key: 'id', op: 'eq' as const, value: ref }] : undefined), [ref, step]);

  if (!step) return <Empty title="Este run não tem passos" />;
  return (
    <div className={`run-layout ${panel ? '' : 'collapsed'} ${run.status === 'awaiting_approval' ? 'has-banner' : ''}`}>
      <aside className="card run-steps">
        <div className="run-col-head"><span>Passos</span><span className="muted num">{run.steps.length}</span></div>
        <StepList steps={run.steps} selected={step.id} onSelect={select} onDetails={id => { select(id); setPanel(true); }} />
      </aside>
      <section className="card run-preview">
        <div className="run-col-head">
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{step.title}</strong>
            <StatusBadge status={step.status} />
          </div>
          <button type="button" className="btn xs ghost" onClick={() => setPanel(!panel)} aria-expanded={panel}><Icon name="panel" />{panel ? 'Ocultar detalhe' : 'Mostrar detalhe'}</button>
        </div>
        {step.kind === 'gate' ? (
          <div className="card-body stack-lg">
            {step.status === 'awaiting_approval' || run.status === 'awaiting_approval' ? (
              <Callout tone="gate" icon="pause">O agente parou antes do ERP. {plural(step.metrics.exceptions || 0, 'exceção aguarda', 'exceções aguardam')} decisão humana{step.metrics.blocking ? `, ${count(step.metrics.blocking)} bloqueantes` : ''}.</Callout>
            ) : step.status === 'approved' ? <Callout tone="good" icon="check">Lote aprovado por {run.approval?.actor} em {dateTimeBR(run.approval?.at)}.{run.approval?.comment && ` “${run.approval.comment}”`}</Callout>
              : step.status === 'rejected' ? <Callout tone="critical" icon="x">Reprovado por {run.approval?.actor}: “{run.approval?.comment}”.</Callout>
                : <Empty icon="lock" title="O portão de aprovação ainda não foi alcançado" />}
            {['awaiting_approval', 'approved', 'rejected'].includes(run.status) && <Link className="btn primary" style={{ alignSelf: 'flex-start' }} to={`/runs/${run.id}/revisao`}><Icon name="arrowRight" />Abrir a revisão</Link>}
          </div>
        ) : (
          <DataPreview runId={run.id} stepId={step.id} initialFilters={filters} onException={id => { setExceptionId(id); setPanel(true); }} />
        )}
      </section>
      {panel && (
        <aside className="card run-detail">
          <div className="card-body">
            {exception ? <ExceptionDetail exception={exception} run={run} editable={run.status === 'awaiting_approval' && !run.draft} onClose={() => setExceptionId(null)} />
              : <StepDetail run={run} step={step} onException={id => setExceptionId(id)} />}
          </div>
        </aside>
      )}
    </div>
  );
}
