import { useState } from 'react';
import { core } from '../../api/core';
import { Modal } from '../../components/Overlay';
import { Callout, Field, ReasonInput } from '../../components/ui';
import { count, periodLong } from '../../lib/format';
import { keys } from '../../state/queries';
import { useAction } from '../../state/useAction';

/** Closing with open items requires explicit acceptance and a reason (backend rule). */
export function CloseMonthModal({ period, openIssues, onClose }: { period: string; openIssues: number; onClose: () => void }) {
  const [accept, setAccept] = useState(false);
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  const submit = async () => {
    const done = await run('close', () => core.close(accept, reason), {
      success: 'Mês encerrado e registrado na auditoria.', invalidate: [keys.state, ['checklist'], ['insights']],
    });
    if (done) onClose();
  };
  return (
    <Modal
      eyebrow="Encerrar mês"
      title={`Encerrar ${periodLong(period)}`}
      sub="O responsável e a justificativa ficam registrados."
      onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!!busy || !reason.trim() || (openIssues > 0 && !accept)} onClick={submit}>Confirmar encerramento</button>
      </>}
    >
      <div className="stack-lg">
        {openIssues > 0 ? (
          <>
            <Callout tone="warning" icon="alert"><strong>{count(openIssues)} pendências continuam abertas.</strong> Elas seguem visíveis no relatório como ressalvas.</Callout>
            <label className="check">
              <input type="checkbox" checked={accept} onChange={event => setAccept(event.target.checked)} />
              <span>Aceito encerrar o mês com {count(openIssues)} pendências abertas e assumo o encaminhamento descrito abaixo.</span>
            </label>
          </>
        ) : <Callout tone="good" icon="check">Nenhuma pendência aberta nesta competência.</Callout>}
        <Field label="Justificativa do encerramento" required>
          <ReasonInput value={reason} onChange={setReason} suggestions={['Pendências com responsável definido', 'Atlas aguarda contrato comercial', 'Revisão completa']} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReopenModal({ onClose }: { onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return (
    <Modal title="Reabrir mês" sub="O mês volta para revisão. O encerramento anterior fica no histórico." onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!!busy || !reason.trim()} onClick={async () => {
          if (await run('reopen', () => core.reopen(reason), { success: 'Fechamento reaberto para revisão.', invalidate: [keys.state] })) onClose();
        }}>Reabrir mês</button>
      </>}>
      <Field label="Motivo da reabertura" required><ReasonInput value={reason} onChange={setReason} suggestions={['Correção de taxa', 'Nova evidência do financeiro']} /></Field>
    </Modal>
  );
}
