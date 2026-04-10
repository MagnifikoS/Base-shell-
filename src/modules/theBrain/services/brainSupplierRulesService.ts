/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Supplier Matching Rules Service
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from theBrainService.ts for file size compliance.
 * Handles: upsertSupplierMatchingRule, getBestSupplierRuleSuggestion
 */

import { THE_BRAIN_DISABLED } from "../constants";
import { brainDb } from "./brainDb";
import type {
  UpsertSupplierRuleParams,
  BrainSupplierSuggestion,
  GetSupplierSuggestionParams,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalise un label fournisseur pour créer une context_key stable
 *
 * Format: lowercase + no accents + collapse spaces + underscore
 * SSOT: Ce label normalisé est la clé unique (pas de supplier_id pour généralisation)
 */
function normalizeSupplierLabel(label: string | null | undefined): string {
  if (!label) return "";
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9\s]/g, "") // keep only alphanumeric + spaces
    .trim()
    .replace(/\s+/g, "_"); // collapse spaces to underscore
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert une règle dans brain_rules pour supplier_matching
 *
 * - confirmed -> increment confirmations_count
 * - corrected -> increment corrections_count + update supplier_id
 *
 * context_key = normalized extracted label (sans supplier_id pour généralisation)
 * value = { supplier_id: string }
 *
 * Fire-and-forget, silencieux
 */
export async function upsertSupplierMatchingRule(params: UpsertSupplierRuleParams): Promise<void> {
  if (THE_BRAIN_DISABLED) return;

  const contextKey = normalizeSupplierLabel(params.extractedLabel);

  // Pas de clé valide = skip
  if (!contextKey) return;

  try {
    // Vérifier si une règle existe déjà
    const { data: existing, error: fetchError } = await brainDb
      .from("brain_rules")
      .select("id, confirmations_count, corrections_count")
      .eq("establishment_id", params.establishmentId)
      .eq("subject", "supplier_matching")
      .eq("context_key", contextKey)
      .maybeSingle();

    if (fetchError) {
      if (import.meta.env.DEV)
        console.error("[THE BRAIN] upsertSupplierMatchingRule fetch error:", fetchError);
      return;
    }

    const now = new Date().toISOString();

    if (existing) {
      // UPDATE existant
      const updates: Record<string, unknown> = {
        updated_at: now,
        last_used_at: now,
        value: { supplier_id: params.supplierId },
      };

      if (params.action === "confirmed") {
        updates.confirmations_count = existing.confirmations_count + 1;
      } else if (params.action === "corrected") {
        updates.corrections_count = existing.corrections_count + 1;
      }

      await brainDb.from("brain_rules").update(updates).eq("id", existing.id);
    } else {
      // INSERT nouvelle règle
      await brainDb.from("brain_rules").insert([
        {
          establishment_id: params.establishmentId,
          subject: "supplier_matching",
          context_key: contextKey,
          value: { supplier_id: params.supplierId },
          confirmations_count: params.action === "confirmed" ? 1 : 0,
          corrections_count: params.action === "corrected" ? 1 : 0,
          enabled: true,
          last_used_at: now,
        },
      ]);
    }
  } catch (err) {
    if (import.meta.env.DEV)
      console.error("[THE BRAIN] upsertSupplierMatchingRule exception:", err);
    // Silencieux - ne jamais throw
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère une suggestion fournisseur basée sur le label extrait
 *
 * Seuils (alignés avec product matching):
 * - Retourne uniquement si confirmations >= 2 ET corrections === 0
 * - Ne jamais auto-valider, juste suggérer
 *
 * @returns suggestion ou null si aucune règle fiable
 */
export async function getBestSupplierRuleSuggestion(
  params: GetSupplierSuggestionParams
): Promise<BrainSupplierSuggestion | null> {
  if (THE_BRAIN_DISABLED) return null;

  const contextKey = normalizeSupplierLabel(params.extractedLabel);

  if (!contextKey) return null;

  try {
    const { data, error } = await brainDb
      .from("brain_rules")
      .select("value, confirmations_count, corrections_count, enabled")
      .eq("establishment_id", params.establishmentId)
      .eq("subject", "supplier_matching")
      .eq("context_key", contextKey)
      .eq("enabled", true)
      .maybeSingle();

    if (error || !data) return null;

    const confirmations = data.confirmations_count ?? 0;
    const corrections = data.corrections_count ?? 0;

    // Seuil minimal : au moins 2 confirmations et 0 correction
    // Aligned with getBestProductRuleSuggestion threshold
    if (confirmations < 2 || corrections > 0) return null;

    const supplierId = data.value?.supplier_id;
    if (typeof supplierId !== "string") return null;

    return {
      supplierId,
      confirmationsCount: confirmations,
      correctionsCount: corrections,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] getBestSupplierRuleSuggestion error:", err);
    return null;
  }
}
