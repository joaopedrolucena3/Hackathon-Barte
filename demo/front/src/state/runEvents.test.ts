import { describe, expect, it } from 'vitest';
import type { Run, StepRun } from '../api/agent/contract';
import { applyRunEvent, progressOf } from './runEvents';

const step = (id: string, kind: StepRun['kind'] = 'calc'): StepRun => ({
  id, type: id, title: id, kind, status: 'pending', metrics: {}, params: {}, code_version: 'abc1234',
});

const run = (): Run => ({
  id: 'R-0001', comp: '2026-09', status: 'pending', created_at: '2026-10-17T12:00:00Z', created_by: 'Ana', source: 'pack',
  code_version: 'abc1234', pipeline: { id: 'fechamento-tarvo', name: 'fechamento-tarvo', version: 1 }, files: [],
  steps: [step('ler'), step('conferir'), step('aprovacao', 'gate'), step('exportar', 'export')],
});

describe('applyRunEvent', () => {
  it('moves a step through running, progress and finished', () => {
    let state = applyRunEvent(run(), { type: 'step_started', step_id: 'ler', at: 't1' });
    expect(state.status).toBe('running');
    expect(state.steps[0].status).toBe('running');
    state = applyRunEvent(state, { type: 'step_progress', step_id: 'ler', done: 800, total: 1943 });
    expect(state.steps[0].metrics.progress).toEqual({ done: 800, total: 1943 });
    state = applyRunEvent(state, { type: 'step_finished', step_id: 'ler', status: 'exceptions', at: 't2', duration_ms: 400, metrics: { rows_out: 1943, exceptions: 37 }, output_hash: 'ff' });
    expect(state.steps[0]).toMatchObject({ status: 'exceptions', duration_ms: 400, output_hash: 'ff', metrics: { exceptions: 37 } });
    expect(state.steps[0].metrics.progress).toBeUndefined();
    expect(progressOf(state)).toMatchObject({ done: 1, total: 4 });
  });

  it('skips the remaining steps after a failure', () => {
    const state = applyRunEvent(run(), { type: 'step_finished', step_id: 'ler', status: 'failed', at: 't', duration_ms: 1, metrics: {}, error: 'Arquivo faltando' });
    expect(state.steps.map(s => s.status)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
  });

  it('puts the gate and the run on hold for approval', () => {
    const state = applyRunEvent(run(), { type: 'awaiting_approval', exceptions: 52, blocking: 3 });
    expect(state.status).toBe('awaiting_approval');
    expect(state.steps[2]).toMatchObject({ status: 'awaiting_approval', metrics: { exceptions: 52, blocking: 3 } });
    expect(state.steps[3].status).toBe('pending');
  });

  it('does not mutate the previous state', () => {
    const before = run();
    applyRunEvent(before, { type: 'step_started', step_id: 'ler', at: 't' });
    expect(before.steps[0].status).toBe('pending');
  });
});
