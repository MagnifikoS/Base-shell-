/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FEATURE FLAGS — Single Source of Truth
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All feature flags MUST be defined here and nowhere else.
 * To enable/disable a feature, change the value here only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE MEMORY: "Ligne Droite" Phase 2 — Étape 25
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CONTEXT:
 *   - Phase 2 migrates RBAC from organization-scoped to establishment-scoped.
 *   - V1 RPC: get_my_permissions() — returns global permissions (legacy).
 *   - V2 RPC: get_my_permissions_v2(_establishment_id) — returns per-establishment.
 *   - Both RPCs apply the same "is_admin → full/org" override in the DB.
 *
 * V2 DEFAULT STRATEGY (Étape 25):
 *   - V2 is now ENABLED BY DEFAULT for all non-admin users.
 *   - Admins still skip V2 (shadowEnabled=false in usePermissions).
 *   - BLOCKED_USERS blocklist allows instant rollback per user.
 *   - If V2 differs from V1 → automatic fallback to V1 (v2Blocked).
 *
 * ROLLBACK:
 *   - To disable V2 for one user: add their UUID to BLOCKED_USERS.
 *   - To disable V2 for everyone: set global flag or add all UUIDs.
 *   - No other code changes needed.
 *
 * OBSERVABILITY:
 *   - usePermissions.ts logs status (used/blocked/skipped) in DEV.
 *   - Console prefix: [PERMISSIONS V2 ...]
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKED_USERS — Rollback instantané par UUID (Étape 25)
// ═══════════════════════════════════════════════════════════════════════════
//
// HOW IT WORKS:
//   - Users in this Set → V2 DISABLED, forced V1, zero V2 network calls.
//   - Users NOT in this Set → V2 ENABLED by default (if non-admin).
//   - Admins are always skipped (shadowEnabled=false in usePermissions).
//
// ROLLBACK:
//   - To force V1 for a user: add their UUID to this Set.
//   - To restore V2 for a user: remove their UUID from this Set.
//
// SAFETY:
//   - V1 remains the fallback even for non-blocked users.
//   - If V2 differs from V1 → automatic fallback to V1 (v2Blocked).
//
// ═══════════════════════════════════════════════════════════════════════════
const BLOCKED_USERS = new Set<string>([
  // ─────────────────────────────────────────────────────────────────────────
  // Rollback instantané: ajouter ici les UUIDs à forcer sur V1
  // ─────────────────────────────────────────────────────────────────────────
  // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", // Example: user to force V1
]);

/**
 * RBAC V2 — Per-Establishment Permissions (Default ON + Blocklist)
 *
 * Phase 2 / Étape 25: V2 enabled by default for all non-admin users.
 *
 * - Returns true by DEFAULT for all authenticated users.
 * - Returns false if userId is in BLOCKED_USERS (instant rollback).
 * - Returns false if userId is null (not authenticated).
 * - No admin logic here (handled in usePermissions.ts).
 *
 * @param userId - The authenticated user's UUID (or null if not authenticated)
 * @returns true if V2 is enabled for this user, false otherwise
 */
export function usePermissionsV2Enabled(userId: string | null): boolean {
  // DEV-ONLY rollback drill (no prod impact)
  // IMPORTANT: must NOT be persistent across sessions (localStorage caused accidental lockouts).
  // We only support a session-scoped flag now.
  if (import.meta.env.DEV) {
    try {
      if (typeof window !== "undefined") {
        // Cleanup legacy persistent flag if it exists
        if (window.localStorage?.getItem("V2_BLOCKLIST_TEST") === "1") {
          window.localStorage?.removeItem("V2_BLOCKLIST_TEST");
        }

        // Session-only flag
        if (window.sessionStorage?.getItem("V2_BLOCKLIST_TEST") === "1") {
          return false;
        }
      }
    } catch {
      /* sessionStorage may not be available */
    }
  }

  if (!userId) return false;

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMORY ARCHITECTURE — Phase 2 (RBAC par établissement) / Admin override
  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy behavior (TEMPORARY):
  //   - For admin users, permissions are treated as FULL access with ORG scope.
  //   - This exists ONLY to match historical V1 behavior during the V2 rollout.
  //
  // Current state:
  //   - get_my_permissions_v2() applies the admin override on the DB side
  //     so V2 matches V1 without frontend hardcodes.
  //   - This is NOT the target RBAC model.
  //
  // Principle (rbac-zero-hardcode-principle):
  //   - Authorization must not depend on is_admin() / isAdmin long-term.
  //   - Admin should be expressible as regular roles/permissions.
  //
  // Future plan (Phase 3+):
  //   1) Remove admin override (DB + any remaining legacy paths)
  //   2) Model admin capabilities purely via RBAC (roles + permissions)
  //   3) Keep blocklist rollback mechanics unchanged
  //
  // Rollback:
  //   - No runtime impact: this block is documentation only.
  // ═══════════════════════════════════════════════════════════════════════════

  // V2 enabled by default, blocked only if in blocklist
  return !BLOCKED_USERS.has(userId);
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY CANARY WHITELIST — Phase 2 / Étapes 7-24 (DEPRECATED)
// ═══════════════════════════════════════════════════════════════════════════
// Kept for historical reference. No longer used after Étape 25.
//
// const ALLOWED_USERS_LEGACY = new Set<string>([
//   "ba3782e6-790c-44ed-9eb9-780979ff90df", // canary #1 — test-phase2-etape7@example.com
//   "f282532c-8465-47cd-a202-ed9327b87f19", // canary #2 — AGAMEZ Meisen
//   "adcb121a-1dca-479d-b67f-fbcb49555ef2", // canary #3 — Atik Aymane
//   "e2aa00d8-8a78-49f3-a714-3b49ae35a351", // canary #4 — Gassab Naim
// ]);
// ═══════════════════════════════════════════════════════════════════════════

// USE_PERMISSIONS_V2 removed (PH3-Short) — was deprecated, 0 runtime consumers.
// SSOT: usePermissionsV2Enabled(userId) in this file.

// ═══════════════════════════════════════════════════════════════════════════
// SIDEBAR V2.1 — Sections collapsibles (Phase V2.1)
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   - Sidebar organisée en sections (RH, Finance, Achats, etc.)
//   - Un seul groupe ouvert à la fois
//   - Modules existants déplacés visuellement (aucun renommage)
//   - Nouveaux modules en placeholders "Coming soon"
//
// ROLLBACK:
//   - OFF → sidebar actuelle inchangée
//   - ON → sidebar sections (V2.1)
//
// ═══════════════════════════════════════════════════════════════════════════
export const SIDEBAR_V21_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════
// MODULE FEATURE FLAGS — Enable/disable entire modules
// ═══════════════════════════════════════════════════════════════════════════
//
// Each flag controls visibility of an entire module (routes, nav, sidebar).
// Set to false to completely hide the module from the app.
//
// ═══════════════════════════════════════════════════════════════════════════

/** Cash register module (Caisse) */
export const CASH_ENABLED = true;

/** Conges & Absences (leave management) module */
export const CONGES_ABSENCES_ENABLED = true;

/** Signature Studio prototype module */
export const SIGNATURE_STUDIO_ENABLED = true;

/** Vision AI guardrails — post-AI micro-sanitization (module-internal toggle) */
export const VISION_AI_GUARDRAILS_ENABLED = true;

/** Vision AI Bench — developer tool for comparing extraction models (admin-only) */
export const VISION_AI_BENCH_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════
// MODULE PAYLEDGER — Phase 1 Beta (paiements fournisseurs)
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   Nouveau module paiements (pay_* tables). Statut calculé, EURO ONLY.
//   En Phase 1 : onglet "Paiements (β)" dans FacturesPage.
//   SSOT = pay_* — invoices reste "document PDF", is_paid ignoré.
//
// ROLLBACK:
//   false → onglet Paiements masqué, module inactif (tables restent en DB)
//   true  → onglet visible (Beta)
//
// ═══════════════════════════════════════════════════════════════════════════
export const PAY_LEDGER_BETA_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════
// SMART_MATCH — Module isolé de matching intelligent produits
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   Module centralisé de matching produits (alias + fuzzy + brain boost).
//   Remplace les moteurs de matching dispersés par un contrat unique.
//   Désactivable sans impact sur les modules consommateurs.
//
// ROLLBACK:
//   false → SmartMatch désactivé, modules consommateurs utilisent leur logique existante
//   true  → SmartMatch activé
//
// ═══════════════════════════════════════════════════════════════════════════
export const SMART_MATCH_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════
// SMART_MATCH AI RERANK — Phase 2 (optionnel)
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   Re-ranking IA des candidats fuzzy (edge function smart-match-rerank).
//   Phase 2 uniquement — Phase 1 fonctionne sans IA.
//
// ═══════════════════════════════════════════════════════════════════════════
export const SMART_MATCH_AI_RERANK = false;

// ═══════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Module isolé PWA push notifications
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   Notifications push web (PWA) sur mobile/desktop.
//   Module 100% isolé : src/modules/pushNotif/
//   Suppression : rm -rf src/modules/pushNotif + public/sw-push.js
//                 + edge function push-send + table push_subscriptions
//
// ROLLBACK:
//   false → aucun SW enregistré, aucune requête push, UI affiche "désactivé"
//   true  → activation possible par l'utilisateur dans Settings
//
// ═══════════════════════════════════════════════════════════════════════════
export const PUSH_NOTIF_ENABLED = true;

// Debug mode: show "Test notification" button even in production
export const PUSH_NOTIF_DEBUG = false;

// ═══════════════════════════════════════════════════════════════════════════
// NOTIF ENGINE SAFE MODE — Limits notification side-effects
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   When true, notification engine corrections are active (dedupe, guards,
//   anti-spam, cron security). When false, reverts to legacy behavior.
//
// ROLLBACK:
//   false → all notif corrections disabled, original behavior restored
//   true  → corrected behavior (default)
//
// ═══════════════════════════════════════════════════════════════════════════
export const NOTIF_ENGINE_SAFE_MODE = true;

// ═══════════════════════════════════════════════════════════════════════════
// NOTIF ENGINE DEBUG — Enables verbose logging + admin test button
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   When true, shows "Run notif-check now" button in admin settings,
//   bypasses no_subscription cooldown, enables structured debug logs.
//   Set NOTIF_ENGINE_DEBUG=true in edge function env vars too.
//
// ROLLBACK:
//   false → debug features hidden (default)
//   true  → debug features visible (admin only)
//
// ═══════════════════════════════════════════════════════════════════════════
export const NOTIF_ENGINE_DEBUG = false;

// ═══════════════════════════════════════════════════════════════════════════
// USE_PRODUCT_PIPELINE — PR-8: Pipeline centralisé pour création produit
// ═══════════════════════════════════════════════════════════════════════════
//
// Quand activé (true), le wizard V3 utilise createProductPipeline
// au lieu du bloc inline pour la création de produits.
// Les deux chemins coexistent. Aucun changement si false.
//
// ROLLBACK: false → ancien chemin inline (défaut)
//           true  → pipeline centralisé
// ═══════════════════════════════════════════════════════════════════════════
export const USE_PRODUCT_PIPELINE = false;

// ═══════════════════════════════════════════════════════════════════════════
// USE_ATOMIC_RPC — PR-14: RPC atomique fn_create_product_complete
// ═══════════════════════════════════════════════════════════════════════════
//
// DESCRIPTION:
//   Quand activé (true), createProductPipeline utilise la RPC atomique
//   fn_create_product_complete (1 transaction = products_v2 + product_input_config).
//   Élimine le P0 d'atomicité identifié dans les audits.
//
// PRÉREQUIS:
//   La migration fn_create_product_complete doit être déployée.
//
// ROLLBACK:
//   false → étapes 5 + 7 séparées (chemin actuel, défaut)
//   true  → RPC atomique unique
//
// ═══════════════════════════════════════════════════════════════════════════
export const USE_ATOMIC_RPC = false;

