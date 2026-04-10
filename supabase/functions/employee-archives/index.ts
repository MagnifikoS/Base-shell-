import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const log = createLogger("employee-archives");

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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const currentUserId = claimsData.user.id;

    // Rate limit check (after auth, before business logic — using null for in-memory since adminClient is not created yet)
    const rateLimited = await checkRateLimit(req, null, { max: 30, keyPrefix: "employee-archives" });
    if (rateLimited) return rateLimited;

    // Get request body early to extract establishment_id for RBAC V2
    const body = await req.json();
    const { action, establishment_id } = body;

    // ═══════════════════════════════════════════════════════════════════════════
    // RBAC V2: has_module_access replaces has_role("Administrateur")
    // Directors and Admins can both manage employee archives
    // ═══════════════════════════════════════════════════════════════════════════
    if (!establishment_id) {
      return new Response(
        JSON.stringify({ error: "establishment_id is required for RBAC V2" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: hasSalariesAccess, error: rbacError } = await supabaseUser.rpc("has_module_access", {
      _module_key: "salaries",
      _min_level: "read",
      _establishment_id: establishment_id,
    });

    if (rbacError || !hasSalariesAccess) {
      log.warn("RBAC denied", { user_id: currentUserId, establishment_id, result: hasSalariesAccess });
      return new Response(
        JSON.stringify({ error: "Forbidden: salaries:read access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    log.info("RBAC granted", { user_id: currentUserId, establishment_id, action });

    // Get organization ID
    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Helper: check write access for hard_delete
    async function checkWriteAccess(): Promise<boolean> {
      const { data } = await supabaseUser.rpc("has_module_access", {
        _module_key: "salaries",
        _min_level: "write",
        _establishment_id: establishment_id,
      });
      return !!data;
    }

    // Client context for audit logging (DATA-01)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    // Audit logging helper
    async function _logAudit(actionName: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        user_id: currentUserId,
        action: actionName,
        target_type: targetType,
        target_id: targetId,
        metadata: metadata || null,
        ip_address: clientIp,
        user_agent: clientUserAgent,
      });
    }

    // Get the "Salarié" role ID
    async function getSalarieRoleId(): Promise<string | null> {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("name", "Salarié")
        .maybeSingle();
      return data?.id || null;
    }

    switch (action) {
      // =============================================
      // LIST_ARCHIVED: Get archived employees (status=disabled)
      // =============================================
      case "list_archived": {
        const { establishment_id } = body;

        const salarieRoleId = await getSalarieRoleId();
        if (!salarieRoleId) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Get all user_ids with role "Salarié"
        const { data: salarieUserRoles } = await supabaseAdmin
          .from("user_roles")
          .select("user_id")
          .eq("role_id", salarieRoleId);

        if (!salarieUserRoles || salarieUserRoles.length === 0) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        let salarieUserIds = salarieUserRoles.map((ur) => ur.user_id);

        // Filter by establishment if provided
        if (establishment_id && typeof establishment_id === "string") {
          const { data: estabUsers } = await supabaseAdmin
            .from("user_establishments")
            .select("user_id")
            .eq("establishment_id", establishment_id)
            .in("user_id", salarieUserIds);

          const estabUserIds = new Set((estabUsers || []).map((eu) => eu.user_id));
          salarieUserIds = salarieUserIds.filter((id) => estabUserIds.has(id));
        }

        if (salarieUserIds.length === 0) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Get profiles for these users - ONLY disabled status
        const { data: profiles, error: profilesError } = await supabaseAdmin
          .from("profiles")
          .select("id, user_id, email, full_name, status, created_at")
          .eq("organization_id", orgId)
          .eq("status", "disabled")
          .in("user_id", salarieUserIds)
          .order("full_name", { ascending: true, nullsFirst: false });

        if (profilesError) throw profilesError;

        const userIds = (profiles || []).map((p) => p.user_id);

        if (userIds.length === 0) {
          return new Response(
            JSON.stringify({ employees: [] }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Batch load establishments
        const { data: allUserEstabs } = await supabaseAdmin
          .from("user_establishments")
          .select("user_id, establishment_id, establishments(id, name, status)")
          .in("user_id", userIds);

        // Batch load teams
        const { data: allUserTeams } = await supabaseAdmin
          .from("user_teams")
          .select("user_id, team_id, teams(id, name, status)")
          .in("user_id", userIds);

        // Build maps
        const estabsMap = new Map<string, Array<{ id: string; name: string }>>();
        (allUserEstabs || []).forEach((ue: { user_id: string; establishments: { id: string; name: string; status: string } | null }) => {
          const existing = estabsMap.get(ue.user_id) || [];
          if (ue.establishments && ue.establishments.status === "active") {
            existing.push({ id: ue.establishments.id, name: ue.establishments.name });
          }
          estabsMap.set(ue.user_id, existing);
        });

        const teamsMap = new Map<string, Array<{ id: string; name: string }>>();
        (allUserTeams || []).forEach((ut: { user_id: string; teams: { id: string; name: string; status: string } | null }) => {
          const existing = teamsMap.get(ut.user_id) || [];
          if (ut.teams && ut.teams.status === "active") {
            existing.push({ id: ut.teams.id, name: ut.teams.name });
          }
          teamsMap.set(ut.user_id, existing);
        });

        // Compose result
        const employees = (profiles || []).map((profile) => ({
          ...profile,
          establishments: estabsMap.get(profile.user_id) || [],
          teams: teamsMap.get(profile.user_id) || [],
        }));

        log.info("completed", { action: "list_archived", count: employees.length });
        return new Response(
          JSON.stringify({ employees }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // =============================================
      // HARD_DELETE: Delegated to `employees` edge function (SEC-DATA-031)
      //
      // The canonical hard_delete implementation lives in `employees/index.ts`
      // which covers ALL employee-linked tables (18+ tables, storage files,
      // and auth user deletion). This action delegates to it to avoid
      // maintaining two divergent deletion lists.
      // =============================================
      case "hard_delete": {
        // RBAC V2: hard_delete requires salaries:write (elevated permission)
        const hasWriteAccess = await checkWriteAccess();
        if (!hasWriteAccess) {
          return new Response(
            JSON.stringify({ error: "Forbidden: salaries:write access required for hard delete" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { user_id } = body;

        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Prevent self-deletion (mirrors employees/hard_delete safety check)
        if (user_id === currentUserId) {
          return new Response(
            JSON.stringify({ error: "Cannot delete your own account" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify user exists in this org and is disabled
        const { data: profile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .select("id, email, status, full_name")
          .eq("user_id", user_id)
          .eq("organization_id", orgId)
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "Employee not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (profile.status !== "disabled") {
          return new Response(
            JSON.stringify({ error: "Cannot delete active employee. Suspend first." }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Delegate to the canonical `employees` edge function for comprehensive deletion
        const employeesFnUrl = `${supabaseUrl}/functions/v1/employees`;
        const delegateResponse = await fetch(employeesFnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            action: "hard_delete",
            user_id,
            confirm: true,
          }),
        });

        const delegateData = await delegateResponse.json();

        if (!delegateResponse.ok) {
          log.warn("hard_delete_delegate_failed", { status: delegateResponse.status });
          return new Response(
            JSON.stringify(delegateData),
            { status: delegateResponse.status, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        log.info("completed", { action: "hard_delete", user_id: body.user_id });
        return new Response(
          JSON.stringify(delegateData),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
