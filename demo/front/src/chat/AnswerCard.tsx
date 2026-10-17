// One question and its answer in the chat dock. The prose comes with the server's values in place of the
// model's markers (bold, with the query they came from); funnel, chart and table come from query results.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChatAnswer, ChatChart, ChatFunnel, ChatQuery, ChatTable, Seal } from '../api/chat';
import { HBarChart } from '../components/charts/Bars';
import { Icon } from '../components/Icon';
import { Callout } from '../components/ui';
import { count, duration, plural, timeBR } from '../lib/format';
import { workbench, useWorkbench } from '../workbench/store';
import { NUMERIC_STYLES, formatCell, sealLook, usd } from './answer';
import { DailyColumns } from './DailyColumns';
import { answerHighlight, type ChatItem } from './session';

function Prose({ answer }: { answer: ChatAnswer }) {
  if (answer.texto_oculto) return null;
  return (
    <p className="chat-prose">
      {answer.segmentos.map((segment, index) => segment.t === 'valor'
        ? <strong key={index} className="chat-value num" title={`Valor da consulta ${segment.ref?.split(':')[0]}`}>{segment.v}</strong>
        : <span key={index}>{segment.v}</span>)}
    </p>
  );
}

function Funnel({ funnel }: { funnel: ChatFunnel }) {
  const base = funnel.etapas[0]?.linhas || 1;
  return (
    <ol className="chat-funnel" aria-label="Funil da base até a resposta">
      {funnel.etapas.map((stage, index) => (
        <li key={index}>
          <span className="chat-funnel-label">{stage.rotulo}</span>
          <span className="chat-funnel-track"><span style={{ width: `${Math.max(1.5, (stage.linhas / base) * 100)}%` }} /></span>
          <strong className="num">{stage.linhas_fmt}</strong>
          {stage.valor_fmt && <span className="muted num">{stage.valor_fmt}</span>}
        </li>
      ))}
    </ol>
  );
}

function Chart({ chart }: { chart: ChatChart }) {
  if (chart.tipo === 'numero') {
    const item = chart.itens[0];
    return <div className="chat-big"><strong className="num">{item.formatado}</strong>{item.rotulo && <span className="muted">{item.rotulo}</span>}</div>;
  }
  if (chart.tipo === 'serie_diaria') return <DailyColumns items={chart.itens} ariaLabel={`Série diária de ${chart.valor}`} />;
  return (
    <HBarChart ariaLabel={`${chart.valor} por ${chart.rotulo}`} labelWidth={170}
      data={chart.itens.slice(0, 15).map((item, index) => ({ key: String(index), label: item.rotulo, value: Number(item.valor), display: item.formatado }))} />
  );
}

function Table({ table }: { table: ChatTable }) {
  const [all, setAll] = useState(false);
  const rows = all ? table.linhas : table.linhas.slice(0, 8);
  return (
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead><tr>{table.colunas.map(column => <th key={column.nome} className={NUMERIC_STYLES.has(column.estilo) ? 'num' : ''}>{column.nome.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((value, at) => <td key={at} className={NUMERIC_STYLES.has(table.colunas[at].estilo) ? 'num' : ''}>{formatCell(value, table.colunas[at].estilo)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {(table.linhas.length > 8 || table.truncado) && (
        <div className="chat-table-foot muted">
          {table.linhas.length > 8 && <button type="button" className="link" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Ver as ${count(table.linhas.length)} linhas`}</button>}
          {table.truncado && <span>A consulta tem {count(table.total_linhas)} linhas{table.total_linhas > table.linhas.length ? `; aqui aparecem ${count(table.linhas.length)}` : ''}.</span>}
        </div>
      )}
    </div>
  );
}

function SealRow({ seal }: { seal: Seal }) {
  const [open, setOpen] = useState(false);
  const look = sealLook(seal);
  return (
    <div className="chat-seal-wrap">
      <button type="button" className={`chip ${look.tone} chat-seal`} aria-expanded={open} onClick={() => setOpen(!open)} disabled={!seal.checks.length}>
        <Icon name={seal.status === 'ok' ? 'check' : seal.status === 'falhou' ? 'alert' : 'minus'} size={12} />{look.label}
        {seal.checks.length > 0 && <Icon name="chevronDown" size={12} />}
      </button>
      {open && (
        <ul className="chat-checks">
          {seal.checks.map((check, index) => (
            <li key={index} className={check.ok === false ? 'bad' : check.ok ? 'good' : ''}>
              <span aria-hidden>{check.ok === false ? '✗' : check.ok ? '✓' : '–'}</span>
              <span>
                {check.texto}
                {check.obtido && <> · resposta <strong className="num">{check.obtido}</strong></>}
                {check.esperado && <> · {check.tipo === 'partes' ? 'total' : 'recálculo'} <strong className="num">{check.esperado}</strong></>}
                {check.diferenca && <> · diferença <strong className="num">{check.diferenca}</strong></>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Queries({ queries }: { queries: ChatQuery[] }) {
  if (!queries.length) return null;
  return (
    <details className="chat-queries">
      <summary>{plural(queries.length, 'consulta', 'consultas')} SQL</summary>
      <ol>
        {queries.map(query => (
          <li key={query.id}>
            <div className="row between" style={{ gap: 8 }}>
              <span><strong className="mono">{query.id}</strong> {query.proposito}</span>
              <span className="muted num nowrap">{query.erro ? 'recusada' : `${plural(query.linhas, 'linha', 'linhas')} · ${query.ms} ms`}</span>
            </div>
            <pre className="mono">{query.sql}</pre>
            {query.erro && <p className="chat-query-error">{query.erro}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function RowsActions({ answer, dataset }: { answer: ChatAnswer; dataset: string }) {
  const wb = useWorkbench();
  const [, setParams] = useSearchParams();
  const highlight = answerHighlight(answer);
  if (!highlight || !answer.linhas) return null;
  const rows = answer.linhas;
  const shown = wb.highlights.some(item => item.id === highlight.id);
  const here = rows.dataset === dataset;
  const filtered = wb.chatFilter?.id === highlight.id;
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <button type="button" className="btn xs" aria-pressed={shown} onClick={() => (shown ? workbench.clearHighlight(highlight.id) : workbench.highlight(highlight))}>
        <Icon name="eye" />{shown ? 'Tirar destaque' : 'Destacar'} {plural(rows.total, 'linha', 'linhas')}
      </button>
      {here ? (
        <button type="button" className="btn xs ghost" disabled={filtered} onClick={() => workbench.filterTo(highlight)}><Icon name="filter" />{filtered ? 'Filtrado' : 'Filtrar só estas linhas'}</button>
      ) : (
        <button type="button" className="btn xs ghost" onClick={() => { workbench.highlight(highlight); setParams(current => { const next = new URLSearchParams(current); next.set('step', rows.step_id); next.set('dataset', rows.dataset); next.delete('volume'); return next; }, { replace: true }); }}>
          <Icon name="arrowRight" />Abrir no passo {rows.step_number}
        </button>
      )}
    </div>
  );
}

function Progress({ item, onCancel }: { item: ChatItem; onCancel: () => void }) {
  const stage = item.stages[item.stages.length - 1] || 'Enviando a pergunta';
  return (
    <div className="chat-progress" aria-live="polite">
      <div className="row" style={{ gap: 8 }}>
        <span className="spin" />
        <span className="grow">{stage}</span>
        <button type="button" className="btn xs ghost" onClick={onCancel}>Parar</button>
      </div>
      {item.queries.length > 0 && (
        <ul className="chat-live-queries">
          {item.queries.map(query => <li key={query.id} className={query.erro ? 'bad' : ''}><span className="mono">{query.id}</span> {query.proposito}
            <span className="muted num"> · {query.erro ? 'recusada, o modelo vai corrigir' : plural(query.linhas, 'linha', 'linhas')}</span></li>)}
        </ul>
      )}
      {item.funil && <Funnel funnel={item.funil} />}
    </div>
  );
}

export function AnswerCard({ item, dataset, onCancel, onRetry }: { item: ChatItem; dataset: string; onCancel: () => void; onRetry?: () => void }) {
  const answer = item.answer;
  return (
    <article className="chat-item">
      <header className="chat-question">
        <Icon name={item.modo === 'por_que' ? 'sparkline' : 'user'} size={13} className="muted" />
        <strong className="grow">{item.pergunta}</strong>
        <span className="muted nowrap">{item.autor ? `${item.autor} · ` : ''}{timeBR(item.at)}</span>
      </header>
      {item.status === 'running' && <Progress item={item} onCancel={onCancel} />}
      {item.status === 'erro' && (
        <Callout tone="critical" icon="alert">
          {item.error}{onRetry && <> <button type="button" className="link" onClick={onRetry}>Tentar de novo</button></>}
        </Callout>
      )}
      {answer && (
        <div className="chat-answer">
          {answer.avisos.map(text => <Callout key={text} tone="warning" icon="alert">{text}</Callout>)}
          <Prose answer={answer} />
          {answer.funil && <Funnel funnel={answer.funil} />}
          {answer.grafico && <Chart chart={answer.grafico} />}
          {answer.tabela && (!answer.grafico || answer.grafico.consulta !== answer.tabela.consulta || answer.tabela.linhas.length > 1) && <Table table={answer.tabela} />}
          <div className="chat-answer-foot">
            <SealRow seal={answer.selo} />
            <RowsActions answer={answer} dataset={dataset} />
            <span className="grow" />
            <span className="muted num nowrap" title={answer.usage.preco_estimado ? 'Preço do modelo de reserva estimado' : 'Custo estimado pelos tokens da resposta'}>
              {[usd(answer.usage.custo_usd), answer.ms ? duration(answer.ms) : ''].filter(Boolean).join(' · ')}
            </span>
          </div>
          <Queries queries={answer.consultas} />
        </div>
      )}
    </article>
  );
}
