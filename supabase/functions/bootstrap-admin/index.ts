import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

interface BootstrapRequest {
  email: string;
  password: string;
  fullName: string;
  organizationName: string;
}

const log = createLogger("bootstrap-admin");

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS = makeCorsHeaders("POST, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // Rate limiting
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 5 });
  if (rateLimited) return rateLimited;

  try {
    // ══════════════════════════════════════════════════════════════
    // SECURITY: Verify bootstrap secret FIRST (before any DB access)
    // ══════════════════════════════════════════════════════════════
    const providedSecret = req.headers.get("x-bootstrap-secret");
    const expectedSecret = Deno.env.get("BOOTSTRAP_SECRET");

    if (!expectedSecret) {
      log.error("BOOTSTRAP_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Bootstrap non configuré" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // SEC-14: Use timing-safe comparison to prevent timing attacks
    if (!providedSecret || !(await timingSafeEqual(providedSecret, expectedSecret))) {
      log.warn("auth_failed", { reason: "invalid_bootstrap_secret" });
      return new Response(
        JSON.stringify({ error: "Accès non autorisé" }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // ══════════════════════════════════════════════════════════════
    // Secret validated - proceed with normal flow
    // ══════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier si un admin existe déjà
    const { data: adminExists } = await supabaseAdmin.rpc("admin_exists");
    
    if (adminExists) {
      return new Response(
        JSON.stringify({ error: "Un administrateur existe déjà" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const { email, password, fullName, organizationName }: BootstrapRequest = await req.json();

    // Validation basique
    if (!email || !password || !fullName || !organizationName) {
      return new Response(
        JSON.stringify({ error: "Tous les champs sont requis" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    if (password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Le mot de passe doit contenir au moins 8 caractères" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    log.info("bootstrap_start", { email, organization_name: organizationName });

    // 1. Créer l'organisation
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({ name: organizationName.trim() })
      .select()
      .single();

    if (orgError) {
      log.error("Erreur creation organisation", orgError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la création de l'organisation" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 2. Créer l'établissement par défaut (requis pour Phase 2 scoped assignments)
    const { data: establishmentData, error: establishmentError } = await supabaseAdmin
      .from("establishments")
      .insert({ 
        name: organizationName.trim(),
        organization_id: orgData.id
      })
      .select()
      .single();

    if (establishmentError) {
      // Rollback: supprimer l'organisation
      await supabaseAdmin.from("organizations").delete().eq("id", orgData.id);
      log.error("Erreur creation etablissement", establishmentError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la création de l'établissement" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 3. Créer l'utilisateur auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
    });

    if (authError) {
      // Rollback: supprimer l'etablissement et l'organisation
      await supabaseAdmin.from("establishments").delete().eq("id", establishmentData.id);
      await supabaseAdmin.from("organizations").delete().eq("id", orgData.id);
      // SEC-20: Log detailed error server-side, return generic message to client
      log.error("Erreur creation utilisateur", authError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la creation de l'utilisateur" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const userId = authData.user.id;

    // 4. Créer le profil
    const { error: profileError } = await supabaseAdmin.from("profiles").insert({
      user_id: userId,
      organization_id: orgData.id,
      email: email.trim(),
      full_name: fullName.trim(),
    });

    if (profileError) {
      // Rollback
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("establishments").delete().eq("id", establishmentData.id);
      await supabaseAdmin.from("organizations").delete().eq("id", orgData.id);
      log.error("Erreur creation profil", profileError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la création du profil" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 5. Assigner l'utilisateur à l'établissement (user_establishments)
    const { error: userEstError } = await supabaseAdmin.from("user_establishments").insert({
      user_id: userId,
      establishment_id: establishmentData.id,
    });

    if (userEstError) {
      // Rollback
      await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("establishments").delete().eq("id", establishmentData.id);
      await supabaseAdmin.from("organizations").delete().eq("id", orgData.id);
      log.error("Erreur assignation etablissement", userEstError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de l'assignation à l'établissement" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 6. Récupérer le rôle Administrateur
    const { data: adminRole, error: adminRoleError } = await supabaseAdmin
      .from("roles")
      .select("id")
      .eq("name", "Administrateur")
      .single();

    if (adminRoleError || !adminRole) {
      // Rollback
      await supabaseAdmin.from("user_establishments").delete().eq("user_id", userId);
      await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("establishments").delete().eq("id", establishmentData.id);
      await supabaseAdmin.from("organizations").delete().eq("id", orgData.id);
      log.error("Erreur recuperation role admin", adminRoleError);
      return new Response(
        JSON.stringify({ error: "Rôle Administrateur non trouvé. Vérifiez que les rôles système existent." }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // 7. Assigner le rôle admin AVEC establishment_id (Phase 2 compliant)
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role_id: adminRole.id,
      establishment_id: establishmentData.id,  // ← Phase 2: scoped assignment
    });

    if (roleError) {
      // Rollback
      await supabaseAdmin.from("user_establishments").delete().eq("user_id", userId);
      await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("establishments").delete().eq("id", establishmentData.id);
      await supabaseAdmin.from("organizations").delete().eq("id", orgData.id);
      log.error("Erreur assignation role", roleError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de l'assignation du rôle" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    log.info("completed", { action: "admin_bootstrapped", user_id: userId });

    return new Response(
      JSON.stringify({ success: true, message: "Administrateur créé avec succès" }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
    );

  } catch (error) {
    log.error("Unhandled bootstrap error", error);
    return new Response(
      JSON.stringify({ error: "Erreur interne du serveur" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});
