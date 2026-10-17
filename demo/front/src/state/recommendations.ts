import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { keys } from './queries';

/** Refresh the visible decision result first; other active screens update afterwards. */
export async function refreshAfterRecommendations(client: Pick<QueryClient, 'invalidateQueries' | 'refetchQueries'>, runId: string) {
  const visible: QueryKey[] = [keys.recommendations(runId), keys.approval(runId), keys.run(runId)];
  const background: QueryKey[] = [keys.exceptions(runId), keys.audit(runId), keys.state, ['checklist'], ['insights'], ['runs']];
  // Inactive views must reload on their next mount, without fetching their datasets now.
  for (const queryKey of background) void client.invalidateQueries({ queryKey, refetchType: 'none' });
  await Promise.all(visible.map(queryKey => client.invalidateQueries({ queryKey })));
  // The persistent shell can still have active state queries. Keep it current without
  // making the decision confirmation wait for the complete financial dataset.
  for (const queryKey of background) void client.refetchQueries({ queryKey, type: 'active' }, { cancelRefetch: false });
}
