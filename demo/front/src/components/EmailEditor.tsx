// Billing/dispute/internal e-mail review. Approval binds to the exact content; any edit invalidates it.
import { useEffect, useState } from 'react';
import { core } from '../api/core';
import type { Email } from '../api/types';
import { dateTimeBR } from '../lib/format';
import { keys, useAppState } from '../state/queries';
import { useAction } from '../state/useAction';
import { Icon } from './Icon';
import { Sheet } from './Overlay';
import { Badge, Callout, Field } from './ui';

export const EMAIL_KIND: Record<Email['kind'], string> = { billing: 'Cobrança', dispute: 'Contestação', internal: 'Interno' };

export function emailStage(email?: Email) {
  if (!email) return { label: 'Proposta', step: 0, tone: 'neutral' as const };
  if (email.stale) return { label: 'Rascunho desatualizado', step: 1, tone: 'warning' as const };
  if (email.status === 'simulated' || email.status === 'sent') return { label: 'Enviada (simulada)', step: 3, tone: 'good' as const };
  if (email.status === 'approved') return { label: 'Aprovada', step: 2, tone: 'info' as const };
  return { label: 'Rascunho', step: 1, tone: 'accent' as const };
}

export function EmailEditor({ emailId, onClose, cnpj }: { emailId: string; onClose: () => void; cnpj?: string }) {
  const { data: state } = useAppState();
  const email = state?.emails.find(item => String(item.id) === String(emailId));
  const { run, busy } = useAction();
  const [form, setForm] = useState({ to: '', subject: '', body: '' });
  useEffect(() => { if (email) setForm({ to: email.to || '', subject: email.subject || '', body: email.body || '' }); }, [email?.id, email?.to, email?.subject, email?.body]);
  if (!state || !email) return null;

  const sent = email.status === 'simulated' || email.status === 'sent';
  const dirty = form.to !== (email.to || '') || form.subject !== email.subject || form.body !== email.body;
  const needsApproval = email.kind !== 'internal';
  const canSend = !email.stale && !dirty && (email.status === 'approved' || !needsApproval) && !!email.to;
  const contacts = state.contacts.filter(contact => contact.enabled && contact.email && (email.kind === 'internal' ? contact.kind === 'internal' : contact.cnpj === cnpj));
  const stage = emailStage(email);
  const refresh = [keys.state];

  return (
    <Sheet
      narrow
      eyebrow={`${EMAIL_KIND[email.kind]} · modo simulação`}
      title={sent ? 'Registro de envio simulado' : 'Revisar e-mail'}
      sub={needsApproval ? 'Nenhuma cobrança sai sem aprovação explícita desta versão.' : 'Aviso interno: dispensa aprovação.'}
      onClose={onClose}
      footer={sent ? <button className="btn" onClick={onClose}>Fechar</button> : <>
        <span className="muted grow" style={{ fontSize: 12 }}>{email.approved_by ? `Aprovado por ${email.approved_by} · ${dateTimeBR(email.approved_at)}` : dirty ? 'Salve antes de aprovar.' : 'Aguardando revisão.'}</span>
        <button className="btn" disabled={!dirty || !!busy} onClick={() => run('save', () => core.saveEmail({ id: email.id, ...form }), { success: 'Rascunho salvo. A aprovação anterior deixa de valer.', invalidate: refresh })}>Salvar</button>
        {needsApproval && (
          <button className="btn dark" disabled={dirty || email.stale || email.status === 'approved' || !form.to || !!busy}
            onClick={() => run('approve', () => core.approveEmail(email.id), { success: 'Versão aprovada. O envio continua simulado.', invalidate: refresh })}>
            <Icon name="check" />Aprovar esta versão
          </button>
        )}
        <button className="btn primary" disabled={!canSend || !!busy}
          onClick={() => run('send', () => core.sendEmail(email.id), { success: 'Envio simulado registrado. Nenhuma mensagem real saiu.', invalidate: refresh })}>
          <Icon name="send" />Simular envio
        </button>
      </>}
    >
      <div className="stack-lg">
        <div className="row wrap">
          <Badge tone={stage.tone} dot>{stage.label}</Badge>
          <span className="muted" style={{ fontSize: 12 }}>Criado {dateTimeBR(email.created_at)}{email.sent_at && ` · simulado ${dateTimeBR(email.sent_at)}`}</span>
        </div>
        {email.stale && <Callout tone="warning" icon="alert">O cálculo mudou depois deste rascunho. Prepare uma nova versão com os valores atuais.</Callout>}
        {sent ? (
          <>
            <dl className="facts">
              <div><dt>Para</dt><dd>{email.to}</dd></div>
              <div><dt>Assunto</dt><dd>{email.subject}</dd></div>
              <div><dt>Aprovado por</dt><dd>{email.approved_by || '—'}</dd></div>
            </dl>
            <pre className="email-body">{email.body}</pre>
          </>
        ) : (
          <>
            <Field label="Destinatário" required help={!form.to ? 'Sem contato cadastrado: informe o e-mail ou cadastre em Cadastros.' : undefined}>
              <input className="input" type="email" value={form.to} onChange={event => setForm({ ...form, to: event.target.value })} placeholder="financeiro@example.com" />
            </Field>
            {!!contacts.length && (
              <div className="reason-chips">
                {contacts.map(contact => <button key={contact.id} type="button" className="reason-chip" aria-pressed={form.to === contact.email} onClick={() => setForm({ ...form, to: contact.email })}>{contact.name} · {contact.email}</button>)}
              </div>
            )}
            <Field label="Assunto" required><input className="input" value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })} /></Field>
            <Field label="Mensagem" required><textarea className="textarea" rows={12} value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} /></Field>
          </>
        )}
      </div>
    </Sheet>
  );
}
