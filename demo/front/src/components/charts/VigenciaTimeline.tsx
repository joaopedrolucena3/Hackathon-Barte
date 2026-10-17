// Contracted rates as a timeline per product: one row per product, one bar per vigência.
// The vigência in force during the competência is emphasized; gaps and overlaps are marked with text.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Rate } from '../../api/types';
import { dateBR, percent, productNames } from '../../lib/format';

const DAY = 86_400_000;
const ORDER = ['DEBITO', 'CREDITO_A_VISTA', 'CREDITO_2_6', 'CREDITO_7_12', 'PIX', 'ANTECIPACAO', 'REMESSA'];
const toTime = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const monthStart = (time: number, offset = 0) => { const d = new Date(time); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1); };

export interface TimelineIssue { product: string; kind: 'gap' | 'overlap'; from: string; to: string }

export function rateIssues(rates: Rate[]): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  for (const product of new Set(rates.map(rate => rate.product))) {
    const list = rates.filter(rate => rate.product === product).sort((a, b) => (a.start || '0000').localeCompare(b.start || '0000'));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], next = list[i];
      if (!prev.end) { issues.push({ product, kind: 'overlap', from: next.start, to: next.end || '' }); continue; }
      if (!next.start) continue;
      const gap = (toTime(next.start) - toTime(prev.end)) / DAY;
      if (gap > 1) issues.push({ product, kind: 'gap', from: new Date(toTime(prev.end) + DAY).toISOString().slice(0, 10), to: new Date(toTime(next.start) - DAY).toISOString().slice(0, 10) });
      if (gap < 1) issues.push({ product, kind: 'overlap', from: next.start, to: prev.end });
    }
  }
  return issues;
}

export function VigenciaTimeline({ rates, period, selected, onSelect, onAdd }: {
  rates: Rate[]; period: string; selected?: string | null; onSelect: (rate: Rate) => void; onAdd: (product: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const periodStart = toTime(`${period}-01`), periodEnd = monthStart(periodStart, 1) - DAY;
  const { from, to, months } = useMemo(() => {
    const times = rates.flatMap(rate => [rate.start, rate.end]).filter(Boolean).map(toTime);
    let start = monthStart(Math.min(periodStart, ...times), -1);
    let end = monthStart(Math.max(periodEnd, ...times), 2);
    if (end - start < 300 * DAY) { start = monthStart(periodStart, -6); end = monthStart(periodStart, 6); }
    const list: number[] = [];
    for (let m = start; m < end; m = monthStart(m, 1)) list.push(m);
    return { from: start, to: end, months: list };
  }, [rates, periodStart, periodEnd]);
  const x = (time: number) => ((time - from) / (to - from)) * 100;
  const issues = rateIssues(rates);
  const products = ORDER.filter(product => rates.some(rate => rate.product === product)).concat(
    [...new Set(rates.map(rate => rate.product))].filter(product => !ORDER.includes(product)));
  const step = Math.max(1, Math.ceil(months.length / Math.max(width / 70, 1)));

  return (
    <div className="timeline" ref={ref}>
      <div className="timeline-grid">
        <div />
        <div className="timeline-axis">
          <span className="timeline-period" style={{ left: `${x(periodStart)}%`, width: `${x(periodEnd + DAY) - x(periodStart)}%` }} title="Competência em análise" />
          {months.map((month, index) => index % step === 0 && (
            <span key={month} className="timeline-tick" style={{ left: `${x(month)}%` }}>
              {new Date(month).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('. de ', '/').replace(' de ', '/')}
            </span>
          ))}
        </div>
        {products.map(product => {
          const list = rates.filter(rate => rate.product === product);
          return (
            <div key={product} style={{ display: 'contents' }}>
              <div className="timeline-label">
                <span>{productNames[product] || product}</span>
                <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => onAdd(product)} aria-label={`Nova vigência de ${productNames[product] || product}`} title="Nova vigência">+</button>
              </div>
              <div className="timeline-row">
                <span className="timeline-period" style={{ left: `${x(periodStart)}%`, width: `${x(periodEnd + DAY) - x(periodStart)}%` }} />
                {issues.filter(issue => issue.product === product && issue.kind === 'gap').map(issue => (
                  <span key={issue.from} className="timeline-gap" style={{ left: `${x(toTime(issue.from))}%`, width: `${x(toTime(issue.to) + DAY) - x(toTime(issue.from))}%` }}
                    title={`Lacuna: sem taxa de ${dateBR(issue.from)} a ${dateBR(issue.to)}`} />
                ))}
                {list.map(rate => {
                  const start = rate.start ? toTime(rate.start) : from;
                  const end = rate.end ? toTime(rate.end) + DAY : to;
                  const left = x(start), size = Math.max(x(end) - left, 0.6);
                  const active = start <= periodEnd && end > periodStart;
                  const overlap = issues.some(issue => issue.product === product && issue.kind === 'overlap' && (issue.from === rate.start || issue.to === rate.end));
                  const px = (size / 100) * (width - 170);
                  return (
                    <button key={rate.id} type="button"
                      className={`timeline-bar ${active ? 'active' : ''} ${selected === rate.id ? 'selected' : ''} ${overlap ? 'overlap' : ''} ${!rate.start ? 'open-start' : ''} ${!rate.end ? 'open-end' : ''}`}
                      style={{ left: `${left}%`, width: `${size}%` }}
                      onClick={() => onSelect(rate)}
                      title={`${productNames[product] || product}: ${percent(rate.rate_pct)} · ${rate.start ? dateBR(rate.start) : 'sem início'} → ${rate.end ? dateBR(rate.end) : 'em aberto'}`}
                      aria-label={`${productNames[product] || product}, ${percent(rate.rate_pct)}, de ${rate.start ? dateBR(rate.start) : 'sem início'} a ${rate.end ? dateBR(rate.end) : 'em aberto'}`}>
                      {px > 46 && percent(rate.rate_pct)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend" style={{ marginTop: 12 }}>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--series-1)' }} />Vigente na competência</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: '#a9bdf0' }} />Outras vigências</span>
        <span className="legend-item"><span className="legend-swatch timeline-gap-swatch" />Lacuna sem taxa</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: 'var(--accent-wash)', border: '1px solid var(--accent)' }} />Competência {period.split('-').reverse().join('/')}</span>
      </div>
    </div>
  );
}
