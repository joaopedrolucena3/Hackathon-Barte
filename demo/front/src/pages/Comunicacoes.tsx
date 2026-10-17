// Communications log: drafts and simulated sends, internal notices and who receives them.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { core } from '../api/core';
import type { Email, Notification } from '../api/types';
import { DataTable } from '../components/DataTable';
import { EMAIL_KIND, EmailEditor, emailStage } from '../components/EmailEditor';
import { Icon } from '../components/Icon';
import { GmailPanel } from '../components/GmailPanel';
import { Sheet } from '../components/Overlay';
import { Badge, Callout, Empty, Loading, PageHead, Segmented, SeverityBadge, Tabs } from '../components/ui';
import { count, dateTimeBR } from '../lib/format';
import { keys, useAppState } from '../state/queries';
import { useAction } from '../state/useAction';

type Tab = 'gmail' | 'envios' | 'avisos' | 'destinatarios';
type Filter = 'all' | 'draft' | 'approved' | 'sent';

export default function Comunicacoes() {
  const { data: state } = useAppState();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [notice, setNotice] = useState<Notification | null>(null);
  const { run, busy } = useAction();
  if (!state) return <Loading page />;
  const tab = (params.get('aba') as Tab) || 'envios';
  const emailId = params.get('email');
  const emails = [...state.emails].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const visible = emails.filter(email => filter === 'all' || (filter === 'sent' ? ['simulated', 'sent'].includes(email.status) : email.status === filter));
  const internal = state.contacts.filter(contact => contact.kind === 'internal');
  const relatedCnpj = (email: Email) => state.results.notas.find(nota => nota.id_saida === email.related_id)?.tomador_cnpj
    || state.results.pendencias.find(p => p.id_saida === email.related_id)?.cnpj;

  return (
    <>
      <PageHead
        title="Comunicações"
        sub="Mensagens de pendências pelo Gmail, cobranças simuladas e avisos internos, com revisão e histórico."
        actions={<>
          <button className="btn" disabled={!!busy} onClick={() => run('notify', () => core.runNotifications(), { success: 'Avisos processados em modo simulação.', invalidate: [keys.state] })}><Icon name="bell" />Processar avisos</button>
          <button className="btn primary" disabled={!!busy} onClick={async () => {
            const result = await run('report', () => core.draftEmail({ report: true }), { success: 'Rascunho do relatório preparado.', invalidate: [keys.state] });
            const id = result?.id || result?.email?.id;
            if (id) setParams({ email: id });
          }}><Icon name="mail" />E-mail do relatório</button>
        </>}
      />
      {tab !== 'gmail' && <div style={{ marginBottom: 16 }}><Callout tone="info"><strong>Envios simulados.</strong> Cobranças, relatórios e avisos desta aba não enviam mensagens reais. O envio de pendências pela conta autorizada fica na aba Gmail.</Callout></div>}
      <Tabs<Tab> value={tab} onChange={value => setParams({ aba: value })} items={[
        { value: 'gmail', label: 'Gmail · pendências', icon: 'mail' },
        { value: 'envios', label: 'Envios simulados', count: emails.length, icon: 'mail' },
        { value: 'avisos', label: 'Avisos internos', count: state.notifications.length, icon: 'bell' },
        { value: 'destinatarios', label: 'Quem recebe', count: internal.length, icon: 'user' },
      ]} />

      {tab === 'gmail' && <GmailPanel issues={state.results.pendencias} issueId={params.get('pendencia')} />}

      {tab === 'envios' && (
        <div className="card">
          <DataTable<Email>
            rows={visible}
            rowKey={row => String(row.id)}
            search={row => `${row.subject} ${row.to}`}
            onRowClick={row => setParams({ email: String(row.id) })}
            toolbar={<Segmented value={filter} onChange={setFilter} label="Situação" options={[{ value: 'all', label: 'Todos' }, { value: 'draft', label: 'Rascunhos' }, { value: 'approved', label: 'Aprovados' }, { value: 'sent', label: 'Enviados' }]} />}
            empty={<Empty icon="mail" title="Nada por aqui ainda">Prepare uma cobrança em Notas e bancos, uma contestação na revisão ou o e-mail do relatório.</Empty>}
            columns={[
              { key: 'kind', label: 'Tipo', render: row => <Badge tone={row.kind === 'internal' ? 'info' : row.kind === 'dispute' ? 'warning' : 'neutral'}>{EMAIL_KIND[row.kind]}</Badge> },
              { key: 'stage', label: 'Situação', render: row => { const stage = emailStage(row); return <Badge tone={stage.tone} dot>{stage.label}</Badge>; } },
              { key: 'subject', label: 'Assunto', wrap: true, render: row => <span className="strong">{row.subject}</span> },
              { key: 'to', label: 'Para', render: row => row.to || <span className="muted">sem destinatário</span> },
              { key: 'approved', label: 'Aprovação', render: row => row.approved_by ? `${row.approved_by} · ${dateTimeBR(row.approved_at)}` : <span className="muted">—</span> },
              { key: 'at', label: 'Criado', render: row => dateTimeBR(row.sent_at || row.created_at), value: row => row.created_at || '' },
            ]}
          />
        </div>
      )}

      {tab === 'avisos' && (
        <div className="card">
          <DataTable<Notification>
            rows={[...state.notifications].sort((a, b) => b.at.localeCompare(a.at))}
            rowKey={row => row.id}
            search={row => `${row.title} ${row.body}`}
            onRowClick={setNotice}
            empty={<Empty icon="bell" title="Nenhum aviso">Os avisos aparecem quando surgem eventos ou ao processar avisos.</Empty>}
            columns={[
              { key: 'at', label: 'Quando', render: row => dateTimeBR(row.at) },
              { key: 'severity', label: 'Severidade', render: row => <SeverityBadge severity={row.severity} /> },
              { key: 'title', label: 'Aviso', wrap: true, render: row => <><span className="strong">{row.title}</span><p className="muted" style={{ fontSize: 12 }}>{row.body}</p></> },
              { key: 'deliveries', label: 'Entregas simuladas', align: 'right', render: row => row.deliveries?.length ? <Badge tone="info">{count(row.deliveries.length)}</Badge> : <span className="muted">nenhuma</span> },
            ]}
          />
        </div>
      )}

      {tab === 'destinatarios' && (
        <div className="card">
          <div className="card-head">
            <div><h3 className="card-title">Contatos de avisos internos</h3><p className="card-sub">Severidade mínima e frequência de cada pessoa</p></div>
            <Link className="btn sm" to="/cadastros?aba=contatos"><Icon name="edit" />Gerenciar em Cadastros</Link>
          </div>
          <div className="card-body stack" style={{ gap: 8 }}>
            {internal.length ? internal.map(contact => (
              <div key={contact.id} className="contact-row">
                <Icon name="user" />
                <div className="grow"><strong>{contact.name}</strong><p className="muted" style={{ fontSize: 12.5 }}>{contact.email}</p></div>
                <SeverityBadge severity={contact.min_severity} />
                <Badge tone="outline">{contact.frequency === 'immediate' ? 'Imediato' : 'Resumo diário'}</Badge>
                <Badge tone={contact.enabled ? 'good' : 'neutral'} dot>{contact.enabled ? 'Ativo' : 'Inativo'}</Badge>
              </div>
            )) : <Empty icon="user" title="Ninguém recebe avisos ainda">Cadastre um contato interno para receber pendências novas, bloqueantes e prazos.</Empty>}
          </div>
        </div>
      )}

      {emailId && <EmailEditor emailId={emailId} cnpj={relatedCnpj(state.emails.find(email => String(email.id) === emailId) || ({} as Email))} onClose={() => { params.delete('email'); setParams(params); }} />}
      {notice && (
        <Sheet narrow eyebrow="Aviso interno" title={notice.title} sub={dateTimeBR(notice.at)} onClose={() => setNotice(null)}>
          <div className="stack-lg">
            <SeverityBadge severity={notice.severity} />
            <p>{notice.body}</p>
            {notice.link && <p className="muted mono">{notice.link}</p>}
            <div>
              <h4 className="section-title">Entregas simuladas</h4>
              {notice.deliveries?.length ? <pre className="email-body">{JSON.stringify(notice.deliveries, null, 2)}</pre> : <p className="muted">Sem destinatário interno ativo no momento do aviso.</p>}
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
