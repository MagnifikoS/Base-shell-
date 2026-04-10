/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Plugin: Supplier Matching (Phase 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Plugin isolé pour logger les décisions humaines sur le matching fournisseur.
 *
 * RÈGLES:
 * - Append-only (jamais update)
 * - Fire-and-forget (jamais await, jamais bloquant)
 * - NE PAS logger les auto-match 100% (pas d'action humaine)
 * - Logger UNIQUEMENT les actions humaines explicites
 *
 * SUPPRESSION:
 * - Supprimer ce fichier
 * - Retirer les imports dans SupplierMatchField.tsx et InvoiceHeader.tsx
 * - L'app fonctionne identique
 *
 * @see src/modules/theBrain/README.md
 */

import { brainSafeLog, upsertSupplierMatchingRule } from "../services/theBrainService";
import { BRAIN_SUBJECTS, BRAIN_ACTIONS, THE_BRAIN_DISABLED } from "../constants";
import { normalizeStrictForExactMatch } from "@/modules/fournisseurs";
import { supabase } from "@/integrations/supabase/client";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type SupplierMatchKind = "fuzzy" | "manual";

export interface SupplierConfirmParams {
  establishmentId: string;
  supplierId: string;
  extractedSupplierLabel: string;
  matchKind: SupplierMatchKind;
}

export interface SupplierCorrectParams {
  establishmentId: string;
  previousSupplierId: string;
  supplierId: string;
  extractedSupplierLabel: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS (internes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère le user_id de façon non-bloquante
 * Retourne null si non disponible (ne casse jamais)
 */
async function getUserIdSafe(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalise le label fournisseur (réutilise le normalizer existant)
 */
function normalizeLabel(label: string): string {
  if (!label) return "";
  return normalizeStrictForExactMatch(label);
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log une confirmation de fournisseur (action humaine)
 *
 * Appelé quand l'utilisateur :
 * - Sélectionne un fournisseur dans la dropdown
 * - Clique "Utiliser best match"
 * - Crée un nouveau fournisseur (après succès)
 *
 * ⚠️ NE PAS appeler pour les auto-match 100%
 */
export function logSupplierConfirmed(params: SupplierConfirmParams): void {
  // Fire-and-forget : on récupère le userId puis on log + upsert rule
  getUserIdSafe().then((userId) => {
    // Log brain_events (append-only ledger)
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.SUPPLIER_MATCHING,
      action: BRAIN_ACTIONS.CONFIRMED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId,
        extracted_supplier_label: params.extractedSupplierLabel,
        extracted_supplier_label_normalized: normalizeLabel(params.extractedSupplierLabel),
        match_kind: params.matchKind,
        source: "vision_ai",
      },
    });

    // Upsert brain_rules (agrégation)
    if (!THE_BRAIN_DISABLED && params.extractedSupplierLabel) {
      upsertSupplierMatchingRule({
        establishmentId: params.establishmentId,
        extractedLabel: params.extractedSupplierLabel,
        supplierId: params.supplierId,
        action: "confirmed",
      });
    }
  });
}

/**
 * Log une correction de fournisseur (changement après validation)
 *
 * Appelé quand l'utilisateur change un fournisseur déjà validé.
 *
 * @param params.previousSupplierId - L'ancien fournisseur (avant correction)
 * @param params.supplierId - Le nouveau fournisseur choisi
 */
export function logSupplierCorrected(params: SupplierCorrectParams): void {
  // Fire-and-forget
  getUserIdSafe().then((userId) => {
    // Log brain_events (append-only ledger)
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.SUPPLIER_MATCHING,
      action: BRAIN_ACTIONS.CORRECTED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId,
        previous_supplier_id: params.previousSupplierId,
        extracted_supplier_label: params.extractedSupplierLabel,
        extracted_supplier_label_normalized: normalizeLabel(params.extractedSupplierLabel),
        match_kind: "manual" as SupplierMatchKind,
        source: "vision_ai",
      },
    });

    // Upsert brain_rules (agrégation - correction)
    if (!THE_BRAIN_DISABLED && params.extractedSupplierLabel) {
      upsertSupplierMatchingRule({
        establishmentId: params.establishmentId,
        extractedLabel: params.extractedSupplierLabel,
        supplierId: params.supplierId,
        action: "corrected",
      });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HEADER SUPPLIER PICKER (bouton 🔍)
// ═══════════════════════════════════════════════════════════════════════════

export interface SupplierPickerConfirmParams {
  establishmentId: string;
  supplierId: string;
  supplierName: string;
  extractedSupplierLabel: string;
}

/**
 * Log une sélection fournisseur via le bouton "🔍" dans l'entête Vision AI
 *
 * Appelé uniquement quand l'utilisateur clique explicitement sur le picker
 * et sélectionne un fournisseur existant.
 *
 * @param params - Les infos du fournisseur sélectionné
 */
export function logSupplierConfirmedHeaderPicker(params: SupplierPickerConfirmParams): void {
  // Fire-and-forget
  getUserIdSafe().then((userId) => {
    // Log brain_events (append-only ledger)
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.SUPPLIER_MATCHING,
      action: BRAIN_ACTIONS.CONFIRMED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId,
        selected_supplier_name: params.supplierName,
        extracted_supplier_label: params.extractedSupplierLabel,
        extracted_supplier_label_normalized: normalizeLabel(params.extractedSupplierLabel),
        source: "header_supplier_picker_button",
        reason: "manual_override_supplier",
      },
    });

    // Upsert brain_rules (agrégation)
    if (!THE_BRAIN_DISABLED && params.extractedSupplierLabel) {
      upsertSupplierMatchingRule({
        establishmentId: params.establishmentId,
        extractedLabel: params.extractedSupplierLabel,
        supplierId: params.supplierId,
        action: "confirmed",
      });
    }
  });
}
