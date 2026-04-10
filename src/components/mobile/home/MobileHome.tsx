/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE HOME — Two layouts based on role
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Admin / Directeur → Sidebar + sections (legacy layout)
 * Standard employee  → Flat icon grid, no sidebar
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useEstablishmentModules } from "@/hooks/useEstablishmentModules";
import { ModuleTile } from "./ModuleTile";
import { MobileLayout } from "../MobileLayout";
import { Loader2, Star, Home, User, PackageMinus } from "lucide-react";
import { buildNavFromPermissions, type NavPermissions, type NavItem } from "@/lib/nav/buildNavFromPermissions";
import { useEstablishmentRoleNavConfig } from "@/hooks/useEstablishmentRoleNavConfig";
import { useTeamTabKeys } from "@/hooks/nav/useTeamTabKeys";
import { SIDEBAR_SECTIONS } from "@/config/sidebarSections";
import { cn } from "@/lib/utils";
import { ModuleSidebar, type ModuleSidebarItem } from "./ModuleSidebar";
import { MobileFavoritesSection } from "./MobileFavoritesSection";
import { useMobileFavorites } from "@/hooks/useMobileFavorites";
import { supabase } from "@/integrations/supabase/client";

/** IDs to exclude from home tiles (already in bottom nav) */
const EXCLUDED_HOME_IDS = new Set(["parametres", "administration", "mobile_nav_config"]);

/** Color palette for section tiles */
const SECTION_COLORS: Record<string, string> = {
  rh: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
  finance: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  achats: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  vente: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
  pilotage: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
};

interface SectionGroup {
  id: string;
  label: string;
  icon: ModuleSidebarItem["icon"];
  items: NavItem[];
  color: string;
}

/**
 * Priority order for employee flat grid.
 * "salaries" is handled separately (first tile with user name).
 */
const EMPLOYEE_PRIORITY_ORDER = [
  "badgeuse",
  "planning",
  "conges_absences",
  "__retrait__",  // synthetic tile → /inventaire?tab=retrait
  "dlc-critique",
  "inventaire",
  "caisse",
  "commandes",
  // Remaining modules added after these if the employee has access
  "produits_v2",
  "fournisseurs",
  "recettes",
  "plats_fournisseurs",
  "pertes",
  "food_cost",
  "plat_du_jour",
];

/** Synthetic "Retrait" tile — lives in employee grid only, links to inventaire?tab=retrait */
const RETRAIT_TILE: NavItem = {
  id: "__retrait__",
  label: "Retrait",
  route: "/inventaire?tab=retrait",
  icon: PackageMinus,
  moduleKey: "inventaire" as NavItem["moduleKey"],
  placements: [],
  tileColor: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  order: 0,
  group: "rbac",
};

export function MobileHome() {
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const permissions = usePermissions();
  const { isLoading } = permissions;

  const userId = user?.id ?? null;
  const establishmentId = activeEstablishment?.id ?? null;

  const { teamTabKeys, isLoading: teamTabKeysLoading } = useTeamTabKeys({
    establishmentId,
    teamIds: permissions.teamIds ?? [],
  });

  const { disabledModules, isLoading: modulesLoading } = useEstablishmentModules(establishmentId);

  const isReady = Boolean(userId && establishmentId && !isLoading && !teamTabKeysLoading && !modulesLoading);

  const { prefs } = useEstablishmentRoleNavConfig(establishmentId);
  const { favoriteIds } = useMobileFavorites(userId);

  // Fetch user full_name — uses prefetched cache from SmartHomeRedirect (OPT-4)
  const { data: userFullName = null } = useQuery({
    queryKey: ["profile-fullname", userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", userId)
        .single();
      return data?.full_name ?? null;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const navPermissions: NavPermissions = useMemo(
    () => ({
      isAdmin: permissions.isAdmin,
      can: permissions.can,
      getScope: permissions.getScope,
      teamIds: permissions.teamIds,
      teamTabKeys,
    }),
    [permissions, teamTabKeys]
  );

  const visibleModules = useMemo(() => {
    const { mobileHomeTiles } = buildNavFromPermissions(navPermissions, prefs, disabledModules);
    return mobileHomeTiles.filter((m) => !EXCLUDED_HOME_IDS.has(m.id));
  }, [navPermissions, prefs, disabledModules]);

  // Set of all allowed IDs for favorites filtering
  const allowedIds = useMemo(() => new Set(visibleModules.map((m) => m.id)), [visibleModules]);

  // ─── Admin layout data ───
  const sections = useMemo(() => {
    const moduleById = new Map<string, NavItem>();
    for (const mod of visibleModules) {
      moduleById.set(mod.id, mod);
    }

    const result: SectionGroup[] = [];
    for (const section of SIDEBAR_SECTIONS) {
      if (section.id === "parametres" || section.id === "admin") continue;
      if (section.adminOnly && !permissions.isAdmin) continue;

      const sectionItems = section.itemIds
        .map((id) => moduleById.get(id))
        .filter((m): m is NavItem => !!m);

      if (sectionItems.length > 0) {
        result.push({
          id: section.id,
          label: section.label,
          icon: section.icon,
          items: sectionItems,
          color: SECTION_COLORS[section.id] ?? "bg-muted text-muted-foreground",
        });
      }
    }
    return result;
  }, [visibleModules, permissions.isAdmin]);

  const sidebarItems: ModuleSidebarItem[] = useMemo(
    () => [
      {
        id: "accueil",
        label: "Accueil",
        icon: Home,
        color: "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary",
      },
      {
        id: "favoris",
        label: "Favoris",
        icon: Star,
        color: "bg-amber-50 text-amber-500 dark:bg-amber-950/40 dark:text-amber-400",
      },
      ...sections.map((s) => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        color: s.color,
      })),
    ],
    [sections]
  );

  const QUICK_ACCESS_ORDER = [
    "badgeuse",
    "planning",
    "conges_absences",
    "salaries",
    "produits_v2",
    "commandes",
    "inventaire",
    "dlc-critique",
  ];

  const quickAccessTiles = useMemo(() => {
    const moduleById = new Map<string, NavItem>();
    for (const mod of visibleModules) {
      moduleById.set(mod.id, mod);
    }
    return QUICK_ACCESS_ORDER
      .map((id) => moduleById.get(id))
      .filter((m): m is NavItem => !!m);
  }, [visibleModules]);

  // ─── Employee flat grid ───
  const employeeTiles = useMemo(() => {
    const moduleById = new Map<string, NavItem>();
    for (const mod of visibleModules) {
      moduleById.set(mod.id, mod);
    }

    // Inject synthetic retrait tile if user has inventaire access
    const hasInventaire = moduleById.has("inventaire");
    if (hasInventaire) {
      moduleById.set("__retrait__", RETRAIT_TILE);
    }

    const ordered: NavItem[] = [];
    const usedIds = new Set<string>();

    // First: salaries tile (handled separately with custom label)
    // Skip it in the priority list, we'll add it manually in render

    for (const id of EMPLOYEE_PRIORITY_ORDER) {
      const mod = moduleById.get(id);
      if (mod && !usedIds.has(id)) {
        ordered.push(mod);
        usedIds.add(id);
      }
    }

    // Add remaining modules not in priority order
    for (const mod of visibleModules) {
      if (!usedIds.has(mod.id) && mod.id !== "salaries") {
        ordered.push(mod);
        usedIds.add(mod.id);
      }
    }

    return ordered;
  }, [visibleModules]);

  const [activeSection, setActiveSection] = useState<string | null>("accueil");
  const currentSection = activeSection && activeSection !== "favoris" && activeSection !== "accueil"
    ? sections.find((s) => s.id === activeSection)
    : null;

  if (!isReady) {
    return (
      <MobileLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMPLOYEE VIEW — Flat grid, no sidebar
  // ═══════════════════════════════════════════════════════════════════════════
  if (!permissions.isAdmin) {
    const hasSalaries = visibleModules.some((m) => m.id === "salaries");
    const salariesItem = visibleModules.find((m) => m.id === "salaries");
    const displayName = userFullName || user?.email?.split("@")[0] || "Mon profil";

    return (
      <MobileLayout>
        <div className="flex flex-col p-4 overflow-y-auto">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Accueil
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {/* First tile: Salariés with user name */}
            {hasSalaries && salariesItem && (
              <ModuleTile
                key="salaries-personal"
                title={displayName}
                icon={salariesItem.icon}
                path={salariesItem.route}
                color={salariesItem.tileColor}
                disabled={false}
              />
            )}
            {/* Priority-ordered tiles */}
            {employeeTiles.map((mod) => (
              <ModuleTile
                key={mod.id}
                title={mod.label}
                icon={mod.icon}
                path={mod.route}
                color={mod.tileColor}
                disabled={false}
              />
            ))}
          </div>
        </div>
      </MobileLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN VIEW — Sidebar + sections (unchanged)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <MobileLayout>
      <div className="flex min-h-[calc(100dvh-120px)]">
        {/* ── Left sidebar: module icons ── */}
        <div className="w-14 shrink-0 border-r border-border bg-muted/30">
          <ModuleSidebar
            sections={sidebarItems}
            activeId={activeSection}
            onSelect={setActiveSection}
          />
        </div>

        {/* ── Center content ── */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto">
          {currentSection ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg",
                    currentSection.color
                  )}
                >
                  <currentSection.icon className="h-4 w-4" />
                </div>
                <h2 className="text-base font-semibold text-foreground">
                  {currentSection.label}
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {currentSection.items.map((mod) => (
                  <ModuleTile
                    key={mod.id}
                    title={mod.label}
                    icon={mod.icon}
                    path={mod.route}
                    color={mod.tileColor}
                    disabled={false}
                  />
                ))}
              </div>
            </div>
          ) : activeSection === "favoris" ? (
            <div className="flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-4">
                <Star className="h-4 w-4 text-amber-500" />
                <h2 className="text-base font-semibold text-foreground">
                  Favoris
                </h2>
              </div>
              <MobileFavoritesSection
                favoriteIds={favoriteIds}
                allowedIds={allowedIds}
              />
            </div>
          ) : (!activeSection || activeSection === "accueil") ? (
            <div className="flex flex-col flex-1">
              <h2 className="text-base font-semibold text-foreground mb-4">
                Accueil
              </h2>
              <div className="grid grid-cols-3 gap-2.5">
                {quickAccessTiles.map((mod) => (
                  <ModuleTile
                    key={mod.id}
                    title={mod.label}
                    icon={mod.icon}
                    path={mod.route}
                    color={mod.tileColor}
                    disabled={false}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </MobileLayout>
  );
}
