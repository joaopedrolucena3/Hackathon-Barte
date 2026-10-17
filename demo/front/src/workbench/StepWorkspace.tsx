// Data desk for one step: toolbar, spreadsheet grid, status bar with control totals, and the chat dock.
// Everything here only reads the step's immutable output.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { agent, type DataColumn, type ReviewException, type Run, type StepRun, type StepTable } from '../api/agent';
import { Icon } from '../components/Icon';
import { Callout, Empty, Loading, StatusBadge, Toggle } from '../components/ui';
import { count, plural, readable } from '../lib/format';
import { loadJSON, saveJSON } from '../lib/storage';
import { useExceptions, useStepTable } from '../state/queries';
import { useAction } from '../state/useAction';
import type { FilterOp, GridFilter, Rid } from './contract';
import { DataGrid, defaultWidth, type CellMenuTarget, type HeaderMenuTarget, type RowLook, type RowMark } from './DataGrid';
import { GridFooter } from './GridFooter';
import { Menu, type MenuItem } from './Menu';
import { workbench, useWorkbench } from './store';
import { NUMERIC_KINDS, OPS, copyText, describeView, display, exceptionIds, replicate, viewRids } from './table';

const KEY_COLUMNS = ['id', 'id_saida', 'entry_id', 'ref_origem', 'source_ref', 'code', 'name', 'bank'];

function NotReady({ step }: { step: StepRun }) {
  if (step.status === 'running') {
    const progress = step.metrics.progress;
    return (
      <div className="preview-state">
        <span className="spin" />
        <h3>Processando…</h3>
        {progress && <p className="num">{count(progress.done)} de {count(progress.total)} linhas</p>}
      </div>
    );
  }
  if (step.status === 'failed') return <div className="preview-state"><Callout tone="critical" icon="alert"><strong>O passo falhou.</strong> {step.error}</Callout></div>;
  if (step.status === 'skipped') return <Empty icon="minus" title="Passo pulado: um passo anterior falhou ou a execução foi reprovada." />;
  return <Empty icon="clock" title={step.kind === 'export' ? 'A exportação roda depois da aprovação humana.' : 'Este passo ainda não rodou.'} />;
}

function FilterBuilder({ columns, draft, setDraft, onApply }: {
  columns: DataColumn[]; draft: GridFilter; setDraft: (filter: GridFilter) => void; onApply: (filter: GridFilter) => void;
}) {
  const valueRef = useRef<HTMLInputElement>(null);
  const column = columns.find(item => item.name === draft.column);
  const needsValue = draft.op !== 'empty' && draft.op !== 'filled';
  useEffect(() => { if (draft.column) valueRef.current?.focus(); }, [draft.column]);
  return (
    <form className="row wrap wb-filter" style={{ gap: 6 }} onSubmit={event => {
      event.preventDefault();
      if (!draft.column || (needsValue && !draft.value?.trim())) return;
      onApply({ ...draft, value: needsValue ? draft.value?.trim() : undefined });
    }}>
      <Icon name="filter" className="muted" />
      <select className="select sm" aria-label="Coluna do filtro" value={draft.column} onChange={event => {
        const next = columns.find(item => item.name === event.target.value);
        setDraft({ column: event.target.value, op: next && NUMERIC_KINDS.has(next.kind) ? 'gt' : 'contains', value: '' });
      }}>
        <option value="">Filtrar coluna…</option>
        {columns.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}
      </select>
      {draft.column && <>
        <select className="select sm" style={{ width: 150 }} aria-label="Operador" value={draft.op} onChange={event => setDraft({ ...draft, op: event.target.value as FilterOp })}>
          {(Object.keys(OPS) as FilterOp[]).filter(op => NUMERIC_KINDS.has(column?.kind || 'text') || column?.kind === 'date' || !['gt', 'gte', 'lt', 'lte'].includes(op))
            .map(op => <option key={op} value={op}>{OPS[op]}</option>)}
        </select>
        {needsValue && <input ref={valueRef} className="input sm" style={{ width: 150 }} aria-label="Valor do filtro" value={draft.value || ''}
          placeholder={column?.kind === 'date' ? 'dd/mm/aaaa' : column?.kind === 'money' ? 'ex.: 1.234,56' : 'valor'} onChange={event => setDraft({ ...draft, value: event.target.value })} />}
        <button className="btn xs" type="submit">Aplicar</button>
      </>}
    </form>
  );
}

export function StepWorkspace({ run, step, onException, onDetails, chat, initialFilters }: {
  run: Run; step: StepRun; onException: (id: string) => void; onDetails: () => void;
  /** The chat dock under the status bar, given the table on screen (synthetic: `?volume=` mode rows). */
  chat?: (table: StepTable, synthetic: boolean) => ReactNode;
  /** Deep links (e.g. `?ref=` from a divergence) open the table already filtered. */
  initialFilters?: GridFilter[];
}) {
  const [params, setParams] = useSearchParams();
  const ready = ['done', 'exceptions', 'approved', 'awaiting_approval'].includes(step.status) && step.kind !== 'gate';
  const requested = params.get('dataset') || undefined;
  const { data: table, isLoading, error } = useStepTable(run.id, step.id, requested, ready);
  const volume = Math.min(Number(params.get('volume')) || 0, 200_000);
  const view = useMemo(() => (table && volume ? replicate(table, volume) : table), [table, volume]);
  const wb = useWorkbench();
  const { data: exceptions } = useExceptions(run.id, !!table?.columns.some(column => column.name === '__exception_ids'));
  const { run: act, busy } = useAction();

  const initialKey = JSON.stringify(initialFilters || []);
  useEffect(() => {
    if (!table) return;
    workbench.open(run.id, step.id, table.dataset);
    if (initialFilters?.length) workbench.setFilters(initialFilters.filter(filter => table.columns.some(column => column.name === filter.column)));
  }, [run.id, step.id, table, initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => (view ? view.columns.map((column, index) => (column.hidden ? -1 : index)).filter(index => index >= 0) : []), [view]);
  const visibleColumns = useMemo(() => visible.map(index => view!.columns[index]), [visible, view]);
  const current = wb.dataset === table?.dataset && wb.stepId === step.id;
  const chatRows = useMemo(() => (current && wb.chatFilter?.dataset === table?.dataset ? new Set(wb.chatFilter.rids) : null), [current, wb.chatFilter, table]);
  const options = useMemo(() => ({ filters: current ? wb.filters : [], sort: current ? wb.sort : null, onlyExceptions: current && wb.onlyExceptions, rids: chatRows }),
    [current, wb.filters, wb.sort, wb.onlyExceptions, chatRows]);
  const rids = useMemo(() => (view ? viewRids(view, options) : []), [view, options]);
  const synthetic = !!table && volume > table.rows.length;
  useEffect(() => {
    if (view && current) workbench.setView(view.rows.length, rids.length, rids.length < view.rows.length && !synthetic ? rids : null);
  }, [view, rids, current, synthetic]);

  const byId = useMemo(() => new Map((exceptions || []).map(item => [item.id, item] as [string, ReviewException])), [exceptions]);
  const realRows = table?.rows.length || 1;
  const highlightOf = useMemo(() => {
    const map = new Map<Rid, RowLook['highlight']>();
    for (const item of wb.highlights) if (item.dataset === table?.dataset) for (const rid of item.rids) map.set(rid, item.tone);
    return map;
  }, [wb.highlights, table]);
  const look = useCallback((rid: Rid): RowLook => {
    const ids = view ? exceptionIds(view, rid) : [];
    let mark: RowMark = null;
    if (ids.length) {
      const items = ids.map(id => byId.get(id));
      mark = items.some(item => item && !item.decision && item.severity === 'bloqueante') ? 'blocking'
        : items.some(item => !item || !item.decision) ? 'alert' : 'decided';
    }
    return { mark, highlight: highlightOf.get(rid % realRows) ?? null };
  }, [view, byId, highlightOf, realRows]);
  const flagged = useMemo(() => (view ? rids.filter(rid => exceptionIds(view, rid).length).length : 0), [view, rids]);

  const widthKey = `tarvo-grid-widths:${table?.dataset || ''}`;
  const [saved, setSaved] = useState<Record<string, number>>({});
  useEffect(() => { setSaved(loadJSON(widthKey, {})); }, [widthKey]);
  const widths = useMemo(() => {
    if (!view) return {};
    const result: Record<string, number> = {};
    const sample = view.rows.slice(0, 40);
    for (const index of visible) {
      const column = view.columns[index];
      result[column.name] = saved[column.name] || defaultWidth(column, sample.map(row => display(column.kind, row[index])));
    }
    return result;
  }, [view, visible, saved]);
  const resize = useCallback((column: string, width: number) => {
    setSaved(currentWidths => { const next = { ...currentWidths, [column]: width }; saveJSON(widthKey, next); return next; });
  }, [widthKey]);

  const [draft, setDraft] = useState<GridFilter>({ column: '', op: 'contains', value: '' });
  const [cellMenu, setCellMenu] = useState<CellMenuTarget | null>(null);
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuTarget | null>(null);
  const closeCell = useCallback(() => setCellMenu(null), []);
  const closeHeader = useCallback(() => setHeaderMenu(null), []);
  useEffect(() => { setDraft({ column: '', op: 'contains', value: '' }); }, [step.id, table?.dataset]);

  if (!ready) return <NotReady step={step} />;
  if (error) return <div className="card-body"><Callout tone="critical" icon="alert">{error.message}</Callout></div>;
  if (isLoading || !table || !view) return <Loading label="Carregando a tabela do passo…" />;

  const index = new Map(view.columns.map((column, i) => [column.name, i]));
  const keyColumn = KEY_COLUMNS.find(name => index.has(name));
  const rowLabel = (rid: Rid) => (keyColumn ? String(view.rows[rid][index.get(keyColumn)!] ?? '') : '') || `linha ${count(rid + 1)}`;
  const filters = current ? wb.filters : [];

  const cellItems = (target: CellMenuTarget): MenuItem[] => {
    const at = index.get(target.column.name)!;
    const value = view.rows[target.rid][at];
    const shown = display(target.column.kind, value) || 'vazio';
    const ids = exceptionIds(view, target.rid);
    const selection = wb.selection && wb.selection.stats.cells > 1 ? wb.selection : null;
    return [
      { label: 'Por quê?', icon: 'sparkline', tone: 'accent', hint: 'pergunta ao chat', onSelect: () => workbench.ask({
        mode: 'por_que', question: `Por que ${target.column.label} é ${shown} em ${rowLabel(target.rid % realRows)}?`,
        cell: { dataset: table.dataset, rid: target.rid % realRows, column: target.column.name, label: target.column.label, value },
      }) },
      ...(selection ? [{ label: 'Perguntar sobre a seleção', icon: 'columns' as const, hint: plural(selection.stats.cells, 'célula', 'células'),
        onSelect: () => workbench.ask({ mode: 'pergunta', question: '', selection }) }] : []),
      { label: 'Filtrar por este valor', icon: 'filter', disabled: value === null || value === '', onSelect: () =>
        workbench.addFilter({ column: target.column.name, op: 'eq', value: NUMERIC_KINDS.has(target.column.kind) ? String(value) : display(target.column.kind, value) }) },
      { label: 'Copiar valor', icon: 'copy', onSelect: () => void navigator.clipboard?.writeText(copyText(target.column.kind, value)) },
      ...(ids.length ? [{ label: 'Ver exceção', icon: 'alert' as const, hint: ids.length > 1 ? `${ids.length} exceções` : readable(byId.get(ids[0])?.kind), onSelect: () => onException(ids[0]) }] : []),
    ];
  };
  const headerItems = (target: HeaderMenuTarget): MenuItem[] => {
    const sorted = current && wb.sort?.column === target.column.name;
    return [
      { label: 'Ordenar crescente', icon: 'arrowRight', onSelect: () => workbench.setSort({ column: target.column.name, dir: 'asc' }) },
      { label: 'Ordenar decrescente', icon: 'arrowLeft', onSelect: () => workbench.setSort({ column: target.column.name, dir: 'desc' }) },
      ...(sorted ? [{ label: 'Tirar ordenação', icon: 'x' as const, onSelect: () => workbench.setSort(null) }] : []),
      { label: 'Filtrar esta coluna…', icon: 'filter', onSelect: () => setDraft({ column: target.column.name, op: NUMERIC_KINDS.has(target.column.kind) ? 'gt' : 'contains', value: '' }) },
    ];
  };

  const exportView = (formato: 'xlsx' | 'csv') => act(`export-${formato}`, () => agent.exportView(run.id, step.id, {
    dataset: table.dataset, rids, columns: visibleColumns.map(column => column.name), formato, descricao: describeView(view.columns, options, rids.length),
  }), { success: formato === 'xlsx' ? 'Planilha exportada.' : 'CSV exportado.' });

  return (
    <div className="wb-main">
      <div className="wb-toolbar">
        <div className="row between" style={{ gap: 10, minWidth: 0 }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <strong className="wb-title">{table.step_number}. {step.title}</strong>
            <StatusBadge status={step.status} />
            {table.datasets.length > 1 && (
              <select className="select sm" style={{ width: 'auto' }} aria-label="Tabela de saída" value={table.dataset}
                onChange={event => setParams(currentParams => { currentParams.set('dataset', event.target.value); currentParams.delete('volume'); return currentParams; }, { replace: true })}>
                {table.datasets.map(item => <option key={item.name} value={item.name}>{item.title || readable(item.name)} ({count(item.rows)})</option>)}
              </select>
            )}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn xs" disabled={synthetic || !!busy || !rids.length} title={synthetic ? 'Modo volume usa linhas sintéticas e não exporta.' : undefined}
              onClick={() => exportView('xlsx')}><Icon name="download" />{busy === 'export-xlsx' ? 'Exportando…' : 'Excel'}</button>
            <button type="button" className="btn xs ghost" disabled={synthetic || !!busy || !rids.length} onClick={() => exportView('csv')}>CSV</button>
            <button type="button" className="btn xs ghost" onClick={onDetails}><Icon name="panel" />Detalhes</button>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <FilterBuilder columns={visibleColumns} draft={draft} setDraft={setDraft} onApply={filter => { workbench.addFilter(filter); setDraft({ column: filter.column, op: filter.op, value: '' }); }} />
          {view.columns.some(column => column.name === '__exception_ids') && (
            <label className="row" style={{ gap: 7, fontSize: 12.5 }}>
              <Toggle checked={current && wb.onlyExceptions} onChange={value => workbench.setOnlyExceptions(value)} label="Só exceções" />Só exceções
            </label>
          )}
        </div>
        {(filters.length > 0 || (current && wb.chatFilter) || synthetic || (current && wb.sort)) && (
          <div className="row wrap" style={{ gap: 6 }}>
            {synthetic && <span className="chip warn"><Icon name="layers" size={12} />Modo volume: {count(view.rows.length)} linhas sintéticas (repetição das {count(table.rows.length)} reais)</span>}
            {current && wb.chatFilter && (
              <span className="chip info"><Icon name="sparkline" size={12} />{wb.chatFilter.label} ({count(wb.chatFilter.rids.length)})
                <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label="Remover filtro do chat" onClick={() => workbench.clearChatFilter()}><Icon name="x" size={12} /></button></span>
            )}
            {filters.map((filter, i) => (
              <span key={`${filter.column}-${filter.op}-${i}`} className="chip">
                {visibleColumns.find(column => column.name === filter.column)?.label || filter.column} {OPS[filter.op]}{filter.value !== undefined ? ` “${filter.value}”` : ''}
                <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label="Remover filtro" onClick={() => workbench.removeFilter(i)}><Icon name="x" size={12} /></button>
              </span>
            ))}
            {current && wb.sort && (
              <span className="chip">Ordem: {visibleColumns.find(column => column.name === wb.sort!.column)?.label} {wb.sort.dir === 'asc' ? '↑' : '↓'}
                <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-label="Tirar ordenação" onClick={() => workbench.setSort(null)}><Icon name="x" size={12} /></button></span>
            )}
          </div>
        )}
      </div>

      <div className="wb-grid">
        {rids.length || !view.rows.length ? (
          view.rows.length ? (
            <DataGrid table={view} rids={rids} visible={visible} look={look} sort={current ? wb.sort : null} widths={widths} onResize={resize}
              onSelection={workbench.setSelection} onFocusColumn={workbench.focusColumn} onCellMenu={setCellMenu} onHeaderMenu={setHeaderMenu}
              onStatusClick={rid => { const ids = exceptionIds(view, rid); if (ids[0]) onException(ids[0]); }}
              resetKey={`${step.id}|${table.dataset}|${JSON.stringify(options.filters)}|${options.onlyExceptions}|${wb.chatFilter?.id || ''}|${volume}`} />
          ) : <Empty icon="search" title="Esta tabela não tem linhas." />
        ) : <Empty icon="search" title="Nenhuma linha com estes filtros." />}
      </div>

      <GridFooter table={table} view={view} rids={rids} flagged={flagged} selection={current ? wb.selection : null} />
      {chat?.(table, synthetic)}

      {cellMenu && <Menu x={cellMenu.x} y={cellMenu.y} title={`${cellMenu.column.label} · ${rowLabel(cellMenu.rid % realRows)}`} items={cellItems(cellMenu)} onClose={closeCell} />}
      {headerMenu && <Menu x={headerMenu.x} y={headerMenu.y} title={headerMenu.column.label} items={headerItems(headerMenu)} onClose={closeHeader}>
        {headerMenu.column.description && <p className="wb-menu-note">{headerMenu.column.description}</p>}
      </Menu>}
    </div>
  );
}
