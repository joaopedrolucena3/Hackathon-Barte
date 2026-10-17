// Placeholder for the query chat dock (phase 2): shows what the grid already hands to the chat.
import { Icon } from '../components/Icon';
import { plural } from '../lib/format';
import { useWorkbench } from './store';

export function ChatSlot() {
  const { pendingAsk, selection } = useWorkbench();
  return (
    <div className="wb-chat">
      <Icon name="sparkline" className="muted" />
      <p className="grow muted">
        {pendingAsk ? <>Pergunta pronta para o chat: <strong className="text-2">{pendingAsk.question || `sobre a seleção (${plural(pendingAsk.selection?.stats.cells || 0, 'célula', 'células')})`}</strong></>
          : selection ? `Seleção pronta para perguntar: ${plural(selection.stats.cells, 'célula', 'células')} em ${plural(selection.columns.length, 'coluna', 'colunas')}.`
            : 'O chat de consulta ficará aqui, sobre os dados deste passo.'}
      </p>
    </div>
  );
}
