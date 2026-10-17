// Conversation state of the chat dock, outside React (same external-store pattern as workbench/store.ts):
// the dock unmounts while a step's table loads, and a question in flight must keep its answer.
import { useSyncExternalStore } from 'react';
import { chat, type AskInput, type ChatAnswer, type ChatFunnel, type ChatQuery, type ChatThread, type ChatTurnRecord } from '../api/chat';
import { getActor } from '../lib/actor';
import type { Highlight } from '../workbench/contract';
import { workbench } from '../workbench/store';

export interface ChatItem {
  key: string;
  id?: string;
  pergunta: string;
  modo: 'pergunta' | 'por_que';
  autor: string;
  at: string;
  status: 'running' | 'ok' | 'erro';
  stages: string[];
  queries: ChatQuery[];
  funil: ChatFunnel | null;
  answer: ChatAnswer | null;
  error: string | null;
  input?: AskInput;
}

interface SessionState { runId: string; threadId: string | null; items: ChatItem[]; restored: boolean }

let state: SessionState = { runId: '', threadId: null, items: [], restored: false };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let sequence = 0;

function set(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}

function update(key: string, change: (item: ChatItem) => ChatItem) {
  set({ items: state.items.map(item => (item.key === key ? change(item) : item)) });
}

export function fromRecord(turn: ChatTurnRecord): ChatItem {
  return {
    key: turn.id, id: turn.id, pergunta: turn.pergunta, modo: turn.modo || 'pergunta', autor: turn.autor, at: turn.criado_em,
    status: turn.status === 'ok' && turn.answer ? 'ok' : 'erro', stages: [], queries: turn.answer?.consultas || [], funil: turn.answer?.funil || null,
    answer: turn.answer, error: turn.erro?.message || (turn.answer ? null : 'Esta pergunta não teve resposta.'),
  };
}

/** Rows an answer points at, as a grid highlight (one answer highlighted at a time). */
export function answerHighlight(answer: ChatAnswer): Highlight | null {
  const rows = answer.linhas;
  if (!rows || !rows.rids.length) return null;
  return { id: `chat-${answer.id}`, answerId: answer.id, dataset: rows.dataset, rids: rows.rids, tone: 'info', label: rows.rotulo };
}

export function showAnswer(answer: ChatAnswer) {
  for (const item of workbench.get().highlights) if (item.answerId && item.answerId !== answer.id) workbench.clearHighlight(item.id);
  const highlight = answerHighlight(answer);
  if (highlight) workbench.highlight(highlight);
}

export const chatSession = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

  /** A different run starts empty; the dock then restores that run's latest conversation once. */
  forRun(runId: string) {
    if (state.runId === runId) return;
    controller?.abort();
    set({ runId, threadId: null, items: [], restored: false });
  },
  restore(runId: string, threads: ChatThread[]) {
    if (state.runId !== runId || state.restored) return;
    const last = threads[0];
    set(last && !state.items.length ? { restored: true, threadId: last.id, items: last.perguntas.map(fromRecord) } : { restored: true });
  },
  /** New conversation: the next question starts a thread without the previous history. */
  reset() {
    controller?.abort();
    set({ threadId: null, items: [] });
  },
  cancel() { controller?.abort(); },
  running: () => state.items.some(item => item.status === 'running'),

  async send(input: Omit<AskInput, 'thread_id'>) {
    if (chatSession.running()) return;
    const runId = state.runId;
    const full: AskInput = { ...input, thread_id: state.threadId };
    const key = `local-${++sequence}`;
    set({ items: [...state.items, { key, pergunta: input.pergunta, modo: input.modo, autor: getActor(), at: new Date().toISOString(), status: 'running',
      stages: [], queries: [], funil: null, answer: null, error: null, input: full }] });
    controller = new AbortController();
    const mine = controller;
    try {
      await chat.ask(runId, full, event => {
        if (state.runId !== runId) return;
        switch (event.type) {
          case 'thread': set({ threadId: event.thread_id }); update(key, item => ({ ...item, id: event.message_id })); break;
          case 'stage': update(key, item => ({ ...item, stages: [...item.stages, event.texto] })); break;
          case 'query': { const { type: _type, ...query } = event; update(key, item => ({ ...item, queries: [...item.queries, query] })); break; }
          case 'funnel': update(key, item => ({ ...item, funil: event.funil })); break;
          case 'answer': update(key, item => ({ ...item, status: 'ok', answer: event.answer })); showAnswer(event.answer); break;
          case 'error': update(key, item => ({ ...item, status: 'erro', error: event.message })); break;
        }
      }, mine.signal);
      update(key, item => (item.status === 'running' ? { ...item, status: 'erro', error: 'A resposta foi interrompida antes do fim.' } : item));
    } catch (error) {
      const message = mine.signal.aborted ? 'Pergunta cancelada.' : error instanceof Error ? error.message : 'O chat não respondeu.';
      update(key, item => ({ ...item, status: 'erro', error: message }));
      // A conversation that no longer exists (other database) starts over on the next question.
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) set({ threadId: null });
    } finally {
      if (controller === mine) controller = null;
    }
  },
};

export function useChatSession(): SessionState {
  return useSyncExternalStore(chatSession.subscribe, chatSession.get);
}
