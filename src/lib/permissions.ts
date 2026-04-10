/**
 * Centralized permission helpers (risk-0)
 * Source of truth for module access checks
 */

import type { Database } from "@/integrations/supabase/types";

export type AccessLevel = Database["public"]["Enums"]["access_level"];
export type PermissionScope = Database["public"]["Enums"]["permission_scope"];

export interface ModulePermission {
  module_key: string;
  access_level: AccessLevel;
  scope: PermissionScope;
}

export interface UserPermissions {
  is_admin: boolean;
  permissions: ModulePermission[];
  team_ids: string[];
  establishment_ids: string[];
}

const ACCESS_LEVELS: AccessLevel[] = ["none", "read", "write", "full"];

/**
 * Get permission for a specific module
 */
export function getModulePermission(
  perms: UserPermissions | null,
  moduleKey: string
): { access_level: AccessLevel; scope: PermissionScope } {
  if (!perms) {
    return { access_level: "none", scope: "self" };
  }

  // Admin has full access to everything
  if (perms.is_admin) {
    return { access_level: "full", scope: "org" };
  }

  const modulePerm = perms.permissions.find((p) => p.module_key === moduleKey);

  if (!modulePerm) {
    return { access_level: "none", scope: "self" };
  }

  return {
    access_level: modulePerm.access_level,
    scope: modulePerm.scope,
  };
}

/**
 * Check if user has at least the minimum access level for a module
 */
export function hasAccess(
  perms: UserPermissions | null,
  moduleKey: string,
  minLevel: "read" | "write" | "full"
): boolean {
  if (!perms) return false;

  // Admin has full access
  if (perms.is_admin) return true;

  const { access_level } = getModulePermission(perms, moduleKey);

  const userLevelIndex = ACCESS_LEVELS.indexOf(access_level);
  const minLevelIndex = ACCESS_LEVELS.indexOf(minLevel);

  return userLevelIndex >= minLevelIndex;
}

/**
 * Get scope for a module
 */
export function getScope(
  perms: UserPermissions | null,
  moduleKey: string
): PermissionScope {
  if (!perms) return "self";

  if (perms.is_admin) return "org";

  const { scope } = getModulePermission(perms, moduleKey);
  return scope;
}

/**
 * Check if user can write to a module
 */
export function canWrite(perms: UserPermissions | null, moduleKey: string): boolean {
  return hasAccess(perms, moduleKey, "write");
}

/**
 * Check if user can read a module
 */
export function canRead(perms: UserPermissions | null, moduleKey: string): boolean {
  return hasAccess(perms, moduleKey, "read");
}

/**
 * Check if user is admin
 */
export function isAdmin(perms: UserPermissions | null): boolean {
  return perms?.is_admin ?? false;
}
