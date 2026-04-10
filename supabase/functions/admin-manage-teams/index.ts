import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");
const log = createLogger("admin-manage-teams");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

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

    // Client with user's token for auth verification
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      log.warn("Auth failed");
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

    // Rate limiting (DB-backed via admin client)
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 20, keyPrefix: "admin-manage-teams" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action, name, description, team_id } = body;

    // Audit log: request received
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;
    log.info("action", { user_id: userId, action, client_ip: clientIp, user_agent: clientUserAgent });

    switch (action) {
      case "list": {
        const { data: teams, error: listError } = await supabaseAdmin
          .from("teams")
          .select("*")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false });

        if (listError) throw listError;

        return new Response(
          JSON.stringify({ teams }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "create": {
        if (!name || typeof name !== "string" || name.trim().length === 0) {
          return new Response(
            JSON.stringify({ error: "Team name is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const trimmedName = name.trim();
        if (trimmedName.length > 100) {
          return new Response(
            JSON.stringify({ error: "Team name must be less than 100 characters" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: newTeam, error: createError } = await supabaseAdmin
          .from("teams")
          .insert({
            organization_id: orgId,
            name: trimmedName,
            description: description?.trim() || null,
            status: "active",
          })
          .select()
          .single();

        if (createError) {
          if (createError.code === "23505") {
            return new Response(
              JSON.stringify({ error: "A team with this name already exists" }),
              { status: 409, headers: { ...CORS, "Content-Type": "application/json" } }
            );
          }
          throw createError;
        }

        return new Response(
          JSON.stringify({ team: newTeam }),
          { status: 201, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "archive": {
        if (!team_id) {
          return new Response(
            JSON.stringify({ error: "Team ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify team belongs to org
        const { data: existingTeam, error: findError } = await supabaseAdmin
          .from("teams")
          .select("id, organization_id")
          .eq("id", team_id)
          .single();

        if (findError || !existingTeam) {
          return new Response(
            JSON.stringify({ error: "Team not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (existingTeam.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: archivedTeam, error: archiveError } = await supabaseAdmin
          .from("teams")
          .update({ status: "archived" })
          .eq("id", team_id)
          .select()
          .single();

        if (archiveError) throw archiveError;

        return new Response(
          JSON.stringify({ team: archivedTeam }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "reactivate": {
        if (!team_id) {
          return new Response(
            JSON.stringify({ error: "Team ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify team belongs to org
        const { data: existingTeam, error: findError } = await supabaseAdmin
          .from("teams")
          .select("id, organization_id")
          .eq("id", team_id)
          .single();

        if (findError || !existingTeam) {
          return new Response(
            JSON.stringify({ error: "Team not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        if (existingTeam.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        const { data: reactivatedTeam, error: reactivateError } = await supabaseAdmin
          .from("teams")
          .update({ status: "active" })
          .eq("id", team_id)
          .select()
          .single();

        if (reactivateError) throw reactivateError;

        return new Response(
          JSON.stringify({ team: reactivatedTeam }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      case "change_user_team": {
        const { user_id: targetUserId, new_team_id, establishment_id } = body;

        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // Phase 2 / Étape 55 — ESTABLISHMENT_ID STRICTEMENT REQUIS
        // Le fallback legacy a été supprimé. Le trigger DB bloque de toute façon
        // les écritures NULL, donc ce guard aligne le code avec la réalité.
        // ═══════════════════════════════════════════════════════════════════════════
        if (!establishment_id) {
          return new Response(
            JSON.stringify({ error: "establishment_id is required for team assignment (Phase 2)" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
          );
        }

        // Verify new team belongs to org (if provided)
        if (new_team_id) {
          const { data: teamCheck, error: teamCheckError } = await supabaseAdmin
            .from("teams")
            .select("id, organization_id, status")
            .eq("id", new_team_id)
            .single();

          if (teamCheckError || !teamCheck) {
            return new Response(
              JSON.stringify({ error: "Team not found" }),
              { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
            );
          }

          if (teamCheck.organization_id !== orgId) {
            return new Response(
              JSON.stringify({ error: "Forbidden: Team not in your organization" }),
              { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
            );
          }

          if (teamCheck.status !== "active") {
            return new Response(
              JSON.stringify({ error: "Cannot assign user to an archived team" }),
              { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
            );
          }
        }

        // SCOPED: Remove existing team assignments for this user in this establishment only
        const { error: deleteError } = await supabaseAdmin
          .from("user_teams")
          .delete()
          .eq("user_id", targetUserId)
          .eq("establishment_id", establishment_id);

        if (deleteError) throw deleteError;

        // Assign new team if provided (scoped upsert)
        if (new_team_id) {
          const { error: upsertError } = await supabaseAdmin
            .from("user_teams")
            .upsert(
              { user_id: targetUserId, team_id: new_team_id, establishment_id },
              { onConflict: "user_id,team_id,establishment_id", ignoreDuplicates: true }
            );

          if (upsertError) throw upsertError;
        }

        log.info("completed", { action: "set_user_teams" });
        return new Response(
          JSON.stringify({ success: true }),
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
