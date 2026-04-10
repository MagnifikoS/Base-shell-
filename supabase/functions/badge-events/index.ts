/**
 * Badge Events Edge Function
 * Handles badge clock_in/clock_out for employees and admin actions
 * 
 * V5 UNIFIED EXTRA: Single flow, no special leave handling
 * 
 * Routes:
 * - OPTIONS: CORS preflight
 * - GET: Fetch badge events for authenticated user
 * - DELETE: Admin delete badge event (legacy, prefer POST action)
 * - PATCH: Admin update badge event (legacy, prefer POST action)
 * - POST: Main handler - employee badge OR admin actions via body.action
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseJsonSafe } from "./_shared/parse.ts";
import { jsonOk, jsonErr } from "./_shared/respond.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { handleAdminDelete, handleAdminUpdate, handleAdminCreate, handleAdminResetDay } from "./_shared/adminHandlers.ts";
import { handleUserBadge, handleResolveDoubleShift } from "./_shared/userHandlers.ts";
import {
  extractClientInfo,
} from "./_shared/adminActions.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

interface BadgeRequest {
  action?: string;
  id?: string;
  establishment_id?: string;
  device_id?: string;
  pin?: string;
  selfie_captured?: boolean;
  early_exit_confirmed?: boolean;
  extra_confirmed?: boolean;
  force_planned_end?: boolean;
  early_extra_confirmed?: boolean; // V11: User confirmed early arrival is an extra
  target_user_id?: string;
  event_type?: "clock_in" | "clock_out";
  occurred_at?: string;
  day_date?: string;
  sequence_index?: number;
  resolve_type?: "forgot_clockout"; // V14: Double-shift resolution
  clock_out_time?: string; // V14: HH:mm for forgotten clock_out
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: makeCorsHeaders("OPTIONS, GET, DELETE, PATCH, POST", req) });
  }

  // Dynamic CORS headers for all non-preflight responses
  const corsHeaders = makeCorsHeaders("OPTIONS, GET, DELETE, PATCH, POST", req);

  // SEC-18: Rate limiting — 60 requests per minute per IP
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 60 });
  if (rateLimited) return rateLimited;

  const log = createLogger("badge-events");

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("Missing authorization header");
      return jsonErr("Missing authorization", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ✅ TWO DISTINCT CLIENTS:
    // supabaseUser: JWT client with auth.uid() context - for RBAC RPC calls
    // supabaseAdmin: Service role - for data mutations (bypass RLS)
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("Auth failed");
      return jsonErr("Unauthorized", 401);
    }

    log.info("Request authenticated", { user_id: user.id, method: req.method });

    const url = new URL(req.url);
    const method = req.method;

    // ========== GET ==========
    if (method === "GET") {
      return handleGet(supabaseAdmin, user.id, url);
    }

    // ========== DELETE/PATCH (legacy - disabled) ==========
    if (method === "DELETE" || method === "PATCH") {
      return jsonErr("Method not allowed. Use POST with action parameter.", 405, "METHOD_NOT_ALLOWED");
    }

    // ========== POST ==========
    if (method === "POST") {
      const { data: body, error: parseError } = await parseJsonSafe<BadgeRequest>(req);
      if (parseError || !body) {
        return jsonErr("Invalid JSON body", 400, "INVALID_JSON_BODY");
      }

      // DATA-01: Extract client info for audit logging
      const clientInfo = extractClientInfo(req);

      // Route admin actions - pass BOTH clients for RBAC + mutations
      if (body.action === "admin_delete") {
        return handleAdminDelete(supabaseUser, supabaseAdmin, user.id, body, clientInfo);
      }

      if (body.action === "admin_update") {
        return handleAdminUpdate(supabaseUser, supabaseAdmin, user.id, body, clientInfo);
      }

      if (body.action === "admin_reset_day") {
        return handleAdminResetDay(supabaseUser, supabaseAdmin, user.id, body, clientInfo);
      }

      // V14: Double-shift resolution — user forgot to clock out, resolve and re-badge
      if (body.action === "resolve_double_shift") {
        if (!body.establishment_id || !body.device_id || !body.clock_out_time) {
          return jsonErr("Missing required fields for resolve_double_shift", 400);
        }
        return handleResolveDoubleShift(supabaseAdmin, user.id, {
          establishment_id: body.establishment_id,
          device_id: body.device_id,
          resolve_type: body.resolve_type || "forgot_clockout",
          clock_out_time: body.clock_out_time,
          pin: body.pin,
          selfie_captured: body.selfie_captured,
        }, clientInfo);
      }

      // Detect admin-create mode
      const isAdminCreate = body.action === "admin_create" ||
        (body.target_user_id && body.target_user_id !== user.id);

      if (isAdminCreate) {
        return handleAdminCreate(supabaseUser, supabaseAdmin, user.id, body, clientInfo);
      }

      // Normal employee badge flow (V5 UNIFIED - no leave flags)
      if (!body.establishment_id || !body.device_id) {
        return jsonErr("Missing required fields", 400);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // IDEMPOTENCY: Prevent duplicate badge events within 60 seconds
      // Checks for any badge event from the same user in the last 60s.
      // This guards against double-clicks and network retries.
      // ═══════════════════════════════════════════════════════════════════════
      const { data: recentBadge } = await supabaseAdmin
        .from("badge_events")
        .select("id")
        .eq("user_id", user.id)
        .eq("establishment_id", body.establishment_id)
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
        .limit(1);

      if (recentBadge && recentBadge.length > 0) {
        return new Response(
          JSON.stringify({
            warning: "duplicate_prevented",
            message: "Un pointage a déjà été enregistré il y a moins d'une minute",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const result = await handleUserBadge(supabaseAdmin, user.id, {
        establishment_id: body.establishment_id,
        device_id: body.device_id,
        pin: body.pin,
        selfie_captured: body.selfie_captured,
        early_exit_confirmed: body.early_exit_confirmed,
        extra_confirmed: body.extra_confirmed,
        force_planned_end: body.force_planned_end,
        early_extra_confirmed: body.early_extra_confirmed,
      }, clientInfo);
      log.info("completed", { action: "user_badge", user_id: user.id });
      return result;
    }

    return jsonErr("Method not allowed", 405);
  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return jsonErr("Internal server error", 500);
  }
});

// ========== GET Handler ==========
async function handleGet(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  url: URL
): Promise<Response> {
  const establishmentId = url.searchParams.get("establishment_id");
  const dayDate = url.searchParams.get("day_date");
  const weekStart = url.searchParams.get("week_start");

  if (!establishmentId) {
    return jsonErr("Missing establishment_id", 400);
  }

  let query = supabaseAdmin
    .from("badge_events")
    .select("*")
    .eq("user_id", userId)
    .eq("establishment_id", establishmentId)
    .order("day_date", { ascending: true })
    .order("sequence_index", { ascending: true })
    .order("occurred_at", { ascending: true });

  if (dayDate) {
    query = query.eq("day_date", dayDate);
  } else if (weekStart) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    query = query.gte("day_date", weekStart).lte("day_date", weekEnd.toISOString().slice(0, 10));
  }

  const { data: events, error: eventsError } = await query;
  if (eventsError) {
    return jsonErr(eventsError.message, 500);
  }

  return jsonOk({ events });
}
