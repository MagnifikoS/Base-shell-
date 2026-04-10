/**
 * Admin Actions Helpers for badge-events
 * Handles admin validation, scope checks, and audit logging
 * 
 * V7: getTodayParis replaced by getServiceDayForAdmin which uses RPC
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { computeEffectiveAt, type PlannedShift, type BadgeSettings, DEFAULT_SETTINGS } from "./helpers.ts";

export interface AdminContext {
  adminUserId: string;
  organizationId: string;
  establishmentIds: string[];
}

/**
 * DATA-01: Client context for audit log entries (IP + User-Agent)
 */
export interface AuditClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * DATA-01: Extract client info from request headers for audit logging
 */
export function extractClientInfo(req: Request): AuditClientInfo {
  return {
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null,
    userAgent: req.headers.get("user-agent") || null,
  };
}

export interface AdminActionResult {
  success: boolean;
  error?: string;
  code?: string;
  status?: number;
}

/**
 * Get the service day for a given establishment using the RPC
 * This respects the establishment's service_day_cutoff parameter
 * 
 * ✅ SINGLE SOURCE OF TRUTH: This is the ONLY way to determine service day
 * ❌ NO FALLBACK: If RPC fails, throw error - never use local date calculation
 */
export async function getServiceDayForAdmin(
  supabaseAdmin: SupabaseClient,
  establishmentId: string,
  ts?: Date
): Promise<string> {
  const timestamp = ts || new Date();
  
  const { data, error } = await supabaseAdmin.rpc("get_service_day", {
    _establishment_id: establishmentId,
    _ts: timestamp.toISOString(),
  });

  if (error || !data) {
    console.error("[getServiceDayForAdmin] RPC failed:", error);
    // ❌ NO FALLBACK - fail explicitly to prevent silent data corruption
    throw new Error(`Failed to determine service day for establishment ${establishmentId}: ${error?.message || "No data returned"}`);
  }

  return data as string;
}

/**
 * Validate module access for badge-events mutations.
 * Checks if user has 'badgeuse:write' OR 'presence:write' on the target establishment.
 * 
 * ✅ SINGLE SOURCE OF TRUTH: Aligns with RLS policies on badge_events table.
 * This replaces the old is_admin() check for non-admin users with RBAC roles.
 * 
 * CRITICAL: supabaseUser (JWT client) MUST be used for RPC calls that depend on auth.uid().
 * supabaseAdmin (service role) is used only for profile/establishment data fetching.
 */
export async function validateModuleAccess(
  supabaseUser: SupabaseClient, // JWT client for RPC with auth.uid()
  supabaseAdmin: SupabaseClient, // Service role for data fetching
  userId: string,
  establishmentId: string,
  minLevel: "read" | "write" = "write"
): Promise<{ context: AdminContext | null; error: AdminActionResult | null }> {
  // Get user profile first (needed for org_id and audit) - use admin client
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();

  if (!profile?.organization_id) {
    return {
      context: null,
      error: { success: false, error: "Profile not found", code: "PROFILE_NOT_FOUND", status: 404 },
    };
  }

  // Get user's establishment assignments - use admin client
  const { data: establishments } = await supabaseAdmin
    .from("user_establishments")
    .select("establishment_id")
    .eq("user_id", userId);

  const establishmentIds = establishments?.map((e) => e.establishment_id) || [];

  // ✅ Use supabaseUser (JWT) for RPC calls - auth.uid() will be set correctly
  const [badgeuseResult, presenceResult] = await Promise.all([
    supabaseUser.rpc("has_module_access", {
      _module_key: "badgeuse",
      _min_level: minLevel,
      _establishment_id: establishmentId,
    }),
    supabaseUser.rpc("has_module_access", {
      _module_key: "presence",
      _min_level: minLevel,
      _establishment_id: establishmentId,
    }),
  ]);

  const hasBadgeuseAccess = badgeuseResult.data === true;
  const hasPresenceAccess = presenceResult.data === true;

  console.log(`[validateModuleAccess] User ${userId} on ${establishmentId}: badgeuse=${hasBadgeuseAccess}, presence=${hasPresenceAccess}`);

  if (!hasBadgeuseAccess && !hasPresenceAccess) {
    return {
      context: null,
      error: { success: false, error: "Not authorized", code: "NOT_AUTHORIZED", status: 403 },
    };
  }

  return {
    context: {
      adminUserId: userId,
      organizationId: profile.organization_id,
      establishmentIds,
    },
    error: null,
  };
}

// NOTE: validateAdminContext was removed (dead code).
// All admin actions now use validateModuleAccess() for RBAC-based authorization.

/**
 * Validate scope: check org match + establishment access
 */
export function validateScope(
  adminContext: AdminContext,
  targetOrgId: string,
  targetEstablishmentId: string
): AdminActionResult | null {
  if (targetOrgId !== adminContext.organizationId) {
    return { success: false, error: "Out of scope - organization mismatch", code: "OUT_OF_SCOPE", status: 403 };
  }

  if (!adminContext.establishmentIds.includes(targetEstablishmentId)) {
    return { success: false, error: "Out of scope - establishment not accessible", code: "OUT_OF_SCOPE", status: 403 };
  }

  return null; // Valid
}

/**
 * V8: Validate that day_date matches the SERVICE day of the event's occurred_at
 * 
 * ✅ SINGLE SOURCE OF TRUTH RULE:
 * expected = get_service_day(establishment_id, occurred_at)
 * if day_date !== expected → 403 (reject)
 * else → OK
 * 
 * This allows admins to create/edit badges at 09:00 for events that happened at 02:00
 * (which belong to the previous service day when cutoff is 03:00)
 */
export async function validateServiceDayMatch(
  supabaseAdmin: SupabaseClient,
  establishmentId: string,
  dayDate: string,
  occurredAt: string
): Promise<AdminActionResult | null> {
  // Get the service day for the event's timestamp, NOT current time
  const expectedServiceDay = await getServiceDayForAdmin(
    supabaseAdmin,
    establishmentId,
    new Date(occurredAt)
  );

  if (dayDate !== expectedServiceDay) {
    return {
      success: false,
      error: `La date (${dayDate}) ne correspond pas à la journée de service de l'événement (${expectedServiceDay}). Le cutoff de l'établissement détermine la journée de service.`,
      code: "ADMIN_EDIT_DATE_FORBIDDEN",
      status: 403,
    };
  }
  return null;
}

/**
 * @deprecated Use validateServiceDayMatch instead
 * V7: Validate that day_date matches today's SERVICE day (not calendar day)
 * Uses get_service_day RPC to respect establishment cutoff
 */
export async function validateTodayOnlyV7(
  supabaseAdmin: SupabaseClient,
  establishmentId: string,
  dayDate: string
): Promise<AdminActionResult | null> {
  const serviceDay = await getServiceDayForAdmin(supabaseAdmin, establishmentId);
  
  if (dayDate !== serviceDay) {
    return {
      success: false,
      error: `Admin edit restricted to today's service day (${serviceDay})`,
      code: "ADMIN_EDIT_DATE_FORBIDDEN",
      status: 403,
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ❌ REMOVED: validateTodayOnly()
// This function used local calendar date instead of service day.
// Use validateTodayOnlyV7(supabaseAdmin, establishmentId, dayDate) instead.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log admin action to audit_logs
 * DATA-01: Now accepts optional clientInfo for IP/user-agent tracking
 */
export async function logAdminAction(
  supabaseAdmin: SupabaseClient,
  action: "BADGE_EVENT_DELETE" | "BADGE_EVENT_UPDATE" | "BADGE_EVENT_CREATE" | "BADGE_EVENT_RESET_DAY",
  adminContext: AdminContext,
  params: {
    targetUserId: string;
    badgeEventId?: string;
    establishmentId: string;
    dayDate: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    deletedCount?: number;
    deletedEvents?: unknown[];
  },
  clientInfo?: AuditClientInfo,
): Promise<void> {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      action,
      user_id: adminContext.adminUserId,
      target_id: params.badgeEventId || null,
      target_type: "badge_event",
      organization_id: adminContext.organizationId,
      metadata: {
        target_user_id: params.targetUserId,
        establishment_id: params.establishmentId,
        day_date: params.dayDate,
        before: params.before || null,
        after: params.after || null,
        deleted_count: params.deletedCount ?? null,
        deleted_events: params.deletedEvents ?? null,
      },
      ip_address: clientInfo?.ipAddress || null,
      user_agent: clientInfo?.userAgent || null,
    });
  } catch (e) {
    // Non-blocking: log failure but don't fail the main action
    console.error("Failed to write audit log:", e);
  }
}

/**
 * Recalculate effective_at for a given occurred_at timestamp
 * Uses the same logic as employee badge flow
 */
export async function recalculateEffectiveAt(
  supabaseAdmin: SupabaseClient,
  params: {
    occurredAt: Date;
    eventType: "clock_in" | "clock_out";
    targetUserId: string;
    establishmentId: string;
    dayDate: string;
    sequenceIndex: number;
  }
): Promise<string> {
  // Get badgeuse settings
  const { data: settings } = await supabaseAdmin
    .from("badgeuse_settings")
    .select("*")
    .eq("establishment_id", params.establishmentId)
    .single();

  const cfg: BadgeSettings = settings || DEFAULT_SETTINGS;

  // Get establishment cutoff for service day timestamp logic
  const { data: establishment } = await supabaseAdmin
    .from("establishments")
    .select("service_day_cutoff")
    .eq("id", params.establishmentId)
    .single();
  const cutoffHHMM = (establishment?.service_day_cutoff || "03:00").slice(0, 5);

  // Get planned shift for this user/day/sequence
  const { data: plannedShifts } = await supabaseAdmin
    .from("planning_shifts")
    .select("start_time, end_time")
    .eq("user_id", params.targetUserId)
    .eq("establishment_id", params.establishmentId)
    .eq("shift_date", params.dayDate)
    .order("start_time", { ascending: true });

  const plannedShift: PlannedShift | null = plannedShifts?.[params.sequenceIndex - 1] || null;

  return computeEffectiveAt(params.occurredAt, params.eventType, plannedShift, params.dayDate, cutoffHHMM, cfg);
}

/**
 * Check for badge conflicts (max 2 shifts, no duplicate types in same sequence)
 * PHASE 3: Also detects legacy data inconsistencies (multiple events of same type)
 */
export async function checkBadgeConflict(
  supabaseAdmin: SupabaseClient,
  params: {
    targetUserId: string;
    establishmentId: string;
    dayDate: string;
    eventType: "clock_in" | "clock_out";
    sequenceIndex?: number;
  }
): Promise<{ conflict: AdminActionResult | null; nextSequence: number }> {
  const { data: existingEvents } = await supabaseAdmin
    .from("badge_events")
    .select("*")
    .eq("user_id", params.targetUserId)
    .eq("establishment_id", params.establishmentId)
    .eq("day_date", params.dayDate)
    .order("sequence_index", { ascending: true })
    .order("occurred_at", { ascending: true });

  if (!existingEvents?.length) {
    // No events yet - first must be clock_in
    if (params.eventType === "clock_out") {
      return {
        conflict: { success: false, error: "Cannot create clock_out without clock_in", code: "BADGE_CONFLICT", status: 400 },
        nextSequence: 1,
      };
    }
    return { conflict: null, nextSequence: 1 };
  }

  // === PHASE 3: Detect legacy data inconsistencies ===
  // Count events by sequence_index and event_type
  const countBySeqAndType = new Map<string, number>();
  for (const evt of existingEvents) {
    const key = `${evt.sequence_index}:${evt.event_type}`;
    countBySeqAndType.set(key, (countBySeqAndType.get(key) || 0) + 1);
  }
  
  // Check if any sequence has duplicates
  for (const [key, count] of countBySeqAndType.entries()) {
    if (count > 1) {
      const [seq, type] = key.split(":");
      console.error(`[checkBadgeConflict] DATA_INCONSISTENT: ${count} ${type} events on sequence ${seq}`);
      return {
        conflict: { 
          success: false, 
          error: `Incohérence détectée: ${count} ${type} sur le shift ${seq}. Utilisez "Reset day" pour corriger.`,
          code: "DATA_INCONSISTENT_DUPLICATE_EVENTS",
          status: 409 
        },
        nextSequence: parseInt(seq, 10),
      };
    }
  }

  // Check max 2 shifts
  const maxSequence = Math.max(...existingEvents.map((e) => e.sequence_index));
  const lastEvent = existingEvents[existingEvents.length - 1];

  // Determine expected next event type
  if (lastEvent.event_type === "clock_in" && params.eventType === "clock_in") {
    return {
      conflict: { success: false, error: "Already clocked in, expecting clock_out", code: "BADGE_CONFLICT", status: 400 },
      nextSequence: lastEvent.sequence_index,
    };
  }

  if (lastEvent.event_type === "clock_out" && params.eventType === "clock_out") {
    return {
      conflict: { success: false, error: "Already clocked out", code: "BADGE_CONFLICT", status: 400 },
      nextSequence: lastEvent.sequence_index,
    };
  }

  // If last was clock_out and trying to add clock_in, check max shifts
  if (lastEvent.event_type === "clock_out" && params.eventType === "clock_in") {
    if (maxSequence >= 2) {
      return {
        conflict: { success: false, error: "Maximum 2 shifts per day", code: "MAX_SHIFTS", status: 400 },
        nextSequence: maxSequence,
      };
    }
    return { conflict: null, nextSequence: maxSequence + 1 };
  }

  // Last was clock_in, adding clock_out - use same sequence
  return { conflict: null, nextSequence: lastEvent.sequence_index };
}
