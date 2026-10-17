import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskInput, ChatAnswer, ChatEvent } from '../api/chat';
import { workbench } from '../workbench/store';
import { chatSession } from './session';

const ask = vi.fn();
vi.mock('../api/chat', () => ({ chat: { ask: (...args: unknown[]) => ask(...args) } }));

const answer = (id: string, rids = [3, 5]): ChatAnswer => ({
  id, thread_id: 'conv-1', pergunta: 'Quanto?', modo: 'pergunta', autor: 'Ana', segmentos: [{ t: 'valor', v: 'R$ 1,00', ref: 'q1.total:brl', bruto: '1.00' }],
  texto_oculto: false, tabela: null, grafico: null, funil: null, avisos: [], consultas: [], usage: {}, modelo: 'claude-opus-5-5', ms: 10,
  linhas: { dataset: 'mdr_conferido', rotulo: 'Linhas ELO', rids, total: rids.length, truncado: false, step_id: 's4', step_number: 4, step_title: 'Conferir MDR' },
  selo: { status: 'ok', checks: [], resumo: 'Conferido' },
});
const input = (pergunta = 'Quanto?'): Omit<AskInput, 'thread_id'> => ({
  pergunta, modo: 'pergunta', step_id: 's4', dataset: 'mdr_conferido',
  contexto: { filters: [], sort: null, only_exceptions: false, chat_filter_rids: null, view_rids: null, selection: null, focus: {}, view: { total: 9, shown: 9 } },
});
const script = (...events: ChatEvent[]) => ask.mockImplementationOnce(async (_run: string, _input: AskInput, onEvent: (event: ChatEvent) => void) => events.forEach(onEvent));

describe('Chat session', () => {
  beforeEach(() => {
    ask.mockReset();
    chatSession.forRun('outro');
    chatSession.forRun('run-1');
    workbench.open('run-1', 's4', 'mdr_conferido');
    for (const item of workbench.get().highlights) workbench.clearHighlight(item.id);
  });

  it('follows the stream, keeps the thread and points the grid at the cited rows', async () => {
    script({ type: 'thread', thread_id: 'conv-1', message_id: 'msg-1' }, { type: 'stage', texto: 'Somando' },
      { type: 'query', id: 'q1', proposito: 'Total', sql: 'SELECT 1', linhas: 1, truncado: false, ms: 2, erro: null, sha256: null },
      { type: 'answer', answer: answer('msg-1') }, { type: 'done', message_id: 'msg-1' });
    await chatSession.send(input());
    const [item] = chatSession.get().items;
    expect([item.status, item.id, item.stages, item.queries.map(query => query.id)]).toEqual(['ok', 'msg-1', ['Somando'], ['q1']]);
    expect(chatSession.get().threadId).toBe('conv-1');
    expect(workbench.get().highlights).toEqual([{ id: 'chat-msg-1', answerId: 'msg-1', dataset: 'mdr_conferido', rids: [3, 5], tone: 'info', label: 'Linhas ELO' }]);

    script({ type: 'answer', answer: answer('msg-2', [7]) });
    await chatSession.send(input('E a VISA?'));
    expect(ask.mock.calls[1][1].thread_id).toBe('conv-1');
    expect(workbench.get().highlights.map(item => item.id)).toEqual(['chat-msg-2']);
  });

  it('records stream errors, refusals before the stream and cancelled questions', async () => {
    script({ type: 'error', code: 'CHAT_REFUSED', message: 'O modelo recusou.' });
    await chatSession.send(input());
    ask.mockRejectedValueOnce(new Error('Configure a credencial.'));
    await chatSession.send(input());
    ask.mockImplementationOnce(async () => undefined);
    await chatSession.send(input());
    expect(chatSession.get().items.map(item => item.error)).toEqual(['O modelo recusou.', 'Configure a credencial.', 'A resposta foi interrompida antes do fim.']);
    expect(chatSession.running()).toBe(false);
  });

  it('restores the latest conversation once and starts over on reset', () => {
    chatSession.restore('run-1', [{ id: 'conv-9', criado_em: '', autor: 'Ana', perguntas: [
      { id: 'msg-9', pergunta: 'Antes', modo: 'pergunta', autor: 'Ana', criado_em: '2026-10-17T12:00:00+00:00', status: 'ok', answer: answer('msg-9'), erro: null, step_id: 's4', dataset: 'mdr_conferido' },
    ] }]);
    expect([chatSession.get().threadId, chatSession.get().items[0].pergunta]).toEqual(['conv-9', 'Antes']);
    chatSession.restore('run-1', []);
    expect(chatSession.get().items).toHaveLength(1);
    chatSession.reset();
    expect([chatSession.get().threadId, chatSession.get().items]).toEqual([null, []]);
  });
});
