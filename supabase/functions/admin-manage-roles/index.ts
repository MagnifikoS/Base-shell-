// ═══════════════════════════════════════════════════════════════════════════
// EDGE FUNCTION: admin-manage-roles
// ═══════════════════════════════════════════════════════════════════════════
//
// PURPOSE:
//   Admin-only API to manage organization-scoped roles and permissions.
//   Validates caller via Supabase JWT, enforces Administrateur role check.
//
// ═══════════════════════════════════════════════════════════════════════════
// MEMORY ARCHITECTURE — Phase 2 (Ligne Droite) / Scoped Writes
// ═══════════════════════════════════════════════════════════════════════════
//
// LEGACY BEHAVIOR (establishment_id = NULL):
//   - The `user_roles` and `user_teams` tables support NULL `establishment_id`.
//   - NULL means "global" assignment (legacy, org-wide).
//   - This is intentional for backward compatibility during Phase 2.
//
// V2 SCOPED WRITES:
//   - When an establishment is active, role assignments are scoped to that
//     `establishment_id` (upsert/delete only for that scope).
//   - If no establishment is provided, the system falls back to legacy global.
//
// CRITICAL RULE:
//   - DO NOT modify this file's logic without a coordinated frontend migration.
//   - The frontend (UsersManager) relies on this behavior for scoped assignment.
//
// FUTURE (Phase 3+):
//   - Legacy global (NULL) assignments will be deprecated.
//   - All assignments will require an explicit establishment_id.
//
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = makeCorsHeaders("POST, OPTIONS");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const log = createLogger("admin-manage-roles");

  try {
    log.info("Request received");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      log.warn("Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      log.warn("Auth failed");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      log.warn("access_denied", { user_id: adminUserId, reason: "not_admin" });
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: orgId, error: orgError } = await supabaseUser.rpc("get_user_organization_id");
    if (orgError || !orgId) {
      return new Response(
        JSON.stringify({ error: "Organization not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit: 20 req/min per IP
    const rateLimited = await checkRateLimit(req, supabaseAdmin, { max: 20, keyPrefix: "admin-manage-roles" });
    if (rateLimited) return rateLimited;

    const body = await req.json();
    const { action, role_id, name, description: _description, permissions, replacement_role_id } = body;

    log.info("handle_action", { user_id: adminUserId, action, role_id });

    // Client context for audit logging (DATA-01)
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || null;
    const clientUserAgent = req.headers.get("user-agent") || null;

    async function logAudit(actionName: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        user_id: adminUserId,
        action: actionName,
        target_type: targetType,
        target_id: targetId,
        metadata: metadata || null,
        ip_address: clientIp,
        user_agent: clientUserAgent,
      });
    }

    // Helper: get admin role id
    async function getAdminRoleId(): Promise<string | null> {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("name", "Administrateur")
        .is("organization_id", null)
        .single();
      return data?.id || null;
    }

    // Helper: count active admins in org
    async function countActiveAdminsInOrg(): Promise<number> {
      const adminRoleId = await getAdminRoleId();
      if (!adminRoleId) return 0;

      const { data: adminUserRoles } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role_id", adminRoleId);

      if (!adminUserRoles || adminUserRoles.length === 0) return 0;

      const userIds = adminUserRoles.map((ur) => ur.user_id);

      const { count } = await supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "active")
        .in("user_id", userIds);

      return count || 0;
    }

    switch (action) {
      case "list_roles": {
        const { data: roles, error: listError } = await supabaseAdmin
          .from("roles")
          .select("*")
          .or(`organization_id.is.null,organization_id.eq.${orgId}`)
          .order("type", { ascending: true })
          .order("name", { ascending: true });

        if (listError) throw listError;

        // Count users per role - single aggregated query (no N+1)
        const roleIds = (roles || []).map((r) => r.id);
        const { data: roleCounts } = await supabaseAdmin
          .from("user_roles")
          .select("role_id")
          .in("role_id", roleIds);

        // Build count map
        const countMap = new Map<string, number>();
        (roleCounts || []).forEach((rc) => {
          countMap.set(rc.role_id, (countMap.get(rc.role_id) || 0) + 1);
        });

        const rolesWithCount = (roles || []).map((role) => ({
          ...role,
          user_count: countMap.get(role.id) || 0,
        }));

        return new Response(
          JSON.stringify({ roles: rolesWithCount }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "create_custom_role": {
        if (!name || typeof name !== "string" || name.trim().length === 0) {
          return new Response(
            JSON.stringify({ error: "Role name is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const trimmedName = name.trim();
        if (trimmedName.length > 50) {
          return new Response(
            JSON.stringify({ error: "Role name must be less than 50 characters" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: newRole, error: createError } = await supabaseAdmin
          .from("roles")
          .insert({
            name: trimmedName,
            organization_id: orgId,
            type: "custom",
          })
          .select()
          .single();

        if (createError) {
          if (createError.code === "23505") {
            return new Response(
              JSON.stringify({ error: "A role with this name already exists" }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          throw createError;
        }

        // Create default permissions (none/self for all modules)
        const { data: modules } = await supabaseAdmin.from("modules").select("key");
        if (modules && modules.length > 0) {
          const defaultPermissions = modules.map((m) => ({
            role_id: newRole.id,
            module_key: m.key,
            access_level: "none",
            scope: "self",
          }));
          await supabaseAdmin.from("role_permissions").insert(defaultPermissions);
        }

        await logAudit("role_created", "role", newRole.id, { name: trimmedName });

        return new Response(
          JSON.stringify({ role: newRole }),
          { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update_role": {
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: existingRole, error: findError } = await supabaseAdmin
          .from("roles")
          .select("*")
          .eq("id", role_id)
          .single();

        if (findError || !existingRole) {
          return new Response(
            JSON.stringify({ error: "Role not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Only custom roles can be updated
        if (existingRole.type === "system") {
          return new Response(
            JSON.stringify({ error: "System roles cannot be renamed" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check org ownership
        if (existingRole.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Role not accessible" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const updates: Record<string, string> = {};
        if (name && typeof name === "string" && name.trim().length > 0) {
          updates.name = name.trim();
        }

        if (Object.keys(updates).length === 0) {
          return new Response(
            JSON.stringify({ error: "No updates provided" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: updatedRole, error: updateError } = await supabaseAdmin
          .from("roles")
          .update(updates)
          .eq("id", role_id)
          .select()
          .single();

        if (updateError) {
          if (updateError.code === "23505") {
            return new Response(
              JSON.stringify({ error: "A role with this name already exists" }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          throw updateError;
        }

        await logAudit("role_updated", "role", role_id, updates);

        return new Response(
          JSON.stringify({ role: updatedRole }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "delete_role": {
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: existingRole, error: findError } = await supabaseAdmin
          .from("roles")
          .select("*")
          .eq("id", role_id)
          .single();

        if (findError || !existingRole) {
          return new Response(
            JSON.stringify({ error: "Role not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Seul le rôle Administrateur ne peut pas être supprimé (anti-lock)
        if (existingRole.name === "Administrateur") {
          return new Response(
            JSON.stringify({ error: "Le rôle Administrateur ne peut pas être supprimé" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check org ownership
        if (existingRole.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Role not accessible" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check if users are assigned
        const { count: userCount } = await supabaseAdmin
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("role_id", role_id);

        if (userCount && userCount > 0) {
          // Need replacement role
          if (!replacement_role_id) {
            return new Response(
              JSON.stringify({ 
                error: "This role has users assigned. Provide a replacement role.",
                requires_replacement: true,
                user_count: userCount
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Verify replacement role exists and is accessible
          const { data: replacementRole } = await supabaseAdmin
            .from("roles")
            .select("*")
            .eq("id", replacement_role_id)
            .single();

          if (!replacementRole) {
            return new Response(
              JSON.stringify({ error: "Replacement role not found" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (replacementRole.organization_id && replacementRole.organization_id !== orgId) {
            return new Response(
              JSON.stringify({ error: "Replacement role not accessible" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Migrate users to replacement role
          const { error: migrateError } = await supabaseAdmin
            .from("user_roles")
            .update({ role_id: replacement_role_id })
            .eq("role_id", role_id);

          if (migrateError) throw migrateError;
        }

        // Delete permissions
        const { error: deletePermsError } = await supabaseAdmin
          .from("role_permissions")
          .delete()
          .eq("role_id", role_id);

        if (deletePermsError) {
          log.error("Error deleting role_permissions", deletePermsError);
          throw deletePermsError;
        }

        // Count ALL invitations referencing this role (FK RESTRICT requires handling)
        const { count: invitationCountAll } = await supabaseAdmin
          .from("invitations")
          .select("*", { count: "exact", head: true })
          .eq("role_id", role_id);

        if (invitationCountAll && invitationCountAll > 0) {
          if (!replacement_role_id) {
            return new Response(
              JSON.stringify({ 
                error: "Ce rôle est utilisé dans des invitations. Fournissez un rôle de remplacement ou utilisez l'option B.",
                requires_replacement: true,
                user_count: userCount || 0,
                invitation_count: invitationCountAll
              }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Migrate ALL invitations to replacement role
          const { error: migrateInvError } = await supabaseAdmin
            .from("invitations")
            .update({ role_id: replacement_role_id })
            .eq("role_id", role_id);

          if (migrateInvError) {
            log.error("Error migrating invitations", migrateInvError);
            throw migrateInvError;
          }
        }

        // Delete role
        const { error: deleteError } = await supabaseAdmin
          .from("roles")
          .delete()
          .eq("id", role_id);

        if (deleteError) {
          log.error("Error deleting role", deleteError);
          throw deleteError;
        }

        await logAudit("role_deleted", "role", role_id, { 
          name: existingRole.name,
          replacement_role_id: replacement_role_id || null 
        });

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_role_permissions": {
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: rolePerms, error: permsError } = await supabaseAdmin
          .from("role_permissions")
          .select("*, module:modules(key, name, display_order)")
          .eq("role_id", role_id)
          .order("module_key");

        if (permsError) throw permsError;

        // Get all modules to ensure complete list
        const { data: allModules } = await supabaseAdmin
          .from("modules")
          .select("key, name, display_order")
          .order("display_order");

        // Merge: include missing modules with default none/self
        const permsByKey = new Map(rolePerms?.map((p) => [p.module_key, p]) || []);
        const completePerms = (allModules || []).map((m) => {
          const existing = permsByKey.get(m.key);
          return existing || {
            role_id,
            module_key: m.key,
            access_level: "none",
            scope: "self",
            module: m,
          };
        });

        return new Response(
          JSON.stringify({ permissions: completePerms }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "set_role_permissions": {
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!permissions || !Array.isArray(permissions)) {
          return new Response(
            JSON.stringify({ error: "Permissions array is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: existingRole } = await supabaseAdmin
          .from("roles")
          .select("*")
          .eq("id", role_id)
          .single();

        if (!existingRole) {
          return new Response(
            JSON.stringify({ error: "Role not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Verify org access for custom roles
        if (existingRole.organization_id && existingRole.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Role not accessible" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Anti-lock: if modifying Administrateur role, ensure we don't remove admin module access
        const adminRoleId = await getAdminRoleId();
        if (role_id === adminRoleId) {
          // Check that admin still has full access to admin module
          const _adminModulePerm = permissions.find((p: { module_key: string }) => p.module_key === "admin" || p.module_key === "users");
          // For now, allow changes but could add stricter checks
        }

        // Valid scopes by module
        const STANDARD_SCOPES = ["self", "team", "establishment", "org"];
        const CAISSE_SCOPES = ["caisse_day", "caisse_month"];
        
        // Blocked legacy module keys (anti-récidive)
        const BLOCKED_MODULE_KEYS = ["utilisateurs"];

        // Upsert permissions
        for (const perm of permissions) {
          const { module_key, access_level, scope } = perm as {
            module_key: string;
            access_level: string;
            scope: string;
          };

          if (!module_key || !access_level || !scope) continue;

          // Block legacy module keys
          if (BLOCKED_MODULE_KEYS.includes(module_key)) {
            return new Response(
              JSON.stringify({ error: `Module key "${module_key}" is deprecated. Use "users" instead.` }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Validate scope based on module
          if (module_key === "caisse") {
            // For caisse module: accept both caisse-specific scopes and standard scopes (backward compatibility)
            const validCaisseScopes = [...CAISSE_SCOPES, ...STANDARD_SCOPES];
            if (!validCaisseScopes.includes(scope)) {
              return new Response(
                JSON.stringify({ error: `Invalid scope "${scope}" for module caisse. Valid: ${CAISSE_SCOPES.join(", ")}` }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          } else {
            // For other modules: only standard scopes
            if (!STANDARD_SCOPES.includes(scope)) {
              return new Response(
                JSON.stringify({ error: `Invalid scope "${scope}" for module ${module_key}. Valid: ${STANDARD_SCOPES.join(", ")}` }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }

          // Check if exists
          const { data: existing } = await supabaseAdmin
            .from("role_permissions")
            .select("id")
            .eq("role_id", role_id)
            .eq("module_key", module_key)
            .single();

          if (existing) {
            await supabaseAdmin
              .from("role_permissions")
              .update({ access_level, scope })
              .eq("id", existing.id);
          } else {
            await supabaseAdmin
              .from("role_permissions")
              .insert({ role_id, module_key, access_level, scope });
          }
        }

        await logAudit("permissions_updated", "role", role_id, { 
          role_name: existingRole.name,
          permissions_count: permissions.length 
        });

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "set_user_roles": {
        // ═══════════════════════════════════════════════════════════════════════════
        // MEMORY ARCHITECTURE — Phase 2 / Étape 18 (Ligne Droite)
        // ═══════════════════════════════════════════════════════════════════════════
        // SCOPED ROLE ASSIGNMENT:
        //   - If establishment_id is provided → write scoped assignments
        //   - If establishment_id is absent → write legacy global (NULL) assignments
        //
        // DELETE SCOPE ISOLATION:
        //   - Scoped mode: only delete WHERE establishment_id = <id>
        //   - Legacy mode: only delete WHERE establishment_id IS NULL
        //
        // UPSERT IDEMPOTENCE:
        //   - Uses onConflict on (user_id, role_id, establishment_id) scoped index
        //   - ignoreDuplicates: true prevents errors on re-assignment
        //
        // Rollback: remove establishment_id from payload (revert to Étape 17)
        // ═══════════════════════════════════════════════════════════════════════════

        // Multi-role assignment: transactional DELETE/INSERT
        const { user_id: targetUserId, role_ids, establishment_id: payloadEstablishmentId } = body;

        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "User ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!Array.isArray(role_ids) || role_ids.length === 0) {
          return new Response(
            JSON.stringify({ error: "At least one role is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Determine mode: scoped (establishment_id provided) vs legacy (NULL)
        const isScoped = !!payloadEstablishmentId;
        const scopeEstablishmentId = isScoped ? payloadEstablishmentId : null;

        // Verify target user exists and is in same org
        const { data: targetProfile } = await supabaseAdmin
          .from("profiles")
          .select("organization_id")
          .eq("user_id", targetUserId)
          .single();

        if (!targetProfile || targetProfile.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "User not found or not in your organization" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // If scoped, verify establishment exists and belongs to org
        if (isScoped) {
          const { data: estabCheck } = await supabaseAdmin
            .from("establishments")
            .select("id, organization_id")
            .eq("id", payloadEstablishmentId)
            .single();

          if (!estabCheck || estabCheck.organization_id !== orgId) {
            return new Response(
              JSON.stringify({ error: "Establishment not found or not in your organization" }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // Verify all role_ids exist and are accessible
        const { data: validRoles } = await supabaseAdmin
          .from("roles")
          .select("id")
          .or(`organization_id.is.null,organization_id.eq.${orgId}`)
          .in("id", role_ids);

        const validRoleIds = new Set((validRoles || []).map((r) => r.id));
        const invalidRoleIds = role_ids.filter((id: string) => !validRoleIds.has(id));

        if (invalidRoleIds.length > 0) {
          return new Response(
            JSON.stringify({ error: "Some roles are invalid or not accessible", invalid_ids: invalidRoleIds }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Anti-lock: check if removing admin role (only for legacy/global scope)
        const adminRoleId = await getAdminRoleId();
        
        // Get current roles IN THE SAME SCOPE (scoped or legacy)
        let currentRolesQuery = supabaseAdmin
          .from("user_roles")
          .select("role_id")
          .eq("user_id", targetUserId);

        if (isScoped) {
          currentRolesQuery = currentRolesQuery.eq("establishment_id", payloadEstablishmentId);
        } else {
          currentRolesQuery = currentRolesQuery.is("establishment_id", null);
        }

        const { data: currentUserRoles } = await currentRolesQuery;
        const currentRoleIds = new Set((currentUserRoles || []).map((ur) => ur.role_id));

        // Admin lock check (only relevant for global/legacy assignments)
        if (!isScoped) {
          const hadAdminRole = adminRoleId && currentRoleIds.has(adminRoleId);
          const willHaveAdminRole = adminRoleId && role_ids.includes(adminRoleId);
          const isRemovingAdminRole = hadAdminRole && !willHaveAdminRole;

          if (isRemovingAdminRole) {
            const activeAdminCount = await countActiveAdminsInOrg();
            
            if (activeAdminCount <= 1) {
              return new Response(
                JSON.stringify({ error: "Cannot remove admin role: this is the last active admin in the organization" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            if (targetUserId === adminUserId) {
              return new Response(
                JSON.stringify({ error: "You cannot remove your own admin role" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // Transaction: SCOPED DELETE + UPSERT
        // ═══════════════════════════════════════════════════════════════════════════
        // 
        // VALIDATION QUERIES (Phase 2 / Étape 19) — Copy-paste to verify behavior:
        //
        // 1. Verify SCOPED assignments created:
        //    SELECT user_id, role_id, establishment_id
        //    FROM public.user_roles
        //    WHERE user_id = '<TARGET_USER_UUID>' AND establishment_id = '<EST_UUID>';
        //
        // 2. Verify LEGACY assignments remain intact:
        //    SELECT user_id, role_id, establishment_id
        //    FROM public.user_roles
        //    WHERE user_id = '<TARGET_USER_UUID>' AND establishment_id IS NULL;
        //
        // Expected: scoped writes only affect rows with matching establishment_id,
        // legacy (NULL) rows are untouched.
        // ═══════════════════════════════════════════════════════════════════════════

        // Step 1: Delete roles that are no longer assigned IN THIS SCOPE ONLY
        const rolesToRemove = [...currentRoleIds].filter((id) => !role_ids.includes(id));
        let deletedCount = 0;

        if (rolesToRemove.length > 0) {
          let deleteQuery = supabaseAdmin
            .from("user_roles")
            .delete()
            .eq("user_id", targetUserId)
            .in("role_id", rolesToRemove);

          // SCOPE ISOLATION: only delete within the same scope
          if (isScoped) {
            deleteQuery = deleteQuery.eq("establishment_id", payloadEstablishmentId);
          } else {
            deleteQuery = deleteQuery.is("establishment_id", null);
          }

          const { error: deleteError } = await deleteQuery;
          if (deleteError) throw deleteError;
          
          deletedCount = rolesToRemove.length;
        }

        // Step 2: Upsert missing roles with IDEMPOTENCE
        const rolesToAdd = role_ids.filter((id: string) => !currentRoleIds.has(id));
        let insertedCount = 0;

        if (rolesToAdd.length > 0) {
          const insertRows = rolesToAdd.map((role_id: string) => ({
            user_id: targetUserId,
            role_id,
            establishment_id: scopeEstablishmentId, // NULL for legacy, UUID for scoped
          }));

          const { error: insertError } = await supabaseAdmin
            .from("user_roles")
            .upsert(insertRows, {
              onConflict: "user_id,role_id,establishment_id",
              ignoreDuplicates: true,
            });

          if (insertError) throw insertError;
          
          insertedCount = rolesToAdd.length;
        }

        // ═══════════════════════════════════════════════════════════════════════════
        // OBSERVABILITY — Phase 2 / Étape 19 (anti-spam: 1x per request, with counters)
        // Log format: mode | user_id | establishment_id | deleted | inserted
        // ═══════════════════════════════════════════════════════════════════════════
        log.info("set_user_roles_completed", {
          mode: isScoped ? "scoped" : "legacy",
          target_user_id: targetUserId,
          establishment_id: scopeEstablishmentId,
          deleted_count: deletedCount,
          inserted_count: insertedCount,
        });

        await logAudit("user_roles_set", "user", targetUserId, { 
          old_role_ids: [...currentRoleIds],
          new_role_ids: role_ids,
          establishment_id: scopeEstablishmentId,
          mode: isScoped ? "scoped" : "legacy",
          deleted_count: deletedCount,
          inserted_count: insertedCount,
        });

        return new Response(
          JSON.stringify({ 
            success: true, 
            role_ids, 
            establishment_id: scopeEstablishmentId, 
            mode: isScoped ? "scoped" : "legacy",
            deleted_count: deletedCount,
            inserted_count: insertedCount,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "change_user_role": {
        // LEGACY: Single role change (kept for backward compatibility)
        // Internally converts to set_user_roles with single role
        const { user_id: targetUserId, new_role_id } = body;

        if (!targetUserId || !new_role_id) {
          return new Response(
            JSON.stringify({ error: "User ID and new role ID are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const adminRoleId = await getAdminRoleId();

        // Get current user role
        const { data: currentUserRole } = await supabaseAdmin
          .from("user_roles")
          .select("role_id")
          .eq("user_id", targetUserId)
          .single();

        const isRemovingAdminRole = currentUserRole?.role_id === adminRoleId && new_role_id !== adminRoleId;

        if (isRemovingAdminRole) {
          // Check if this is the last active admin
          const activeAdminCount = await countActiveAdminsInOrg();
          
          if (activeAdminCount <= 1) {
            return new Response(
              JSON.stringify({ error: "Cannot remove admin role: this is the last active admin in the organization" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Prevent self-demotion if you're the one making the change
          if (targetUserId === adminUserId) {
            return new Response(
              JSON.stringify({ error: "You cannot remove your own admin role" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // Update role
        const { error: updateError } = await supabaseAdmin
          .from("user_roles")
          .update({ role_id: new_role_id })
          .eq("user_id", targetUserId);

        if (updateError) throw updateError;

        await logAudit("user_role_changed", "user", targetUserId, { 
          old_role_id: currentUserRole?.role_id,
          new_role_id 
        });

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "delete_role_with_cancel_invitations": {
        // Action spéciale : supprimer un rôle en supprimant les invitations (si aucun user assigné)
        // Compatible avec FK ON DELETE RESTRICT sur invitations.role_id
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: existingRole, error: findError } = await supabaseAdmin
          .from("roles")
          .select("*")
          .eq("id", role_id)
          .single();

        if (findError || !existingRole) {
          return new Response(
            JSON.stringify({ error: "Role not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Refuser si Administrateur
        if (existingRole.name === "Administrateur") {
          return new Response(
            JSON.stringify({ error: "Le rôle Administrateur ne peut pas être supprimé" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check org ownership
        if (existingRole.organization_id && existingRole.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Role not accessible" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Refuser si des users sont assignés
        const { count: userCount } = await supabaseAdmin
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("role_id", role_id);

        if (userCount && userCount > 0) {
          return new Response(
            JSON.stringify({ 
              error: "Ce rôle a des utilisateurs assignés. Utilisez delete_role avec un rôle de remplacement.",
              user_count: userCount
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Vérifier s'il existe des invitations acceptées (bloquant)
        const { count: acceptedCount } = await supabaseAdmin
          .from("invitations")
          .select("*", { count: "exact", head: true })
          .eq("role_id", role_id)
          .eq("status", "accepted");

        if (acceptedCount && acceptedCount > 0) {
          return new Response(
            JSON.stringify({ 
              error: "Ce rôle a des invitations acceptées. Impossible de supprimer.",
              accepted_invitation_count: acceptedCount
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // SUPPRIMER (DELETE) toutes les invitations liées - tous statuts sauf accepted
        // Note: accepted ne devrait pas exister si user_count=0
        const { data: deletedInvitations, error: deleteInvError } = await supabaseAdmin
          .from("invitations")
          .delete()
          .eq("role_id", role_id)
          .select("id");

        if (deleteInvError) {
          log.error("Error deleting invitations", deleteInvError);
          throw deleteInvError;
        }

        const deletedCount = deletedInvitations?.length || 0;

        // Delete permissions (CASCADE existe mais on le fait explicitement pour audit)
        const { error: deletePermsError } = await supabaseAdmin
          .from("role_permissions")
          .delete()
          .eq("role_id", role_id);

        if (deletePermsError) {
          log.error("Error deleting role_permissions", deletePermsError);
          throw deletePermsError;
        }

        // Delete role
        const { error: deleteError } = await supabaseAdmin
          .from("roles")
          .delete()
          .eq("id", role_id);

        if (deleteError) {
          log.error("Error deleting role", deleteError);
          throw deleteError;
        }

        await logAudit("role_deleted_with_invitations", "role", role_id, { 
          name: existingRole.name,
          deleted_invitations_count: deletedCount
        });

        return new Response(
          JSON.stringify({ ok: true, deleted_role_id: role_id, deleted_invitations_count: deletedCount }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "check_role_dependencies": {
        if (!role_id) {
          return new Response(
            JSON.stringify({ error: "Role ID is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check if role exists and is accessible
        const { data: existingRole } = await supabaseAdmin
          .from("roles")
          .select("*")
          .eq("id", role_id)
          .single();

        if (!existingRole) {
          return new Response(
            JSON.stringify({ error: "Role not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // System roles: check org match
        if (existingRole.organization_id && existingRole.organization_id !== orgId) {
          return new Response(
            JSON.stringify({ error: "Role not accessible" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Count users assigned to this role
        const { count: userCount } = await supabaseAdmin
          .from("user_roles")
          .select("*", { count: "exact", head: true })
          .eq("role_id", role_id);

        // Count ALL invitations using this role (all statuses - FK RESTRICT requires DELETE)
        const { count: invitationCountAll } = await supabaseAdmin
          .from("invitations")
          .select("*", { count: "exact", head: true })
          .eq("role_id", role_id);

        const requiresReplacement = (userCount && userCount > 0) || (invitationCountAll && invitationCountAll > 0);

        return new Response(
          JSON.stringify({
            user_count: userCount || 0,
            invitation_count: invitationCountAll || 0,
            requires_replacement: requiresReplacement,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: unknown) {
    const errObj = error as { code?: string; message?: string; details?: string };
    log.error("Unhandled error", error, {
      code: errObj?.code,
      details: errObj?.details,
    });
    
    // Return user-friendly message for known DB errors
    let userMessage = "Internal server error";
    let status = 500;
    
    if (errObj?.code === "23503") {
      // Foreign key violation
      userMessage = "Cette ressource est encore utilisée ailleurs et ne peut pas être supprimée.";
      status = 400;
    } else if (errObj?.code === "23505") {
      // Unique constraint violation
      userMessage = "Une ressource avec ce nom existe déjà.";
      status = 409;
    } else if (errObj?.message) {
      userMessage = errObj.message;
    }
    
    return new Response(
      JSON.stringify({ error: userMessage }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
