// Applies live run events (SSE) to a run. Shared by the UI cache and the mock backend so both agree.
import type { Run, RunEvent, Status, StepRun } from '../api/agent/contract';

export const FINISHED: Status[] = ['done', 'exceptions', 'failed', 'skipped', 'approved', 'rejected'];

function updateStep(run: Run, stepId: string, change: (step: StepRun) => StepRun): Run {
  return { ...run, steps: run.steps.map(step => (step.id === stepId ? change(step) : step)) };
}

export function applyRunEvent(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case 'step_started':
      return {
        ...updateStep(run, event.step_id, step => ({
          ...step, status: 'running', started_at: event.at, finished_at: undefined, error: undefined,
          metrics: { ...step.metrics, progress: undefined },
        })),
        status: 'running',
      };
    case 'step_progress':
      return updateStep(run, event.step_id, step => ({
        ...step, metrics: { ...step.metrics, progress: { done: event.done, total: event.total } },
      }));
    case 'step_finished': {
      let next = updateStep(run, event.step_id, step => ({
        ...step, status: event.status, finished_at: event.at, duration_ms: event.duration_ms,
        metrics: { ...event.metrics, progress: undefined }, output_hash: event.output_hash ?? step.output_hash, error: event.error,
      }));
      if (event.status === 'failed') {
        next = { ...next, steps: next.steps.map(step => (step.status === 'pending' ? { ...step, status: 'skipped' } : step)) };
      }
      return next;
    }
    case 'awaiting_approval':
      return {
        ...run,
        status: 'awaiting_approval',
        steps: run.steps.map(step => (step.kind === 'gate' && !FINISHED.includes(step.status)
          ? { ...step, status: 'awaiting_approval', metrics: { ...step.metrics, exceptions: event.exceptions, blocking: event.blocking } }
          : step)),
      };
    case 'run_finished':
      return { ...run, status: event.status, finished_at: event.at };
  }
}

export function progressOf(run: Pick<Run, 'steps'>) {
  const total = run.steps.length;
  const done = run.steps.filter(step => FINISHED.includes(step.status)).length;
  return { done, total, ratio: total ? done / total : 0 };
}
