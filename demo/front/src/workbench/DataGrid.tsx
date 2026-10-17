// Spreadsheet-like grid over the whole step table (Glide Data Grid, canvas). Read-only: cells never open
// an editor. Selection feeds the status bar and the chat; right click opens the cell menu ("Por quê?").
import '@glideapps/glide-data-grid/dist/index.css';
import {
  CompactSelection, DataEditor, GridCellKind, type GridCell, type GridColumn, type GridSelection, type Item, type Theme,
} from '@glideapps/glide-data-grid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DataColumn, StepTable } from '../api/agent';
import type { Rid, SelectionContext, SortSpec } from './contract';
import { NUMERIC_KINDS, copyText, display, letter, selectionStats } from './table';

export type RowMark = 'blocking' | 'alert' | 'decided' | null;
export interface RowLook { mark: RowMark; highlight: 'info' | 'warning' | 'critical' | null }

export interface CellMenuTarget { x: number; y: number; rid: Rid; column: DataColumn }
export interface HeaderMenuTarget { x: number; y: number; column: DataColumn }

const MARK: Record<Exclude<RowMark, null>, string> = { blocking: '▲', alert: '●', decided: '✓' };

function cssTheme(): Partial<Theme> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    accentColor: v('--accent'), accentFg: '#ffffff', accentLight: v('--accent-wash'),
    textDark: v('--text'), textMedium: v('--text-2'), textLight: v('--muted'), textBubble: v('--text'),
    textHeader: v('--text-2'), textGroupHeader: v('--subtle'), textHeaderSelected: '#ffffff',
    bgIconHeader: v('--text-2'), fgIconHeader: '#ffffff',
    bgCell: v('--surface'), bgCellMedium: v('--surface-2'), bgHeader: v('--surface-2'), bgHeaderHasFocus: v('--surface-3'),
    bgHeaderHovered: v('--surface-3'), bgBubble: v('--surface-3'), bgBubbleSelected: v('--surface'), bgSearchResult: v('--st-warning-wash'),
    borderColor: v('--border'), horizontalBorderColor: v('--grid'), drilldownBorder: v('--border-strong'), linkColor: v('--st-info'),
    fontFamily: v('--font'), baseFontStyle: '12.5px', headerFontStyle: '600 12px', markerFontStyle: '11px', editorFontSize: '12.5px',
    cellHorizontalPadding: 10, cellVerticalPadding: 4, lineHeight: 1.4,
  };
}

function tones() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    blocking: { wash: v('--st-critical-wash'), ink: v('--st-critical') },
    alert: { wash: v('--st-warning-wash'), ink: v('--st-warning') },
    decided: { wash: '', ink: v('--subtle') },
    info: { wash: v('--st-info-wash'), ink: v('--st-info') },
    warning: { wash: v('--st-warning-wash'), ink: v('--st-warning') },
    critical: { wash: v('--st-critical-wash'), ink: v('--st-critical') },
  };
}

export function defaultWidth(column: DataColumn, sample: string[]) {
  const content = Math.max(column.label.length + 4, ...sample.map(text => text.length)) * 7.2 + 24;
  const floor = NUMERIC_KINDS.has(column.kind) ? 96 : column.kind === 'date' ? 98 : 70;
  return Math.round(Math.min(320, Math.max(floor, content)));
}

export function DataGrid({ table, rids, visible, look, sort, widths, onResize, onSelection, onCellMenu, onHeaderMenu, onStatusClick, onFocusColumn, resetKey }: {
  table: StepTable;
  /** Rows in display order. */
  rids: Rid[];
  /** Indexes of `table.columns` shown, in order. */
  visible: number[];
  look: (rid: Rid) => RowLook;
  sort: SortSpec | null;
  widths: Record<string, number>;
  onResize: (column: string, width: number) => void;
  onSelection: (selection: SelectionContext | null) => void;
  onCellMenu: (target: CellMenuTarget) => void;
  onHeaderMenu: (target: HeaderMenuTarget) => void;
  onStatusClick: (rid: Rid) => void;
  onFocusColumn: (column?: string) => void;
  /** Changing it (step, dataset, filters) clears the selection. */
  resetKey: string;
}) {
  const theme = useMemo(cssTheme, []);
  const palette = useMemo(tones, []);
  const empty: GridSelection = useMemo(() => ({ columns: CompactSelection.empty(), rows: CompactSelection.empty() }), []);
  const [selection, setSelection] = useState<GridSelection>(empty);
  const cache = useRef(new Map<number, (string | undefined)[]>());

  useEffect(() => { cache.current = new Map(); }, [table]);
  useEffect(() => { setSelection(empty); onSelection(null); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: GridColumn[] = useMemo(() => [
    { id: '__status', title: '', width: 30, group: ' ' },
    ...visible.map((index, position) => {
      const column = table.columns[index];
      const arrow = sort?.column === column.name ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
      return { id: column.name, title: column.label + arrow, width: widths[column.name] || 120, group: letter(position), hasMenu: true };
    }),
  ], [table, visible, sort, widths]);

  const text = useCallback((index: number, rid: Rid) => {
    let column = cache.current.get(index);
    if (!column) { column = new Array(table.rows.length); cache.current.set(index, column); }
    let value = column[rid];
    if (value === undefined) { value = display(table.columns[index].kind, table.rows[rid][index]); column[rid] = value; }
    return value;
  }, [table]);

  const getCellContent = useCallback(([col, row]: Item): GridCell => {
    const rid = rids[row];
    if (rid === undefined) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false, readonly: true };
    if (col === 0) {
      const { mark, highlight } = look(rid);
      const symbol = mark ? MARK[mark] : highlight ? '◆' : '';
      const ink = mark ? palette[mark].ink : highlight ? palette[highlight].ink : undefined;
      return { kind: GridCellKind.Text, data: symbol, displayData: symbol, allowOverlay: false, readonly: true, contentAlign: 'center',
        cursor: mark ? 'pointer' : undefined, themeOverride: ink ? { textDark: ink } : undefined };
    }
    const index = visible[col - 1];
    const column = table.columns[index];
    const shown = text(index, rid);
    return { kind: GridCellKind.Text, data: shown, displayData: shown, copyData: copyText(column.kind, table.rows[rid][index]),
      allowOverlay: false, readonly: true, contentAlign: NUMERIC_KINDS.has(column.kind) ? 'right' : 'left' };
  }, [rids, visible, table, look, palette, text]);

  const getRowThemeOverride = useCallback((row: number): Partial<Theme> | undefined => {
    const rid = rids[row];
    if (rid === undefined) return undefined;
    const { mark, highlight } = look(rid);
    const wash = highlight ? palette[highlight].wash : mark && mark !== 'decided' ? palette[mark].wash : '';
    return wash ? { bgCell: wash, bgCellMedium: wash } : undefined;
  }, [rids, look, palette]);

  const publish = useCallback((next: GridSelection) => {
    const cells: { kind: DataColumn['kind']; value: DataValueOf }[] = [];
    const names = new Set<string>(), touched = new Set<Rid>();
    const add = (col: number, row: number) => {
      if (col < 1 || row < 0 || row >= rids.length) return;
      const index = visible[col - 1];
      if (index === undefined) return;
      const rid = rids[row];
      cells.push({ kind: table.columns[index].kind, value: table.rows[rid][index] });
      names.add(table.columns[index].name);
      touched.add(rid);
    };
    const rects = next.current ? [next.current.range, ...next.current.rangeStack] : [];
    for (const rect of rects) for (let x = rect.x; x < rect.x + rect.width; x++) for (let y = rect.y; y < rect.y + rect.height; y++) add(x, y);
    for (const col of next.columns) for (let y = 0; y < rids.length; y++) add(col, y);
    for (const row of next.rows) for (let x = 1; x <= visible.length; x++) add(x, row);
    if (!cells.length) { onSelection(null); return; }
    onSelection({ dataset: table.dataset, columns: [...names], rids: [...touched], stats: selectionStats(cells) });
    const focusCol = next.current?.cell[0] ?? next.columns.first();
    onFocusColumn(focusCol && focusCol > 0 ? table.columns[visible[focusCol - 1]]?.name : undefined);
  }, [rids, visible, table, onSelection, onFocusColumn]);

  const timer = useRef<number>();
  const onGridSelectionChange = useCallback((next: GridSelection) => {
    setSelection(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => publish(next), 60);
  }, [publish]);

  return (
    <DataEditor
      className="wb-canvas"
      theme={theme}
      columns={columns}
      rows={rids.length}
      getCellContent={getCellContent}
      getRowThemeOverride={getRowThemeOverride}
      getCellsForSelection
      rowMarkers="number"
      freezeColumns={1}
      smoothScrollX
      smoothScrollY
      rangeSelect="multi-rect"
      columnSelect="multi"
      rowSelect="multi"
      rowHeight={30}
      headerHeight={32}
      groupHeaderHeight={20}
      width="100%"
      height="100%"
      gridSelection={selection}
      onGridSelectionChange={onGridSelectionChange}
      onColumnResize={(column, size) => { if (column.id && column.id !== '__status') onResize(column.id, Math.round(size)); }}
      onHeaderMenuClick={(col, bounds) => {
        const column = table.columns[visible[col - 1]];
        if (column) onHeaderMenu({ x: bounds.x, y: bounds.y + bounds.height, column });
      }}
      onCellClicked={([col, row]) => { const rid = rids[row]; if (col === 0 && rid !== undefined && look(rid).mark) onStatusClick(rid); }}
      onCellContextMenu={([col, row], event) => {
        event.preventDefault();
        const rid = rids[row], column = table.columns[visible[col - 1]];
        if (rid === undefined || !column) return;
        if (!selection.current || selection.current.range.width * selection.current.range.height <= 1) {
          onGridSelectionChange({ ...empty, current: { cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] } });
        }
        onCellMenu({ x: event.bounds.x + event.localEventX, y: event.bounds.y + event.localEventY, rid, column });
      }}
    />
  );
}

type DataValueOf = StepTable['rows'][number][number];
