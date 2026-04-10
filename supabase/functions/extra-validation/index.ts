/**
 * Extra Validation Edge Function
 * Admin workflow for approving/rejecting extra time requests
 * 
 * V3.4: Updates badge_events.effective_at on approve/reject
 * - reject → effective_at = planned_end (return to planning time)
 * - approve → effective_at = occurred_at (real badge time)
 * 
 * Source of truth:
 * - extra_events.status for workflow state
 * - badge_events.effective_at for display/payroll
 * - badge_events.occurred_at for audit (never modified)
 * 
 * Routes:
 * - OPTIONS: CORS preflight
 * - POST: Admin approve/reject action
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";

// ============ Paris timezone helpers (DST-safe) ============

/**
 * Get Europe/Paris UTC offset in minutes for a given date.
 */
function getParisOffsetMinutes(date: Date): number {
  const utcParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const parisParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const utcH = parseInt(utcParts.find((p) => p.type === "hour")?.value || "0", 10);
  const utcM = parseInt(utcParts.find((p) => p.type === "minute")?.value || "0", 10);
  const parisH = parseInt(parisParts.find((p) => p.type === "hour")?.value || "0", 10);
  const parisM = parseInt(parisParts.find((p) => p.type === "minute")?.value || "0", 10);

  let diffMinutes = (parisH * 60 + parisM) - (utcH * 60 + utcM);
  if (diffMinutes < -720) diffMinutes += 1440;
  if (diffMinutes > 720) diffMinutes -= 1440;
  return diffMinutes;
}

/**
 * Build a UTC ISO timestamp from Paris local date + time.
 * @param dateStr - "YYYY-MM-DD" (Paris local date)
 * @param timeStr - "HH:mm" or "HH:mm:ss" (Paris local time)
 * @returns ISO string in UTC
 */
function buildParisTimestamp(dateStr: string, timeStr: string): string {
  const [h, m] = timeStr.slice(0, 5).split(":").map(Number);
  const roughDate = new Date(`${dateStr}T12:00:00Z`);
  const offsetMinutes = getParisOffsetMinutes(roughDate);

  const parisMinutes = h * 60 + m;
  const utcMinutes = parisMinutes - offsetMinutes;

  const [y, mo, d] = dateStr.split("-").map(Number);
  let utcDay = d;
  let finalMinutes = utcMinutes;

  if (utcMinutes < 0) {
    finalMinutes = utcMinutes + 1440;
    utcDay -= 1;
  } else if (utcMinutes >= 1440) {
    finalMinutes = utcMinutes - 1440;
    utcDay += 1;
  }

  const utcH = Math.floor(finalMinutes / 60);
  const utcM = finalMinutes % 60;

  const result = new Date(Date.UTC(y, mo - 1, utcDay, utcH, utcM, 0, 0));
  return result.toISOString();
}

// ============ End Paris helpers ============

import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, "Content-Type": "application/json" },
    status: 200,
  });
}

function jsonErr(error: string, status = 400, code?: string): Response {
  return new Response(JSON.stringify({ error, code }), {
    headers: { ...CORS, "Content-Type": "application/json" },
    status,
  });
}

interface ValidateRequest {
  extra_event_id: string;
  action: "approve" | "reject";
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const log = createLogger("extra-validation");

  try {
    log.info("Request received");

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("Missing authorization header");
      return jsonErr("Missing authorization", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return jsonErr("Unauthorized", 401);
    }

    // Rate limit check (after auth, before business logic)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 30, keyPrefix: "extra-validation" });
    if (rateLimited) return rateLimited;

    if (req.method !== "POST") {
      return jsonErr("Method not allowed", 405);
    }

    // Parse body
    let body: ValidateRequest;
    try {
      body = await req.json();
    } catch {
      return jsonErr("Invalid JSON body", 400, "INVALID_JSON_BODY");
    }

    const { extra_event_id, action } = body;

    if (!extra_event_id || !action) {
      return jsonErr("Missing extra_event_id or action", 400, "MISSING_FIELDS");
    }

    if (action !== "approve" && action !== "reject") {
      return jsonErr("Invalid action (must be 'approve' or 'reject')", 400, "INVALID_ACTION");
    }

    // =====================================================
    // RBAC CHECK: Use has_module_access instead of is_admin
    // Pattern: supabaseUser (JWT) for RPC, supabaseAdmin for mutations
    // =====================================================
    
    // First fetch the extra event to get establishment_id for RBAC check
    const { data: extraEvent, error: fetchError } = await supabaseAdmin
      .from("extra_events")
      .select("*")
      .eq("id", extra_event_id)
      .single();

    if (fetchError || !extraEvent) {
      log.warn("validation_failed", { reason: "extra_not_found", extra_event_id });
      return jsonErr("Extra event not found", 404, "EXTRA_NOT_FOUND");
    }

    // Verify user belongs to same organization
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !userProfile) {
      return jsonErr("Profile not found", 404, "PROFILE_NOT_FOUND");
    }

    if (userProfile.organization_id !== extraEvent.organization_id) {
      return jsonErr("Accès non autorisé", 403, "OUT_OF_SCOPE");
    }

    // RBAC check via supabaseUser (JWT context for auth.uid())
    // Admin shortcut is handled inside has_module_access RPC
    const { data: hasAccess, error: accessError } = await supabaseUser.rpc("has_module_access", {
      _module_key: "gestion_personnel",
      _min_level: "write",
      _establishment_id: extraEvent.establishment_id,
    });

    if (accessError) {
      log.error("RBAC check error", accessError);
      return jsonErr("Erreur de vérification des permissions", 500, "RBAC_ERROR");
    }

    if (!hasAccess) {
      log.warn("access_denied", { user_id: user.id, establishment_id: extraEvent.establishment_id });
      return jsonErr("Action réservée aux gestionnaires du personnel", 403, "NOT_AUTHORIZED");
    }

    // =====================================================
    // PER-MGR-012: TEAM-SCOPE CHECK
    // If manager has scope=team, verify the target employee
    // belongs to one of the manager's teams.
    // =====================================================
    const { data: permsData } = await supabaseUser.rpc("get_my_permissions_v2", {
      _establishment_id: extraEvent.establishment_id,
    });

    if (permsData) {
      const gpPerm = (permsData.permissions || []).find(
        (p: { module_key: string }) => p.module_key === "gestion_personnel"
      );
      const scope = gpPerm?.scope ?? "self";
      const managerTeamIds: string[] = permsData.team_ids ?? [];

      if (scope === "team") {
        // Check if the target user belongs to one of the manager's teams
        const { data: targetTeams } = await supabaseAdmin
          .from("user_teams")
          .select("team_id")
          .eq("user_id", extraEvent.user_id)
          .in("team_id", managerTeamIds);

        if (!targetTeams || targetTeams.length === 0) {
          log.warn("team_scope_denied", { target_user_id: extraEvent.user_id, manager_team_ids: managerTeamIds });
          return jsonErr("Accès refusé : cet employé n'est pas dans votre équipe", 403, "OUT_OF_TEAM_SCOPE");
        }
      } else if (scope === "self") {
        // Self scope cannot validate others' extras
        return jsonErr("Accès refusé : validation des extras non autorisée", 403, "SELF_SCOPE_DENY");
      }
    }

    log.info("access_granted", { user_id: user.id });

    // V3.5: Allow toggle between statuses (pending/approved/rejected)
    // Valid transitions:
    // - pending → approved/rejected
    // - approved → rejected
    // - rejected → approved
    const currentStatus = extraEvent.status;
    const targetStatus = action === "approve" ? "approved" : "rejected";

    // Block no-op transitions (already in target state)
    if (currentStatus === targetStatus) {
      return jsonErr(
        `Extra déjà ${targetStatus === "approved" ? "approuvé" : "rejeté"}`,
        400,
        "ALREADY_IN_STATE"
      );
    }

    log.info("status_transition", { from: currentStatus, to: targetStatus, extra_event_id });

    // Get the linked badge_event to access occurred_at
    const { data: badgeEvent, error: badgeError } = await supabaseAdmin
      .from("badge_events")
      .select("id, occurred_at, effective_at, sequence_index")
      .eq("id", extraEvent.badge_event_id)
      .single();

    if (badgeError || !badgeEvent) {
      log.warn("validation_failed", { reason: "badge_not_found", badge_event_id: extraEvent.badge_event_id });
      return jsonErr("Badge event lié introuvable", 404, "BADGE_NOT_FOUND");
    }

    // Compute new effective_at based on action
    let newEffectiveAt: string;

    if (action === "reject") {
      // Reject → effective_at = planned_end (return to planning time)
      // Get ALL planned shifts for this user/day/establishment, sorted by start_time
      // Then pick the one matching badge_event.sequence_index
      const { data: shifts, error: shiftError } = await supabaseAdmin
        .from("planning_shifts")
        .select("start_time, end_time")
        .eq("user_id", extraEvent.user_id)
        .eq("shift_date", extraEvent.day_date)
        .eq("establishment_id", extraEvent.establishment_id)
        .order("start_time", { ascending: true });

      // sequence_index is 1-based, array is 0-based
      const shiftIndex = (badgeEvent.sequence_index || 1) - 1;
      const matchingShift = shifts?.[shiftIndex];

      if (shiftError || !matchingShift) {
        log.warn("shift_not_found_for_reject", { sequence: badgeEvent.sequence_index, shifts_count: shifts?.length });
        // Fallback: keep occurred_at if no shift found (shouldn't happen)
        newEffectiveAt = badgeEvent.occurred_at;
      } else {
        // Build Paris timestamp for planned_end
        newEffectiveAt = buildParisTimestamp(extraEvent.day_date, matchingShift.end_time);
        log.info("reject_effective_at", { planned_end: matchingShift.end_time, effective_at: newEffectiveAt, sequence: badgeEvent.sequence_index });
      }
    } else {
      // Approve → effective_at = occurred_at (real badge time)
      newEffectiveAt = badgeEvent.occurred_at;
      log.info("approve_effective_at", { effective_at: newEffectiveAt });
    }

    // Update the badge_event effective_at
    const { error: badgeUpdateError } = await supabaseAdmin
      .from("badge_events")
      .update({ effective_at: newEffectiveAt })
      .eq("id", badgeEvent.id);

    if (badgeUpdateError) {
      log.error("badge_update_failed", badgeUpdateError);
      return jsonErr("Mise à jour du pointage impossible", 500);
    }

    // Update the extra event status
    const newStatus = action === "approve" ? "approved" : "rejected";
    const now = new Date().toISOString();

    const { data: updatedEvent, error: updateError } = await supabaseAdmin
      .from("extra_events")
      .update({
        status: newStatus,
        validated_by: user.id,
        validated_at: now,
      })
      .eq("id", extra_event_id)
      .select()
      .single();

    if (updateError) {
      log.error("extra_event_update_failed", updateError);
      return jsonErr("Mise à jour impossible", 500);
    }

    // Log action (DATA-01: include client IP and user-agent)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: extraEvent.organization_id,
      user_id: user.id,
      action: `EXTRA_${action.toUpperCase()}`,
      target_type: "extra_event",
      target_id: extra_event_id,
      metadata: {
        extra_minutes: extraEvent.extra_minutes,
        target_user_id: extraEvent.user_id,
        day_date: extraEvent.day_date,
        establishment_id: extraEvent.establishment_id,
      },
      ip_address: clientIp,
      user_agent: clientUserAgent,
    });

    log.info("completed", { admin_id: user.id, action, extra_event_id });

    return jsonOk({
      success: true,
      event: updatedEvent,
    });
  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return jsonErr("Internal server error", 500);
  }
});
