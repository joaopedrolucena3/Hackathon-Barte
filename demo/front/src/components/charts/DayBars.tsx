// Daily inflow (up) and outflow (down) about a zero baseline. Two series → legend + per-day tooltip.
import { useLayoutEffect, useRef, useState } from 'react';
import { dateBR, moneyShort } from '../../lib/format';

export function DayBars({ days, height = 150, ariaLabel }: { days: { date: string; in_brl: string; out_brl: string }[]; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const maxIn = Math.max(...days.map(day => Number(day.in_brl)), 0);
  const maxOut = Math.max(...days.map(day => Number(day.out_brl)), 0);
  const total = maxIn + maxOut || 1;
  const top = 14, bottom = 18, plot = height - top - bottom;
  const zero = top + (plot * maxIn) / total;
  const left = 4, band = (width - left) / Math.max(days.length, 1);
  const bar = Math.min(14, band * 0.62);
  const scale = plot / total;
  const active = hover !== null ? days[hover] : null;

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-1)' }} />Entradas</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-2)' }} />Saídas</span>
      </div>
      <svg height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--axis)" strokeWidth={1} />
        {days.map((day, index) => {
          const x = left + band * index + (band - bar) / 2;
          const up = Number(day.in_brl) * scale, down = Number(day.out_brl) * scale;
          const label = Number(day.date.slice(8, 10));
          return (
            <g key={day.date} className="bar-group" tabIndex={0} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}>
              <rect className="hit" x={left + band * index} y={top} width={band} height={plot} />
              {up > 0 && <path className="bar" d={roundedUp(x, zero - 1, bar, Math.max(up - 1, 1))} fill="var(--series-1)" />}
              {down > 0 && <path className="bar" d={roundedDown(x, zero + 1, bar, Math.max(down - 1, 1))} fill="var(--series-2)" />}
              {(index === 0 || label % 5 === 0) && <text className="axis-label" x={x + bar / 2} y={height - 4} textAnchor="middle">{label}</text>}
            </g>
          );
        })}
      </svg>
      {active && hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(left + band * hover + band / 2, 70), width - 70), top: top + 4 }}>
          <span className="row" style={{ color: '#fff', fontWeight: 600 }}>{dateBR(active.date)}</span>
          <span className="row"><span className="key" style={{ background: 'var(--series-1)' }} />Entradas <strong style={{ display: 'inline', fontSize: 12.5 }}>{moneyShort(active.in_brl)}</strong></span>
          <span className="row"><span className="key" style={{ background: 'var(--series-2)' }} />Saídas <strong style={{ display: 'inline', fontSize: 12.5 }}>{moneyShort(active.out_brl)}</strong></span>
        </div>
      )}
    </div>
  );
}

/** Column growing up from the baseline with a 4px rounded data end. */
export function roundedUp(x: number, base: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`;
}

export function roundedDown(x: number, base: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${base} V${base + h - r} Q${x},${base + h} ${x + r},${base + h} H${x + w - r} Q${x + w},${base + h} ${x + w},${base + h - r} V${base} Z`;
}
