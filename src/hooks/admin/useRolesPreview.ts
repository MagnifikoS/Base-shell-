/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useRolesPreview — Fetch roles and their permissions for preview mode
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This hook provides data for the "Role (Preview)" feature in MobileNavConfig.
 * It fetches roles and their associated permissions (read-only).
 *
 * INVARIANTS:
 * - NO modifications to user's actual permissions
 * - NO database writes
 * - Used purely for UI preview
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { filterAssignableRoles } from "@/lib/roles";
import type { ModuleKey } from "@/hooks/usePermissions";
import type { Database } from "@/integrations/supabase/types";

type AccessLevel = Database["public"]["Enums"]["access_level"];

export interface Role {
  id: string;
  name: string;
  type: string;
}

export interface RolePermission {
  module_key: ModuleKey;
  access_level: AccessLevel;
}

interface _RoleWithPermissions extends Role {
  permissions: RolePermission[];
}

/**
 * Fetch list of assignable roles
 */
export function useRolesList() {
  return useQuery({
    queryKey: ["roles-preview-list"],
    queryFn: async () => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });
      if (response.error) throw response.error;
      return filterAssignableRoles(response.data.roles as Role[]);
    },
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — roles rarely change mid-session
  });
}

/**
 * Fetch permissions for a specific role
 */
export function useRolePermissions(roleId: string | null) {
  return useQuery({
    queryKey: ["role-permissions-preview", roleId],
    queryFn: async () => {
      if (!roleId) return [];

      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "get_role_permissions", role_id: roleId },
      });
      if (response.error) throw response.error;

      return (response.data.permissions || []).map(
        (p: { module_key: string; access_level: string }) => ({
          module_key: p.module_key as ModuleKey,
          access_level: p.access_level as AccessLevel,
        })
      ) as RolePermission[];
    },
    enabled: !!roleId,
    staleTime: 30_000, // Refresh more often to pick up recent permission changes
  });
}

/**
 * Check if a module is allowed for a specific role based on preview permissions
 */
export function isModuleAllowedByRole(
  moduleKey: ModuleKey | null,
  rolePermissions: RolePermission[],
  minLevel: AccessLevel = "read"
): boolean {
  if (!moduleKey) return true; // adminOnly items handled separately

  const ACCESS_ORDER: Record<AccessLevel, number> = {
    none: 0,
    read: 1,
    write: 2,
    full: 3,
  };

  const perm = rolePermissions.find((p) => p.module_key === moduleKey);
  if (!perm) return false;

  return ACCESS_ORDER[perm.access_level] >= ACCESS_ORDER[minLevel];
}
