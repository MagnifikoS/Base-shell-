/**
 * Route prefetch map — maps sidebar routes to lazy-import loaders.
 *
 * Separated from routePrefetch.ts to break circular dependencies:
 *   layout -> routePrefetch -> pages -> layout
 *
 * This file contains the dynamic imports that reference page components.
 * It is imported ONLY from the app initialization path (main.tsx or App.tsx),
 * never from layout components.
 */

import { registerPrefetchRoutes } from "./routePrefetch";

export function initRoutePrefetch(): void {
  registerPrefetchRoutes({
    "/dashboard": () => import("@/pages/Dashboard"),
    "/planning": () => import("@/pages/Planning"),
    "/salaries": () => import("@/pages/Salaries"),
    "/badgeuse": () => import("@/pages/Badgeuse"),
    "/caisse": () => import("@/pages/Caisse"),
    "/rapports": () => import("@/pages/Rapports"),
    "/presence": () => import("@/pages/Presence"),
    "/paie": () => import("@/pages/Payroll"),
    "/parametres": () => import("@/pages/Parametres"),
    "/admin": () => import("@/pages/Admin"),
    "/vision-ai": () => import("@/pages/VisionAI"),
    "/gestion-personnel": () => import("@/pages/GestionPersonnel"),
    "/fournisseurs": () => import("@/pages/Fournisseurs"),
    "/factures": () => import("@/modules/factures/pages/FacturesPage"),
    "/produits-v2": () => import("@/modules/produitsV2/pages/ProduitsV2ListPage"),
    "/inventaire": () => import("@/modules/inventaire/pages/InventairePage"),
    "/notifications": () => import("@/pages/Notifications"),
    "/conges-absences": () => import("@/modules/congesAbsences/CongesAbsencesPage"),
  });
}
