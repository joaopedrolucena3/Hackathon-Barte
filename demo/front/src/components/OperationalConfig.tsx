import { useState } from 'react';
import { core } from '../api/core';
import { periodShort } from '../lib/format';
import { useOperationalConfig, keys } from '../state/queries';
import { useAction } from '../state/useAction';
import { Modal } from './Overlay';
import { Callout, Field, Loading, ReasonInput } from './ui';

export function OperationalConfigModal({ comp, onClose }: { comp: string; onClose: () => void }) {
  const { data: config, error } = useOperationalConfig(comp);
  const [deadline, setDeadline] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const { run, busy } = useAction();
  return <Modal title={`Prazo de ${periodShort(comp)}`} sub="Configuração operacional da competência. Execuções anteriores preservam o prazo capturado no snapshot." onClose={onClose}
    footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!!busy || !config || !reason.trim()} onClick={async () => {
      if (await run('config', () => core.saveOperationalConfig(comp, { closing_deadline: (deadline ?? config?.closing_deadline) || null, reason }), { success: 'Prazo da competência salvo.', invalidate: [keys.config(comp), keys.state, keys.comps] })) onClose();
    }}>Salvar prazo</button></>}>
    {error ? <Callout tone="critical" icon="alert">{error.message}</Callout> : !config ? <Loading /> : <div className="stack-lg"><Field label="Prazo do fechamento" help="Deixe vazio quando ainda não houver prazo definido."><input className="input" type="date" value={deadline ?? config.closing_deadline ?? ''} onChange={event => setDeadline(event.target.value)} /></Field><Field label="Justificativa" required><ReasonInput value={reason} onChange={setReason} /></Field><Callout tone="info" icon="info">Essa configuração não desloca vigências, provisões, impostos ou datas das operações financeiras.</Callout></div>}
  </Modal>;
}
