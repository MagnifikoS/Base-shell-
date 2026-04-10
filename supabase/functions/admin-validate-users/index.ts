import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const log = createLogger("admin-validate-users");

  try {
    log.info("Request received");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      log.warn("Auth failed");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const adminUserId = user.id;

    // DB-ADMIN-001: Prefer has_module_access (V2 RBAC) with is_admin fallback
    let hasAdminAccess = false;
    const { data: userEstabs } = await supabaseUser
      .from("user_establishments")
      .select("establishment_id")
      .eq("user_id", adminUserId)
      .limit(1);

    if (userEstabs && userEstabs.length > 0) {
      const { data: hasAccess } = await supabaseUser.rpc("has_module_access", {
        _module_key: "admin",
        _min_level: "write",
        _establishment_id: userEstabs[0].establishment_id,
      });
      hasAdminAccess = !!hasAccess;
    }

    // Fallback to legacy is_admin check
    if (!hasAdminAccess) {
      const { data: isAdmin, error: adminError } = await supabaseUser.rpc("is_admin", {
        _user_id: adminUserId,
      });
      hasAdminAccess = !adminError && !!isAdmin;
    }

    if (!hasAdminAccess) {
      log.warn("Admin check failed", { user_id: adminUserId });
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting (DB-backed via admin client)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 20, keyPrefix: "admin-validate-users" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action, user_id, status_filter, establishment_id } = body;

    // Client context for audit logging (DATA-01)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    async function logAudit(actionName: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        user_id: adminUserId,
        action: actionName,
        target_type: targetType,
        target_id: targetId,
        metadata: metadata || null,
        ip_address: clientIp,
        user_agent: clientUserAgent,
      });
    }

    // Helper: get admin role id
    async function getAdminRoleId(): Promise<string | null> {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("name", "Administrateur")
        .is("organization_id", null)
        .single();
      return data?.id || null;
    }

    // Helper: count active admins in org
    async function countActiveAdminsInOrg(): Promise<number> {
      const adminRoleId = await getAdminRoleId();
      if (!adminRoleId) return 0;

      const { data: adminUserRoles } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role_id", adminRoleId);

      if (!adminUserRoles || adminUserRoles.length === 0) return 0;

      const userIds = adminUserRoles.map((ur) => ur.user_id);

      const { count } = await supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "active")
        .in("user_id", userIds);

      return count || 0;
    }

    // Helper: check if user is admin
    async function isUserAdmin(userId: string): Promise<boolean> {
      const adminRoleId = await getAdminRoleId();
      if (!adminRoleId) return false;

      const { data } = await supabaseAdmin
        .from("user_roles")
        .select("role_id")
        .eq("user_id", userId)
        .eq("role_id", adminRoleId)
        .single();

      return !!data;
    }

    // Helper: check if user is a test user (based on invitation.is_test)
    async function isTestUser(email: string, orgIdCheck: string): Promise<boolean> {
      const { data } = await supabaseAdmin
        .from("invitations")
        .select("is_test")
        .eq("email", email)
        .eq("organization_id", orgIdCheck)
        .eq("is_test", true)
        .limit(1)
        .maybeSingle();
      
      return !!data;
    }

    switch (action) {
      case "list": {
        let query = supabaseAdmin
          .from("profiles")
          .select(`
            id,
            user_id,
            email,
            full_name,
            status,
            created_at,
            updated_at
          `)
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false });

        if (status_filter && typeof status_filter === "string") {
          query = query.eq("status", status_filter);
        }

        const { data: profiles, error: listError } = await query;

        if (listError) throw listError;

        // Extract all user_ids for batch queries
        let userIds = (profiles || []).map((p) => p.user_id);

        // If establishment_id filter is provided, filter users by establishment
        if (establishment_id && typeof establishment_id === "string") {
          const { data: estabUsers } = await supabaseAdmin
            .from("user_establishments")
            .select("user_id")
            .eq("establishment_id", establishment_id)
            .in("user_id", userIds);

          const estabUserIds = new Set((estabUsers || []).map((eu) => eu.user_id));
          userIds = userIds.filter((id) => estabUserIds.has(id));
        }

        // If no users match, return early
        if (userIds.length === 0) {
          return new Response(
            JSON.stringify({ users: [] }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Batch load roles (1 query instead of N)
        const { data: allUserRoles } = await supabaseAdmin
          .from("user_roles")
          .select("user_id, role_id, roles(id, name)")
          .in("user_id", userIds);

        // Batch load establishments (1 query instead of N)
        const { data: allUserEstabs } = await supabaseAdmin
          .from("user_establishments")
          .select("user_id, establishment_id, establishments(id, name, status)")
          .in("user_id", userIds);

        // Batch load teams (1 query instead of N)
        const { data: allUserTeams } = await supabaseAdmin
          .from("user_teams")
          .select("user_id, team_id, teams(id, name, status)")
          .in("user_id", userIds);

        // Build maps for O(1) lookup - MULTI-ROLE SUPPORT
        const rolesMap = new Map<string, Array<{ id: string; name: string }>>();
        (allUserRoles || []).forEach((ur: { user_id: string; roles: { id: string; name: string } | null }) => {
          const existing = rolesMap.get(ur.user_id) || [];
          if (ur.roles) {
            existing.push(ur.roles);
          }
          rolesMap.set(ur.user_id, existing);
        });

        const estabsMap = new Map<string, Array<{ id: string; name: string; is_archived: boolean }>>();
        (allUserEstabs || []).forEach((ue: { user_id: string; establishments: { id: string; name: string; status: string } | null }) => {
          const existing = estabsMap.get(ue.user_id) || [];
          if (ue.establishments) {
            existing.push({
              ...ue.establishments,
              is_archived: ue.establishments.status === "archived"
            });
          }
          estabsMap.set(ue.user_id, existing);
        });

        const teamsMap = new Map<string, Array<{ id: string; name: string; is_archived: boolean }>>();
        (allUserTeams || []).forEach((ut: { user_id: string; teams: { id: string; name: string; status: string } | null }) => {
          const existing = teamsMap.get(ut.user_id) || [];
          if (ut.teams) {
            existing.push({
              ...ut.teams,
              is_archived: ut.teams.status === "archived"
            });
          }
          teamsMap.set(ut.user_id, existing);
        });

        // Filter profiles by establishment filter and compose final result
        const filteredProfiles = (profiles || []).filter((p) => userIds.includes(p.user_id));
        const usersWithDetails = filteredProfiles.map((profile) => ({
          ...profile,
          roles: rolesMap.get(profile.user_id) || [],
          establishments: estabsMap.get(profile.user_id) || [],
          teams: teamsMap.get(profile.user_id) || [],
        }));

        return new Response(
          JSON.stringify({ users: usersWithDetails }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "accept": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "User not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "requested") {
          return new Response(
            JSON.stringify({ error: "User is not in requested status" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify user has role assigned
        const { data: userRole } = await supabaseAdmin
          .from("user_roles")
          .select("role_id")
          .eq("user_id", user_id)
          .single();

        if (!userRole) {
          return new Response(
            JSON.stringify({ error: "Cannot accept: user must have a role assigned" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify user has establishment assigned
        const { data: userEstabs } = await supabaseAdmin
          .from("user_establishments")
          .select("establishment_id")
          .eq("user_id", user_id);

        if (!userEstabs || userEstabs.length === 0) {
          return new Response(
            JSON.stringify({ error: "Cannot accept: user must have an establishment assigned" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify user has team assigned
        const { data: userTeams } = await supabaseAdmin
          .from("user_teams")
          .select("team_id")
          .eq("user_id", user_id);

        if (!userTeams || userTeams.length === 0) {
          return new Response(
            JSON.stringify({ error: "Cannot accept: user must have a team assigned" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "active" })
          .eq("user_id", user_id);

        if (updateError) throw updateError;

        await supabaseAdmin
          .from("invitations")
          .update({ status: "accepted" })
          .eq("email", profile.email)
          .eq("organization_id", orgId)
          .eq("status", "requested");

        await logAudit("user_accepted", "user", user_id, { email: profile.email });

        return new Response(
          JSON.stringify({ success: true, message: "User accepted" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "reject": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "User not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "requested") {
          return new Response(
            JSON.stringify({ error: "User is not in requested status" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Check if this is a test user
        const isTest = await isTestUser(profile.email, orgId);

        // === FULL CLEANUP (order matters for FK constraints) ===
        // SEC-DATA-031: This is a PARTIAL cleanup for rejected users (who never
        // had badge_events, planning_shifts, etc.). If the user had been active
        // before rejection, consider delegating to employees/hard_delete instead.

        // 1) Delete all assignments first
        await supabaseAdmin.from("user_roles").delete().eq("user_id", user_id);
        await supabaseAdmin.from("user_teams").delete().eq("user_id", user_id);
        await supabaseAdmin.from("user_establishments").delete().eq("user_id", user_id);

        // 2) DELETE invitations (not just update status) - this respects FK RESTRICT
        const { data: deletedInvitations } = await supabaseAdmin
          .from("invitations")
          .delete()
          .eq("email", profile.email)
          .eq("organization_id", orgId)
          .select("id");

        const deletedInvitationsCount = deletedInvitations?.length || 0;

        // 3) DELETE profile (since status != 'active')
        await supabaseAdmin.from("profiles").delete().eq("user_id", user_id);

        // 4) If test user, delete auth.users entry
        let authUserDeleted = false;
        if (isTest) {
          const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
          if (!authDeleteError) {
            authUserDeleted = true;
          }
        }

        // 5) Audit log
        await logAudit("user_rejected_full_cleanup", "user", user_id, { 
          email: profile.email,
          is_test: isTest,
          deleted_invitations_count: deletedInvitationsCount,
          auth_user_deleted: authUserDeleted,
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "User rejected and completely removed",
            deleted_invitations_count: deletedInvitationsCount,
            auth_user_deleted: authUserDeleted,
          }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "disable": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "User not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "active") {
          return new Response(
            JSON.stringify({ error: "User is not active" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Anti-lock: Prevent self-disable
        if (user_id === adminUserId) {
          return new Response(
            JSON.stringify({ error: "You cannot disable your own account" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Anti-lock: Check if this is the last active admin
        const targetIsAdmin = await isUserAdmin(user_id);
        if (targetIsAdmin) {
          const activeAdminCount = await countActiveAdminsInOrg();
          if (activeAdminCount <= 1) {
            return new Response(
              JSON.stringify({ error: "Cannot disable: this is the last active admin in the organization" }),
              { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
            );
          }
        }

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "disabled" })
          .eq("user_id", user_id);

        if (updateError) throw updateError;

        await logAudit("user_disabled", "user", user_id, { email: profile.email });

        return new Response(
          JSON.stringify({ success: true, message: "User disabled" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "reactivate": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "User not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "disabled") {
          return new Response(
            JSON.stringify({ error: "User is not disabled" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { error: updateError } = await supabaseAdmin
          .from("profiles")
          .update({ status: "active" })
          .eq("user_id", user_id);

        if (updateError) throw updateError;

        await logAudit("user_reactivated", "user", user_id, { email: profile.email });

        log.info("completed", { action: "reactivate", target_user_id: body.user_id });
        return new Response(
          JSON.stringify({ success: true, message: "User reactivated" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
    }
  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
