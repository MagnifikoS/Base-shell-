/**
 * Badgeuse Backfill Edge Function
 * Creates badge_events from planning_shifts for a date range
 * 
 * V8 SERVICE DAY FIX: Uses get_service_day RPC for day_date classification
 * - day_date = get_service_day(establishment_id, effective_at) - SAME AS LIVE
 * - Respects establishment's service_day_cutoff parameter
 * - Idempotent upsert: relaunching replace mode won't create duplicates
 * 
 * CORS enabled, RBAC: admin only
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("badgeuse-backfill");
const CORS = makeCorsHeaders("POST, OPTIONS");

interface BackfillRequest {
  establishment_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  mode?: "skip" | "replace"; // skip = don't overwrite, replace = delete then recreate
  preview?: boolean;
}

interface BackfillResponse {
  success: boolean;
  days_covered: number;
  shifts_found?: number;
  events_to_create?: number;
  created_count?: number;
  skipped_count?: number;
  deleted_count?: number;
  errors?: string[];
  error?: string;
  code?: string;
}

/**
 * Get Europe/Paris UTC offset in minutes for a given date.
 * Uses Intl API to handle DST automatically (no external lib).
 * Returns positive offset (e.g., +60 for winter CET, +120 for summer CEST).
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

  // Handle day boundary (e.g., Paris 01:00, UTC 23:00 previous day)
  if (diffMinutes < -720) diffMinutes += 1440;
  if (diffMinutes > 720) diffMinutes -= 1440;

  return diffMinutes;
}

/**
 * Build a UTC ISO timestamp from a Paris local date + time.
 * dayDate: "YYYY-MM-DD", time: "HH:mm" or "HH:mm:ss"
 * Returns ISO string representing that exact moment in UTC.
 */
function buildParisTimestamp(dayDate: string, time: string): string {
  const [h, m] = time.split(":").map(Number);

  // Create a rough UTC date at noon to determine DST offset for that day
  const roughDate = new Date(`${dayDate}T12:00:00Z`);
  const offsetMinutes = getParisOffsetMinutes(roughDate);

  // Paris time = UTC + offset, so UTC = Paris time - offset
  const parisMinutes = h * 60 + m;
  const utcMinutes = parisMinutes - offsetMinutes;

  // Handle day rollover
  const [y, mo, d] = dayDate.split("-").map(Number);
  let utcDay = d;
  const utcMonth = mo - 1; // JS months are 0-indexed
  const utcYear = y;
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

  const dt = new Date(Date.UTC(utcYear, utcMonth, utcDay, utcH, utcM, 0, 0));
  return dt.toISOString();
}

/**
 * Build timestamp for overnight shift end (next day)
 * Uses buildParisTimestamp helper for DST-safe conversion
 */
function buildOvernightEndTimestamp(dayDate: string, timeStr: string): string {
  const [year, month, day] = dayDate.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextYear = nextDay.getUTCFullYear();
  const nextMonth = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
  const nextDayNum = String(nextDay.getUTCDate()).padStart(2, "0");
  const nextDayStr = `${nextYear}-${nextMonth}-${nextDayNum}`;
  return buildParisTimestamp(nextDayStr, timeStr);
}

/**
 * Check if shift is overnight (end < start)
 */
function isOvernightShift(startTime: string, endTime: string): boolean {
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  return endMinutes < startMinutes;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

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
      log.warn("Auth failed");
      return jsonErr("Unauthorized", 401);
    }

    // Rate limiting (P0-5)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 5, keyPrefix: "badgeuse-backfill" });
    if (rateLimited) return rateLimited;

    // Parse body
    const body: BackfillRequest = await req.json();
    const { establishment_id, start_date, end_date, mode = "skip", preview = false } = body;

    if (!establishment_id || !start_date || !end_date) {
      return jsonErr("Missing required fields (establishment_id, start_date, end_date)", 400, "MISSING_FIELDS");
    }

    // Validate dates
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return jsonErr("Invalid date format", 400, "INVALID_DATE");
    }
    if (startDate > endDate) {
      return jsonErr("Start date must be before end date", 400, "INVALID_RANGE");
    }

    // Max 31 days
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (daysDiff > 31) {
      return jsonErr("Maximum 31 days allowed", 400, "RANGE_TOO_LONG");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RBAC V2: has_module_access replaces is_admin()
    // Backfill requires write access to badgeuse module
    // ═══════════════════════════════════════════════════════════════════════════
    const { data: hasBackfillAccess, error: rbacError } = await supabaseUser.rpc("has_module_access", {
      _module_key: "badgeuse",
      _min_level: "write",
      _establishment_id: establishment_id,
    });
    
    if (rbacError || !hasBackfillAccess) {
      log.warn("access_denied", { user_id: user.id, establishment_id, has_backfill_access: hasBackfillAccess });
      return jsonErr("badgeuse:write access required for backfill", 403, "RBAC_DENIED");
    }

    log.info("backfill_start", { user_id: user.id, establishment_id, mode, preview, start_date, end_date });

    // Get organization_id from establishment
    const { data: establishment } = await supabaseAdmin
      .from("establishments")
      .select("organization_id")
      .eq("id", establishment_id)
      .single();

    if (!establishment) {
      return jsonErr("Establishment not found", 404, "ESTABLISHMENT_NOT_FOUND");
    }

    const organizationId = establishment.organization_id;

    // Fetch planning_shifts in date range
    // FAIL-SAFE: Include establishment_id in SELECT to assert consistency
    const { data: shifts, error: shiftsError } = await supabaseAdmin
      .from("planning_shifts")
      .select("id, user_id, shift_date, start_time, end_time, establishment_id")
      .eq("establishment_id", establishment_id)
      .gte("shift_date", start_date)
      .lte("shift_date", end_date)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (shiftsError) {
      log.error("Error fetching shifts", shiftsError);
      return jsonErr("Failed to fetch planning shifts", 500);
    }

    const shiftsFound = shifts?.length || 0;

    // ============================================================================
    // REPLACE MODE: Delete existing badge_events in timestamp range first
    // ============================================================================
    // V8 FIX: Use occurred_at range instead of day_date to handle overnight shifts
    // where day_date may have changed between old and new logic.
    //
    // WHY +1 day at 06:00?
    // - Shifts can end after midnight (e.g., 19:00→03:00 overnight)
    // - service_day_cutoff is typically 03:00, so events up to 03:00 belong to previous day
    // - Adding margin to 06:00 ensures we capture ALL events from overnight shifts
    // - This does NOT depend on manual DST logic (buildParisTimestamp uses Intl API)
    //
    // DELETE WINDOW: [start_date 00:00 Paris] → [end_date+1 06:00 Paris]
    // ============================================================================
    const DELETE_END_MARGIN_HOURS = "06:00"; // Hours past midnight on end_date+1
    
    let deletedCount = 0;
    if (mode === "replace" && !preview) {
      const deleteStartTs = buildParisTimestamp(start_date, "00:00");
      // End date + 1 day at DELETE_END_MARGIN_HOURS to capture overnight shifts
      const [y, m, d] = end_date.split("-").map(Number);
      const endPlusOne = new Date(Date.UTC(y, m - 1, d + 1));
      const endPlusOneStr = `${endPlusOne.getUTCFullYear()}-${String(endPlusOne.getUTCMonth() + 1).padStart(2, "0")}-${String(endPlusOne.getUTCDate()).padStart(2, "0")}`;
      const deleteEndTs = buildParisTimestamp(endPlusOneStr, DELETE_END_MARGIN_HOURS);
      
      log.info("replace_mode_delete", { start: deleteStartTs, end: deleteEndTs });
      
      const { data: deleted, error: deleteError } = await supabaseAdmin
        .from("badge_events")
        .delete()
        .eq("establishment_id", establishment_id)
        .gte("occurred_at", deleteStartTs)
        .lte("occurred_at", deleteEndTs)
        .select("id");

      if (deleteError) {
        log.error("Error deleting existing events", deleteError);
        return jsonErr("Failed to delete existing events", 500);
      }
      deletedCount = deleted?.length || 0;
      log.info("replace_mode_deleted", { count: deletedCount });
    }

    // Fetch existing badge_events (for skip mode, or for preview in replace mode)
    const { data: existingEvents, error: eventsError } = await supabaseAdmin
      .from("badge_events")
      .select("user_id, day_date, event_type")
      .eq("establishment_id", establishment_id)
      .gte("day_date", start_date)
      .lte("day_date", end_date);

    if (eventsError) {
      log.error("Error fetching existing events", eventsError);
      return jsonErr("Failed to fetch existing events", 500);
    }

    // Build set of existing events for quick lookup (empty if replace mode executed)
    const existingSet = new Set<string>();
    existingEvents?.forEach((e) => {
      existingSet.add(`${e.user_id}|${e.day_date}|${e.event_type}`);
    });

    // Calculate events to create
    // V8 FIX: day_date = get_service_day(establishment_id, effective_at) - SAME AS LIVE
    const eventsToCreate: Array<{
      user_id: string;
      day_date: string;
      event_type: "clock_in" | "clock_out";
      effective_at: string;
      occurred_at: string;
      sequence_index: number;
      shift_id: string;
    }> = [];

    // Group shifts by user+shift_date for sequence calculation
    const shiftsByUserDay = new Map<string, typeof shifts>();
    shifts?.forEach((shift) => {
      const key = `${shift.user_id}|${shift.shift_date}`;
      if (!shiftsByUserDay.has(key)) {
        shiftsByUserDay.set(key, []);
      }
      shiftsByUserDay.get(key)!.push(shift);
    });

    // V8 FIX: Helper to get service day from RPC (single source of truth)
    async function getServiceDayForTimestamp(ts: string): Promise<string> {
      const { data, error } = await supabaseAdmin.rpc("get_service_day", {
        _establishment_id: establishment_id,
        _ts: ts,
      });
      if (error || !data) {
        throw new Error(`get_service_day failed for ${ts}: ${error?.message || "NULL returned"}`);
      }
      return data as string;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 0: Get current server time for future badge blocking
    // Backfill must NEVER create badges with timestamps in the future
    // ═══════════════════════════════════════════════════════════════════════════
    const serverNow = new Date();

    // Process each shift - V8: day_date from get_service_day(effective_at)
    for (const [key, dayShifts] of shiftsByUserDay.entries()) {
      const [userId] = key.split("|");
      
      // Sort shifts by start_time to determine sequence
      dayShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
      
      for (let idx = 0; idx < dayShifts.length; idx++) {
        const shift = dayShifts[idx];
        
        // FAIL-SAFE: Assert shift.establishment_id matches request (anti-data-corruption)
        if (shift.establishment_id !== establishment_id) {
          log.error("CRITICAL: establishment mismatch", undefined, { shift_id: shift.id, shift_establishment: shift.establishment_id, request_establishment: establishment_id });
          throw new Error(`Data integrity error: shift ${shift.id} belongs to different establishment`);
        }
        const sequenceIndex = idx + 1;
        
        // clock_in effective_at
        const clockInEffectiveAt = buildParisTimestamp(shift.shift_date, shift.start_time);
        
        // PHASE 0: Block future badges - skip if clock_in is in the future
        const clockInTs = new Date(clockInEffectiveAt);
        if (clockInTs.getTime() > serverNow.getTime()) {
          log.info("skip_future_clock_in", { user_id: userId, effective_at: clockInEffectiveAt });
          continue; // Skip this entire shift (clock_in + clock_out) since it's in the future
        }
        
        // V8: Get service day from RPC for clock_in
        const clockInServiceDay = await getServiceDayForTimestamp(clockInEffectiveAt);
        
        // Check if clock_in already exists (using service day, not shift_date)
        const clockInKey = `${userId}|${clockInServiceDay}|clock_in`;
        if (!existingSet.has(clockInKey)) {
          eventsToCreate.push({
            user_id: userId,
            day_date: clockInServiceDay, // V8 FIX: from RPC, not shift_date
            event_type: "clock_in",
            effective_at: clockInEffectiveAt,
            occurred_at: clockInEffectiveAt,
            sequence_index: sequenceIndex,
            shift_id: shift.id,
          });
        }
        
        // clock_out effective_at (handle overnight)
        const isOvernight = isOvernightShift(shift.start_time, shift.end_time);
        const clockOutEffectiveAt = isOvernight
          ? buildOvernightEndTimestamp(shift.shift_date, shift.end_time)
          : buildParisTimestamp(shift.shift_date, shift.end_time);
        
        // PHASE 0: Block future badges - skip if clock_out is in the future
        const clockOutTs = new Date(clockOutEffectiveAt);
        if (clockOutTs.getTime() > serverNow.getTime()) {
          log.info("skip_future_clock_out", { user_id: userId, effective_at: clockOutEffectiveAt });
          // Note: clock_in was already added above, but we skip clock_out
          // This is intentional - allows partial backfill up to current time
          continue;
        }
        
        // V8: Get service day from RPC for clock_out
        const clockOutServiceDay = await getServiceDayForTimestamp(clockOutEffectiveAt);
        
        // Check if clock_out already exists (using service day, not shift_date)
        const clockOutKey = `${userId}|${clockOutServiceDay}|clock_out`;
        if (!existingSet.has(clockOutKey)) {
          eventsToCreate.push({
            user_id: userId,
            day_date: clockOutServiceDay, // V8 FIX: from RPC, not shift_date
            event_type: "clock_out",
            effective_at: clockOutEffectiveAt,
            occurred_at: clockOutEffectiveAt,
            sequence_index: sequenceIndex,
            shift_id: shift.id,
          });
        }
      }
    }

    // Preview mode: return counts only
    if (preview) {
      return jsonOk({
        success: true,
        days_covered: daysDiff,
        shifts_found: shiftsFound,
        events_to_create: eventsToCreate.length,
      });
    }

    // Execute mode: insert events
    let createdCount = 0;
    const skippedCount = 0;
    const errors: string[] = [];

    // V8 FIX: Use upsert with onConflict for idempotent replace mode
    // Constraint: badge_events_unique_user_day_seq_type (user_id, establishment_id, day_date, sequence_index, event_type)
    for (const event of eventsToCreate) {
      const { error: upsertError } = await supabaseAdmin
        .from("badge_events")
        .upsert(
          {
            organization_id: organizationId,
            establishment_id: establishment_id,
            user_id: event.user_id,
            event_type: event.event_type,
            effective_at: event.effective_at,
            occurred_at: event.occurred_at,
            day_date: event.day_date,
            sequence_index: event.sequence_index,
            late_minutes: 0, // Backfill = no late
          },
          {
            onConflict: "user_id,establishment_id,day_date,sequence_index,event_type",
            ignoreDuplicates: false, // Update existing row
          }
        );

      if (upsertError) {
        log.error("Upsert error", upsertError);
        errors.push(`${event.user_id}|${event.day_date}|${event.event_type}: ${upsertError.message}`);
      } else {
        createdCount++;
      }
    }
    // Note: skippedCount no longer used with upsert (updates instead of skips)

    log.info("completed", { days_covered: daysDiff, shifts_found: shiftsFound, created_count: createdCount, deleted_count: deletedCount });
    return jsonOk({
      success: true,
      days_covered: daysDiff,
      shifts_found: shiftsFound,
      created_count: createdCount,
      skipped_count: skippedCount,
      deleted_count: deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return jsonErr("Internal server error", 500);
  }
});

function jsonOk(data: BackfillResponse): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function jsonErr(message: string, status: number, code?: string): Response {
  return new Response(JSON.stringify({ success: false, error: message, code }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
