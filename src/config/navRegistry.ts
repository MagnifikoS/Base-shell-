/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NAV REGISTRY — Single Source of Truth (SSOT) for Navigation Items
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This registry defines ALL navigation items for Desktop and Mobile.
 * No other file should define navigation items directly.
 *
 * RULES:
 * - `id` must be stable and unique
 * - `moduleKey` maps to DB modules table for RBAC
 * - `adminOnly` items require isAdmin=true (no moduleKey check)
 * - All items without adminOnly use RBAC via permissions.can(moduleKey)
 *
 * PLACEMENT:
 * - sidebar: appears in desktop sidebar
 * - homeTile: appears in mobile home grid
 * - bottomNav: appears in mobile bottom navigation bar
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Calendar,
  CalendarDays,
  Users,
  Clock,
  Receipt,
  BarChart3,
  Settings,
  UserCog,
  Wallet,
  FileSignature,
  Bell,
  Shield,
  Home,
  Fingerprint,
  UserCheck,
  FileText,
  Package,
  Building2,
  Activity,
  Globe,
  // V2.1 Placeholder icons
  ShoppingCart,
  Clipboard,
  AlertTriangle,
  BookOpen,
  PieChart,
  UtensilsCrossed,
  CalendarCheck,
  Bot,
  Wrench,
  ScanEye,
  Brain,
  FlaskConical,
  
  Boxes,
  Handshake,
  ShieldAlert,
  BrainCircuit,
} from "lucide-react";
import {
  SIGNATURE_STUDIO_ENABLED,
  SIDEBAR_V21_ENABLED,
  VISION_AI_BENCH_ENABLED,
} from "@/config/featureFlags";

import type { ModuleKey } from "@/hooks/usePermissions";

export type NavItemId = string;

export type NavPlacement = "sidebar" | "homeTile" | "bottomNav";

/**
 * Child type for tree structure items
 * - "tab": Internal tab within parent (same route, different view)
 */
export type NavChildType = "tab";

export interface NavItem {
  /** Stable unique identifier */
  id: NavItemId;
  /** Display label */
  label: string;
  /** Route path */
  route: string;
  /** Icon component */
  icon: LucideIcon;
  /** Module key for RBAC (null if adminOnly) */
  moduleKey: ModuleKey | null;
  /** If true, requires isAdmin (no moduleKey check) */
  adminOnly?: boolean;
  /** If true, requires feature flag (for prototypes) */
  featureFlag?: boolean;
  /** Which placements this item appears in */
  placements: NavPlacement[];
  /** Color class for mobile home tiles */
  tileColor?: string;
  /** Display order within each placement (lower = first) */
  order: number;
  /** Group for sidebar organization */
  group?: "main" | "rbac" | "settings" | "footer";
  /** Children sub-items (for tree structure in config screen) */
  children?: NavItem[];
  /** Child type (only for children items) */
  childType?: NavChildType;
  /** Stable tab key for children (used for filtering/mapping) */
  tabKey?: string;
  /** If true, item is hidden from all navigation (e.g., Coming Soon placeholder) */
  hidden?: boolean;
}

/**
 * CANONICAL NAVIGATION REGISTRY
 *
 * All navigation items defined in one place.
 * Desktop and Mobile consume this via buildNavFromPermissions.
 */
export const NAV_REGISTRY: NavItem[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN MODULES (sidebar + homeTile)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "dashboard",
    label: "Dashboard",
    route: "/dashboard",
    icon: LayoutDashboard,
    moduleKey: "dashboard",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    order: 1,
    group: "main",
  },
  {
    id: "organisation",
    label: "Organisation",
    route: "/organisation",
    icon: Building2,
    moduleKey: "etablissements",
    placements: ["sidebar"],
    tileColor: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    order: 2,
    group: "main",
  },
  {
    id: "global-dashboard",
    label: "Dashboard Organisation",
    route: "/global-dashboard",
    icon: Globe,
    moduleKey: null,
    adminOnly: true,
    placements: ["sidebar"],
    tileColor: "bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400",
    order: 3,
    group: "main",
  },
  {
    id: "planning",
    label: "Planning",
    route: "/planning",
    icon: Calendar,
    moduleKey: "planning",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-primary/10 text-primary",
    order: 20,
    group: "main",
    children: [
      {
        id: "planning.general",
        label: "Planning général",
        route: "/planning",
        icon: Calendar,
        moduleKey: "planning",
        placements: [],
        order: 1,
        childType: "tab",
        tabKey: "general",
      },
      {
        id: "planning.cuisine",
        label: "Cuisine",
        route: "/planning",
        icon: Calendar,
        moduleKey: "planning",
        placements: [],
        order: 2,
        childType: "tab",
        tabKey: "cuisine",
      },
      {
        id: "planning.salle",
        label: "Salle",
        route: "/planning",
        icon: Calendar,
        moduleKey: "planning",
        placements: [],
        order: 3,
        childType: "tab",
        tabKey: "salle",
      },
      {
        id: "planning.plonge",
        label: "Plonge",
        route: "/planning",
        icon: Calendar,
        moduleKey: "planning",
        placements: [],
        order: 4,
        childType: "tab",
        tabKey: "plonge",
      },
      {
        id: "planning.pizza",
        label: "Pizza",
        route: "/planning",
        icon: Calendar,
        moduleKey: "planning",
        placements: [],
        order: 5,
        childType: "tab",
        tabKey: "pizza",
      },
    ],
  },
  {
    id: "salaries",
    label: "Salariés",
    route: "/salaries",
    icon: Users,
    moduleKey: "salaries",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400",
    order: 30,
    group: "main",
    children: [
      {
        id: "salaries.actifs",
        label: "Actifs",
        route: "/salaries",
        icon: Users,
        moduleKey: "salaries",
        placements: [],
        order: 1,
        childType: "tab",
        tabKey: "actifs",
      },
      {
        id: "salaries.archives",
        label: "Archives",
        route: "/salaries",
        icon: Users,
        moduleKey: "salaries",
        placements: [],
        order: 2,
        childType: "tab",
        tabKey: "archives",
      },
    ],
  },
  {
    id: "badgeuse",
    label: "Badgeuse",
    route: "/badgeuse",
    icon: Fingerprint,
    moduleKey: "badgeuse",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    order: 40,
    group: "main",
  },
  {
    id: "caisse",
    label: "Caisse",
    route: "/caisse",
    icon: Receipt,
    moduleKey: "caisse",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
    order: 50,
    group: "main",
    children: [
      {
        id: "caisse.jour",
        label: "Caisse du jour",
        route: "/caisse",
        icon: Receipt,
        moduleKey: "caisse",
        placements: [],
        order: 1,
        childType: "tab",
        tabKey: "jour",
      },
      {
        id: "caisse.mois",
        label: "Vue mensuelle",
        route: "/caisse",
        icon: Receipt,
        moduleKey: "caisse",
        placements: [],
        order: 2,
        childType: "tab",
        tabKey: "mois",
      },
    ],
  },
  {
    id: "rapports",
    label: "Rapports",
    route: "/rapports",
    icon: BarChart3,
    moduleKey: "rapports",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    order: 60,
    group: "main",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RBAC MODULES (require specific permissions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "paie",
    label: "Paie",
    route: "/paie",
    icon: Wallet,
    moduleKey: "paie",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    order: 70,
    group: "rbac",
  },
  {
    id: "presence",
    label: "Présence",
    route: "/presence",
    icon: UserCheck,
    moduleKey: "presence",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    order: 80,
    group: "rbac",
    children: [
      {
        id: "presence.today",
        label: "Présence du jour",
        route: "/presence",
        icon: UserCheck,
        moduleKey: "presence",
        placements: [],
        order: 1,
        childType: "tab",
        tabKey: "today",
      },
      {
        id: "presence.extra",
        label: "Extra",
        route: "/presence",
        icon: Clock,
        moduleKey: "presence",
        placements: [],
        order: 2,
        childType: "tab",
        tabKey: "extra",
      },
      {
        id: "presence.retard",
        label: "Retard",
        route: "/presence",
        icon: Clock,
        moduleKey: "presence",
        placements: [],
        order: 3,
        childType: "tab",
        tabKey: "retard",
      },
      {
        id: "presence.absence",
        label: "Absence",
        route: "/presence",
        icon: UserCheck,
        moduleKey: "presence",
        placements: [],
        order: 4,
        childType: "tab",
        tabKey: "absence",
      },
    ],
  },
  {
    id: "gestion_personnel",
    label: "Gestion du personnel",
    route: "/gestion-personnel",
    icon: UserCog,
    moduleKey: "gestion_personnel",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400",
    order: 90,
    group: "rbac",
  },
  {
    id: "conges_absences",
    label: "Congés & Absences",
    route: "/conges-absences",
    icon: CalendarDays,
    moduleKey: "conges_absences",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400",
    order: 95,
    group: "rbac",
    children: [
      {
        id: "conges_absences.absences",
        label: "Absences",
        route: "/conges-absences",
        icon: CalendarDays,
        moduleKey: "conges_absences",
        placements: [],
        order: 1,
        childType: "tab",
        tabKey: "absences",
      },
      {
        id: "conges_absences.cp",
        label: "CP",
        route: "/conges-absences",
        icon: CalendarDays,
        moduleKey: "conges_absences",
        placements: [],
        order: 2,
        childType: "tab",
        tabKey: "cp",
      },
    ],
  },
  {
    id: "alertes",
    label: "Alertes",
    route: "/notifications",
    icon: Bell,
    moduleKey: "alertes",
    placements: ["sidebar", "homeTile"],
    tileColor: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    order: 100,
    group: "rbac",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTURES MODULE (SSOT for invoices - under "Achats & Stock")
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "factures",
    label: "Factures",
    route: "/factures",
    icon: FileText,
    moduleKey: "factures" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    order: 104,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FOURNISSEURS MODULE (SSOT for suppliers - under "Achats & Stock")
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "fournisseurs",
    label: "Fournisseurs",
    route: "/fournisseurs",
    icon: Building2,
    moduleKey: "fournisseurs" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
    order: 103,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENTS B2B MODULE (supplier-side view of B2B partnerships)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "clients_b2b",
    label: "Clients B2B",
    route: "/clients-b2b",
    icon: Handshake,
    moduleKey: "clients_b2b" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    order: 104,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLATS FOURNISSEURS (client-side: followed B2B recipes — isolated from products)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "plats_fournisseurs",
    label: "Plats fournisseurs",
    route: "/plats-fournisseurs",
    icon: UtensilsCrossed,
    moduleKey: "fournisseurs" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    order: 104.5,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUITS V1 MASQUÉ — V2 est le seul chemin (SSOT products_v2)
  // /produits route redirects to /produits-v2 in AppRoutes
  {
    id: "produits",
    label: "Produits (Legacy)",
    route: "/produits",
    icon: Package,
    moduleKey: "produits" as ModuleKey,
    placements: [] as NavPlacement[], // MASQUÉ — V1 supprimé
    hidden: true, // Dead route — redirects to /produits-v2
    tileColor: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
    order: 105,
    group: "rbac" as const,
  },
  // PRODUITS V2 = SSOT UNIQUE — seul chemin actif
  {
    id: "produits_v2",
    label: "Produits",
    route: "/produits-v2",
    icon: Package,
    moduleKey: "produits_v2" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
    order: 105, // Même ordre que l'ancien V1
    group: "rbac" as const,
  },


  // COMMANDES MODULE (isolé et activable par établissement)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "commandes",
    label: "Commandes",
    route: "/commandes",
    icon: Clipboard,
    moduleKey: "commandes" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400",
    order: 106,
    group: "rbac" as const,
  },
  {
    id: "dlc-critique",
    label: "DLC critique",
    route: "/dlc-critique",
    icon: ShieldAlert,
    moduleKey: "dlc_critique" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    order: 106.5,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ACHAT MODULE (Récap mensuel des achats - isolé et supprimable)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "achat",
    label: "Achats",
    route: "/achat",
    icon: ShoppingCart,
    moduleKey: "factures" as ModuleKey, // Utilise les mêmes permissions que factures
    placements: ["sidebar"] as NavPlacement[],
    tileColor: "bg-lime-100 text-lime-600 dark:bg-lime-900/30 dark:text-lime-400",
    order: 107,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCE > MARCHANDISE (isolé, supprimable, lecture seule SSOT)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "finance_marchandise",
    label: "Marchandise",
    route: "/finance/marchandise",
    icon: PieChart,
    moduleKey: "inventaire" as ModuleKey,
    placements: ["sidebar"] as NavPlacement[],
    tileColor: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    order: 106,
    group: "rbac" as const,
  },

  // CLIENTS MODULE — REMOVED (P0 audit V0: no backing module)

  // ═══════════════════════════════════════════════════════════════════════════
  // V2.1 PLACEHOLDER MODULES (conditional on SIDEBAR_V21_ENABLED)
  // ═══════════════════════════════════════════════════════════════════════════
  ...(SIDEBAR_V21_ENABLED
    ? [
        {
          id: "inventaire",
          label: "Inventaire",
          route: "/inventaire",
          icon: Clipboard,
          moduleKey: "inventaire" as ModuleKey,
          placements: ["sidebar", "homeTile"] as NavPlacement[],
          order: 109,
          group: "rbac" as const,
          children: [
            {
              id: "inventaire.produit",
              label: "Produit",
              route: "/inventaire",
              icon: Clipboard,
              moduleKey: "inventaire" as ModuleKey,
              placements: [] as NavPlacement[],
              order: 1,
              childType: "tab" as NavChildType,
              tabKey: "produit",
            },
            {
              id: "inventaire.reception",
              label: "Réceptions",
              route: "/inventaire",
              icon: Clipboard,
              moduleKey: "inventaire" as ModuleKey,
              placements: [] as NavPlacement[],
              order: 2,
              childType: "tab" as NavChildType,
              tabKey: "reception",
            },
            {
              id: "inventaire.retrait",
              label: "Retraits",
              route: "/inventaire",
              icon: Clipboard,
              moduleKey: "inventaire" as ModuleKey,
              placements: [] as NavPlacement[],
              order: 3,
              childType: "tab" as NavChildType,
              tabKey: "retrait",
            },
            {
              id: "inventaire.alertes",
              label: "Alertes",
              route: "/inventaire",
              icon: Clipboard,
              moduleKey: "inventaire" as ModuleKey,
              placements: [] as NavPlacement[],
              order: 4,
              childType: "tab" as NavChildType,
              tabKey: "alertes",
            },
          ],
        },
        // ⛔ DISABLED — Feature "Article Inventaire" neutralized (Phase B)
        // {
        //   id: "inventaire_articles",
        //   label: "Articles inventaire",
        //   route: "/inventaire/articles",
        //   icon: Boxes,
        //   moduleKey: "inventaire" as ModuleKey,
        //   placements: ["sidebar"] as NavPlacement[],
        //   order: 109.5,
        //   group: "rbac" as const,
        // },
        {
          id: "pertes",
          label: "Pertes & Casse",
          route: "/pertes",
          icon: AlertTriangle,
          moduleKey: "pertes" as ModuleKey,
          placements: ["sidebar"] as NavPlacement[],
          order: 110,
          group: "rbac" as const,
        },
        {
          id: "recettes",
          label: "Recettes",
          route: "/recettes",
          icon: BookOpen,
          moduleKey: "recettes" as ModuleKey,
          placements: ["sidebar", "homeTile"] as NavPlacement[],
          tileColor: "bg-lime-100 text-lime-600 dark:bg-lime-900/30 dark:text-lime-400",
          order: 111,
          group: "rbac" as const,
        },
        {
          id: "food_cost",
          label: "Food Cost",
          route: "/food-cost",
          icon: PieChart,
          moduleKey: "food_cost" as ModuleKey,
          placements: ["sidebar", "homeTile"] as NavPlacement[],
          tileColor: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
          order: 112,
          group: "rbac" as const,
        },
        {
          id: "plat_du_jour",
          label: "Plat du Jour",
          route: "/plat-du-jour",
          icon: UtensilsCrossed,
          moduleKey: "plat_du_jour" as ModuleKey,
          placements: ["sidebar"] as NavPlacement[],
          order: 113,
          group: "rbac" as const,
        },
        {
          id: "contexte",
          label: "Contexte & Événements",
          route: "/contexte",
          icon: CalendarCheck,
          moduleKey: "contexte" as ModuleKey,
          placements: ["sidebar"] as NavPlacement[],
          order: 114,
          group: "rbac" as const,
        },
        {
          id: "assistant",
          label: "Assistant IA",
          route: "/assistant",
          icon: Bot,
          moduleKey: "assistant" as ModuleKey,
          placements: ["sidebar"] as NavPlacement[],
          order: 115,
          group: "rbac" as const,
        },
        {
          id: "materiel",
          label: "Matériel",
          route: "/materiel",
          icon: Wrench,
          moduleKey: "materiel" as ModuleKey,
          placements: ["sidebar"] as NavPlacement[],
          order: 210,
          group: "settings" as const,
        },
      ]
    : []),

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS (sidebar + bottomNav)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "parametres",
    label: "Paramètres",
    route: "/parametres",
    icon: Settings,
    moduleKey: "parametres",
    placements: ["sidebar", "bottomNav"],
    order: 200,
    group: "settings",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOTTOM NAV ONLY (mobile-specific)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "home",
    label: "Accueil",
    route: "/",
    icon: Home,
    moduleKey: null, // No permission required - always visible
    placements: ["bottomNav"],
    order: 10,
  },
  {
    id: "notifications_nav",
    label: "Notifications",
    route: "/notifications",
    icon: Bell,
    moduleKey: null, // No permission required - always visible in nav
    placements: ["bottomNav"],
    order: 110,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN-ONLY (footer/bottomNav)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "administration",
    label: "Administration",
    route: "/admin",
    icon: Shield,
    moduleKey: null,
    adminOnly: true,
    placements: ["sidebar", "bottomNav"], // V2.1: sidebar section + mobile bottomNav
    order: 150,
    group: "settings",
  },
  {
    id: "activity-log",
    label: "Journal d'activité",
    route: "/activity-log",
    icon: Activity,
    moduleKey: null,
    adminOnly: true,
    placements: ["sidebar"],
    order: 153,
    group: "settings",
  },
  {
    id: "vision-ai",
    label: "Scan facture (IA)",
    route: "/vision-ai",
    icon: ScanEye,
    moduleKey: "vision_ai" as ModuleKey,
    placements: ["sidebar"],
    order: 101,
    group: "rbac",
  },
  {
    id: "the-brain",
    label: "THE BRAIN",
    route: "/pilotage/the-brain",
    icon: Brain,
    moduleKey: null,
    adminOnly: true,
    placements: ["sidebar"],
    order: 152,
    group: "settings",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VISION AI BENCH (admin-only, developer benchmark tool)
  // ═══════════════════════════════════════════════════════════════════════════
  ...(VISION_AI_BENCH_ENABLED
    ? [
        {
          id: "vision-ai-bench",
          label: "Vision AI Bench",
          route: "/vision-ai-bench",
          icon: FlaskConical,
          moduleKey: null,
          adminOnly: true,
          featureFlag: true,
          placements: ["sidebar"] as NavPlacement[],
          order: 154,
          group: "settings" as const,
        },
      ]
    : []),

  // ═══════════════════════════════════════════════════════════════════════════
  // MOBILE NAV CONFIG (admin-only, desktop sidebar + mobile home tile)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "mobile_nav_config",
    label: "Config. Mobile",
    route: "/mobile/admin/nav-config",
    icon: Settings,
    moduleKey: null,
    adminOnly: true,
    placements: ["sidebar", "homeTile"], // Desktop sidebar + mobile home tiles
    tileColor: "bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400",
    order: 998,
    group: "settings",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT IA — Module isolé (Phase 1)
  // Réutilise vision_ai pour l'accès RBAC (MVP)
  // Créer moduleKey dédié agent_ia en V2
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "agent-ia",
    label: "Agent IA",
    route: "/agent-ia",
    icon: BrainCircuit,
    moduleKey: "vision_ai" as ModuleKey,
    placements: ["sidebar", "homeTile"] as NavPlacement[],
    tileColor: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
    order: 116,
    group: "rbac" as const,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROTOTYPE / FEATURE FLAG (admin + flag)
  // ═══════════════════════════════════════════════════════════════════════════
  ...(SIGNATURE_STUDIO_ENABLED
    ? [
        {
          id: "studio-signature",
          label: "Studio Signature",
          route: "/studio-signature",
          icon: FileSignature,
          moduleKey: null,
          adminOnly: true,
          featureFlag: true,
          placements: ["sidebar", "homeTile"] as NavPlacement[],
          tileColor: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
          order: 999,
          group: "footer" as const,
        },
      ]
    : []),
];

/**
 * Helper to get items by placement
 */
export function getItemsByPlacement(placement: NavPlacement): NavItem[] {
  return NAV_REGISTRY.filter((item) => !item.hidden && item.placements.includes(placement)).sort(
    (a, b) => a.order - b.order
  );
}
