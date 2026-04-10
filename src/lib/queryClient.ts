import { QueryClient } from "@tanstack/react-query";

/**
 * Singleton QueryClient for the entire app.
 * Exported so it can be used for cache clearing on logout.
 *
 * Default configuration (PERF-10):
 *   staleTime:  2 min  — reduces aggressive refetches while keeping data fresh
 *   gcTime:    10 min  — prevents memory leaks from orphaned queries
 *   retry:      2      — tolerates transient network failures
 *   refetchOnWindowFocus: false — realtime sync handles live updates
 *
 * Per-query overrides:
 *   - Realtime-backed queries (presence, planning, badges): staleTime: 0
 *     (realtime pushes updates, so we always want to refetch when re-mounted)
 *   - Static/rarely-changing data (permissions, cutoff, settings): staleTime: 10 min
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes default
      gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
      retry: 2, // retry failed queries twice
      refetchOnWindowFocus: false, // disabled — realtime sync handles live updates
    },
  },
});
