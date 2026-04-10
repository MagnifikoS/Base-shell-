/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIF — Supabase API wrapper (save/delete subscriptions + send test)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { PushSubscriptionKeys, PushNotifPayload } from "./types";

/**
 * Save a push subscription to the database.
 * Uses upsert on endpoint to handle re-subscriptions.
 */
export async function saveSubscription(
  keys: PushSubscriptionKeys,
  establishmentId?: string | null
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // We use raw SQL-like approach via supabase client
  // Since push_subscriptions isn't in the auto-generated types, use .from() with type assertion
  const { error } = await (supabase as any)
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        establishment_id: establishmentId ?? null,
        endpoint: keys.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" }
    );

  if (error) throw new Error(`Failed to save subscription: ${error.message}`);
}

/** Delete a push subscription from the database by endpoint */
export async function deleteSubscription(endpoint: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) throw new Error(`Failed to delete subscription: ${error.message}`);
}

/** Get current user's subscriptions */
export async function getMySubscriptions() {
  const { data, error } = await (supabase as any)
    .from("push_subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch subscriptions: ${error.message}`);
  return data ?? [];
}

/** Send a test push notification via edge function */
export async function sendTestNotification(payload: PushNotifPayload): Promise<void> {
  const { data, error } = await supabase.functions.invoke("push-send", {
    body: payload,
  });

  if (error) throw new Error(`Failed to send notification: ${error.message}`);
  if (data?.error) throw new Error(data.error);
}
