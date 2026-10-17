import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mail, isTestProvider, acceptedMailLabel, matchesReviewedVersion, type Counterparty, type MailAccount, type MailContact, type MailDraft, type MailEvent, type MailFields } from '../api/mail';
import type { Pendencia } from '../api/types';
import { dateTimeBR, money } from '../lib/format';
import { useActor } from '../lib/actor';
import { DataTable } from './DataTable';
import { Icon } from './Icon';
import { Modal, Sheet } from './Overlay';
import { Badge, Callout, Empty, Field, Loading } from './ui';
import { useToast } from './Toast';
import '../styles/gmail.css';

const mailKeys = {
  account: ['mail', 'account'] as const, contacts: ['mail', 'contacts'] as const, drafts: ['mail', 'drafts'] as const,
  history: (id: string) => ['mail', 'history', id] as const,
};
const partyName = (party: string | null) => party === 'orbe' ? 'Orbe' : party === 'ponte' ? 'Ponte Câmbio' : 'Contraparte a revisar';
const locked = (draft: MailDraft) => ['sending', 'sent', 'uncertain'].includes(draft.status);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function MailBadge({ draft }: { draft: MailDraft }) {
  const stages = {
    draft: ['Rascunho', 'neutral'], sending: ['Envio em andamento', 'info'],
    sent: [acceptedMailLabel(draft), 'good'],
    failed: ['Falha conhecida', 'critical'], uncertain: ['Resultado incerto', 'warning'],
  } as const;
  const [label, tone] = stages[draft.status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/** The synchronous ref also blocks a second click before React has rendered busy state. */
function useMailAction() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(errorMessage(failure)); }
    finally { active.current = false; setBusy(false); }
  }
  return { busy, error, run, setError };
}

export function GmailPanel({ issues, issueId }: { issues: Pendencia[]; issueId?: string | null }) {
  const client = useQueryClient();
  const toast = useToast();
  const { busy, error, run } = useMailAction();
  const [selectedIssue, setSelectedIssue] = useState(issueId || '');
  const [review, setReview] = useState<MailDraft | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [contact, setContact] = useState<Counterparty | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectNotice, setDisconnectNotice] = useState('');
  const polls = useRef(0);
  useEffect(() => { if (issueId) setSelectedIssue(issueId); }, [issueId]);
  const accountQuery = useQuery({ queryKey: mailKeys.account, queryFn: mail.account, retry: false, staleTime: 0 });
  const contactQuery = useQuery({ queryKey: mailKeys.contacts, queryFn: mail.contacts, retry: false });
  const draftsQuery = useQuery({
    queryKey: mailKeys.drafts, queryFn: mail.drafts, retry: false,
    refetchInterval: query => query.state.data?.some(draft => draft.status === 'sending') && polls.current++ < 30 ? 2200 : false,
  });
  const account = accountQuery.data;
  const contacts = contactQuery.data || [];
  const drafts = draftsQuery.data || [];
  const queryError = accountQuery.error || contactQuery.error || draftsQuery.error;
  async function refresh() {
    polls.current = 0;
    await client.invalidateQueries({ queryKey: ['mail'] });
  }
  function changed(draft: MailDraft) {
    client.setQueryData<MailDraft[]>(mailKeys.drafts, current => [draft, ...(current || []).filter(item => item.id !== draft.id)]);
    void client.invalidateQueries({ queryKey: mailKeys.history(draft.issue_id) });
    void client.invalidateQueries({ queryKey: ['state'] });
  }
  async function openReview(id: string) {
    const current = await mail.account();
    client.setQueryData(mailKeys.account, current);
    setReview(await mail.draft(id));
  }
  const issue = issues.find(item => item.id_saida === selectedIssue);
  const existing = drafts.find(draft => draft.issue_id === selectedIssue);

  return <div className="gmail-panel stack-lg">
    <section className="card">
      <div className="card-head">
        <div><p className="eyebrow">Gmail · pendências</p><h3 className="card-title">{account?.email || 'Conta remetente'}</h3><p className="card-sub">{account?.authorized ? 'Esta sessão está autorizada pela conta Google.' : account?.connected ? 'A conta está conectada; autorize esta sessão para enviar.' : 'Conecte a conta de teste para aprovar mensagens de pendências.'}</p></div>
        {account && <div className="row wrap"><Badge tone={account.authorized ? 'good' : 'neutral'}>{account.authorized ? 'Sessão autorizada' : account.connected ? 'Sessão não autorizada' : 'Desconectada'}</Badge><Badge tone="outline">{isTestProvider(account.provider_mode) ? 'Provedor de teste' : 'Gmail API'}</Badge></div>}
      </div>
      <div className="card-body stack">
        {accountQuery.isPending ? <Loading label="Consultando conexão…" /> : <>
          {!account?.configured && <Callout tone="warning">Configure no servidor: {account?.missing_config?.join(', ') || 'credenciais Google e conta de teste'}. <a href="/api/mail/setup" target="_blank" rel="noreferrer">Ver guia de configuração</a>.</Callout>}
          <p className="muted">{isTestProvider(account?.provider_mode) ? 'Ambiente simulado: o provedor de teste não envia mensagens reais.' : 'A conexão permite envio pela conta Gmail de teste. A plataforma não lê a caixa de entrada.'}</p>
          <div className="row wrap">
            <button className="btn primary" disabled={busy || !account?.configured} onClick={() => void run(async () => {
              await mail.account();
              const result = await mail.connect();
              const url = new URL(result.authorization_url, window.location.origin);
              if (!['https:', 'http:'].includes(url.protocol)) throw new Error('O servidor retornou uma URL de autorização inválida.');
              window.location.assign(url.href);
            })}>{account?.connected ? 'Autorizar esta sessão' : 'Conectar conta Google'}</button>
            {account?.connected && <button className="btn" disabled={busy || !account.authorized} onClick={() => setDisconnecting(true)}>Desconectar</button>}
            <button className="btn" disabled={busy} onClick={() => void run(refresh)}><Icon name="refresh" />Atualizar estado</button>
          </div>
          {disconnectNotice && <Callout tone="warning">{disconnectNotice}</Callout>}
        </>}
      </div>
    </section>
    <Callout tone="info">Gere uma mensagem, confira os anexos e aprove a versão exata para enviar. O nome declarado do analista fica na auditoria; a sessão Google autoriza o envio. Enviar não resolve a pendência nem altera o fechamento.</Callout>
    {(error || queryError) && <div role="alert"><Callout tone="critical">{error || errorMessage(queryError)}</Callout></div>}
    <details className="card gmail-contacts">
      <summary>Destinatários Orbe e Ponte <span className="muted">{contacts.filter(item => item.enabled).length} contatos ativos</span></summary>
      <div className="card-body gmail-contact-grid">
        {(['orbe', 'ponte'] as const).map(party => <div className="gmail-contact" key={party}>
          <h3>{partyName(party)}</h3>
          {contacts.filter(item => item.counterparty === party).map(item => <p key={item.id}><strong>{item.name || partyName(party)}</strong><br />{item.email} <Badge tone={item.enabled ? 'good' : 'neutral'}>{item.enabled ? 'Ativo' : 'Inativo'}</Badge></p>)}
          {!contacts.some(item => item.counterparty === party) && <p className="muted">Nenhum contato cadastrado.</p>}
          <button className="btn sm" onClick={() => setContact(party)}>Editar destinatário</button>
        </div>)}
        <p className="muted gmail-wide">Use endereços de teste controlados pelo time. Nenhum endereço é inferido dos documentos. Estes contatos são separados de cobranças e avisos.</p>
      </div>
    </details>
    <section className="card">
      <div className="card-head"><div><h3 className="card-title">Preparar e-mail de uma pendência</h3><p className="card-sub">A geração ocorre somente quando solicitada.</p></div></div>
      <div className="card-body stack">
        <Field label="Pendência"><select className="input" value={selectedIssue} onChange={event => setSelectedIssue(event.target.value)}>
          <option value="">Selecione uma pendência</option>
          {selectedIssue && !issue && <option value={selectedIssue}>{selectedIssue}</option>}
          {issues.map(item => <option key={item.id_saida} value={item.id_saida}>{item.id_saida} · {item.motivo}</option>)}
        </select></Field>
        {issue && <p className="muted">{issue.motivo} · Referência: {issue.ref_origem} · {money(issue.valor_brl)}</p>}
        <div className="row wrap"><button className="btn primary" disabled={!selectedIssue || busy} onClick={() => void run(async () => {
          await mail.account();
          const draft = await mail.create(selectedIssue);
          changed(draft); setReview(draft);
        })}><Icon name="mail" />{existing ? 'Abrir e-mail da pendência' : 'Gerar e-mail'}</button>
          <button className="btn" disabled={!selectedIssue || busy} onClick={() => setHistory(selectedIssue)}>Histórico da pendência</button>
        </div>
      </div>
    </section>
    <div className="card"><DataTable<MailDraft>
      rows={drafts} rowKey={draft => draft.id} search={draft => `${draft.issue_id} ${draft.to} ${draft.subject} ${draft.status}`}
      onRowClick={draft => { void run(() => openReview(draft.id)); }}
      empty={draftsQuery.isPending ? <Loading /> : <Empty icon="mail" title="Nenhum e-mail de pendência">Selecione uma ocorrência para gerar o rascunho e suas evidências.</Empty>}
      columns={[
        { key: 'status', label: 'Situação', render: draft => <div className="stack"><MailBadge draft={draft} />{draft.stale && <Badge tone="warning">Evidências desatualizadas</Badge>}</div> },
        { key: 'subject', label: 'Mensagem', wrap: true, render: draft => <><strong>{draft.subject}</strong><p className="muted">{draft.issue_id} · {partyName(draft.counterparty)} · versão {draft.version}</p></> },
        { key: 'to', label: 'Destinatário', render: draft => draft.to || <span className="muted">A configurar</span> },
        { key: 'at', label: 'Atualizado', render: draft => dateTimeBR(draft.updated_at) },
      ]}
    /></div>
    {review && <GmailEditor initial={review} account={account} onChanged={changed} onAccount={value => client.setQueryData(mailKeys.account, value)} onClose={() => setReview(null)} />}
    {history && <Sheet title="Histórico de e-mails" sub={history} onClose={() => setHistory(null)}><MailHistory issueId={history} /></Sheet>}
    {contact && <ContactEditor party={contact} contacts={contacts} onClose={() => setContact(null)} onSaved={async () => { await refresh(); toast.ok('Contato salvo. Confira os destinatários dos rascunhos existentes.'); }} />}
    {disconnecting && <Modal title="Desconectar conta Google" onClose={() => { if (!busy) setDisconnecting(false); }} footer={<><button className="btn" disabled={busy} onClick={() => setDisconnecting(false)}>Cancelar</button><button className="btn danger" disabled={busy} onClick={() => void run(async () => {
      await mail.account();
      const result = await mail.disconnect();
      setDisconnectNotice(result.revocation_confirmed === false ? 'A conexão local foi removida, mas a revogação no Google não foi confirmada. Confira as permissões da conta Google para remover o acesso.' : 'Conta desconectada. Os rascunhos e registros foram preservados.');
      setDisconnecting(false); await refresh();
    })}>Desconectar conta</button></>}><p>Desconectar {account?.email} impede novos envios por esta conexão. Os registros anteriores permanecem disponíveis.</p>{error && <Callout tone="critical">{error}</Callout>}</Modal>}
  </div>;
}

function ContactEditor({ party, contacts, onClose, onSaved }: { party: Counterparty; contacts: MailContact[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const matching = contacts.filter(item => item.counterparty === party);
  const [selected, setSelected] = useState(matching[0]?.id || '');
  const [form, setForm] = useState({ name: matching[0]?.name || '', email: matching[0]?.email || '', enabled: matching[0]?.enabled ?? true });
  const { busy, error, run } = useMailAction();
  return <Modal title={`Destinatário · ${partyName(party)}`} onClose={() => { if (!busy) onClose(); }}>
    <form className="stack-lg" onSubmit={event => { event.preventDefault(); void run(async () => { await mail.saveContact(party, { ...form, ...(selected ? { id: selected } : {}) }); await onSaved(); onClose(); }); }}>
      {matching.length > 1 && <Field label="Contato a revisar"><select className="input" value={selected} onChange={event => { const value = matching.find(item => item.id === event.target.value)!; setSelected(value.id); setForm({ name: value.name, email: value.email, enabled: value.enabled }); }}>{matching.map(item => <option key={item.id} value={item.id}>{item.email}</option>)}</select><small>Mantenha apenas um contato ativo por contraparte.</small></Field>}
      <Field label="Nome"><input className="input" maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} disabled={busy} /></Field>
      <Field label="Endereço de teste" required><input type="email" className="input" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} disabled={busy} /></Field>
      <label className="row"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={event => setForm({ ...form, enabled: event.target.checked })} />Contato ativo</label>
      {error && <Callout tone="critical">{error}</Callout>}
      <button className="btn primary" disabled={busy}>Salvar contato</button>
    </form>
  </Modal>;
}

function GmailEditor({ initial, account, onAccount, onChanged, onClose }: { initial: MailDraft; account?: MailAccount; onAccount: (value: MailAccount) => void; onChanged: (draft: MailDraft) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [form, setForm] = useState<MailFields>({ to: initial.to, subject: initial.subject, body: initial.body });
  const [party, setParty] = useState<Counterparty | ''>('');
  const [reason, setReason] = useState('');
  const [actor, setActor] = useActor();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const { busy, error, run, setError } = useMailAction();
  const readonly = locked(draft) || unconfirmed;
  const test = isTestProvider(draft.provider_mode || account?.provider_mode);
  const canApprove = !busy && !readonly && draft.status === 'draft' && !draft.stale && !!account?.connected && !!account.authorized && !draft.blockers.length && !!form.to;
  function replace(value: MailDraft) {
    setDraft(value); setForm({ to: value.to, subject: value.subject, body: value.body }); onChanged(value);
  }
  useEffect(() => {
    if (draft.status !== 'sending' || unconfirmed) return;
    let stopped = false, count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await mail.draft(draft.id);
        if (stopped) return;
        setDraft(value); onChanged(value);
        if (value.status !== 'sending') return;
      } catch { if (!stopped) setNotice('A consulta foi interrompida. Atualizar estado apenas consulta o registro; nenhum envio é repetido.'); }
      if (!stopped && ++count < 30) timer = setTimeout(poll, 2200);
    };
    timer = setTimeout(poll, 2200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [draft.id, draft.status, unconfirmed]);

  async function save(approve: boolean) {
    const currentAccount = await mail.account(); onAccount(currentAccount);
    if (approve && (!currentAccount.connected || !currentAccount.authorized)) throw new Error('Autorize esta sessão Google antes de aprovar o envio.');
    const fields = { ...form, to: form.to.trim() };
    if (!fields.subject.trim() || !fields.body.trim()) throw new Error('Preencha assunto e mensagem.');
    if (!draft.counterparty && party && !reason.trim()) throw new Error('Justifique a contraparte confirmada.');
    const saved = await mail.save(draft.id, { version: draft.version, ...fields, ...(party ? { counterparty: party, counterparty_reason: reason } : {}) });
    replace(saved);
    if (!approve) { setNotice('Rascunho salvo. Nenhuma mensagem foi enviada.'); return; }
    if (!matchesReviewedVersion(draft, saved, fields)) {
      setError('O remetente, as evidências ou o conteúdo retornado mudou, ou há bloqueios. Confira esta versão atualizada antes de aprovar. Nenhum envio foi iniciado.'); return;
    }
    try {
      replace(await mail.approveSend(saved));
      setNotice('Tentativa registrada. Confira a situação e o histórico abaixo.');
    } catch (failure) {
      // A lost response may hide an accepted message. Consult only; never replay approval.
      try { replace(await mail.draft(saved.id)); }
      catch { setUnconfirmed(true); setNotice('O resultado da tentativa não pôde ser consultado. O envio está bloqueado nesta tela; atualize o estado e confira manualmente o Gmail.'); }
      throw failure;
    }
  }

  return <Sheet title={readonly ? 'Registro de comunicação' : 'Revisar e-mail da pendência'} eyebrow={`${partyName(draft.counterparty)} · versão ${draft.version}`} sub={`${draft.issue_id} · ${draft.period}`} onClose={() => { if (!busy) onClose(); }}
    footer={<div className="gmail-editor-actions">
      <button className="btn" disabled={busy} onClick={() => void run(async () => { onAccount(await mail.account()); replace(await mail.draft(draft.id)); setUnconfirmed(false); })}>Atualizar estado</button>
      {!readonly && <><button className="btn" disabled={busy} onClick={() => void run(() => save(false))}>Salvar rascunho</button><button className="btn primary" disabled={!canApprove} onClick={() => void run(() => save(true))}><Icon name="send" />{test ? 'Aprovar e simular envio' : 'Aprovar e enviar'}</button></>}
    </div>}>
    <div className="gmail-panel stack-lg">
      <div className="row wrap"><MailBadge draft={draft} />{draft.stale && <Badge tone="warning">Evidências desatualizadas</Badge>}</div>
      <div className="gmail-origin"><strong>{draft.issue?.tipo || 'Pendência de origem'}</strong><p>{draft.issue?.motivo}</p><p className="muted">Referência: {draft.issue?.ref_origem || draft.issue_id}</p></div>
      <dl className="facts"><div><dt>Remetente desta versão</dt><dd>{draft.sender?.email || 'Ainda não vinculado'}</dd></div><div><dt>Sessão Google</dt><dd>{account?.authorized ? account.email : 'Não autorizada para enviar'}</dd></div></dl>
      {draft.status === 'sent' && <Callout tone="good">{isTestProvider(draft.provider_mode) ? 'O provedor de teste aceitou a mensagem. Nenhum e-mail real foi enviado.' : draft.provider_mode === 'gmail' ? 'O Gmail aceitou a mensagem. Isso não confirma entrega nem leitura.' : 'O provedor aceitou a mensagem. O modo de envio não foi identificado neste registro antigo; entrega e leitura não foram confirmadas.'}{draft.provider_message_id && <> Referência: <span className="mono">{draft.provider_message_id}</span>.</>}</Callout>}
      {draft.status === 'sending' && <Callout tone="info">Envio em andamento. Estamos consultando o resultado, sem repetir a tentativa.</Callout>}
      {draft.status === 'uncertain' && <Callout tone="warning">Resultado incerto. Confira manualmente a pasta Enviados de {draft.sender?.email || 'sua conta'}. Esta mensagem não pode ser reenviada pela plataforma.</Callout>}
      {draft.status === 'failed' && <Callout tone="critical">{draft.error?.message || 'Falha conhecida no envio.'} Revise e salve uma nova versão antes de aprovar novamente.</Callout>}
      {draft.blockers.length > 0 && <Callout tone="warning"><strong>{readonly ? 'Proteções do registro' : 'Antes de enviar'}</strong><ul>{draft.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul></Callout>}
      {notice && <Callout tone={unconfirmed ? 'warning' : 'info'}>{notice}</Callout>}
      {error && <div role="alert"><Callout tone="critical">{error}</Callout></div>}
      {!readonly && !draft.counterparty && <><Field label="Contraparte confirmada"><select className="input" value={party} disabled={busy} onChange={event => setParty(event.target.value as Counterparty | '')}><option value="">Selecione após conferir a origem</option><option value="orbe">Orbe · checkout</option><option value="ponte">Ponte Câmbio · remessas</option></select></Field><Field label="Justificativa do vínculo"><textarea className="textarea" rows={2} value={reason} maxLength={2000} disabled={busy} onChange={event => setReason(event.target.value)} /></Field></>}
      <Field label="Destinatário" required><input className="input" type="email" maxLength={254} value={form.to} disabled={readonly || busy} onChange={event => setForm({ ...form, to: event.target.value })} /></Field>
      <Field label="Assunto" required><input className="input" maxLength={500} value={form.subject} disabled={readonly || busy} onChange={event => setForm({ ...form, subject: event.target.value })} /></Field>
      <Field label="Mensagem" required><textarea className="textarea" rows={12} maxLength={100000} value={form.body} disabled={readonly || busy} onChange={event => setForm({ ...form, body: event.target.value })} /></Field>
      <section className="stack"><h3 className="section-title">Evidências desta versão</h3>
        {draft.attachments.map(file => <div className="gmail-attachment" key={file.id}><Icon name="file" /><div className="grow"><strong>{file.name}</strong><p className="muted">{file.size.toLocaleString('pt-BR')} bytes · {file.content_type}</p><small className="mono gmail-hash">SHA-256 {file.sha256}</small></div><a className="btn sm" href={file.url} target="_blank" rel="noreferrer">Ver</a><a className="btn sm" href={`${file.url}?download=1`} download>Baixar</a></div>)}
        {!draft.attachments.length && <p className="muted">Nenhum anexo disponível; confira os bloqueios.</p>}
        {!readonly && <><button className="btn" disabled={busy} onClick={() => void run(async () => {
          if (!draft.counterparty && (!party || !reason.trim())) throw new Error('Confirme a contraparte e justifique o vínculo antes de atualizar.');
          onAccount(await mail.account());
          replace(await mail.save(draft.id, { version: draft.version, refresh_evidence: true, ...(party ? { counterparty: party, counterparty_reason: reason } : {}) }));
          setNotice('Modelo e anexos regenerados. Confira a nova versão antes de aprovar.');
        })}>Atualizar texto e evidências</button><p className="muted">A atualização substitui o texto pelo modelo e abre uma nova versão para revisão.</p></>}
      </section>
      {!readonly && <><Field label="Responsável declarado" required help="O nome identifica o registro de auditoria; a sessão Google autoriza o envio."><input className="input" maxLength={100} value={actor} disabled={busy} onChange={event => setActor(event.target.value)} /></Field><p className="muted">{test ? 'A aprovação usa o provedor de teste, sem envio real.' : 'Aprovar e enviar salva as alterações revisadas e inicia o envio real pela conta conectada.'}</p></>}
      {draft.approval && <p className="muted">Versão {draft.approval.version} aprovada por {draft.approval.declared_actor} · conta {draft.approval.google_account.email} · {dateTimeBR(draft.approval.at)}.</p>}
      <h3 className="section-title">Histórico da pendência</h3><MailHistory issueId={draft.issue_id} />
    </div>
  </Sheet>;
}

const historyLabels: Record<string, string> = { draft_created: 'Rascunho gerado', draft_saved: 'Revisão salva', send_approved: 'Versão aprovada para envio', send_sent: 'Mensagem aceita pelo provedor', send_failed: 'Falha conhecida', send_uncertain: 'Resultado incerto' };
function MailHistory({ issueId }: { issueId: string }) {
  const { data, isPending, error } = useQuery({ queryKey: mailKeys.history(issueId), queryFn: () => mail.history(issueId), retry: false });
  if (isPending) return <Loading label="Consultando histórico…" />;
  if (error) return <Callout tone="critical">{error.message}</Callout>;
  if (!data?.length) return <Empty icon="mail" title="Nenhum evento registrado" />;
  return <ol className="gmail-history">{[...data].reverse().map((event: MailEvent) => <li key={event.id}><div className="row wrap"><strong>{historyLabels[event.type] || event.type}</strong><span className="muted">{dateTimeBR(event.at)}</span></div><p>{event.actor} · versão {event.version}{event.google_account && ` · conta ${event.google_account.email}`}</p>{event.provider_message_id && <p className="mono">Referência: {event.provider_message_id}</p>}{event.error && <p>{event.error.message}</p>}{event.content_hash && <small className="mono gmail-hash">Hash da versão: {event.content_hash}</small>}</li>)}</ol>;
}
