import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat, sseParser, type ChatEvent } from './chat';

vi.mock('./http', async () => ({
  ...(await vi.importActual<typeof import('./http')>('./http')),
  actorHeaders: async () => ({ 'X-User': encodeURIComponent('Ana Análise'), 'X-User-Encoding': 'percent-utf8' }),
}));

afterEach(() => vi.unstubAllGlobals());

const sse = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

describe('Chat event stream', () => {
  it('reassembles events split across chunks and lines', () => {
    const events: ChatEvent[] = [];
    const parser = sseParser(event => events.push(event));
    const text = sse('stage', { texto: 'Lendo' }) + sse('query', { id: 'q1', linhas: 1 }).replace(/\n/g, '\r\n');
    for (let i = 0; i < text.length; i += 7) parser.feed(text.slice(i, i + 7));
    parser.end();
    expect(events).toEqual([{ type: 'stage', texto: 'Lendo' }, { type: 'query', id: 'q1', linhas: 1 }]);
  });

  it('ignores comments and keeps the event name as the type', () => {
    const events: ChatEvent[] = [];
    const parser = sseParser(event => events.push(event));
    parser.feed(': heartbeat\n\n' + sse('done', { message_id: 'msg-1', type: 'outro' }));
    expect(events).toEqual([{ type: 'done', message_id: 'msg-1' }]);
  });

  it('posts the question with the declared analyst and streams the answer', async () => {
    const body = sse('thread', { thread_id: 'conv-1', message_id: 'msg-1' }) + sse('done', { message_id: 'msg-1' });
    const fetchMock = vi.fn(async () => new Response(new Blob([body]).stream(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatEvent[] = [];
    await chat.ask('run-1', { pergunta: 'Quanto?', modo: 'pergunta', thread_id: null, step_id: 's4', dataset: 'mdr_conferido', contexto: {
      filters: [], sort: null, only_exceptions: false, chat_filter_rids: null, view_rids: null, selection: null, focus: {}, view: { total: 10, shown: 10 },
    } }, event => events.push(event));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/runs/run-1/chat');
    expect((init.headers as Record<string, string>)['X-User']).toBe(encodeURIComponent('Ana Análise'));
    expect(JSON.parse(init.body as string).dataset).toBe('mdr_conferido');
    expect(events.map(event => event.type)).toEqual(['thread', 'done']);
  });

  it('turns a refusal before the stream into an error with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'CHAT_UNAVAILABLE', message: 'Configure a credencial.' } }), { status: 503 })));
    await expect(chat.ask('run-1', {} as never, () => undefined)).rejects.toThrow('Configure a credencial.');
  });
});
