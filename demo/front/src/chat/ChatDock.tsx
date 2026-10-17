// Query chat under the step's spreadsheet. Read-only: questions go to the server, which runs the SQL and
// writes every number. The grid hands over context (selection, filters, "Por quê?" on a cell) and the
// answer points back at rows of the grid.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agent, type Run, type StepRun, type StepTable } from '../api/agent';
import { chat, type ScreenContext } from '../api/chat';
import { Icon } from '../components/Icon';
import { count } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/storage';
import type { CellRef } from '../workbench/contract';
import { workbench, useWorkbench } from '../workbench/store';
import { AnswerCard } from './AnswerCard';
import { selectionKey, selectionLabel, suggestionsFor } from './answer';
import { chatSession, useChatSession } from './session';

const OPEN_KEY = 'tarvo-chat-open';

export function ChatDock({ run, step, table, synthetic }: { run: Run; step: StepRun; table: StepTable; synthetic: boolean }) {
  const http = agent.mode === 'http';
  const { data: status, isLoading, error } = useQuery({ queryKey: ['chat', run.id], queryFn: () => chat.status(run.id), enabled: http, staleTime: 60_000 });
  const session = useChatSession();
  const wb = useWorkbench();
  const [open, setOpenState] = useState(() => loadJSON(OPEN_KEY, true));
  const [draft, setDraft] = useState('');
  const [detached, setDetached] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const setOpen = (value: boolean) => { setOpenState(value); saveJSON(OPEN_KEY, value); };

  useEffect(() => { chatSession.forRun(run.id); }, [run.id]);
  useEffect(() => { if (status) chatSession.restore(run.id, status.conversas); }, [status, run.id]);

  const items = session.runId === run.id ? session.items : [];
  const running = items.some(item => item.status === 'running');
  const available = http && !!status?.disponivel;
  const labels = useMemo(() => new Map(table.columns.map(column => [column.name, column.label])), [table]);
  const selection = !synthetic && wb.selection && wb.selection.dataset === table.dataset && wb.selection.stats.cells > 1 ? wb.selection : null;
  const attached = selection && detached !== selectionKey(selection) ? selection : null;
  const narrowed = !synthetic && wb.dataset === table.dataset && wb.viewRids ? wb.viewRids.length : null;
  const suggestions = suggestionsFor(status, step.type, wb.focus.column);

  const last = items[items.length - 1];
  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [items.length, last?.status, last?.stages.length, last?.queries.length, open]);

  const send = (question: string, modo: 'pergunta' | 'por_que' = 'pergunta', cell?: CellRef) => {
    const text = question.trim();
    if (!text || running || !available) return;
    const context = workbench.chatContext();
    const contexto: ScreenContext = {
      filters: context.filters, sort: context.sort, only_exceptions: context.only_exceptions,
      chat_filter_rids: synthetic ? null : context.chat_filter_rids, view_rids: narrowed !== null ? context.view_rids : null,
      selection: modo === 'pergunta' ? attached : null, focus: { column: context.focus.column, ...(cell ? { cell } : {}) }, view: context.view,
    };
    setOpen(true);
    setDraft('');
    void chatSession.send({ pergunta: text, modo, step_id: step.id, dataset: table.dataset, contexto });
  };

  // Questions raised from the grid: "Por quê?" goes straight away; "Perguntar sobre a seleção" attaches it.
  useEffect(() => {
    if (!wb.pendingAsk) return;
    const ask = workbench.takeAsk();
    if (!ask) return;
    setOpen(true);
    if (ask.mode === 'por_que' && ask.question && available && !running) send(ask.question, 'por_que', ask.cell);
    else {
      if (ask.question) setDraft(ask.question);
      setDetached(null);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [wb.pendingAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  const unavailable = !http ? 'No modo demonstração o chat de consulta não roda: ele precisa do servidor local.'
    : error ? `Não foi possível consultar o chat: ${error.message}`
      : status && !status.disponivel ? status.como_configurar || status.motivo : null;

  return (
    <section className={`chat-dock ${open && items.length ? 'open' : ''}`} aria-label="Chat de consulta">
      {open && items.length > 0 && (
        <div className="chat-thread" ref={thread}>
          {items.map(item => (
            <AnswerCard key={item.key} item={item} dataset={table.dataset} onCancel={chatSession.cancel}
              onRetry={item.status === 'erro' && item.input && !running && available ? () => send(item.pergunta, item.modo, item.input?.contexto.focus?.cell) : undefined} />
          ))}
        </div>
      )}
      <div className="chat-bar">
        {unavailable ? (
          <div className="chat-off"><Icon name="lock" className="muted" /><p><strong>Chat indisponível.</strong> {unavailable}</p></div>
        ) : (
          <>
            {(attached || selection || narrowed !== null || (!draft && !running && suggestions.length > 0)) && (
              <div className="row wrap chat-context">
                {attached && (
                  <span className="chip info"><Icon name="columns" size={12} />Seleção: {selectionLabel(attached, labels)}
                    <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label="Não usar a seleção na pergunta" onClick={() => setDetached(selectionKey(attached))}><Icon name="x" size={12} /></button></span>
                )}
                {selection && !attached && <button type="button" className="chip" onClick={() => setDetached(null)}><Icon name="plus" size={12} />Usar a seleção</button>}
                {narrowed !== null && <span className="chip"><Icon name="filter" size={12} />Visão filtrada: {count(narrowed)} de {count(table.rows.length)} linhas</span>}
                {!draft && !running && suggestions.map(text => (
                  <button key={text} type="button" className="chip chat-suggestion" disabled={!available} onClick={() => send(text)}>{text}</button>
                ))}
              </div>
            )}
            <form className="chat-input" onSubmit={event => { event.preventDefault(); send(draft); }}>
              <Icon name="sparkline" className="muted" />
              <textarea ref={input} rows={1} value={draft} disabled={!available} aria-label="Pergunta sobre os dados"
                placeholder={isLoading ? 'Preparando o chat…' : attached ? 'Pergunte sobre a seleção…' : 'Pergunte sobre os dados deste passo…'}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} />
              {running
                ? <button type="button" className="btn sm" onClick={chatSession.cancel}>Parar</button>
                : <button type="submit" className="btn sm primary" disabled={!draft.trim() || !available}>Perguntar</button>}
            </form>
          </>
        )}
        <div className="chat-meta">
          <span className="muted">Somente leitura · cada número da resposta vem de uma consulta conferida pelo servidor</span>
          <span className="row" style={{ gap: 4 }}>
            {items.length > 0 && <button type="button" className="btn xs ghost" disabled={running} onClick={() => chatSession.reset()}><Icon name="plus" />Nova conversa</button>}
            {items.length > 0 && <button type="button" className="btn xs ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
              <Icon name="chevronDown" />{open ? 'Recolher' : `Mostrar conversa (${items.length})`}</button>}
          </span>
        </div>
      </div>
    </section>
  );
}
