// The agent's state in one word, used to tint the run header. Decorative motion (count-up, shimmer, beams, orb) was removed.
import type { Status } from '../api/agent';

export type AgentMood = 'working' | 'waiting' | 'done' | 'failed' | 'idle';

export function moodOf(status: Status | 'queued' | undefined): AgentMood {
  if (status === 'running' || status === 'pending' || status === 'queued') return 'working';
  if (status === 'awaiting_approval') return 'waiting';
  if (status === 'failed' || status === 'rejected') return 'failed';
  if (status === 'done' || status === 'approved' || status === 'exceptions') return 'done';
  return 'idle';
}
