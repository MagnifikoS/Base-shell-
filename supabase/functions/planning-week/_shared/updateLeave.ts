import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// NOTE: Auto-invalidation removed - validation is 100% manual (see planning-validation-policy)

type AnyClient = SupabaseClient;

export interface UpdateLeaveBody {
  action: "update_leave";
  establishment_id: string;
  user_id: string;
  leave_date: string; // Original date to update
  leave_type: "cp" | "absence" | "rest" | "am";
  new_leave_date?: string; // Optional: new date if changing
  new_reason?: string; // Optional: update reason
}

interface UpdateLeaveResult {
  data?: { success: boolean };
  error?: string;
  status: number;
}

/**
 * Update an existing leave (modify date or reason)
 * RBAC: same as cancel_leave / mark_leave (planning:write or conges_absences:write)
 */
export async function handleUpdateLeave(
  body: UpdateLeaveBody,
  callerUserId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<UpdateLeaveResult> {
  const { establishment_id, user_id, leave_date, leave_type, new_leave_date, new_reason } = body;

  // Validate required fields
  if (!establishment_id || !user_id || !leave_date || !leave_type) {
    return { error: "Missing required fields", status: 400 };
  }

  // Validate leave_type
  if (leave_type !== "cp" && leave_type !== "absence" && leave_type !== "rest" && leave_type !== "am") {
    return { error: "Invalid leave_type. Must be 'cp', 'absence', 'rest' or 'am'", status: 400 };
  }

  // ══════════════════════════════════════════════════════════════
  // RBAC CHECK: Check for conges_absences:write OR planning:write
  // ══════════════════════════════════════════════════════════════
  const { data: hasCongesAccess } = await userClient.rpc("has_module_access", {
    _module_key: "conges_absences",
    _min_level: "write",
    _establishment_id: establishment_id,
  });

  const { data: hasPlanningAccess } = await userClient.rpc("has_module_access", {
    _module_key: "planning",
    _min_level: "write",
    _establishment_id: establishment_id,
  });

  if (!hasCongesAccess && !hasPlanningAccess) {
    return { error: "conges_absences:write or planning:write access required", status: 403 };
  }

  // ══════════════════════════════════════════════════════════════
  // SCOPE CHECK: Restrict by planning scope (self/team)
  // ══════════════════════════════════════════════════════════════
  const { data: permsData } = await userClient.rpc("get_my_permissions_v2", {
    _establishment_id: establishment_id,
  });
  const perms = permsData as {
    permissions?: Array<{ module_key: string; scope: string }>;
    team_ids?: string[];
  } | null;
  const planningPerm = perms?.permissions?.find(p => p.module_key === "planning");
  const planningScope = planningPerm?.scope;

  // Self scope: can only update own leaves
  if (planningScope === "self" && user_id !== callerUserId) {
    return { error: "Forbidden: self scope", status: 403 };
  }

  // Team scope: can only update leaves for team members
  if (planningScope === "team" && user_id !== callerUserId) {
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

  // ═══════════════════════════════════════════════════════════
  // FIND EXISTING LEAVE
  // ═══════════════════════════════════════════════════════════
  const { data: existingLeave, error: findError } = await adminClient
    .from("personnel_leaves")
    .select("id, status, reason")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("leave_date", leave_date)
    .eq("leave_type", leave_type)
    .eq("status", "approved")
    .maybeSingle();

  if (findError) {
    console.error("Find leave error:", findError);
    return { error: "Failed to find leave", status: 500 };
  }

  if (!existingLeave) {
    return { error: "Leave not found or already cancelled", status: 404 };
  }

  // ═══════════════════════════════════════════════════════════
  // CASE A: Date change → cancel old + create new
  // ═══════════════════════════════════════════════════════════
  if (new_leave_date && new_leave_date !== leave_date) {
    // Check if new date already has an approved leave
    const { data: existingOnNewDate } = await adminClient
      .from("personnel_leaves")
      .select("id")
      .eq("establishment_id", establishment_id)
      .eq("user_id", user_id)
      .eq("leave_date", new_leave_date)
      .eq("status", "approved")
      .maybeSingle();

    if (existingOnNewDate) {
      return { 
        error: `Une absence est déjà déclarée pour le ${new_leave_date}`, 
        status: 409 
      };
    }

    // Cancel old leave
    const { error: cancelError } = await adminClient
      .from("personnel_leaves")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", existingLeave.id);

    if (cancelError) {
      console.error("Cancel old leave error:", cancelError);
      return { error: "Failed to cancel old leave", status: 500 };
    }

    // Create new leave
    const { error: createError } = await adminClient
      .from("personnel_leaves")
      .insert({
        establishment_id,
        user_id,
        leave_date: new_leave_date,
        leave_type,
        status: "approved",
        reason: new_reason ?? existingLeave.reason,
        created_by: callerUserId,
      });

    if (createError) {
      console.error("Create new leave error:", createError);
      return { error: "Failed to create leave at new date", status: 500 };
    }

    console.log(`[update_leave] Moved leave from ${leave_date} to ${new_leave_date}`);
    return { data: { success: true }, status: 200 };
  }

  // ═══════════════════════════════════════════════════════════
  // CASE B: Only reason change → simple update
  // ═══════════════════════════════════════════════════════════
  if (new_reason !== undefined) {
    const { error: updateError } = await adminClient
      .from("personnel_leaves")
      .update({ 
        reason: new_reason, 
        updated_at: new Date().toISOString() 
      })
      .eq("id", existingLeave.id);

    if (updateError) {
      console.error("Update leave error:", updateError);
      return { error: "Failed to update leave", status: 500 };
    }

    console.log(`[update_leave] Updated reason for leave on ${leave_date}`);
  }

  return { data: { success: true }, status: 200 };
}
