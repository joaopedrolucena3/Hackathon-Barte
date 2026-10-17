// Client-side table for small reference lists (≤ a few hundred rows). The run preview uses DataPreview.
import { useMemo, useState, type ReactNode } from 'react';
import { count } from '../lib/format';
import { Icon } from './Icon';
import { Empty } from './ui';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => string | number;
  align?: 'right' | 'center';
  wrap?: boolean;
  width?: number;
}

export function DataTable<T>({ rows, columns, rowKey, search, onRowClick, selected, toolbar, pageSize = 25, empty, initialSort, dense }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  search?: (row: T) => string;
  onRowClick?: (row: T) => void;
  selected?: string | null;
  toolbar?: ReactNode;
  pageSize?: number;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  dense?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(initialSort || null);
  const filtered = useMemo(() => {
    const needle = term.trim().toLocaleLowerCase('pt-BR');
    let list = needle && search ? rows.filter(row => search(row).toLocaleLowerCase('pt-BR').includes(needle)) : rows;
    const column = sort && columns.find(item => item.key === sort.key);
    if (column?.value) {
      const get = column.value;
      list = [...list].sort((a, b) => {
        const x = get(a), y = get(b);
        const result = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
        return sort!.dir === 'asc' ? result : -result;
      });
    }
    return list;
  }, [rows, term, sort, columns, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div>
      {(search || toolbar) && (
        <div className="table-toolbar">
          {search && (
            <label className="search">
              <Icon name="search" />
              <input className="input sm" type="search" value={term} placeholder="Buscar…" aria-label="Buscar na tabela" onChange={event => { setTerm(event.target.value); setPage(1); }} />
            </label>
          )}
          {toolbar}
        </div>
      )}
      {visible.length ? (
        <div className="table-wrap">
          <table className="table" style={dense ? { fontSize: 12 } : undefined}>
            <thead>
              <tr>
                {columns.map(column => {
                  const active = sort?.key === column.key;
                  return (
                    <th key={column.key} className={column.align === 'right' ? 'r' : column.align === 'center' ? 'c' : ''} style={column.width ? { width: column.width } : undefined}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {column.value ? (
                        <button type="button" className="link" style={{ color: 'inherit', fontWeight: 650, fontSize: 11, textTransform: 'inherit', letterSpacing: 'inherit' }}
                          onClick={() => setSort(active && sort!.dir === 'desc' ? { key: column.key, dir: 'asc' } : { key: column.key, dir: active ? 'desc' : 'asc' })}>
                          {column.label}{active && (sort!.dir === 'asc' ? ' ↑' : ' ↓')}
                        </button>
                      ) : column.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const id = rowKey(row);
                return (
                  <tr key={id} className={`${onRowClick ? 'clickable' : ''} ${selected === id ? 'selected' : ''}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                    {columns.map(column => (
                      <td key={column.key} className={`${column.align === 'right' ? 'r' : column.align === 'center' ? 'c' : ''} ${column.wrap ? 'wrap' : ''}`}>
                        {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (empty || <Empty icon="search" title="Nenhum registro encontrado">{term ? 'Tente outro termo.' : 'Não há registros para mostrar.'}</Empty>)}
      {filtered.length > pageSize && (
        <div className="table-footer">
          <span>{count((current - 1) * pageSize + 1)}–{count(Math.min(current * pageSize, filtered.length))} de {count(filtered.length)}</span>
          <div className="pager">
            <button type="button" className="btn xs" disabled={current <= 1} onClick={() => setPage(current - 1)}><Icon name="chevronLeft" />Anterior</button>
            <span className="num">{current} / {pages}</span>
            <button type="button" className="btn xs" disabled={current >= pages} onClick={() => setPage(current + 1)}>Próxima<Icon name="chevronRight" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
