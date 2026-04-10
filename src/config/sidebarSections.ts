/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SIDEBAR SECTIONS CONFIG — V2.1 Section-Based Navigation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file defines the sidebar sections for V2.1 layout.
 * Each section maps to existing navRegistry items by their IDs.
 *
 * RULES:
 * - itemIds must match exactly the `id` field in navRegistry.ts
 * - No moduleKey renaming — pure visual reorganization
 * - Sections with no visible items (after RBAC filtering) are hidden
 * - adminOnly sections require isAdmin=true
 *
 * ROLLBACK:
 * - Set SIDEBAR_V21_ENABLED=false in featureFlags.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { LucideIcon } from "lucide-react";
import {
  Users,
  Wallet,
  Package,
  UtensilsCrossed,
  BarChart3,
  Settings,
  ShieldCheck,
} from "lucide-react";

export interface SidebarSection {
  /** Unique section identifier */
  id: string;
  /** Display label for the section header */
  label: string;
  /** Icon for the section header */
  icon: LucideIcon;
  /** IDs of navRegistry items to include in this section */
  itemIds: string[];
  /** If true, section is only visible to admins */
  adminOnly?: boolean;
  /** Display order (lower = first) */
  order: number;
}

/**
 * TOP SIDEBAR ITEMS — rendered as standalone items ABOVE collapsible sections.
 * These IDs map to navRegistry items displayed at the very top of the sidebar,
 * outside any section. Filtered by RBAC like all other items.
 */
export const TOP_SIDEBAR_ITEM_IDS: string[] = [
  "dashboard", // Establishment Dashboard (all users with dashboard permission)
  "organisation", // Organisation Dashboard (etablissements permission)
  "global-dashboard", // Global Dashboard (admin-only)
];

/**
 * SIDEBAR SECTIONS REGISTRY
 *
 * Maps sections to existing navRegistry item IDs.
 * Items not in any section (and not in TOP_SIDEBAR_ITEM_IDS) will not appear in V2.1 sidebar.
 */
export const SIDEBAR_SECTIONS: SidebarSection[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // RH — Ressources Humaines
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "rh",
    label: "RH",
    icon: Users,
    order: 10,
    itemIds: [
      "planning", // Planning (existant)
      "salaries", // Salariés (existant)
      "badgeuse", // Badgeuse (existant)
      "presence", // Présence (existant)
      "paie", // Paie (existant)
      "gestion_personnel", // Gestion du personnel (existant)
      "conges_absences", // Congés & Absences (existant)
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "finance",
    label: "Finance",
    icon: Wallet,
    order: 20,
    itemIds: [
      "caisse",             // Caisse (existant)
      "pertes",             // Pertes & Casse
      "rapports",           // Rapports (existant)
      "finance_marchandise", // Marchandise — consommation inter-inventaires (V1 isolé)
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STOCK & ACHATS — Référentiel → Opérations → Finance Marchandises
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "achats",
    label: "Stock & Achats",
    icon: Package,
    order: 30,
    itemIds: [
      // 🔹 Référentiel (on définit ce qu'on achète et à qui)
      "produits_v2",        // Produits (SSOT unique)
      
      "fournisseurs",       // Fournisseurs
      "plats_fournisseurs", // Plats fournisseurs (B2B recipes followed)
      "clients_b2b",        // Clients B2B (fournisseur-only)
      
      "---",                // ── séparateur ──
      // 🔹 Flux Opérationnel (on fait circuler la marchandise)
      "commandes",          // Commandes fournisseurs
      "dlc-critique",       // DLC critique (surveillance péremptions)
      "inventaire",         // Inventaire
      "---",                // ── séparateur ──
      // 🔹 Finance Marchandise (impact financier des flux)
      "achat",              // Achats (vue synthèse fournisseurs / mois)
      "factures",           // Factures (gestion documentaire)
      "vision-ai",          // Scan facture (IA) — outil d'entrée factures
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VENTE & MENU
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "vente",
    label: "Vente & Menu",
    icon: UtensilsCrossed,
    order: 40,
    itemIds: [
      "recettes", // Recettes (placeholder)
      "food_cost", // Food Cost (placeholder)
      "plat_du_jour", // Plat du jour (placeholder)
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PILOTAGE INTELLIGENT
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "pilotage",
    label: "Pilotage",
    icon: BarChart3,
    order: 50,
    itemIds: [
      "alertes", // Alertes (existant)
      "vision-ai-bench", // Vision AI Bench (benchmark tool)
      "the-brain", // THE BRAIN (Phase 1)
      "contexte", // Contexte & Événements (placeholder)
      "assistant", // Assistant IA (placeholder)
      "agent-ia", // Agent IA (Phase 1 — extraction produits)
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PARAMÈTRES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "parametres",
    label: "Paramètres",
    icon: Settings,
    order: 60,
    itemIds: [
      "parametres", // Paramètres (existant)
      "mobile_nav_config", // Config Mobile (existant, admin)
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMINISTRATION (admin-only)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "admin",
    label: "Administration",
    icon: ShieldCheck,
    order: 100,
    adminOnly: true,
    itemIds: [
      "administration", // Admin (existant)
      "studio-signature", // Studio Signature (existant, feature flag)
    ],
  },
];

/**
 * Get all item IDs that are assigned to sections or top items.
 * Useful to detect orphan items in navRegistry.
 */
export function getAllSectionItemIds(): string[] {
  return [...TOP_SIDEBAR_ITEM_IDS, ...SIDEBAR_SECTIONS.flatMap((s) => s.itemIds)];
}
