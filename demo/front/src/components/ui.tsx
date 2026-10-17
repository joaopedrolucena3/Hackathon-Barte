import { useState, type ReactNode } from 'react';
import type { Status } from '../api/agent';
import { count, dateBR, money, percent, pp, shortHash, shortRunId } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { NumberTicker } from './motion';

type Tone = 'neutral' | 'good' | 'warning' | 'critical' | 'info' | 'gate' | 'accent';

export const STATUS: Record<Status, { label: string; tone: Tone; icon: IconName }> = {
  pending: { label: 'Pendente', tone: 'neutral', icon: 'circle' },
  running: { label: 'Em andamento', tone: 'info', icon: 'refresh' },
  done: { label: 'Concluído', tone: 'good', icon: 'check' },
  exceptions: { label: 'Com exceções', tone: 'warning', icon: 'alert' },
  failed: { label: 'Falhou', tone: 'critical', icon: 'x' },
  awaiting_approval: { label: 'Aguardando aprovação', tone: 'gate', icon: 'pause' },
  approved: { label: 'Aprovado', tone: 'good', icon: 'check' },
  rejected: { label: 'Reprovado', tone: 'critical', icon: 'x' },
  skipped: { label: 'Pulado', tone: 'neutral', icon: 'minus' },
};

/** Status is always text + color, never color alone. */
export function StatusBadge({ status, label, size }: { status: Status; label?: string; size?: 'lg' }) {
  const meta = STATUS[status] || STATUS.pending;
  return (
    <span className={`badge ${meta.tone} ${size || ''}`}>
      {status === 'running' ? <span className="spin" aria-hidden /> : <span className="dot" aria-hidden />}
      {label || meta.label}
    </span>
  );
}

export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone | 'outline'; children: ReactNode; dot?: boolean }) {
  return <span className={`badge ${tone}`}>{dot && <span className="dot" aria-hidden />}{children}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'bloqueante') return <Badge tone="critical" dot>Bloqueante</Badge>;
  if (severity === 'informativo') return <Badge tone="info" dot>Informativo</Badge>;
  return <Badge tone="warning" dot>{severity === 'atencao' ? 'Atenção' : 'Alerta'}</Badge>;
}

const finite = (value: string | number | null | undefined) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/** `animate` counts up on first view (headline figures only); the resting text is always the exact value. */
export function Money({ value, className = '', animate }: { value: string | number | null | undefined; className?: string; animate?: boolean }) {
  const negative = Number(value) < 0;
  const classes = `nowrap ${negative ? 'neg' : ''} ${className}`;
  if (animate && finite(value)) return <NumberTicker value={Number(value)} format={money} className={classes} />;
  return <span className={`num ${classes}`}>{money(value)}</span>;
}

export const Percent = ({ value }: { value: string | number | null | undefined }) => <span className="num">{percent(value)}</span>;
export const PP = ({ value }: { value: string | number | null | undefined }) => <span className="num">{pp(value)}</span>;
export const DateBR = ({ value }: { value: string | null | undefined }) => <span className="num">{dateBR(value)}</span>;
export const Count = ({ value, animate }: { value: number | null | undefined; animate?: boolean }) =>
  animate && finite(value) ? <NumberTicker value={value!} format={n => count(Math.round(n))} /> : <span className="num">{count(value)}</span>;

export function HashChip({ hash, size = 6 }: { hash?: string | null; size?: number }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return <span className="muted">—</span>;
  return (
    <button
      type="button"
      className="hash-chip"
      title={`SHA-256 ${hash} · clique para copiar`}
      onClick={event => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(hash).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
      }}
    >
      <Icon name={copied ? 'check' : 'hash'} />
      {copied ? 'copiado' : shortHash(hash, size)}
    </button>
  );
}

/** Short run id that copies the full one: UUIDs are for audit, not for reading. */
export function RunId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="hash-chip run-id" title={`${id} · clique para copiar`}
      onClick={event => {
        event.stopPropagation();
        event.preventDefault();
        void navigator.clipboard?.writeText(id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
      }}>
      <Icon name={copied ? 'check' : 'hash'} />
      {copied ? 'copiado' : shortRunId(id).slice(1)}
    </button>
  );
}

/** B6 seal: next to any aggregate, opens the rows that compose it. */
export function OriginButton({ onClick, label = 'Ver origem' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="origin-btn" onClick={event => { event.stopPropagation(); onClick(); }} title={label} aria-label={label}>
      <Icon name="origin" />
    </button>
  );
}

export function Empty({ icon = 'check', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} /><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function Loading({ label = 'Carregando…', page }: { label?: string; page?: boolean }) {
  return <div className={`loading ${page ? 'page' : ''}`}><span className="spin" />{label}</div>;
}

export function Callout({ tone, icon = 'info', children }: { tone?: 'info' | 'warning' | 'critical' | 'good' | 'gate'; icon?: IconName; children: ReactNode }) {
  return <div className={`callout ${tone || ''}`}><Icon name={icon} /><div>{children}</div></div>;
}

export function Tip({ text, children }: { text: ReactNode; children: ReactNode }) {
  return <span className="tip">{children}<span className="tip-bubble" role="tooltip">{text}</span></span>;
}

export function Segmented<T extends string>({ value, options, onChange, size, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; size?: 'lg'; label?: string;
}) {
  return (
    <div className={`segmented ${size || ''}`} role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, items, onChange }: {
  value: T; items: { value: T; label: string; count?: number; icon?: IconName }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map(item => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value} className={`tab ${item.value === value ? 'active' : ''}`} onClick={() => onChange(item.value)}>
          {item.icon && <Icon name={item.icon} />}
          {item.label}
          {item.count !== undefined && <span className="count">{count(item.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="toggle" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Field({ label, help, children, wide, required }: { label: string; help?: ReactNode; children: ReactNode; wide?: boolean; required?: boolean }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span>{label}{required && ' *'}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export const QUICK_REASONS = ['Contrato assinado', 'Orientação do financeiro', 'Correção de digitação', 'Conferido na fonte original'];

/** Justification with one-click starters: the backend requires a reason for every change. */
export function ReasonInput({ value, onChange, required = true, suggestions = QUICK_REASONS, placeholder }: {
  value: string; onChange: (value: string) => void; required?: boolean; suggestions?: string[]; placeholder?: string;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="reason-chips">
        {suggestions.map(text => (
          <button key={text} type="button" className="reason-chip" aria-pressed={value.startsWith(text)} onClick={() => onChange(value.startsWith(text) ? value : `${text}${value ? ` · ${value}` : ''}`)}>{text}</button>
        ))}
      </div>
      <textarea className="textarea" value={value} required={required} placeholder={placeholder || 'Descreva o motivo da alteração'} onChange={event => onChange(event.target.value)} rows={2} />
    </div>
  );
}
