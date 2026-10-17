// One series over days (chat answers of kind "serie_diaria"): thin columns from a zero baseline, 4px rounded
// data end, day numbers on the axis and a tooltip with the exact value the server formatted.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatChartItem } from '../api/chat';
import { roundedDown, roundedUp } from '../components/charts/DayBars';
import { dateBR } from '../lib/format';

export function DailyColumns({ items, height = 140, ariaLabel }: { items: ChatChartItem[]; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  // Geometry only; every label shows the server's exact text.
  const values = items.map(item => Number(item.valor));
  const max = Math.max(...values, 0), min = Math.min(...values, 0);
  const top = 10, bottom = 18, plot = height - top - bottom;
  const span = max - min || 1;
  const zero = top + (plot * max) / span;
  const left = 2, band = (width - left) / Math.max(items.length, 1);
  const bar = Math.min(14, band * 0.62);
  const every = Math.max(1, Math.ceil(items.length / 10));
  const active = hover !== null ? items[hover] : null;
  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--axis)" strokeWidth={1} />
        {items.map((item, index) => {
          const x = left + band * index + (band - bar) / 2;
          const size = (Math.abs(values[index]) * plot) / span;
          const day = item.data ? Number(item.data.slice(8, 10)) : index + 1;
          return (
            <g key={item.data || index} className="bar-group" tabIndex={0} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}>
              <rect className="hit" x={left + band * index} y={top} width={band} height={plot} />
              {size > 0 && <path className="bar" fill="var(--series-1)"
                d={values[index] >= 0 ? roundedUp(x, zero - 1, bar, Math.max(size - 1, 1)) : roundedDown(x, zero + 1, bar, Math.max(size - 1, 1))} />}
              {index % every === 0 && <text className="axis-label" x={x + bar / 2} y={height - 4} textAnchor="middle">{day}</text>}
            </g>
          );
        })}
      </svg>
      {active && hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(left + band * hover + band / 2, 70), width - 70), top: top + 4 }}>
          <strong>{active.formatado}</strong>
          <span className="row">{active.data ? dateBR(active.data) : active.rotulo}</span>
        </div>
      )}
    </div>
  );
}
