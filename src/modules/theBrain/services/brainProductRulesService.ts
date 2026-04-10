/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Product Matching Rules Service
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from theBrainService.ts for file size compliance.
 * Handles: upsertProductMatchingRule, getBestProductRuleSuggestion, getProductMatchingRules
 */

import { supabase } from "@/integrations/supabase/client";
import { THE_BRAIN_DISABLED } from "../constants";
import { brainDb } from "./brainDb";
import type { ProductMatchingRuleDisplay, RuleConfidenceStatus } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalise un label pour créer une clé stable
 */
function normalizeLabel(label: string | null | undefined): string {
  if (!label) return "";
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Génère une context_key unique pour product_matching
 * Format: supplier_id|category|label_normalized
 */
function buildProductMatchingContextKey(params: {
  supplierId?: string | null;
  category?: string | null;
  label?: string | null;
}): string {
  const supplier = params.supplierId ?? "unknown";
  const category = normalizeLabel(params.category) || "unknown";
  const label = normalizeLabel(params.label);

  if (!label) return "";

  return `${supplier}|${category}|${label}`;
}

/**
 * Calcule le statut de confiance basé sur les counts (UI-only)
 */
function computeConfidenceStatus(confirmations: number, corrections: number): RuleConfidenceStatus {
  if (confirmations >= 3 && corrections === 0) return "stable";
  if (confirmations >= 2 && corrections <= 1) return "probable";
  return "weak";
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface UpsertProductRuleParams {
  establishmentId: string;
  supplierId?: string | null;
  category?: string | null;
  label: string; // nom_produit extrait
  productId: string;
  action: "confirmed" | "corrected" | "created";
}

export interface BrainProductSuggestion {
  productId: string;
  confirmationsCount: number;
  correctionsCount: number;
  confidence: "stable" | "probable" | "weak";
}

export interface GetProductSuggestionParams {
  establishmentId: string;
  supplierId?: string | null;
  category?: string | null;
  label: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert une règle dans brain_rules pour product_matching
 * - confirmed/created -> increment confirmations_count
 * - corrected -> increment corrections_count
 *
 * Fire-and-forget, silencieux
 */
export async function upsertProductMatchingRule(params: UpsertProductRuleParams): Promise<void> {
  if (THE_BRAIN_DISABLED) return;

  const contextKey = buildProductMatchingContextKey({
    supplierId: params.supplierId,
    category: params.category,
    label: params.label,
  });

  // Pas de clé valide = skip
  if (!contextKey) return;

  try {
    // Vérifier si une règle existe déjà
    const { data: existing, error: fetchError } = await brainDb
      .from("brain_rules")
      .select("id, confirmations_count, corrections_count, value")
      .eq("establishment_id", params.establishmentId)
      .eq("subject", "product_matching")
      .eq("context_key", contextKey)
      .maybeSingle();

    if (fetchError) {
      if (import.meta.env.DEV)
        console.error("[THE BRAIN] upsertProductMatchingRule fetch error:", fetchError);
      return;
    }

    const now = new Date().toISOString();

    if (existing) {
      // UPDATE existant
      const updates: Record<string, unknown> = {
        updated_at: now,
        last_used_at: now,
        value: { product_id: params.productId },
      };

      if (params.action === "confirmed" || params.action === "created") {
        updates.confirmations_count = existing.confirmations_count + 1;
      } else if (params.action === "corrected") {
        updates.corrections_count = existing.corrections_count + 1;
        // Aussi mettre à jour le product_id vers le nouveau
      }

      await brainDb.from("brain_rules").update(updates).eq("id", existing.id);
    } else {
      // INSERT nouvelle règle
      await brainDb.from("brain_rules").insert([
        {
          establishment_id: params.establishmentId,
          subject: "product_matching",
          context_key: contextKey,
          value: { product_id: params.productId },
          confirmations_count: params.action === "confirmed" || params.action === "created" ? 1 : 0,
          corrections_count: params.action === "corrected" ? 1 : 0,
          enabled: true,
          last_used_at: now,
        },
      ]);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] upsertProductMatchingRule exception:", err);
    // Silencieux - ne jamais throw
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper interne: récupère et évalue une règle par context_key
 */
async function fetchRuleByContextKey(
  establishmentId: string,
  contextKey: string
): Promise<BrainProductSuggestion | null> {
  try {
    const { data, error } = await brainDb
      .from("brain_rules")
      .select("value, confirmations_count, corrections_count, enabled")
      .eq("establishment_id", establishmentId)
      .eq("subject", "product_matching")
      .eq("context_key", contextKey)
      .eq("enabled", true)
      .maybeSingle();

    if (error || !data) return null;

    const confirmations = data.confirmations_count ?? 0;
    const corrections = data.corrections_count ?? 0;

    // Seuil minimal : au moins 2 confirmations et 0 correction
    if (confirmations < 2 || corrections > 0) return null;

    // Calculer la confiance
    let confidence: "stable" | "probable" | "weak" = "weak";
    if (confirmations >= 3 && corrections === 0) {
      confidence = "stable";
    } else if (confirmations >= 2 && corrections <= 1) {
      confidence = "probable";
    }

    const productId = data.value?.product_id;
    if (typeof productId !== "string") return null;

    return {
      productId,
      confirmationsCount: confirmations,
      correctionsCount: corrections,
      confidence,
    };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] fetchRuleByContextKey error:", err);
    return null;
  }
}

/**
 * Récupère la meilleure suggestion pour un produit basée sur les règles apprises
 *
 * Seuils:
 * - Retourne uniquement si confirmations >= 2 ET corrections = 0
 * - Ne jamais auto-valider, juste suggérer
 *
 * @returns suggestion ou null si aucune règle fiable
 */
export async function getBestProductRuleSuggestion(
  params: GetProductSuggestionParams
): Promise<BrainProductSuggestion | null> {
  if (THE_BRAIN_DISABLED) return null;

  // Essai 1: context_key avec supplierId réel (priorité)
  const contextKeyReal = buildProductMatchingContextKey({
    supplierId: params.supplierId,
    category: params.category,
    label: params.label,
  });

  if (!contextKeyReal) return null;

  const result = await fetchRuleByContextKey(params.establishmentId, contextKeyReal);
  if (result) return result;

  // Essai 2 (fallback): si supplierId était fourni, essayer avec "unknown"
  if (params.supplierId && params.supplierId !== "unknown") {
    const contextKeyFallback = buildProductMatchingContextKey({
      supplierId: "unknown",
      category: params.category,
      label: params.label,
    });

    if (contextKeyFallback && contextKeyFallback !== contextKeyReal) {
      return fetchRuleByContextKey(params.establishmentId, contextKeyFallback);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// READ-ONLY — Product matching rules display
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère toutes les règles product_matching avec le nom produit
 *
 * LECTURE SEULE — Aucune écriture
 *
 * Filtrage obligatoire:
 * - Exclure supplier_id = "unknown" (clé trop large)
 * - Exclure produits archivés (archived_at IS NOT NULL)
 * - Exclure règles sans product_id valide
 */
export async function getProductMatchingRules(
  establishmentId: string
): Promise<ProductMatchingRuleDisplay[]> {
  if (THE_BRAIN_DISABLED) return [];

  try {
    // Récupérer les règles
    const { data: rules, error: rulesError } = await brainDb
      .from("brain_rules")
      .select("id, context_key, value, confirmations_count, corrections_count, last_used_at")
      .eq("establishment_id", establishmentId)
      .eq("subject", "product_matching")
      .order("confirmations_count", { ascending: false });

    if (rulesError || !rules) {
      if (import.meta.env.DEV)
        console.error("[THE BRAIN] getProductMatchingRules error:", rulesError);
      return [];
    }

    // Inclure TOUTES les règles (avec et sans supplier), marquer isLegacy
    // brainDb returns BrainRuleRow[] which already has these fields typed
    const validRules = rules.filter((rule) => {
      // Exclure si pas de product_id
      const productId = rule.value?.product_id;
      if (!productId || typeof productId !== "string") return false;
      return true;
    });

    if (validRules.length === 0) return [];

    // Récupérer les noms de produits (batch)
    const productIds = validRules.map((r) => r.value.product_id as string);

    const { data: products, error: productsError } = await supabase
      .from("products_v2")
      .select("id, nom_produit, archived_at")
      .in("id", productIds);

    if (productsError) {
      if (import.meta.env.DEV)
        console.error("[THE BRAIN] getProductMatchingRules products error:", productsError);
      return [];
    }

    // Map produits par ID (exclure archivés)
    const productMap = new Map<string, string>();
    for (const p of products ?? []) {
      if (p.archived_at === null) {
        productMap.set(p.id, p.nom_produit);
      }
    }

    // Construire le résultat final avec flag isLegacy
    const result: ProductMatchingRuleDisplay[] = [];
    for (const rule of validRules) {
      const productId = rule.value.product_id as string;
      const productName = productMap.get(productId);

      // Exclure si produit archivé ou inexistant
      if (!productName) continue;

      // Déterminer si la règle est legacy (supplier_id = "unknown")
      const supplierId = rule.context_key.split("|")[0];
      const isLegacy = supplierId === "unknown";

      result.push({
        id: rule.id,
        productId,
        productName,
        contextKey: rule.context_key,
        confirmationsCount: rule.confirmations_count,
        correctionsCount: rule.corrections_count,
        lastUsedAt: rule.last_used_at,
        status: computeConfidenceStatus(rule.confirmations_count, rule.corrections_count),
        isLegacy,
      });
    }

    return result;
  } catch (err) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] getProductMatchingRules exception:", err);
    return [];
  }
}
