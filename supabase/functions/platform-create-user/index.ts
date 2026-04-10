/**
 * ═══════════════════════════════════════════════════════════════════════════
 * platform-create-user — Create a user account from the Platform Super Admin
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Creates auth user + profile + user_establishments + user_roles
 * for any organization/establishment. No team required in V0.
 *
 * Auth: Platform admin only (is_platform_admin check)
 * AMIR impact: NONE — purely additive, no existing data modified
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

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

  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 5 });
  if (rateLimited) return rateLimited;

  const log = createLogger("platform-create-user");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
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

    // Verify caller is platform admin
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: isPlatformAdmin } = await supabaseUser.rpc("is_platform_admin", {
      _user_id: user.id,
    });

    if (!isPlatformAdmin) {
      log.warn("Non-platform-admin attempt", { user_id: user.id });
      return new Response(
        JSON.stringify({ error: "Forbidden: Platform admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { first_name, last_name, email, password, role_id, organization_id, establishment_id } = body;

    // ═══ Validation ═══
    if (!email || typeof email !== "string" || !email.includes("@") || email.length > 255) {
      return new Response(
        JSON.stringify({ error: "Email valide requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!first_name || typeof first_name !== "string" || first_name.trim().length === 0 || first_name.length > 100) {
      return new Response(
        JSON.stringify({ error: "Prénom requis (max 100 caractères)" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!last_name || typeof last_name !== "string" || last_name.trim().length === 0 || last_name.length > 100) {
      return new Response(
        JSON.stringify({ error: "Nom requis (max 100 caractères)" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!role_id || typeof role_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Rôle requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!organization_id || typeof organization_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Organisation requise" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!establishment_id || typeof establishment_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Établissement requis" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedFirstName = first_name.trim();
    const trimmedLastName = last_name.trim();
    const fullName = `${trimmedFirstName} ${trimmedLastName}`;
    // Use provided password or generate one
    const finalPassword = (password && typeof password === "string" && password.length >= 6) 
      ? password 
      : generateSecurePassword();

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // ═══ Verify establishment belongs to organization ═══
    const { data: establishment, error: estError } = await supabaseAdmin
      .from("establishments")
      .select("id, status, organization_id")
      .eq("id", establishment_id)
      .eq("organization_id", organization_id)
      .single();

    if (estError || !establishment) {
      return new Response(
        JSON.stringify({ error: "Établissement non trouvé ou n'appartient pas à l'organisation" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══ Verify role exists and is accessible ═══
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

    // Role must be system (org_id=null) or belong to the target org
    if (role.organization_id !== null && role.organization_id !== organization_id) {
      return new Response(
        JSON.stringify({ error: "Ce rôle n'est pas accessible pour cette organisation" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══ Check if email already exists ═══
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, organization_id")
      .eq("email", trimmedEmail)
      .maybeSingle();

    if (existingProfile) {
      return new Response(
        JSON.stringify({ error: "Un compte avec cet email existe déjà" }),
        { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══ 1. Create auth user ═══
    const { data: authData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: trimmedEmail,
      password: finalPassword,
      email_confirm: true,
    });

    if (createAuthError) {
      if (createAuthError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Un compte avec cet email existe déjà dans le système d'authentification" }),
          { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      throw createAuthError;
    }

    const newUserId = authData.user.id;

    // ═══ 2. Create profile ═══
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: newUserId,
        organization_id: organization_id,
        email: trimmedEmail,
        full_name: fullName,
        status: "active", // PDG is active immediately
      });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw profileError;
    }

    // ═══ 3. Link to establishment ═══
    const { error: estAssignError } = await supabaseAdmin
      .from("user_establishments")
      .insert({
        user_id: newUserId,
        establishment_id: establishment_id,
      });

    if (estAssignError) {
      await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw estAssignError;
    }

    // ═══ 4. Assign role (scoped to establishment) ═══
    const { error: roleAssignError } = await supabaseAdmin
      .from("user_roles")
      .insert({
        user_id: newUserId,
        role_id: role_id,
        establishment_id: establishment_id,
      });

    if (roleAssignError) {
      await supabaseAdmin.from("user_establishments").delete().eq("user_id", newUserId);
      await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw roleAssignError;
    }

    // ═══ 5. Audit log ═══
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organization_id,
      user_id: user.id,
      action: "platform_user_created",
      target_type: "user",
      target_id: newUserId,
      metadata: {
        email: trimmedEmail,
        full_name: fullName,
        role_id: role_id,
        role_name: role.name,
        establishment_id: establishment_id,
        created_by_platform_admin: true,
      },
    });

    log.info("Platform user created", { user_id: newUserId, email: trimmedEmail, role: role.name });

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        email: trimmedEmail,
        full_name: fullName,
        role_name: role.name,
        temp_password: finalPassword,
      }),
      { status: 201, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
