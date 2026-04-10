/**
 * ═══════════════════════════════════════════════════════════════════════════
 * usePermissions — RBAC V2-ONLY (Phase 2 / Étape 28+)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * INVARIANTS (ne jamais modifier sans validation complète):
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Query key V2 INCHANGÉE: ["my-permissions-v2", userId, establishmentId]
 *   2. Aucune query V1 (get_my_permissions) — supprimée en Étape 28
 *   3. Aucun log legacy (CANARY, SHADOW DIFF, STATUS) — nettoyé en Étape 28
 *   4. Aucun changement métier via ce fichier — RBAC géré par DB/RPC
 *   5. Rules of Hooks respectées — tous les hooks avant les early returns
 *
 * ARCHITECTURE:
 * ─────────────────────────────────────────────────────────────────────────────
 *   - V2 activée par défaut pour tous les utilisateurs (non-bloqués)
 *   - Blocklist rollback via featureFlags.ts → BLOCKED_USERS
 *   - Fallback automatique vers DEFAULT_PERMS si:
 *       • establishmentId null
 *       • User bloqué par blocklist
 *       • Shape V2 invalide
 *       • Erreur RPC
 *   - Admin détecté depuis la réponse V2 (isAdmin=true dans RPC)
 *   - Aucun appel RPC is_admin frontend (principe rbac-zero-hardcode)
 *
 * OBSERVABILITÉ (DEV-only):
 * ─────────────────────────────────────────────────────────────────────────────
 *   - 1 seul log: [PERMISSIONS V2 DEFAULT HEALTH]
 *   - Anti-spam: 1x par session (module-level guard)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissionsV2Enabled } from "@/config/featureFlags";
import { usePermissionsShadowV2 } from "@/hooks/usePermissionsShadowV2";
import type { Database } from "@/integrations/supabase/types";

type AccessLevel = Database["public"]["Enums"]["access_level"];
type PermissionScope = Database["public"]["Enums"]["permission_scope"];

// Module keys matching DB modules table
export type ModuleKey =
  | "dashboard"
  | "planning"
  | "salaries"
  | "badgeuse"
  | "presence"
  | "caisse"
  | "rapports"
  | "parametres"
  | "users"
  | "roles_permissions"
  | "teams"
  | "etablissements"
  | "invitations"
  | "gestion_personnel"
  | "alertes"
  | "notif_commande"
  | "paie"
  | "conges_absences"
  | "factures"
  | "fournisseurs"
  | "produits"
  | "produits_v2"
  // V2.1 Placeholder modules
  | "inventaire"
  | "pertes"
  | "recettes"
  | "food_cost"
  | "plat_du_jour"
  | "contexte"
  | "assistant"
  | "materiel"
  | "stock_ledger"
  | "bl_app"
  | "stock_alerts"
  | "mise_en_place"
  | "clients_b2b"
  | "commandes"
  | "vision_ai"
  | "dlc_critique";

export interface PermissionsData {
  isAdmin: boolean;
  accessByModule: Record<ModuleKey, AccessLevel>;
  scopeByModule: Record<ModuleKey, PermissionScope>;
  teamIds: string[];
  establishmentIds: string[];
}

const ACCESS_ORDER: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  full: 3,
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT PERMISSIONS — Fallback when V2 is blocked or user not authenticated
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PERMS: PermissionsData = {
  isAdmin: false,
  accessByModule: {} as Record<ModuleKey, AccessLevel>,
  scopeByModule: {} as Record<ModuleKey, PermissionScope>,
  teamIds: [],
  establishmentIds: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// V2 SHAPE VALIDATOR — Phase 2 / Étape 6
// ═══════════════════════════════════════════════════════════════════════════
const VALID_ACCESS_LEVELS = new Set(["none", "read", "write", "full"]);
const VALID_SCOPES = new Set([
  "self",
  "team",
  "establishment",
  "org",
  "caisse_day",
  "caisse_month",
]);

interface V2ValidationResult {
  valid: boolean;
  reason?: string;
}

function validatePermissionsV2Shape(data: unknown): V2ValidationResult {
  if (data == null || typeof data !== "object") {
    return { valid: false, reason: "data is null or not an object" };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.isAdmin !== "boolean") {
    return { valid: false, reason: "isAdmin is not a boolean" };
  }

  if (!Array.isArray(obj.permissions)) {
    return { valid: false, reason: "permissions is not an array" };
  }

  for (let i = 0; i < obj.permissions.length; i++) {
    const perm = obj.permissions[i];
    if (perm == null || typeof perm !== "object") {
      return { valid: false, reason: `permissions[${i}] is not an object` };
    }

    const p = perm as Record<string, unknown>;

    if (typeof p.module_key !== "string" || p.module_key.length === 0) {
      return { valid: false, reason: `permissions[${i}].module_key is invalid` };
    }

    if (typeof p.access_level !== "string" || !VALID_ACCESS_LEVELS.has(p.access_level)) {
      return {
        valid: false,
        reason: `permissions[${i}].access_level is invalid: ${p.access_level}`,
      };
    }

    if (typeof p.scope !== "string" || !VALID_SCOPES.has(p.scope)) {
      return { valid: false, reason: `permissions[${i}].scope is invalid: ${p.scope}` };
    }
  }

  if (!Array.isArray(obj.teamIds)) {
    return { valid: false, reason: "teamIds is not an array" };
  }

  if (!Array.isArray(obj.establishmentIds)) {
    return { valid: false, reason: "establishmentIds is not an array" };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEV-ONLY — Anti-Spam Guard (Module-Level)
// ═══════════════════════════════════════════════════════════════════════════
let v2HealthLogged = false;

/**
 * usePermissions — V2-ONLY (Phase 2 / Étape 28)
 *
 * This hook provides user permissions using ONLY the V2 RPC (get_my_permissions_v2).
 *
 * BEHAVIOR:
 * - Admin users: Detected from V2 response (isAdmin=true).
 * - Non-admin + establishmentId: Fetch V2, use if valid, fallback to DEFAULT_PERMS if blocked.
 * - Non-admin + no establishmentId: Return DEFAULT_PERMS, NO network call.
 *
 * QUERY KEY: ["my-permissions-v2", userId, establishmentId]
 *
 * FALLBACK: If V2 is blocked/invalid/error, returns DEFAULT_PERMS (local, no V1 RPC).
 */
export function usePermissions() {
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();

  const userId = user?.id ?? null;
  const establishmentId = activeEstablishment?.id ?? null;

  // ═══════════════════════════════════════════════════════════════════════════
  // V2 GATING — Phase 2 / Étape 28
  // ═══════════════════════════════════════════════════════════════════════════
  const v2GloballyEnabled = usePermissionsV2Enabled(userId);

  // shadowEnabled: Enable V2 query for non-blocked users with valid establishmentId
  // Admin detection happens AFTER V2 loads (from V2 response).
  const shadowEnabled = v2GloballyEnabled && !!userId && !!establishmentId;

  // V2 Query via shadow hook — ONLY network call for permissions
  const {
    data: dataV2,
    isLoading: v2QueryLoading,
    error: errorV2,
  } = usePermissionsShadowV2({
    enabled: shadowEnabled,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING STATE FIX — Phase 2 / Étape 29
  // ═══════════════════════════════════════════════════════════════════════════
  // isLoading should be true when:
  // 1. V2 query is actively loading (v2QueryLoading)
  // 2. V2 query is not enabled YET because establishmentId is null
  //    (user is authenticated but establishment context not ready)
  //
  // This prevents PermissionGuard from showing "Access Denied" prematurely
  // when the permissions haven't been fetched yet.
  // ═══════════════════════════════════════════════════════════════════════════
  const isLoading = v2QueryLoading || (!!userId && !establishmentId && v2GloballyEnabled);

  // ═══════════════════════════════════════════════════════════════════════════
  // EARLY RETURN: No user → stable defaults (after all hooks)
  // ═══════════════════════════════════════════════════════════════════════════
  if (!user) {
    return {
      isAdmin: false,
      accessByModule: DEFAULT_PERMS.accessByModule,
      scopeByModule: DEFAULT_PERMS.scopeByModule,
      teamIds: [] as string[],
      establishmentIds: [] as string[],
      isLoading: false,
      isFetching: false,
      error: null,
      can: (_moduleKey: ModuleKey, _minLevel: AccessLevel = "read"): boolean => false,
      getScope: (_moduleKey: ModuleKey): PermissionScope => "self",
      hasAnyAccess: (): boolean => false,
      data: undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // V2 BLOCKING LOGIC — Phase 2 / Étape 28
  // ═══════════════════════════════════════════════════════════════════════════
  const v2BlockedReasons: string[] = [];

  // Condition 1: establishmentId null (no V2 call possible)
  if (!establishmentId) {
    v2BlockedReasons.push("establishmentId is null");
  }

  // Condition 2: User blocked by blocklist
  if (!v2GloballyEnabled) {
    v2BlockedReasons.push("user blocked by blocklist");
  }

  // Condition 3: shape validation (only if we have data)
  let v2ShapeValid = false;
  if (dataV2 != null) {
    const validation = validatePermissionsV2Shape(dataV2);
    v2ShapeValid = validation.valid;
    if (!validation.valid) {
      v2BlockedReasons.push(`shape invalid: ${validation.reason}`);
    }
  }

  // Condition 4: error
  if (errorV2) {
    v2BlockedReasons.push(`error: ${String(errorV2)}`);
  }

  const v2Blocked = v2BlockedReasons.length > 0;

  // v2IsReady: all conditions must pass AND not blocked AND data loaded
  const v2IsReady = shadowEnabled && !v2Blocked && !isLoading && dataV2 != null && v2ShapeValid;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERT V2 DATA TO PermissionsData FORMAT
  // ═══════════════════════════════════════════════════════════════════════════
  let permissionsFromV2: PermissionsData | null = null;
  if (v2IsReady && dataV2) {
    const accessByModule: Record<ModuleKey, AccessLevel> = {} as Record<ModuleKey, AccessLevel>;
    const scopeByModule: Record<ModuleKey, PermissionScope> = {} as Record<
      ModuleKey,
      PermissionScope
    >;

    for (const perm of dataV2.permissions) {
      if (perm.module_key) {
        accessByModule[perm.module_key as ModuleKey] = perm.access_level;
        scopeByModule[perm.module_key as ModuleKey] = perm.scope;
      }
    }

    permissionsFromV2 = {
      isAdmin: dataV2.isAdmin,
      accessByModule,
      scopeByModule,
      teamIds: dataV2.teamIds,
      establishmentIds: dataV2.establishmentIds,
    };
  }

  // V2 actually used
  const v2ActuallyUsed = v2IsReady && permissionsFromV2 != null;

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SOURCE SELECTION — V2-ONLY with LOCAL fallback
  // ═══════════════════════════════════════════════════════════════════════════
  const permissions = v2ActuallyUsed ? permissionsFromV2! : DEFAULT_PERMS;

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMORY ARCHITECTURE — DEV-ONLY Health Log (Phase 2 / Étape 28+)
  // ═══════════════════════════════════════════════════════════════════════════
  // Ce log unique trace l'état du système permissions en DEV:
  //   - source=V2: permissions chargées depuis get_my_permissions_v2
  //   - source=FALLBACK_LOCAL: fallback vers DEFAULT_PERMS (0 network)
  //   - blocked=true + reasons: cause du fallback (establishmentId null, blocklist, etc.)
  //
  // Rollback:
  //   - Ajouter UUID dans BLOCKED_USERS (featureFlags.ts) → force fallback local
  //   - Aucun autre changement code nécessaire
  // ═══════════════════════════════════════════════════════════════════════════
  if (import.meta.env.DEV && user && !v2HealthLogged) {
    v2HealthLogged = true;

    const source = v2ActuallyUsed ? "V2" : "FALLBACK_LOCAL";

    // eslint-disable-next-line no-console
    console.debug(
      `[PERMISSIONS V2 DEFAULT HEALTH]
      user=${userId ?? "null"}
      admin=${permissions.isAdmin}
      v2GloballyEnabled=${v2GloballyEnabled}
      shadowEnabled=${shadowEnabled}
      est=${establishmentId ?? "null"}
      source=${source}
      blocked=${v2Blocked}
      reasons=${v2BlockedReasons.length > 0 ? v2BlockedReasons.join("; ") : "none"}`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if user can access a module with at least minLevel.
   * Returns false if module not present in permissions (safe default).
   */
  const can = (moduleKey: ModuleKey, minLevel: AccessLevel = "read"): boolean => {
    if (permissions.isAdmin) return true;
    const userLevel = permissions.accessByModule[moduleKey];
    if (!userLevel) return false;
    return ACCESS_ORDER[userLevel] >= ACCESS_ORDER[minLevel];
  };

  /**
   * Get scope for a module.
   * Returns "self" if module not present (safe default).
   */
  const getScope = (moduleKey: ModuleKey): PermissionScope => {
    if (permissions.isAdmin) return "org";
    return permissions.scopeByModule[moduleKey] ?? "self";
  };

  /**
   * Check if user has access to at least one module.
   */
  const hasAnyAccess = (): boolean => {
    if (permissions.isAdmin) return true;
    return Object.values(permissions.accessByModule).some((level) => level !== "none");
  };

  return {
    isAdmin: permissions.isAdmin,
    accessByModule: permissions.accessByModule,
    scopeByModule: permissions.scopeByModule,
    teamIds: permissions.teamIds,
    establishmentIds: permissions.establishmentIds,
    isLoading,
    isFetching: isLoading,
    error: errorV2,
    can,
    getScope,
    hasAnyAccess,
    data: permissionsFromV2,
  };
}
