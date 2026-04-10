import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initRoutePrefetch } from "./lib/prefetch/routePrefetchMap";
import { setSentryModule } from "./lib/sentry";
import "./devTools";

// ── Route prefetch initialization ────────────────────────────────────
initRoutePrefetch();

// ── RENDER FIRST — Sentry deferred (FIX-2) ──────────────────────────
createRoot(document.getElementById("root")!).render(<App />);

// ── FIX-2: Sentry init AFTER first render ────────────────────────────
// Uses requestIdleCallback with setTimeout fallback for mobile/webview.
const scheduleIdle = typeof requestIdleCallback === "function"
  ? requestIdleCallback
  : (cb: () => void, opts?: { timeout?: number }) => setTimeout(cb, opts?.timeout ?? 2000);

scheduleIdle(
  () => {
    import("@sentry/react").then((Sentry) => {
      // Register module so lazy wrappers start delegating to real SDK
      setSentryModule(Sentry);

      if (!import.meta.env.VITE_SENTRY_DSN) return;

      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.MODE,
        release: `restaurant-os@${import.meta.env.VITE_APP_VERSION || "0.1.0"}`,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        enabled: true,
      });

      scheduleIdle(
        () => {
          const replayIntegration = Sentry.replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
          });
          Sentry.addIntegration(replayIntegration);
        },
        { timeout: 5000 }
      );
    });
  },
  { timeout: 2000 }
);

// ── Service Worker registration (production only) ────────────────────
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW registration failure is non-critical — app works without it
    });
  });
}
