/**
 * Route chunk prefetching utility.
 *
 * Uses a runtime registry pattern: the prefetch map is populated externally
 * (from routePrefetchMap.ts) to avoid circular dependencies between
 * layout components and page components.
 *
 * When the user hovers a sidebar link, the matching chunk is preloaded
 * so navigation feels instant.
 *
 * Silent failures -- prefetching is best-effort and must never block UI.
 */

const routePrefetchMap = new Map<string, () => Promise<unknown>>();

/**
 * Register route prefetch loaders. Called once at app startup.
 */
export function registerPrefetchRoutes(routes: Record<string, () => Promise<unknown>>): void {
  for (const [path, loader] of Object.entries(routes)) {
    routePrefetchMap.set(path, loader);
  }
}

/**
 * Track which routes have already been prefetched to avoid duplicate work.
 */
const prefetched = new Set<string>();

/**
 * Trigger a dynamic import for the given route path.
 * No-op if the route is unknown or was already prefetched.
 */
export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return;

  const loader = routePrefetchMap.get(path);
  if (loader) {
    prefetched.add(path);
    loader().catch(() => {
      // Silent fail -- just prefetching; the user hasn't navigated yet.
      // Remove from set so a retry can happen on next hover.
      prefetched.delete(path);
    });
  }
}
