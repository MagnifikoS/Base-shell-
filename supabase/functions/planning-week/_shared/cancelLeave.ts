import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// NOTE: Auto-invalidation removed - validation is 100% manual (see planning-validation-policy)

type AnyClient = SupabaseClient;

export interface CancelLeaveBody {
  action: "cancel_leave";
  establishment_id: string;
  user_id: string;
  leave_date: string;
  leave_type: "cp" | "absence" | "rest" | "am";
}

interface CancelLeaveResult {
  data?: { success: boolean; was_already_cancelled: boolean };
  error?: string;
  status: number;
}

/**
 * Cancel an existing leave (set status='cancelled')
 * Does NOT delete shifts/badges (cancel = undo declaration, not clear day)
 * RBAC: same as mark_leave (planning:write)
 */
export async function handleCancelLeave(
  body: CancelLeaveBody,
  callerUserId: string,
  userClient: AnyClient,
  adminClient: AnyClient
): Promise<CancelLeaveResult> {
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
  // RBAC CHECK via userClient (JWT) - same as mark_leave
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

  // For self scope, can only cancel leave for self
  if (planningPerm?.scope === "self" && user_id !== callerUserId) {
    return { error: "Forbidden: self scope", status: 403 };
  }

  // For team scope, can only cancel leave for team members
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

  // ═══════════════════════════════════════════════════════════
  // FIND EXISTING APPROVED LEAVE — type-agnostic (SSOT: one
  // approved leave per user/date/establishment is the invariant)
  // ═══════════════════════════════════════════════════════════
  const { data: existingLeaves, error: findError } = await adminClient
    .from("personnel_leaves")
    .select("id, status, leave_type")
    .eq("establishment_id", establishment_id)
    .eq("user_id", user_id)
    .eq("leave_date", leave_date)
    .eq("status", "approved");

  if (findError) {
    console.error("Find leave error:", findError);
    return { error: "Failed to find leave", status: 500 };
  }

  // No approved leave found → explicit error (no silent success)
  if (!existingLeaves || existingLeaves.length === 0) {
    return { error: "LEAVE_NOT_FOUND", status: 404 };
  }

  // Safety: if multiple approved leaves exist for same day, refuse
  if (existingLeaves.length > 1) {
    console.error(`[cancel_leave] ${existingLeaves.length} approved leaves for user ${user_id} on ${leave_date} — ambiguous, aborting`);
    return { error: "MULTIPLE_LEAVES_CONFLICT", status: 409 };
  }

  const existingLeave = existingLeaves[0];

  // ═══════════════════════════════════════════════════════════
  // UPDATE TO CANCELLED
  // ═══════════════════════════════════════════════════════════
  const { data: updatedRows, error: updateError } = await adminClient
    .from("personnel_leaves")
    .update({ 
      status: "cancelled", 
      updated_at: new Date().toISOString() 
    })
    .eq("id", existingLeave.id)
    .select("id");

  if (updateError) {
    console.error("Update leave error:", updateError);
    return { error: "Failed to cancel leave", status: 500 };
  }

  // Anti-ghost check
  if (!updatedRows || updatedRows.length === 0) {
    return { error: "Leave not found or already processed", status: 404 };
  }

  console.log(`[cancel_leave] Cancelled leave for user ${user_id} on ${leave_date}`);

  return { 
    data: { success: true, was_already_cancelled: false }, 
    status: 200 
  };
}
