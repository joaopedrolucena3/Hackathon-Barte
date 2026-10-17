import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DEMO_MAILBOX, isTestProvider, mail, type MailAccount, type MailFields } from '../api/mail';
import { canAuthorizeSuggestion, suggestionLabel, suggestionReviewKey, suggestions, type MailSuggestion, type SuggestionList } from '../api/suggestions';
import { useActor } from '../lib/actor';
import { dateTimeBR, money } from '../lib/format';
import { Icon } from './Icon';
import { Modal, Sheet } from './Overlay';
import { Badge, Callout, Empty, Field, Loading } from './ui';

const partyName = (party: string) => party === 'orbe' ? 'Orbe' : 'Ponte';
const fieldsOf = (draft: MailSuggestion): MailFields => ({ to: draft.to, subject: draft.subject, body: draft.body });
const listKey = (runId: string) => ['mail', 'suggestions', runId] as const;
const locked = (draft: MailSuggestion) => ['dismissed', 'sending', 'sent', 'uncertain'].includes(draft.status);

function useSuggestionAction() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function act(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { active.current = false; setBusy(false); }
  }
  return { busy, error, act };
}

function SuggestionBadge({ draft }: { draft: MailSuggestion }) {
  return <Badge tone={draft.status === 'sent' ? 'good' : draft.status === 'failed' ? 'critical' : draft.status === 'uncertain' ? 'warning' : draft.status === 'dismissed' ? 'neutral' : 'info'} dot>{suggestionLabel(draft)}</Badge>;
}

export function SuggestionPanel({ runId, issueId, account, onRunChange, onAccount }: {
  runId?: string | null; issueId?: string | null; account?: MailAccount;
  onRunChange: (id: string) => void; onAccount: (value: MailAccount) => void;
}) {
  const client = useQueryClient();
  const { busy, error, act } = useSuggestionAction();
  const [review, setReview] = useState<MailSuggestion | null>(null);
  const runsQuery = useQuery({ queryKey: ['mail', 'suggestion-runs'], queryFn: suggestions.runs, retry: false, refetchInterval: 10000, refetchIntervalInBackground: false });
  const selectedRun = runId || runsQuery.data?.[0]?.id || '';
  const listQuery = useQuery({ queryKey: listKey(selectedRun), queryFn: () => suggestions.list(selectedRun), enabled: !!selectedRun, retry: false, refetchInterval: query => query.state.data?.summary?.prepared_at ? false : 5000, refetchIntervalInBackground: false });
  const rows = listQuery.data?.suggestions || [];
  const currentRun = runsQuery.data?.find(item => item.id === selectedRun);
  const summary = listQuery.data?.summary;
  const queryError = runsQuery.error || listQuery.error;
  function changed(value: MailSuggestion) {
    client.setQueryData<SuggestionList>(listKey(value.run_id), current => ({ ...current, suggestions: [value, ...(current?.suggestions || []).filter(item => item.id !== value.id)] }));
  }
  async function open(draft: MailSuggestion) {
    onAccount(await mail.account());
    setReview(await suggestions.get(draft.id));
  }

  return <section className="card gmail-suggestions">
    <div className="card-head"><div><p className="eyebrow">Você decide cada envio</p><h3 className="card-title">Sugestões de contestação</h3><p className="card-sub">A execução prepara mensagens por parceiro, período e motivo, com justificativa e evidências.</p></div><Badge tone="outline">Permissão obrigatória</Badge></div>
    <div className="card-body stack-lg">
      <Callout tone="info">Cada contestação começa como sugestão. Revise a justificativa, o destinatário e os anexos; depois autorize aquela mensagem. Rodar novamente ou testar nunca envia uma contestação por conta própria.</Callout>
      <div className="gmail-suggestion-toolbar">
        <Field label="Execução de origem"><select className="input" value={selectedRun} disabled={busy || runsQuery.isPending} onChange={event => { setReview(null); onRunChange(event.target.value); }}>
          {!selectedRun && <option value="">Nenhuma execução disponível</option>}
          {selectedRun && !currentRun && <option value={selectedRun}>{selectedRun}</option>}
          {runsQuery.data?.map(item => <option key={item.id} value={item.id}>{item.period || item.competencia} · {item.draft ? 'Teste' : 'Execução'} · {dateTimeBR(item.finished_at || item.started_at)} · {item.id.slice(-8)}</option>)}
        </select></Field>
        <button className="btn" disabled={busy || !selectedRun} onClick={() => void act(async () => { client.setQueryData(listKey(selectedRun), await suggestions.prepare(selectedRun)); })}><Icon name="refresh" />{busy ? 'Aguarde…' : 'Preparar sugestões'}</button>
        {selectedRun && <Link className="btn" to={`/runs/${encodeURIComponent(selectedRun)}/revisao`}>Ver execução</Link>}
      </div>
      {currentRun?.draft && <Callout tone="warning">Esta é uma execução de teste. As sugestões também exigem revisão e permissão individual; se autorizadas com uma conta real, enviam e-mails reais.</Callout>}
      {issueId && <p className="muted">Ocorrência selecionada: <strong>{issueId}</strong>. O grupo relacionado aparece destacado, quando elegível.</p>}
      {(error || queryError) && <div role="alert"><Callout tone="critical">{error || queryError?.message}</Callout></div>}
      {(runsQuery.isPending || (selectedRun && listQuery.isPending)) ? <Loading label="Consultando sugestões…" /> : rows.length ? <div className="gmail-suggestion-list">{rows.map(draft => <article className={`gmail-suggestion-card ${issueId && draft.items.some(item => item.id === issueId) ? 'is-related' : ''}`} key={draft.id}>
        <div className="row between wrap"><strong>{draft.title}</strong><SuggestionBadge draft={draft} /></div>
        <p className="muted">{partyName(draft.counterparty)} · {draft.period} · {draft.item_count} {draft.item_count === 1 ? 'ocorrência' : 'ocorrências'}</p>
        <p><strong>Por que sugerimos:</strong> {draft.justification}</p>
        <p><strong>Ação sugerida:</strong> {draft.recommended_action}</p>
        {draft.duplicate_of && <p className="muted">Estas evidências já têm uma contestação registrada. Confira o registro antes de qualquer nova ação.</p>}
        {draft.blockers.length > 0 && <p className="muted">{draft.blockers[0].message}</p>}
        <div className="row between wrap"><span className="muted">Para: {draft.to || 'a definir'}{draft.to === DEMO_MAILBOX && ' · caixa da demo'}</span><button className="btn primary sm" disabled={busy} onClick={() => void act(() => open(draft))}>{locked(draft) ? 'Consultar registro' : 'Revisar sugestão'}</button></div>
      </article>)}</div> : <Empty icon="mail" title={summary?.prepared_at ? 'Nenhuma contestação sugerida nesta execução' : 'Nenhuma sugestão preparada ainda'}>{summary?.prepared_at ? 'Confira abaixo os motivos dos itens que ficaram fora das sugestões.' : selectedRun ? 'Prepare sugestões com as evidências preservadas desta execução. A preparação não envia e-mails.' : 'Execute ou teste o fluxo para preparar sugestões com evidências.'}</Empty>}
      {summary?.unavailable && <Callout tone="warning">{typeof summary.unavailable === 'string' ? summary.unavailable : typeof summary.unavailable === 'object' ? summary.unavailable.message : 'As evidências preservadas desta execução não estão disponíveis para preparar sugestões.'}</Callout>}
      {!!summary?.excluded?.length && <details className="gmail-advanced"><summary>{summary.excluded.length} ocorrências sem sugestão de envio</summary><ul className="gmail-excluded">{summary.excluded.map((item, index) => <li key={`${item.id}-${index}`}><strong>{item.id}</strong> · {item.reason}</li>)}</ul></details>}
      {!account?.authorized && <p className="muted">Você pode revisar e editar sugestões agora. Conecte o Gmail abaixo antes de salvar a versão final e autorizar o envio.</p>}
    </div>
    {review && <SuggestionEditor key={review.id} initial={review} account={account} onAccount={onAccount} onChanged={changed} onClose={() => setReview(null)} />}
  </section>;
}

function SuggestionEditor({ initial, account, onAccount, onChanged, onClose }: { initial: MailSuggestion; account?: MailAccount; onAccount: (value: MailAccount) => void; onChanged: (value: MailSuggestion) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [fields, setFields] = useState<MailFields>(fieldsOf(initial));
  const [actor, setActor] = useActor();
  const [confirming, setConfirming] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [refusalReason, setRefusalReason] = useState('');
  const [permissionKey, setPermissionKey] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const { busy, error, act } = useSuggestionAction();
  const reviewKey = suggestionReviewKey(draft, fields);
  const readonly = locked(draft) || unconfirmed;
  const canAuthorize = !busy && !unconfirmed && !!actor.trim() && canAuthorizeSuggestion(draft, fields, account);
  const dirty = draft.to !== fields.to || draft.subject !== fields.subject || draft.body !== fields.body;
  function edit(value: MailFields) { setFields(value); setPermissionKey(null); setConfirming(false); setNotice(''); }
  function replace(value: MailSuggestion) { setDraft(value); setFields(fieldsOf(value)); setPermissionKey(null); setConfirming(false); onChanged(value); }
  async function refresh() { onAccount(await mail.account()); replace(await suggestions.get(draft.id)); setUnconfirmed(false); }
  useEffect(() => {
    if (draft.status !== 'sending') return;
    let stopped = false, count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await suggestions.get(draft.id);
        if (stopped) return;
        replace(value);
        if (value.status !== 'sending') return;
      } catch { if (!stopped) setNotice('A consulta foi interrompida. Atualizar estado consulta o registro sem repetir o envio.'); }
      if (!stopped && ++count < 30) timer = setTimeout(poll, 2200);
    };
    timer = setTimeout(poll, 2200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [draft.id, draft.status]);

  async function save() {
    if (!fields.to.trim() || !fields.subject.trim() || !fields.body.trim()) throw new Error('Preencha destinatário, assunto e mensagem antes de salvar.');
    onAccount(await mail.account());
    replace(await suggestions.save(draft, { ...fields, to: fields.to.trim() }));
    setNotice('Versão salva. Confira abaixo o conteúdo e os anexos retornados antes de autorizar. Nenhuma mensagem foi enviada.');
  }
  async function send() {
    if (!canAuthorize || permissionKey !== reviewKey) throw new Error('Revise a versão salva e marque a permissão antes de enviar.');
    const currentAccount = await mail.account(); onAccount(currentAccount);
    if (!canAuthorizeSuggestion(draft, fields, currentAccount)) { setPermissionKey(null); setConfirming(false); throw new Error('A conta ou a mensagem mudou. Salve e revise novamente antes de autorizar.'); }
    setPermissionKey(null); setConfirming(false);
    try { replace(await suggestions.approve(draft, true)); setNotice('Tentativa registrada. Confira o resultado abaixo.'); }
    catch (failure) {
      try { replace(await suggestions.get(draft.id)); }
      catch { setUnconfirmed(true); setNotice('Não foi possível consultar o resultado. Confira a pasta Enviados; o envio permanece bloqueado nesta tela até atualizar o estado.'); }
      throw failure;
    }
  }

  return <>
    <Sheet title={readonly ? 'Registro da sugestão' : 'Revisar sugestão de contestação'} eyebrow={`${partyName(draft.counterparty)} · ${draft.period} · versão ${draft.version}`} sub={`Execução ${draft.run_id}`} onClose={() => { if (!busy) onClose(); }} footer={<div className="gmail-editor-actions">
      <button className="btn" disabled={busy} onClick={() => void act(refresh)}>Atualizar estado</button>
      {!readonly && <><button className="btn" disabled={busy} onClick={() => { setPermissionKey(null); setRefusing(true); }}>Recusar sugestão</button><button className="btn" disabled={busy} onClick={() => void act(save)}>Salvar para revisão</button><button className="btn primary" disabled={!canAuthorize} onClick={() => { setPermissionKey(null); setConfirming(true); }}>Revisar e dar permissão</button></>}
    </div>}>
      <div className="gmail-panel stack-lg">
        <SuggestionBadge draft={draft} />
        <div className="gmail-origin"><h3>{draft.title}</h3><p><strong>Por que sugerimos:</strong> {draft.justification}</p><p><strong>Ação sugerida:</strong> {draft.recommended_action}</p></div>
        {!!draft.limitations.length && <Callout tone="info"><strong>Limites desta sugestão</strong><ul>{draft.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></Callout>}
        {draft.to === DEMO_MAILBOX && <Callout tone="info">Destinatário da demo: esta mensagem vai para a caixa Tarvo. Para contatar Orbe ou Ponte, confira e substitua pelo contato correto.</Callout>}
        {draft.status === 'sent' && <Callout tone="good">{isTestProvider(draft.provider_mode) ? 'O provedor de teste aceitou a mensagem. Nenhum e-mail real foi enviado.' : 'O servidor aceitou esta mensagem após a permissão registrada. Isso não confirma entrega nem leitura.'}</Callout>}
        {draft.status === 'uncertain' && <Callout tone="warning">O resultado do envio é incerto. Confira a pasta Enviados da conta remetente. Este registro não permite repetir o envio.</Callout>}
        {draft.status === 'sending' && <Callout tone="info">Envio em andamento. A consulta de estado não repete a tentativa.</Callout>}
        {draft.status === 'failed' && <Callout tone="critical">{draft.error?.message || 'O envio falhou.'} Revise e salve uma nova versão antes de conceder outra permissão.</Callout>}
        {draft.duplicate_of && <Callout tone="warning">{draft.blockers.some(item => item.code === 'SUGGESTION_PARTIALLY_SENT') ? <>Parte destas evidências já está vinculada à contestação {draft.duplicate_of}. Atualize a sugestão para revisar somente as ocorrências ainda não enviadas.</> : <>Estas evidências já estão vinculadas à contestação {draft.duplicate_of}. Nenhum novo envio é liberado neste registro.</>}</Callout>}
        {!!draft.blockers.length && <Callout tone="warning"><strong>Antes de autorizar</strong><ul>{draft.blockers.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul></Callout>}
        {!readonly && draft.blockers.some(item => /STALE|EVIDENCE|DECISION|PARTIALLY_SENT/.test(item.code)) && <div className="stack"><button className="btn" disabled={busy} onClick={() => void act(async () => { onAccount(await mail.account()); replace(await suggestions.refresh(draft)); setNotice('Sugestão atualizada com as ocorrências ainda elegíveis. Confira o texto e os anexos da nova versão antes de dar permissão.'); })}>Atualizar sugestão</button><p className="muted">Regenera o texto e os anexos, retirando ocorrências já enviadas. A nova versão precisa de outra revisão e permissão.</p></div>}
        {notice && <Callout tone={unconfirmed ? 'warning' : 'info'}>{notice}</Callout>}
        {error && <div role="alert"><Callout tone="critical">{error}</Callout></div>}
        <dl className="facts"><div><dt>Remetente desta versão</dt><dd>{draft.sender?.email || 'Conecte uma conta e salve a versão'}</dd></div><div><dt>Conta conectada</dt><dd>{account?.authorized ? account.email : 'Não autorizada para enviar'}</dd></div></dl>
        <Field label="Destinatário" required><input className="input" type="email" maxLength={254} value={fields.to} disabled={readonly || busy} onChange={event => edit({ ...fields, to: event.target.value })} /></Field>
        <Field label="Assunto" required><input className="input" maxLength={500} value={fields.subject} disabled={readonly || busy} onChange={event => edit({ ...fields, subject: event.target.value })} /></Field>
        <Field label="Mensagem" required><textarea className="textarea" rows={12} maxLength={100000} value={fields.body} disabled={readonly || busy} onChange={event => edit({ ...fields, body: event.target.value })} /></Field>
        {!readonly && <><Field label="Responsável pela permissão" required><input className="input" maxLength={100} value={actor} disabled={busy} onChange={event => { setActor(event.target.value); setPermissionKey(null); }} /></Field><p className="muted">{dirty ? 'Há alterações não salvas. Salve para revisar a versão que será enviada.' : !draft.sender ? 'Conecte o Gmail e salve para vincular o remetente à mensagem.' : 'A permissão vale somente para esta versão, destinatário, remetente e anexos.'}</p></>}
        <section className="stack"><h3 className="section-title">Ocorrências que justificam a sugestão</h3><p className="muted">Valores informativos de exposição. Não representam, por si só, um valor a cobrar ou restituir.</p><ul className="gmail-suggestion-items">{draft.items.map(item => <li key={item.id}><strong>{item.reference || item.id}</strong><p>{item.reason}</p>{item.value_brl != null && <span className="muted">Exposição informada: {money(item.value_brl)}</span>}</li>)}</ul></section>
        <section className="stack"><h3 className="section-title">Evidências desta execução</h3>{draft.attachments.map(file => <div className="gmail-attachment" key={file.id}><Icon name="file" /><div className="grow"><strong>{file.name}</strong><p className="muted">{file.size.toLocaleString('pt-BR')} bytes</p></div><a className="btn sm" href={file.url} target="_blank" rel="noreferrer">Ver</a><a className="btn sm" href={`${file.url}?download=1`} download>Baixar</a></div>)}</section>
        {draft.approval && <p className="muted">Versão {draft.approval.version} autorizada por {draft.approval.declared_actor} em {dateTimeBR(draft.approval.at)}.</p>}
      </div>
    </Sheet>
    {refusing && <Modal title="Recusar sugestão" onClose={() => { if (!busy) setRefusing(false); }} footer={<><button className="btn" disabled={busy} onClick={() => setRefusing(false)}>Voltar</button><button className="btn" disabled={busy || !refusalReason.trim() || !actor.trim()} onClick={() => void act(async () => { replace(await suggestions.dismiss(draft, refusalReason.trim())); setRefusing(false); setNotice('Sugestão recusada. Nenhum e-mail foi enviado.'); })}>Registrar recusa</button></>}><div className="stack"><p>A recusa mantém o registro e a justificativa para consulta.</p><Field label="Motivo da recusa" required><textarea className="textarea" rows={3} maxLength={2000} value={refusalReason} disabled={busy} onChange={event => setRefusalReason(event.target.value)} /></Field><Field label="Responsável" required><input className="input" value={actor} maxLength={100} disabled={busy} onChange={event => setActor(event.target.value)} /></Field>{error && <Callout tone="critical">{error}</Callout>}</div></Modal>}
    {confirming && <Modal wide title="Você autoriza o envio desta contestação?" sub={`Versão ${draft.version} · ${draft.item_count} ocorrências · ${partyName(draft.counterparty)}`} onClose={() => { if (!busy) { setConfirming(false); setPermissionKey(null); } }} footer={<><button className="btn" disabled={busy} onClick={() => { setConfirming(false); setPermissionKey(null); }}>Voltar à revisão</button><button className="btn primary" disabled={!canAuthorize || permissionKey !== reviewKey} onClick={() => void act(send)}><Icon name="send" />Autorizar e enviar esta versão</button></>}>
      <div className="stack-lg">
        <p><strong>Justificativa:</strong> {draft.justification}</p>
        <dl className="facts"><div><dt>De</dt><dd>{draft.sender?.email}</dd></div><div><dt>Para</dt><dd>{draft.to}</dd></div><div><dt>Assunto</dt><dd>{draft.subject}</dd></div></dl>
        <pre className="email-body gmail-permission-preview">{draft.body}</pre>
        <p><strong>Anexos:</strong> {draft.attachments.map(file => file.name).join(', ') || 'Nenhum'}</p>
        <label className="gmail-permission"><input type="checkbox" checked={permissionKey === reviewKey} disabled={busy} onChange={event => setPermissionKey(event.target.checked ? reviewKey : null)} /><span>Revisei o conteúdo e as evidências. Autorizo enviar esta contestação para <strong>{draft.to}</strong>, usando a conta <strong>{draft.sender?.email}</strong>.</span></label>
        <p className="muted">{isTestProvider(account?.provider_mode) ? 'O provedor atual é de teste; a tentativa será simulada.' : 'Esta permissão inicia um envio real.'} Nenhuma permissão é reaproveitada para outras sugestões ou execuções.</p>
      </div>
    </Modal>}
  </>;
}
