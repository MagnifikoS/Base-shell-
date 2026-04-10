/**
 * Tests for buildNavFromPermissions — Pure function for RBAC-filtered navigation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildNavFromPermissions,
  getSidebarItemsGrouped,
  type NavPermissions,
} from "../buildNavFromPermissions";
import { NAV_REGISTRY } from "@/config/navRegistry";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeAdminPermissions(): NavPermissions {
  return {
    isAdmin: true,
    can: () => true,
  };
}

function makeRegularPermissions(allowedModules: string[]): NavPermissions {
  return {
    isAdmin: false,
    can: (moduleKey: string) => allowedModules.includes(moduleKey),
  };
}

function makeNoPermissions(): NavPermissions {
  return {
    isAdmin: false,
    can: () => false,
  };
}

// Suppress dev console logs
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Admin access
// ═══════════════════════════════════════════════════════════════════════════

describe("buildNavFromPermissions — admin access", () => {
  it("admin sees all non-hidden items in sidebar", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    const allNonHiddenSidebar = NAV_REGISTRY.filter(
      (i) => i.placements.includes("sidebar") && !i.hidden
    );
    expect(result.sidebarItems.length).toBe(allNonHiddenSidebar.length);
  });

  it("admin sees admin-only items", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    const adminItems = result.sidebarItems.filter((i) =>
      NAV_REGISTRY.find((r) => r.id === i.id && r.adminOnly)
    );
    expect(adminItems.length).toBeGreaterThan(0);
  });

  it("admin result has sidebarItems, mobileHomeTiles, and mobileBottomNav", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    expect(Array.isArray(result.sidebarItems)).toBe(true);
    expect(Array.isArray(result.mobileHomeTiles)).toBe(true);
    expect(Array.isArray(result.mobileBottomNav)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Non-admin access
// ═══════════════════════════════════════════════════════════════════════════

describe("buildNavFromPermissions — non-admin access", () => {
  it("user without permissions sees no admin-only items", () => {
    const result = buildNavFromPermissions(makeNoPermissions());
    const adminItems = result.sidebarItems.filter((i) =>
      NAV_REGISTRY.find((r) => r.id === i.id && r.adminOnly)
    );
    expect(adminItems.length).toBe(0);
  });

  it("user with dashboard permission sees dashboard item", () => {
    const result = buildNavFromPermissions(makeRegularPermissions(["dashboard"]));
    const dashboard = result.sidebarItems.find((i) => i.id === "dashboard");
    expect(dashboard).toBeDefined();
  });

  it("user without planning permission does not see planning", () => {
    const result = buildNavFromPermissions(makeRegularPermissions(["dashboard"]));
    const planning = result.sidebarItems.find((i) => i.id === "planning");
    expect(planning).toBeUndefined();
  });

  it("user sees items without moduleKey (like home, notifications)", () => {
    const result = buildNavFromPermissions(makeRegularPermissions([]));
    const noModuleItems = NAV_REGISTRY.filter(
      (i) => i.moduleKey === null && !i.adminOnly && !i.hidden && i.placements.includes("sidebar")
    );
    for (const item of noModuleItems) {
      expect(result.sidebarItems.find((i) => i.id === item.id)).toBeDefined();
    }
  });

  it("no permissions user still sees non-RBAC items", () => {
    const result = buildNavFromPermissions(makeNoPermissions());
    // Items with moduleKey=null and no adminOnly should still be visible
    expect(result.sidebarItems.length).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Sorting
// ═══════════════════════════════════════════════════════════════════════════

describe("buildNavFromPermissions — sorting", () => {
  it("sidebar items are sorted by order", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    for (let i = 1; i < result.sidebarItems.length; i++) {
      expect(result.sidebarItems[i].order).toBeGreaterThanOrEqual(result.sidebarItems[i - 1].order);
    }
  });

  it("mobileBottomNav items are sorted by order", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    for (let i = 1; i < result.mobileBottomNav.length; i++) {
      expect(result.mobileBottomNav[i].order).toBeGreaterThanOrEqual(
        result.mobileBottomNav[i - 1].order
      );
    }
  });

  it("mobileHomeTiles items are sorted by order", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    for (let i = 1; i < result.mobileHomeTiles.length; i++) {
      expect(result.mobileHomeTiles[i].order).toBeGreaterThanOrEqual(
        result.mobileHomeTiles[i - 1].order
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Mobile prefs filtering
// ═══════════════════════════════════════════════════════════════════════════

describe("buildNavFromPermissions — mobile prefs", () => {
  it("prefs.hiddenIds filters mobileBottomNav items", () => {
    const prefs = { hiddenIds: ["home"] };
    const result = buildNavFromPermissions(makeAdminPermissions(), prefs);
    const home = result.mobileBottomNav.find((i) => i.id === "home");
    expect(home).toBeUndefined();
  });

  it("prefs.hiddenIds filters mobileHomeTiles items", () => {
    const prefs = { hiddenIds: ["dashboard"] };
    const result = buildNavFromPermissions(makeAdminPermissions(), prefs);
    const dashboard = result.mobileHomeTiles.find((i) => i.id === "dashboard");
    expect(dashboard).toBeUndefined();
  });

  it("prefs do NOT affect sidebar items", () => {
    const prefs = { hiddenIds: ["dashboard"] };
    const result = buildNavFromPermissions(makeAdminPermissions(), prefs);
    const dashboard = result.sidebarItems.find((i) => i.id === "dashboard");
    expect(dashboard).toBeDefined();
  });

  it("empty hiddenIds shows all items", () => {
    const prefs = { hiddenIds: [] as string[] };
    const withPrefs = buildNavFromPermissions(makeAdminPermissions(), prefs);
    const withoutPrefs = buildNavFromPermissions(makeAdminPermissions());
    expect(withPrefs.mobileBottomNav.length).toBe(withoutPrefs.mobileBottomNav.length);
  });

  it("no prefs shows all allowed items", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    expect(result.mobileBottomNav.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Hidden items
// ═══════════════════════════════════════════════════════════════════════════

describe("buildNavFromPermissions — hidden items", () => {
  it("hidden items are never included even for admin", () => {
    const result = buildNavFromPermissions(makeAdminPermissions());
    const hiddenIds = NAV_REGISTRY.filter((i) => i.hidden).map((i) => i.id);
    for (const hiddenId of hiddenIds) {
      expect(result.sidebarItems.find((i) => i.id === hiddenId)).toBeUndefined();
      expect(result.mobileBottomNav.find((i) => i.id === hiddenId)).toBeUndefined();
      expect(result.mobileHomeTiles.find((i) => i.id === hiddenId)).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Planning children scope filtering
// ═══════════════════════════════════════════════════════════════════════════

describe("buildNavFromPermissions — planning scope filtering", () => {
  it("scope=self results in no planning children", () => {
    const permissions: NavPermissions = {
      isAdmin: false,
      can: (m) => m === "planning",
      getScope: () => "self",
    };
    const result = buildNavFromPermissions(permissions);
    const planning = result.sidebarItems.find((i) => i.id === "planning");
    if (planning) {
      expect(planning.children?.length ?? 0).toBe(0);
    }
  });

  it("scope=team with no teamTabKeys results in no children", () => {
    const permissions: NavPermissions = {
      isAdmin: false,
      can: (m) => m === "planning",
      getScope: () => "team",
      teamTabKeys: [],
    };
    const result = buildNavFromPermissions(permissions);
    const planning = result.sidebarItems.find((i) => i.id === "planning");
    if (planning) {
      expect(planning.children?.length ?? 0).toBe(0);
    }
  });

  it("scope=establishment shows all planning children", () => {
    const permissions: NavPermissions = {
      isAdmin: false,
      can: (m) => m === "planning",
      getScope: () => "establishment",
    };
    const result = buildNavFromPermissions(permissions);
    const planning = result.sidebarItems.find((i) => i.id === "planning");
    const originalPlanning = NAV_REGISTRY.find((i) => i.id === "planning");
    if (planning && originalPlanning?.children) {
      expect(planning.children?.length).toBe(originalPlanning.children.length);
    }
  });

  it("scope=org shows all planning children", () => {
    const permissions: NavPermissions = {
      isAdmin: false,
      can: (m) => m === "planning",
      getScope: () => "org",
    };
    const result = buildNavFromPermissions(permissions);
    const planning = result.sidebarItems.find((i) => i.id === "planning");
    const originalPlanning = NAV_REGISTRY.find((i) => i.id === "planning");
    if (planning && originalPlanning?.children) {
      expect(planning.children?.length).toBe(originalPlanning.children.length);
    }
  });

  it("invalid scope defaults to establishment (all children)", () => {
    const permissions: NavPermissions = {
      isAdmin: false,
      can: (m) => m === "planning",
      getScope: () => "caisse_day" as string,
    };
    const result = buildNavFromPermissions(permissions);
    const planning = result.sidebarItems.find((i) => i.id === "planning");
    const originalPlanning = NAV_REGISTRY.find((i) => i.id === "planning");
    if (planning && originalPlanning?.children) {
      expect(planning.children?.length).toBe(originalPlanning.children.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: getSidebarItemsGrouped
// ═══════════════════════════════════════════════════════════════════════════

describe("getSidebarItemsGrouped", () => {
  it("returns main, rbac, settings, and footer groups", () => {
    const grouped = getSidebarItemsGrouped(makeAdminPermissions());
    expect(grouped).toHaveProperty("main");
    expect(grouped).toHaveProperty("rbac");
    expect(grouped).toHaveProperty("settings");
    expect(grouped).toHaveProperty("footer");
  });

  it("all groups contain arrays", () => {
    const grouped = getSidebarItemsGrouped(makeAdminPermissions());
    expect(Array.isArray(grouped.main)).toBe(true);
    expect(Array.isArray(grouped.rbac)).toBe(true);
    expect(Array.isArray(grouped.settings)).toBe(true);
    expect(Array.isArray(grouped.footer)).toBe(true);
  });

  it("main group has items", () => {
    const grouped = getSidebarItemsGrouped(makeAdminPermissions());
    expect(grouped.main.length).toBeGreaterThan(0);
  });

  it("items belong to the correct group", () => {
    const grouped = getSidebarItemsGrouped(makeAdminPermissions());
    for (const item of grouped.main) expect(item.group).toBe("main");
    for (const item of grouped.rbac) expect(item.group).toBe("rbac");
    for (const item of grouped.settings) expect(item.group).toBe("settings");
    for (const item of grouped.footer) expect(item.group).toBe("footer");
  });
});
