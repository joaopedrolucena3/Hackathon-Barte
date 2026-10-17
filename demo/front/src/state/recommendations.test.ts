import { describe, expect, it, vi } from 'vitest';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { refreshAfterRecommendations } from './recommendations';

describe('refresh after applying recommendations', () => {
  it('waits for the visible result but does not wait for heavy background queries', async () => {
    const finish = new Map<string, () => void>();
    const invalidateQueries = vi.fn(({ queryKey, refetchType }: { queryKey: QueryKey; refetchType?: string }) => {
      if (refetchType === 'none') return Promise.resolve();
      return new Promise<void>(resolve => { finish.set(String(queryKey[0]), resolve); });
    });
    const refetchQueries = vi.fn(() => new Promise<void>(() => {}));
    const client = { invalidateQueries, refetchQueries } as unknown as Pick<QueryClient, 'invalidateQueries' | 'refetchQueries'>;
    let settled = false;
    const refresh = refreshAfterRecommendations(client, 'run-1').then(() => { settled = true; });
    expect([...finish.keys()]).toEqual(['recommendations', 'approval', 'run']);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['state'], refetchType: 'none' });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['exceptions', 'run-1'], refetchType: 'none' });
    expect(refetchQueries).not.toHaveBeenCalled();
    finish.get('recommendations')!(); finish.get('approval')!();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish.get('run')!();
    await refresh;
    expect(settled).toBe(true);
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: ['state'], type: 'active' }, { cancelRefetch: false });
    expect(refetchQueries).toHaveBeenCalledTimes(6);
  });
});
