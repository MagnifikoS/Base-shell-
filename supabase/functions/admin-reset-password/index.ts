import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const log = createLogger("admin-reset-password");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("auth_failed", { reason: "missing_authorization" });
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    log.info("Request received", { authPresent: !!authHeader });
    
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const caller = authData?.user;
    
    if (authError || !caller) {
      // SEC-20: Log detailed error server-side, do not leak auth details to client
      log.error("Auth failed", authError);
      return new Response(JSON.stringify({ error: "Non authentifie" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // DB-ADMIN-001: Prefer has_module_access (V2 RBAC) with is_admin fallback
    let hasAdminAccess = false;
    const { data: userEstabs } = await userClient
      .from("user_establishments")
      .select("establishment_id")
      .eq("user_id", caller.id)
      .limit(1);

    if (userEstabs && userEstabs.length > 0) {
      const { data: hasAccess } = await userClient.rpc("has_module_access", {
        _module_key: "admin",
        _min_level: "write",
        _establishment_id: userEstabs[0].establishment_id,
      });
      hasAdminAccess = !!hasAccess;
    }

    // Fallback to legacy is_admin check
    if (!hasAdminAccess) {
      const { data: isAdminData } = await userClient.rpc("is_admin", { _user_id: caller.id });
      hasAdminAccess = !!isAdminData;
    }

    if (!hasAdminAccess) {
      log.warn("access_denied", { user_id: caller.id, reason: "not_admin" });
      return new Response(JSON.stringify({ error: "Accès réservé aux administrateurs" }), {
        status: 403,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { user_id, new_password } = body;

    if (!user_id || !new_password) {
      return new Response(JSON.stringify({ error: "user_id et new_password requis" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (new_password.length < 8) {
      return new Response(JSON.stringify({ error: "Mot de passe trop court (min 8 caractères)" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Use service role to update password
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting (DB-backed via admin client)
    const rateLimited = await checkRateLimit(req, adminClient, { max: 10, keyPrefix: "admin-reset-password" });
    if (rateLimited) return rateLimited;

    // SEC-09: Verify that the target user belongs to the same organization as the admin
    const { data: callerOrgId } = await userClient.rpc("get_user_organization_id");
    if (!callerOrgId) {
      return new Response(JSON.stringify({ error: "Organisation de l'appelant non trouvee" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user_id)
      .single();

    if (targetProfileError || !targetProfile) {
      return new Response(JSON.stringify({ error: "Utilisateur cible non trouve" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (targetProfile.organization_id !== callerOrgId) {
      log.error("Cross-tenant attempt blocked", undefined, {
        callerId: caller.id,
        callerOrg: callerOrgId,
        targetUserId: user_id,
        targetOrg: targetProfile.organization_id,
      });
      return new Response(JSON.stringify({ error: "Acces refuse: utilisateur hors de votre organisation" }), {
        status: 403,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    
    log.info("Resetting password", { target_user_id: user_id });

    const { data: _updateData, error } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });

    if (error) {
      // SEC-20: Log detailed error server-side, return generic message to client
      log.error("Password reset failed", error, { target_user_id: user_id });
      return new Response(JSON.stringify({ error: "Erreur lors de la reinitialisation du mot de passe" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    log.info("completed", { action: "password_reset", target_user_id: user_id });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(JSON.stringify({ error: "Erreur serveur" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
