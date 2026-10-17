// Real persistence is the default. Demo data requires VITE_AGENT_API=mock explicitly.
import type { AgentApi } from './contract';
import { httpAgent } from './http';
import { mockAgent } from './mock';

export const agent: AgentApi = import.meta.env.VITE_AGENT_API === 'mock' ? mockAgent : httpAgent;
export * from './contract';
