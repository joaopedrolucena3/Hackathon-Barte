// B6: audit trail of the run (oldest first), run comparison by output hash, and the evidence base.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { agent, type AuditEntry, type Run, type RunComparison } from '../../api/agent';
import { downloads, OFFICIAL_EXPORTS } from '../../api/core';
import { Icon, type IconName } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { Badge, Callout, Empty, HashChip, Loading, Segmented, StatusBadge } from '../../components/ui';
import { count, dateTimeBR, duration, plural, readable, timeBR } from '../../lib/format';
import { useAppState, useAudit, useCatalog, useRuns } from '../../state/queries';

const ACTION_LABEL: Record<string, string> = { accept: 'Aceita', adjust: 'Ajustada', exclude: 'Excluída do lote', reject: 'Rejeitada' };
const AUDIT_ACTIONS: Record<string, string> = {
  decision: 'Decisão do analista', close: 'Fechamento concluído', reopen: 'Fechamento reaberto', rate_edit: 'Taxa alterada', merchant_edit: 'Lojista alterado',
  parameter_edit: 'Parâmetro alterado', contact_edit: 'Contato alterado', notifications_run: 'Avisos processados', import: 'Fontes importadas',
  recalculate: 'Fechamento recalculado', email_draft: 'Rascunho criado', email_save: 'Rascunho salvo', email_approve: 'E-mail aprovado', email_send: 'Envio simulado',
};

function Entry({ icon, tone, title, at, children }: { icon: IconName; tone?: string; title: React.ReactNode; at: string; children?: React.ReactNode }) {
  return (
    <li className="tl-item">
      <span className={`tl-icon ${tone || ''}`}><Icon name={icon} /></span>
      <div className="tl-body">
        <div className="row between wrap"><strong>{title}</strong><span className="muted num" style={{ fontSize: 12 }}>{dateTimeBR(at)}</span></div>
        {children}
      </div>
    </li>
  );
}

function StepEntry({ entry }: { entry: Extract<AuditEntry, { kind: 'step' }> }) {
  const { data: catalog } = useCatalog();
  const step = entry.step;
  const fields = catalog?.find(item => item.type === step.type)?.params_schema || [];
  return (
    <Entry icon={step.kind === 'gate' ? 'lock' : 'run'} tone={step.status} at={entry.at} title={<span className="row" style={{ gap: 8 }}>{step.title}<StatusBadge status={step.status} /></span>}>
      <p className="muted" style={{ fontSize: 12.5 }}>
        {timeBR(step.started_at)} → {timeBR(step.finished_at)} · {duration(step.duration_ms)} · código <span className="mono">{step.code_version}</span>
        {step.metrics.rows_out !== undefined && ` · ${plural(step.metrics.rows_out, 'linha', 'linhas')}`}{step.metrics.exceptions ? ` · ${plural(step.metrics.exceptions, 'exceção', 'exceções')}` : ''}
      </p>
      <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
        {fields.map(field => <span key={field.key} className="chip">{field.label}: {String(step.params[field.key])}{field.unit ? ` ${field.unit}` : ''}</span>)}
        {step.output_hash && <span className="row" style={{ gap: 4, fontSize: 12 }}><span className="muted">saída</span><HashChip hash={step.output_hash} /></span>}
      </div>
      {step.error && <p className="neg" style={{ fontSize: 12.5, marginTop: 4 }}>{step.error}</p>}
    </Entry>
  );
}

function Timeline({ run }: { run: Run }) {
  const { data: trail, isLoading } = useAudit(run.id);
  const [showAll, setShowAll] = useState(false);
  if (isLoading || !trail) return <Loading label="Montando a trilha…" />;
  const decisions = trail.entries.filter(entry => entry.kind === 'decision');
  const firstDecision = trail.entries.findIndex(entry => entry.kind === 'decision');
  const others = trail.entries.filter(entry => entry.kind !== 'decision');
  const items: (AuditEntry | 'decisions')[] = [...others];
  if (firstDecision >= 0) items.splice(others.findIndex(entry => entry.at > decisions[0].at) >= 0 ? others.findIndex(entry => entry.at > decisions[0].at) : others.length, 0, 'decisions');
  const shown = showAll ? decisions : decisions.slice(-12);

  return (
    <ol className="timeline-v">
      {items.map((entry, index) => {
        if (entry === 'decisions') {
          return (
            <Entry key="decisions" icon="check" tone="decision" at={decisions[decisions.length - 1].at} title={`Decisões de revisão (${count(decisions.length)})`}>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                {decisions.length > shown.length && <button className="link" style={{ fontSize: 12.5 }} onClick={() => setShowAll(true)}>Mostrar as {count(decisions.length - shown.length)} anteriores</button>}
                {shown.map(item => item.kind === 'decision' && (
                  <div key={`${item.exception_id}-${item.at}`} className="tl-decision">
                    <div className="row between wrap"><span><strong>{item.actor}</strong> · {ACTION_LABEL[item.action]} · {readable(item.title)}</span><span className="muted num" style={{ fontSize: 11.5 }}>{dateTimeBR(item.at)}</span></div>
                    <p className="muted" style={{ fontSize: 12 }}>{item.before} → <span className="text-2">{item.after}</span></p>
                    {item.note && <p style={{ fontSize: 12.5 }}>“{item.note}”</p>}
                    <Link className="link" style={{ fontSize: 11.5 }} to={`/runs/${run.id}/revisao?ex=${item.exception_id}`}>{item.exception_id}</Link>
                  </div>
                ))}
              </div>
            </Entry>
          );
        }
        switch (entry.kind) {
          case 'input_file':
            return (
              <Entry key={`f-${entry.file.name}`} icon="file" at={entry.at} title={<span className="mono" style={{ fontSize: 12.5 }}>{entry.file.name}</span>}>
                <div className="row wrap" style={{ gap: 10, fontSize: 12.5 }}>
                  <span className="muted">{entry.file.rows !== undefined ? `${count(entry.file.rows)} linhas lidas` : 'linhas não informadas'}{entry.file.discarded ? ` · ${count(entry.file.discarded)} descartadas` : ''}</span>
                  <HashChip hash={entry.file.sha256} size={12} />
                </div>
              </Entry>
            );
          case 'pipeline':
            return (
              <Entry key="pipeline" icon="pipeline" at={entry.at} title={<>Pipeline <Link className="link" to={`/pipeline?versao=${entry.pipeline.version}`}>{entry.pipeline.name} v{entry.pipeline.version}</Link></>}>
                <p className="muted" style={{ fontSize: 12.5 }}>Iniciado por {entry.actor} · código <span className="mono">{entry.code_version}</span></p>
              </Entry>
            );
          case 'step':
            return <StepEntry key={`s-${entry.step.id}`} entry={entry} />;
          case 'approval':
            return (
              <Entry key={`a-${index}`} icon={entry.approval.status === 'approved' ? 'check' : 'x'} tone={entry.approval.status} at={entry.at} title={`${entry.approval.status === 'approved' ? 'Aprovado' : 'Reprovado'} por ${entry.approval.actor}`}>
                {entry.approval.comment && <p style={{ fontSize: 12.5 }}>“{entry.approval.comment}”</p>}
              </Entry>
            );
          case 'export':
            return (
              <Entry key={`e-${entry.file.name}`} icon="download" tone="done" at={entry.at} title={<span className="mono" style={{ fontSize: 12.5 }}>{entry.file.name}</span>}>
                <div className="row wrap" style={{ gap: 10, fontSize: 12.5 }}><span className="muted">{plural(entry.file.rows, 'registro', 'registros')}</span><HashChip hash={entry.file.sha256} size={12} /></div>
              </Entry>
            );
          default:
            return null;
        }
      })}
    </ol>
  );
}

function Compare({ run }: { run: Run }) {
  const { data: runs } = useRuns(run.comp);
  const [other, setOther] = useState('');
  const [result, setResult] = useState<RunComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const options = (runs || []).filter(item => item.id !== run.id);
  return (
    <div className="card">
      <div className="card-head"><div><h3 className="card-title row"><Icon name="compare" />Comparar runs</h3><p className="card-sub">Mesmos arquivos e parâmetros devem gerar o mesmo hash em cada passo</p></div></div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {options.length ? (
          <div className="row wrap">
            <select className="select sm" style={{ width: 'auto', minWidth: 220 }} value={other} onChange={event => { setOther(event.target.value); setResult(null); }} aria-label="Run para comparar">
              <option value="">Escolha outro run de {run.comp.split('-').reverse().join('/')}</option>
              {options.map(item => <option key={item.id} value={item.id}>{item.id} · {dateTimeBR(item.created_at)}{item.draft ? ' · teste' : ''}</option>)}
            </select>
            <button className="btn sm" disabled={!other || busy} onClick={async () => {
              setBusy(true);
              try { setResult(await agent.compareRuns(run.id, other)); } catch (error) { toast.error(error); } finally { setBusy(false); }
            }}>Comparar</button>
          </div>
        ) : <p className="muted" style={{ fontSize: 13 }}>Rode o fechamento mais uma vez nesta competência para comparar.</p>}
        {result && (
          <>
            {result.reproducible
              ? <Callout tone="good" icon="check"><strong>Reprodutível ✓</strong> Os hashes de saída batem em todos os passos comparáveis.</Callout>
              : <Callout tone="warning" icon="alert"><strong>Resultados diferentes.</strong> Algum passo gerou saída diferente: confira arquivos, parâmetros e decisões.</Callout>}
            <table className="table">
              <thead><tr><th>Passo</th><th>{result.a.id}</th><th>{result.b.id}</th><th className="c">Igual?</th></tr></thead>
              <tbody>{result.steps.map(step => (
                <tr key={step.type}>
                  <td>{step.title}</td><td><HashChip hash={step.hash_a} /></td><td><HashChip hash={step.hash_b} /></td>
                  <td className="c">{!step.hash_a || !step.hash_b ? <span className="muted">não rodou nos dois</span> : step.match ? <Badge tone="good" dot>Igual</Badge> : <Badge tone="critical" dot>Diferente</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

type Side = 'hipoteses' | 'fontes' | 'historico' | 'downloads';

function Evidence() {
  const { data: state } = useAppState();
  const [side, setSide] = useState<Side>('hipoteses');
  if (!state) return null;
  const history = state.audit.filter(row => row.action !== 'decision');
  return (
    <div className="card">
      <div className="card-head" style={{ paddingBottom: 12 }}>
        <Segmented<Side> value={side} onChange={setSide} label="Evidências" options={[
          { value: 'hipoteses', label: 'Hipóteses' }, { value: 'fontes', label: 'Fontes' }, { value: 'historico', label: 'Histórico' }, { value: 'downloads', label: 'Saídas' },
        ]} />
      </div>
      <div className="card-body stack" style={{ gap: 10, maxHeight: 640, overflow: 'auto' }}>
        {side === 'hipoteses' && state.assumptions.map(item => (
          <details key={item.id} className="assumption">
            <summary><span className="mono muted">{item.id}</span> {item.question}</summary>
            <p><strong>Fonte:</strong> {item.source || '—'}</p>
            <p><strong>Decisão:</strong> {item.decision}</p>
            <p><strong>Se estiver errada:</strong> {item.impact}</p>
          </details>
        ))}
        {side === 'fontes' && (
          <>
            {state.validation.trace_ok ? <Callout tone="good" icon="check">Conferência de integridade do rastro aprovada pelo motor.</Callout> : <Callout tone="warning" icon="alert">O rastro exige revisão.</Callout>}
            {state.sources.map(source => (
              <div key={source.name} className="contact-row">
                <Icon name="file" />
                <div className="grow" style={{ minWidth: 0 }}><strong className="mono" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>{source.name}</strong><p className="muted" style={{ fontSize: 12 }}>{source.rows !== undefined ? `${count(source.rows)} linhas` : 'arquivo identificado'}</p></div>
                <HashChip hash={source.sha256} />
              </div>
            ))}
            {state.validation.warnings.map((warning, index) => <Callout key={index} tone="warning" icon="alert">{typeof warning === 'string' ? warning : JSON.stringify(warning)}</Callout>)}
          </>
        )}
        {side === 'historico' && (history.length ? history.map(row => (
          <div key={row.id} className="tl-decision">
            <div className="row between wrap"><strong>{AUDIT_ACTIONS[row.action] || readable(row.action)}</strong><span className="muted num" style={{ fontSize: 11.5 }}>{dateTimeBR(row.at)}</span></div>
            <p className="muted" style={{ fontSize: 12 }}>{row.actor}{row.detail.reason ? ` · “${String(row.detail.reason)}”` : ''}</p>
          </div>
        )) : <Empty icon="clock" title="Sem alterações registradas" />)}
        {side === 'downloads' && (
          <>
            {OFFICIAL_EXPORTS.map(([file, title, subtitle]) => (
              <a key={file} className="download-card" href={downloads.csv(file)} download><Icon name="download" /><div className="grow"><strong>{title}</strong><span className="muted">{subtitle} · {file}</span></div></a>
            ))}
            <a className="download-card" href={downloads.report} target="_blank" rel="noopener"><Icon name="file" /><div className="grow"><strong>Relatório imprimível</strong><span className="muted">Resultados, decisões e hipóteses</span></div></a>
            <a className="download-card" href={downloads.zip} download><Icon name="download" /><div className="grow"><strong>Pacote completo</strong><span className="muted">6 CSVs + relatório + hipóteses</span></div></a>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuditTab({ run }: { run: Run }) {
  const toast = useToast();
  return (
    <div className="audit-layout">
      <section className="card">
        <div className="card-head">
          <div><h3 className="card-title">Trilha de auditoria do {run.id}</h3><p className="card-sub">Arquivos, pipeline, passos, decisões, aprovação e exportação · mais recente embaixo</p></div>
          <button className="btn sm" onClick={() => agent.downloadExport(run.id, 'auditoria.json').catch(toast.error)}><Icon name="download" />Baixar trilha (JSON)</button>
        </div>
        <div className="card-body"><Timeline run={run} /></div>
      </section>
      <div className="stack-lg">
        <Compare run={run} />
        <Evidence />
      </div>
    </div>
  );
}
