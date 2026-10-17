import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type Toast = { id: number; message: string; error?: boolean };
const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems(list => [...list.slice(-2), { id, message, error }]);
    setTimeout(() => setItems(list => list.filter(item => item.id !== id)), error ? 8000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(item => (
          <div key={item.id} className={`toast ${item.error ? 'error' : ''}`}>
            <Icon name={item.error ? 'alert' : 'check'} />
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    ok: (message: string) => push(message),
    error: (error: unknown) => push(error instanceof Error ? error.message : String(error), true),
  };
}
