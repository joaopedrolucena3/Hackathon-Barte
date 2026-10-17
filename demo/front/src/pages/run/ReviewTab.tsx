// B5: human approval before the ERP. One queue for every exception (formerly "Pendências").
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { agent, type ReviewException, type Run } from '../../api/agent';
import { DecisionBadge, ExceptionDetail, type DecisionPreset } from '../../components/ExceptionDetail';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Overlay';
import { RunLauncher } from '../../components/RunLauncher';
import { useToast } from '../../components/Toast';
import { Badge, Callout, Count, Empty, Field, HashChip, Loading, Money, ReasonInput, Segmented, Tip } from '../../components/ui';
import { count, dateBR, dateTimeBR, moneyShort, plural, readable } from '../../lib/format';
import { keys, useApprovalSummary, useExceptions } from '../../state/queries';
import { useAction } from '../../state/useAction';
import { useQueryClient } from '@tanstack/react-query';

type StatusFilter = 'open' | 'decided' | 'all';
type SeverityFilter = 'all' | 'bloqueante' | 'alerta';
const GROUP_LIMIT = 40;

function Summary({ run }: { run: Run }) {
  const { data: s } = useApprovalSummary(run.id);
  if (!s) return <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />;
  return (
    <div className="review-summary">
      <div className="kpi">
        <span className="kpi-label">Exceções decididas</span>
        <span className="kpi-value num"><Count value={s.decided} animate /><small className="muted" style={{ fontSize: 15, fontWeight: 500 }}> de {count(s.total)}</small></span>
        <div className="meter"><span style={{ flexGrow: s.decided, background: 'var(--st-good)' }} /><span style={{ flexGrow: s.total - s.decided, background: 'var(--surface-3)' }} /></div>
      </div>
      <div className={`kpi ${s.open_blocking ? 'attention' : ''}`}>
        <span className="kpi-label">Bloqueantes abertas <Badge tone="critical" dot>Bloqueante</Badge></span>
        <span className="kpi-value num"><Count value={s.open_blocking} animate /><small className="muted" style={{ fontSize: 15, fontWeight: 500 }}> de {count(s.blocking)}</small></span>
        <span className="kpi-detail">{s.open_blocking ? 'Decida uma a uma antes de aprovar' : 'Nenhuma bloqueia a aprovação'}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Alertas abertos <Badge tone="warning" dot>Alerta</Badge></span>
        <span className="kpi-value num"><Count value={s.open_alerts} animate /><small className="muted" style={{ fontSize: 15, fontWeight: 500 }}> de {count(s.alerts)}</small></span>
        <span className="kpi-detail">Podem ser aceitos em lote</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Impacto em aberto</span>
        <span className="kpi-value"><Money value={s.open_impact_brl} animate /></span>
        <span className="kpi-detail">de {moneyShort(s.impact_brl)} em exceções (valores absolutos)</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Lote a exportar {s.batch.balanced && <Badge tone="good" dot>Balanceado</Badge>}</span>
        <span className="kpi-value num"><Count value={s.batch.entries} animate /><small className="muted" style={{ fontSize: 15, fontWeight: 500 }}> lançamentos</small></span>
        <span className="kpi-detail">Débitos {moneyShort(s.batch.debit_brl)} = créditos {moneyShort(s.batch.credit_brl)}{s.batch.excluded ? ` · ${s.batch.excluded} excluídos` : ''}</span>
      </div>
    </div>
  );
}

function ApproveModal({ run, onClose }: { run: Run; onClose: () => void }) {
  const { data: s } = useApprovalSummary(run.id);
  const [comment, setComment] = useState('');
  const { run: act, busy } = useAction();
  return (
    <Modal eyebrow="Aprovação humana" title="Aprovar e exportar para o Fênix" sub="O lote segue para exportação. A decisão fica na trilha de auditoria." onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn success" disabled={!!busy || !comment.trim()} onClick={async () => {
          if (await act('approve', () => agent.approve(run.id, comment), { success: 'Lote aprovado. Exportação em andamento.', invalidate: [keys.run(run.id), keys.approval(run.id), ['checklist'], ['runs']] })) onClose();
        }}><Icon name="check" />Aprovar e exportar</button></>}>
      {s && (
        <div className="stack-lg">
          <dl className="facts">
            <div><dt>Exceções decididas</dt><dd>{count(s.decided)} de {count(s.total)}</dd></div>
            <div><dt>Bloqueantes abertas</dt><dd>{count(s.open_blocking)}</dd></div>
            <div><dt>Alertas abertos</dt><dd>{count(s.open_alerts)}</dd></div>
            <div><dt>Lançamentos no lote</dt><dd>{count(s.batch.entries)}</dd></div>
            <div><dt>Débitos = créditos</dt><dd><Money value={s.batch.debit_brl} /></dd></div>
            <div><dt>Excluídos do lote</dt><dd>{count(s.batch.excluded)}</dd></div>
          </dl>
          {s.open_alerts > 0 && <Callout tone="warning" icon="alert">{plural(s.open_alerts, 'alerta segue aberto', 'alertas seguem abertos')} e aparecem no relatório de exceções.</Callout>}
          <Field label="Justificativa da aprovação" required><ReasonInput value={comment} onChange={setComment} required suggestions={['Exceções revisadas', 'Alertas com responsável definido']} /></Field>
        </div>
      )}
    </Modal>
  );
}

function RejectModal({ run, onClose }: { run: Run; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const { run: act, busy } = useAction();
  return (
    <Modal title="Reprovar o run" sub="Nada é exportado. O run fica reprovado e você pode rodar de novo." onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn danger" disabled={!!busy || !comment.trim()} onClick={async () => {
          if (await act('reject', () => agent.reject(run.id, comment), { success: 'Run reprovado.', invalidate: [keys.run(run.id), ['checklist'], ['runs']] })) onClose();
        }}>Reprovar</button></>}>
      <Field label="Motivo da reprovação" required><ReasonInput value={comment} onChange={setComment} suggestions={['Taxa precisa ser corrigida no cadastro', 'Arquivo de origem incorreto', 'Aguardar resposta do parceiro']} /></Field>
    </Modal>
  );
}

function Downloads({ run }: { run: Run }) {
  const toast = useToast();
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div><h3 className="card-title row"><Icon name="check" />Aprovado e exportado</h3><p className="card-sub">Por {run.approval?.actor} em {dateTimeBR(run.approval?.at)}{run.approval?.comment ? ` · “${run.approval.comment}”` : ''}</p></div></div>
      <div className="card-body download-row">
        {(run.exports || []).map(file => (
          <div key={file.name} className="download-card">
            <Icon name="file" />
            <div className="grow"><strong>{file.name}</strong><span className="muted">{file.rows === undefined ? 'Documento de auditoria' : plural(file.rows, 'registro', 'registros')}</span></div>
            <HashChip hash={file.sha256} />
            <button className="btn sm" onClick={() => agent.downloadExport(run.id, file.name).catch(toast.error)}><Icon name="download" />Baixar</button>
          </div>
        ))}
        {!run.exports?.length && <Loading label="Gerando arquivos de exportação…" />}
      </div>
    </div>
  );
}

export default function ReviewTab({ run }: { run: Run }) {
  const [params, setParams] = useSearchParams();
  const { data: exceptions, isLoading, error } = useExceptions(run.id, ['awaiting_approval', 'approved', 'rejected'].includes(run.status) || (run.draft && run.status === 'done'));
  const { data: summary } = useApprovalSummary(run.id, ['awaiting_approval', 'approved', 'rejected'].includes(run.status));
  const client = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>(params.get('ex') ? 'all' : 'open');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preset, setPreset] = useState<DecisionPreset | null>(null);
  const [modal, setModal] = useState<'approve' | 'reject' | 'rerun' | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [bulkNote, setBulkNote] = useState('');
  const [merchantBatch, setMerchantBatch] = useState<{ ids: string[]; merchant: string; kind: string; action: 'exclude' | 'accept'; note: string; busy?: boolean } | null>(null);
  const tipo = params.get('tipo');
  const steps = params.get('passo')?.split(',').filter(Boolean);
  const editable = run.status === 'awaiting_approval' && !run.draft;

  const visible = useMemo(() => (exceptions || []).filter(item =>
    (status === 'all' || (status === 'open' ? !item.decision : !!item.decision))
    && (severity === 'all' || item.severity === severity)
    && (!tipo || item.kind === tipo) && (!steps?.length || steps.includes(item.step_type))
    && (!term || `${item.merchant} ${item.ref_origem} ${item.description}`.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR')))),
  [exceptions, status, severity, tipo, steps?.join(','), term]);
  const groups = useMemo(() => {
    const map = new Map<string, ReviewException[]>();
    for (const item of visible) { const key = `${item.kind}|${item.step_type}`; map.set(key, [...(map.get(key) || []), item]); }
    return [...map].sort(([, a], [, b]) => Number(b.some(i => i.severity === 'bloqueante')) - Number(a.some(i => i.severity === 'bloqueante')) || b.length - a.length);
  }, [visible]);
  const order = groups.flatMap(([group, items]) => (expanded[group] ? items : items.slice(0, GROUP_LIMIT)));
  const currentId = params.get('ex') || order[0]?.id;
  const current = exceptions?.find(item => item.id === currentId);
  useEffect(() => { setSelected(new Set()); }, [status, severity, tipo, term]);

  if (!['awaiting_approval', 'approved', 'rejected'].includes(run.status) && !(run.draft && run.status === 'done')) {
    return <div className="card"><Empty icon="lock" title="A revisão abre quando o agente chega à aprovação">{run.status === 'failed' ? 'Este run falhou antes do portão.' : 'Acompanhe os passos na aba Passos.'}</Empty></div>;
  }
  if (error) return <Callout tone="critical" icon="alert">{error.message}</Callout>;
  if (isLoading || !exceptions) return <Loading label="Carregando exceções…" />;

  const open = (id: string) => setParams(current => { current.set('ex', id); return current; }, { replace: true });
  const nextOpen = (afterId: string) => {
    const index = order.findIndex(item => item.id === afterId);
    return [...order.slice(index + 1), ...order.slice(0, index)].find(item => !item.decision && item.id !== afterId);
  };
  const selectableAlerts = (items: ReviewException[]) => items.filter(item => item.severity === 'alerta' && !item.decision);
  const toggle = (id: string) => setSelected(set => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const acceptBulk = async () => {
    const ids = [...selected];
    setBulk({ done: 0, total: ids.length });
    try {
      const result = await agent.decideMany(run.id, ids, { action: 'accept', note: bulkNote }, done => setBulk({ done, total: ids.length }));
      toast.ok(`${plural(result.decided, 'alerta aceito', 'alertas aceitos')} em lote.`);
    } catch (error) {
      toast.error(error);
    } finally {
      setBulk(null); setSelected(new Set()); setBulkNote('');
      for (const key of [keys.exceptions(run.id), keys.approval(run.id), keys.state, ['checklist'], ['insights'], keys.audit(run.id)]) void client.invalidateQueries({ queryKey: key });
    }
  };
  /** Open blockers of one issue for one merchant: a single business decision, so the backend takes them together. */
  const merchantBlockers = (kind: string, cnpj?: string) => cnpj
    ? exceptions.filter(item => item.kind === kind && item.cnpj === cnpj && item.severity === 'bloqueante' && !item.decision) : [];
  const decideMerchant = async () => {
    if (!merchantBatch) return;
    const { ids, action, note, merchant } = merchantBatch;
    setMerchantBatch({ ...merchantBatch, busy: true });
    try {
      const result = await agent.decideMany(run.id, ids, { action, note });
      toast.ok(`${plural(result.decided, 'bloqueante', 'bloqueantes')} de ${merchant} ${action === 'exclude' ? 'excluídas do lote' : 'aceitas'}.`);
      setMerchantBatch(null);
    } catch (error) {
      toast.error(error);
      setMerchantBatch(state => state && { ...state, busy: false });
    } finally {
      for (const key of [keys.exceptions(run.id), keys.approval(run.id), keys.state, ['checklist'], ['insights'], keys.audit(run.id)]) void client.invalidateQueries({ queryKey: key });
    }
  };
  const blocking = summary?.open_blocking || 0;

  return (
    <>
      <Summary run={run} />
      {run.status === 'approved' && <Downloads run={run} />}
      {run.status === 'rejected' && (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="critical" icon="x"><strong>Reprovado por {run.approval?.actor}</strong> em {dateTimeBR(run.approval?.at)}: “{run.approval?.comment}”. <button className="link" onClick={() => setModal('rerun')}>Rodar de novo</button></Callout>
        </div>
      )}
      {run.draft && <div style={{ marginBottom: 16 }}><Callout tone="gate" icon="lock">Run de teste do construtor: mostra as exceções, mas não aceita decisões nem exportação.</Callout></div>}

      <div className="review-layout">
        <section className="card review-list">
          <div className="table-toolbar">
            <label className="search"><Icon name="search" /><input className="input sm" type="search" value={term} onChange={event => setTerm(event.target.value)} placeholder="Buscar lojista, referência ou motivo" /></label>
            <Segmented value={status} onChange={setStatus} label="Situação" options={[{ value: 'open', label: 'Abertas' }, { value: 'decided', label: 'Decididas' }, { value: 'all', label: 'Todas' }]} />
            <Segmented value={severity} onChange={setSeverity} label="Severidade" options={[{ value: 'all', label: 'Todas' }, { value: 'bloqueante', label: 'Bloqueantes' }, { value: 'alerta', label: 'Alertas' }]} />
            {(tipo || steps?.length) && (
              <span className="chip">{tipo ? readable(tipo) : `Passo: ${steps!.length > 1 ? `${steps!.length} passos` : steps![0]}`}
                <button className="icon-btn" style={{ width: 18, height: 18 }} aria-label="Limpar filtro" onClick={() => setParams({})}><Icon name="x" size={12} /></button></span>
            )}
          </div>
          {selected.size > 0 && editable && (
            <div className="bulk-bar">
              <strong>{plural(selected.size, 'alerta selecionado', 'alertas selecionados')}</strong>
              <input className="input sm grow" value={bulkNote} onChange={event => setBulkNote(event.target.value)} placeholder="Justificativa para aceitar o lote" aria-label="Justificativa para aceitar o lote" required />
              <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Limpar</button>
              <button className="btn sm success" disabled={!!bulk || !bulkNote.trim()} onClick={acceptBulk}>
                {bulk ? <><span className="spin" />Aceitando {bulk.done}/{bulk.total}</> : <><Icon name="check" />Aceitar em lote</>}
              </button>
            </div>
          )}
          {merchantBatch && editable && (
            <div className="bulk-bar blocker">
              <strong>{plural(merchantBatch.ids.length, 'bloqueante', 'bloqueantes')} de {merchantBatch.merchant}</strong>
              <Segmented value={merchantBatch.action} label="Decisão para todas" onChange={action => setMerchantBatch({ ...merchantBatch, action })}
                options={[{ value: 'exclude', label: 'Excluir do lote' }, { value: 'accept', label: 'Aceitar' }]} />
              <input className="input sm grow" value={merchantBatch.note} onChange={event => setMerchantBatch({ ...merchantBatch, note: event.target.value })}
                placeholder="Justificativa para todas" aria-label="Justificativa para todas as bloqueantes do lojista" required />
              <button className="btn sm ghost" disabled={merchantBatch.busy} onClick={() => setMerchantBatch(null)}>Cancelar</button>
              <button className={`btn sm ${merchantBatch.action === 'exclude' ? 'danger' : 'success'}`} disabled={merchantBatch.busy || !merchantBatch.note.trim()} onClick={decideMerchant}>
                {merchantBatch.busy ? <><span className="spin" />Registrando…</> : <><Icon name="check" />{merchantBatch.action === 'exclude' ? 'Excluir' : 'Aceitar'} {count(merchantBatch.ids.length)}</>}
              </button>
            </div>
          )}
          {groups.length ? (
            <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <table className="table">
                <thead>
                  <tr><th style={{ width: 34 }} /><th>Severidade</th><th>Lojista</th><th>Data</th><th className="r">Valor</th><th className="r">Impacto</th><th>Decisão</th></tr>
                </thead>
                <tbody>
                  {groups.map(([group, items]) => {
                    const kind = group.split('|')[0];
                    const alerts = selectableAlerts(items);
                    const all = alerts.length > 0 && alerts.every(item => selected.has(item.id));
                    const shown = expanded[group] ? items : items.slice(0, GROUP_LIMIT);
                    const blockers = merchantBlockers(kind, items.find(item => item.severity === 'bloqueante' && !item.decision)?.cnpj);
                    return (
                      <Fragment key={group}>
                        <tr className="group-row">
                          <td>{editable && alerts.length > 0 && <input type="checkbox" checked={all} aria-label={`Selecionar alertas de ${readable(kind)}`} onChange={() => setSelected(set => { const next = new Set(set); alerts.forEach(item => (all ? next.delete(item.id) : next.add(item.id))); return next; })} />}</td>
                          <td colSpan={6}><span className="row between"><span>{readable(kind)} · {items[0].step_title}</span><span className="row" style={{ gap: 12 }}>
                            {editable && blockers.length > 1 && (
                              <button className="link" onClick={() => setMerchantBatch({ ids: blockers.map(item => item.id), merchant: blockers[0].merchant, kind, action: 'exclude', note: '' })}>
                                Decidir as {count(blockers.length)} de {blockers[0].merchant}
                              </button>
                            )}
                            <span className="muted">{plural(items.length, 'item', 'itens')} · {plural(items.filter(item => !item.decision).length, 'aberto', 'abertos')}</span>
                          </span></span></td>
                        </tr>
                        {shown.map(item => (
                          <tr key={item.id} className={`clickable ${item.id === currentId ? 'selected' : ''}`} onClick={() => open(item.id)}>
                            <td onClick={event => event.stopPropagation()}>
                              {editable && item.severity === 'alerta' && !item.decision
                                ? <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Selecionar ${item.ref_origem}`} />
                                : item.severity === 'bloqueante' && !item.decision ? <Tip text="Bloqueantes são decididas uma a uma ou todas do mesmo lojista"><Icon name="lock" className="muted" size={13} /></Tip> : null}
                            </td>
                            <td><Badge tone={item.severity === 'bloqueante' ? 'critical' : 'warning'} dot>{item.severity === 'bloqueante' ? 'Bloqueante' : 'Alerta'}</Badge></td>
                            <td className="wrap" style={{ minWidth: 180 }}><span className="strong">{item.merchant}</span><span className="mono muted" style={{ display: 'block', fontSize: 11 }}>{item.ref_origem}</span></td>
                            <td className="nowrap">{dateBR(item.date)}</td>
                            <td className="r">{item.amount ? <Money value={item.amount} /> : '—'}</td>
                            <td className="r"><Money value={item.impact_brl} /></td>
                            <td><DecisionBadge exception={item} /></td>
                          </tr>
                        ))}
                        {items.length > GROUP_LIMIT && !expanded[group] && (
                          <tr><td /><td colSpan={6}><button className="link" onClick={() => setExpanded(state => ({ ...state, [group]: true }))}>Mostrar mais {count(items.length - GROUP_LIMIT)} de {readable(kind).toLocaleLowerCase('pt-BR')}</button></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="check" title={status === 'open' ? 'Nenhuma exceção aberta com esses filtros' : 'Nada para mostrar'}>{status === 'open' && exceptions.length ? 'Tudo decidido por aqui.' : ''}</Empty>}
        </section>
        <aside className="card review-detail">
          <div className="card-body">
            {current ? (
              <ExceptionDetail key={current.id} exception={current} run={run} editable={editable} preset={preset}
                onDecided={(item, decision) => { setPreset(decision); const next = nextOpen(item.id); if (next) open(next.id); }} />
            ) : <Empty icon="info" title="Selecione uma exceção" />}
          </div>
        </aside>
      </div>

      {editable && (
        <div className="approval-bar">
          <span className="grow">{blocking ? <><strong>{plural(blocking, 'bloqueante sem decisão', 'bloqueantes sem decisão')}.</strong> A aprovação libera quando todas forem decididas.</> : <><strong>Nenhuma bloqueante aberta.</strong> O lote pode seguir para o ERP.</>}</span>
          <button className="btn danger" onClick={() => setModal('reject')}>Reprovar</button>
          {blocking ? (
            <Tip text={`Faltam ${blocking} bloqueantes`}><button className="btn success" disabled><Icon name="lock" />Aprovar e exportar</button></Tip>
          ) : <button className="btn success" onClick={() => setModal('approve')}><Icon name="check" />Aprovar e exportar</button>}
        </div>
      )}
      {modal === 'approve' && <ApproveModal run={run} onClose={() => setModal(null)} />}
      {modal === 'reject' && <RejectModal run={run} onClose={() => setModal(null)} />}
      {modal === 'rerun' && <RunLauncher comp={run.comp} onClose={() => setModal(null)} />}
    </>
  );
}
