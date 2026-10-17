// B5: one exception with its origin and the reviewer's decision (accept, adjust, exclude from the batch).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { agent, type ReviewAction, type ReviewException, type Run } from '../api/agent';
import { cnpj, dateBR, dateTimeBR, money, readable } from '../lib/format';
import { keys, useAppState, useRunAccounts } from '../state/queries';
import { useAction } from '../state/useAction';
import { Icon } from './Icon';
import { Badge, Callout, Field, Money, ReasonInput, Segmented } from './ui';

const ACTIONS: { value: ReviewAction; label: string }[] = [
  { value: 'accept', label: 'Aceitar' }, { value: 'adjust', label: 'Ajustar' }, { value: 'exclude', label: 'Excluir do lote' },
];
export const DECISION_LABEL: Record<string, string> = { accept: 'Aceita', adjust: 'Ajustada', exclude: 'Excluída do lote' };

export function DecisionBadge({ exception }: { exception: ReviewException }) {
  const d = exception.decision;
  if (!d) return <Badge tone={exception.severity === 'bloqueante' ? 'critical' : 'warning'} dot>Aberta</Badge>;
  return <Badge tone={d.action === 'exclude' ? 'neutral' : d.action === 'adjust' ? 'info' : 'good'} dot>{DECISION_LABEL[d.action]}</Badge>;
}

export interface DecisionPreset { action: ReviewAction; note: string }

export function ExceptionDetail({ exception, run, editable, onClose, onDecided, preset }: {
  exception: ReviewException; run: Run; editable: boolean; onClose?: () => void;
  /** Review flow: called after a decision so the list can move to the next open item. */
  onDecided?: (exception: ReviewException, decision: DecisionPreset) => void;
  /** Last decision, offered as a one-click repeat for similar items. */
  preset?: DecisionPreset | null;
}) {
  const { data: state } = useAppState();
  const { data: runAccounts } = useRunAccounts(run.id);
  const [action, setAction] = useState<ReviewAction>('accept');
  const [note, setNote] = useState('');
  const [account, setAccount] = useState(exception.current_account || '');
  const [amount, setAmount] = useState('');
  const [entryId, setEntryId] = useState('');
  const [changing, setChanging] = useState(false);
  const { run: act, busy } = useAction();
  useEffect(() => { setAction('accept'); setNote(''); setAmount(''); setEntryId(exception.associated_entries?.length === 1 ? exception.associated_entries[0].entry_id : ''); setAccount(exception.current_account || ''); setChanging(false); }, [exception.id, exception.current_account]);

  const step = run.steps.find(item => item.type === exception.step_type);
  const decided = exception.decision;
  const showForm = editable && (!decided || changing);
  const needsReason = true;
  const currentIssue = state?.period === run.comp && state.results.pendencias.find(item => item.id_saida === exception.id && item.motivo === exception.description && item.valor_brl === exception.impact_brl);
  const sameFiles = !!state && run.files.length >= 6 && run.files.every(file => state.sources.some(source => source.name === file.name && source.sha256 === file.sha256));
  const accounts = runAccounts?.filter(item => item.postable) || [];
  const entry = exception.associated_entries?.find(item => item.entry_id === entryId);
  const currentAccount = entry?.account_code || exception.current_account;
  const canAdjust = agent.mode === 'mock' || !!exception.associated_entries?.length;
  const invalid = !note.trim() || (action === 'adjust' && (!canAdjust || (agent.mode !== 'mock' && !entryId) || (!amount && (!account || account === currentAccount))));

  const submit = async () => {
    const result = await act('decide', () => agent.decide(run.id, exception.id, {
      action, note, ...(action === 'adjust' ? { amount: amount || undefined, account_code: account && account !== currentAccount ? account : undefined, entry_id: entryId || undefined } : {}),
    }), { success: `Decisão registrada: ${DECISION_LABEL[action].toLowerCase()}.`, invalidate: [keys.exceptions(run.id), keys.approval(run.id), keys.state, ['checklist'], ['insights'], keys.audit(run.id)] });
    if (result) { setChanging(false); onDecided?.(result, { action, note }); }
  };
  const canRepeat = preset && !(preset.action === 'adjust') && !(preset.action === 'accept' && exception.severity === 'bloqueante' && !preset.note);

  return (
    <div className="exception-detail stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <Badge tone={exception.severity === 'bloqueante' ? 'critical' : 'warning'} dot>{exception.severity === 'bloqueante' ? 'Bloqueante' : 'Alerta'}</Badge>
          <DecisionBadge exception={exception} />
          {step && <Link className="chip" to={`/runs/${run.id}?step=${step.id}&ref=${encodeURIComponent(exception.ref_origem)}`}><Icon name="columns" size={12} />{exception.step_title}</Link>}
          {onClose && <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Fechar detalhe"><Icon name="x" /></button>}
        </div>
        <h3 className="overlay-title">{readable(exception.kind)}</h3>
        <p className="text-2">{exception.description}</p>
      </div>
      {exception.suggestion && <Callout tone="info" icon="info"><strong>Sugestão do agente:</strong> {exception.suggestion}</Callout>}
      <dl className="facts">
        <div><dt>Lojista</dt><dd>{exception.merchant}</dd></div>
        {exception.cnpj && <div><dt>CNPJ</dt><dd className="mono">{cnpj(exception.cnpj)}</dd></div>}
        {exception.date && <div><dt>Data</dt><dd>{dateBR(exception.date)}</dd></div>}
        {exception.amount && <div><dt>Valor da operação</dt><dd><Money value={exception.amount} /></dd></div>}
        <div><dt>Impacto</dt><dd><Money value={exception.impact_brl} /></dd></div>
        <div><dt>Quem decide</dt><dd>{exception.who_decides || '—'}</dd></div>
        {exception.current_account && <div><dt>Conta atual</dt><dd className="mono">{exception.current_account}</dd></div>}
        <div><dt>Referência</dt><dd className="mono">{exception.ref_origem}</dd></div>
      </dl>
      {exception.rule && <p className="muted" style={{ fontSize: 12 }}>Regra: {exception.rule}</p>}

      {decided && !changing && (
        <div className="decision-card">
          <div className="row between wrap">
            <strong>{DECISION_LABEL[decided.action]} por {decided.actor}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{dateTimeBR(decided.at)}</span>
          </div>
          {(decided.account_code || decided.amount) && (
            <p className="text-2" style={{ fontSize: 12.5 }}>
              {decided.account_code && <>Conta {decided.before_account || exception.current_account || '—'} → <span className="mono">{decided.account_code}</span>. </>}
              {decided.amount && <>Valor {money(decided.before_amount || exception.impact_brl)} → {money(decided.amount)}.</>}
            </p>
          )}
          {decided.note && <p style={{ fontSize: 13 }}>“{decided.note}”</p>}
          {editable && <button className="btn xs ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setChanging(true)}><Icon name="edit" />Alterar decisão</button>}
        </div>
      )}

      {showForm && (
        <div className="decision-form">
          {preset && canRepeat && (preset.action !== action || preset.note !== note) && (
            <button type="button" className="btn xs ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setAction(preset.action); setNote(preset.note); }}>
              <Icon name="refresh" />Repetir última decisão: {DECISION_LABEL[preset.action].toLowerCase()}{preset.note ? ` · “${preset.note.slice(0, 40)}${preset.note.length > 40 ? '…' : ''}”` : ''}
            </button>
          )}
          <Segmented<ReviewAction> value={action} onChange={setAction} label="Decisão" options={ACTIONS} />
          {action === 'accept' && <p className="help">Segue como está, com justificativa registrada. Bloqueantes são aceitas uma a uma.</p>}
          {action === 'exclude' && <p className="help">A operação sai do lote exportado para o ERP e continua no relatório de exceções.</p>}
          {action === 'adjust' && (
            <div className="form-grid">
              {!canAdjust && <Callout tone="warning">Esta exceção não tem partida calculada para ajustar. Corrija a origem ou o cadastro e rode uma nova execução.</Callout>}
              {!!exception.associated_entries?.length && <Field label="Partida a ajustar" wide required>
                <select className="select" value={entryId} onChange={event => {
                  setEntryId(event.target.value);
                  setAccount(exception.associated_entries?.find(item => item.entry_id === event.target.value)?.account_code || '');
                }}>
                  <option value="">Selecione a partida vinculada</option>
                  {exception.associated_entries.map(item => <option key={item.entry_id} value={item.entry_id}>{item.event} · {money(item.amount)} · {item.entry_id}</option>)}
                </select>
              </Field>}
              {(entry?.account_code || exception.bank_line_id) && (
                <Field label="Conta Fênix (analíticas)" wide>
                  <select className="select" value={account} onChange={event => setAccount(event.target.value)}>
                    <option value="">Manter conta atual ({currentAccount || 'a consultar'})</option>
                    {accounts.map(item => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Valor ajustado (R$)" help={`Partida atual: ${money(entry?.amount)}. Mudança de taxa se faz em Cadastros.`}>
                <input className="input" type="number" step="0.01" min="0" disabled={!canAdjust} value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" />
              </Field>
            </div>
          )}
          <Field label={needsReason ? 'Justificativa' : 'Comentário (opcional)'} required={needsReason}>
            <ReasonInput value={note} onChange={setNote} required={needsReason}
              suggestions={action === 'exclude' ? ['Sem contrato vigente', 'Aguarda comercial', 'Duplicidade confirmada'] : ['Conferido na fonte original', 'Orientação do financeiro', 'Contestação enviada ao parceiro']} />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {changing && <button className="btn ghost" onClick={() => setChanging(false)}>Cancelar</button>}
            <button className={`btn ${action === 'exclude' ? 'dark' : 'primary'}`} disabled={!!busy || invalid} onClick={submit}>
              {busy ? <span className="spin" /> : <Icon name="check" />}Registrar: {ACTIONS.find(item => item.value === action)!.label.toLowerCase()}
            </button>
          </div>
        </div>
      )}
      {!editable && !decided && <Callout tone="gate" icon="lock">Decisões são registradas na aba Revisão enquanto o run aguarda aprovação.</Callout>}

      {currentIssue && sameFiles && (
        <Link className="btn sm" style={{ alignSelf: 'flex-start' }} to={`/comunicacoes?aba=gmail&pendencia=${encodeURIComponent(exception.id)}`}><Icon name="mail" />Preparar e-mail da pendência atual</Link>
      )}

      <div>
        <h4 className="section-title" style={{ fontSize: 13.5 }}><Icon name="origin" />Linhas de origem</h4>
        <p className="help">Evidências preservadas nesta execução. Consulte a prévia do passo para os dados e cálculos completos.</p>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Arquivo</th><th>Referência</th><th>Linha</th></tr></thead>
          <tbody>{exception.evidence.map((item, index) => <tr key={index}><td className="mono">{item.arquivo || '—'}</td><td className="mono">{item.ref}</td><td>{item.linha || '—'}</td></tr>)}</tbody>
        </table></div>
      </div>
    </div>
  );
}
