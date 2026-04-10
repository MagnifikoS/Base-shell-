/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — Store (Learning / Apprentissage)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Writes:
 * - supplier_product_aliases (upsert by normalized_key)
 * - brain_rules (via existing theBrain service)
 *
 * NEVER writes to products_v2.
 * Fire-and-forget, silent on failure.
 */

import { supabase } from "@/integrations/supabase/client";
import { upsertProductMatchingRule } from "@/modules/theBrain";
import type { SmartMatchLearnParams } from "../types";
import { buildNormalizedKey } from "../engine/normalize";

/**
 * Learn from a human-confirmed match.
 * Called AFTER the consumer module has persisted the match to its own SSOT.
 *
 * 1. Upsert alias in supplier_product_aliases (global_product_id)
 * 2. Reinforce brain_rules via THE BRAIN
 */
export async function smartMatchLearn(params: SmartMatchLearnParams): Promise<void> {
  const normalizedKey = buildNormalizedKey(params.raw_label);
  if (!normalizedKey) return;

  // Fire both in parallel, both are fire-and-forget
  await Promise.allSettled([
    upsertAlias(params, normalizedKey),
    upsertProductMatchingRule({
      establishmentId: params.establishment_id,
      supplierId: params.supplier_id,
      label: params.raw_label,
      productId: params.confirmed_product_id,
      action: params.action,
    }),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// ALIAS UPSERT
// ═══════════════════════════════════════════════════════════════════════════

async function upsertAlias(
  params: SmartMatchLearnParams,
  normalizedKey: string
): Promise<void> {
  try {
    const now = new Date().toISOString();

    // Check if alias exists
    const { data: existing } = await supabase
      .from("supplier_product_aliases")
      .select("id, global_product_id")
      .eq("establishment_id", params.establishment_id)
      .eq("supplier_id", params.supplier_id)
      .eq("normalized_key", normalizedKey)
      .maybeSingle();

    if (existing) {
      // Update existing alias
      await supabase
        .from("supplier_product_aliases")
        .update({
          global_product_id: params.confirmed_product_id,
          raw_label_sample: params.raw_label,
          supplier_product_code: params.code_produit ?? null,
          last_seen_at: now,
          updated_at: now,
          confidence_source: "human_validation",
        })
        .eq("id", existing.id);
    } else {
      // Insert new alias
      await supabase
        .from("supplier_product_aliases")
        .insert({
          establishment_id: params.establishment_id,
          supplier_id: params.supplier_id,
          product_id: params.confirmed_product_id, // legacy FK (supplier_extracted_products)
          global_product_id: params.confirmed_product_id, // SSOT FK (products_v2)
          normalized_key: normalizedKey,
          raw_label_sample: params.raw_label,
          supplier_product_code: params.code_produit ?? null,
          last_seen_at: now,
          confidence_source: "human_validation",
        });
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SmartMatch] upsertAlias error:", err);
    // Silent — never throw
  }
}
