/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD NAV FROM PERMISSIONS — Pure Function for RBAC-Filtered Navigation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module provides a single pure function to filter navigation items
 * based on user permissions. Used by both Desktop and Mobile.
 *
 * RULES:
 * - No isAdmin || checks for display — all goes through permissions.can()
 * - adminOnly items require isAdmin=true from permissions
 * - Items with moduleKey require permissions.can(moduleKey, "read")
 * - Items with moduleKey=null and no adminOnly are always visible
 *
 * MOBILE PREFS:
 * - Optional prefs param filters mobile placements by hiddenIds
 * - Desktop is never affected by prefs
 * - VISIBLE = RBAC_ALLOWED ∩ USER_PREFS
 *
 * SCOPE-BASED CHILDREN FILTERING (Planning):
 * - scope=self → no children visible
 * - scope=team → no children visible (Phase 1 SAFE fallback)
 * - scope=establishment/org → all children visible
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { NAV_REGISTRY, type NavItem, type NavPlacement } from "@/config/navRegistry";
import type { ModuleKey } from "@/hooks/usePermissions";
import type { MobileNavPrefs } from "@/lib/mobileNavPrefs";

// Re-export NavItem for consumers
export type { NavItem } from "@/config/navRegistry";

/**
 * Permission scope types for navigation filtering (RBAC-only, no caisse scopes)
 */
export type PermissionScope = "self" | "team" | "establishment" | "org";

/**
 * Permissions interface required by the builder.
 * Matches the return type of usePermissions().
 *
 * Extended with optional getScope for scope-based children filtering.
 * Note: getScope returns string to allow broader DB enum values,
 * but only PermissionScope values are used for nav filtering.
 */
export interface NavPermissions {
  isAdmin: boolean;
  can: (moduleKey: ModuleKey, minLevel?: "read" | "write" | "full") => boolean;
  /** Optional: Get scope for a module (returns any DB scope string, filtered internally) */
  getScope?: (moduleKey: ModuleKey) => string | undefined;
  /** Optional: User's team IDs (UUIDs) */
  teamIds?: string[];
  /** Optional: Normalized team tabKeys for scope=team filtering (Phase 2) */
  teamTabKeys?: string[];
}

/**
 * Output structure from buildNavFromPermissions
 */
export interface NavBuildResult {
  /** Items for desktop sidebar (sorted by order) */
  sidebarItems: NavItem[];
  /** Items for mobile home grid (sorted by order) */
  mobileHomeTiles: NavItem[];
  /** Items for mobile bottom navigation (sorted by order) */
  mobileBottomNav: NavItem[];
}

// Anti-spam log tracking
let lastPlanningLogTime = 0;
const PLANNING_LOG_DEBOUNCE_MS = 5000;

/**
 * Filter Planning children based on scope.
 * Phase 2 behavior:
 * - self → no children
 * - team → only children matching teamTabKeys (or [] if no teamTabKeys)
 * - establishment/org → all children
 */
function filterPlanningChildren(children: NavItem[], permissions: NavPermissions): NavItem[] {
  // Get raw scope string, fallback to "establishment" (conservative = show all)
  const rawScope = permissions.getScope?.("planning") ?? "establishment";

  // Only use valid PermissionScope values for filtering
  const validScopes: PermissionScope[] = ["self", "team", "establishment", "org"];
  const scope: PermissionScope = validScopes.includes(rawScope as PermissionScope)
    ? (rawScope as PermissionScope)
    : "establishment";

  let filteredChildren: NavItem[];

  if (scope === "self") {
    // self: no children visible
    filteredChildren = [];
  } else if (scope === "team") {
    // team: only show children matching teamTabKeys
    // - "planning.general" is NOT included for scope=team
    // - If teamTabKeys is empty/undefined → no children (safe)
    const teamTabKeys = permissions.teamTabKeys ?? [];
    if (teamTabKeys.length === 0) {
      filteredChildren = [];
    } else {
      filteredChildren = children.filter(
        (child) => child.childType === "tab" && child.tabKey && teamTabKeys.includes(child.tabKey)
      );
    }
  } else {
    // establishment or org: show all children
    filteredChildren = children;
  }

  // DEV-only anti-spam log
  if (import.meta.env.DEV) {
    const now = Date.now();
    if (now - lastPlanningLogTime > PLANNING_LOG_DEBOUNCE_MS) {
      lastPlanningLogTime = now;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[buildNav] planning children filter", {
          scope,
          teamIdsCount: permissions.teamIds?.length ?? 0,
          teamTabKeys: permissions.teamTabKeys ?? [],
          childrenBefore: children.length,
          childrenAfter: filteredChildren.length,
        });
      }
    }
  }

  return filteredChildren;
}

/**
 * Determines if a navigation item should be visible based on permissions.
 *
 * Logic:
 * 1. adminOnly=true → requires isAdmin
 * 2. moduleKey is set → requires can(moduleKey, "read")
 * 3. moduleKey is null and not adminOnly → always visible
 */
function isItemVisible(
  item: NavItem,
  permissions: NavPermissions,
  disabledModules?: Set<string> | null
): boolean {
  // Hidden items (Coming Soon placeholders) are never visible
  if (item.hidden) {
    return false;
  }

  // ═══ MODULE ACTIVATION FILTER — Priority over RBAC ═══
  // If disabledModules is set (explicit config exists) and this module is disabled,
  // hide it regardless of RBAC permissions.
  if (disabledModules && item.moduleKey && disabledModules.has(item.moduleKey)) {
    return false;
  }

  // Admin-only items
  if (item.adminOnly) {
    return permissions.isAdmin;
  }

  // Items with module permission requirement
  if (item.moduleKey) {
    return permissions.can(item.moduleKey, "read");
  }

  // Items without moduleKey and not adminOnly (e.g., Home, Notifications in nav)
  return true;
}

/**
 * Apply scope-based children filtering to an item.
 * Currently only affects Planning module.
 */
function applyChildrenFilter(item: NavItem, permissions: NavPermissions): NavItem {
  if (!item.children || item.children.length === 0) {
    return item;
  }

  // Only filter Planning children by scope in Phase 1
  if (item.id === "planning") {
    const filteredChildren = filterPlanningChildren(item.children, permissions);
    return { ...item, children: filteredChildren };
  }

  // Other modules: keep all children (no scope filtering in Phase 1)
  return item;
}

/**
 * Filter and sort items for a specific placement.
 * Optionally applies mobile prefs for mobile placements.
 */
function filterByPlacement(
  items: NavItem[],
  placement: NavPlacement,
  permissions: NavPermissions,
  prefs?: MobileNavPrefs,
  disabledModules?: Set<string> | null
): NavItem[] {
  let filtered = items
    .filter((item) => item.placements.includes(placement))
    .filter((item) => isItemVisible(item, permissions, disabledModules))
    // Apply scope-based children filtering
    .map((item) => applyChildrenFilter(item, permissions));

  // Apply mobile prefs only for mobile placements
  if (prefs && (placement === "homeTile" || placement === "bottomNav")) {
    filtered = filtered.filter((item) => !prefs.hiddenIds.includes(item.id));
  }

  return filtered.sort((a, b) => a.order - b.order);
}

/**
 * Build navigation lists from permissions.
 *
 * This is the single entry point for both Desktop and Mobile
 * to get their filtered navigation items.
 *
 * @param permissions - The permissions object from usePermissions()
 * @param prefs - Optional mobile nav prefs (affects homeTile + bottomNav only)
 * @param disabledModules - Optional set of disabled module keys (from useEstablishmentModules)
 * @returns Object with sidebarItems, mobileHomeTiles, mobileBottomNav
 */
export function buildNavFromPermissions(
  permissions: NavPermissions,
  prefs?: MobileNavPrefs,
  disabledModules?: Set<string> | null
): NavBuildResult {
  // DEV-only log (anti-spam: only in development)
  if (import.meta.env.DEV) {
    const totalAllowed = NAV_REGISTRY.filter((item) => isItemVisible(item, permissions, disabledModules)).length;
    const hiddenCount = prefs?.hiddenIds.length ?? 0;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[buildNav] summary", {
        totalAllowed,
        hiddenCount,
        disabledModulesCount: disabledModules?.size ?? 0,
        version: "v3-modules",
      });
    }
  }

  return {
    sidebarItems: filterByPlacement(NAV_REGISTRY, "sidebar", permissions, undefined, disabledModules),
    mobileHomeTiles: filterByPlacement(NAV_REGISTRY, "homeTile", permissions, prefs, disabledModules),
    mobileBottomNav: filterByPlacement(NAV_REGISTRY, "bottomNav", permissions, prefs, disabledModules),
  };
}

/**
 * Get sidebar items grouped by their group property.
 * Useful for desktop sidebar rendering with separators.
 */
export function getSidebarItemsGrouped(
  permissions: NavPermissions,
  disabledModules?: Set<string> | null
): {
  main: NavItem[];
  rbac: NavItem[];
  settings: NavItem[];
  footer: NavItem[];
} {
  const items = filterByPlacement(NAV_REGISTRY, "sidebar", permissions, undefined, disabledModules);

  return {
    main: items.filter((i) => i.group === "main"),
    rbac: items.filter((i) => i.group === "rbac"),
    settings: items.filter((i) => i.group === "settings"),
    footer: items.filter((i) => i.group === "footer"),
  };
}
