// B5: one exception with its origin and the reviewer's decision (accept, adjust, exclude from the batch).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { agent, type ReviewAction, type ReviewException, type Run } from '../api/agent';
import { cnpj, dateBR, dateTimeBR, money, periodShort, readable } from '../lib/format';
import { isRegistrationGroup, operationCountLabel, reviewActions, reviewDecisionLabel } from '../lib/reviewScope';
import { keys, useRunAccounts } from '../state/queries';
import { useAction } from '../state/useAction';
import { Icon } from './Icon';
import { Badge, Callout, Field, Money, ReasonInput, Segmented } from './ui';
import { ExceptionExposure } from './ExceptionExposure';

export const DECISION_LABEL: Record<string, string> = { accept: 'Aceita', adjust: 'Ajustada', exclude: 'Excluída do lote' };

export function DecisionBadge({ exception }: { exception: ReviewException }) {
  const d = exception.decision;
  if (!d) return <Badge tone={exception.severity === 'bloqueante' ? 'critical' : 'warning'} dot>Aberta</Badge>;
  return <Badge tone={d.action === 'exclude' ? 'neutral' : d.action === 'adjust' ? 'info' : isRegistrationGroup(exception) ? 'warning' : 'good'} dot>{reviewDecisionLabel(exception, d.action)}</Badge>;
}

export function ExceptionDetail({ exception, run, editable, onClose, onDecided }: {
  exception: ReviewException; run: Run; editable: boolean; onClose?: () => void;
  /** Review flow: called after a decision so the list can move to the next open item. */
  onDecided?: (exception: ReviewException) => void;
}) {
  const { data: runAccounts } = useRunAccounts(run.id);
  const [action, setAction] = useState<ReviewAction | ''>('');
  const [note, setNote] = useState('');
  const [account, setAccount] = useState(exception.current_account || '');
  const [amount, setAmount] = useState('');
  const [entryId, setEntryId] = useState('');
  const [changing, setChanging] = useState(false);
  const { run: act, busy } = useAction();
  useEffect(() => { setAction(''); setNote(''); setAmount(''); setEntryId(exception.associated_entries?.length === 1 ? exception.associated_entries[0].entry_id : ''); setAccount(exception.current_account || ''); setChanging(false); }, [exception.id, exception.current_account]);

  const step = run.steps.find(item => item.type === exception.step_type);
  const decided = exception.decision;
  const grouped = isRegistrationGroup(exception);
  const actions = reviewActions(exception);
  const showForm = editable && (!decided || changing);
  const needsReason = true;
  const accounts = runAccounts?.filter(item => item.postable) || [];
  const entry = exception.associated_entries?.find(item => item.entry_id === entryId);
  const currentAccount = entry?.account_code || exception.current_account;
  const canAdjust = !grouped && !!exception.associated_entries?.length;
  const incompleteScope = grouped && (!exception.period || !exception.cnpj || !exception.operation_count || exception.affected_operations?.length !== exception.operation_count);
  const invalid = incompleteScope || !action || !note.trim() || (action === 'adjust' && (!canAdjust || (agent.mode !== 'mock' && !entryId) || (!amount && (!account || account === currentAccount))));

  const submit = async () => {
    if (!action || invalid) return;
    const result = await act('decide', () => agent.decide(run.id, exception.id, {
      action, note, ...(action === 'adjust' ? { amount: amount || undefined, account_code: account && account !== currentAccount ? account : undefined, entry_id: entryId || undefined } : {}),
    }), { success: `Decisão registrada: ${reviewDecisionLabel(exception, action).toLowerCase()}.`, invalidate: [keys.exceptions(run.id), keys.approval(run.id), keys.recommendations(run.id), keys.state, ['checklist'], ['insights'], keys.audit(run.id)] });
    if (result) { setChanging(false); onDecided?.(result); }
  };

  return (
    <div className="exception-detail stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <Badge tone={exception.severity === 'bloqueante' ? 'critical' : 'warning'} dot>{exception.severity === 'bloqueante' ? 'Bloqueante' : 'Alerta'}</Badge>
          <DecisionBadge exception={exception} />
          {grouped && <Badge tone="info">Por empresa e competência</Badge>}
          {step && <Link className="chip" to={`/runs/${run.id}?step=${step.id}${grouped ? '' : `&ref=${encodeURIComponent(exception.ref_origem)}`}`}><Icon name="columns" size={12} />{exception.step_title}</Link>}
          {onClose && <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Fechar detalhe"><Icon name="x" /></button>}
        </div>
        <h3 className="overlay-title">{readable(exception.kind)}</h3>
        <p className="text-2">{exception.description}</p>
      </div>
      {exception.suggestion && <Callout tone="info" icon="info"><strong>Sugestão do agente:</strong> {exception.suggestion}</Callout>}
      {grouped && <Callout tone="warning" icon="lock">
        <strong>Cadastro pendente; faturamento continua bloqueado.</strong> A decisão abrange somente as {operationCountLabel(exception)} listadas nesta execução e nesta competência. Outras pendências e operações futuras exigem revisão própria. Regularize o cadastro e o contrato vigente em <Link className="link" to={`/cadastros?lojista=${encodeURIComponent(exception.cnpj || '')}`}>Cadastros</Link> e rode uma nova execução para conferir a liberação.
      </Callout>}
      <Link className="btn sm" style={{ alignSelf: 'flex-start' }} to={`/runs/${run.id}/hipoteses?ex=${encodeURIComponent(exception.id)}`}><Icon name="origin" />Ver justificativa, hipóteses e efeito no lote</Link>
      <dl className="facts">
        <div><dt>Lojista</dt><dd>{exception.merchant}</dd></div>
        {exception.cnpj && <div><dt>CNPJ</dt><dd className="mono">{cnpj(exception.cnpj)}</dd></div>}
        {grouped && <div><dt>Competência</dt><dd>{periodShort(exception.period)}</dd></div>}
        {grouped && <div><dt>Operações afetadas</dt><dd>{operationCountLabel(exception)}</dd></div>}
        {!grouped && exception.date && <div><dt>Data</dt><dd>{dateBR(exception.date)}</dd></div>}
        {!grouped && exception.amount && <div><dt>Valor da operação</dt><dd><Money value={exception.amount} /></dd></div>}
        <div><dt>{grouped ? 'Valor relacionado ao grupo' : 'Valor relacionado'}</dt><dd><ExceptionExposure exception={exception} /></dd></div>
        <div><dt>Quem decide</dt><dd>{exception.who_decides || '—'}</dd></div>
        {exception.current_account && <div><dt>Conta atual</dt><dd className="mono">{exception.current_account}</dd></div>}
        <div><dt>{grouped ? 'Identificador do grupo' : 'Referência'}</dt><dd className="mono">{grouped ? exception.id : exception.ref_origem}</dd></div>
      </dl>
      <p className="help">{grouped ? 'O valor relacionado soma taxas informadas e spreads disponíveis nas fontes; não representa receita aprovada nem autorização para faturar. Valores ausentes não são tratados como zero.' : 'O valor relacionado não representa, por si só, a mudança causada pela decisão no lote.'}</p>
      {exception.rule && <p className="muted" style={{ fontSize: 12 }}>Regra: {exception.rule}</p>}

      {decided && !changing && (
        <div className="decision-card">
          <div className="row between wrap">
            <strong>{reviewDecisionLabel(exception, decided.action)} por {decided.actor}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{dateTimeBR(decided.at)}</span>
          </div>
          {(decided.account_code || decided.amount) && (
            <p className="text-2" style={{ fontSize: 12.5 }}>
              {decided.account_code && <>Conta {decided.before_account || exception.current_account || '—'} → <span className="mono">{decided.account_code}</span>. </>}
              {decided.amount && <>Valor {money(decided.before_amount || exception.impact_brl)} → {money(decided.amount)}.</>}
            </p>
          )}
          {decided.note && <p style={{ fontSize: 13 }}>“{decided.note}”</p>}
          {decided.group_scope === 'merchant_period' && <p className="help">Escopo registrado: {operationCountLabel(decided)} · {periodShort(decided.period)} · CNPJ {cnpj(decided.cnpj)}. Faturamento não autorizado por esta decisão.</p>}
          {editable && <button className="btn xs ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setChanging(true)}><Icon name="edit" />Alterar decisão</button>}
        </div>
      )}

      {showForm && (
        <div className="decision-form">
          {incompleteScope && <Callout tone="warning">Os dados de abrangência do grupo estão incompletos. Atualize a revisão para conferir todas as operações antes de registrar a decisão.</Callout>}
          <Segmented<ReviewAction | ''> value={action} onChange={setAction} label="Decisão" options={actions} />
          {!action && <p className="help">Escolha a ação após conferir as evidências desta ocorrência.</p>}
          {action === 'accept' && <p className="help">{grouped ? 'Registra uma ressalva para todas as operações listadas e mantém o grupo sem faturamento. O cadastro continua pendente; registre a evidência, o responsável e o próximo passo.' : 'Mantém o cálculo e a inclusão ou exclusão já definidos nesta execução. Encaminhamentos externos continuam pendentes; registre o que foi conferido e o que falta.'}</p>}
          {action === 'exclude' && <p className="help">{grouped ? 'Exclui do lote somente as operações vinculadas a esta pendência de cadastro nesta execução. A decisão e todas as origens permanecem no relatório; as outras exceções da empresa continuam independentes.' : 'A operação sai do lote exportado para o ERP e continua no relatório de exceções.'}</p>}
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
              placeholder="Informe a evidência conferida, a regra aplicada, o efeito esperado e eventuais próximos passos."
              suggestions={[]} />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {changing && <button className="btn ghost" onClick={() => setChanging(false)}>Cancelar</button>}
            <button className={`btn ${action === 'exclude' ? 'dark' : 'primary'}`} disabled={!!busy || invalid} onClick={submit}>
              {busy ? <span className="spin" /> : <Icon name="check" />}{action ? `Registrar: ${actions.find(item => item.value === action)?.label.toLowerCase() || action}` : 'Selecione uma decisão'}
            </button>
          </div>
        </div>
      )}
      {!editable && !decided && <Callout tone="gate" icon="lock">Decisões são registradas na aba Revisão enquanto a execução aguarda aprovação.</Callout>}

      <Link className="btn sm" style={{ alignSelf: 'flex-start' }} to={`/comunicacoes?aba=gmail&run_id=${encodeURIComponent(run.id)}&pendencia=${encodeURIComponent(exception.id)}`}><Icon name="mail" />Revisar sugestões desta execução</Link>

      {grouped && <div>
        <h4 className="section-title" style={{ fontSize: 13.5 }}><Icon name="columns" />Operações afetadas</h4>
        <p className="help">Confira cada operação antes de decidir o grupo. A referência e a linha identificam a origem, inclusive quando houver referências repetidas.</p>
        {exception.affected_operations?.length ? <div className="table-wrap" style={{ maxHeight: 360 }}><table className="table">
          <thead><tr><th>Referência / ID</th><th>Data</th><th>Negócio</th><th className="r">Valor relacionado</th><th>Origem</th></tr></thead>
          <tbody>{exception.affected_operations.map((item, index) => <tr key={`${item.id}-${index}`}>
            <td className="mono wrap">{item.ref || '—'}<span className="muted" style={{ display: 'block', fontSize: 11 }}>{item.id}</span></td>
            <td className="nowrap">{dateBR(item.date)}</td><td>{item.business === 'REMESSA' ? 'Remessa' : item.business === 'CHECKOUT' ? 'Checkout' : item.business || '—'}</td>
            <td className="r">{item.exposure_brl === null ? 'Não calculado' : <Money value={item.exposure_brl} />}<span className="muted" style={{ display: 'block', fontSize: 11 }}>{item.exposure_basis === 'reported_fee' ? 'Taxa informada' : item.exposure_basis === 'spread_brl' ? 'Spread' : ''}</span></td>
            <td className="mono wrap">{item.arquivo || '—'} · linha {item.linha || '—'}</td>
          </tr>)}</tbody>
        </table></div> : <Callout tone="warning">A lista de operações deste grupo não está disponível. Consulte as linhas de origem antes de decidir.</Callout>}
      </div>}

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
