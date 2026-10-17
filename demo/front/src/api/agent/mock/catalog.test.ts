import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '../contract';
import { defaultSteps, validateSteps } from './catalog';

const move = (steps: PipelineStep[], type: string, to: number) => {
  const list = steps.filter(step => step.type !== type);
  list.splice(to, 0, steps.find(step => step.type === type)!);
  return list;
};

describe('pipeline validation (C1)', () => {
  it('accepts the default pipeline', () => {
    expect(validateSteps(defaultSteps('0.002'))).toEqual({ ok: true, issues: [] });
  });
  it('flags a step placed before its dependency', () => {
    const result = validateSteps(move(defaultSteps(), 'conferir_mdr', 0));
    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.message)).toContain('Precisa de “Normalizar Orbe” antes.');
  });
  it('flags a disabled dependency', () => {
    const steps = defaultSteps().map(step => (step.type === 'normalizar_orbe' ? { ...step, enabled: false } : step));
    expect(validateSteps(steps).issues.some(issue => issue.message === 'Precisa de “Normalizar Orbe” ligado.')).toBe(true);
  });
  it('keeps the human approval before the ERP export and never off', () => {
    const exportFirst = move(defaultSteps(), 'exportar_erp', 0);
    expect(validateSteps(exportFirst).issues.some(issue => issue.message.includes('depois da aprovação humana'))).toBe(true);
    const gateOff = defaultSteps().map(step => (step.type === 'aprovacao' ? { ...step, enabled: false } : step));
    expect(validateSteps(gateOff).issues.some(issue => issue.message.includes('não pode ser desligada'))).toBe(true);
    const noGate = defaultSteps().filter(step => step.type !== 'aprovacao');
    expect(validateSteps(noGate).ok).toBe(false);
  });
  it('checks numeric parameter ranges', () => {
    const steps = defaultSteps().map(step => (step.type === 'conferir_mdr' ? { ...step, params: { ...step.params, tolerancia_pp: 5 } } : step));
    expect(validateSteps(steps).issues).toEqual([expect.objectContaining({ field: 'tolerancia_pp', message: 'Tolerância de taxa: máximo 1.' })]);
  });
});
