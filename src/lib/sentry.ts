/**
 * Lazy Sentry wrapper — prevents @sentry/react from entering the initial bundle.
 *
 * All calls are safe no-ops until the SDK is loaded via dynamic import in main.tsx.
 * If the SDK fails to load, the app continues to work without observability.
 *
 * Boot-path files (ErrorBoundary, AuthContext) import from here instead of @sentry/react.
 */

type SentryModule = typeof import("@sentry/react");

let _sentry: SentryModule | null = null;

/**
 * Called once from main.tsx after Sentry.init() succeeds.
 * From this point on, all wrapper functions delegate to the real SDK.
 */
export function setSentryModule(mod: SentryModule): void {
  _sentry = mod;
}

/**
 * Capture an exception — safe no-op before SDK is loaded.
 */
export function captureException(
  error: unknown,
  context?: { contexts?: Record<string, Record<string, string>> },
): void {
  if (_sentry) {
    _sentry.captureException(error, context);
  } else if (import.meta.env.DEV) {
    console.warn("[sentry-lazy] captureException called before SDK loaded:", error);
  }
}

/**
 * Set user context — safe no-op before SDK is loaded.
 */
export function setUser(user: { id: string; email?: string } | null): void {
  if (_sentry) {
    _sentry.setUser(user);
  }
}
