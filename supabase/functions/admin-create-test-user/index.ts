import { createClient } from "npm:@supabase/supabase-js@2";
import { hashToken } from "../_shared/crypto.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

// Genere un mot de passe aleatoire securise
function generateSecurePassword(length = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

Deno.serve(async (req) => {
  const CORS = makeCorsHeaders("POST, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // SEC-05: Rate limiting — 5 requests per minute per IP (sensitive endpoint)
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 5 });
  if (rateLimited) return rateLimited;

  const log = createLogger("admin-create-test-user");

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
    const body = await req.json();
    const { email, full_name, role_id, team_id, establishment_id } = body;

    let hasAdminAccess = false;

    // Try V2 RBAC first (if establishment_id is available from payload)
    if (establishment_id) {
      const { data: hasAccess } = await supabaseUser.rpc("has_module_access", {
        _module_key: "admin",
        _min_level: "write",
        _establishment_id: establishment_id,
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

    // body already parsed above for RBAC check

    // Validation des champs obligatoires
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "Email valide requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!full_name || typeof full_name !== "string" || full_name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Nom complet requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!role_id) {
      return new Response(
        JSON.stringify({ error: "Rôle requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!team_id) {
      return new Response(
        JSON.stringify({ error: "Équipe requise" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!establishment_id) {
      return new Response(
        JSON.stringify({ error: "Établissement requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const trimmedFullName = full_name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    // === HARD RESET: Check if auth user exists and clean up if not active ===
    const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = existingAuthUsers?.users?.find(
      (u) => u.email?.toLowerCase() === trimmedEmail
    );

    if (existingAuthUser) {
      // Check if there's an active profile for this user in this org
      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, status, user_id")
        .eq("email", trimmedEmail)
        .eq("organization_id", orgId)
        .single();

      if (existingProfile && existingProfile.status === "active") {
        // Active user - cannot recreate
        return new Response(
          JSON.stringify({ error: "Cet email est déjà utilisé par un compte actif" }),
          { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Not active or no profile - perform hard reset
      log.info("Hard reset for existing test user", { email: trimmedEmail });
      
      const oldUserId = existingAuthUser.id;

      // Delete all PUBLIC traces in correct order (respect FK)
      // 1. Delete user_roles
      await supabaseAdmin.from("user_roles").delete().eq("user_id", oldUserId);
      
      // 2. Delete user_teams
      await supabaseAdmin.from("user_teams").delete().eq("user_id", oldUserId);
      
      // 3. Delete user_establishments
      await supabaseAdmin.from("user_establishments").delete().eq("user_id", oldUserId);
      
      // 4. Delete invitations by user_id OR by email+org
      await supabaseAdmin.from("invitations").delete().eq("user_id", oldUserId);
      await supabaseAdmin
        .from("invitations")
        .delete()
        .eq("email", trimmedEmail)
        .eq("organization_id", orgId);
      
      // 5. Delete profiles
      await supabaseAdmin.from("profiles").delete().eq("user_id", oldUserId);
      await supabaseAdmin
        .from("profiles")
        .delete()
        .eq("email", trimmedEmail)
        .eq("organization_id", orgId);
      
      // 6. Delete auth user
      await supabaseAdmin.auth.admin.deleteUser(oldUserId);
    }

    // === END HARD RESET ===

    // 1) Vérifier établissement actif et appartient à l'org
    const { data: establishment, error: estabError } = await supabaseAdmin
      .from("establishments")
      .select("id, status, organization_id")
      .eq("id", establishment_id)
      .single();

    if (estabError || !establishment) {
      return new Response(
        JSON.stringify({ error: "Établissement non trouvé" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (establishment.status !== "active") {
      return new Response(
        JSON.stringify({ error: "L'établissement n'est pas actif" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (establishment.organization_id !== orgId) {
      return new Response(
        JSON.stringify({ error: "L'établissement n'appartient pas à votre organisation" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // 2) Vérifier team active et appartient à l'org
    const { data: team, error: teamError } = await supabaseAdmin
      .from("teams")
      .select("id, status, organization_id")
      .eq("id", team_id)
      .single();

    if (teamError || !team) {
      return new Response(
        JSON.stringify({ error: "Équipe non trouvée" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (team.status !== "active") {
      return new Response(
        JSON.stringify({ error: "L'équipe n'est pas active" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (team.organization_id !== orgId) {
      return new Response(
        JSON.stringify({ error: "L'équipe n'appartient pas à votre organisation" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // 3) Vérifier rôle visible (system ou org) ET non-"Autres"
    const { data: role, error: roleError } = await supabaseAdmin
      .from("roles")
      .select("id, name, organization_id")
      .eq("id", role_id)
      .single();

    if (roleError || !role) {
      return new Response(
        JSON.stringify({ error: "Rôle non trouvé" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Rejeter le rôle "Autres" - placeholder non-assignable
    if (role.name === "Autres") {
      return new Response(
        JSON.stringify({ error: "Le rôle 'Autres' ne peut pas être assigné à un salarié" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (role.organization_id !== null && role.organization_id !== orgId) {
      return new Response(
        JSON.stringify({ error: "Ce rôle n'est pas accessible pour votre organisation" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Générer un mot de passe temporaire
    const tempPassword = generateSecurePassword();

    // 4) Créer auth user
    const { data: authData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: trimmedEmail,
      password: tempPassword,
      email_confirm: true,
    });

    if (createUserError) {
      if (createUserError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Un compte avec cet email existe déjà" }),
          { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      throw createUserError;
    }

    const newUserId = authData.user.id;

    // 5) Créer profile avec status = 'requested'
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: newUserId,
        organization_id: orgId,
        email: trimmedEmail,
        full_name: trimmedFullName,
        status: "requested",
      });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw profileError;
    }

    // 6) Assigner rôle (with establishment_id for scoped RBAC - Phase 2)
    const { error: roleAssignError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        {
          user_id: newUserId,
          role_id: role_id,
          establishment_id: establishment_id, // Scoped assignment
        },
        {
          onConflict: "user_id,role_id,establishment_id",
          ignoreDuplicates: true,
        }
      );

    if (roleAssignError) {
      await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw roleAssignError;
    }

    // 7) Assigner établissement
    const { error: estabAssignError } = await supabaseAdmin
      .from("user_establishments")
      .insert({
        user_id: newUserId,
        establishment_id: establishment_id,
      });

    if (estabAssignError) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
      await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw estabAssignError;
    }

    // 8) Assigner team (with establishment_id for scoped RBAC - Phase 2)
    const { error: teamAssignError } = await supabaseAdmin
      .from("user_teams")
      .upsert(
        {
          user_id: newUserId,
          team_id: team_id,
          establishment_id: establishment_id, // Scoped assignment
        },
        {
          onConflict: "user_id,team_id,establishment_id",
          ignoreDuplicates: true,
        }
      );

    if (teamAssignError) {
      await supabaseAdmin.from("user_establishments").delete().eq("user_id", newUserId);
      await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
      await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw teamAssignError;
    }

    // 9) Créer invitation trace avec is_test = true et user_id
    const fakeToken = crypto.randomUUID();
    const tokenHash = await hashToken(fakeToken);
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 an

    const { error: inviteError } = await supabaseAdmin
      .from("invitations")
      .insert({
        email: trimmedEmail,
        role_id: role_id,
        team_id: team_id,
        establishment_id: establishment_id,
        organization_id: orgId,
        status: "requested",
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by: adminUserId,
        is_test: true,
        user_id: newUserId,
      });

    if (inviteError) {
      log.error("Invitation trace creation failed (non-blocking)", inviteError, { email: trimmedEmail });
      // Non bloquant, on continue
    }

    // 10) Audit log (DATA-01: include client IP and user-agent)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: orgId,
      user_id: adminUserId,
      action: "test_user_created",
      target_type: "user",
      target_id: newUserId,
      metadata: {
        email: trimmedEmail,
        full_name: trimmedFullName,
        role_id: role_id,
        team_id: team_id,
        establishment_id: establishment_id,
        is_test: true,
      },
      ip_address: clientIp,
      user_agent: clientUserAgent,
    });

    log.info("completed", { action: "create_test_user", user_id: newUserId, email: trimmedEmail });
    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        email: trimmedEmail,
        temp_password: tempPassword,
        message: "Utilisateur test créé avec succès. En attente de validation admin.",
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
