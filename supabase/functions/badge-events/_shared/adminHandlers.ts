/**
 * Admin action handlers for badge-events
 * Handles admin_delete, admin_update, admin_create, admin_reset_day via POST body.action
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  validateModuleAccess,
  validateScope,
  validateServiceDayMatch,
  logAdminAction,
  recalculateEffectiveAt,
  checkBadgeConflict,
  type AuditClientInfo,
} from "./adminActions.ts";
import { jsonOk, jsonErr } from "./respond.ts";
import { buildParisTimestamp, DEFAULT_SETTINGS, computeClockInEffectiveAndLateV2, checkEarlyArrival, checkEarlyDeparture, type BadgeSettings, type PlannedShift } from "./helpers.ts";
import { warnFutureBadgeAttempt, warnIfInvalidEarlyDeparture, logEarlyDepartureCreated } from "./monitoring.ts";

interface AdminDeleteParams {
  id?: string;
}

interface AdminUpdateParams {
  id?: string;
  occurred_at?: string;
  // FIX A+B: Extra flow params (same as admin_create)
  extra_confirmed?: boolean;
  force_planned_end?: boolean;
  // FIX C: Early arrival confirmation (same as admin_create)
  early_arrival_confirmed?: boolean;
}

interface AdminCreateParams {
  establishment_id?: string;
  target_user_id?: string;
  event_type?: "clock_in" | "clock_out";
  occurred_at?: string;
  day_date?: string;
  sequence_index?: number;
  // FIX B1: Extra flow params (same as user badge)
  extra_confirmed?: boolean;
  force_planned_end?: boolean;
  // FIX: Early arrival confirmation
  early_arrival_confirmed?: boolean;
}

interface AdminResetDayParams {
  target_user_id?: string;
  establishment_id?: string;
  day_date?: string;
}

/**
 * Handle admin_delete action
 * CLEANUP RULE: If deleting a clock_in, also delete orphan clock_out of same sequence_index
 */
export async function handleAdminDelete(
  supabaseUser: SupabaseClient, // JWT client for RBAC
  supabaseAdmin: SupabaseClient, // Service role for mutations
  userId: string,
  body: AdminDeleteParams,
  clientInfo?: AuditClientInfo,
): Promise<Response> {
  const badgeEventId = body.id;
  if (!badgeEventId) {
    return jsonErr("Missing badge event id", 400, "BADGE_ID_REQUIRED");
  }

  // First fetch the event to get establishment_id (needed for RBAC check)
  const { data: badgeEvent, error: fetchErr } = await supabaseAdmin
    .from("badge_events")
    .select("*")
    .eq("id", badgeEventId)
    .single();

  if (fetchErr || !badgeEvent) {
    return jsonErr("Badge event not found", 404, "BADGE_NOT_FOUND");
  }

  // ✅ RBAC: Check module access using JWT client (auth.uid() context)
  const { context: adminCtx, error: adminErr } = await validateModuleAccess(
    supabaseUser,
    supabaseAdmin,
    userId,
    badgeEvent.establishment_id,
    "write"
  );
  if (adminErr) {
    return jsonErr(adminErr.error!, adminErr.status || 403, adminErr.code);
  }

  // Validate organization scope
  const scopeErr = validateScope(adminCtx!, badgeEvent.organization_id, badgeEvent.establishment_id);
  if (scopeErr) {
    return jsonErr(scopeErr.error!, scopeErr.status || 403, scopeErr.code);
  }

  // ✅ V8: Validate day_date matches service day of the EVENT (not current time)
  const todayErr = await validateServiceDayMatch(
    supabaseAdmin,
    badgeEvent.establishment_id,
    badgeEvent.day_date,
    badgeEvent.occurred_at
  );
  if (todayErr) {
    return jsonErr(todayErr.error!, todayErr.status || 403, todayErr.code);
  }

  // Delete the requested badge event
  const { error: deleteErr } = await supabaseAdmin
    .from("badge_events")
    .delete()
    .eq("id", badgeEventId);

  if (deleteErr) {
    return jsonErr(deleteErr.message, 500);
  }

  let orphanCleanedUp = false;
  let orphanEventId: string | null = null;

  // CLEANUP: If we deleted a clock_in, check for orphan clock_out in same sequence
  if (badgeEvent.event_type === "clock_in") {
    const { data: orphanClockOut } = await supabaseAdmin
      .from("badge_events")
      .select("id, event_type, occurred_at")
      .eq("user_id", badgeEvent.user_id)
      .eq("establishment_id", badgeEvent.establishment_id)
      .eq("day_date", badgeEvent.day_date)
      .eq("sequence_index", badgeEvent.sequence_index)
      .eq("event_type", "clock_out")
      .single();

    if (orphanClockOut) {
      // Delete orphan clock_out (extra_events CASCADE will handle linked extra)
      const { error: orphanDeleteErr } = await supabaseAdmin
        .from("badge_events")
        .delete()
        .eq("id", orphanClockOut.id);

      if (!orphanDeleteErr) {
        orphanCleanedUp = true;
        orphanEventId = orphanClockOut.id;
        console.log(`[admin_delete] Cleaned up orphan clock_out ${orphanClockOut.id} for sequence ${badgeEvent.sequence_index}`);
      }
    }
  }

  await logAdminAction(supabaseAdmin, "BADGE_EVENT_DELETE", adminCtx!, {
    targetUserId: badgeEvent.user_id,
    badgeEventId,
    establishmentId: badgeEvent.establishment_id,
    dayDate: badgeEvent.day_date,
    before: {
      occurred_at: badgeEvent.occurred_at,
      event_type: badgeEvent.event_type,
      sequence_index: badgeEvent.sequence_index,
    },
    after: orphanCleanedUp ? { orphan_clock_out_deleted: orphanEventId } : undefined,
  }, clientInfo);

  return jsonOk({ success: true, orphan_cleaned_up: orphanCleanedUp });
}

/**
 * Handle admin_update action
 * FIX A+B: Now applies SAME extra logic as admin_create:
 * - If clock_out late > tolerance → warning EXTRA_SUSPECTED (no update yet)
 * - 2nd call with extra_confirmed=true → execute update (no revalidation, final)
 * - Recalculate late_minutes for clock_in
 * OPTION B: Allows historical date edits (no today-only restriction for update)
 * This enables modifying extras from past days via "Modifier horaire"
 */
export async function handleAdminUpdate(
  supabaseUser: SupabaseClient, // JWT client for RBAC
  supabaseAdmin: SupabaseClient, // Service role for mutations
  userId: string,
  body: AdminUpdateParams,
  clientInfo?: AuditClientInfo,
): Promise<Response> {
  const badgeEventId = body.id;
  const newOccurredAt = body.occurred_at;
  const { extra_confirmed, force_planned_end, early_arrival_confirmed } = body;

  if (!badgeEventId || !newOccurredAt) {
    return jsonErr("Missing id or occurred_at", 400, "MISSING_FIELDS");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 0: BLOCK FUTURE BADGES
  // A badge represents a real past/present event - future timestamps are invalid
  // ═══════════════════════════════════════════════════════════════════════════
  const occurredAtDate = new Date(newOccurredAt);
  const now = new Date();
  if (occurredAtDate.getTime() > now.getTime()) {
    // PHASE 3.3: WARN log for monitoring before blocking
    warnFutureBadgeAttempt("admin_update", newOccurredAt, userId, badgeEventId);
    return jsonErr(
      `Badge non valide : l'heure saisie (${newOccurredAt.slice(11, 16)}) est dans le futur. Un badge doit représenter un événement passé ou présent.`,
      400,
      "FUTURE_BADGE_BLOCKED"
    );
  }

  // Defensive: accept "true" (string) as well
  const extraConfirmed = extra_confirmed === true || (extra_confirmed as unknown) === "true";
  const forcePlannedEnd = force_planned_end === true || (force_planned_end as unknown) === "true";
  const earlyArrivalConfirmed = early_arrival_confirmed === true || (early_arrival_confirmed as unknown) === "true";

  // First fetch the event to get establishment_id (needed for RBAC check + incoherent time validation)
  const { data: badgeEvent, error: fetchErr } = await supabaseAdmin
    .from("badge_events")
    .select("*")
    .eq("id", badgeEventId)
    .single();

  if (fetchErr || !badgeEvent) {
    return jsonErr("Badge event not found", 404, "BADGE_NOT_FOUND");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: BLOCK INCOHERENT TIMES (clock_out before clock_in)
  // When updating a clock_out, verify that the new time is not before
  // the corresponding clock_in. When updating a clock_in, verify that
  // the corresponding clock_out (if any) is not before the new time.
  // ═══════════════════════════════════════════════════════════════════════════
  if (badgeEvent.event_type === "clock_out") {
    const { data: correspondingClockIn } = await supabaseAdmin
      .from("badge_events")
      .select("occurred_at")
      .eq("user_id", badgeEvent.user_id)
      .eq("establishment_id", badgeEvent.establishment_id)
      .eq("day_date", badgeEvent.day_date)
      .eq("sequence_index", badgeEvent.sequence_index)
      .eq("event_type", "clock_in")
      .single();

    if (correspondingClockIn) {
      const clockInDate = new Date(correspondingClockIn.occurred_at);
      if (occurredAtDate.getTime() < clockInDate.getTime()) {
        return jsonErr(
          "L'heure de sortie doit être après l'heure d'arrivée",
          400,
          "DEPARTURE_BEFORE_ARRIVAL"
        );
      }
    }
  } else if (badgeEvent.event_type === "clock_in") {
    const { data: correspondingClockOut } = await supabaseAdmin
      .from("badge_events")
      .select("occurred_at")
      .eq("user_id", badgeEvent.user_id)
      .eq("establishment_id", badgeEvent.establishment_id)
      .eq("day_date", badgeEvent.day_date)
      .eq("sequence_index", badgeEvent.sequence_index)
      .eq("event_type", "clock_out")
      .single();

    if (correspondingClockOut) {
      const clockOutDate = new Date(correspondingClockOut.occurred_at);
      if (occurredAtDate.getTime() > clockOutDate.getTime()) {
        return jsonErr(
          "L'heure d'arrivée doit être avant l'heure de sortie",
          400,
          "ARRIVAL_AFTER_DEPARTURE"
        );
      }
    }
  }

  // ✅ RBAC: Check module access using JWT client (auth.uid() context)
  const { context: adminCtx, error: adminErr } = await validateModuleAccess(
    supabaseUser,
    supabaseAdmin,
    userId,
    badgeEvent.establishment_id,
    "write"
  );
  if (adminErr) {
    return jsonErr(adminErr.error!, adminErr.status || 403, adminErr.code);
  }

  // OPTION B: Scope validation only (no today-only restriction for updates)
  // This allows admins to modify historical badge events linked to extras
  const scopeErr = validateScope(adminCtx!, badgeEvent.organization_id, badgeEvent.establishment_id);
  if (scopeErr) {
    return jsonErr(scopeErr.error!, scopeErr.status || 403, scopeErr.code);
  }

  // NOTE: validateTodayOnly removed for admin_update to allow historical edits

  // === FIX A: Get settings + planned shift for EXTRA logic ===
  const { data: settings } = await supabaseAdmin
    .from("badgeuse_settings")
    .select("*")
    .eq("establishment_id", badgeEvent.establishment_id)
    .single();

  const cfg: BadgeSettings = settings || DEFAULT_SETTINGS;

  // V10: Get establishment cutoff for timestamp-based calculations
  const { data: establishment } = await supabaseAdmin
    .from("establishments")
    .select("service_day_cutoff")
    .eq("id", badgeEvent.establishment_id)
    .single();
  
  const serviceDayCutoff: string = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

  const { data: plannedShifts } = await supabaseAdmin
    .from("planning_shifts")
    .select("start_time, end_time")
    .eq("user_id", badgeEvent.user_id)
    .eq("establishment_id", badgeEvent.establishment_id)
    .eq("shift_date", badgeEvent.day_date)
    .order("start_time", { ascending: true });

  const plannedShift: PlannedShift | null = plannedShifts?.[badgeEvent.sequence_index - 1] || null;

  // === FIX C: BADGE_TOO_EARLY CHECK FOR CLOCK_IN (same as admin_create) ===
  if (badgeEvent.event_type === "clock_in" && plannedShift && cfg.early_arrival_limit_min > 0 && !earlyArrivalConfirmed) {
    const occurredAtDate = new Date(newOccurredAt);
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    
    const earlyCheck = checkEarlyArrival(
      occurredAtDate,
      plannedStartStr,
      plannedEndStr,
      badgeEvent.day_date,
      serviceDayCutoff,
      cfg.early_arrival_limit_min
    );
    
    if (earlyCheck.isTooEarly) {
      // Return warning for admin to confirm
      return jsonOk(
        {
          success: false,
          code: "BADGE_TOO_EARLY",
          warning: "BADGE_TOO_EARLY",
          shift_start: plannedStartStr,
          early_limit: cfg.early_arrival_limit_min,
          minutes_early: earlyCheck.minutesEarly,
        },
        200
      );
    }
  }

  let usePlannedEndForClockOut = false;
  let extraMinutes = 0;

  // === FIX A: EXTRA logic for clock_out using V10 absolute timestamps ===
  if (badgeEvent.event_type === "clock_out" && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const occurredAtDate = new Date(newOccurredAt);
    
    // V10: Use checkEarlyDeparture for absolute timestamp comparison
    const earlyCheck = checkEarlyDeparture(
      occurredAtDate,
      plannedStartStr,
      plannedEndStr,
      badgeEvent.day_date,
      serviceDayCutoff
    );
    
    // Calculate late properly: if NOT early departure, compute how many minutes AFTER planned end
    // checkEarlyDeparture returns minutesEarly clamped to 0, so we need to calculate late separately
    let late: number;
    if (earlyCheck.isEarlyDeparture) {
      late = -earlyCheck.minutesEarly; // Negative = left early
    } else {
      // Badge is after planned end: calculate actual late minutes
      const plannedEndTs = new Date(earlyCheck.plannedEndTs);
      const lateMs = occurredAtDate.getTime() - plannedEndTs.getTime();
      late = Math.floor(lateMs / 60000);
    }
    extraMinutes = late;

    // Defensive: accept "true" (string) as well for early_exit_confirmed
    const earlyExitConfirmed = (body as Record<string, unknown>).early_exit_confirmed === true || 
      (body as Record<string, unknown>).early_exit_confirmed === "true";

    // PHASE 3: Check for early departure (before shift end)
    if (late < 0 && !earlyExitConfirmed) {
      const earlyMinutes = Math.abs(late);
      return jsonOk(
        {
          success: false,
          code: "SHIFT_NOT_FINISHED",
          planned_end: plannedEndStr,
          early_minutes: earlyMinutes,
        },
        200
      );
    }

    // If late beyond tolerance → warning (1st call) or process (2nd call)
    if (late > cfg.departure_tolerance_min) {
      if (extraConfirmed !== true) {
        // 1st call: return warning WITHOUT updating
        return jsonOk(
          {
            success: true,
            warning: "EXTRA_SUSPECTED",
            extra_minutes: late,
            planned_end: plannedEndStr,
          },
          200
        );
      }
      // 2nd call: user made a choice - NO revalidation, direct execution
      if (forcePlannedEnd) {
        usePlannedEndForClockOut = true;
      }
    }
  }

  // === FIX B: Recalculate late_minutes for clock_in (with V10 timestamps) ===
  let newLateMinutes: number | null = null;
  if (badgeEvent.event_type === "clock_in" && plannedShift) {
    const clockInResult = computeClockInEffectiveAndLateV2(
      new Date(newOccurredAt),
      plannedShift.start_time.slice(0, 5),
      badgeEvent.day_date,
      serviceDayCutoff,
      cfg.arrival_tolerance_min
    );
    newLateMinutes = clockInResult.lateMinutes;
  }

  // Compute effectiveAt (use planned end if force_planned_end)
  let newEffectiveAt: string;
  if (usePlannedEndForClockOut && plannedShift) {
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    newEffectiveAt = buildParisTimestamp(badgeEvent.day_date, plannedEndStr);
  } else {
    newEffectiveAt = await recalculateEffectiveAt(supabaseAdmin, {
      occurredAt: new Date(newOccurredAt),
      eventType: badgeEvent.event_type as "clock_in" | "clock_out",
      targetUserId: badgeEvent.user_id,
      establishmentId: badgeEvent.establishment_id,
      dayDate: badgeEvent.day_date,
      sequenceIndex: badgeEvent.sequence_index,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1.2 SSOT: Compute early_departure_minutes for clock_out
  // ═══════════════════════════════════════════════════════════════════════════
  let earlyDepartureMinutes: number | null = null;
  if (badgeEvent.event_type === "clock_out" && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const earlyCheck = checkEarlyDeparture(
      new Date(newOccurredAt),
      plannedStartStr,
      plannedEndStr,
      badgeEvent.day_date,
      serviceDayCutoff
    );
    // SSOT: 0 = on-time or late departure, >0 = early departure, null only if no shift
    earlyDepartureMinutes = Math.max(0, earlyCheck.minutesEarly);
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    occurred_at: newOccurredAt,
    effective_at: newEffectiveAt,
  };
  
  // FIX B: Include late_minutes for clock_in
  if (badgeEvent.event_type === "clock_in") {
    updatePayload.late_minutes = newLateMinutes;
  }
  
  // PHASE 1.2 SSOT: Include early_departure_minutes for clock_out
  if (badgeEvent.event_type === "clock_out") {
    updatePayload.early_departure_minutes = earlyDepartureMinutes;
  }

  const { data: updatedEvent, error: updateErr } = await supabaseAdmin
    .from("badge_events")
    .update(updatePayload)
    .eq("id", badgeEventId)
    .select()
    .single();

  if (updateErr) {
    return jsonErr(updateErr.message, 500);
  }

  // === FIX A: Handle extra_events for clock_out ===
  if (badgeEvent.event_type === "clock_out") {
    const { data: linkedExtra } = await supabaseAdmin
      .from("extra_events")
      .select("*")
      .eq("badge_event_id", badgeEventId)
      .single();

    if (extraConfirmed && !forcePlannedEnd && extraMinutes > 0 && plannedShift) {
      // User confirmed "Oui extra" - create or update extra_events
      const plannedEndStr = plannedShift.end_time.slice(0, 5);
      const extraStartAt = buildParisTimestamp(badgeEvent.day_date, plannedEndStr);
      const extraEndAt = newOccurredAt;

      if (linkedExtra) {
        // Update existing extra
        const { error: extraUpdateErr } = await supabaseAdmin
          .from("extra_events")
          .update({
            extra_end_at: extraEndAt,
            extra_start_at: extraStartAt,
            extra_minutes: extraMinutes,
          })
          .eq("id", linkedExtra.id);

        if (extraUpdateErr) {
          console.error("[admin_update] Failed to update extra_events:", extraUpdateErr.message);
        } else {
          console.log(`[admin_update] Updated extra_events ${linkedExtra.id}: ${extraMinutes}min`);
        }
      } else {
        // Create new extra
        const { error: extraInsertErr } = await supabaseAdmin
          .from("extra_events")
          .insert({
            badge_event_id: badgeEventId,
            organization_id: badgeEvent.organization_id,
            establishment_id: badgeEvent.establishment_id,
            user_id: badgeEvent.user_id,
            day_date: badgeEvent.day_date,
            extra_minutes: extraMinutes,
            status: "pending",
            extra_start_at: extraStartAt,
            extra_end_at: extraEndAt,
          });

        if (extraInsertErr) {
          console.error("[admin_update] Failed to create extra_events:", extraInsertErr.message);
        } else {
          console.log(`[admin_update] Created extra_events for ${badgeEvent.user_id}: ${extraMinutes}min`);
        }
      }
    } else if (linkedExtra && (forcePlannedEnd || extraMinutes <= 0)) {
      // User chose "Non extra" or no longer late → delete existing extra
      const { error: extraDeleteErr } = await supabaseAdmin
        .from("extra_events")
        .delete()
        .eq("id", linkedExtra.id);

      if (extraDeleteErr) {
        console.error("[admin_update] Failed to delete extra_events:", extraDeleteErr.message);
      } else {
        console.log(`[admin_update] Deleted extra_events ${linkedExtra.id} (force_planned_end or no longer late)`);
      }
    } else if (linkedExtra) {
      // Sync existing extra (no confirmation flow, just updating times)
      const plannedEndStr = plannedShift?.end_time.slice(0, 5) || "00:00";
      const extraStartAt = buildParisTimestamp(badgeEvent.day_date, plannedEndStr);
      const extraEndAt = newOccurredAt;
      const startMs = new Date(extraStartAt).getTime();
      const endMs = new Date(extraEndAt).getTime();
      const newExtraMinutes = Math.max(0, Math.floor((endMs - startMs) / 60000));

      const { error: extraUpdateErr } = await supabaseAdmin
        .from("extra_events")
        .update({
          extra_end_at: extraEndAt,
          extra_start_at: extraStartAt,
          extra_minutes: newExtraMinutes,
        })
        .eq("id", linkedExtra.id);

      if (extraUpdateErr) {
        console.error("[admin_update] Failed to sync extra_events:", extraUpdateErr.message);
      } else {
        console.log(`[admin_update] Synced extra_events ${linkedExtra.id}: ${newExtraMinutes}min`);
      }
    }
  }

  // PHASE 3.3: WARN if early_departure_minutes set on non-clock_out (should never happen)
  warnIfInvalidEarlyDeparture(badgeEvent.event_type, earlyDepartureMinutes, badgeEventId);
  
  // PHASE 3.3: Log early departure update for monitoring
  if (badgeEvent.event_type === "clock_out" && earlyDepartureMinutes && earlyDepartureMinutes > 0) {
    logEarlyDepartureCreated(badgeEvent.user_id, badgeEvent.day_date, earlyDepartureMinutes, badgeEvent.sequence_index);
  }

  await logAdminAction(supabaseAdmin, "BADGE_EVENT_UPDATE", adminCtx!, {
    targetUserId: badgeEvent.user_id,
    badgeEventId,
    establishmentId: badgeEvent.establishment_id,
    dayDate: badgeEvent.day_date,
    before: { occurred_at: badgeEvent.occurred_at, effective_at: badgeEvent.effective_at, late_minutes: badgeEvent.late_minutes },
    after: { occurred_at: newOccurredAt, effective_at: newEffectiveAt, late_minutes: newLateMinutes, extra_confirmed: extraConfirmed, force_planned_end: forcePlannedEnd },
  }, clientInfo);

  return jsonOk({ event: updatedEvent });
}

/**
 * Handle admin_create action
 * FIX B1: Now applies SAME extra logic as user badge flow:
 * - If clock_out late > tolerance → warning EXTRA_SUSPECTED (no insert)
 * - 2nd call with extra_confirmed=true → insert + create extra_events (if not force_planned_end)
 */
export async function handleAdminCreate(
  supabaseUser: SupabaseClient, // JWT client for RBAC
  supabaseAdmin: SupabaseClient, // Service role for mutations
  userId: string,
  body: AdminCreateParams,
  clientInfo?: AuditClientInfo,
): Promise<Response> {
  const { establishment_id, target_user_id, event_type, occurred_at, day_date, extra_confirmed, force_planned_end, early_arrival_confirmed } = body;

  if (!establishment_id || !target_user_id || !event_type || !occurred_at || !day_date) {
    return jsonErr("Missing required fields for admin create", 400, "MISSING_FIELDS");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 0: BLOCK FUTURE BADGES
  // A badge represents a real past/present event - future timestamps are invalid
  // ═══════════════════════════════════════════════════════════════════════════
  const occurredAtDate = new Date(occurred_at);
  const now = new Date();
  if (occurredAtDate.getTime() > now.getTime()) {
    // PHASE 3.3: WARN log for monitoring before blocking
    warnFutureBadgeAttempt("admin_create", occurred_at, userId, establishment_id!);
    return jsonErr(
      `Badge non valide : l'heure saisie (${occurred_at.slice(11, 16)}) est dans le futur. Un badge doit représenter un événement passé ou présent.`,
      400,
      "FUTURE_BADGE_BLOCKED"
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: BLOCK INCOHERENT TIMES (clock_out before clock_in)
  // If creating a clock_out, verify that the corresponding clock_in exists
  // and that the departure time is not before the arrival time.
  // ═══════════════════════════════════════════════════════════════════════════
  if (event_type === "clock_out") {
    const sequenceIdx = body.sequence_index || 1;
    const { data: correspondingClockIn } = await supabaseAdmin
      .from("badge_events")
      .select("occurred_at")
      .eq("user_id", target_user_id)
      .eq("establishment_id", establishment_id)
      .eq("day_date", day_date)
      .eq("sequence_index", sequenceIdx)
      .eq("event_type", "clock_in")
      .single();

    if (correspondingClockIn) {
      const clockInDate = new Date(correspondingClockIn.occurred_at);
      if (occurredAtDate.getTime() < clockInDate.getTime()) {
        return jsonErr(
          "L'heure de sortie doit être après l'heure d'arrivée",
          400,
          "DEPARTURE_BEFORE_ARRIVAL"
        );
      }
    }
  }

  // Defensive: accept "true" (string) as well
  const extraConfirmed = extra_confirmed === true || (extra_confirmed as unknown) === "true";
  const forcePlannedEnd = force_planned_end === true || (force_planned_end as unknown) === "true";
  const earlyArrivalConfirmed = early_arrival_confirmed === true || (early_arrival_confirmed as unknown) === "true";

  // ✅ RBAC: Check module access using JWT client (auth.uid() context)
  const { context: adminCtx, error: adminErr } = await validateModuleAccess(
    supabaseUser,
    supabaseAdmin,
    userId,
    establishment_id,
    "write"
  );
  if (adminErr) {
    return jsonErr(adminErr.error!, adminErr.status || 403, adminErr.code);
  }

  // ✅ V8: Validate day_date matches service day of occurred_at (not current time)
  const todayErr = await validateServiceDayMatch(supabaseAdmin, establishment_id, day_date, occurred_at);
  if (todayErr) {
    return jsonErr(todayErr.error!, todayErr.status || 403, todayErr.code);
  }

  // Validate establishment is in user's scope (already checked by validateModuleAccess via has_module_access)
  if (!adminCtx!.establishmentIds.includes(establishment_id)) {
    return jsonErr("Out of scope - establishment not accessible", 403, "OUT_OF_SCOPE");
  }

  const { data: targetProfile } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", target_user_id)
    .single();

  if (!targetProfile || targetProfile.organization_id !== adminCtx!.organizationId) {
    return jsonErr("Target user not in admin organization", 403, "OUT_OF_SCOPE");
  }

  // HOTFIX: Verify target user is assigned to the establishment
  const { data: userEstablishment } = await supabaseAdmin
    .from("user_establishments")
    .select("id")
    .eq("user_id", target_user_id)
    .eq("establishment_id", establishment_id)
    .single();

  if (!userEstablishment) {
    return jsonErr(
      "L'utilisateur n'est pas rattaché à cet établissement",
      403,
      "USER_NOT_IN_ESTABLISHMENT"
    );
  }

  const { conflict, nextSequence } = await checkBadgeConflict(supabaseAdmin, {
    targetUserId: target_user_id,
    establishmentId: establishment_id,
    dayDate: day_date,
    eventType: event_type,
  });

  if (conflict) {
    return jsonErr(conflict.error!, conflict.status || 400, conflict.code);
  }

  const sequenceIndex = body.sequence_index || nextSequence;

  // === FIX B1: EXTRA LOGIC FOR CLOCK_OUT (same as userHandlers) ===
  // Get settings + planned shift + cutoff for timestamp-based calculations
  const { data: settings } = await supabaseAdmin
    .from("badgeuse_settings")
    .select("*")
    .eq("establishment_id", establishment_id)
    .single();

  const cfg: BadgeSettings = settings || DEFAULT_SETTINGS;

  // Get establishment cutoff for timestamp-based calculations
  const { data: establishment } = await supabaseAdmin
    .from("establishments")
    .select("service_day_cutoff")
    .eq("id", establishment_id)
    .single();

  const serviceDayCutoff: string = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

  const { data: plannedShifts } = await supabaseAdmin
    .from("planning_shifts")
    .select("start_time, end_time")
    .eq("user_id", target_user_id)
    .eq("establishment_id", establishment_id)
    .eq("shift_date", day_date)
    .order("start_time", { ascending: true });

  const plannedShift: PlannedShift | null = plannedShifts?.[sequenceIndex - 1] || null;

  // === V9: BADGE_TOO_EARLY CHECK USING ABSOLUTE TIMESTAMPS ===
  // Uses checkEarlyArrival() with service day logic (same pattern as checkEarlyDeparture)
  if (event_type === "clock_in" && plannedShift && cfg.early_arrival_limit_min > 0 && !earlyArrivalConfirmed) {
    const occurredAtDate = new Date(occurred_at);
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    
    const earlyCheck = checkEarlyArrival(
      occurredAtDate,
      plannedStartStr,
      plannedEndStr,
      day_date,
      serviceDayCutoff,
      cfg.early_arrival_limit_min
    );
    
    if (earlyCheck.isTooEarly) {
      // Return warning for admin to confirm
      return jsonOk(
        {
          success: false,
          code: "BADGE_TOO_EARLY",
          warning: "BADGE_TOO_EARLY",
          shift_start: plannedStartStr,
          early_limit: cfg.early_arrival_limit_min,
          minutes_early: earlyCheck.minutesEarly,
        },
        200
      );
    }
  }

  let usePlannedEndForClockOut = false;
  let extraMinutes = 0;

  // V10: EXTRA logic for clock_out using absolute timestamps
  if (event_type === "clock_out" && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const occurredAtDate = new Date(occurred_at);
    
    // V10: Use checkEarlyDeparture for absolute timestamp comparison
    const earlyCheck = checkEarlyDeparture(
      occurredAtDate,
      plannedStartStr,
      plannedEndStr,
      day_date,
      serviceDayCutoff
    );
    
    // Calculate late properly: if NOT early departure, compute how many minutes AFTER planned end
    // checkEarlyDeparture returns minutesEarly clamped to 0, so we need to calculate late separately
    let late: number;
    if (earlyCheck.isEarlyDeparture) {
      late = -earlyCheck.minutesEarly; // Negative = left early
    } else {
      // Badge is after planned end: calculate actual late minutes
      const plannedEndTs = new Date(earlyCheck.plannedEndTs);
      const lateMs = occurredAtDate.getTime() - plannedEndTs.getTime();
      late = Math.floor(lateMs / 60000);
    }
    extraMinutes = late;

    // Defensive: accept "true" (string) as well for early_exit_confirmed
    const earlyExitConfirmed = (body as Record<string, unknown>).early_exit_confirmed === true || 
      (body as Record<string, unknown>).early_exit_confirmed === "true";

    // PHASE 3: Check for early departure (before shift end)
    if (earlyCheck.isEarlyDeparture && !earlyExitConfirmed) {
      return jsonOk(
        {
          success: false,
          code: "SHIFT_NOT_FINISHED",
          planned_end: plannedEndStr,
          early_minutes: earlyCheck.minutesEarly,
        },
        200
      );
    }

    // If late beyond tolerance → warning (1st call) or process (2nd call)
    if (late > cfg.departure_tolerance_min) {
      if (extraConfirmed !== true) {
        // 1st call: return warning WITHOUT inserting
        return jsonOk(
          {
            success: true,
            warning: "EXTRA_SUSPECTED",
            extra_minutes: late,
            planned_end: plannedEndStr,
          },
          200
        );
      }
      // 2nd call: user made a choice
      if (forcePlannedEnd) {
        usePlannedEndForClockOut = true;
      }
    }
  }

  // === FIX C: Calculate late_minutes for clock_in (with V10 timestamps) ===
  let lateMinutes: number | null = null;
  if (event_type === "clock_in" && plannedShift) {
    const clockInResult = computeClockInEffectiveAndLateV2(
      new Date(occurred_at),
      plannedShift.start_time.slice(0, 5),
      day_date,
      serviceDayCutoff,
      cfg.arrival_tolerance_min
    );
    lateMinutes = clockInResult.lateMinutes;
    console.log(`[admin_create] clock_in late_minutes: ${lateMinutes} (with tolerance ${cfg.arrival_tolerance_min})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1.2 SSOT: Compute early_departure_minutes for clock_out
  // ═══════════════════════════════════════════════════════════════════════════
  // 🛑 PHASE 2.2 GUARD: early_departure_minutes MUST ONLY be set for clock_out
  // If this invariant is ever violated, log it for debugging but do not throw
  // (the DB constraint will reject the insert anyway)
  // ═══════════════════════════════════════════════════════════════════════════
  let earlyDepartureMinutes: number | null = null;
  if (event_type === "clock_out" && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const earlyCheck = checkEarlyDeparture(
      new Date(occurred_at),
      plannedStartStr,
      plannedEndStr,
      day_date,
      serviceDayCutoff
    );
    // SSOT: 0 = on-time or late departure, >0 = early departure, null only if no shift
    earlyDepartureMinutes = Math.max(0, earlyCheck.minutesEarly);
    console.log(`[admin_create] clock_out early_departure_minutes: ${earlyDepartureMinutes}`);
  }
  
  // 🛑 PHASE 2.2 ASSERT: Verify SSOT invariant before insert
  if (event_type !== "clock_out" && earlyDepartureMinutes !== null) {
    console.error(`[SSOT VIOLATION] early_departure_minutes=${earlyDepartureMinutes} on ${event_type} event. Forcing to null.`);
    earlyDepartureMinutes = null;
  }

  // Compute effectiveAt (use planned end if force_planned_end)
  let effectiveAt: string;
  if (usePlannedEndForClockOut && plannedShift) {
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    effectiveAt = buildParisTimestamp(day_date, plannedEndStr);
  } else {
    effectiveAt = await recalculateEffectiveAt(supabaseAdmin, {
      occurredAt: new Date(occurred_at),
      eventType: event_type,
      targetUserId: target_user_id,
      establishmentId: establishment_id,
      dayDate: day_date,
      sequenceIndex,
    });
  }

  // === PHASE 2: IDEMPOTENT CREATE - Check for existing event before insert ===
  const { data: existingSameEvent, error: checkErr } = await supabaseAdmin
    .from("badge_events")
    .select("id, occurred_at, effective_at")
    .eq("user_id", target_user_id)
    .eq("establishment_id", establishment_id)
    .eq("day_date", day_date)
    .eq("sequence_index", sequenceIndex)
    .eq("event_type", event_type);

  if (checkErr) {
    console.error("[admin_create] Error checking existing event:", checkErr.message);
    return jsonErr(checkErr.message, 500);
  }

  // FAIL-CLOSE: If >1 duplicate exists, refuse to proceed
  if (existingSameEvent && existingSameEvent.length > 1) {
    console.error(`[admin_create] DATA_INCONSISTENT: Found ${existingSameEvent.length} duplicate events for ${target_user_id}/${day_date}/seq${sequenceIndex}/${event_type}`);
    return jsonErr(
      `Incohérence détectée: ${existingSameEvent.length} ${event_type} sur le même shift. Utilisez "Reset day" pour corriger.`,
      409,
      "DATA_INCONSISTENT_DUPLICATE_EVENTS"
    );
  }

  let newEvent;
  
  // If exactly 1 exists → UPDATE (idempotent)
  if (existingSameEvent && existingSameEvent.length === 1) {
    console.log(`[admin_create] Idempotent: updating existing ${event_type} ${existingSameEvent[0].id}`);
    const { data: updatedEvent, error: updateErr } = await supabaseAdmin
      .from("badge_events")
      .update({
        occurred_at,
        effective_at: effectiveAt,
        late_minutes: lateMinutes,
        early_departure_minutes: earlyDepartureMinutes,
      })
      .eq("id", existingSameEvent[0].id)
      .select()
      .single();

    if (updateErr) {
      return jsonErr(updateErr.message, 500);
    }
    newEvent = updatedEvent;
  } else {
    // No existing → INSERT normally
    const { data: insertedEvent, error: insertErr } = await supabaseAdmin
      .from("badge_events")
      .insert({
        organization_id: adminCtx!.organizationId,
        establishment_id,
        user_id: target_user_id,
        event_type,
        occurred_at,
        effective_at: effectiveAt,
        day_date,
        sequence_index: sequenceIndex,
        device_id: null,
        late_minutes: lateMinutes,
        early_departure_minutes: earlyDepartureMinutes,
      })
      .select()
      .single();

    if (insertErr) {
      // PHASE 2: Log duplicate attempts (error 23505) to audit_logs
      if (insertErr.code === "23505") {
        console.error("[admin_create] DUPLICATE BLOCKED:", insertErr.message);
        await supabaseAdmin.from("audit_logs").insert({
          action: "badge_duplicate_blocked",
          organization_id: adminCtx!.organizationId,
          user_id: userId,
          target_type: "badge_events",
          target_id: null,
          metadata: {
            target_user_id,
            establishment_id,
            day_date,
            sequence_index: sequenceIndex,
            event_type,
            error_code: insertErr.code,
            error_message: insertErr.message,
            source: "admin_create",
          },
          ip_address: clientInfo?.ipAddress || null,
          user_agent: clientInfo?.userAgent || null,
        });
        return jsonErr("Événement badge déjà enregistré", 409, "BADGE_DUPLICATE_BLOCKED");
      }
      return jsonErr(insertErr.message, 500);
    }
    newEvent = insertedEvent;
  }

  // === FIX B1: Create extra_events if admin confirmed "Oui extra" ===
  if (event_type === "clock_out" && extraConfirmed && !forcePlannedEnd && extraMinutes > 0 && plannedShift) {
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const extraStartAt = buildParisTimestamp(day_date, plannedEndStr);
    const extraEndAt = occurred_at; // already ISO string

    const { error: extraInsertError } = await supabaseAdmin
      .from("extra_events")
      .insert({
        badge_event_id: newEvent.id,
        organization_id: adminCtx!.organizationId,
        establishment_id,
        user_id: target_user_id,
        day_date,
        extra_minutes: extraMinutes,
        status: "pending",
        extra_start_at: extraStartAt,
        extra_end_at: extraEndAt,
      });

    if (extraInsertError) {
      console.error("[admin_create] Failed to create extra_event:", extraInsertError.message);
    } else {
      console.log(`[admin_create] Created extra_event for ${target_user_id}: ${extraMinutes}min`);
    }
  }

  // PHASE 3.3: WARN if early_departure_minutes set on non-clock_out (should never happen)
  warnIfInvalidEarlyDeparture(event_type, earlyDepartureMinutes, newEvent.id);
  
  // PHASE 3.3: Log early departure creation for monitoring
  if (event_type === "clock_out" && earlyDepartureMinutes && earlyDepartureMinutes > 0) {
    logEarlyDepartureCreated(target_user_id!, day_date, earlyDepartureMinutes, sequenceIndex);
  }

  await logAdminAction(supabaseAdmin, "BADGE_EVENT_CREATE", adminCtx!, {
    targetUserId: target_user_id,
    badgeEventId: newEvent.id,
    establishmentId: establishment_id,
    dayDate: day_date,
    after: { occurred_at, effective_at: effectiveAt, event_type, extra_confirmed: extraConfirmed, force_planned_end: forcePlannedEnd },
  }, clientInfo);

  return jsonOk({ success: true, event: newEvent }, 201);
}

/**
 * Handle admin_reset_day action
 * Deletes ALL badge_events for a target user on a specific day + establishment
 * Used to fully reset badgeuse state when admin removes presence
 * 
 * NOTE: Allows historical dates (no today-only restriction) to support
 * shift modifications that require removing old badge events
 */
export async function handleAdminResetDay(
  supabaseUser: SupabaseClient, // JWT client for RBAC
  supabaseAdmin: SupabaseClient, // Service role for mutations
  userId: string,
  body: AdminResetDayParams,
  clientInfo?: AuditClientInfo,
): Promise<Response> {
  const { target_user_id, establishment_id, day_date } = body;

  if (!target_user_id || !establishment_id || !day_date) {
    return jsonErr("Missing required fields for admin reset day", 400, "MISSING_FIELDS");
  }

  // ✅ RBAC: Check module access using JWT client (auth.uid() context)
  const { context: adminCtx, error: adminErr } = await validateModuleAccess(
    supabaseUser,
    supabaseAdmin,
    userId,
    establishment_id,
    "write"
  );
  if (adminErr) {
    return jsonErr(adminErr.error!, adminErr.status || 403, adminErr.code);
  }

  // NOTE: No validateTodayOnly - allows historical dates for shift modifications

  // Validate establishment is in user's scope (already checked by validateModuleAccess)
  if (!adminCtx!.establishmentIds.includes(establishment_id)) {
    return jsonErr("Out of scope - establishment not accessible", 403, "OUT_OF_SCOPE");
  }

  // Validate target user belongs to admin's organization
  const { data: targetProfile } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", target_user_id)
    .single();

  if (!targetProfile || targetProfile.organization_id !== adminCtx!.organizationId) {
    return jsonErr("Target user not in admin organization", 403, "OUT_OF_SCOPE");
  }

  // HOTFIX: Verify target user is assigned to the establishment
  const { data: userEstablishment } = await supabaseAdmin
    .from("user_establishments")
    .select("id")
    .eq("user_id", target_user_id)
    .eq("establishment_id", establishment_id)
    .single();

  if (!userEstablishment) {
    return jsonErr(
      "L'utilisateur n'est pas rattaché à cet établissement",
      403,
      "USER_NOT_IN_ESTABLISHMENT"
    );
  }

  // Delete ALL badge_events for this user + establishment + day
  const { data: deletedEvents, error: deleteErr } = await supabaseAdmin
    .from("badge_events")
    .delete()
    .eq("user_id", target_user_id)
    .eq("establishment_id", establishment_id)
    .eq("day_date", day_date)
    .select("id, event_type, sequence_index, occurred_at");

  if (deleteErr) {
    return jsonErr(deleteErr.message, 500);
  }

  const deletedCount = deletedEvents?.length || 0;

  // Audit log
  await logAdminAction(supabaseAdmin, "BADGE_EVENT_RESET_DAY", adminCtx!, {
    targetUserId: target_user_id,
    establishmentId: establishment_id,
    dayDate: day_date,
    deletedCount,
    deletedEvents: deletedEvents || [],
  }, clientInfo);

  console.log(`[admin_reset_day] Deleted ${deletedCount} events for user ${target_user_id} on ${day_date}`);

  return jsonOk({ success: true, deleted_count: deletedCount });
}
