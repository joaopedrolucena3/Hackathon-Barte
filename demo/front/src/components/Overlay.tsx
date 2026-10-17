import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

// Only the top-most overlay reacts to Escape (a modal opened from a sheet closes first).
const stack: symbol[] = [];

function useOverlay(onClose: () => void, focusFirstField = true) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const id = Symbol('overlay');
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stack[stack.length - 1] === id) close.current();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Sheets keep their scroll at the top: focus the panel itself unless a field asks for autofocus.
    if (!ref.current?.contains(document.activeElement)) {
      const first = focusFirstField ? ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea') : null;
      (first || ref.current)?.focus({ preventScroll: true });
    }
    return () => {
      stack.splice(stack.indexOf(id), 1);
      document.removeEventListener('keydown', onKey);
      if (!stack.length) document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, []);
  return ref;
}

interface OverlayProps {
  title: ReactNode;
  sub?: ReactNode;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
}

/** Side panel: drill-downs (Comissões, Divergências), editors and details without leaving the page. */
export function Sheet({ title, sub, eyebrow, onClose, children, footer, headerExtra, narrow }: OverlayProps & { narrow?: boolean }) {
  const ref = useOverlay(onClose, false);
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div ref={ref} className={`sheet ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="sheet-head">
          <div className="grow">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 className="overlay-title">{title}</h2>
            {sub && <p className="overlay-sub">{sub}</p>}
          </div>
          {headerExtra}
          <button type="button" className="icon-btn" data-close onClick={onClose} aria-label="Fechar painel"><Icon name="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Modal({ title, sub, eyebrow, onClose, children, footer, wide }: OverlayProps & { wide?: boolean }) {
  const ref = useOverlay(onClose);
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-head">
          <div className="grow">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 className="overlay-title">{title}</h2>
            {sub && <p className="overlay-sub">{sub}</p>}
          </div>
          <button type="button" className="icon-btn" data-close onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
