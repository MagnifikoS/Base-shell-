/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIF — Type contracts
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Subscription record stored in DB */
export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  establishment_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
}

/** Payload sent to the push-send edge function */
export interface PushNotifPayload {
  user_id?: string;
  establishment_id?: string;
  title: string;
  body: string;
  url?: string;
}

/** Subscription keys extracted from PushSubscription */
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}
