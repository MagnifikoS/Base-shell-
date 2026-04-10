import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const log = createLogger("admin-convert-test-user");

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
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 10, keyPrefix: "admin-convert-test-user" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { user_id } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "User ID is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Vérifier que le user appartient à l'org et est actif
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, email, status, organization_id")
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

    if (profile.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Seuls les utilisateurs actifs peuvent être convertis en réel" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Vérifier que l'utilisateur est bien un utilisateur test
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
        JSON.stringify({ error: "Cet utilisateur n'est pas un utilisateur test" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ✅ PHASE P1: Anti-phantom — .select("id").single() pour détecter 0 rows
    const { data: updatedInvitation, error: updateError } = await supabaseAdmin
      .from("invitations")
      .update({ is_test: false })
      .eq("id", testInvitation.id)
      .select("id")
      .single();

    if (updateError) {
      throw updateError;
    }
    
    // Détection "succès fantôme"
    if (!updatedInvitation) {
      throw new Error("Conversion échouée : invitation non mise à jour");
    }

    // Audit log (DATA-01: include client IP and user-agent)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: orgId,
      user_id: adminUserId,
      action: "test_user_converted",
      target_type: "user",
      target_id: user_id,
      metadata: {
        email: profile.email,
      },
      ip_address: clientIp,
      user_agent: clientUserAgent,
    });

    log.info("Test user converted successfully", { user_id, email: profile.email });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Utilisateur converti en utilisateur réel avec succès",
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
