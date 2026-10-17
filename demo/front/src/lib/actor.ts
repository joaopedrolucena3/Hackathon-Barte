// The analyst name is declared (no login) and sent with every mutation, as the backend requires.
import { useSyncExternalStore } from 'react';

const KEY = 'tarvo-actor';
const listeners = new Set<() => void>();
let current = read();
let prompt: (() => Promise<string>) | null = null;

function read() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function getActor() {
  return current.trim();
}

export function setActor(name: string) {
  current = name;
  try { localStorage.setItem(KEY, name); } catch { /* storage may be disabled */ }
  listeners.forEach(listener => listener());
}

export function useActor(): [string, (name: string) => void] {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current);
  return [value, setActor];
}

/** Registered by <ActorPromptHost/>: asks for the name once when an action needs it. */
export function registerActorPrompt(fn: (() => Promise<string>) | null) {
  prompt = fn;
}

export async function ensureActor(): Promise<string> {
  const name = getActor();
  if (name) return name;
  if (!prompt) throw new Error('Informe seu nome em “Responsável” antes de registrar uma ação.');
  const entered = (await prompt()).trim();
  if (!entered) throw new Error('Informe seu nome para registrar a ação.');
  setActor(entered);
  return entered;
}
