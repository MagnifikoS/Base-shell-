/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE PUSH NOTIF — Public API
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Modular, retirable: `rm -rf src/modules/pushNotif`
 * + delete public/sw-push.js + edge function push-send + table push_subscriptions
 * ═══════════════════════════════════════════════════════════════════════════
 */

export { PushNotifSettingsCard } from "./components/PushNotifSettingsCard";
export { PushPromptBanner } from "./components/PushPromptBanner";
export type { PushSubscriptionRecord, PushNotifPayload } from "./types";
