import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const log = createLogger("admin-delete-test-user");

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

    // Vérifier JWT et récupérer user id
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const adminUserId = user.id;

    // DB-ADMIN-001: Prefer has_module_access (V2 RBAC) with is_admin fallback
    // Fetch user's first establishment for RBAC check
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

    // Récupérer l'org de l'admin
    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting (DB-backed via admin client)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 10, keyPrefix: "admin-delete-test-user" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { user_id } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "User ID is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Vérifier que le user appartient à l'org
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, email, organization_id")
      .eq("user_id", user_id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Utilisateur non trouvé" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (profile.organization_id !== orgId) {
      return new Response(
        JSON.stringify({ error: "Cet utilisateur n'appartient pas à votre organisation" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Vérifier que l'utilisateur est bien un utilisateur test via invitations.is_test
    const { data: testInvitation, error: testInvError } = await supabaseAdmin
      .from("invitations")
      .select("id, is_test")
      .eq("email", profile.email)
      .eq("organization_id", orgId)
      .eq("is_test", true)
      .maybeSingle();

    if (testInvError) {
      throw testInvError;
    }

    if (!testInvitation) {
      return new Response(
        JSON.stringify({ error: "Cet utilisateur n'est pas un utilisateur test. Suppression non autorisée." }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEC-DATA-031: INCOMPLETE deletion list — test users may have badge_events,
    // employee_details, user_badge_pins, badge_pin_failures, personnel_leaves,
    // planning_shifts, employee_documents, etc. that are NOT cleaned up here.
    //
    // TODO: Delegate to the canonical hard_delete in employees/index.ts (which
    // covers 18+ tables) instead of maintaining this partial list. See
    // employee-archives/index.ts for the delegation pattern.
    // ═══════════════════════════════════════════════════════════════════════════

    // Supprimer proprement dans l'ordre inverse de création
    // 1. Supprimer invitation(s) test
    await supabaseAdmin
      .from("invitations")
      .delete()
      .eq("email", profile.email)
      .eq("organization_id", orgId)
      .eq("is_test", true);

    // 2. Supprimer user_teams
    await supabaseAdmin
      .from("user_teams")
      .delete()
      .eq("user_id", user_id);

    // 3. Supprimer user_establishments
    await supabaseAdmin
      .from("user_establishments")
      .delete()
      .eq("user_id", user_id);

    // 4. Supprimer user_roles
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", user_id);

    // 5. Supprimer profile
    await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("user_id", user_id);

    // 6. Supprimer auth user
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (deleteAuthError) {
      log.error("Auth user deletion failed (non-blocking)", deleteAuthError, { target_user_id: user_id });
      // Non bloquant si le reste est supprimé
    }

    // Audit log (DATA-01: include client IP and user-agent)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: orgId,
      user_id: adminUserId,
      action: "test_user_deleted",
      target_type: "user",
      target_id: user_id,
      metadata: {
        email: profile.email,
        is_test: true,
      },
      ip_address: clientIp,
      user_agent: clientUserAgent,
    });

    log.info("Test user deleted successfully", { target_user_id: user_id, email: profile.email });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Utilisateur test supprimé avec succès",
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    // SEC-20: Log detailed error server-side, return generic message to client
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
