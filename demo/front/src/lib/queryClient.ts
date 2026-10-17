import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

declare global {
  const __CODE_VERSION__: string;
}

export const CODE_VERSION = typeof __CODE_VERSION__ === 'string' ? __CODE_VERSION__ : 'local';
