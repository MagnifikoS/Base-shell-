import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createLogger } from "../_shared/logger.ts";

const CORS = makeCorsHeaders("POST, OPTIONS");
const log = createLogger("admin-manage-establishments");

interface CreateEstablishmentRequest {
  action: "create";
  name: string;
}

interface UpdateStatusRequest {
  action: "archive" | "reactivate";
  establishment_id: string;
}

interface AssignUserToEstablishmentRequest {
  action: "assign_user_to_establishment";
  user_id: string;
  establishment_id: string;
}

interface GetUserAssignmentsRequest {
  action: "get_user_assignments";
  user_id: string;
}

type RequestBody = CreateEstablishmentRequest | UpdateStatusRequest | AssignUserToEstablishmentRequest | GetUserAssignmentsRequest;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    log.info("Request received");

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      log.warn("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      log.warn("Auth failed");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // DB-ADMIN-001: Prefer has_module_access (V2 RBAC) with is_admin fallback
    let hasAdminAccess = false;
    const { data: userEstabs } = await supabase
      .from("user_establishments")
      .select("establishment_id")
      .eq("user_id", user.id)
      .limit(1);

    if (userEstabs && userEstabs.length > 0) {
      const { data: hasAccess } = await supabase.rpc("has_module_access", {
        _module_key: "admin",
        _min_level: "write",
        _establishment_id: userEstabs[0].establishment_id,
      });
      hasAdminAccess = !!hasAccess;
    }

    // Fallback to legacy is_admin check
    if (!hasAdminAccess) {
      const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin", {
        _user_id: user.id,
      });
      hasAdminAccess = !roleError && !!isAdmin;
    }

    if (!hasAdminAccess) {
      log.warn("Admin check failed", { user_id: user.id });
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Get user's organization_id
    const { data: orgId, error: orgError } = await supabase.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Use service role client for mutations (bypasses RLS)
    const supabaseServiceRole = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rate limiting (DB-backed via service role client)
    const rateLimited = await checkRateLimit(req, supabaseServiceRole, { max: 20, keyPrefix: "admin-manage-establishments" });
    if (rateLimited) return rateLimited;

    // Audit log: request received
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    // Parse request body
    const body: RequestBody = await req.json();

    log.info("action", { user_id: user.id, action: body.action, client_ip: clientIp, user_agent: clientUserAgent });

    if (body.action === "create") {
      // Validate name
      const name = body.name?.trim();
      if (!name || name.length === 0) {
        return new Response(
          JSON.stringify({ error: "Le nom est obligatoire" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      if (name.length > 100) {
        return new Response(
          JSON.stringify({ error: "Le nom ne peut pas dépasser 100 caractères" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Check for duplicate name in organization
      const { data: existing } = await supabaseServiceRole
        .from("establishments")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", name)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "Un établissement avec ce nom existe déjà" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Create establishment
      const { data: establishment, error: createError } = await supabaseServiceRole
        .from("establishments")
        .insert({
          name,
          organization_id: orgId,
          status: "active",
        })
        .select()
        .single();

      if (createError) {
        log.error("Create establishment error", createError);
        return new Response(
          JSON.stringify({ error: "Erreur lors de la création" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Assign admin to establishment
      const { error: assignError } = await supabaseServiceRole
        .from("user_establishments")
        .insert({
          user_id: user.id,
          establishment_id: establishment.id,
        });

      if (assignError) {
        log.error("Assign user error", assignError);
        // Rollback: delete the establishment
        await supabaseServiceRole
          .from("establishments")
          .delete()
          .eq("id", establishment.id);
        
        return new Response(
          JSON.stringify({ error: "Erreur lors de l'assignation" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, establishment }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    if (body.action === "archive" || body.action === "reactivate") {
      const establishmentId = body.establishment_id;
      if (!establishmentId) {
        return new Response(
          JSON.stringify({ error: "ID établissement manquant" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Verify establishment belongs to user's organization
      const { data: establishment } = await supabaseServiceRole
        .from("establishments")
        .select("id, organization_id")
        .eq("id", establishmentId)
        .maybeSingle();

      if (!establishment || establishment.organization_id !== orgId) {
        return new Response(
          JSON.stringify({ error: "Établissement non trouvé" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      const newStatus = body.action === "archive" ? "archived" : "active";

      // ✅ PHASE P1: Anti-phantom — .select("id").single() pour détecter 0 rows
      const { data: updatedEst, error: updateError } = await supabaseServiceRole
        .from("establishments")
        .update({ status: newStatus })
        .eq("id", establishmentId)
        .select("id")
        .single();

      if (updateError) {
        log.error("Update status error", updateError);
        return new Response(
          JSON.stringify({ error: "Erreur lors de la mise à jour" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Détection "succès fantôme" : WHERE a bloqué silencieusement
      if (!updatedEst) {
        return new Response(
          JSON.stringify({ error: "Aucun établissement mis à jour (ID introuvable)" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, status: newStatus }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 44: Assign existing user to establishment (additive, SAFE)
    // ═══════════════════════════════════════════════════════════════════════════
    if (body.action === "assign_user_to_establishment") {
      const { user_id: targetUserId, establishment_id: targetEstId } = body;

      // Validate required fields
      if (!targetUserId || !targetEstId) {
        return new Response(
          JSON.stringify({ error: "user_id and establishment_id are required" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Verify establishment exists and belongs to user's org
      const { data: establishment, error: estError } = await supabaseServiceRole
        .from("establishments")
        .select("id, organization_id, name")
        .eq("id", targetEstId)
        .maybeSingle();

      if (estError || !establishment) {
        return new Response(
          JSON.stringify({ error: "Establishment not found" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      if (establishment.organization_id !== orgId) {
        return new Response(
          JSON.stringify({ error: "Establishment does not belong to your organization" }),
          { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Verify target user exists in the same org
      const { data: targetProfile, error: profileError } = await supabaseServiceRole
        .from("profiles")
        .select("user_id, organization_id, full_name")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (profileError || !targetProfile) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      if (targetProfile.organization_id !== orgId) {
        return new Response(
          JSON.stringify({ error: "User does not belong to your organization" }),
          { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Upsert into user_establishments (idempotent)
      const { error: assignError } = await supabaseServiceRole
        .from("user_establishments")
        .upsert(
          { user_id: targetUserId, establishment_id: targetEstId },
          { onConflict: "user_id,establishment_id", ignoreDuplicates: true }
        );

      if (assignError) {
        log.error("Assign user to establishment error", assignError);
        return new Response(
          JSON.stringify({ error: "Failed to assign user to establishment" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      log.info("completed", { action: "assign_user", user_id: targetUserId, establishment_id: targetEstId });

      return new Response(
        JSON.stringify({
          success: true,
          message: "User assigned to establishment",
          user_id: targetUserId,
          establishment_id: targetEstId,
          establishment_name: establishment.name,
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ÉTAPE 50: Get user assignments per establishment (READ-ONLY, SCOPED)
    // Returns roles + team FOR EACH establishment the user is assigned to
    // EXCLUDES legacy global assignments (establishment_id IS NULL)
    // ═══════════════════════════════════════════════════════════════════════════
    if (body.action === "get_user_assignments") {
      const { user_id: targetUserId } = body;

      if (!targetUserId) {
        return new Response(
          JSON.stringify({ error: "user_id is required" }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Verify target user exists in the same org
      const { data: targetProfile, error: profileError } = await supabaseServiceRole
        .from("profiles")
        .select("user_id, organization_id")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (profileError || !targetProfile) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      if (targetProfile.organization_id !== orgId) {
        return new Response(
          JSON.stringify({ error: "User does not belong to your organization" }),
          { status: 403, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // Get all establishments for the user
      const { data: userEstablishments, error: ueError } = await supabaseServiceRole
        .from("user_establishments")
        .select("establishment_id, establishments(id, name)")
        .eq("user_id", targetUserId);

      if (ueError) {
        log.error("Get user assignments error", ueError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch user establishments" }),
          { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }

      // For each establishment, get roles and team (SCOPED - not NULL)
      const establishments = await Promise.all(
        (userEstablishments || []).map(async (ue) => {
          const estId = ue.establishment_id;
          // FK join returns object (not array) for one-to-one
          const estData = ue.establishments as unknown as { id: string; name: string } | null;
          const estName = estData?.name || "Inconnu";

          // Get roles for this establishment (SCOPED ONLY - exclude NULL)
          const { data: userRoles } = await supabaseServiceRole
            .from("user_roles")
            .select("role_id, roles(id, name)")
            .eq("user_id", targetUserId)
            .eq("establishment_id", estId);

          const roleIds = (userRoles || []).map((ur) => {
            const role = ur.roles as unknown as { id: string; name: string } | null;
            return role?.id;
          }).filter(Boolean) as string[];
          
          const roleNames = (userRoles || []).map((ur) => {
            const role = ur.roles as unknown as { id: string; name: string } | null;
            return role?.name;
          }).filter(Boolean) as string[];

          // Get team for this establishment (SCOPED ONLY - exclude NULL)
          const { data: userTeam } = await supabaseServiceRole
            .from("user_teams")
            .select("team_id, teams(id, name)")
            .eq("user_id", targetUserId)
            .eq("establishment_id", estId)
            .maybeSingle();

          const teamData = userTeam?.teams as unknown as { id: string; name: string } | null;

          return {
            establishment_id: estId,
            establishment_name: estName,
            role_ids: roleIds,
            role_names: roleNames,
            team_id: teamData?.id || null,
            team_name: teamData?.name || null,
          };
        })
      );

      log.info("completed", { action: "get_user_assignments", user_id: targetUserId, count: establishments.length });

      return new Response(
        JSON.stringify({
          success: true,
          user_id: targetUserId,
          establishments,
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Action non reconnue" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (error) {
    log.error("Unhandled error", error);
    return new Response(
      JSON.stringify({ error: "Erreur serveur" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
