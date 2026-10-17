// Status bar: rows, control totals of the step (backend Decimal), the view's totals when filtered,
// cross-step controls (✓/✗) and Excel-like sum/average/count of the selection.
import { useMemo, useState } from 'react';
import type { StepTable } from '../api/agent';
import { Icon } from '../components/Icon';
import { count, money } from '../lib/format';
import type { Rid, SelectionContext } from './contract';
import { formatStat, selectionStats } from './table';

export function GridFooter({ table, view, rids, flagged, selection }: {
  table: StepTable; view: StepTable; rids: Rid[]; flagged: number; selection: SelectionContext | null;
}) {
  const [open, setOpen] = useState(false);
  const filtered = rids.length !== view.rows.length;
  const viewTotals = useMemo(() => {
    if (!filtered) return null;
    return table.totals.map(total => {
      const at = view.columns.findIndex(column => column.name === total.column);
      return selectionStats(rids.map(rid => ({ kind: 'money' as const, value: view.rows[rid][at] }))).sum || '0.00';
    });
  }, [filtered, table, view, rids]);
  const failing = table.invariants.filter(check => !check.ok);

  return (
    <div className="wb-footer">
      <span className="num wb-count">
        <strong>{count(view.rows.length)}</strong> linhas{filtered && <> · <strong>{count(rids.length)}</strong> na visão</>}{flagged ? <> · {count(flagged)} com exceção</> : null}
      </span>
      <span className="wb-totals">
        {table.totals.map((total, index) => (
          <span key={total.column} className="wb-total">
            <span className="muted">{total.label}</span> <strong className="num">{money(total.value)}</strong>
            {viewTotals && <span className="muted num"> · visão {money(viewTotals[index])}</span>}
          </span>
        ))}
      </span>
      {table.invariants.length > 0 && (
        <button type="button" className={`chip wb-check ${failing.length ? 'bad' : 'good'}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={failing.length ? 'alert' : 'check'} size={12} />
          {failing.length ? `${failing.length} controle${failing.length > 1 ? 's' : ''} não fecha${failing.length > 1 ? 'm' : ''}`
            : table.invariants.length > 1 ? `${table.invariants.length} controles conferem` : 'Controle confere'}
        </button>
      )}
      <span className="wb-selection num">
        {selection ? (
          <>
            {selection.stats.numeric > 0 && <>Soma <strong>{formatStat(selection.stats.sum, selection.stats.money)}</strong> · Média <strong>{formatStat(selection.stats.avg, selection.stats.money)}</strong> · </>}
            Contagem <strong>{count(selection.stats.cells)}</strong>
          </>
        ) : <span className="muted">Selecione células para somar</span>}
      </span>
      {open && (
        <div className="wb-checks" role="dialog" aria-label="Controles entre passos">
          <div className="row between"><strong>Controles entre passos</strong><button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setOpen(false)}><Icon name="x" size={14} /></button></div>
          {table.invariants.map(check => (
            <div key={check.id} className="wb-check-item">
              <p className="row" style={{ gap: 6 }}><Icon name={check.ok ? 'check' : 'alert'} size={14} className={check.ok ? 'good' : 'bad'} /><strong>{check.title}</strong>{!check.ok && <span className="bad">não confere</span>}</p>
              <ul>
                {check.sides.map((side, index) => (
                  <li key={index}><span className="muted">Passo {side.step_number} · {side.step_title} · {side.label}</span> <strong className="num">{money(side.value)}</strong></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
