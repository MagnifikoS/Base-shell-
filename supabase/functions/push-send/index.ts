/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDGE FUNCTION: push-send
 * 
 * ⚠️  TEST/DEBUG ONLY — NOT the production notification engine.
 * 
 * This function is used EXCLUSIVELY for:
 *   - Manual "Test notification" button in Settings
 *   - Admin debugging of push delivery
 * 
 * The production notification engine is: notif-check-badgeuse
 * DO NOT use this function for automated notifications.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendWebPush } from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");

    console.log("[push-send][TEST] VAPID keys configured:", {
      hasPrivate: !!vapidPrivateKey,
      hasPublic: !!vapidPublicKey,
    });

    if (!vapidPrivateKey || !vapidPublicKey) {
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[push-send][TEST] Authenticated user:", user.id);

    // Parse payload
    const { user_id, establishment_id, title, body, url } = await req.json();

    if (!title || !body) {
      return new Response(
        JSON.stringify({ error: "title and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to read subscriptions
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    let query = adminClient.from("push_subscriptions").select("*");
    if (user_id) {
      query = query.eq("user_id", user_id);
    } else if (establishment_id) {
      query = query.eq("establishment_id", establishment_id);
    } else {
      query = query.eq("user_id", user.id);
    }

    const { data: subscriptions, error: subError } = await query;
    if (subError) {
      console.error("[push-send][TEST] Subscription fetch error:", subError.message);
      return new Response(
        JSON.stringify({ error: `Failed to fetch subscriptions: ${subError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[push-send][TEST] Found subscriptions:", subscriptions?.length ?? 0);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No subscriptions found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send push notifications with delivery tracing
    const pushPayload = JSON.stringify({ title, body, url: url || "/" });
    let sent = 0;
    let cleaned = 0;
    const errors: string[] = [];
    const deliveryRows: Array<Record<string, unknown>> = [];

    const extractDomain = (endpoint: string): string => {
      try { return new URL(endpoint).hostname; } catch { return "unknown"; }
    };

    for (const sub of subscriptions) {
      const domain = extractDomain(sub.endpoint);
      try {
        const response = await sendWebPush(
          sub.endpoint, sub.p256dh, sub.auth,
          pushPayload, vapidPublicKey, vapidPrivateKey
        );

        if (response.ok) {
          sent++;
          deliveryRows.push({
            establishment_id: sub.establishment_id || establishment_id || null,
            recipient_user_id: sub.user_id,
            alert_key: `TEST:${user.id}:${new Date().toISOString().split("T")[0]}`,
            push_subscription_id: sub.id,
            endpoint_domain: domain,
            status: "delivered",
            http_status: response.status,
          });
        } else if (response.status === 404 || response.status === 410) {
          await adminClient.from("push_subscriptions").delete().eq("id", sub.id);
          cleaned++;
          deliveryRows.push({
            establishment_id: sub.establishment_id || establishment_id || null,
            recipient_user_id: sub.user_id,
            alert_key: `TEST:${user.id}:${new Date().toISOString().split("T")[0]}`,
            push_subscription_id: sub.id,
            endpoint_domain: domain,
            status: "expired",
            http_status: response.status,
            error_message: `Subscription expired (${response.status})`,
          });
        } else {
          const errText = await response.text();
          console.error("[push-send][TEST] Push error:", response.status, errText.slice(0, 200));
          errors.push(`${sub.endpoint.slice(0, 50)}...: ${response.status} ${errText.slice(0, 100)}`);
          deliveryRows.push({
            establishment_id: sub.establishment_id || establishment_id || null,
            recipient_user_id: sub.user_id,
            alert_key: `TEST:${user.id}:${new Date().toISOString().split("T")[0]}`,
            push_subscription_id: sub.id,
            endpoint_domain: domain,
            status: "failed",
            http_status: response.status,
            error_message: errText.slice(0, 500),
          });
        }
      } catch (err) {
        console.error("[push-send][TEST] Push exception:", (err as Error).message);
        errors.push(`${sub.endpoint.slice(0, 50)}...: ${(err as Error).message}`);
        deliveryRows.push({
          establishment_id: sub.establishment_id || establishment_id || null,
          recipient_user_id: sub.user_id,
          alert_key: `TEST:${user.id}:${new Date().toISOString().split("T")[0]}`,
          push_subscription_id: sub.id,
          endpoint_domain: domain,
          status: "failed",
          http_status: null,
          error_message: (err as Error).message.slice(0, 500),
        });
      }
    }

    // ═══ DELIVERY LOGS: trace test sends too ═══
    if (deliveryRows.length > 0) {
      const { error: logErr } = await adminClient.from("notification_delivery_logs").insert(deliveryRows);
      if (logErr) console.error("[push-send][TEST] Delivery log insert error:", logErr.message);
    }

    console.log("[push-send][TEST] Result:", { sent, cleaned, errors: errors.length, delivery_logs: deliveryRows.length });

    return new Response(
      JSON.stringify({ sent, cleaned, errors: errors.length > 0 ? errors : undefined, delivery_logs: deliveryRows.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[push-send][TEST] Top-level error:", (err as Error).message);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
