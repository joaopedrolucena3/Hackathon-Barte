import { useEffect, useRef, useState } from 'react';
import { registerActorPrompt } from '../lib/actor';
import { Modal } from './Overlay';

/** Asks once for the analyst name when an action needs it (no login; the name is declared). */
export function ActorPromptHost() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const resolver = useRef<{ resolve: (value: string) => void; reject: (error: Error) => void } | null>(null);

  useEffect(() => {
    registerActorPrompt(() => new Promise<string>((resolve, reject) => {
      resolver.current = { resolve, reject };
      setOpen(true);
    }));
    return () => registerActorPrompt(null);
  }, []);

  if (!open) return null;
  const close = (value?: string) => {
    setOpen(false);
    if (value?.trim()) resolver.current?.resolve(value.trim());
    else resolver.current?.reject(new Error('Ação cancelada: informe seu nome para registrar decisões.'));
    resolver.current = null;
  };
  return (
    <Modal
      title="Quem está registrando esta ação?"
      sub="Sem login nesta versão: o nome declarado fica na auditoria de cada decisão."
      onClose={() => close()}
      footer={<><button type="button" className="btn ghost" onClick={() => close()}>Cancelar</button><button type="submit" form="actor-form" className="btn primary">Continuar</button></>}
    >
      <form id="actor-form" onSubmit={event => { event.preventDefault(); close(name); }}>
        <label className="field">
          <span>Seu nome</span>
          <input className="input" autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={100} autoComplete="name" placeholder="Ex.: Ana Souza" />
        </label>
      </form>
    </Modal>
  );
}
