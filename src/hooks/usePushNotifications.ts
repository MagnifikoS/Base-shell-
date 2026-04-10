/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Push Notifications Hook — Web Push API Integration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Provides push notification support via the Web Push API.
 * Works in browsers that support notifications (Chrome, Firefox, Edge, Safari 16+).
 *
 * ARCHITECTURE:
 * - Permission request is USER-INITIATED only (never auto-prompt)
 * - Notifications are sent locally (no push server needed for MVP)
 * - Future: integrate with Supabase Edge Function for server-sent push
 *
 * USAGE:
 *   const { permission, requestPermission, sendNotification } = usePushNotifications();
 *   // On user action: await requestPermission();
 *   // To notify: sendNotification("Nouveau pointage", { body: "Meisen a pointé à 09:02" });
 */

import { useState, useEffect, useCallback } from "react";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

interface UsePushNotificationsReturn {
  /** Current permission state */
  permission: PushPermission;
  /** Whether push is supported in this browser */
  isSupported: boolean;
  /** Whether permission has been granted */
  isEnabled: boolean;
  /** Request permission (must be called from user gesture) */
  requestPermission: () => Promise<boolean>;
  /** Send a local notification */
  sendNotification: (title: string, options?: NotificationOptions) => void;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const isSupported = typeof window !== "undefined" && "Notification" in window;

  const [permission, setPermission] = useState<PushPermission>(() => {
    if (!isSupported) return "unsupported";
    return Notification.permission as PushPermission;
  });

  // Sync permission state if changed externally
  useEffect(() => {
    if (!isSupported) return;

    // Check permission periodically (some browsers change it in settings)
    const interval = setInterval(() => {
      const current = Notification.permission as PushPermission;
      setPermission((prev) => (prev !== current ? current : prev));
    }, 5000);

    return () => clearInterval(interval);
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    if (Notification.permission === "granted") {
      setPermission("granted");
      return true;
    }

    if (Notification.permission === "denied") {
      setPermission("denied");
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);
      return result === "granted";
    } catch {
      return false;
    }
  }, [isSupported]);

  const sendNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported || Notification.permission !== "granted") return;

      try {
        const notification = new Notification(title, {
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          tag: options?.tag ?? `notification-${Date.now()}`,
          ...options,
        });

        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);

        // Focus window on click
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        // Silent fail — notifications are non-critical
      }
    },
    [isSupported]
  );

  return {
    permission,
    isSupported,
    isEnabled: permission === "granted",
    requestPermission,
    sendNotification,
  };
}
