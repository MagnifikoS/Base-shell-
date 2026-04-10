import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// NOTE: Auto-invalidation removed - validation is 100% manual (see planning-validation-policy)

type AnyClient = SupabaseClient;

interface DeleteShiftBody {
  action: "delete_shift";
  establishment_id: string;
  shift_id: string;
}

interface DeleteShiftResult {
  data?: { success: boolean };
  error?: string;
  status: number;
}

export async function handleDeleteShift(
  body: DeleteShiftBody,
  userId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<DeleteShiftResult> {
  const { establishment_id, shift_id } = body;

  // Validate required fields
  if (!establishment_id || !shift_id) {
    return { error: "Missing required fields", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // RBAC CHECK via userClient (JWT) - has_module_access handles admin internally
  // ══════════════════════════════════════════════════════════════
  const { data: hasAccess, error: accessError } = await userClient.rpc("has_module_access", {
    _module_key: "planning",
    _min_level: "write",
    _establishment_id: establishment_id,
  });

  if (accessError) {
    console.error("RBAC check error:", accessError);
    return { error: "Permission check failed", status: 500 };
  }

  if (!hasAccess) {
    return { error: "Planning write access required", status: 403 };
  }

  // Get scope for self/team restriction via V2 (scoped by establishment)
  const { data: permsData } = await userClient.rpc("get_my_permissions_v2", {
    _establishment_id: establishment_id,
  });
  const perms = permsData as {
    permissions?: Array<{ module_key: string; scope: string }>;
    team_ids?: string[];
  } | null;
  const planningPerm = perms?.permissions?.find(p => p.module_key === "planning");
  const planningScope = planningPerm?.scope;

  // Get org ID
  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return { error: "Organization not found", status: 400 };
  }

  // Load shift by shift_id
  const { data: shift, error: shiftError } = await adminClient
    .from("planning_shifts")
    .select("id, organization_id, establishment_id, user_id, shift_date, net_minutes, break_minutes")
    .eq("id", shift_id)
    .single();

  if (shiftError || !shift) {
    return { error: "Shift not found", status: 404 };
  }

  // Scope restriction: self means can only manage own shifts
  if (planningScope === "self" && shift.user_id !== userId) {
    return { error: "Forbidden: self scope", status: 403 };
  }

  // Scope restriction: team means can only manage shifts for team members
  if (planningScope === "team" && shift.user_id !== userId) {
    const userTeamIds = perms?.team_ids || [];
    if (userTeamIds.length === 0) {
      return { error: "Forbidden: team scope (no teams)", status: 403 };
    }
    const { data: teamUsers } = await adminClient
      .from("user_teams")
      .select("user_id")
      .in("team_id", userTeamIds);
    const teamUserIds = new Set((teamUsers || []).map(tu => tu.user_id));
    if (!teamUserIds.has(shift.user_id)) {
      return { error: "Forbidden: team scope", status: 403 };
    }
  }

  // Verify scoping: organization
  if (shift.organization_id !== orgId) {
    return { error: "Shift does not belong to your organization", status: 403 };
  }

  // Verify scoping: establishment
  if (shift.establishment_id !== establishment_id) {
    return { error: "Shift does not belong to this establishment", status: 403 };
  }

  // ══════════════════════════════════════════════════════════════
  // AUTO-DÉVALIDATION: Will unvalidate day after successful delete
  // No blocking - modifications are allowed but trigger auto-unvalidation
  // ══════════════════════════════════════════════════════════════
  
  const shiftDate = shift.shift_date;
  const shiftUserId = shift.user_id;

  // Delete shift
  const { error: deleteError } = await adminClient
    .from("planning_shifts")
    .delete()
    .eq("id", shift_id);

  if (deleteError) {
    console.error("Delete shift error:", deleteError);
    return { error: "Failed to delete shift", status: 500 };
  }

  // ══════════════════════════════════════════════════════════════
  // DELETE BADGE EVENTS: Remove all badge events for this user+date
  // This ensures badge history doesn't persist after shift deletion
  // ══════════════════════════════════════════════════════════════
  const { error: badgeDeleteError, count: deletedBadgeCount } = await adminClient
    .from("badge_events")
    .delete()
    .eq("establishment_id", establishment_id)
    .eq("user_id", shiftUserId)
    .eq("day_date", shiftDate);

  if (badgeDeleteError) {
    console.error("Delete badge events error:", badgeDeleteError);
    // Continue - shift is already deleted, badge cleanup is secondary
  } else if (deletedBadgeCount && deletedBadgeCount > 0) {
    console.log(`Deleted ${deletedBadgeCount} badge events for user ${shiftUserId} on ${shiftDate}`);
  }

  return { data: { success: true }, status: 200 };
}
