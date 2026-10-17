import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { agent, type PreviewQuery, type Run, type RunEvent } from '../api/agent';
import { core } from '../api/core';
import { loadJSON, saveJSON } from '../lib/storage';
import { applyRunEvent } from './runEvents';

export const keys = {
  state: ['state'] as const,
  comps: ['competencias'] as const,
  insights: (comp: string) => ['insights', comp] as const,
  checklist: (comp: string) => ['checklist', comp] as const,
  runs: (comp?: string) => ['runs', comp || 'all'] as const,
  run: (id: string) => ['run', id] as const,
  runAccounts: (id: string) => ['run-accounts', id] as const,
  preview: (runId: string, stepId: string, query?: PreviewQuery) => ['preview', runId, stepId, ...(query ? [query] : [])] as const,
  exceptions: (runId: string) => ['exceptions', runId] as const,
  approval: (runId: string) => ['approval', runId] as const,
  audit: (runId: string) => ['audit', runId] as const,
  catalog: ['catalog'] as const,
  pipeline: (version?: number) => ['pipeline', version || 'latest'] as const,
  versions: ['pipeline-versions'] as const,
  trace: (id: string) => ['trace', id] as const,
};

export const useAppState = () => useQuery({ queryKey: keys.state, queryFn: core.state, staleTime: 15_000 });
export const useCompetencias = () => useQuery({ queryKey: keys.comps, queryFn: agent.listCompetencias });
export const useInsights = (comp: string) => useQuery({ queryKey: keys.insights(comp), queryFn: () => agent.getInsights(comp), enabled: !!comp });
export const useChecklist = (comp: string) => useQuery({ queryKey: keys.checklist(comp), queryFn: () => agent.getChecklist(comp), enabled: !!comp });
export const useRuns = (comp?: string) => useQuery({ queryKey: keys.runs(comp), queryFn: () => agent.listRuns(comp) });
export const useRun = (id: string) => useQuery({ queryKey: keys.run(id), queryFn: () => agent.getRun(id), enabled: !!id, staleTime: 0 });
export const useRunAccounts = (id: string) => useQuery({ queryKey: keys.runAccounts(id), queryFn: () => agent.getRunAccounts(id), enabled: !!id, staleTime: Infinity });
export const useExceptions = (runId: string, enabled = true) =>
  useQuery({ queryKey: keys.exceptions(runId), queryFn: () => agent.listExceptions(runId), enabled: !!runId && enabled });
export const useApprovalSummary = (runId: string, enabled = true) =>
  useQuery({ queryKey: keys.approval(runId), queryFn: () => agent.getApprovalSummary(runId), enabled: !!runId && enabled });
export const useAudit = (runId: string) => useQuery({ queryKey: keys.audit(runId), queryFn: () => agent.getAudit(runId), enabled: !!runId });
export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: agent.getCatalog, staleTime: Infinity });
export const usePipeline = (version?: number) => useQuery({ queryKey: keys.pipeline(version), queryFn: () => agent.getPipeline(version) });
export const usePipelineVersions = () => useQuery({ queryKey: keys.versions, queryFn: agent.listPipelineVersions });
export const useTrace = (id: string | null) => useQuery({ queryKey: keys.trace(id || ''), queryFn: () => core.trace(id!), enabled: !!id });

export function usePreview(runId: string | undefined, stepId: string | undefined, query: PreviewQuery, enabled = true) {
  return useQuery({
    queryKey: keys.preview(runId || '', stepId || '', query),
    queryFn: () => agent.getPreview(runId!, stepId!, query),
    enabled: !!runId && !!stepId && enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** Live run events (SSE) feed the query cache; a reconnect reloads the consolidated run. */
export function useRunEvents(runId: string, onEvent?: (event: RunEvent) => void) {
  const client = useQueryClient();
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!runId) return;
    const invalidate = (...list: QueryKey[]) => list.forEach(queryKey => void client.invalidateQueries({ queryKey }));
    return agent.subscribeRun(runId, event => {
      client.setQueryData<Run>(keys.run(runId), run => (run ? applyRunEvent(run, event) : run));
      if (event.type === 'step_finished') invalidate(['preview', runId, event.step_id], keys.exceptions(runId), keys.approval(runId));
      if (event.type === 'awaiting_approval' || event.type === 'run_finished' || event.type === 'step_finished') {
        invalidate(['checklist'], ['runs'], keys.audit(runId), ['insights']);
      }
      if (event.type === 'awaiting_approval') invalidate(keys.run(runId), keys.exceptions(runId), keys.approval(runId));
      if (event.type === 'run_finished') invalidate(keys.run(runId), keys.state);
      handler.current?.(event);
    }, () => invalidate(keys.run(runId), ['preview', runId], keys.exceptions(runId), keys.approval(runId), keys.audit(runId), ['checklist'], ['runs'], ['insights'], keys.state));
  }, [runId, client]);
}

/** Last competência the user looked at, so the nav keeps context. */
const COMP_KEY = 'tarvo.comp';
export function rememberComp(comp: string) { saveJSON(COMP_KEY, comp); }
export function lastComp(fallback: string) { return loadJSON<string>(COMP_KEY, fallback) || fallback; }

export function useElapsed(from?: string, to?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!from || to) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [from, to]);
  if (!from) return 0;
  return (to ? new Date(to).getTime() : now) - new Date(from).getTime();
}
