import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// NOTE: Auto-invalidation removed - validation is 100% manual (see planning-validation-policy)

type AnyClient = SupabaseClient;

// ============================================================================
// Types
// ============================================================================

export interface DeleteWeekShiftsBody {
  action: "delete_week_shifts";
  establishment_id: string;
  week_start: string;
}

export interface DeleteEmployeeWeekShiftsBody {
  action: "delete_employee_week_shifts";
  establishment_id: string;
  week_start: string;
  user_id: string;
}

export interface CopyPreviousWeekBody {
  action: "copy_previous_week";
  establishment_id: string;
  week_start: string;
  user_id: string;
  mode: "merge" | "replace";
}

interface BulkResult {
  data?: Record<string, unknown>;
  error?: string;
  status: number;
}

// ============================================================================
// Helpers
// ============================================================================

function _getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const start = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${dd}`);
  }
  return dates;
}

function getPreviousWeekStart(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() - 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ============================================================================
// Common validation - RBAC pattern (no hardcoded is_admin)
// ============================================================================

async function validatePlanningWriteAccess(
  userId: string,
  establishmentId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<{ orgId: string; planningScope: string; userTeamIds: string[] } | { error: string; status: number }> {
  // Get org ID first
  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return { error: "Organization not found", status: 400 };
  }

  // Verify establishment belongs to org
  const { data: establishment } = await adminClient
    .from("establishments")
    .select("id, organization_id")
    .eq("id", establishmentId)
    .single();

  if (!establishment || establishment.organization_id !== orgId) {
    return { error: "Establishment not found or forbidden", status: 403 };
  }

  // RBAC check via userClient (JWT) - has_module_access handles admin internally
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "planning",
    _min_level: "write",
    _establishment_id: establishmentId,
  });

  if (accessError) {
    console.error("validatePlanningWriteAccess RBAC error:", accessError);
    return { error: "Permission check failed", status: 500 };
  }

  if (!hasAccess) {
    return { error: "Planning write access required", status: 403 };
  }

  // Get scope for self/team restriction via V2
  const { data: permsData } = await userClient.rpc("get_my_permissions_v2", {
    _establishment_id: establishmentId,
  });
  const perms = permsData as {
    permissions?: Array<{ module_key: string; scope: string }>;
    team_ids?: string[];
  } | null;
  const planningPerm = perms?.permissions?.find(p => p.module_key === "planning");
  const planningScope = planningPerm?.scope || "self";
  const userTeamIds = perms?.team_ids || [];

  return { orgId, planningScope, userTeamIds };
}

/**
 * Get the set of user IDs that a caller is allowed to manage based on scope.
 * Returns null if scope is establishment/org (no filtering needed).
 */
async function getAllowedUserIds(
  adminClient: AnyClient,
  callerUserId: string,
  planningScope: string,
  userTeamIds: string[]
): Promise<Set<string> | null> {
  // Establishment/org scope: no filtering needed
  if (planningScope === "establishment" || planningScope === "org" || planningScope === "all") {
    return null;
  }

  // Self scope: only the caller
  if (planningScope === "self") {
    return new Set([callerUserId]);
  }

  // Team scope: caller + team members
  if (planningScope === "team") {
    if (userTeamIds.length === 0) {
      return new Set([callerUserId]);
    }
    const { data: teamUsers } = await adminClient
      .from("user_teams")
      .select("user_id")
      .in("team_id", userTeamIds);
    const allowedIds = new Set((teamUsers || []).map(tu => tu.user_id));
    allowedIds.add(callerUserId); // Always include self
    return allowedIds;
  }

  // Default: self only
  return new Set([callerUserId]);
}

// ============================================================================
// delete_week_shifts
// ============================================================================

export async function handleDeleteWeekShifts(
  body: DeleteWeekShiftsBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<BulkResult> {
  const { establishment_id, week_start } = body;

  if (!establishment_id || !week_start) {
    return { error: "Missing required fields", status: 400 };
  }

  const validation = await validatePlanningWriteAccess(userId, establishment_id, userClient, adminClient);
  if ("error" in validation) return validation;
  const { planningScope, userTeamIds } = validation;

  // ══════════════════════════════════════════════════════════════
  // SCOPE CHECK: Restrict bulk delete to allowed users
  // ══════════════════════════════════════════════════════════════
  const allowedUserIds = await getAllowedUserIds(adminClient, userId, planningScope, userTeamIds);

  // Get planning_weeks to check validation state
  const { data: planningWeek } = await adminClient
    .from("planning_weeks")
    .select("week_validated, validated_days")
    .eq("establishment_id", establishment_id)
    .eq("week_start", week_start)
    .single();

  // GARDE-FOU: week_validated === true => block all
  if (planningWeek?.week_validated) {
    return { error: "Semaine validée - suppression interdite", status: 403 };
  }

  const weekDates = getWeekDates(week_start);
  const validatedDays = (planningWeek?.validated_days as Record<string, boolean>) || {};

  // Filter to only delete shifts on non-validated days
  const deletableDates = weekDates.filter((d) => validatedDays[d] !== true);

  if (deletableDates.length === 0) {
    return {
      data: { success: true, deleted_count: 0, deleted_leaves_count: 0, message: "Tous les jours sont validés" },
      status: 200
    };
  }

  // Build delete query with scope filter
  let deleteShiftsQuery = adminClient
    .from("planning_shifts")
    .delete()
    .eq("establishment_id", establishment_id)
    .in("shift_date", deletableDates);

  if (allowedUserIds) {
    deleteShiftsQuery = deleteShiftsQuery.in("user_id", Array.from(allowedUserIds));
  }

  const { data: deletedShifts, error: deleteError } = await deleteShiftsQuery.select("id");

  if (deleteError) {
    console.error("Delete week shifts error:", deleteError);
    return { error: "Failed to delete shifts", status: 500 };
  }

  // Delete leaves (CP, repos, absences) for non-validated days only, scoped
  let deleteLeavesQuery = adminClient
    .from("personnel_leaves")
    .delete()
    .eq("establishment_id", establishment_id)
    .in("leave_date", deletableDates);

  if (allowedUserIds) {
    deleteLeavesQuery = deleteLeavesQuery.in("user_id", Array.from(allowedUserIds));
  }

  const { data: deletedLeaves, error: deleteLeavesError } = await deleteLeavesQuery.select("id");

  if (deleteLeavesError) {
    console.error("Delete week leaves error:", deleteLeavesError);
    return { error: "Failed to delete leaves", status: 500 };
  }

  return {
    data: {
      success: true,
      deleted_count: deletedShifts?.length || 0,
      deleted_leaves_count: deletedLeaves?.length || 0,
      skipped_validated_count: weekDates.length - deletableDates.length,
    },
    status: 200,
  };
}

// ============================================================================
// delete_employee_week_shifts
// ============================================================================

export async function handleDeleteEmployeeWeekShifts(
  body: DeleteEmployeeWeekShiftsBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<BulkResult> {
  const { establishment_id, week_start, user_id } = body;

  if (!establishment_id || !week_start || !user_id) {
    return { error: "Missing required fields", status: 400 };
  }

  const validation = await validatePlanningWriteAccess(userId, establishment_id, userClient, adminClient);
  if ("error" in validation) return validation;
  const { planningScope, userTeamIds } = validation;

  // ══════════════════════════════════════════════════════════════
  // SCOPE CHECK: Verify caller can manage target user
  // ══════════════════════════════════════════════════════════════
  const allowedUserIds = await getAllowedUserIds(adminClient, userId, planningScope, userTeamIds);
  if (allowedUserIds && !allowedUserIds.has(user_id)) {
    return { error: "Forbidden: scope restriction", status: 403 };
  }

  // Get planning_weeks to check validation state
  const { data: planningWeek } = await adminClient
    .from("planning_weeks")
    .select("week_validated, validated_days")
    .eq("establishment_id", establishment_id)
    .eq("week_start", week_start)
    .single();

  // GARDE-FOU: week_validated === true => block all
  if (planningWeek?.week_validated) {
    return { error: "Semaine validée - suppression interdite", status: 403 };
  }

  const weekDates = getWeekDates(week_start);
  const validatedDays = (planningWeek?.validated_days as Record<string, boolean>) || {};
  
  // Filter to only delete shifts on non-validated days
  const deletableDates = weekDates.filter((d) => validatedDays[d] !== true);

  if (deletableDates.length === 0) {
    return { 
      data: { success: true, deleted_count: 0, message: "Tous les jours sont validés" }, 
      status: 200 
    };
  }

  // Delete shifts for this employee on non-validated days only
  const { data: deletedShifts, error: deleteError } = await adminClient
    .from("planning_shifts")
    .delete()
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .in("shift_date", deletableDates)
    .select("id");

  if (deleteError) {
    console.error("Delete employee week shifts error:", deleteError);
    return { error: "Failed to delete shifts", status: 500 };
  }

  // Delete leaves (CP, repos, absences) for this employee on non-validated days
  // Symmetric with delete_week_shifts to avoid orphan leaves
  const { data: deletedLeaves, error: deleteLeavesError } = await adminClient
    .from("personnel_leaves")
    .delete()
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .in("leave_date", deletableDates)
    .select("id");

  if (deleteLeavesError) {
    console.error("Delete employee week leaves error:", deleteLeavesError);
    return { error: "Failed to delete leaves", status: 500 };
  }

  return {
    data: {
      success: true,
      deleted_count: deletedShifts?.length || 0,
      deleted_leaves_count: deletedLeaves?.length || 0,
      skipped_validated_count: weekDates.length - deletableDates.length,
    },
    status: 200,
  };
}

// ============================================================================
// copy_previous_week
// ============================================================================

export async function handleCopyPreviousWeek(
  body: CopyPreviousWeekBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<BulkResult> {
  const { establishment_id, week_start, user_id, mode } = body;

  if (!establishment_id || !week_start || !user_id || !mode) {
    return { error: "Missing required fields", status: 400 };
  }

  if (mode !== "merge" && mode !== "replace") {
    return { error: "Invalid mode - must be 'merge' or 'replace'", status: 400 };
  }

  const validation = await validatePlanningWriteAccess(userId, establishment_id, userClient, adminClient);
  if ("error" in validation) return validation;
  const { orgId, planningScope, userTeamIds } = validation;

  // ══════════════════════════════════════════════════════════════
  // SCOPE CHECK: Verify caller can manage target user
  // ══════════════════════════════════════════════════════════════
  const allowedUserIds = await getAllowedUserIds(adminClient, userId, planningScope, userTeamIds);
  if (allowedUserIds && !allowedUserIds.has(user_id)) {
    return { error: "Forbidden: scope restriction", status: 403 };
  }

  // Get planning_weeks to check validation state
  const { data: planningWeek } = await adminClient
    .from("planning_weeks")
    .select("week_validated, validated_days")
    .eq("establishment_id", establishment_id)
    .eq("week_start", week_start)
    .single();

  // GARDE-FOU: week_validated === true => block all copy
  if (planningWeek?.week_validated) {
    return { error: "Semaine validée - copie interdite", status: 403 };
  }

  const validatedDays = (planningWeek?.validated_days as Record<string, boolean>) || {};
  
  // GARDE-FOU: if ANY day is validated => block copy
  const weekDates = getWeekDates(week_start);
  const hasAnyValidatedDay = weekDates.some((d) => validatedDays[d] === true);
  
  if (hasAnyValidatedDay) {
    return { 
      error: "Impossible de copier : un ou plusieurs jours sont déjà validés", 
      status: 403 
    };
  }

  // Get previous week dates
  const prevWeekStart = getPreviousWeekStart(week_start);
  const prevWeekDates = getWeekDates(prevWeekStart);

  // Fetch source shifts (previous week, this employee)
  const { data: sourceShifts, error: sourceError } = await adminClient
    .from("planning_shifts")
    .select("shift_date, start_time, end_time, break_minutes, net_minutes")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .in("shift_date", prevWeekDates)
    .order("shift_date")
    .order("start_time");

  if (sourceError) {
    console.error("Fetch source shifts error:", sourceError);
    return { error: "Failed to fetch previous week shifts", status: 500 };
  }

  // Fetch source leaves (previous week, this employee) - CP, repos, absences
  const { data: sourceLeaves, error: sourceLeavesError } = await adminClient
    .from("personnel_leaves")
    .select("leave_date, leave_type, reason, status")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("status", "approved")
    .in("leave_date", prevWeekDates);

  if (sourceLeavesError) {
    console.error("Fetch source leaves error:", sourceLeavesError);
    return { error: "Failed to fetch previous week leaves", status: 500 };
  }

  if ((!sourceShifts || sourceShifts.length === 0) && (!sourceLeaves || sourceLeaves.length === 0)) {
    return {
      data: {
        success: true,
        copied_count: 0,
        copied_leaves_count: 0,
        replaced_deleted_count: 0,
        skipped_existing_count: 0,
        skipped_leave_count: 0,
        message: "Aucun shift ou congé à copier depuis la semaine précédente",
      },
      status: 200,
    };
  }

  // Fetch target week shifts (to check for existing)
  const { data: targetShifts } = await adminClient
    .from("planning_shifts")
    .select("id, shift_date")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .in("shift_date", weekDates);

  const existingShiftsByDate = new Map<string, string[]>();
  for (const s of targetShifts || []) {
    if (!existingShiftsByDate.has(s.shift_date)) {
      existingShiftsByDate.set(s.shift_date, []);
    }
    existingShiftsByDate.get(s.shift_date)!.push(s.id);
  }

  // Fetch existing leaves for target week
  const { data: targetLeaves } = await adminClient
    .from("personnel_leaves")
    .select("id, leave_date")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("status", "approved")
    .in("leave_date", weekDates);

  const existingLeavesByDate = new Map<string, string[]>();
  for (const l of targetLeaves || []) {
    if (!existingLeavesByDate.has(l.leave_date)) {
      existingLeavesByDate.set(l.leave_date, []);
    }
    existingLeavesByDate.get(l.leave_date)!.push(l.id);
  }

  // Build day offset map (prevWeekDates[i] -> weekDates[i])
  const dayOffsetMap = new Map<string, string>();
  for (let i = 0; i < 7; i++) {
    dayOffsetMap.set(prevWeekDates[i], weekDates[i]);
  }

  let replacedDeletedCount = 0;
  let skippedExistingCount = 0;
  let skippedLeaveCount = 0;
  let replacedDeletedLeavesCount = 0;

  // If replace mode, delete existing shifts and leaves first
  if (mode === "replace") {
    // Delete existing shifts
    const shiftIdsToDelete: string[] = [];
    for (const [_date, ids] of existingShiftsByDate) {
      shiftIdsToDelete.push(...ids);
    }

    if (shiftIdsToDelete.length > 0) {
      const { error: delError } = await adminClient
        .from("planning_shifts")
        .delete()
        .in("id", shiftIdsToDelete);

      if (delError) {
        console.error("Delete target shifts error:", delError);
        return { error: "Failed to delete existing shifts", status: 500 };
      }
      replacedDeletedCount = shiftIdsToDelete.length;
    }

    // Delete existing leaves
    const leaveIdsToDelete: string[] = [];
    for (const [_date, ids] of existingLeavesByDate) {
      leaveIdsToDelete.push(...ids);
    }

    if (leaveIdsToDelete.length > 0) {
      const { error: delLeaveError } = await adminClient
        .from("personnel_leaves")
        .delete()
        .in("id", leaveIdsToDelete);

      if (delLeaveError) {
        console.error("Delete target leaves error:", delLeaveError);
        return { error: "Failed to delete existing leaves", status: 500 };
      }
      replacedDeletedLeavesCount = leaveIdsToDelete.length;
    }
    
    // Clear the maps after replace delete
    existingShiftsByDate.clear();
    existingLeavesByDate.clear();
  }

  // Prepare shifts to insert
  const shiftsToInsert: Array<{
    organization_id: string;
    establishment_id: string;
    user_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    break_minutes: number;
    net_minutes: number;
  }> = [];

  // Check which target dates will have leaves (from source)
  const targetDatesWithLeaves = new Set<string>();
  for (const srcLeave of sourceLeaves || []) {
    const targetDate = dayOffsetMap.get(srcLeave.leave_date);
    if (targetDate && (mode === "replace" || !existingLeavesByDate.has(targetDate))) {
      targetDatesWithLeaves.add(targetDate);
    }
  }

  for (const src of sourceShifts || []) {
    const targetDate = dayOffsetMap.get(src.shift_date);
    if (!targetDate) continue;

    // Skip if leave exists on target date (existing or will be copied)
    if (existingLeavesByDate.has(targetDate) || targetDatesWithLeaves.has(targetDate)) {
      skippedLeaveCount++;
      continue;
    }

    // In merge mode, skip if shifts already exist on target date
    if (mode === "merge" && existingShiftsByDate.has(targetDate)) {
      skippedExistingCount++;
      continue;
    }

    shiftsToInsert.push({
      organization_id: orgId,
      establishment_id,
      user_id,
      shift_date: targetDate,
      start_time: src.start_time,
      end_time: src.end_time,
      break_minutes: src.break_minutes,
      net_minutes: src.net_minutes,
    });
  }

  // Prepare leaves to insert
  const leavesToInsert: Array<{
    establishment_id: string;
    user_id: string;
    leave_date: string;
    leave_type: string;
    reason: string | null;
    status: string;
    created_by: string;
  }> = [];

  for (const srcLeave of sourceLeaves || []) {
    const targetDate = dayOffsetMap.get(srcLeave.leave_date);
    if (!targetDate) continue;

    // In merge mode, skip if leave already exists on target date
    if (mode === "merge" && existingLeavesByDate.has(targetDate)) {
      continue;
    }

    leavesToInsert.push({
      establishment_id,
      user_id,
      leave_date: targetDate,
      leave_type: srcLeave.leave_type,
      reason: srcLeave.reason,
      // For planning, we only copy *effective* leaves. Make them approved to avoid null/legacy statuses.
      status: "approved",
      created_by: userId, // The admin doing the copy
    });
  }

  // Insert new shifts
  let copiedCount = 0;
  if (shiftsToInsert.length > 0) {
    const { data: insertedShifts, error: insertError } = await adminClient
      .from("planning_shifts")
      .insert(shiftsToInsert)
      .select("id");

    if (insertError) {
      console.error("Insert copied shifts error:", insertError);
      return { error: "Failed to copy shifts", status: 500 };
    }
    copiedCount = insertedShifts?.length || 0;
  }

  // Insert new leaves
  let copiedLeavesCount = 0;
  if (leavesToInsert.length > 0) {
    const { data: insertedLeaves, error: insertLeavesError } = await adminClient
      .from("personnel_leaves")
      .insert(leavesToInsert)
      .select("id");

    if (insertLeavesError) {
      console.error("Insert copied leaves error:", insertLeavesError);
      return { error: "Failed to copy leaves", status: 500 };
    }
    copiedLeavesCount = insertedLeaves?.length || 0;
  }

  return {
    data: {
      success: true,
      copied_count: copiedCount,
      copied_leaves_count: copiedLeavesCount,
      replaced_deleted_count: replacedDeletedCount,
      replaced_deleted_leaves_count: replacedDeletedLeavesCount,
      skipped_existing_count: skippedExistingCount,
      skipped_leave_count: skippedLeaveCount,
    },
    status: 200,
  };
}
