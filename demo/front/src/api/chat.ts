// Query chat over a run (back: src/api/chat.py). The question streams back as server-sent events over a
// POST, so it is read with fetch, not EventSource. Every number in an answer was written by the server
// from a real query; the model only placed markers.
import { actorHeaders, getJSON, parseResponse } from './http';
import type { DataValue } from './agent';
import type { ChatContext } from '../workbench/contract';

export type ChatStyle = 'brl' | 'pct' | 'pp' | 'int' | 'num' | 'data' | 'texto' | 'bool';

export interface ChatSegment { t: 'texto' | 'valor'; v: string; ref?: string; bruto?: string | number | boolean | null }
export interface ChatQuery { id: string; proposito: string | null; sql: string | null; linhas: number; truncado: boolean; ms: number; erro: string | null; sha256: string | null }
export interface ChatTable {
  consulta: string;
  colunas: { nome: string; tipo: string; estilo: ChatStyle }[];
  linhas: DataValue[][];
  total_linhas: number;
  truncado: boolean;
}
export interface ChatChartItem { rotulo: string; data: string | null; valor: string; formatado: string }
export interface ChatChart { tipo: 'barras' | 'serie_diaria' | 'numero'; consulta: string; rotulo: string | null; valor: string; itens: ChatChartItem[] }
export interface ChatRows { dataset: string; rotulo: string; rids: number[]; total: number; truncado: boolean; step_id: string; step_number: number; step_title: string }
export interface SealCheck { tipo: 'recalculo' | 'total_controle' | 'partes'; ok: boolean | null; texto: string; esperado?: string; obtido?: string; diferenca?: string }
export interface Seal { status: 'ok' | 'falhou' | 'incompleto' | 'sem_verificacao'; checks: SealCheck[]; resumo: string; valor?: string }
export interface FunnelStage { rotulo: string; linhas: number; linhas_fmt: string; valor: string | null; valor_fmt: string | null }
export interface ChatFunnel { dataset: string; consulta: string; etapas: FunnelStage[]; coluna_valor: string | null }
export interface ChatUsage { input?: number; output?: number; cache_read?: number; cache_write?: number; custo_usd?: string; chamadas?: number; preco_estimado?: boolean }

export interface ChatAnswer {
  id: string;
  thread_id: string;
  pergunta: string;
  modo: 'pergunta' | 'por_que';
  autor: string;
  segmentos: ChatSegment[];
  texto_oculto: boolean;
  tabela: ChatTable | null;
  grafico: ChatChart | null;
  linhas: ChatRows | null;
  selo: Seal;
  avisos: string[];
  funil: ChatFunnel | null;
  consultas: ChatQuery[];
  usage: ChatUsage;
  modelo: string;
  ms: number;
}

export interface ChatTurnRecord {
  id: string; pergunta: string; modo: 'pergunta' | 'por_que'; autor: string; criado_em: string; status: 'ok' | 'erro';
  answer: ChatAnswer | null; erro: { code: string; message: string } | null; step_id: string | null; dataset: string | null;
}
export interface ChatThread { id: string; criado_em: string; autor: string; perguntas: ChatTurnRecord[] }

export interface ChatStatus {
  disponivel: boolean;
  motivo: string | null;
  como_configurar: string | null;
  modelo: string;
  sugestoes: { por_passo: Record<string, string[]>; por_coluna: Record<string, string[]> };
  conversas: ChatThread[];
}

export type ChatEvent =
  | { type: 'thread'; thread_id: string; message_id: string }
  | { type: 'stage'; texto: string }
  | ({ type: 'query' } & ChatQuery)
  | { type: 'funnel'; funil: ChatFunnel }
  | { type: 'answer'; answer: ChatAnswer }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; message_id: string };

export interface AskInput {
  pergunta: string;
  modo: 'pergunta' | 'por_que';
  thread_id: string | null;
  step_id: string;
  dataset: string;
  contexto: ScreenContext;
}
/** The screen state the backend accepts (run, step and dataset travel outside it). */
export type ScreenContext = Omit<ChatContext, 'run_id' | 'step_id' | 'dataset'>;

/** Incremental SSE reader: feed text chunks as they arrive; complete events go to `onEvent`. */
export function sseParser(onEvent: (event: ChatEvent) => void) {
  let buffer = '';
  const flush = (block: string) => {
    let type = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!type || !data.length) return;
    onEvent({ ...JSON.parse(data.join('\n')), type } as ChatEvent);
  };
  return {
    feed(chunk: string) {
      buffer += chunk.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        flush(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    end() { if (buffer.trim()) flush(buffer); buffer = ''; },
  };
}

const path = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/chat`;

export const chat = {
  status: (runId: string) => getJSON<ChatStatus>(path(runId)),

  /** Sends a question and streams its events. Errors before the stream (validation, no credential) throw. */
  async ask(runId: string, input: AskInput, onEvent: (event: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch(path(runId), {
      method: 'POST', signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...await actorHeaders() },
      body: JSON.stringify(input),
    });
    if (!response.ok || !response.body) { await parseResponse(response); throw new Error(`O chat não respondeu (${response.status}).`); }
    const parser = sseParser(onEvent);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.end();
  },
};
