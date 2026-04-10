/**
 * RBAC Scope filtering utilities
 * Pure functions - no fetching, no side effects
 */

import type { Database } from "@/integrations/supabase/types";

export type PermissionScope = Database["public"]["Enums"]["permission_scope"];

export interface ScopeFilterParams<T> {
  /** The scope from user permissions for this module */
  scope: PermissionScope;
  /** Current authenticated user ID */
  userId: string;
  /** User's team IDs from permissions */
  myTeamIds: string[];
  /** Currently selected establishment ID (from EstablishmentContext SSOT) */
  selectedEstablishmentId: string | null;
  /** User's establishment IDs from permissions */
  myEstablishmentIds: string[];
  /** Items to filter */
  items: T[];
  /** Getter for user_id on each item */
  getUserId: (item: T) => string | null | undefined;
  /** Getter for team_id on each item */
  getTeamId: (item: T) => string | null | undefined;
  /** Getter for establishment_id on each item (optional - some payloads are already filtered by establishment) */
  getEstablishmentId?: (item: T) => string | null | undefined;
}

/**
 * Filter items based on RBAC scope.
 * 
 * Scope priority:
 * - self: only items where user_id === current user
 * - team: only items where team_id ∈ myTeamIds
 * - establishment: only items where establishment_id === selectedEstablishmentId
 *   (if no selectedEstablishmentId and myEstablishmentIds.length === 1, use that)
 */
export function filterByScope<T>({
  scope,
  userId,
  myTeamIds,
  selectedEstablishmentId,
  myEstablishmentIds,
  items,
  getUserId,
  getTeamId,
  getEstablishmentId,
}: ScopeFilterParams<T>): T[] {
  // self: show only user's own items
  if (scope === "self") {
    return items.filter((item) => getUserId(item) === userId);
  }

  // team: show items from user's teams
  if (scope === "team") {
    const teamSet = new Set(myTeamIds);
    return items.filter((item) => {
      const teamId = getTeamId(item);
      return teamId != null && teamSet.has(teamId);
    });
  }

  // establishment, caisse_day, caisse_month: show items from selected establishment
  if (scope === "establishment" || scope === "caisse_day" || scope === "caisse_month") {
    // If no establishment getter, assume data is already filtered by establishment
    if (!getEstablishmentId) {
      return items;
    }

    // Determine which establishment to filter by
    const effectiveEstId =
      selectedEstablishmentId ||
      (myEstablishmentIds.length === 1 ? myEstablishmentIds[0] : null);

    if (!effectiveEstId) {
      // No establishment selected and user has multiple - return empty
      return [];
    }

    return items.filter((item) => getEstablishmentId(item) === effectiveEstId);
  }

  // org: no restriction - return all items
  if (scope === "org") {
    return items;
  }

  // Fallback: return nothing for unknown scopes
  return [];
}

/**
 * Check if user should see only their own data (self scope).
 */
export function isSelfScope(scope: PermissionScope): boolean {
  return scope === "self";
}

/**
 * Check if user should see team data.
 */
export function isTeamScope(scope: PermissionScope): boolean {
  return scope === "team";
}

/**
 * Check if scope is establishment-level.
 */
export function isEstablishmentScope(scope: PermissionScope): boolean {
  return scope === "establishment" || scope === "caisse_day" || scope === "caisse_month";
}

/**
 * Check if scope is org-level (full access).
 */
export function isOrgScope(scope: PermissionScope): boolean {
  return scope === "org";
}
