/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SIDEBAR SECTIONED — V2.1 Collapsible Sections Component
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renders sidebar with collapsible sections (one open at a time).
 * Uses SIDEBAR_SECTIONS config + navRegistry SSOT for items.
 *
 * RULES:
 * - Items filtered by RBAC via permissions.can()
 * - Sections with no visible items are hidden
 * - Admin-only sections require isAdmin=true
 * - Only one section open at a time
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { NAV_REGISTRY, type NavItem } from "@/config/navRegistry";
import { SIDEBAR_SECTIONS, TOP_SIDEBAR_ITEM_IDS } from "@/config/sidebarSections";
import type { NavPermissions } from "@/lib/nav/buildNavFromPermissions";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch/routePrefetch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface SidebarSectionedProps {
  permissions: NavPermissions;
  disabledModules?: Set<string> | null;
  /** Establishment type — used to conditionally show/hide items (e.g. "clients" only for fournisseur) */
  establishmentType?: string | null;
}

/** IDs only visible for establishment_type === "fournisseur" */
const FOURNISSEUR_ONLY_IDS = new Set<string>(["clients_b2b"]);

/**
 * Check if a nav item is visible based on permissions.
 */
function isItemVisible(item: NavItem, permissions: NavPermissions, disabledModules?: Set<string> | null): boolean {
  if (item.adminOnly) {
    return permissions.isAdmin;
  }
  if (item.moduleKey) {
    // Check module activation first
    if (disabledModules && disabledModules.has(item.moduleKey)) return false;
    return permissions.can(item.moduleKey, "read");
  }
  return true;
}

/**
 * Build a lookup map from navRegistry for fast access.
 */
function buildNavItemMap(): Map<string, NavItem> {
  const map = new Map<string, NavItem>();
  for (const item of NAV_REGISTRY) {
    map.set(item.id, item);
  }
  return map;
}

export function SidebarSectioned({ permissions, disabledModules, establishmentType }: SidebarSectionedProps) {
  const location = useLocation();

  // Build nav item lookup map
  const navItemMap = useMemo(() => buildNavItemMap(), []);

  // Build top-level items (rendered above sections, not in any collapsible group)
  const topItems = useMemo(() => {
    return TOP_SIDEBAR_ITEM_IDS.map((id) => navItemMap.get(id))
      .filter((item): item is NavItem => {
        if (!item) return false;
        if (!item.placements.includes("sidebar")) return false;
        return isItemVisible(item, permissions, disabledModules);
      })
      .sort((a, b) => a.order - b.order);
  }, [permissions, navItemMap, disabledModules]);

  // Filter sections and their items based on permissions
  const visibleSections = useMemo(() => {
    return (
      SIDEBAR_SECTIONS.filter((section) => {
        // Admin-only sections require isAdmin
        if (section.adminOnly && !permissions.isAdmin) {
          return false;
        }
        return true;
      })
        .map((section) => {
          // Get visible items for this section
          // Build items list, preserving "---" separators
          const visibleItems: Array<NavItem | "separator"> = [];
          for (const id of section.itemIds) {
            if (id === "---") {
              // Only add separator if there are items before it
              if (visibleItems.length > 0 && visibleItems[visibleItems.length - 1] !== "separator") {
                visibleItems.push("separator");
              }
              continue;
            }
            const item = navItemMap.get(id);
            if (!item) continue;
            if (!item.placements.includes("sidebar")) continue;
            if (!isItemVisible(item, permissions, disabledModules)) continue;
            // Fournisseur-only items: hidden for non-fournisseur establishments
            if (FOURNISSEUR_ONLY_IDS.has(id) && establishmentType !== "fournisseur") continue;
            visibleItems.push(item);
          }
          // Remove trailing separator
          if (visibleItems[visibleItems.length - 1] === "separator") {
            visibleItems.pop();
          }

          return {
            ...section,
            items: visibleItems,
          };
        })
        .filter((section) => section.items.filter((i) => i !== "separator").length > 0)
        .sort((a, b) => a.order - b.order)
    );
  }, [permissions, navItemMap, disabledModules]);

  // Find the section that contains the current route
  const findSectionForRoute = useMemo(() => {
    const currentPath = location.pathname;

    // If a top-level item is active, don't auto-open any section
    for (const item of topItems) {
      if (currentPath === item.route || currentPath.startsWith(item.route + "/")) {
        return null;
      }
    }

    for (const section of visibleSections) {
      for (const item of section.items) {
        if (item === "separator") continue;
        if (currentPath === item.route || currentPath.startsWith(item.route + "/")) {
          return section.id;
        }
      }
    }
    return visibleSections[0]?.id ?? null;
  }, [location.pathname, topItems, visibleSections]);

  // Track which section is open (only one at a time)
  const [openSectionId, setOpenSectionId] = useState<string | null>(findSectionForRoute);

  // Update open section when route changes
  useEffect(() => {
    if (findSectionForRoute) {
      setOpenSectionId(findSectionForRoute);
    }
  }, [findSectionForRoute]);

  const handleSectionToggle = (sectionId: string) => {
    setOpenSectionId((prev) => (prev === sectionId ? null : sectionId));
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        {/* Top-level items (dashboard, organisation, global) — above all sections */}
        {topItems.length > 0 && (
          <SidebarMenu className="mb-2">
            {topItems.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton asChild onMouseEnter={() => prefetchRoute(item.route)}>
                  <NavLink
                    to={item.route}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}

        <div className="space-y-1">
          {visibleSections.map((section) => {
            const isOpen = openSectionId === section.id;
            const SectionIcon = section.icon;

            return (
              <Collapsible
                key={section.id}
                open={isOpen}
                onOpenChange={() => handleSectionToggle(section.id)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center justify-between w-full px-3 py-2 rounded-md",
                      "text-sm font-medium text-sidebar-foreground",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
                      isOpen && "bg-sidebar-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <SectionIcon className="w-4 h-4" />
                      <span>{section.label}</span>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <SidebarMenu className="pl-4 mt-1">
                    {section.items.map((item, idx) => {
                      if (item === "separator") {
                        return (
                          <div
                            key={`sep-${idx}`}
                            className="mx-3 my-1.5 h-px bg-border"
                          />
                        );
                      }
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton asChild onMouseEnter={() => prefetchRoute(item.route)}>
                            <NavLink
                              to={item.route}
                              className="flex items-center gap-3 px-3 py-2 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                            >
                              <item.icon className="w-4 h-4" />
                              <span className="text-sm">{item.label}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
