// VITE_AGENT_API=http switches to the real endpoints; the screens do not change.
import type { AgentApi } from './contract';
import { httpAgent } from './http';
import { mockAgent } from './mock';

export const agent: AgentApi = import.meta.env.VITE_AGENT_API === 'http' ? httpAgent : mockAgent;
export * from './contract';
