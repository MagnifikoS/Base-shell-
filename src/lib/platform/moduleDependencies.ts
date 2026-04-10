/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE DEPENDENCIES — SSOT for module dependency graph
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Defines which modules depend on which "root" modules.
 * Used by the Platform Modules UI to:
 * - Grey out modules whose dependencies are OFF
 * - Block disabling root modules when dependents are ON
 * - Show visual warnings
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Map of module_key → required dependencies (module_keys that MUST be enabled)
 * Only modules WITH dependencies are listed.
 * Modules absent from this map have NO dependencies (leaf modules).
 */
export const MODULE_DEPENDENCIES: Record<string, string[]> = {
  
  inventaire: ["produits_v2"],
  factures: ["fournisseurs"],
  bl_app: ["produits_v2", "fournisseurs"],
  food_cost: ["factures", "produits_v2", "recettes"],
  recettes: ["produits_v2"],
  pertes: ["produits_v2"],
  presence: ["badgeuse", "planning"],
  paie: ["salaries", "presence"],
  stock_ledger: ["produits_v2"],
  stock_alerts: ["produits_v2"],
  vision_ai: ["factures", "fournisseurs"],
  dlc_critique: ["produits_v2"],
  commandes: ["produits_v2", "fournisseurs"],
  clients_b2b: ["produits_v2"],
};

/**
 * Root modules: modules that other modules depend on.
 * These get a "Module socle" badge and confirmation before disabling.
 */
export const ROOT_MODULES = new Set<string>([
  "produits_v2",
  "fournisseurs",
  "badgeuse",
  "planning",
  "presence",
  "salaries",
]);

/**
 * Get which enabled modules depend on the given module.
 * Used to show blocking modal when trying to disable a root module.
 */
export function getDependents(
  moduleKey: string,
  enabledModules: Set<string>
): string[] {
  const dependents: string[] = [];
  for (const [mod, deps] of Object.entries(MODULE_DEPENDENCIES)) {
    if (deps.includes(moduleKey) && enabledModules.has(mod)) {
      dependents.push(mod);
    }
  }
  return dependents;
}

/**
 * Get missing dependencies for a module given current enabled set.
 */
export function getMissingDependencies(
  moduleKey: string,
  enabledModules: Set<string>
): string[] {
  const deps = MODULE_DEPENDENCIES[moduleKey];
  if (!deps) return [];
  return deps.filter((d) => !enabledModules.has(d));
}

/**
 * Check if a module can be enabled (all dependencies are ON).
 */
export function canEnableModule(
  moduleKey: string,
  enabledModules: Set<string>
): boolean {
  return getMissingDependencies(moduleKey, enabledModules).length === 0;
}

/**
 * Check if a module can be disabled (no enabled dependents).
 */
export function canDisableModule(
  moduleKey: string,
  enabledModules: Set<string>
): boolean {
  return getDependents(moduleKey, enabledModules).length === 0;
}
