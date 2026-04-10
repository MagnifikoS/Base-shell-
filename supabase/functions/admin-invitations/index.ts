import { createClient } from "npm:@supabase/supabase-js@2";
import { hashToken } from "../_shared/crypto.ts";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimitSync } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

// Generate a secure random token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

Deno.serve(async (req) => {
  const CORS = makeCorsHeaders("POST, GET, OPTIONS", req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  // SEC-05: Rate limiting — 20 requests per minute per IP
  const rateLimited = checkRateLimitSync(req, { windowMs: 60_000, max: 20 });
  if (rateLimited) return rateLimited;

  const log = createLogger("admin-invitations");

  try {
    log.info("Request received");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("auth_failed", { reason: "missing_authorization" });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client with user's token for auth verification
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      log.warn("auth_failed", { reason: "invalid_token" });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // DB-ADMIN-001: Prefer has_module_access (V2 RBAC) with is_admin fallback
    let hasAdminAccess = false;
    const { data: userEstabs } = await supabaseUser
      .from("user_establishments")
      .select("establishment_id")
      .eq("user_id", userId)
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
        _user_id: userId,
      });
      hasAdminAccess = !adminError && !!isAdmin;
    }

    if (!hasAdminAccess) {
      log.warn("Admin check failed", { user_id: userId });
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Get user's organization
    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Service client for writes
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { action, email, role_id, team_id, establishment_id, invitation_id, status_filter, establishment_id: filter_establishment_id } = body;

    // Client context for audit logging (DATA-01)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    // Helper: log audit action
    async function logAudit(actionName: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        user_id: userId,
        action: actionName,
        target_type: targetType,
        target_id: targetId,
        metadata: metadata || null,
        ip_address: clientIp,
        user_agent: clientUserAgent,
      });
    }

    // Helper: cleanup user completely (assignments + profile + auth.user if test)
    async function cleanupUserIfNotActive(
      targetUserId: string | null, 
      targetEmail: string, 
      isTest: boolean,
      orgIdCheck: string
    ): Promise<{ cleaned: boolean; deletedAuthUser: boolean }> {
      let cleaned = false;
      let deletedAuthUser = false;

      // Try to find user_id from profiles if not provided
      let userIdToClean = targetUserId;
      if (!userIdToClean) {
        const { data: profileByEmail } = await supabaseAdmin
          .from("profiles")
          .select("user_id, status")
          .eq("email", targetEmail)
          .eq("organization_id", orgIdCheck)
          .single();
        
        if (profileByEmail) {
          userIdToClean = profileByEmail.user_id;
        }
      }

      if (!userIdToClean) {
        return { cleaned: false, deletedAuthUser: false };
      }

      // Check profile status - never delete active users
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("status")
        .eq("user_id", userIdToClean)
        .eq("organization_id", orgIdCheck)
        .single();

      if (!profile) {
        return { cleaned: false, deletedAuthUser: false };
      }

      // Only cleanup if user is NOT active
      if (profile.status === "active") {
        return { cleaned: false, deletedAuthUser: false };
      }

      // 1) Delete assignments
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userIdToClean);
      await supabaseAdmin.from("user_teams").delete().eq("user_id", userIdToClean);
      await supabaseAdmin.from("user_establishments").delete().eq("user_id", userIdToClean);

      // 2) Delete profile
      await supabaseAdmin.from("profiles").delete().eq("user_id", userIdToClean);
      cleaned = true;

      // 3) If test user, delete auth.users entry
      if (isTest) {
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userIdToClean);
        if (!authDeleteError) {
          deletedAuthUser = true;
        }
      }

      return { cleaned, deletedAuthUser };
    }

    switch (action) {
      case "list": {
        let query = supabaseAdmin
          .from("invitations")
          .select(`
            *,
            role:roles(id, name),
            team:teams(id, name),
            establishment:establishments(id, name)
          `)
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false });

        if (status_filter && typeof status_filter === "string") {
          query = query.eq("status", status_filter);
        }

        // Filter by establishment if provided (from global filter)
        const estabFilter = filter_establishment_id || establishment_id;
        if (estabFilter && typeof estabFilter === "string" && action === "list") {
          query = query.eq("establishment_id", estabFilter);
        }

        const { data: invitations, error: listError } = await query;

        if (listError) throw listError;

        log.info("completed", { action: "list", count: invitations?.length });
        return new Response(
          JSON.stringify({ invitations }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "create": {
        // Validate email
        if (!email || typeof email !== "string" || !isValidEmail(email.trim())) {
          return new Response(
            JSON.stringify({ error: "Valid email is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Validate role_id
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Validate team_id
        if (!team_id) {
          return new Response(
            JSON.stringify({ error: "Team is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Validate establishment_id
        if (!establishment_id) {
          return new Response(
            JSON.stringify({ error: "Establishment is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const trimmedEmail = email.trim().toLowerCase();

        // Check role exists and is visible (system or org)
        const { data: roleData, error: roleError } = await supabaseAdmin
          .from("roles")
          .select("id, name, organization_id")
          .eq("id", role_id)
          .single();

        if (roleError || !roleData) {
          return new Response(
            JSON.stringify({ error: "Role not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Reject "Autres" role - non-assignable placeholder
        if (roleData.name === "Autres") {
          return new Response(
            JSON.stringify({ error: "Le rôle 'Autres' ne peut pas être assigné à un salarié" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (roleData.organization_id && roleData.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Role not accessible" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Check team belongs to org and is active
        const { data: teamData, error: teamError } = await supabaseAdmin
          .from("teams")
          .select("id, organization_id, status")
          .eq("id", team_id)
          .single();

        if (teamError || !teamData) {
          return new Response(
            JSON.stringify({ error: "Team not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (teamData.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Team not accessible" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (teamData.status !== "active") {
          return new Response(
            JSON.stringify({ error: "Team is archived" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Check establishment belongs to org and is active
        const { data: estabData, error: estabError } = await supabaseAdmin
          .from("establishments")
          .select("id, organization_id, status")
          .eq("id", establishment_id)
          .single();

        if (estabError || !estabData) {
          return new Response(
            JSON.stringify({ error: "Establishment not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (estabData.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Establishment not accessible" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (estabData.status !== "active") {
          return new Response(
            JSON.stringify({ error: "Establishment is archived" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Generate token and hash
        const inviteToken = generateToken();
        const tokenHash = await hashToken(inviteToken);

        // Set expiration (7 days)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // Create invitation
        const { data: newInvitation, error: createError } = await supabaseAdmin
          .from("invitations")
          .insert({
            organization_id: orgId,
            email: trimmedEmail,
            token_hash: tokenHash,
            role_id,
            team_id,
            establishment_id,
            status: "invited",
            expires_at: expiresAt.toISOString(),
            created_by: userId,
          })
          .select(`
            *,
            role:roles(id, name),
            team:teams(id, name),
            establishment:establishments(id, name)
          `)
          .single();

        if (createError) {
          if (createError.code === "23505") {
            return new Response(
              JSON.stringify({ error: "An active invitation already exists for this email" }),
              { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
            );
          }
          throw createError;
        }

        // Log audit
        log.info("completed", { action: "create", invitation_id: newInvitation.id, email: trimmedEmail });
        await logAudit("invitation_created", "invitation", newInvitation.id, { email: trimmedEmail });

        // Build invite link from request origin (app domain) or fallback
        const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/+$/, "") || "";
        const inviteLink = `${origin}/invite#token=${inviteToken}`;

        return new Response(
          JSON.stringify({ 
            invitation: newInvitation,
            invite_link: inviteLink
          }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "resend": {
        if (!invitation_id) {
          return new Response(
            JSON.stringify({ error: "Invitation ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Find invitation
        const { data: existingInvitation, error: findError } = await supabaseAdmin
          .from("invitations")
          .select("*")
          .eq("id", invitation_id)
          .eq("organization_id", orgId)
          .single();

        if (findError || !existingInvitation) {
          return new Response(
            JSON.stringify({ error: "Invitation not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (existingInvitation.status !== "invited" && existingInvitation.status !== "expired") {
          return new Response(
            JSON.stringify({ error: "Can only resend invited or expired invitations" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Generate new token
        const newToken = generateToken();
        const newTokenHash = await hashToken(newToken);

        // Reset expiration
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 7);

        const { data: updatedInvitation, error: updateError } = await supabaseAdmin
          .from("invitations")
          .update({
            token_hash: newTokenHash,
            expires_at: newExpiresAt.toISOString(),
            status: "invited",
          })
          .eq("id", invitation_id)
          .select(`
            *,
            role:roles(id, name),
            team:teams(id, name),
            establishment:establishments(id, name)
          `)
          .single();

        if (updateError) throw updateError;

        // Log audit
        await logAudit("invitation_resent", "invitation", invitation_id, { email: existingInvitation.email });

        // Build invite link from request origin
        const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/+$/, "") || "";
        const inviteLink = `${origin}/invite#token=${newToken}`;

        return new Response(
          JSON.stringify({ 
            invitation: updatedInvitation,
            invite_link: inviteLink
          }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "cancel": {
        if (!invitation_id) {
          return new Response(
            JSON.stringify({ error: "Invitation ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Find invitation
        const { data: existingInvitation, error: findError } = await supabaseAdmin
          .from("invitations")
          .select("*")
          .eq("id", invitation_id)
          .eq("organization_id", orgId)
          .single();

        if (findError || !existingInvitation) {
          return new Response(
            JSON.stringify({ error: "Invitation not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (existingInvitation.status !== "invited" && existingInvitation.status !== "requested") {
          return new Response(
            JSON.stringify({ error: "Can only cancel invited or requested invitations" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: canceledInvitation, error: cancelError } = await supabaseAdmin
          .from("invitations")
          .update({ status: "canceled" })
          .eq("id", invitation_id)
          .select(`
            *,
            role:roles(id, name),
            team:teams(id, name),
            establishment:establishments(id, name)
          `)
          .single();

        if (cancelError) throw cancelError;

        // Log audit
        await logAudit("invitation_canceled", "invitation", invitation_id, { email: existingInvitation.email });

        return new Response(
          JSON.stringify({ invitation: canceledInvitation }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "delete": {
        if (!invitation_id) {
          return new Response(
            JSON.stringify({ error: "Invitation ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Find invitation with all details
        const { data: existingInvitation, error: findError } = await supabaseAdmin
          .from("invitations")
          .select("*")
          .eq("id", invitation_id)
          .eq("organization_id", orgId)
          .single();

        if (findError || !existingInvitation) {
          return new Response(
            JSON.stringify({ error: "Invitation not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Cannot delete accepted invitations
        if (existingInvitation.status === "accepted") {
          return new Response(
            JSON.stringify({ error: "Cannot delete an accepted invitation" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // IMPORTANT: Cleanup associated user if not active
        // Use user_id from invitation if available, otherwise fallback to email
        const cleanupResult = await cleanupUserIfNotActive(
          existingInvitation.user_id,
          existingInvitation.email,
          existingInvitation.is_test,
          orgId
        );

        // Delete the invitation row
        const { error: deleteError } = await supabaseAdmin
          .from("invitations")
          .delete()
          .eq("id", invitation_id);

        if (deleteError) throw deleteError;

        // Log audit
        await logAudit("invitation_deleted_with_cleanup", "invitation", invitation_id, { 
          email: existingInvitation.email,
          user_cleaned: cleanupResult.cleaned,
          auth_user_deleted: cleanupResult.deletedAuthUser,
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            deleted_id: invitation_id,
            user_cleaned: cleanupResult.cleaned,
            auth_user_deleted: cleanupResult.deletedAuthUser,
          }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      default:
        log.warn("validation_failed", { reason: "invalid_action", action });
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
