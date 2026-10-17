// HTML bar charts following the dataviz specs: thin bars (≤24px) with a 4px rounded data end, square
// baseline, 2px surface gaps, text in ink tokens, a hover/focus tooltip per mark and labels at the tip.
import { useState, type CSSProperties, type ReactNode } from 'react';

export interface BarDatum {
  key: string;
  label: string;
  /** Geometry only (already-formatted text goes in `display`). */
  value: number;
  display: string;
  sub?: string;
  color?: string;
}

interface TipState { x: number; y: number; title: string; value: string; sub?: string; color?: string }

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="presentation">
      <strong>{tip.value}</strong>
      <span className="row">{tip.color && <span className="key" style={{ background: tip.color }} />}{tip.title}</span>
      {tip.sub && <span className="row" style={{ marginTop: 2 }}>{tip.sub}</span>}
    </div>
  );
}

function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (event: React.MouseEvent | React.FocusEvent, data: Omit<TipState, 'x' | 'y'>) => {
    const target = event.currentTarget as HTMLElement;
    const host = target.closest('.chart') as HTMLElement;
    const box = target.getBoundingClientRect(), hostBox = host.getBoundingClientRect();
    const x = 'clientX' in event && event.clientX ? event.clientX - hostBox.left : box.left - hostBox.left + box.width / 2;
    setTip({ ...data, x, y: box.top - hostBox.top });
  };
  return { tip, show, hide: () => setTip(null) };
}

export function HBarChart({ data, onSelect, color = 'var(--series-1)', labelWidth = 190, empty, legend, ariaLabel }: {
  data: BarDatum[]; onSelect?: (key: string) => void; color?: string; labelWidth?: number; empty?: ReactNode; legend?: ReactNode; ariaLabel: string;
}) {
  const { tip, show, hide } = useTip();
  const max = Math.max(...data.map(item => Math.abs(item.value)), 0);
  if (!data.length || max === 0) return <>{empty}</>;
  return (
    <div className="chart" role="list" aria-label={ariaLabel} onMouseLeave={hide}>
      {legend && <div className="legend" style={{ marginBottom: 12 }}>{legend}</div>}
      <div className="hbar-grid" style={{ '--bar-label-width': `${labelWidth}px` } as CSSProperties}>
        {data.map(item => {
          // The value label sits at the bar tip, so the longest bar leaves room for it inside the row.
          const width = `max(3px, calc((100% - ${item.sub ? 150 : 90}px) * ${(Math.abs(item.value) / max).toFixed(4)}))`;
          const fill = item.color || color;
          const Tag = onSelect ? 'button' : 'div';
          const handlers = {
            onMouseMove: (event: React.MouseEvent) => show(event, { title: item.label, value: item.display, sub: item.sub, color: fill }),
            onFocus: (event: React.FocusEvent) => show(event, { title: item.label, value: item.display, sub: item.sub, color: fill }),
            onBlur: hide,
          };
          return (
            <div key={item.key} role="listitem" style={{ display: 'contents' }}>
              <span className="bar-label text-2" title={item.label}>{item.label}</span>
              <Tag
                type={onSelect ? 'button' : undefined}
                onClick={onSelect ? () => onSelect(item.key) : undefined}
                aria-label={`${item.label}: ${item.display}${item.sub ? `, ${item.sub}` : ''}`}
                className="bar-row"
                style={barRowStyle(!!onSelect)}
                {...handlers}
              >
                <span style={{ width, height: 14, background: fill, borderRadius: '0 4px 4px 0', flexShrink: 0, transition: 'width .4s ease' }} />
                <span className="num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{item.display}</span>
                {item.sub && <span className="muted nowrap" style={{ fontSize: 11.5 }}>{item.sub}</span>}
              </Tag>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

const barRowStyle = (interactive: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, height: 24, padding: 0, border: 0, background: 'transparent',
  cursor: interactive ? 'pointer' : 'default', borderLeft: '1px solid var(--axis)', textAlign: 'left',
});

export interface Segment { key: string; label: string; value: number; display: string; sub?: string; color: string }

/** Part-to-whole in one bar, with a legend that always names each part (color is never alone). */
export function StackedBar({ segments, ariaLabel, tall, onSelect }: { segments: Segment[]; ariaLabel: string; tall?: boolean; onSelect?: (key: string) => void }) {
  const { tip, show, hide } = useTip();
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="chart" onMouseLeave={hide}>
      <div className={`meter ${tall ? 'tall' : ''}`} role="img" aria-label={ariaLabel}>
        {total === 0 ? <span className="meter-track" style={{ flexGrow: 1 }} /> : segments.filter(item => item.value > 0).map(item => (
          <span
            key={item.key}
            tabIndex={0}
            style={{ flexGrow: item.value, flexBasis: 0, background: item.color, cursor: onSelect ? 'pointer' : 'default', minWidth: 3 }}
            onClick={onSelect ? () => onSelect(item.key) : undefined}
            onMouseMove={event => show(event, { title: item.label, value: item.display, sub: item.sub, color: item.color })}
            onFocus={event => show(event, { title: item.label, value: item.display, sub: item.sub, color: item.color })}
            onBlur={hide}
          />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 12, flexDirection: 'column', gap: 8 }}>
        {segments.map(item => (
          <span key={item.key} className="legend-item" style={{ justifyContent: 'space-between', width: '100%' }}>
            <span className="row" style={{ gap: 8 }}><span className="legend-swatch" style={{ background: item.color }} />{item.label}</span>
            <span className="row" style={{ gap: 10 }}>{item.sub && <span className="muted num">{item.sub}</span>}<strong>{item.display}</strong></span>
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** One segment per item (e.g. checklist tasks), colored by state, with counts per state in the legend. */
export function SegmentMeter({ items, legend, ariaLabel }: {
  items: { key: string; color: string; title: string }[]; legend: { label: string; color: string; count: number }[]; ariaLabel: string;
}) {
  const { tip, show, hide } = useTip();
  return (
    <div className="chart" onMouseLeave={hide}>
      <div className="meter tall" role="img" aria-label={ariaLabel}>
        {items.map(item => (
          <span key={item.key} tabIndex={0} style={{ flex: 1, background: item.color }}
            onMouseMove={event => show(event, { title: item.title, value: '', color: item.color })}
            onFocus={event => show(event, { title: item.title, value: '', color: item.color })} onBlur={hide} />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 12 }}>
        {legend.filter(item => item.count > 0).map(item => (
          <span key={item.label} className="legend-item"><span className="legend-swatch" style={{ background: item.color }} />{item.label} <strong>{item.count}</strong></span>
        ))}
      </div>
      {tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y }}><span className="row">{tip.color && <span className="key" style={{ background: tip.color }} />}{tip.title}</span></div>}
    </div>
  );
}

/** Status colors for charts (validated set on white). */
export const STATUS_COLORS: Record<string, string> = {
  done: 'var(--st-good)', approved: 'var(--st-good)', exceptions: 'var(--st-warning)', failed: 'var(--st-critical)',
  rejected: 'var(--st-critical)', running: 'var(--st-info)', awaiting_approval: 'var(--st-gate)', pending: 'var(--surface-3)',
  skipped: '#e4dddd',
};
