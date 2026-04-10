/**
 * Tests for navRegistry.ts — Navigation SSOT validation
 *
 * Validates structural integrity of the nav registry:
 * - All items have required fields
 * - No duplicate IDs
 * - No duplicate routes (except children sharing parent route)
 * - Valid placements
 * - Order consistency
 * - Module key references
 */

import { describe, it, expect } from "vitest";
import { NAV_REGISTRY, getItemsByPlacement, type NavItem } from "../navRegistry";

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Flatten registry including children
// ═══════════════════════════════════════════════════════════════════════════════

function flattenRegistry(items: NavItem[]): NavItem[] {
  const result: NavItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) {
      result.push(...item.children);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Registry existence and structure
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — existence and structure", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(NAV_REGISTRY)).toBe(true);
    expect(NAV_REGISTRY.length).toBeGreaterThan(0);
  });

  it("has at least 10 top-level items", () => {
    expect(NAV_REGISTRY.length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Required fields validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — required fields", () => {
  it("every item has a non-empty string id", () => {
    for (const item of NAV_REGISTRY) {
      expect(typeof item.id).toBe("string");
      expect(item.id.length).toBeGreaterThan(0);
    }
  });

  it("every item has a non-empty string label", () => {
    for (const item of NAV_REGISTRY) {
      expect(typeof item.label).toBe("string");
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("every item has a route starting with /", () => {
    for (const item of NAV_REGISTRY) {
      expect(typeof item.route).toBe("string");
      expect(item.route.startsWith("/")).toBe(true);
    }
  });

  it("every item has an icon (function or object component)", () => {
    for (const item of NAV_REGISTRY) {
      expect(item.icon).toBeDefined();
      // Lucide icons can be either functions or ForwardRef objects
      expect(["function", "object"].includes(typeof item.icon)).toBe(true);
    }
  });

  it("every item has a placements array", () => {
    for (const item of NAV_REGISTRY) {
      expect(Array.isArray(item.placements)).toBe(true);
    }
  });

  it("every item has a numeric order", () => {
    for (const item of NAV_REGISTRY) {
      expect(typeof item.order).toBe("number");
      expect(Number.isFinite(item.order)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Unique IDs
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — unique IDs", () => {
  it("has no duplicate top-level IDs", () => {
    const ids = NAV_REGISTRY.map((item) => item.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("has no duplicate IDs including children", () => {
    const allItems = flattenRegistry(NAV_REGISTRY);
    const ids = allItems.map((item) => item.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Valid placements
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — valid placements", () => {
  const validPlacements = ["sidebar", "homeTile", "bottomNav"];

  it("all placements use valid values", () => {
    for (const item of NAV_REGISTRY) {
      for (const placement of item.placements) {
        expect(validPlacements).toContain(placement);
      }
    }
  });

  it("children items have empty placements array", () => {
    for (const item of NAV_REGISTRY) {
      if (item.children) {
        for (const child of item.children) {
          expect(child.placements).toEqual([]);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Module key validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — module keys", () => {
  it("items with adminOnly:true have null moduleKey", () => {
    const adminItems = NAV_REGISTRY.filter((item) => item.adminOnly === true);
    for (const item of adminItems) {
      expect(item.moduleKey).toBeNull();
    }
  });

  it("non-admin items have a moduleKey (string or null for non-RBAC items)", () => {
    for (const item of NAV_REGISTRY) {
      if (!item.adminOnly) {
        // moduleKey should be either a string or null
        expect(item.moduleKey === null || typeof item.moduleKey === "string").toBe(true);
      }
    }
  });

  it("children inherit moduleKey from parent", () => {
    for (const item of NAV_REGISTRY) {
      if (item.children) {
        for (const child of item.children) {
          expect(child.moduleKey).toBe(item.moduleKey);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Children structure
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — children structure", () => {
  it("children have childType 'tab'", () => {
    for (const item of NAV_REGISTRY) {
      if (item.children) {
        for (const child of item.children) {
          expect(child.childType).toBe("tab");
        }
      }
    }
  });

  it("children have a tabKey", () => {
    for (const item of NAV_REGISTRY) {
      if (item.children) {
        for (const child of item.children) {
          expect(typeof child.tabKey).toBe("string");
          expect(child.tabKey!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("children share parent route", () => {
    for (const item of NAV_REGISTRY) {
      if (item.children) {
        for (const child of item.children) {
          expect(child.route).toBe(item.route);
        }
      }
    }
  });

  it("children have unique tabKeys within their parent", () => {
    for (const item of NAV_REGISTRY) {
      if (item.children) {
        const tabKeys = item.children.map((c) => c.tabKey);
        const uniqueTabKeys = new Set(tabKeys);
        expect(uniqueTabKeys.size).toBe(tabKeys.length);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: getItemsByPlacement function
// ═══════════════════════════════════════════════════════════════════════════════

describe("getItemsByPlacement", () => {
  it("returns sidebar items sorted by order", () => {
    const sidebarItems = getItemsByPlacement("sidebar");
    expect(sidebarItems.length).toBeGreaterThan(0);

    for (let i = 1; i < sidebarItems.length; i++) {
      expect(sidebarItems[i].order).toBeGreaterThanOrEqual(sidebarItems[i - 1].order);
    }
  });

  it("returns homeTile items", () => {
    const homeTileItems = getItemsByPlacement("homeTile");
    expect(homeTileItems.length).toBeGreaterThan(0);
    for (const item of homeTileItems) {
      expect(item.placements).toContain("homeTile");
    }
  });

  it("returns bottomNav items", () => {
    const bottomNavItems = getItemsByPlacement("bottomNav");
    expect(bottomNavItems.length).toBeGreaterThan(0);
    for (const item of bottomNavItems) {
      expect(item.placements).toContain("bottomNav");
    }
  });

  it("excludes hidden items", () => {
    const sidebarItems = getItemsByPlacement("sidebar");
    for (const item of sidebarItems) {
      expect(item.hidden).not.toBe(true);
    }
  });

  it("includes home in bottomNav items", () => {
    const bottomNavItems = getItemsByPlacement("bottomNav");
    const homeItem = bottomNavItems.find((item) => item.id === "home");
    expect(homeItem).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Known items validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("NAV_REGISTRY — known items exist", () => {
  it("has a dashboard item", () => {
    const dashboard = NAV_REGISTRY.find((i) => i.id === "dashboard");
    expect(dashboard).toBeDefined();
    expect(dashboard!.route).toBe("/dashboard");
    expect(dashboard!.moduleKey).toBe("dashboard");
  });

  it("has a planning item", () => {
    const planning = NAV_REGISTRY.find((i) => i.id === "planning");
    expect(planning).toBeDefined();
    expect(planning!.route).toBe("/planning");
    expect(planning!.moduleKey).toBe("planning");
  });

  it("has a badgeuse item", () => {
    const badgeuse = NAV_REGISTRY.find((i) => i.id === "badgeuse");
    expect(badgeuse).toBeDefined();
    expect(badgeuse!.route).toBe("/badgeuse");
    expect(badgeuse!.moduleKey).toBe("badgeuse");
  });

  it("has an administration item that is admin-only", () => {
    const admin = NAV_REGISTRY.find((i) => i.id === "administration");
    expect(admin).toBeDefined();
    expect(admin!.adminOnly).toBe(true);
    expect(admin!.moduleKey).toBeNull();
  });

  it("has a parametres item", () => {
    const parametres = NAV_REGISTRY.find((i) => i.id === "parametres");
    expect(parametres).toBeDefined();
    expect(parametres!.route).toBe("/parametres");
  });
});
