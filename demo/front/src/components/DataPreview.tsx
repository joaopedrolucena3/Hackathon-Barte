// C8: paginated output of a step, formatted by its schema. New columns show what the agent did;
// rows with exceptions carry a margin marker; totals of money columns come from the backend.
import { useEffect, useState } from 'react';
import type { CellValue, ColumnFilter, ColumnSchema, ParamValue, PreviewPage, PreviewQuery, PreviewRow } from '../api/agent';
import { cnpj, count, dateBR, decimal, percent, pp } from '../lib/format';
import { usePreview } from '../state/queries';
import { Icon } from './Icon';
import { Badge, Callout, Empty, HashChip, Loading, Money, Toggle } from './ui';

const OPS: Record<ColumnFilter['op'], string> = { contains: 'contém', eq: 'igual a', gt: 'maior que', lt: 'menor que' };
const NUMERIC = new Set(['money', 'percent', 'pp', 'number']);

export function formatCell(column: ColumnSchema, raw: CellValue | undefined) {
  if (raw === null || raw === undefined || raw === '') return <span className="muted">—</span>;
  switch (column.type) {
    case 'money': return <Money value={raw as string} />;
    case 'percent': return percent(raw as string);
    case 'pp': return pp(raw as string);
    case 'date': return dateBR(String(raw));
    case 'number': return typeof raw === 'number' ? count(raw) : decimal(raw as string, 0, 6);
    case 'hash': return <HashChip hash={String(raw)} />;
    case 'code': return <span className="mono">{column.key.includes('cnpj') && /^\d{14}$/.test(String(raw)) ? cnpj(String(raw)) : String(raw)}</span>;
    case 'status': return <Badge tone={raw === 'HUMANO' ? 'info' : raw === 'IA' ? 'warning' : 'good'}>{raw === 'HUMANO' ? 'Humano' : raw === 'REGRA' ? 'Regra' : String(raw)}</Badge>;
    default: return String(raw);
  }
}

function PreviewState({ page }: { page: PreviewPage }) {
  if (page.state === 'running') {
    const progress = page.progress;
    return (
      <div className="preview-state">
        <span className="spin" />
        <h3>Processando…</h3>
        {progress && <><p className="num">{count(progress.done)} de {count(progress.total)} linhas</p><span className="progress info" style={{ width: 260 }}><span style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></span></>}
      </div>
    );
  }
  if (page.state === 'failed') return <div className="preview-state"><Callout tone="critical" icon="alert"><strong>O passo falhou.</strong> {page.message}</Callout></div>;
  return <Empty icon="clock" title={page.message || 'Este passo ainda não rodou.'} />;
}

export function DataPreview({ runId, stepId, paramsOverride, onException, initialFilters, compact, pageSize = 100, header }: {
  runId?: string; stepId?: string; paramsOverride?: Record<string, ParamValue>; onException?: (id: string) => void;
  initialFilters?: ColumnFilter[]; compact?: boolean; pageSize?: number; header?: React.ReactNode;
}) {
  const [query, setQuery] = useState<PreviewQuery>({ page: 1, page_size: pageSize, filters: initialFilters || [] });
  const [draft, setDraft] = useState<ColumnFilter>({ key: '', op: 'contains', value: '' });
  useEffect(() => { setQuery({ page: 1, page_size: pageSize, filters: initialFilters || [] }); }, [runId, stepId, pageSize, JSON.stringify(initialFilters)]);
  const effective = paramsOverride ? { ...query, params_override: paramsOverride } : query;
  const { data: page, isLoading, isFetching, error } = usePreview(runId, stepId, effective);

  if (!runId || !stepId) return <Empty icon="columns" title="Selecione um passo" />;
  if (error) return <Callout tone="critical" icon="alert">{error.message}</Callout>;
  if (isLoading || !page) return <Loading label="Carregando dados do passo…" />;
  if (page.state !== 'ready') return <PreviewState page={page} />;

  const columns = page.schema;
  const moneyColumns = columns.filter(column => column.type === 'money');
  const pages = Math.max(1, Math.ceil(page.total_rows / page.page_size));
  const update = (patch: Partial<PreviewQuery>) => setQuery(current => ({ ...current, page: 1, ...patch }));
  const sortBy = (key: string) => setQuery(current => ({
    ...current, page: 1,
    sort: current.sort?.key === key ? (current.sort.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: NUMERIC.has(columns.find(c => c.key === key)?.type || '') ? 'desc' : 'asc' },
  }));
  const addFilter = () => {
    if (!draft.key || !draft.value.trim()) return;
    update({ filters: [...(query.filters || []), { ...draft, value: draft.value.trim() }] });
    setDraft({ key: draft.key, op: draft.op, value: '' });
  };
  const newCount = columns.filter(column => column.is_new).length;

  return (
    <div className={`preview ${compact ? 'compact' : ''}`} style={{ opacity: isFetching ? 0.65 : 1 }}>
      {!compact && (
        <div className="preview-toolbar">
          {header}
          <div className="row wrap" style={{ gap: 14 }}>
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle checked={!!query.only_exceptions} onChange={value => update({ only_exceptions: value })} label="Só exceções" />Só exceções{page.exceptions_total ? <span className="count">{count(page.exceptions_total)}</span> : null}</label>
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}><Toggle checked={!!query.diff} onChange={value => update({ diff: value })} label="Comparar com entrada" />Comparar com entrada</label>
          </div>
          <form className="row wrap preview-filter" style={{ gap: 6 }} onSubmit={event => { event.preventDefault(); addFilter(); }}>
            <Icon name="filter" className="muted" />
            <select className="select sm" value={draft.key} onChange={event => setDraft({ ...draft, key: event.target.value, op: NUMERIC.has(columns.find(c => c.key === event.target.value)?.type || '') ? 'gt' : 'contains' })} aria-label="Coluna do filtro">
              <option value="">Filtrar coluna…</option>
              {columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}
            </select>
            {draft.key && <>
              <select className="select sm" style={{ width: 120 }} value={draft.op} onChange={event => setDraft({ ...draft, op: event.target.value as ColumnFilter['op'] })} aria-label="Operador">
                {Object.entries(OPS).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
              </select>
              <input className="input sm" style={{ width: 150 }} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} placeholder={columns.find(c => c.key === draft.key)?.type === 'date' ? 'dd/mm/aaaa' : 'valor'} aria-label="Valor do filtro" />
              <button className="btn xs" type="submit">Aplicar</button>
            </>}
          </form>
        </div>
      )}
      {!!query.filters?.length && (
        <div className="row wrap" style={{ gap: 6, padding: compact ? '0 0 8px' : '8px 14px 0' }}>
          {query.filters.map((filter, index) => (
            <span key={index} className="chip">
              {columns.find(c => c.key === filter.key)?.label || filter.key} {OPS[filter.op]} “{filter.value}”
              {!compact && <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label="Remover filtro" onClick={() => update({ filters: query.filters!.filter((_, i) => i !== index) })}><Icon name="x" size={12} /></button>}
            </span>
          ))}
        </div>
      )}
      {!compact && (newCount > 0 || query.diff) && (
        <p className="preview-hint">
          {newCount > 0 && <><span className="new-dot" /> {plural(newCount)} criadas por este passo. </>}
          {query.diff && (page.diff_summary?.removed ? `${count(page.diff_summary.removed)} linha(s) removida(s) em relação à entrada aparecem riscadas.` : 'Nenhuma linha adicionada ou removida: o passo só acrescentou colunas.')}
        </p>
      )}
      {page.rows.length ? (
        <div className="table-wrap preview-table">
          <table className="table">
            <thead>
              <tr>
                <th className="mark-col" aria-label="Exceção" />
                {columns.map(column => (
                  <th key={column.key} className={`${NUMERIC.has(column.type) ? 'r' : ''} ${column.is_new ? 'new-col' : ''}`}>
                    <button type="button" className="th-sort" onClick={() => sortBy(column.key)}>
                      {column.label}
                      {column.is_new && <span className="new-tag">novo</span>}
                      {query.sort?.key === column.key && (query.sort.dir === 'asc' ? ' ↑' : ' ↓')}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row: PreviewRow) => {
                const exception = row._exception;
                return (
                  <tr key={row._id + (row._diff || '')} className={`${exception ? 'has-exception clickable' : ''} ${row._diff === 'removed' ? 'removed' : row._diff === 'added' ? 'added' : ''}`}
                    onClick={exception && onException ? () => onException(exception.id) : undefined}
                    title={exception ? `${exception.description}${exception.count && exception.count > 1 ? ` (+${exception.count - 1})` : ''}` : undefined}>
                    <td className={`mark-col ${exception ? exception.severity : ''}`}>{exception && <span className="mark" aria-label={`Exceção ${exception.severity}`} />}</td>
                    {columns.map(column => (
                      <td key={column.key} className={`${NUMERIC.has(column.type) ? 'r' : ''} ${column.is_new ? 'new-col' : ''} ${column.key === 'discriminacao' || column.key === 'descricao' || column.key === 'historico' ? 'wrap' : ''}`}>
                        {formatCell(column, row[column.key] as CellValue)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {moneyColumns.length > 0 && !compact && (
              <tfoot>
                <tr>
                  <td />
                  {columns.map((column, index) => (
                    <td key={column.key} className={`${column.type === 'money' ? 'r' : ''} ${column.is_new ? 'new-col' : ''}`}>
                      {column.type === 'money' ? <span className="stack" style={{ gap: 0 }}><Money value={page.totals.all[column.key]} /><span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>página <Money value={page.totals.page[column.key]} /></span></span>
                        : index === 0 ? <span>Total ({count(page.total_rows)} linhas)</span> : null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <Empty icon="search" title={page.message || (query.only_exceptions ? 'Nenhuma exceção neste passo' : 'Nenhuma linha. Isso é esperado?')}>
          {page.input_rows !== undefined && `Linhas de entrada do passo: ${count(page.input_rows)}.`}
        </Empty>
      )}
      {!compact && page.total_rows > page.page_size && (
        <div className="table-footer">
          <span>{count((page.page - 1) * page.page_size + 1)}–{count(Math.min(page.page * page.page_size, page.total_rows))} de {count(page.total_rows)} linhas{page.input_rows !== undefined && ` · entrada ${count(page.input_rows)}`}</span>
          <div className="pager">
            <button type="button" className="btn xs" disabled={page.page <= 1} onClick={() => setQuery(current => ({ ...current, page: page.page - 1 }))}><Icon name="chevronLeft" />Anterior</button>
            <span className="num">{page.page} / {pages}</span>
            <button type="button" className="btn xs" disabled={page.page >= pages} onClick={() => setQuery(current => ({ ...current, page: page.page + 1 }))}>Próxima<Icon name="chevronRight" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function plural(n: number) {
  return n === 1 ? '1 coluna nova' : `${n} colunas novas`;
}
