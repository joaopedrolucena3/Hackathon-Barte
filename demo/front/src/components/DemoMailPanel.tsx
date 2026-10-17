import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEMO_MAILBOX, deliveryLabel, isTestProvider, mail, type Counterparty, type MailAccount, type MailDelivery, type MailFields, type MailNotificationSettings } from '../api/mail';
import { useActor } from '../lib/actor';
import { dateTimeBR } from '../lib/format';
import { Badge, Callout, Field, Loading } from './ui';
import { Icon } from './Icon';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const partyName = (party: Counterparty) => party === 'orbe' ? 'Orbe' : 'Ponte';
const template = (party: Counterparty): MailFields => ({
  to: DEMO_MAILBOX,
  subject: `[Demo Tarvo] Comunicação com ${partyName(party)}`,
  body: `Olá, equipe ${partyName(party)}.\n\nEste é um e-mail de demonstração da Tarvo para confirmar o funcionamento do canal de comunicação.\n\nPor favor, confirmem o recebimento.\n\nEquipe Financeira Tarvo`,
});

function useAction() {
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

export function DemoMailPanel({ account, loading, onAccount, onDisconnect, onRefresh }: {
  account?: MailAccount; loading: boolean; onAccount: (account: MailAccount) => void;
  onDisconnect: () => void; onRefresh: () => Promise<void>;
}) {
  const [email, setEmail] = useState(DEMO_MAILBOX);
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const connected = !!account?.authorized && !!account.connected;
  const simulated = isTestProvider(account?.provider_mode);

  return <>
    <section className="card gmail-demo-connect">
      <div className="card-head">
        <div className="gmail-step-title"><span className="gmail-step-number">1</span><div><h3 className="card-title">Conectar o e-mail</h3><p className="card-sub">A mesma conta envia as mensagens e recebe os avisos da demo.</p></div></div>
        <Badge tone={connected ? 'good' : 'neutral'} dot>{connected ? 'Conectado' : 'Conecte para enviar'}</Badge>
      </div>
      <div className="card-body stack">
        {loading ? <Loading label="Consultando conexão…" /> : <>
          {connected ? <div className="gmail-connected row wrap"><Icon name="mail" /><strong>{account?.email}</strong><Badge tone="outline">{simulated ? 'Provedor simulado' : 'Envio real'}</Badge><button className="btn sm" type="button" disabled={busy} onClick={onDisconnect}>Desconectar</button></div> : <form className="stack" onSubmit={event => {
            event.preventDefault();
            const submittedPassword = password;
            setPassword('');
            void run(async () => {
              try { onAccount(await mail.connectSmtp(email.trim(), submittedPassword)); await onRefresh(); }
              finally { setPassword(''); }
            });
          }}>
            <div className="gmail-login-grid">
              <Field label="Conta Gmail" required><input className="input" type="email" value={email} maxLength={254} required autoComplete="username" disabled={busy || !account?.smtp_available} onChange={event => setEmail(event.target.value)} /></Field>
              <Field label="Senha de app do Google" required help={<>Ative a verificação em duas etapas na conta Google. Depois, <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">crie uma senha de app</a> e use os 16 caracteres gerados.</>}><input className="input" type="password" value={password} required autoComplete="new-password" spellCheck={false} disabled={busy || !account?.smtp_available} onChange={event => setPassword(event.target.value)} /></Field>
            </div>
            {!account?.smtp_available && <Callout tone="warning">A conexão simplificada está indisponível no servidor. <a href="/api/mail/setup" target="_blank" rel="noreferrer">Ver configuração</a>.</Callout>}
            <div className="row wrap"><button className="btn primary" disabled={busy || !account?.smtp_available || !password.trim()}>{busy ? 'Conectando…' : 'Conectar Gmail'}</button><span className="muted">Sua sessão permanece conectada por até 30 dias.</span></div>
          </form>}
          {simulated && <Callout tone="warning">O provedor atual é simulado. Conecte uma conta Gmail real para enviar e-mails.</Callout>}
          <details className="gmail-advanced"><summary>Conexão Google avançada</summary><div className="stack">
            <p className="muted">Use a autorização Google se ela já estiver configurada para esta demo.</p>
            {!account?.oauth_configured && <p className="muted">Autorização Google ainda não configurada. <a href="/api/mail/setup" target="_blank" rel="noreferrer">Ver guia</a>.</p>}
            <div className="row wrap"><button className="btn" type="button" disabled={busy || !account?.oauth_configured} onClick={() => void run(async () => {
              await mail.account();
              const result = await mail.connect();
              const url = new URL(result.authorization_url, window.location.origin);
              if (!['https:', 'http:'].includes(url.protocol)) throw new Error('O servidor retornou uma URL de autorização inválida.');
              window.location.assign(url.href);
            })}>Conectar com Google</button><button className="btn" type="button" disabled={busy} onClick={() => void run(onRefresh)}><Icon name="refresh" />Atualizar conexão</button></div>
          </div></details>
        </>}
        {error && <div role="alert"><Callout tone="critical">{error}</Callout></div>}
      </div>
    </section>
    <RunNotifications account={account} />
    <details className="gmail-issue-workflow"><summary>Testar o canal de e-mail <span className="muted">Mensagem livre da demo, enviada somente quando você autoriza</span></summary><QuickMail account={account} /></details>
  </>;
}

function QuickMail({ account }: { account?: MailAccount }) {
  const client = useQueryClient();
  const [party, setParty] = useState<Counterparty>('orbe');
  const [fields, setFields] = useState<MailFields>(() => template('orbe'));
  const [actor, setActor] = useActor();
  const [result, setResult] = useState<MailDelivery | null>(null);
  const [permissionSignature, setPermissionSignature] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const { busy, error, run, setError } = useAction();
  const authorized = !!account?.authorized && !!account.connected && !isTestProvider(account.provider_mode);
  const historyKey = ['mail', 'demo-deliveries', account?.connection?.connection_id || account?.email];
  const history = useQuery({ queryKey: historyKey, queryFn: mail.demoDeliveries, enabled: !!account?.authorized, retry: false });
  const signature = JSON.stringify({ counterparty: party, ...fields, sender: account?.connection?.connection_id, actor });
  const completed = !!result && attempt.current?.signature === signature;
  function edit(value: MailFields) { setFields(value); setResult(null); setError(''); setPermissionSignature(null); }

  return <section className="card">
    <div className="card-head"><div className="gmail-step-title"><span className="gmail-step-number">2</span><div><h3 className="card-title">Enviar para Orbe ou Ponte</h3><p className="card-sub">Confira o destinatário, ajuste a mensagem e envie.</p></div></div><Badge tone="outline">E-mail real</Badge></div>
    <form className="card-body stack" onSubmit={event => {
      event.preventDefault();
      if (completed || !authorized || permissionSignature !== signature) return;
      void run(async () => {
        setPermissionSignature(null);
        if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
        const delivery = await mail.sendDemo({ counterparty: party, ...fields, request_id: attempt.current.id });
        setResult(delivery);
        await client.invalidateQueries({ queryKey: historyKey });
      });
    }}>
      <div className="gmail-login-grid"><Field label="Empresa"><select className="input" disabled={busy} value={party} onChange={event => {
        const next = event.target.value as Counterparty; setParty(next); edit({ ...template(next), to: fields.to });
      }}><option value="orbe">Orbe</option><option value="ponte">Ponte</option></select></Field><Field label="Destinatário da demonstração" required help="A demo usa a própria caixa Tarvo. Edite este endereço para enviar a outro contato."><input className="input" type="email" required maxLength={254} value={fields.to} disabled={busy} onChange={event => edit({ ...fields, to: event.target.value })} /></Field></div>
      <Field label="Assunto" required><input className="input" value={fields.subject} required maxLength={500} disabled={busy} onChange={event => edit({ ...fields, subject: event.target.value })} /></Field>
      <Field label="Mensagem" required><textarea className="textarea" rows={6} required maxLength={100000} value={fields.body} disabled={busy} onChange={event => edit({ ...fields, body: event.target.value })} /></Field>
      <Field label="Responsável pelo envio" required><input className="input" value={actor} maxLength={100} required disabled={busy} placeholder="Seu nome" onChange={event => setActor(event.target.value)} /></Field>
      <p className="muted">De: <strong>{account?.email || DEMO_MAILBOX}</strong> · Para: <strong>{fields.to || 'informe um destinatário'}</strong></p>
      {!authorized && <p className="muted">Conecte a conta Gmail acima para liberar o envio.</p>}
      <label className="gmail-permission"><input type="checkbox" checked={permissionSignature === signature} disabled={busy || !authorized || completed} onChange={event => setPermissionSignature(event.target.checked ? signature : null)} /><span>Revisei a mensagem e autorizo este envio real para <strong>{fields.to || 'o destinatário informado'}</strong>.</span></label>
      <div className="row wrap"><button className="btn primary" disabled={busy || !authorized || completed || !actor.trim() || permissionSignature !== signature}><Icon name="send" />{busy ? 'Enviando…' : completed ? 'Tentativa registrada' : 'Autorizar e enviar e-mail real'}</button>{completed && result && ['failed', 'unavailable'].includes(result.status) && <button className="btn" type="button" disabled={busy} onClick={() => { attempt.current = null; setResult(null); setError(''); setPermissionSignature(null); }}>Preparar nova tentativa</button>}<button className="btn" type="button" disabled={busy || !account?.authorized} onClick={() => void history.refetch()}><Icon name="refresh" />Consultar histórico</button></div>
      {result && <DeliveryFeedback delivery={result} />}
      {error && <div role="alert"><Callout tone="critical">{error} Consulte o histórico antes de continuar. Uma nova tentativa com o mesmo conteúdo mantém o identificador do envio.</Callout></div>}
      {history.error && <Callout tone="warning">Não foi possível consultar o histórico: {errorMessage(history.error)}</Callout>}
      <DeliveryHistory deliveries={history.data || []} empty="Os envios para Orbe e Ponte aparecerão aqui." />
    </form>
  </section>;
}

function RunNotifications({ account }: { account?: MailAccount }) {
  const client = useQueryClient();
  const [settings, setSettings] = useState<Pick<MailNotificationSettings, 'enabled' | 'recipient'>>({ enabled: false, recipient: DEMO_MAILBOX });
  const [savedNotice, setSavedNotice] = useState('');
  const [testResult, setTestResult] = useState<MailDelivery | null>(null);
  const [testUnconfirmed, setTestUnconfirmed] = useState(false);
  const { busy, error, run } = useAction();
  const authorized = !!account?.authorized && !!account.connected && !isTestProvider(account.provider_mode);
  const connection = account?.connection?.connection_id || account?.email;
  const settingsKey = ['mail', 'notification-settings', connection];
  const historyKey = ['mail', 'notification-deliveries', connection];
  const saved = useQuery({ queryKey: settingsKey, queryFn: mail.notifications, enabled: !!account?.authorized, retry: false });
  const history = useQuery({ queryKey: historyKey, queryFn: mail.notificationDeliveries, enabled: !!account?.authorized, retry: false, refetchInterval: account?.authorized ? 15000 : false });
  useEffect(() => {
    setSettings({ enabled: saved.data?.enabled ?? false, recipient: saved.data?.recipient || DEMO_MAILBOX });
  }, [saved.data, connection]);
  const needsReconnect = !!saved.data?.enabled && saved.data.connection_id !== account?.connection?.connection_id;
  const dirty = !saved.data || needsReconnect || saved.data.enabled !== settings.enabled || saved.data.recipient !== settings.recipient;

  return <section className="card">
    <div className="card-head"><div className="gmail-step-title"><span className="gmail-step-number">2</span><div><h3 className="card-title">Avisos internos de runs e testes</h3><p className="card-sub">Ative os avisos e confirme a conexão com um e-mail de teste.</p></div></div><Badge tone={saved.data?.enabled && !needsReconnect ? 'good' : 'neutral'}>{needsReconnect ? 'Confirmação pendente' : saved.data?.enabled ? 'Avisos ativados' : 'Avisos desativados'}</Badge></div>
    <form className="card-body stack" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        const result = await mail.saveNotifications(settings);
        client.setQueryData(settingsKey, result);
        setSavedNotice(result.enabled ? `Avisos ativados para ${result.recipient}.` : 'Avisos automáticos desativados.');
        setTestUnconfirmed(false);
      });
    }}>
      <label className="row"><input type="checkbox" checked={settings.enabled} disabled={busy || !authorized} onChange={event => { setSettings({ ...settings, enabled: event.target.checked }); setSavedNotice(''); }} />Enviar avisos automáticos por e-mail</label>
      {needsReconnect && <Callout tone="warning">Confirme os avisos para esta conta. Salve novamente para vincular os próximos avisos à conexão atual.</Callout>}
      <Field label="E-mail que recebe os avisos" required><input className="input" type="email" value={settings.recipient} required maxLength={254} disabled={busy || !authorized} onChange={event => { setSettings({ ...settings, recipient: event.target.value }); setSavedNotice(''); }} /></Field>
      <p className="muted">Esta autorização vale para avisos internos sobre a execução. Contestações para parceiros continuam exigindo sua permissão individual. O botão abaixo envia um teste real para o destinatário salvo.</p>
      <div className="row wrap"><button className="btn primary" disabled={busy || !authorized || !dirty}>Salvar avisos</button><button className="btn" type="button" disabled={busy || !authorized || dirty || testUnconfirmed} onClick={() => void run(async () => {
        setTestResult(null);
        try { const result = await mail.testNotification(); setTestResult(result); setTestUnconfirmed(['uncertain', 'sending'].includes(result.status)); }
        catch (failure) { setTestUnconfirmed(true); throw failure; }
        finally { await client.invalidateQueries({ queryKey: historyKey }); }
      })}><Icon name="send" />{busy ? 'Aguarde…' : 'Enviar e-mail de teste'}</button><button className="btn" type="button" disabled={busy || !account?.authorized} onClick={() => void history.refetch()}><Icon name="refresh" />Consultar avisos</button></div>
      {dirty && authorized && <p className="muted">Salve o destinatário e a opção de avisos antes de enviar o teste.</p>}
      {savedNotice && <div role="status"><Callout tone="good">{savedNotice}</Callout></div>}
      {testResult && <DeliveryFeedback delivery={testResult} />}
      {testUnconfirmed && <Callout tone="warning">Não foi possível confirmar a resposta do teste. Confira o histórico e a caixa de e-mail antes de iniciar outro teste.</Callout>}
      {error && <div role="alert"><Callout tone="critical">{error}</Callout></div>}
      {(saved.error || history.error) && <Callout tone="warning">{errorMessage(saved.error || history.error)}</Callout>}
      <DeliveryHistory deliveries={history.data || []} empty="Os avisos das runs e os e-mails de teste aparecerão aqui." />
    </form>
  </section>;
}

function DeliveryFeedback({ delivery }: { delivery: MailDelivery }) {
  const message = typeof delivery.error === 'string' ? delivery.error : delivery.error?.message;
  if (delivery.status === 'sending') return <Callout tone="info">O envio está em andamento. Consulte o histórico para acompanhar o resultado.</Callout>;
  if (delivery.status === 'unavailable') return <Callout tone="warning">Nenhum e-mail foi enviado: a conta está indisponível. Conecte a conta Gmail e confira a configuração dos avisos. {message}</Callout>;
  if (delivery.status === 'accepted' && isTestProvider(delivery.provider_mode)) return <Callout tone="info">O provedor de teste aceitou a mensagem. Nenhum e-mail real foi enviado.</Callout>;
  if (delivery.status === 'accepted') return <div role="status"><Callout tone="good">Aceito pelo servidor de e-mail para {delivery.recipient}. Confira a caixa de entrada e o spam; a aceitação não confirma a entrega.</Callout></div>;
  if (delivery.status === 'uncertain') return <Callout tone="warning">O resultado deste envio é incerto. Confira a caixa de e-mail e o histórico antes de preparar outra mensagem. {message}</Callout>;
  return <Callout tone="critical">O envio falhou. {message}</Callout>;
}

function DeliveryHistory({ deliveries, empty }: { deliveries: MailDelivery[]; empty: string }) {
  return <details className="gmail-advanced gmail-deliveries"><summary>Histórico de envios <span className="muted">({deliveries.length})</span></summary>{!deliveries.length ? <p className="muted">{empty}</p> : <ol className="gmail-history">{[...deliveries].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map(delivery => <li key={delivery.id}>
    <div className="row wrap"><strong>{delivery.subject}</strong><Badge tone={delivery.status === 'accepted' ? 'good' : delivery.status === 'failed' ? 'critical' : delivery.status === 'sending' ? 'info' : 'warning'}>{deliveryLabel(delivery)}</Badge></div>
    <p>{delivery.recipient} · {dateTimeBR(delivery.created_at)}{delivery.run_id && ` · Run ${delivery.run_id}`}</p>
    {delivery.error && <p>{typeof delivery.error === 'string' ? delivery.error : delivery.error.message}</p>}
  </li>)}</ol>}</details>;
}
