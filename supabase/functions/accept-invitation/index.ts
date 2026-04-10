import { createClient } from "npm:@supabase/supabase-js@2";
import { hashToken } from "../_shared/crypto.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

Deno.serve(async (req) => {
  const CORS = makeCorsHeaders("POST, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // SEC-05: Rate limiting — 10 requests per minute per IP
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 10 });
  if (rateLimited) return rateLimited;

  const log = createLogger("accept-invitation");

  try {
    log.info("invoked", { method: req.method });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Service client for all operations (bypass RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body = await req.json();
    const { token, password, full_name } = body;

    // Validate inputs
    if (!token || typeof token !== "string") {
      log.warn("validation_failed", { reason: "missing_token" });
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return new Response(
        JSON.stringify({ error: "Le mot de passe doit contenir au moins 8 caractères" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (!full_name || typeof full_name !== "string" || full_name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Full name is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const trimmedFullName = full_name.trim();
    if (trimmedFullName.length > 100) {
      return new Response(
        JSON.stringify({ error: "Full name must be less than 100 characters" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Hash token to find invitation
    const tokenHash = await hashToken(token);

    // Find invitation by token hash
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from("invitations")
      .select("*")
      .eq("token_hash", tokenHash)
      .single();

    if (invitationError || !invitation) {
      log.warn("validation_failed", { reason: "invalid_token" });
      return new Response(
        JSON.stringify({ error: "Invalid or expired invitation link" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Check invitation status
    if (invitation.status !== "invited") {
      const statusMessages: Record<string, string> = {
        requested: "This invitation has already been used and is pending approval",
        accepted: "This invitation has already been accepted",
        rejected: "This invitation has been rejected",
        canceled: "This invitation has been canceled",
        expired: "This invitation has expired",
      };
      return new Response(
        JSON.stringify({ error: statusMessages[invitation.status] || "Invalid invitation" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      // Update status to expired
      await supabaseAdmin
        .from("invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);

      return new Response(
        JSON.stringify({ error: "This invitation has expired" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Verify establishment is active
    const { data: establishment, error: estabError } = await supabaseAdmin
      .from("establishments")
      .select("id, status")
      .eq("id", invitation.establishment_id)
      .single();

    if (estabError || !establishment) {
      return new Response(
        JSON.stringify({ error: "Establishment not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (establishment.status !== "active") {
      return new Response(
        JSON.stringify({ error: "The associated establishment is no longer active" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Verify team is active
    const { data: team, error: teamError } = await supabaseAdmin
      .from("teams")
      .select("id, status")
      .eq("id", invitation.team_id)
      .single();

    if (teamError || !team) {
      return new Response(
        JSON.stringify({ error: "Team not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (team.status !== "active") {
      return new Response(
        JSON.stringify({ error: "The associated team is no longer active" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Verify role exists
    const { data: role, error: roleError } = await supabaseAdmin
      .from("roles")
      .select("id")
      .eq("id", invitation.role_id)
      .single();

    if (roleError || !role) {
      return new Response(
        JSON.stringify({ error: "Role not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Try createUser (SSOT = auth.users), fallback to profiles if exists
    // Strategy: Option A durcie — 0 scan, 0 auth schema query
    // ═══════════════════════════════════════════════════════════════════════════
    let newUserId: string;
    let isExistingUser = false;

    // Attempt to create user (SSOT approach)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: invitation.email,
      password: password,
      email_confirm: true, // Auto-confirm since they came via invitation
    });

    if (authError) {
      // Check if error is "user already exists" (multi-invitation case)
      const isAlreadyRegistered = 
        authError.message.includes("already been registered") ||
        authError.message.includes("already exists") ||
        authError.message.includes("email exists");

      if (isAlreadyRegistered) {
        // ═══════════════════════════════════════════════════════════════════════
        // CASE B: User exists in auth — fallback to profiles lookup (no scan)
        // ═══════════════════════════════════════════════════════════════════════
        const { data: existingProfile, error: profileLookupError } = await supabaseAdmin
          .from("profiles")
          .select("user_id")
          .eq("email", invitation.email)
          .maybeSingle();

        if (profileLookupError) {
          log.error("Profiles lookup failed", profileLookupError, { email: invitation.email });
          return new Response(
            JSON.stringify({ error: "Failed to lookup existing user" }),
            { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (!existingProfile) {
          // User exists in auth but not in profiles — data inconsistency
          log.error("User exists in auth but not in profiles", undefined, { email: invitation.email });
          return new Response(
            JSON.stringify({ error: "User already exists but profile not found", email: invitation.email }),
            { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        log.info("Existing auth user, using profile.user_id", { email: invitation.email });
        newUserId = existingProfile.user_id;
        isExistingUser = true;
      } else {
        // Other auth error — rethrow
        throw authError;
      }
    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // CASE A: User created successfully — create profile
      // ═══════════════════════════════════════════════════════════════════════
      newUserId = authData.user.id;

      // Create profile with status 'requested' (only for new users)
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .insert({
          user_id: newUserId,
          organization_id: invitation.organization_id,
          email: invitation.email,
          full_name: trimmedFullName,
          status: "requested",
        });

      if (profileError) {
        // Rollback: delete the auth user
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        throw profileError;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Scoped assignments (same for new and existing users)
    // ═══════════════════════════════════════════════════════════════════════════

    // Assign role (with establishment_id for scoped RBAC - Phase 2)
    const { error: roleAssignError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        {
          user_id: newUserId,
          role_id: invitation.role_id,
          establishment_id: invitation.establishment_id, // Scoped assignment
        },
        { 
          onConflict: "user_id,role_id,establishment_id",
          ignoreDuplicates: true 
        }
      );

    if (roleAssignError) {
      // Rollback only if new user
      if (!isExistingUser) {
        await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
      }
      throw roleAssignError;
    }

    // Assign establishment
    const { error: estabAssignError } = await supabaseAdmin
      .from("user_establishments")
      .upsert(
        {
          user_id: newUserId,
          establishment_id: invitation.establishment_id,
        },
        { 
          onConflict: "user_id,establishment_id",
          ignoreDuplicates: true 
        }
      );

    if (estabAssignError) {
      // Rollback only if new user
      if (!isExistingUser) {
        await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
        await supabaseAdmin.from("profiles").delete().eq("user_id", newUserId);
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
      }
      throw estabAssignError;
    }

    // Assign team (with establishment_id for scoped RBAC - Phase 2)
    const { error: teamAssignError } = await supabaseAdmin
      .from("user_teams")
      .upsert(
        {
          user_id: newUserId,
          team_id: invitation.team_id,
          establishment_id: invitation.establishment_id, // Scoped assignment
        },
        { 
          onConflict: "user_id,team_id,establishment_id",
          ignoreDuplicates: true 
        }
      );

    // If user_teams doesn't exist, ignore the error (table may not exist yet)
    if (teamAssignError && !teamAssignError.message.includes("does not exist")) {
      log.warn("Could not assign team (non-critical)", { error: teamAssignError.message });
    }

    // Update invitation status to requested and link user_id
    const { error: updateInvitationError } = await supabaseAdmin
      .from("invitations")
      .update({ 
        status: "requested",
        user_id: newUserId 
      })
      .eq("id", invitation.id);

    if (updateInvitationError) {
      throw updateInvitationError;
    }

    // Create audit log (DATA-01: include client IP and user-agent)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: invitation.organization_id,
      user_id: newUserId,
      action: isExistingUser ? "invitation_requested_existing_user" : "invitation_requested",
      target_type: "invitation",
      target_id: invitation.id,
      metadata: {
        email: invitation.email,
        full_name: trimmedFullName,
        is_existing_user: isExistingUser,
        establishment_id: invitation.establishment_id,
      },
      ip_address: clientIp,
      user_agent: clientUserAgent,
    });

    const message = isExistingUser
      ? "Additional establishment access granted. Awaiting admin approval."
      : "Account created successfully. Awaiting admin approval.";

    log.info("completed", { action: "invitation_accepted", user_id: newUserId, is_existing_user: isExistingUser });

    return new Response(
      JSON.stringify({ 
        success: true,
        message,
        is_existing_user: isExistingUser,
      }),
      { status: 201, headers: { ...CORS, "Content-Type": "application/json" } }
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
