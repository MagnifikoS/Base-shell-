import { useEffect, useRef, useCallback } from "react";

const IDLE_WARNING_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_LOGOUT_MS = 35 * 60 * 1000; // 35 minutes
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
];

interface UseIdleTimeoutOptions {
  /** Called when idle warning threshold is reached (default: 30 min) */
  onWarning: () => void;
  /** Called when idle logout threshold is reached (default: 35 min) */
  onLogout: () => void;
  /** Whether the hook is active (disable when user is not authenticated) */
  enabled?: boolean;
}

/**
 * Tracks user activity and triggers warning/logout callbacks after inactivity.
 *
 * - 30 minutes idle: calls onWarning (show a toast or dialog)
 * - 35 minutes idle: calls onLogout (force sign out)
 *
 * Activity events: mouse, keyboard, scroll, touch.
 */
export function useIdleTimeout({ onWarning, onLogout, enabled = true }: UseIdleTimeoutOptions) {
  const lastActivityRef = useRef<number>(Date.now());
  const warningFiredRef = useRef(false);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningFiredRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Reset on mount
    lastActivityRef.current = Date.now();
    warningFiredRef.current = false;

    // Activity listener (passive for performance)
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      warningFiredRef.current = false;
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    // Periodic check
    const intervalId = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;

      if (idleMs >= IDLE_LOGOUT_MS) {
        onLogout();
        return;
      }

      if (idleMs >= IDLE_WARNING_MS && !warningFiredRef.current) {
        warningFiredRef.current = true;
        onWarning();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      clearInterval(intervalId);
    };
  }, [enabled, onWarning, onLogout]);

  return { resetActivity };
}
