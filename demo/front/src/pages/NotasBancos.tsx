// Invoices and banks in one place: from the proposed invoice to the approved charge and the classified bank line.
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { core } from '../api/core';
import type { AppState, Email, Lancamento, Nota, Pendencia } from '../api/types';
import { HBarChart } from '../components/charts/Bars';
import { DayBars } from '../components/charts/DayBars';
import { EmailEditor, emailStage } from '../components/EmailEditor';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Overlay';
import { TopbarSlot } from '../components/TopbarSlot';
import { TraceView } from '../components/TraceView';
import { Badge, Callout, DateBR, Empty, Loading, Money, OriginButton, PageHead, ReasonInput, Segmented, Tabs } from '../components/ui';
import { cnpj, count, moneyShort, periodShort, plural, readable } from '../lib/format';
import { keys, lastComp, useAppState, useInsights, useRuns } from '../state/queries';
import { useAction } from '../state/useAction';

type Tab = 'notas' | 'bancos';
const STAGES = ['Proposta', 'Rascunho', 'Aprovada', 'Enviada'];

function latestBilling(emails: Email[], invoiceId: string) {
  return emails.filter(email => email.kind === 'billing' && email.related_id === invoiceId)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
}

function Stepper({ step, label, tone }: { step: number; label: string; tone: string }) {
  return (
    <div className="stepper" aria-label={`Etapa da cobrança: ${label}`}>
      <div className="stepper-track">
        {STAGES.map((stage, index) => <span key={stage} className={`stepper-dot ${index < step ? 'done' : index === step ? `current ${tone}` : ''}`} title={stage} />)}
      </div>
      <span className="stepper-label">{label}</span>
    </div>
  );
}

/** One invoice per row: who, how much, what for, where the charge stands and its one next action. */
function InvoiceRow({ nota, email, onOpen, onDraft, onTrace, busy }: {
  nota: Nota; email?: Email; onOpen: (id: string) => void; onDraft: () => void; onTrace: () => void; busy: boolean;
}) {
  const stage = emailStage(email);
  const remessa = nota.linha_negocio === 'REMESSA';
  let action;
  if (!email || email.stale) action = <button className="btn xs" disabled={busy} onClick={onDraft}><Icon name="mail" />{email?.stale ? 'Gerar novo rascunho' : 'Preparar cobrança'}</button>;
  else if (stage.step === 3) action = <button className="btn xs ghost" onClick={() => onOpen(email.id)}><Icon name="eye" />Ver registro</button>;
  else if (stage.step === 2) action = <button className="btn xs primary" onClick={() => onOpen(email.id)}><Icon name="send" />Simular envio</button>;
  else action = <button className="btn xs" onClick={() => onOpen(email.id)}><Icon name="edit" />Revisar cobrança</button>;
  return (
    <tr>
      <td className="wrap" style={{ minWidth: 200 }}>
        <span className="strong" title={nota.tomador}>{nota.tomador}</span>
        <span className="mono muted cell-sub">{cnpj(nota.tomador_cnpj)}</span>
      </td>
      <td><Badge tone={remessa ? 'gate' : 'info'}>{remessa ? 'Remessa' : 'Checkout'}</Badge></td>
      <td className="r"><span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}><span className="strong"><Money value={nota.valor_brl} /></span><OriginButton onClick={onTrace} label="Ver composição da nota" /></span></td>
      <td className="wrap"><span className="invoice-desc" title={nota.discriminacao}>{nota.discriminacao}</span></td>
      <td><Stepper step={stage.step} label={stage.label} tone={stage.tone} />{email?.to && <span className="muted cell-sub">{email.to}</span>}</td>
      <td className="r">{action}</td>
    </tr>
  );
}

function NotasTab({ state, onTrace }: { state: AppState; onTrace: (id: string, title: string) => void }) {
  const [line, setLine] = useState<'ALL' | 'CHECKOUT' | 'REMESSA'>('ALL');
  const [stage, setStage] = useState<'all' | number>('all');
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<{ id: string; cnpj: string } | null>(null);
  const { run, busy } = useAction();
  const notas = useMemo(() => [...state.results.notas].sort((a, b) => Number(b.valor_brl) - Number(a.valor_brl)), [state]);
  const list = notas.filter(nota => {
    const email = latestBilling(state.emails, nota.id_saida);
    return (line === 'ALL' || nota.linha_negocio === line) && (stage === 'all' || emailStage(email).step === stage)
      && (!term || `${nota.tomador} ${nota.tomador_cnpj}`.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR')));
  });
  const draft = async (nota: Nota) => {
    const result = await run(nota.id_saida, () => core.draftEmail({ invoice_id: nota.id_saida }), { success: 'Rascunho preparado. Revise destinatário e texto antes de aprovar.', invalidate: [keys.state] });
    const id = result?.id || result?.email?.id;
    if (id) setEditing({ id, cnpj: nota.tomador_cnpj });
  };
  return (
    <div className="stack-lg">
      <details className="card collapsible">
        <summary className="card-head"><div><h3 className="card-title">Faturamento por tomador</h3><p className="card-sub">Maiores notas propostas · clique numa barra para ver a composição</p></div><Icon name="chevronDown" className="collapse-icon" /></summary>
        <div className="card-body">
          <HBarChart ariaLabel="Valor das notas por tomador" labelWidth={230}
            data={notas.slice(0, 8).map(nota => ({ key: nota.id_saida, label: nota.tomador, value: Number(nota.valor_brl), display: moneyShort(nota.valor_brl), sub: nota.linha_negocio === 'REMESSA' ? 'remessa' : undefined }))}
            onSelect={key => { const nota = notas.find(item => item.id_saida === key); if (nota) onTrace(nota.id_saida, nota.tomador); }} />
        </div>
      </details>
      <div className="filter-bar">
        <label className="search" style={{ maxWidth: 320 }}><Icon name="search" /><input className="input" type="search" placeholder="Buscar tomador ou CNPJ" value={term} onChange={event => setTerm(event.target.value)} /></label>
        <Segmented value={line} onChange={setLine} label="Linha" options={[{ value: 'ALL', label: 'Todas' }, { value: 'CHECKOUT', label: 'Checkout' }, { value: 'REMESSA', label: 'Remessa' }]} />
        <Segmented<string> value={String(stage)} onChange={value => setStage(value === 'all' ? 'all' : Number(value))} label="Etapa"
          options={[{ value: 'all', label: 'Todas as etapas' }, ...STAGES.map((label, index) => ({ value: String(index), label }))]} />
      </div>
      {list.length ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Tomador</th><th>Linha</th><th className="r">Valor</th><th>Discriminação</th><th>Cobrança</th><th className="r"><span className="sr-only">Ação</span></th></tr></thead>
            <tbody>
              {list.map(nota => {
                const email = latestBilling(state.emails, nota.id_saida);
                return <InvoiceRow key={nota.id_saida} nota={nota} email={email} busy={busy === nota.id_saida}
                  onOpen={id => setEditing({ id, cnpj: nota.tomador_cnpj })} onDraft={() => draft(nota)} onTrace={() => onTrace(nota.id_saida, nota.tomador)} />;
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><Empty icon="search" title="Nenhuma nota com esses filtros" /></div>}
      {editing && <EmailEditor emailId={editing.id} cnpj={editing.cnpj} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Reclassify({ id, current, state, onDone }: { id: string; current: string; state: AppState; onDone: () => void }) {
  const [account, setAccount] = useState(current);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const accounts = state.accounts.filter(item => item.postable);
  return (
    <form className="reclassify" onSubmit={async event => {
      event.preventDefault();
      if (await run('reclass', () => core.decide({ id, action: 'adjust', account_code: account, note }), { success: 'Lançamento reclassificado com decisão humana.', invalidate: [keys.state, ['insights']] })) onDone();
    }}>
      <label className="field"><span>Nova conta (somente analíticas)</span>
        <select className="select sm" value={account} onChange={event => setAccount(event.target.value)}>
          {accounts.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
        </select>
      </label>
      <ReasonInput value={note} onChange={setNote} suggestions={['Conferido no extrato', 'Orientação da contabilidade', 'Histórico identificado']} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn xs ghost" onClick={onDone}>Cancelar</button>
        <button type="submit" className="btn xs primary" disabled={!!busy || !note.trim() || account === current}>Reclassificar</button>
      </div>
    </form>
  );
}

function BancosTab({ state, onTrace }: { state: AppState; onTrace: (id: string, title: string) => void }) {
  const { data: insights } = useInsights(state.period);
  const { data: runs } = useRuns(state.period);
  const reviewRun = runs?.find(run => run.status === 'awaiting_approval');
  const [bank, setBank] = useState('ALL');
  const [account, setAccount] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const bankIssues = state.results.pendencias.filter(p => p.status !== 'resolved' && p.evidence?.[0]?.arquivo.startsWith('05'));
  const lines = state.results.lancamentos.filter(line => (bank === 'ALL' || line.banco === bank) && (!account || line.conta_codigo === account)
    && (!term || `${line.descricao} ${line.ref_origem} ${line.conta_descricao}`.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))));
  const groups = useMemo(() => {
    const map = new Map<string, Lancamento[]>();
    for (const line of lines) map.set(line.conta_codigo, [...(map.get(line.conta_codigo) || []), line]);
    const order = new Map((insights?.contas || []).map((item, index) => [item.code, index]));
    return [...map].sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [lines, insights]);
  const totals = new Map((insights?.contas || []).map(item => [item.code, item]));
  const issueLine = (p: Pendencia) => state.results.lancamentos.find(line => line.ref_origem === p.ref_origem);

  return (
    <div className="stack-lg">
      {bankIssues.length > 0 && (
        <div className="card attention-card">
          <div className="card-head"><div><h3 className="card-title row"><Icon name="alert" />Precisa de você</h3><p className="card-sub">Lançamentos que as regras não classificam sozinhas</p></div>
            {reviewRun && <Link className="btn sm" to={`/runs/${reviewRun.id}/revisao?passo=classificar_bancos`}>Revisar no run <Icon name="arrowRight" /></Link>}</div>
          <div className="card-body stack" style={{ gap: 0 }}>
            {bankIssues.map(p => {
              const line = issueLine(p);
              return (
                <div key={p.id_saida} className="issue-row">
                  <div className="grow">
                    <div className="row wrap"><strong>{readable(p.tipo)}</strong><Badge tone={p.severity === 'bloqueante' ? 'critical' : p.severity === 'informativo' ? 'info' : 'warning'} dot>{p.severity === 'informativo' ? 'Informativo' : p.severity === 'bloqueante' ? 'Bloqueante' : 'Atenção'}</Badge></div>
                    <p className="text-2" style={{ fontSize: 12.5, marginTop: 2 }}>{p.motivo}</p>
                    {line && <p className="muted" style={{ fontSize: 12 }}>{line.banco} · <DateBR value={line.data} /> · {line.descricao}</p>}
                  </div>
                  <Money value={p.valor_brl} className="strong" />
                  {line && <button className="btn xs" onClick={() => setEditing(editing === p.id_saida ? null : p.id_saida)}><Icon name="edit" />Classificar</button>}
                  {editing === p.id_saida && line && <div style={{ flexBasis: '100%' }}><Reclassify id={p.id_saida} current={line.conta_codigo} state={state} onDone={() => setEditing(null)} /></div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-2">
        {(insights?.bancos || []).map(item => (
          <div key={item.bank} className="card">
            <div className="card-head">
              <div><h3 className="card-title row"><Icon name="bank" />{item.bank === 'AURORA' ? 'Banco Aurora' : item.bank === 'MERIDIANO' ? 'Banco Meridiano' : item.bank}</h3>
                <p className="card-sub">{item.bank === 'AURORA' ? 'cc 4471' : item.bank === 'MERIDIANO' ? 'cc 90233' : ''} · conta Fênix {item.account} · {plural(item.count, 'lançamento', 'lançamentos')}</p></div>
            </div>
            <div className="card-body stack" style={{ gap: 12 }}>
              <div className="bank-stats">
                <div><span className="muted">Entradas</span><strong className="num"><Money value={item.in_brl} /></strong></div>
                <div><span className="muted">Saídas</span><strong className="num"><Money value={item.out_brl} /></strong></div>
                <div><span className="muted">Líquido</span><strong className="num"><Money value={item.net_brl} /></strong></div>
              </div>
              <DayBars days={item.daily} ariaLabel={`Entradas e saídas por dia no ${item.bank}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <div><h3 className="card-title">Para onde foi cada lançamento</h3><p className="card-sub">Soma dos valores absolutos por conta Fênix · clique para filtrar a lista</p></div>
          {account && <button className="btn sm" onClick={() => setAccount(null)}><Icon name="x" />Limpar filtro</button>}
        </div>
        <div className="card-body">
          <HBarChart ariaLabel="Lançamentos por conta contábil" labelWidth={260}
            data={(insights?.contas || []).slice(0, 8).map(item => ({ key: item.code, label: `${item.code} · ${item.name}`, value: Number(item.abs_brl), display: moneyShort(item.abs_brl), sub: plural(item.count, 'lançamento', 'lançamentos') }))}
            onSelect={setAccount} />
        </div>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <label className="search"><Icon name="search" /><input className="input sm" type="search" placeholder="Buscar histórico, referência ou conta" value={term} onChange={event => setTerm(event.target.value)} /></label>
          <Segmented value={bank} onChange={setBank} label="Banco" options={[{ value: 'ALL', label: 'Todos' }, { value: 'AURORA', label: 'Aurora' }, { value: 'MERIDIANO', label: 'Meridiano' }]} />
        </div>
        {groups.length ? groups.map(([code, items]) => {
          const expanded = open[code] ?? (groups.length <= 3 || !!account);
          const info = totals.get(code);
          return (
            <div key={code} className="account-group">
              <button type="button" className="checklist-head" aria-expanded={expanded} onClick={() => setOpen(state => ({ ...state, [code]: !expanded }))}>
                <Icon name="chevronDown" className={expanded ? '' : 'rot'} />
                <span className="mono" style={{ fontSize: 12.5 }}>{code}</span>
                <span className="grow" style={{ textAlign: 'left', fontWeight: 560 }}>{items[0].conta_descricao}</span>
                <span className="muted num" style={{ fontSize: 12.5, fontWeight: 500 }}>{plural(items.length, 'lançamento', 'lançamentos')}{info && ` · ${moneyShort(info.abs_brl)}`}</span>
              </button>
              {expanded && (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      {items.map(line => (
                        <Fragment key={line.id_saida}>
                          <tr>
                            <td style={{ width: 96 }}><DateBR value={line.data} /></td>
                            <td style={{ width: 96 }}><Badge tone="outline">{line.banco === 'AURORA' ? 'Aurora' : 'Meridiano'}</Badge></td>
                            <td className="wrap">{line.descricao}<span className="mono muted" style={{ marginLeft: 8 }}>{line.ref_origem}</span></td>
                            <td><Badge tone={line.metodo === 'HUMANO' ? 'info' : 'good'}>{line.metodo === 'HUMANO' ? 'Humano' : 'Regra'}</Badge></td>
                            <td className="r"><Money value={line.valor} /></td>
                            <td className="r" style={{ width: 120 }}>
                              <span className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                                <OriginButton onClick={() => onTrace(line.id_saida, line.descricao)} />
                                <button className="btn xs ghost" onClick={() => setEditing(editing === line.id_saida ? null : line.id_saida)}><Icon name="edit" />Reclassificar</button>
                              </span>
                            </td>
                          </tr>
                          {editing === line.id_saida && <tr><td colSpan={6} style={{ background: 'var(--surface-2)' }}><Reclassify id={line.id_saida} current={line.conta_codigo} state={state} onDone={() => setEditing(null)} /></td></tr>}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        }) : <Empty icon="search" title="Nenhum lançamento com esses filtros" />}
      </div>
    </div>
  );
}

export default function NotasBancos() {
  const { data: state } = useAppState();
  const [params, setParams] = useSearchParams();
  const [trace, setTrace] = useState<{ id: string; title: string } | null>(null);
  const tab = (params.get('aba') as Tab) || 'notas';
  if (!state) return <Loading page />;
  const notes = state.results.notas;
  const billing = notes.map(nota => emailStage(latestBilling(state.emails, nota.id_saida)).step);
  const sent = billing.filter(step => step === 3).length, approved = billing.filter(step => step === 2).length, drafts = billing.filter(step => step === 1).length;
  const bankIssues = state.results.pendencias.filter(p => p.status !== 'resolved' && p.evidence?.[0]?.arquivo.startsWith('05')).length;
  const banks = new Set(state.results.lancamentos.map(line => line.banco)).size;

  return (
    <>
      <TopbarSlot><Icon name="calendar" /><span>Competência <strong>{periodShort(lastComp(state.period))}</strong></span></TopbarSlot>
      <PageHead title="Notas e bancos" sub="Da nota proposta à cobrança aprovada e ao lançamento classificado no banco. Todo envio é simulado." />
      <div className="kpi-strip kpi-strip-3" style={{ marginBottom: 16 }}>
        <button className={`kpi ${tab === 'notas' ? 'selected' : ''}`} onClick={() => setParams({ aba: 'notas' })}>
          <span className="kpi-label">Notas propostas <Icon name="invoice" /></span>
          <span className="kpi-value"><Money value={state.summary.notas_brl} /></span>
          <span className="kpi-detail">{plural(notes.length, 'nota', 'notas')} · {notes.filter(nota => nota.linha_negocio === 'REMESSA').length} de remessa</span>
        </button>
        <button className={`kpi ${tab === 'notas' ? 'selected' : ''}`} onClick={() => setParams({ aba: 'notas' })}>
          <span className="kpi-label">Cobranças <Icon name="mail" /></span>
          <span className="kpi-value num">{sent}<small> de {notes.length} enviadas</small></span>
          <div className="meter" aria-label={`${sent} enviadas, ${approved} aprovadas, ${drafts} em rascunho`}>
            <span style={{ flexGrow: sent, background: 'var(--st-good)' }} /><span style={{ flexGrow: approved, background: 'var(--st-info)' }} />
            <span style={{ flexGrow: drafts, background: 'var(--accent)' }} /><span style={{ flexGrow: notes.length - sent - approved - drafts, background: 'var(--surface-3)' }} />
          </div>
          <span className="kpi-detail">{count(approved)} aprovadas · {count(drafts)} em rascunho · {count(notes.length - sent - approved - drafts)} sem cobrança</span>
        </button>
        <button className={`kpi ${tab === 'bancos' ? 'selected' : ''} ${bankIssues ? 'attention' : ''}`} onClick={() => setParams({ aba: 'bancos' })}>
          <span className="kpi-label">Bancos <Icon name="bank" /></span>
          <span className="kpi-value num">{count(state.results.lancamentos.length)}<small> lançamentos</small></span>
          <span className="kpi-detail">{plural(banks, 'conta', 'contas')} · {bankIssues ? `${plural(bankIssues, 'item precisa', 'itens precisam')} de você` : 'tudo classificado'}</span>
        </button>
      </div>
      <Tabs<Tab> value={tab} onChange={value => setParams({ aba: value })}
        items={[{ value: 'notas', label: 'Notas e cobranças', icon: 'invoice', count: notes.length }, { value: 'bancos', label: 'Bancos', icon: 'bank', count: state.results.lancamentos.length }]} />
      {tab === 'notas' ? <NotasTab state={state} onTrace={(id, title) => setTrace({ id, title })} /> : <BancosTab state={state} onTrace={(id, title) => setTrace({ id, title })} />}
      <div style={{ marginTop: 18 }}><Callout tone="info">Notas são propostas de emissão, sem integração com NFS-e. Cobranças só saem depois de aprovadas, e o envio é simulado.</Callout></div>
      {trace && <Sheet eyebrow="Origem" title={trace.title} onClose={() => setTrace(null)}><TraceView id={trace.id} /></Sheet>}
    </>
  );
}
