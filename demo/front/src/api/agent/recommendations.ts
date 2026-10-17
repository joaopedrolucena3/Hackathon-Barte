import { agent } from './index';
import { ApiError, getJSON, sendAuthorizedJSON } from '../http';
import type { Assumption } from '../types';

export interface RecommendationEvidence {
  arquivo?: string; arquivo_origem?: string; source_file?: string;
  linha?: number; source_row?: number; physical_row?: number;
  ref?: string; ref_origem?: string; source_ref?: string;
  source_sha256?: string;
}
export interface Recommendation {
  id: string;
  exception_id: string;
  kind: string;
  title: string;
  severity: string;
  fact: string;
  rule: string;
  assumption_ids: string[];
  evidence: RecommendationEvidence[];
  suggested_action: 'accept' | 'wait';
  eligible: boolean;
  reason: string;
  effect: string;
  owner: string;
  missing_evidence: string[];
  follow_up: string;
  exposure_brl: string | null;
  status: 'open' | 'decided';
  ineligible_reason: string;
}
export interface RecommendationPreview {
  run_id: string;
  policy_version: string | null;
  snapshot_status: 'captured' | 'legacy_unavailable';
  can_apply: boolean;
  preview_token: string | null;
  assumptions: Assumption[];
  recommendations: Recommendation[];
  summary: { total: number; eligible: number; waiting: number; decided: number };
  effects: {
    entries_before: number | null; entries_after: number | null;
    debit_before: string | null; debit_after: string | null;
    credit_before: string | null; credit_after: string | null;
    balanced: boolean | null;
  };
}

export type RecommendationFilter = 'all' | 'eligible' | 'waiting' | 'decided';
export function isEligibleRecommendation(item: Recommendation): boolean {
  return item.eligible === true && item.status === 'open' && item.suggested_action === 'accept'
    && item.missing_evidence.length === 0 && !item.ineligible_reason;
}
export function filterRecommendations(items: Recommendation[], filter: RecommendationFilter, exceptionId?: string | null) {
  return items.filter(item => (!exceptionId || item.exception_id === exceptionId) && (
    filter === 'all' || filter === 'eligible' && isEligibleRecommendation(item)
    || filter === 'waiting' && item.status === 'open' && !isEligibleRecommendation(item)
    || filter === 'decided' && item.status === 'decided'
  ));
}
export function canApplyRecommendations(preview: RecommendationPreview): boolean {
  const eligible = preview.recommendations.filter(isEligibleRecommendation).length;
  return preview.snapshot_status === 'captured' && preview.can_apply === true && !!preview.preview_token
    && preview.effects.balanced === true && Object.values(preview.effects).every(value => value !== null)
    && eligible > 0 && eligible === preview.summary.eligible;
}
export function isStaleRecommendationPreview(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

const path = (runId: string) => `/api/runs/${encodeURIComponent(runId)}/recommendations`;
function requireLiveRun() {
  if (agent.mode !== 'http') throw new Error('Sugestões com evidências da execução estão disponíveis no modo conectado ao servidor.');
}
export const recommendationsApi = {
  async preview(runId: string): Promise<RecommendationPreview> {
    requireLiveRun();
    const preview = await getJSON<RecommendationPreview>(path(runId));
    if (preview.run_id !== runId || !Array.isArray(preview.recommendations) || !Array.isArray(preview.assumptions) || !preview.summary || !preview.effects) {
      throw new Error('Não foi possível confirmar as sugestões desta execução. Atualize a prévia.');
    }
    return preview;
  },
  async apply(runId: string, previewToken: string): Promise<{ applied: number; already_applied: boolean }> {
    requireLiveRun();
    if (!previewToken) throw new Error('Atualize e confira a prévia antes de aplicar as sugestões.');
    return sendAuthorizedJSON(`${path(runId)}/apply`, { preview_token: previewToken });
  },
};
