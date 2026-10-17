// Persistence of the mock backend (browser localStorage). Replaced by SQLite once the real endpoints exist.
import { loadJSON, saveJSON } from '../../../lib/storage';
import type { ChecklistTask, Pipeline, PipelineVersion, Run } from '../contract';

const KEYS = {
  runs: 'tarvo.mock.runs.v1',
  versions: 'tarvo.mock.pipeline.v1',
  checklist: 'tarvo.mock.checklist.v1',
  adjustments: 'tarvo.mock.adjustments.v1',
};

export function loadRuns(): Run[] {
  return loadJSON<Run[]>(KEYS.runs, []);
}

export function getStoredRun(id: string): Run | undefined {
  return loadRuns().find(run => run.id === id);
}

export function saveRun(run: Run) {
  const runs = loadRuns();
  const index = runs.findIndex(item => item.id === run.id);
  if (index >= 0) runs[index] = run; else runs.push(run);
  saveJSON(KEYS.runs, runs);
}

export function updateRun(id: string, change: (run: Run) => Run): Run {
  const run = getStoredRun(id);
  if (!run) throw new Error(`Run ${id} não encontrado.`);
  const next = change(run);
  saveRun(next);
  return next;
}

export function nextRunId() {
  const max = loadRuns().reduce((value, run) => Math.max(value, Number(run.id.replace(/\D/g, '')) || 0), 0);
  return `R-${String(max + 1).padStart(4, '0')}`;
}

export function loadVersions(): PipelineVersion[] {
  return loadJSON<PipelineVersion[]>(KEYS.versions, []);
}

export function saveVersion(version: PipelineVersion) {
  saveJSON(KEYS.versions, [...loadVersions(), version]);
}

export function latestPipeline(): Pipeline | undefined {
  const versions = loadVersions();
  return versions[versions.length - 1];
}

type TaskOverride = Partial<Pick<ChecklistTask, 'status' | 'owner' | 'comment' | 'updated_at' | 'updated_by'>>;

export function loadChecklistOverrides(): Record<string, TaskOverride> {
  return loadJSON<Record<string, TaskOverride>>(KEYS.checklist, {});
}

export function saveChecklistOverride(key: string, value: TaskOverride) {
  saveJSON(KEYS.checklist, { ...loadChecklistOverrides(), [key]: value });
}

/** Proposed amounts in "Ajustar" decisions: the backend does not store loose numbers (see CONTRACT.md). */
export interface AdjustmentNote { amount: string; before: string; before_account?: string; at: string }

export function loadAdjustments(): Record<string, AdjustmentNote> {
  return loadJSON<Record<string, AdjustmentNote>>(KEYS.adjustments, {});
}

export function saveAdjustment(id: string, value: AdjustmentNote | null) {
  const all = loadAdjustments();
  if (value) all[id] = value; else delete all[id];
  saveJSON(KEYS.adjustments, all);
}
