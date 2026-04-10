/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BUNDLES — SSOT for super-module definitions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A bundle is a named group of module_keys that can be toggled as one unit.
 * Used by the Platform UI to offer "one-click" domain activation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ModuleBundle {
  /** Unique identifier for the bundle */
  id: string;
  /** Display name in the Platform UI */
  label: string;
  /** Short description */
  description: string;
  /** Emoji / icon hint */
  icon: string;
  /** Module keys that belong to this bundle */
  moduleKeys: string[];
}

/**
 * Stock & Achat — Full supply-chain domain bundle.
 *
 * Covers: product catalog, suppliers, B2B clients, orders,
 * delivery notes, inventory, purchases, invoicing, AI scan,
 * DLC alerts, stock ledger, stock alerts, losses, order notifications.
 */
export const STOCK_ACHAT_BUNDLE: ModuleBundle = {
  id: "stock_achat",
  label: "Stock & Achat",
  description:
    "Produits, fournisseurs, commandes, inventaire, factures, stock, DLC, scan IA — tout le domaine achat & stock.",
  icon: "📦",
  moduleKeys: [
    // Root / socle
    "produits_v2",
    "fournisseurs",
    // Visible domain modules
    "clients_b2b",
    "commandes",
    "inventaire",
    "factures",
    "bl_app",
    "pertes",
    "notif_commande",
    // Invisible but essential
    "stock_ledger",
    "stock_alerts",
    "vision_ai",
    "dlc_critique",
  ],
};

/** All available bundles — extend this array when adding new super-modules */
export const MODULE_BUNDLES: ModuleBundle[] = [STOCK_ACHAT_BUNDLE];

/**
 * Returns all bundle IDs that fully match the given enabled set.
 */
export function getActiveBundles(enabledModules: Set<string>): string[] {
  return MODULE_BUNDLES.filter((b) =>
    b.moduleKeys.every((k) => enabledModules.has(k))
  ).map((b) => b.id);
}

/**
 * Returns the set of module_keys that belong to any bundle containing the given key.
 */
export function getBundleKeysFor(moduleKey: string): string[] | null {
  const bundle = MODULE_BUNDLES.find((b) => b.moduleKeys.includes(moduleKey));
  return bundle ? bundle.moduleKeys : null;
}
