import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from '../components/Toast';

/** Runs a mutation with busy state, success toast and cache invalidation; errors become toasts. */
export function useAction() {
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, options: { success?: string; invalidate?: QueryKey[]; rethrow?: boolean } = {}) {
    setBusy(key);
    try {
      const result = await fn();
      await Promise.all((options.invalidate || []).map(queryKey => client.invalidateQueries({ queryKey })));
      if (options.success) toast.ok(options.success);
      return result;
    } catch (error) {
      if (options.rethrow) throw error;
      toast.error(error);
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy };
}
