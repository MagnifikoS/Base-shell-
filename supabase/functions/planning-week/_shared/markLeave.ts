import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// NOTE: Auto-invalidation removed - validation is 100% manual (see planning-validation-policy)

type AnyClient = SupabaseClient;

export interface MarkLeaveBody {
  action: "mark_leave";
  establishment_id: string;
  user_id: string;
  leave_date: string;
  leave_type: "cp" | "absence" | "rest" | "am";
}

interface MarkLeaveResult {
  data?: { success: boolean; deleted_shifts_count: number };
  error?: string;
  status: number;
}

/**
 * Option A: Mark CP/Absence = delete all shifts for that day
 * 1. Upsert into personnel_leaves (status='approved')
 * 2. Delete ALL planning_shifts for user+date in the establishment
 */
export async function handleMarkLeave(
  body: MarkLeaveBody,
  callerUserId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<MarkLeaveResult> {
  const { establishment_id, user_id, leave_date, leave_type } = body;

  // Validate required fields
  if (!establishment_id || !user_id || !leave_date || !leave_type) {
    return { error: "Missing required fields", status: 400 };
  }

  // Validate leave_type
  if (leave_type !== "cp" && leave_type !== "absence" && leave_type !== "rest" && leave_type !== "am") {
    return { error: "Invalid leave_type. Must be 'cp', 'absence', 'rest' or 'am'", status: 400 };
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

  // For self scope, can only mark leave for self
  if (planningPerm?.scope === "self" && user_id !== callerUserId) {
    return { error: "Forbidden: self scope", status: 403 };
  }

  // For team scope, can only mark leave for team members
  if (planningPerm?.scope === "team" && user_id !== callerUserId) {
    const userTeamIds = perms?.team_ids || [];
    if (userTeamIds.length === 0) {
      return { error: "Forbidden: team scope (no teams)", status: 403 };
    }
    const { data: teamUsers } = await adminClient
      .from("user_teams")
      .select("user_id")
      .in("team_id", userTeamIds);
    const teamUserIds = new Set((teamUsers || []).map(tu => tu.user_id));
    if (!teamUserIds.has(user_id)) {
      return { error: "Forbidden: team scope", status: 403 };
    }
  }

  // Get org ID from caller
  const { data: orgId, error: orgError } = await userClient.rpc("get_user_organization_id");
  if (orgError || !orgId) {
    return { error: "Organization not found", status: 400 };
  }

  // Verify user belongs to the organization
  const { data: targetProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user_id)
    .single();

  if (profileError || !targetProfile || targetProfile.organization_id !== orgId) {
    return { error: "User not found in organization", status: 404 };
  }

  // NOTE: Validation is 100% manual - no auto-invalidation triggered here
  // See planning-validation-policy for details

  // ═══════════════════════════════════════════════════════════
  // STEP 1: Upsert personnel_leaves (insert or update type)
  // ═══════════════════════════════════════════════════════════
  
  // Check if leave already exists for this user+date+establishment
  const { data: existingLeave } = await adminClient
    .from("personnel_leaves")
    .select("id, status, leave_type")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("leave_date", leave_date)
    .maybeSingle();

  if (existingLeave) {
    if (existingLeave.status === "approved") {
      // Already approved - update the type if different
      if (existingLeave.leave_type !== leave_type) {
        const { error: updateError } = await adminClient
          .from("personnel_leaves")
          .update({ leave_type, updated_at: new Date().toISOString() })
          .eq("id", existingLeave.id);

        if (updateError) {
          console.error("Update leave error:", updateError);
          return { error: "Failed to update leave type", status: 500 };
        }
      }
      // Leave already exists with same type - continue to delete shifts anyway
    } else {
      // Cancelled leave - reactivate it
      const { error: reactivateError } = await adminClient
        .from("personnel_leaves")
        .update({ 
          status: "approved", 
          leave_type, 
          updated_at: new Date().toISOString() 
        })
        .eq("id", existingLeave.id);

      if (reactivateError) {
        console.error("Reactivate leave error:", reactivateError);
        return { error: "Failed to reactivate leave", status: 500 };
      }
    }
  } else {
    // Insert new leave
    const { error: insertError } = await adminClient
      .from("personnel_leaves")
      .insert({
        establishment_id,
        user_id,
        leave_date,
        leave_type,
        status: "approved",
        created_by: callerUserId,
      });

    if (insertError) {
      console.error("Insert leave error:", insertError);
      return { error: "Failed to create leave", status: 500 };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2: Delete ALL shifts for this user+date in establishment
  // ═══════════════════════════════════════════════════════════
  
  // First count how many shifts will be deleted
  const { data: shiftsToDelete, error: countError } = await adminClient
    .from("planning_shifts")
    .select("id")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("shift_date", leave_date);

  if (countError) {
    console.error("Count shifts error:", countError);
    // Continue anyway - leave is already created
  }

  const deletedCount = shiftsToDelete?.length ?? 0;

  if (deletedCount > 0) {
    const { error: deleteError } = await adminClient
      .from("planning_shifts")
      .delete()
      .eq("establishment_id", establishment_id)
      .eq("user_id", user_id)
      .eq("shift_date", leave_date);

    if (deleteError) {
      console.error("Delete shifts error:", deleteError);
      return { error: "Leave created but failed to delete shifts", status: 500 };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // DELETE BADGE EVENTS: Remove all badge events for this user+date
  // When marking leave (CP/absence/repos), badge history is cleared
  // ══════════════════════════════════════════════════════════════
  const { error: badgeDeleteError, count: deletedBadgeCount } = await adminClient
    .from("badge_events")
    .delete()
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("day_date", leave_date);

  if (badgeDeleteError) {
    console.error("Delete badge events error:", badgeDeleteError);
    // Continue - leave is already created, badge cleanup is secondary
  } else if (deletedBadgeCount && deletedBadgeCount > 0) {
    console.log(`Deleted ${deletedBadgeCount} badge events for user ${user_id} on ${leave_date}`);
  }

  return { 
    data: { 
      success: true, 
      deleted_shifts_count: deletedCount 
    }, 
    status: 200 
  };
}
