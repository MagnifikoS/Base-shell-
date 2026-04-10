/**
 * User (employee) badge flow handlers
 * Handles normal clock_in/clock_out for authenticated employees
 * 
 * V7 SERVICE DAY: Uses get_service_day(establishment_id, ts) RPC as single source of truth
 * V12 NO-SHIFT AUTO-EXTRA: When plannedShift=null, clock_out auto-creates extra (no popup)
 * 
 * - No more hardcoded 00:00-03:00 window
 * - resolvedDayDate is now correctly computed from establishment cutoff
 * - No-shift case: 100% worked time becomes auto extra (pending status)
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeEffectiveAt,
  computeClockInEffectiveAndLateV2,
  verifyPin,
  hashPinPbkdf2,
  pinHashNeedsRehash,
  timeToMinutes,
  findNextShift,
  checkShiftEnded,
  getParisHHMM,
  buildParisTimestamp,
  buildServiceDayTimestamp,
  checkEarlyDeparture,
  checkEarlyArrival,
  DEFAULT_SETTINGS,
  type PlannedShift,
  type BadgeSettings,
} from "./helpers.ts";
import { jsonOk, jsonErr } from "./respond.ts";
import { makeCorsHeaders } from "../../_shared/cors.ts";
import { type AuditClientInfo } from "./adminActions.ts";

const CORS = makeCorsHeaders("OPTIONS, GET, DELETE, PATCH, POST");

interface UserBadgeBody {
  establishment_id: string;
  device_id: string;
  pin?: string;
  selfie_captured?: boolean;
  early_exit_confirmed?: boolean;
  extra_confirmed?: boolean; // 2nd call after EXTRA_SUSPECTED modal (shift-based only)
  force_planned_end?: boolean; // user chose "No extra" → use planned end time (shift-based only)
  early_extra_confirmed?: boolean; // V11: user confirmed early arrival is an extra
}

interface ResolveDoubleShiftBody {
  establishment_id: string;
  device_id: string;
  resolve_type: "forgot_clockout";
  clock_out_time: string; // HH:mm for the missing clock_out
  pin?: string;
  selfie_captured?: boolean;
}

/**
 * Handle normal employee badge flow (clock_in / clock_out)
 * V7: Uses get_service_day RPC for resolvedDayDate
 * V12: No-shift = auto-extra at clock_out (no popup, no confirmation)
 */
export async function handleUserBadge(
  supabaseAdmin: SupabaseClient,
  userId: string,
  body: UserBadgeBody,
  clientInfo?: AuditClientInfo,
): Promise<Response> {
  const {
    establishment_id,
    device_id,
    pin,
    selfie_captured,
    early_exit_confirmed,
    extra_confirmed,
    force_planned_end,
    early_extra_confirmed,
  } = body;

  // Defensive: accept "true" (string) as well
  const extraConfirmed = extra_confirmed === true || (extra_confirmed as unknown) === "true";

  if (!establishment_id || !device_id) {
    return jsonErr("Missing required fields", 400);
  }

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    return jsonErr("Profile not found", 404);
  }

  // Get establishment for service_day_cutoff
  const { data: establishment } = await supabaseAdmin
    .from("establishments")
    .select("service_day_cutoff")
    .eq("id", establishment_id)
    .single();

  // Default cutoff if not found (should not happen in prod)
  const serviceDayCutoff: string = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

  // Get settings
  const { data: settings } = await supabaseAdmin
    .from("badgeuse_settings")
    .select("*")
    .eq("establishment_id", establishment_id)
    .single();

  const cfg: BadgeSettings = settings || DEFAULT_SETTINGS;

  // Device binding
  if (cfg.device_binding_enabled) {
    const { data: userDevices } = await supabaseAdmin
      .from("user_devices")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    const existingDevice = userDevices?.find((d) => d.device_id === device_id);
    if (!existingDevice) {
      if ((userDevices?.length || 0) >= cfg.max_devices_per_user) {
        return jsonErr("Device not authorized", 403, "DEVICE_NOT_BOUND");
      }
      await supabaseAdmin.from("user_devices").insert({
        user_id: userId,
        device_id,
        device_name: "Mobile Device",
        is_active: true,
      });
    } else {
      await supabaseAdmin
        .from("user_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existingDevice.id);
    }
  }

  // PIN validation (SEC-02: with rate limiting)
  if (cfg.require_pin) {
    if (!pin) {
      return jsonErr("PIN required", 400, "PIN_REQUIRED");
    }

    // SEC-02: Check recent failed PIN attempts (last 15 minutes)
    const PIN_RATE_LIMIT_MAX = 5;
    const PIN_RATE_LIMIT_WINDOW_MIN = 15;
    const rateLimitCutoff = new Date(Date.now() - PIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000).toISOString();

    const { count: recentFailedCount } = await supabaseAdmin
      .from("badge_pin_failures")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("establishment_id", establishment_id)
      .gte("attempted_at", rateLimitCutoff);

    if ((recentFailedCount ?? 0) >= PIN_RATE_LIMIT_MAX) {
      return jsonErr("Trop de tentatives. Réessayez dans 15 minutes.", 429, "PIN_RATE_LIMITED");
    }

    const { data: userPin } = await supabaseAdmin
      .from("user_badge_pins")
      .select("pin_hash")
      .eq("user_id", userId)
      .single();

    if (!userPin) {
      return jsonErr("PIN not configured", 400, "PIN_NOT_SET");
    }
    const pinValid = await verifyPin(pin, userPin.pin_hash);
    if (!pinValid) {
      // SEC-02: Record failed PIN attempt
      await supabaseAdmin
        .from("badge_pin_failures")
        .insert({
          user_id: userId,
          establishment_id: establishment_id,
          attempted_at: new Date().toISOString(),
        });

      const remainingAttempts = PIN_RATE_LIMIT_MAX - ((recentFailedCount ?? 0) + 1);
      if (remainingAttempts <= 0) {
        return jsonErr("Trop de tentatives. Réessayez dans 15 minutes.", 429, "PIN_RATE_LIMITED");
      }
      return jsonErr("Invalid PIN", 403, "INVALID_PIN");
    }

    // SEC-01: Transparent PBKDF2 migration — re-hash legacy SHA-256 or bcrypt hashes
    if (pinHashNeedsRehash(userPin.pin_hash)) {
      const pbkdf2Hash = await hashPinPbkdf2(pin);
      await supabaseAdmin
        .from("user_badge_pins")
        .update({ pin_hash: pbkdf2Hash, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    // SEC-02: On successful PIN, clear failed attempts for this user/establishment
    await supabaseAdmin
      .from("badge_pin_failures")
      .delete()
      .eq("user_id", userId)
      .eq("establishment_id", establishment_id);
  }

  // Defensive: accept "true" (string) as well for force_planned_end
  const forcePlannedEnd = force_planned_end === true || (force_planned_end as unknown) === "true";

  // === V7: GET SERVICE DAY FROM RPC (SINGLE SOURCE OF TRUTH) ===
  const occurredAt = new Date();
  
  // Call the RPC to get the correct service day based on establishment cutoff
  const { data: serviceDayResult, error: serviceDayError } = await supabaseAdmin.rpc(
    "get_service_day",
    {
      _establishment_id: establishment_id,
      _ts: occurredAt.toISOString(),
    }
  );

  if (serviceDayError || !serviceDayResult) {
    console.error("[badge-events] Failed to get service day:", serviceDayError);
    return jsonErr("Failed to determine service day", 500, "SERVICE_DAY_ERROR");
  }

  // resolvedDayDate is now the CORRECT service day from the establishment's cutoff
  const resolvedDayDate: string = serviceDayResult;
  
  // Get shifts for the service day (not calendar day)
  const { data: plannedShifts } = await supabaseAdmin
    .from("planning_shifts")
    .select("id, start_time, end_time")
    .eq("user_id", userId)
    .eq("establishment_id", establishment_id)
    .eq("shift_date", resolvedDayDate)
    .order("start_time", { ascending: true });

  // V12: Removed personnel_leaves query - no longer needed
  // No-shift case now treated uniformly regardless of leave status
  
  // Get events for the resolved day
  const { data: todayEvents } = await supabaseAdmin
    .from("badge_events")
    .select("*")
    .eq("user_id", userId)
    .eq("establishment_id", establishment_id)
    .eq("day_date", resolvedDayDate)
    .order("occurred_at", { ascending: true });

  let eventType: "clock_in" | "clock_out";
  let sequenceIndex = 1;

  // === MULTI-SHIFT SELECTION LOGIC ===
  const completedSessions = new Set<number>();
  let openSessionIndex: number | null = null;
  
  if (todayEvents?.length) {
    const eventsBySeq: Record<number, { hasClockIn: boolean; hasClockOut: boolean }> = {};
    for (const ev of todayEvents) {
      if (!eventsBySeq[ev.sequence_index]) {
        eventsBySeq[ev.sequence_index] = { hasClockIn: false, hasClockOut: false };
      }
      if (ev.event_type === "clock_in") eventsBySeq[ev.sequence_index].hasClockIn = true;
      if (ev.event_type === "clock_out") eventsBySeq[ev.sequence_index].hasClockOut = true;
    }
    
    for (const [seqStr, session] of Object.entries(eventsBySeq)) {
      const seq = parseInt(seqStr, 10);
      if (session.hasClockIn && session.hasClockOut) {
        completedSessions.add(seq);
      } else if (session.hasClockIn && !session.hasClockOut) {
        openSessionIndex = seq;
      }
    }
  }

  // Determine event type and sequence index
  const nowTimeParis = getParisHHMM(occurredAt);
  const nowMinutes = timeToMinutes(nowTimeParis);

  if (openSessionIndex !== null) {
    // ═══════════════════════════════════════════════════════════════════════════
    // V14 DOUBLE-SHIFT DETECTION: If there's an open session but the planned
    // shift end has passed AND there's a 2nd shift available, detect this as
    // a "forgot clock_out" scenario instead of recording a normal clock_out.
    // ═══════════════════════════════════════════════════════════════════════════
    const openShift = plannedShifts?.[openSessionIndex - 1] || null;
    const hasNextShift = plannedShifts && plannedShifts.length > openSessionIndex;

    if (openShift && hasNextShift) {
      const openShiftEndMin = timeToMinutes(openShift.end_time.slice(0, 5));
      const nextShift = plannedShifts[openSessionIndex];
      const nextShiftStartMin = timeToMinutes(nextShift.start_time.slice(0, 5));

      // Conditions for DOUBLE_SHIFT_DETECTED:
      // 1. Current time is past the planned end of the open shift
      // 2. Current time is near the start of the next shift (within 60 min)
      // 3. The open session's shift has been over for a while (> departure_tolerance)
      const pastOpenShiftEnd = nowMinutes > openShiftEndMin + cfg.departure_tolerance_min;
      const nearNextShiftStart = Math.abs(nowMinutes - nextShiftStartMin) <= 60;

      if (pastOpenShiftEnd && nearNextShiftStart) {
        const openClockIn = todayEvents?.find(
          (ev) => ev.event_type === "clock_in" && ev.sequence_index === openSessionIndex
        );

        if (openClockIn) {
          const openClockInTime = getParisHHMM(new Date(openClockIn.occurred_at));
          return jsonOk({
            success: false,
            code: "DOUBLE_SHIFT_DETECTED",
            open_clock_in_time: openClockInTime,
            open_clock_in_at: openClockIn.occurred_at,
            planned_end_time: openShift.end_time.slice(0, 5),
            sequence_index: openSessionIndex,
            next_shift_start: nextShift.start_time.slice(0, 5),
            next_shift_end: nextShift.end_time.slice(0, 5),
            message: `Pointage d'entrée à ${openClockInTime} sans sortie enregistrée`,
          }, 200);
        }
      }
    }

    // Normal flow: open session → clock_out
    eventType = "clock_out";
    sequenceIndex = openSessionIndex;
  } else if (!todayEvents?.length) {
    eventType = "clock_in";
    sequenceIndex = 1;
  } else {
    const maxCompletedSeq = Math.max(...completedSessions, 0);
    if (maxCompletedSeq >= 2) {
      return jsonErr("Maximum 2 shifts per day", 400, "MAX_SHIFTS");
    }
    eventType = "clock_in";
    sequenceIndex = maxCompletedSeq + 1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // V14 DUPLICATE BADGE GUARD: Prevent same event type within 5 minutes
  // Must be AFTER eventType determination but BEFORE shift matching logic
  // ═══════════════════════════════════════════════════════════════════════════
  if (todayEvents && todayEvents.length > 0) {
    const lastEvent = todayEvents[todayEvents.length - 1];
    const lastEventTime = new Date(lastEvent.occurred_at);
    const timeDiffMinutes = (occurredAt.getTime() - lastEventTime.getTime()) / 60000;

    if (lastEvent.event_type === eventType && timeDiffMinutes >= 0 && timeDiffMinutes < 5) {
      const lastTimeFormatted = getParisHHMM(lastEventTime);
      return jsonOk({
        success: false,
        code: "DUPLICATE_BADGE",
        message: `Déjà pointé à ${lastTimeFormatted}`,
        last_event_time: lastTimeFormatted,
      }, 200);
    }
  }

  // Selfie required for clock_in
  if (eventType === "clock_in" && cfg.require_selfie && !selfie_captured) {
    return jsonErr("Selfie required for arrival", 400, "SELFIE_REQUIRED");
  }

  // === SMART SHIFT SELECTION ===
  // V13: Enhanced shift matching with time-proximity and forgotten badge detection
  let plannedShift: PlannedShift | null = null;
  let warning: string | null = null;
  let forgottenBadgeWarning: string | null = null;

  if (eventType === "clock_out") {
    // Use shift at sequenceIndex (matched to the open session)
    plannedShift = plannedShifts?.[sequenceIndex - 1] || null;

    // V13: Better shift matching for clock_out — match by time proximity if default doesn't fit
    if (plannedShift && plannedShifts && plannedShifts.length > 1) {
      const plannedEndMin = timeToMinutes(plannedShift.end_time.slice(0, 5));
      const currentDist = Math.abs(nowMinutes - plannedEndMin);

      // Check if another uncompleted shift is closer
      for (let i = 0; i < plannedShifts.length; i++) {
        const shiftSeq = i + 1;
        if (shiftSeq === sequenceIndex) continue;
        if (completedSessions.has(shiftSeq)) continue;

        const altEndMin = timeToMinutes(plannedShifts[i].end_time.slice(0, 5));
        const altDist = Math.abs(nowMinutes - altEndMin);

        // Only switch if the alternative is significantly closer (>30min difference)
        if (altDist < currentDist && (currentDist - altDist) > 30) {
          plannedShift = plannedShifts[i];
          sequenceIndex = shiftSeq;
          break;
        }
      }
    }
  } else {
    // clock_in: find the best shift to start
    if (plannedShifts && plannedShifts.length > 0) {
      const availableShifts: { shift: PlannedShift; index: number; startMin: number }[] = [];

      for (let i = 0; i < plannedShifts.length; i++) {
        const shiftSeq = i + 1;
        if (!completedSessions.has(shiftSeq)) {
          const shift = plannedShifts[i];
          const startMin = timeToMinutes(shift.start_time.slice(0, 5));
          availableShifts.push({ shift, index: i, startMin });
        }
      }

      if (availableShifts.length > 0) {
        // V13: Enhanced proximity sorting — prefer shifts within +-60min window
        availableShifts.sort((a, b) => {
          const distA = Math.abs(a.startMin - nowMinutes);
          const distB = Math.abs(b.startMin - nowMinutes);
          const aInWindow = distA <= 60;
          const bInWindow = distB <= 60;
          const aStarted = a.startMin <= nowMinutes;
          const bStarted = b.startMin <= nowMinutes;

          // Prefer shifts within the 60min window
          if (aInWindow && !bInWindow) return -1;
          if (!aInWindow && bInWindow) return 1;
          // Among same-window shifts, prefer already started
          if (aStarted && !bStarted) return -1;
          if (!aStarted && bStarted) return 1;
          return distA - distB;
        });

        const chosen = availableShifts[0];
        plannedShift = chosen.shift;
        sequenceIndex = chosen.index + 1;

        // V13: Warn if badge time is far from any shift (>30min from closest)
        const closestDist = Math.abs(chosen.startMin - nowMinutes);
        if (closestDist > 30) {
          warning = "BADGE_SHIFT_MISMATCH";
        }
      }
    }

    // V13: Detect forgotten clock_out — if we're starting sequence 2 but
    // sequence 1 had clock_in without clock_out (and shift 1 should be over)
    if (sequenceIndex === 2 && plannedShifts && plannedShifts.length >= 2) {
      const seq1Events = todayEvents?.filter(ev => ev.sequence_index === 1) || [];
      const seq1HasClockIn = seq1Events.some(ev => ev.event_type === "clock_in");
      const seq1HasClockOut = seq1Events.some(ev => ev.event_type === "clock_out");

      if (seq1HasClockIn && !seq1HasClockOut) {
        const shift1End = plannedShifts[0].end_time.slice(0, 5);
        const shift1EndMin = timeToMinutes(shift1End);
        // Only warn if shift 1 should be over by now
        if (nowMinutes > shift1EndMin) {
          forgottenBadgeWarning = `Oubli de pointage détecté pour le premier shift (départ ${shift1End} non enregistré)`;
        }
      }
    }
  }

  // Guard: BADGE_TOO_EARLY - clock_in too far before shift start
  // V9: Uses absolute timestamps via checkEarlyArrival (same pattern as checkEarlyDeparture)
  // V11: Can be bypassed with early_extra_confirmed=true (user confirmed this is an extra)
  let earlyArrivalExtraMinutes = 0; // V11: stored for extra_event creation if confirmed
  if (eventType === "clock_in" && plannedShift && cfg.early_arrival_limit_min > 0) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    
    const earlyCheck = checkEarlyArrival(
      occurredAt,
      plannedStartStr,
      plannedEndStr,
      resolvedDayDate,
      serviceDayCutoff,
      cfg.early_arrival_limit_min
    );
    
    if (earlyCheck.isTooEarly) {
      // V11: If user confirmed early arrival is an extra, bypass guard and store minutes
      if (early_extra_confirmed === true) {
        earlyArrivalExtraMinutes = earlyCheck.minutesEarly;
        // Continue with badge creation, extra_event will be created after insert
      } else {
        // Normal flow: return error asking user to choose
        return new Response(
          JSON.stringify({
            error: `Badge trop tôt. Votre shift commence à ${plannedStartStr}.`,
            code: "BADGE_TOO_EARLY",
            shift_start: plannedStartStr,
            early_limit: cfg.early_arrival_limit_min,
            minutes_early: earlyCheck.minutesEarly,
          }),
          {
            status: 400,
            headers: {
              ...CORS,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }
  }

  // Guard: Clock_in after shift ended
  // V10: Uses absolute timestamps via checkShiftEnded (eliminates all HH:mm edge cases)
  if (eventType === "clock_in" && plannedShift) {
    const plannedEnd = plannedShift.end_time.slice(0, 5);
    const plannedStart = plannedShift.start_time.slice(0, 5);
    
    if (checkShiftEnded(occurredAt, plannedStart, plannedEnd, resolvedDayDate, serviceDayCutoff)) {
      // Try to find another available shift that hasn't ended
      const otherAvailable = plannedShifts?.filter((s, i) => {
        const seq = i + 1;
        if (completedSessions.has(seq)) return false;
        if (seq === sequenceIndex) return false;
        const endTime = s.end_time.slice(0, 5);
        const startTime = s.start_time.slice(0, 5);
        return !checkShiftEnded(occurredAt, startTime, endTime, resolvedDayDate, serviceDayCutoff);
      });
      
      if (otherAvailable && otherAvailable.length > 0) {
        const otherShift = otherAvailable[0];
        const otherIndex = plannedShifts!.indexOf(otherShift);
        plannedShift = otherShift;
        sequenceIndex = otherIndex + 1;
      } else {
        const nextShift = findNextShift(plannedShifts, sequenceIndex);
        return new Response(
          JSON.stringify({
            error: "Le shift est déjà terminé",
            code: "SHIFT_FINISHED",
            next_shift: nextShift,
          }),
          {
            status: 400,
            headers: {
              ...CORS,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }
  }

  // Guards and extra detection for clock_out
  let usePlannedEndForClockOut = false;
  let extraMinutes = 0;
  
  // V12: No-shift auto-extra mode (replaces V6 leave-based extra)
  // When plannedShift=null, ALL worked time becomes auto-extra (no popup)
  let autoNoShiftExtra = false;
  let noShiftExtraMinutes = 0;
  let noShiftClockInAt: string | null = null;

  // V12: If clock_out AND no planned shift → auto-extra for all worked time
  // This applies uniformly regardless of leave status (CP/absence/repos/empty)
  if (eventType === "clock_out" && !plannedShift) {
    const clockInEvent = todayEvents?.find(
      (ev) => ev.event_type === "clock_in" && ev.sequence_index === sequenceIndex
    );
    
    if (clockInEvent) {
      const clockInTime = new Date(clockInEvent.occurred_at);
      const workedMs = occurredAt.getTime() - clockInTime.getTime();
      noShiftExtraMinutes = Math.floor(workedMs / 60000);
      noShiftClockInAt = clockInEvent.occurred_at;
      autoNoShiftExtra = true;
      // V12: NO return, NO popup - continue to badge insert
      // Extra will be auto-created after badge insert
    }
    // If no clock_in found (abnormal case), just continue without extra
  }
  
  // Standard shift-based extra detection (when plannedShift exists)
  if (eventType === "clock_out" && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    
    // ========================================================================
    // V8: USE TIMESTAMP-BASED COMPARISON WITH SERVICE DAY
    // ========================================================================
    // Using checkEarlyDeparture with absolute timestamps eliminates all
    // edge cases with post-midnight badges and overnight shifts.
    //
    // The function:
    // 1. Builds proper UTC timestamps for planned start/end based on service day
    // 2. Handles overnight shifts (end <= start)
    // 3. Compares occurredAt (already a Date) directly with plannedEndTs
    //
    // Example: Shift 09:00-17:00, service day = yesterday, badge at 02:00 today
    //   - plannedEndTs = yesterday 17:00 Paris (UTC timestamp)
    //   - occurredAt = today 02:00 Paris (UTC timestamp)
    //   - today 02:00 > yesterday 17:00 → NOT early departure ✅
    // ========================================================================
    
    const earlyCheck = checkEarlyDeparture(
      occurredAt,
      plannedStartStr,
      plannedEndStr,
      resolvedDayDate,
      serviceDayCutoff
    );

    // Early exit guard
    if (earlyCheck.isEarlyDeparture && !early_exit_confirmed) {
      return new Response(
        JSON.stringify({
          error: "Shift not finished yet",
          code: "SHIFT_NOT_FINISHED",
          planned_end: plannedEndStr,
        }),
        {
          status: 400,
          headers: {
            ...CORS,
            "Content-Type": "application/json",
          },
        }
      );
    }
    
    // Calculate extra time using absolute timestamps (not clamped minutesEarly)
    // checkEarlyDeparture.minutesEarly clamps to 0 when late, so compute late directly
    let late = 0;
    if (!earlyCheck.isEarlyDeparture) {
      // Employee clocked out AFTER planned end → compute late minutes from timestamps
      const plannedEndMs = new Date(earlyCheck.plannedEndTs).getTime();
      late = Math.floor((occurredAt.getTime() - plannedEndMs) / 60000);
    }
    extraMinutes = late;
    
    // V6 UNIFIED: EXTRA_SUSPECTED only if late > tolerance AND shift exists
    if (late > cfg.departure_tolerance_min) {
      if (extraConfirmed !== true) {
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

      // extraConfirmed=true: user made a choice
      if (forcePlannedEnd) {
        usePlannedEndForClockOut = true;
      }
    }
  }

  // Compute effectiveAt
  // V15: Use buildServiceDayTimestamp (cutoff-aware) instead of buildParisTimestamp
  // to fix off-by-one-day for overnight shifts (e.g. end_time "00:00" on service day)
  let effectiveAt: string;
  if (usePlannedEndForClockOut && plannedShift) {
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    effectiveAt = buildServiceDayTimestamp(resolvedDayDate, plannedEndStr, serviceDayCutoff);
  } else {
    effectiveAt = computeEffectiveAt(occurredAt, eventType, plannedShift, resolvedDayDate, serviceDayCutoff, cfg);
  }

  // Compute late_minutes for clock_in (using timestamp-aware V2 helper)
  // V10: Uses absolute timestamps for correct overnight/service-day handling
  let lateMinutes: number | null = null;
  if (eventType === "clock_in" && plannedShift) {
    const clockInResult = computeClockInEffectiveAndLateV2(
      occurredAt,
      plannedShift.start_time.slice(0, 5),
      resolvedDayDate,
      serviceDayCutoff,
      cfg.arrival_tolerance_min
    );
    lateMinutes = clockInResult.lateMinutes;
    // Note: effectiveAt is already computed above via computeEffectiveAt, which also respects tolerance
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1.2 SSOT: Compute early_departure_minutes for clock_out
  // This is stored in DB as the SINGLE SOURCE OF TRUTH - no frontend recalc
  // ═══════════════════════════════════════════════════════════════════════════
  // 🛑 PHASE 2.2 GUARD: early_departure_minutes MUST ONLY be set for clock_out
  // If this invariant is ever violated, log it for debugging but do not throw
  // (the DB constraint will reject the insert anyway)
  // ═══════════════════════════════════════════════════════════════════════════
  let earlyDepartureMinutes: number | null = null;
  if (eventType === "clock_out" && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const earlyCheck = checkEarlyDeparture(
      occurredAt,
      plannedStartStr,
      plannedEndStr,
      resolvedDayDate,
      serviceDayCutoff
    );
    // SSOT: 0 = on-time or late departure, >0 = early departure, null only if no shift
    earlyDepartureMinutes = Math.max(0, earlyCheck.minutesEarly);
  }
  
  // 🛑 PHASE 2.2 ASSERT: Verify SSOT invariant before insert
  if (eventType !== "clock_out" && earlyDepartureMinutes !== null) {
    console.error(`[SSOT VIOLATION] early_departure_minutes=${earlyDepartureMinutes} on ${eventType} event. Forcing to null.`);
    earlyDepartureMinutes = null;
  }

  // ═══ Step 7.2: Resolve shift_id for this badge event ═══
  let resolvedShiftId: string | null = null;
  let shiftMatchStatus: string | null = null;

  if (plannedShift) {
    // plannedShift is the shift we matched above via proximity logic
    const matchedShift = plannedShifts?.[sequenceIndex - 1];
    if (matchedShift && matchedShift.id) {
      // Check for ambiguity: are there other uncompleted shifts with similar start time?
      const candidateShifts = (plannedShifts || []).filter((s, i) => {
        if (completedSessions.has(i + 1)) return false;
        const startMin = timeToMinutes(s.start_time.slice(0, 5));
        const matchedStartMin = timeToMinutes(matchedShift.start_time.slice(0, 5));
        return Math.abs(startMin - matchedStartMin) <= 15 && s.id !== matchedShift.id;
      });

      if (candidateShifts.length > 0) {
        // Multiple shifts within 15min of each other → ambiguous
        shiftMatchStatus = "ambiguous";
        // Still set the shift_id to best match, but flag it
        resolvedShiftId = matchedShift.id;
      } else {
        resolvedShiftId = matchedShift.id;
        shiftMatchStatus = "matched";
      }
    } else {
      shiftMatchStatus = "unmatched";
    }
  } else {
    shiftMatchStatus = plannedShifts && plannedShifts.length > 0 ? "unmatched" : null;
  }

  // Insert badge_event
  const { data: newEvent, error: insertError } = await supabaseAdmin
    .from("badge_events")
    .insert({
      organization_id: profile.organization_id,
      establishment_id,
      user_id: userId,
      event_type: eventType,
      occurred_at: occurredAt.toISOString(),
      effective_at: effectiveAt,
      day_date: resolvedDayDate,
      sequence_index: sequenceIndex,
      device_id,
      late_minutes: eventType === "clock_in" ? lateMinutes : null,
      early_departure_minutes: eventType === "clock_out" ? earlyDepartureMinutes : null,
      shift_id: resolvedShiftId,
      shift_match_status: shiftMatchStatus,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      console.error("[badge-events] DUPLICATE BLOCKED:", insertError.message);
      await supabaseAdmin.from("audit_logs").insert({
        action: "badge_duplicate_blocked",
        organization_id: profile.organization_id,
        user_id: userId,
        target_type: "badge_events",
        target_id: null,
        metadata: {
          establishment_id,
          day_date: resolvedDayDate,
          sequence_index: sequenceIndex,
          event_type: eventType,
          device_id,
          error_code: insertError.code,
          error_message: insertError.message,
        },
        ip_address: clientInfo?.ipAddress || null,
        user_agent: clientInfo?.userAgent || null,
      });
      return jsonErr("Événement badge déjà enregistré", 409, "BADGE_DUPLICATE_BLOCKED");
    }
    return jsonErr(insertError.message, 500);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // V12: AUTO-CREATE EXTRA FOR NO-SHIFT CASE (no confirmation needed)
  // When plannedShift=null, all worked time is auto-extra
  // ═══════════════════════════════════════════════════════════════════════════
  if (eventType === "clock_out" && autoNoShiftExtra && noShiftExtraMinutes > 0 && noShiftClockInAt) {
    const { error: autoExtraInsertError } = await supabaseAdmin
      .from("extra_events")
      .insert({
        badge_event_id: newEvent.id,
        organization_id: profile.organization_id,
        establishment_id,
        user_id: userId,
        day_date: resolvedDayDate,
        extra_minutes: noShiftExtraMinutes,
        status: "pending",
        extra_start_at: noShiftClockInAt,
        extra_end_at: occurredAt.toISOString(),
      });

    if (autoExtraInsertError) {
      console.error("Failed to create auto extra_event (no-shift):", autoExtraInsertError.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHIFT-BASED EXTRA: Create extra_events if user confirmed "Oui extra"
  // Only for plannedShift !== null (when user confirms via EXTRA_SUSPECTED modal)
  // ═══════════════════════════════════════════════════════════════════════════
  if (eventType === "clock_out" && extraConfirmed && !forcePlannedEnd && extraMinutes > 0 && plannedShift) {
    const plannedEndStr = plannedShift.end_time.slice(0, 5);
    const extraStartAt = buildParisTimestamp(resolvedDayDate, plannedEndStr);
    const extraEndAt = occurredAt.toISOString();

    const { error: extraInsertError } = await supabaseAdmin
      .from("extra_events")
      .insert({
        badge_event_id: newEvent.id,
        organization_id: profile.organization_id,
        establishment_id,
        user_id: userId,
        day_date: resolvedDayDate,
        extra_minutes: extraMinutes,
        status: "pending",
        extra_start_at: extraStartAt,
        extra_end_at: extraEndAt,
      });

    if (extraInsertError) {
      console.error("Failed to create extra_event:", extraInsertError.message);
    }
  }

  // V11: Create extra_events for early arrival extra (clock_in with early_extra_confirmed)
  // The extra time is the minutes worked before the planned shift start
  if (eventType === "clock_in" && earlyArrivalExtraMinutes > 0 && plannedShift) {
    const plannedStartStr = plannedShift.start_time.slice(0, 5);
    const extraStartAt = occurredAt.toISOString(); // actual arrival time
    const extraEndAt = buildParisTimestamp(resolvedDayDate, plannedStartStr); // planned start

    const { error: earlyExtraInsertError } = await supabaseAdmin
      .from("extra_events")
      .insert({
        badge_event_id: newEvent.id,
        organization_id: profile.organization_id,
        establishment_id,
        user_id: userId,
        day_date: resolvedDayDate,
        extra_minutes: earlyArrivalExtraMinutes,
        status: "pending",
        extra_start_at: extraStartAt,
        extra_end_at: extraEndAt,
      });

    if (earlyExtraInsertError) {
      // Log but don't fail the main badge event
      console.error("Failed to create early arrival extra_event:", earlyExtraInsertError.message);
    }
  }

  // Build response
  const response: Record<string, unknown> = {
    success: true,
    event: newEvent,
    message: eventType === "clock_in" ? "Arrivée enregistrée" : "Départ enregistré",
    late_minutes: lateMinutes,
  };

  if (warning === "EXTRA_SUSPECTED" && plannedShift) {
    response.warning = warning;
    response.extra_minutes = extraMinutes;
    response.planned_end = plannedShift.end_time.slice(0, 5);
  }

  // V13: Include shift mismatch warning
  if (warning === "BADGE_SHIFT_MISMATCH") {
    response.badge_shift_mismatch = true;
    response.mismatch_message = "Incohérence horaire détectée";
  }

  // V13: Include forgotten badge warning
  if (forgottenBadgeWarning) {
    response.forgotten_badge_warning = forgottenBadgeWarning;
  }

  return jsonOk(response, 201);
}

/**
 * Handle resolution of a double-shift scenario where the user forgot to clock out.
 * V14: Auto-creates the missing clock_out for the open session, then records a new clock_in.
 *
 * Steps:
 * 1. Insert missing clock_out for the open session at the specified time
 * 2. Record the new clock_in for the next session
 */
export async function handleResolveDoubleShift(
  supabaseAdmin: SupabaseClient,
  userId: string,
  body: ResolveDoubleShiftBody,
  clientInfo?: AuditClientInfo,
): Promise<Response> {
  const { establishment_id, device_id, resolve_type, clock_out_time } = body;

  if (!establishment_id || !device_id || !clock_out_time) {
    return jsonErr("Missing required fields for resolve_double_shift", 400);
  }

  if (resolve_type !== "forgot_clockout") {
    return jsonErr("Invalid resolve_type. Expected 'forgot_clockout'.", 400, "INVALID_RESOLVE_TYPE");
  }

  // Validate clock_out_time format (HH:mm)
  if (!/^\d{2}:\d{2}$/.test(clock_out_time)) {
    return jsonErr("Invalid clock_out_time format. Expected HH:mm.", 400, "INVALID_TIME_FORMAT");
  }

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    return jsonErr("Profile not found", 404);
  }

  // Get establishment for service_day_cutoff
  const { data: establishment } = await supabaseAdmin
    .from("establishments")
    .select("service_day_cutoff")
    .eq("id", establishment_id)
    .single();

  const serviceDayCutoff: string = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

  // Get settings
  const { data: settings } = await supabaseAdmin
    .from("badgeuse_settings")
    .select("*")
    .eq("establishment_id", establishment_id)
    .single();

  const cfg: BadgeSettings = settings || DEFAULT_SETTINGS;

  // Get current service day
  const occurredAt = new Date();
  const { data: serviceDayResult, error: serviceDayError } = await supabaseAdmin.rpc(
    "get_service_day",
    { _establishment_id: establishment_id, _ts: occurredAt.toISOString() }
  );

  if (serviceDayError || !serviceDayResult) {
    return jsonErr("Failed to determine service day", 500, "SERVICE_DAY_ERROR");
  }

  const resolvedDayDate: string = serviceDayResult;

  // Get today's events
  const { data: todayEvents } = await supabaseAdmin
    .from("badge_events")
    .select("*")
    .eq("user_id", userId)
    .eq("establishment_id", establishment_id)
    .eq("day_date", resolvedDayDate)
    .order("occurred_at", { ascending: true });

  // Find the open session (has clock_in but no clock_out)
  const eventsBySeq: Record<number, { hasClockIn: boolean; hasClockOut: boolean }> = {};
  if (todayEvents) {
    for (const ev of todayEvents) {
      if (!eventsBySeq[ev.sequence_index]) {
        eventsBySeq[ev.sequence_index] = { hasClockIn: false, hasClockOut: false };
      }
      if (ev.event_type === "clock_in") eventsBySeq[ev.sequence_index].hasClockIn = true;
      if (ev.event_type === "clock_out") eventsBySeq[ev.sequence_index].hasClockOut = true;
    }
  }

  let openSessionIndex: number | null = null;
  for (const [seqStr, session] of Object.entries(eventsBySeq)) {
    const seq = parseInt(seqStr, 10);
    if (session.hasClockIn && !session.hasClockOut) {
      openSessionIndex = seq;
    }
  }

  if (openSessionIndex === null) {
    return jsonErr("No open session found to resolve", 400, "NO_OPEN_SESSION");
  }

  // Get planned shifts
  const { data: plannedShifts } = await supabaseAdmin
    .from("planning_shifts")
    .select("start_time, end_time")
    .eq("user_id", userId)
    .eq("establishment_id", establishment_id)
    .eq("shift_date", resolvedDayDate)
    .order("start_time", { ascending: true });

  const openShift = plannedShifts?.[openSessionIndex - 1] || null;

  // Build the missing clock_out timestamp at the specified time
  const clockOutEffectiveAt = buildParisTimestamp(resolvedDayDate, clock_out_time);

  // Insert the missing clock_out for the open session
  const { data: clockOutEvent, error: clockOutInsertError } = await supabaseAdmin
    .from("badge_events")
    .insert({
      organization_id: profile.organization_id,
      establishment_id,
      user_id: userId,
      event_type: "clock_out",
      occurred_at: clockOutEffectiveAt,
      effective_at: clockOutEffectiveAt,
      day_date: resolvedDayDate,
      sequence_index: openSessionIndex,
      device_id,
      late_minutes: null,
      early_departure_minutes: 0,
    })
    .select()
    .single();

  if (clockOutInsertError) {
    console.error("[badge-events] Failed to insert missing clock_out:", clockOutInsertError.message);
    return jsonErr("Failed to insert missing clock_out", 500);
  }

  // Audit log for the auto-created clock_out
  await supabaseAdmin.from("audit_logs").insert({
    action: "badge_resolve_double_shift",
    organization_id: profile.organization_id,
    user_id: userId,
    target_type: "badge_events",
    target_id: clockOutEvent.id,
    metadata: {
      establishment_id,
      day_date: resolvedDayDate,
      sequence_index: openSessionIndex,
      resolve_type,
      auto_clock_out_time: clock_out_time,
      original_shift_end: openShift?.end_time?.slice(0, 5) || null,
    },
    ip_address: clientInfo?.ipAddress || null,
    user_agent: clientInfo?.userAgent || null,
  });

  // Now record the new clock_in for the next session
  const nextSequenceIndex = openSessionIndex + 1;
  if (nextSequenceIndex > 2) {
    // Already resolved the open session, but no more shifts allowed
    return jsonOk({
      success: true,
      resolved_clock_out: clockOutEvent,
      message: "Sortie enregistrée. Maximum de shifts atteint pour aujourd'hui.",
      code: "RESOLVED_NO_MORE_SHIFTS",
    }, 201);
  }

  const nextShift = plannedShifts?.[nextSequenceIndex - 1] || null;
  const clockInEffectiveAt = computeEffectiveAt(occurredAt, "clock_in", nextShift, resolvedDayDate, serviceDayCutoff, cfg);

  // Compute late_minutes for the new clock_in
  let lateMinutes: number | null = null;
  if (nextShift) {
    const clockInResult = computeClockInEffectiveAndLateV2(
      occurredAt,
      nextShift.start_time.slice(0, 5),
      resolvedDayDate,
      serviceDayCutoff,
      cfg.arrival_tolerance_min
    );
    lateMinutes = clockInResult.lateMinutes;
  }

  const { data: clockInEvent, error: clockInInsertError } = await supabaseAdmin
    .from("badge_events")
    .insert({
      organization_id: profile.organization_id,
      establishment_id,
      user_id: userId,
      event_type: "clock_in",
      occurred_at: occurredAt.toISOString(),
      effective_at: clockInEffectiveAt,
      day_date: resolvedDayDate,
      sequence_index: nextSequenceIndex,
      device_id,
      late_minutes: lateMinutes,
      early_departure_minutes: null,
    })
    .select()
    .single();

  if (clockInInsertError) {
    console.error("[badge-events] Failed to insert new clock_in after resolve:", clockInInsertError.message);
    return jsonErr("Missing clock_out resolved, but failed to record new clock_in", 500);
  }

  return jsonOk({
    success: true,
    resolved_clock_out: clockOutEvent,
    event: clockInEvent,
    message: "Sortie précédente enregistrée et nouvelle arrivée confirmée",
    late_minutes: lateMinutes,
  }, 201);
}
