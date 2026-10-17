// Reference data made simple: one merchant at a time, rates as a timeline, edits inline with one reason.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { core } from '../api/core';
import type { AppState, Contact, Merchant, Rate } from '../api/types';
import { rateIssues, VigenciaTimeline } from '../components/charts/VigenciaTimeline';
import { DataTable } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Overlay';
import { Badge, Callout, Empty, Field, Loading, Money, PageHead, ReasonInput, Segmented, Tabs, Toggle } from '../components/ui';
import { cnpj, count, dateBR, moneyShort, percent, plural, productNames } from '../lib/format';
import { keys, useAppState, useInsights, useOperationalConfig } from '../state/queries';
import { useAction } from '../state/useAction';

type Tab = 'lojistas' | 'contatos' | 'contas' | 'prazos';
const PRODUCTS = ['DEBITO', 'CREDITO_A_VISTA', 'CREDITO_2_6', 'CREDITO_7_12', 'PIX', 'ANTECIPACAO', 'REMESSA'];
const SEVERITY: Record<string, string> = { informativo: 'Informativo e acima', atencao: 'Atenção e bloqueante', bloqueante: 'Somente bloqueante' };

function RateEditor({ rate, product, merchant, onClose }: { rate?: Rate; product?: string; merchant: string; onClose: () => void }) {
  const [form, setForm] = useState({ product: rate?.product || product || 'DEBITO', rate_pct: rate?.rate_pct || '', start: rate?.start || '', end: rate?.end || '' });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const { run, busy } = useAction();
  const save = async () => {
    setError('');
    try {
      await run('rate', () => core.saveRate({ ...(rate ? { id: rate.id } : {}), cnpj: merchant, ...form, reason }), {
        success: 'Taxa salva com histórico. O fechamento foi reaberto para recálculo.', invalidate: [keys.state, ['insights']], rethrow: true,
      });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return (
    <div className="rate-editor">
      <div className="row between"><strong>{rate ? 'Editar vigência' : 'Nova vigência'}</strong><button className="icon-btn" onClick={onClose} aria-label="Fechar editor"><Icon name="x" /></button></div>
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <Field label="Produto"><select className="select" value={form.product} disabled={!!rate} onChange={event => setForm({ ...form, product: event.target.value })}>{PRODUCTS.map(code => <option key={code} value={code}>{productNames[code]}</option>)}</select></Field>
        <Field label="Taxa (%)" help="Ex.: 2,5% → 2.5"><input className="input" type="number" step="0.0001" min={0} max={100} value={form.rate_pct} onChange={event => setForm({ ...form, rate_pct: event.target.value })} /></Field>
        <Field label="Início"><input className="input" type="date" value={form.start} onChange={event => setForm({ ...form, start: event.target.value })} /></Field>
        <Field label="Fim" help="Vazio = em aberto"><input className="input" type="date" value={form.end} onChange={event => setForm({ ...form, end: event.target.value })} /></Field>
      </div>
      <Field label="Justificativa e origem do contrato" required><ReasonInput value={reason} onChange={setReason} /></Field>
      {error && <div className="form-error">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!!busy || !reason.trim() || form.rate_pct === ''} onClick={save}>Salvar e recalcular</button>
      </div>
    </div>
  );
}

function ContactForm({ contact, defaults, onClose }: { contact?: Contact; defaults?: Partial<Contact>; onClose: () => void }) {
  const [form, setForm] = useState({
    name: contact?.name || '', email: contact?.email || '', kind: contact?.kind || defaults?.kind || 'internal', cnpj: contact?.cnpj || defaults?.cnpj || '',
    min_severity: contact?.min_severity || 'atencao', frequency: contact?.frequency || 'digest', enabled: contact?.enabled ?? true,
  });
  const { run, busy } = useAction();
  return (
    <form className="rate-editor" onSubmit={async event => {
      event.preventDefault();
      if (await run('contact', () => core.saveContact({ ...(contact ? { id: contact.id } : {}), ...form }), { success: 'Contato salvo.', invalidate: [keys.state] })) onClose();
    }}>
      <div className="form-grid">
        <Field label="Nome" required><input className="input" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="E-mail" required><input className="input" required type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="nome@example.com" /></Field>
        <Field label="Finalidade"><select className="select" value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as Contact['kind'] })}><option value="internal">Alertas internos</option><option value="billing">Cobrança / contraparte</option></select></Field>
        <Field label="CNPJ vinculado" help="Vazio para contato interno."><input className="input" value={form.cnpj} pattern="[0-9]{14}" onChange={event => setForm({ ...form, cnpj: event.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Severidade mínima"><select className="select" value={form.min_severity} onChange={event => setForm({ ...form, min_severity: event.target.value as Contact['min_severity'] })}>{Object.entries(SEVERITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Frequência"><select className="select" value={form.frequency} onChange={event => setForm({ ...form, frequency: event.target.value as Contact['frequency'] })}><option value="immediate">Imediato</option><option value="digest">Resumo consolidado</option></select></Field>
      </div>
      <div className="row between">
        <label className="row" style={{ gap: 8, fontSize: 13 }}><Toggle checked={form.enabled} onChange={enabled => setForm({ ...form, enabled })} label="Receber notificações" />Receber notificações</label>
        <div className="row"><button type="button" className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!busy}>Salvar contato</button></div>
      </div>
    </form>
  );
}

function MerchantProfile({ state, merchant, creating, onCreated }: { state: AppState; merchant?: Merchant; creating: boolean; onCreated: (cnpj: string) => void }) {
  const { data: insights } = useInsights(state.period);
  const base = useMemo(() => ({ cnpj: merchant?.cnpj || '', name: merchant?.name || '', ec: merchant?.ec || '', active: merchant?.active ?? true }), [merchant]);
  const [draft, setDraft] = useState(base);
  const [reason, setReason] = useState('');
  const [confirmIdentity, setConfirmIdentity] = useState(false);
  const [rateEdit, setRateEdit] = useState<{ rate?: Rate; product?: string } | null>(null);
  const [contactEdit, setContactEdit] = useState<Contact | 'new' | null>(null);
  const { run, busy } = useAction();
  useEffect(() => { setDraft(base); setReason(''); setRateEdit(null); setContactEdit(null); setConfirmIdentity(false); }, [base]);

  const dirty = creating || draft.name !== base.name || draft.ec !== base.ec || draft.active !== base.active || confirmIdentity;
  const rates = state.rates.filter(rate => rate.cnpj === (merchant?.cnpj || draft.cnpj));
  const contacts = state.contacts.filter(contact => contact.cnpj && contact.cnpj === merchant?.cnpj);
  const commissions = state.results.comissoes.filter(row => row.cnpj === merchant?.cnpj);
  const divergence = insights?.divergencias_por_lojista.find(item => item.cnpj === merchant?.cnpj);
  const pending = state.results.pendencias.filter(p => p.cnpj === merchant?.cnpj && p.status !== 'resolved');
  const issues = rateIssues(rates);

  const save = async () => {
    const saved = await run('merchant', () => core.saveMerchant({
      cnpj: draft.cnpj, name: draft.name, ec: draft.ec, active: draft.active, reason,
      ...(merchant?.candidate ? { candidate: !confirmIdentity, identity_confirmed: confirmIdentity } : {}),
    }), { success: creating ? 'Lojista cadastrado.' : 'Cadastro salvo. O fechamento foi reaberto para revisão.', invalidate: [keys.state, ['insights']] });
    if (saved && creating) onCreated(draft.cnpj);
  };

  return (
    <div className="stack-lg">
      <div className="card">
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <input className="inline-input title" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Razão social" aria-label="Razão social" />
              <div className="row wrap" style={{ marginTop: 6, gap: 10 }}>
                {creating
                  ? <input className="input sm" style={{ width: 180 }} placeholder="CNPJ (14 dígitos)" value={draft.cnpj} onChange={event => setDraft({ ...draft, cnpj: event.target.value.replace(/\D/g, '').slice(0, 14) })} />
                  : <span className="mono">{cnpj(draft.cnpj)}</span>}
                <label className="row muted" style={{ gap: 6, fontSize: 12.5 }}>EC
                  <input className="inline-input" value={draft.ec} onChange={event => setDraft({ ...draft, ec: event.target.value })} placeholder="opcional" aria-label="Código do estabelecimento" style={{ width: 130 }} />
                </label>
              </div>
            </div>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <Toggle checked={draft.active} onChange={active => setDraft({ ...draft, active })} label="Cadastro ativo" />{draft.active ? 'Ativo' : 'Inativo'}
            </label>
          </div>
          {merchant?.candidate && (
            <Callout tone="warning" icon="alert">
              <strong>Identidade candidata.</strong> {merchant.identity_rule || 'Confirme o vínculo entre estabelecimento e CNPJ nas fontes.'}
              <label className="row" style={{ marginTop: 8, gap: 8 }}><input type="checkbox" checked={confirmIdentity} onChange={event => setConfirmIdentity(event.target.checked)} />Conferi a identidade nas fontes e confirmo o vínculo.</label>
            </Callout>
          )}
          {!creating && (
            <div className="merchant-stats">
              {commissions.map(row => (
                <div key={row.id_saida}><span className="muted">Comissão {row.linha_negocio === 'REMESSA' ? 'remessa' : 'checkout'}</span><strong><Money value={row.comissao_brl} /></strong></div>
              ))}
              <div><span className="muted">Divergências</span><strong>{divergence ? moneyShort(divergence.abs_brl) : '—'}</strong>{divergence && <small className="muted">{plural(divergence.count, 'transação', 'transações')}</small>}</div>
              <div><span className="muted">Pendências abertas</span><strong>{count(pending.length)}</strong></div>
              <div><span className="muted">Origem do cadastro</span><span className="mono" style={{ fontSize: 11.5 }}>{merchant?.source_ref || '—'}</span></div>
            </div>
          )}
          {dirty && (
            <div className="save-bar">
              <div className="grow"><Field label={creating ? 'Justificativa do cadastro' : 'O que mudou e por quê'} required><ReasonInput value={reason} onChange={setReason} /></Field></div>
              <div className="row" style={{ alignSelf: 'flex-end' }}>
                {!creating && <button className="btn ghost" onClick={() => { setDraft(base); setConfirmIdentity(false); }}>Descartar</button>}
                <button className="btn primary" disabled={!!busy || !reason.trim() || !draft.name.trim() || draft.cnpj.length !== 14} onClick={save}>{creating ? 'Cadastrar lojista' : 'Salvar alterações'}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!creating && (
        <div className="card">
          <div className="card-head">
            <div><h3 className="card-title">Taxas e vigências</h3><p className="card-sub">Clique numa barra para editar · “+” cria nova vigência · sobreposição é recusada ao salvar</p></div>
            <button className="btn sm" onClick={() => setRateEdit({})}><Icon name="plus" />Nova vigência</button>
          </div>
          <div className="card-body stack" style={{ gap: 14 }}>
            {issues.length > 0 && (
              <Callout tone="warning" icon="alert">
                {issues.map(issue => `${productNames[issue.product] || issue.product}: ${issue.kind === 'gap' ? 'lacuna' : 'sobreposição'} de ${dateBR(issue.from)} a ${issue.to ? dateBR(issue.to) : 'em aberto'}`).join(' · ')}
              </Callout>
            )}
            {rates.length ? <VigenciaTimeline rates={rates} period={state.period} selected={rateEdit?.rate?.id} onSelect={rate => setRateEdit({ rate })} onAdd={product => setRateEdit({ product })} />
              : <Empty icon="calendar" title="Sem taxas contratadas">Sem contrato vigente, as operações deste lojista ficam em revisão e não são faturadas.</Empty>}
            {rateEdit && <RateEditor key={rateEdit.rate?.id || rateEdit.product || 'new'} rate={rateEdit.rate} product={rateEdit.product} merchant={merchant!.cnpj} onClose={() => setRateEdit(null)} />}
            {rates.length > 0 && (
              <details className="rate-list">
                <summary>Ver vigências em tabela ({rates.length})</summary>
                <table className="table">
                  <thead><tr><th>Produto</th><th className="r">Taxa</th><th>Início</th><th>Fim</th><th>Fonte</th></tr></thead>
                  <tbody>{[...rates].sort((a, b) => a.product.localeCompare(b.product) || (a.start || '').localeCompare(b.start || '')).map(rate => (
                    <tr key={rate.id} className="clickable" onClick={() => setRateEdit({ rate })}><td>{productNames[rate.product] || rate.product}</td><td className="r">{percent(rate.rate_pct)}</td><td>{rate.start ? dateBR(rate.start) : 'sem início'}</td><td>{rate.end ? dateBR(rate.end) : 'em aberto'}</td><td className="mono muted">{rate.source_ref || '—'}</td></tr>
                  ))}</tbody>
                </table>
              </details>
            )}
          </div>
        </div>
      )}

      {!creating && (
        <div className="card">
          <div className="card-head">
            <div><h3 className="card-title">Contatos de cobrança</h3><p className="card-sub">Usados como destinatário dos rascunhos de cobrança e contestação</p></div>
            <button className="btn sm" onClick={() => setContactEdit('new')}><Icon name="plus" />Novo contato</button>
          </div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {contactEdit && <ContactForm contact={contactEdit === 'new' ? undefined : contactEdit} defaults={{ kind: 'billing', cnpj: merchant?.cnpj }} onClose={() => setContactEdit(null)} />}
            {contacts.length ? contacts.map(contact => (
              <div key={contact.id} className="contact-row">
                <Icon name="user" />
                <div className="grow"><strong>{contact.name}</strong><p className="muted" style={{ fontSize: 12.5 }}>{contact.email} · {contact.frequency === 'immediate' ? 'imediato' : 'resumo'} · {SEVERITY[contact.min_severity]}</p></div>
                <Badge tone={contact.enabled ? 'good' : 'neutral'} dot>{contact.enabled ? 'Ativo' : 'Inativo'}</Badge>
                <button className="btn xs ghost" onClick={() => setContactEdit(contact)}><Icon name="edit" />Editar</button>
              </div>
            )) : !contactEdit && <p className="muted" style={{ fontSize: 13 }}>Nenhum contato. Sem contato, o rascunho de cobrança fica sem destinatário até a revisão.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Lojistas({ state }: { state: AppState }) {
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'candidate' | 'inactive'>('all');
  const selectedCnpj = params.get('lojista');
  const creating = params.get('novo') === '1';
  const merchants = useMemo(() => [...state.merchants].sort((a, b) => Number(!!b.candidate) - Number(!!a.candidate) || a.name.localeCompare(b.name, 'pt-BR')), [state]);
  const visible = merchants.filter(item => (filter === 'all' || (filter === 'candidate' ? item.candidate : !item.active))
    && (!term || `${item.name} ${item.cnpj} ${item.ec}`.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))));
  const selected = merchants.find(item => item.cnpj === selectedCnpj) || (!creating ? merchants[0] : undefined);
  const openCount = (cnpjValue: string) => state.results.pendencias.filter(p => p.cnpj === cnpjValue && p.status !== 'resolved').length;

  return (
    <div className="master-detail">
      <aside className="card master">
        <div className="master-head">
          <label className="search"><Icon name="search" /><input className="input sm" type="search" placeholder="Buscar lojista, CNPJ ou EC" value={term} onChange={event => setTerm(event.target.value)} /></label>
          <Segmented value={filter} onChange={setFilter} label="Filtro" options={[{ value: 'all', label: 'Todos' }, { value: 'candidate', label: 'A confirmar' }, { value: 'inactive', label: 'Inativos' }]} />
          <button className="btn sm primary" onClick={() => setParams({ novo: '1' })}><Icon name="plus" />Novo lojista</button>
        </div>
        <div className="master-list" role="listbox" aria-label="Lojistas">
          {visible.map(item => {
            const open = openCount(item.cnpj);
            return (
              <button key={item.cnpj} type="button" role="option" aria-selected={!creating && selected?.cnpj === item.cnpj}
                className={`master-item ${!creating && selected?.cnpj === item.cnpj ? 'active' : ''}`} onClick={() => setParams({ lojista: item.cnpj })}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <strong>{item.name}</strong>
                  <span className="mono muted">{cnpj(item.cnpj)}</span>
                </span>
                {item.candidate ? <Badge tone="warning" dot>A confirmar</Badge> : !item.active ? <Badge>Inativo</Badge> : open ? <span className="count">{open}</span> : null}
              </button>
            );
          })}
          {!visible.length && <Empty icon="search" title="Nenhum lojista" />}
        </div>
      </aside>
      <section className="detail">
        {creating ? <MerchantProfile state={state} creating onCreated={cnpjValue => setParams({ lojista: cnpjValue })} />
          : selected ? <MerchantProfile state={state} merchant={selected} creating={false} onCreated={() => {}} />
            : <Empty title="Selecione um lojista" />}
      </section>
    </div>
  );
}

function Contatos({ state }: { state: AppState }) {
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  return (
    <div className="card">
      <DataTable<Contact>
        rows={state.contacts}
        rowKey={row => String(row.id)}
        search={row => `${row.name} ${row.email} ${row.cnpj || ''}`}
        onRowClick={setEdit}
        toolbar={<button className="btn sm primary" onClick={() => setEdit('new')}><Icon name="plus" />Novo contato</button>}
        empty={<Empty icon="user" title="Nenhum contato cadastrado">Cadastre quem recebe alertas internos e quem recebe cobranças.</Empty>}
        columns={[
          { key: 'name', label: 'Nome', render: row => <span className="strong">{row.name}</span>, value: row => row.name },
          { key: 'email', label: 'E-mail', render: row => row.email },
          { key: 'kind', label: 'Finalidade', render: row => <Badge tone={row.kind === 'internal' ? 'info' : 'neutral'}>{row.kind === 'internal' ? 'Interno' : 'Cobrança'}</Badge> },
          { key: 'cnpj', label: 'CNPJ', render: row => row.cnpj ? <span className="mono">{cnpj(row.cnpj)}</span> : <span className="muted">—</span> },
          { key: 'sev', label: 'Recebe', render: row => `${SEVERITY[row.min_severity]} · ${row.frequency === 'immediate' ? 'imediato' : 'resumo'}` },
          { key: 'enabled', label: 'Situação', render: row => <Badge tone={row.enabled ? 'good' : 'neutral'} dot>{row.enabled ? 'Ativo' : 'Inativo'}</Badge> },
        ]}
      />
      {edit && (
        <Sheet narrow title={edit === 'new' ? 'Novo contato' : 'Editar contato'} sub="Alertas internos dispensam aprovação; cobranças exigem aprovação de cada envio." onClose={() => setEdit(null)}>
          <ContactForm contact={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />
        </Sheet>
      )}
    </div>
  );
}

function Prazos({ state }: { state: AppState }) {
  const [comp, setComp] = useState(state.period);
  const { data: config } = useOperationalConfig(comp);
  const [deadline, setDeadline] = useState<string | undefined>();
  const effectiveDeadline = deadline ?? config?.closing_deadline ?? '';
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><div><h3 className="card-title">Prazo do fechamento</h3><p className="card-sub">Configuração operacional por competência. Snapshots anteriores são preservados.</p></div></div>
        <div className="card-body stack-lg">
          <Field label="Competência"><input className="input" type="month" value={comp} onChange={event => { setComp(event.target.value); setDeadline(undefined); setReason(''); }} /></Field>
          <Field label="Data limite"><input className="input" type="date" value={effectiveDeadline} onChange={event => setDeadline(event.target.value)} style={{ maxWidth: 220 }} /></Field>
          {effectiveDeadline !== (config?.closing_deadline || '') && <Field label="Justificativa" required><ReasonInput value={reason} onChange={setReason} suggestions={['Calendário do financeiro', 'Ajuste combinado com a contabilidade']} /></Field>}
          <div><button className="btn primary" disabled={!!busy || !config || !reason.trim() || effectiveDeadline === (config.closing_deadline || '')}
            onClick={() => run('deadline', () => core.saveOperationalConfig(comp, { closing_deadline: effectiveDeadline || null, reason }), { success: 'Prazo da competência salvo.', invalidate: [keys.state, keys.config(comp)] })}>Salvar prazo</button></div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h3 className="card-title">Parâmetros de cálculo</h3><p className="card-sub">Agora configurados nos passos do pipeline</p></div></div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="row between"><span className="text-2">Tolerância de divergência de spread</span><strong className="num">{state.parameters.remittance_tolerance_pp ?? '—'} p.p.</strong></div>
          <div className="row between"><span className="text-2">Participação no spread da Ponte</span><strong className="num">{state.parameters.remittance_share_pct ?? '—'}%</strong></div>
          <Link className="btn sm" to="/pipeline" style={{ alignSelf: 'flex-start', marginTop: 6 }}><Icon name="pipeline" />Ajustar no construtor</Link>
        </div>
      </div>
    </div>
  );
}

export default function Cadastros() {
  const { data: state } = useAppState({});
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab) || 'lojistas';
  if (!state) return <Loading page />;
  const candidates = state.merchants.filter(item => item.candidate).length;
  return (
    <>
      <PageHead eyebrow="Base de referência" title="Cadastros" sub="Lojistas, taxas com vigência, contatos e prazos. Toda alteração pede uma justificativa curta e fica na auditoria." />
      <Tabs<Tab> value={tab} onChange={value => setParams({ aba: value })} items={[
        { value: 'lojistas', label: 'Lojistas e taxas', count: state.merchants.length, icon: 'building' },
        { value: 'contatos', label: 'Contatos', count: state.contacts.length, icon: 'user' },
        { value: 'contas', label: 'Plano de contas', count: state.accounts.length, icon: 'layers' },
        { value: 'prazos', label: 'Prazos e parâmetros', icon: 'calendar' },
      ]} />
      {tab === 'lojistas' && candidates > 0 && <div style={{ marginBottom: 14 }}><Callout tone="warning" icon="alert">{plural(candidates, 'lojista com identidade candidata aguarda', 'lojistas com identidade candidata aguardam')} confirmação. Use o filtro “A confirmar”.</Callout></div>}
      {tab === 'lojistas' && <Lojistas state={state} />}
      {tab === 'contatos' && <Contatos state={state} />}
      {tab === 'contas' && (
        <div className="card">
          <DataTable rows={state.accounts} rowKey={row => row.code} search={row => `${row.code} ${row.name}`} pageSize={60}
            toolbar={<span className="muted" style={{ fontSize: 12.5 }}>Importado do ERP Fênix. Só contas analíticas aceitam lançamento.</span>}
            columns={[
              { key: 'code', label: 'Código', render: row => <span className="mono" style={{ paddingLeft: (row.code.split('.').length - 1) * 12 }}>{row.code}</span>, value: row => row.code },
              { key: 'name', label: 'Conta', render: row => <span className={row.postable ? '' : 'strong'}>{row.name}</span> },
              { key: 'nature', label: 'Natureza', render: row => row.nature === 'C' ? 'Credora' : row.nature === 'D' ? 'Devedora' : '—' },
              { key: 'postable', label: 'Tipo', render: row => <Badge tone={row.postable ? 'good' : 'neutral'}>{row.postable ? 'Analítica' : 'Sintética'}</Badge> },
            ]} />
        </div>
      )}
      {tab === 'prazos' && <Prazos state={state} />}
    </>
  );
}
