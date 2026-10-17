import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Lets a page place its context (competência, run) in the shared top bar. */
export function TopbarSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.getElementById('topbar-context')), []);
  return target ? createPortal(children, target) : null;
}
