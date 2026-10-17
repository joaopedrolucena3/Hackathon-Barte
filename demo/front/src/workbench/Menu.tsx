// Small fixed-position menu (cell and header menus). Closes on outside click, Escape, scroll or resize.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export interface MenuItem { label: string; icon?: IconName; hint?: string; onSelect: () => void; disabled?: boolean; tone?: 'accent' }

export function Menu({ x, y, title, items, onClose, children }: { x: number; y: number; title?: string; items: MenuItem[]; onClose: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y]);
  useEffect(() => {
    const close = (event: Event) => { if (!(event.target instanceof Node && ref.current?.contains(event.target))) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="wb-menu" role="menu" style={position}>
      {title && <p className="wb-menu-title">{title}</p>}
      {children}
      {items.map(item => (
        <button key={item.label} type="button" role="menuitem" className={`wb-menu-item ${item.tone || ''}`} disabled={item.disabled}
          onClick={() => { onClose(); item.onSelect(); }}>
          {item.icon ? <Icon name={item.icon} size={14} /> : <span style={{ width: 14 }} />}
          <span className="grow">{item.label}</span>
          {item.hint && <span className="muted">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
