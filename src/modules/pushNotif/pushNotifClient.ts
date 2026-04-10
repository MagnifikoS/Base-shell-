/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIF — Client-side push subscription management
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { PushSubscriptionKeys } from "./types";

const SW_PATH = "/sw-push.js";

/** Check if push notifications are supported by the browser */
export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Get current notification permission status */
export function getPermissionStatus(): NotificationPermission {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

/** Register the push service worker (separate from any existing SW) */
export async function registerPushSW(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(SW_PATH, {
    scope: "/sw-push-scope/",
  });
  await navigator.serviceWorker.ready;
  return registration;
}

/** Request notification permission from the user */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  const result = await Notification.requestPermission();
  return result;
}

/**
 * Subscribe to push notifications.
 * @param vapidPublicKey - Base64-encoded VAPID public key
 */
export async function subscribeToPush(
  vapidPublicKey: string
): Promise<PushSubscriptionKeys | null> {
  const registration = await registerPushSW();

  // Convert VAPID key from base64 to Uint8Array
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

  // pushManager is available on ServiceWorkerRegistration in push-capable browsers
  const pm = (registration as any).pushManager;
  if (!pm) return null;

  const subscription = await pm.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return null;
  }

  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  };
}

/** Unsubscribe from push notifications */
export async function unsubscribeFromPush(): Promise<boolean> {
  const registration = await navigator.serviceWorker.getRegistration("/sw-push-scope/");
  if (!registration) return false;

  const pm = (registration as any).pushManager;
  if (!pm) return false;

  const subscription = await pm.getSubscription();
  if (!subscription) return false;

  return subscription.unsubscribe();
}

/** Check if user is currently subscribed */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/sw-push-scope/");
  if (!registration) return null;
  const pm = (registration as any).pushManager;
  if (!pm) return null;
  return pm.getSubscription();
}

// ─── Helpers ────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
