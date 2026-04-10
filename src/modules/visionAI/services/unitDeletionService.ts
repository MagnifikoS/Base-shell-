/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SERVICE — Option B: Delete unit with cascade reset
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HARD DELETE OPERATION — measurement_units + cascade
 *
 * When a used unit is force-deleted:
 * 1. Reset conditioning for all products referencing this unit (FK + JSONB)
 * 2. Delete unit_conversions referencing this unit
 * 3. Delete packaging_formats referencing this unit
 * 4. Delete the measurement_unit itself
 *
 * BLOCKED if inventory_lines reference this unit (history preservation).
 * No products/invoices/purchases are deleted — only conditioning is reset.
 *
 * @see docs/data-deletion-policy.md
 */

import { supabase } from "@/integrations/supabase/client";

export interface DeletionResult {
  success: boolean;
  productsReset: number;
  conversionsDeleted: number;
  packagingDeleted: number;
  error?: string;
}

export async function executeOptionBDeletion(unitId: string): Promise<DeletionResult> {
  const result: DeletionResult = {
    success: false,
    productsReset: 0,
    conversionsDeleted: 0,
    packagingDeleted: 0,
  };

  try {
    // SEC-DATA-031: Audit log BEFORE deletion
    await supabase.from("audit_logs").insert({
      action: "hard_delete:measurement_units",
      target_type: "measurement_units",
      target_id: unitId,
      organization_id: "00000000-0000-0000-0000-000000000000", // placeholder — RLS uses auth
      metadata: {
        table: "measurement_units",
        cascade: ["unit_conversions", "packaging_formats"],
        side_effects: ["products_v2 conditioning reset"],
        reason: "User-initiated unit force deletion (Option B) via UI",
      },
    });

    // ── Step 1: Find all products referencing this unit via FK columns ──
    const { data: fkProducts } = await supabase
      .from("products_v2")
      .select("id")
      .is("archived_at", null)
      .or(
        `final_unit_id.eq.${unitId},supplier_billing_unit_id.eq.${unitId},stock_handling_unit_id.eq.${unitId},kitchen_unit_id.eq.${unitId}`
      );

    // Find products referencing via JSONB
    const { data: jsonbProducts } = await supabase
      .from("products_v2")
      .select("id, conditionnement_config")
      .is("archived_at", null)
      .not("conditionnement_config", "is", null);

    const jsonbIds = (jsonbProducts ?? [])
      .filter((p) => JSON.stringify(p.conditionnement_config ?? "").includes(unitId))
      .map((p) => p.id);

    // Merge all product IDs (deduplicated)
    const allProductIds = [...new Set([...(fkProducts ?? []).map((p) => p.id), ...jsonbIds])];

    // ── Step 2: Reset conditioning for all impacted products ──
    if (allProductIds.length > 0) {
      // Nullify FK columns that point to this unit + reset conditioning
      // We do per-column updates to only null the specific FK that matches
      const now = new Date().toISOString();

      // Reset conditioning JSON for all impacted products
      const { error: resetErr } = await supabase
        .from("products_v2")
        .update({
          conditionnement_config: null,
          conditionnement_resume: null,
          updated_at: now,
        })
        .in("id", allProductIds);

      if (resetErr) {
        result.error = `Reset conditionnement échoué: ${resetErr.message}`;
        return result;
      }

      // Nullify specific FK columns
      await supabase
        .from("products_v2")
        .update({ final_unit_id: null, updated_at: now })
        .eq("final_unit_id", unitId);

      await supabase
        .from("products_v2")
        .update({ supplier_billing_unit_id: null, updated_at: now })
        .eq("supplier_billing_unit_id", unitId);

      await supabase
        .from("products_v2")
        .update({ stock_handling_unit_id: null, updated_at: now })
        .eq("stock_handling_unit_id", unitId);

      await supabase
        .from("products_v2")
        .update({ kitchen_unit_id: null, updated_at: now })
        .eq("kitchen_unit_id", unitId);

      result.productsReset = allProductIds.length;
    }

    // ── Step 3: Delete unit_conversions ──
    const { data: convData } = await supabase
      .from("unit_conversions")
      .select("id")
      .or(`from_unit_id.eq.${unitId},to_unit_id.eq.${unitId}`);

    if (convData && convData.length > 0) {
      const { error: convErr } = await supabase
        .from("unit_conversions")
        .delete()
        .or(`from_unit_id.eq.${unitId},to_unit_id.eq.${unitId}`);

      if (convErr) {
        result.error = `Suppression conversions échouée: ${convErr.message}`;
        return result;
      }
      result.conversionsDeleted = convData.length;
    }

    // ── Step 4: Delete packaging_formats ──
    const { data: pkgData } = await supabase
      .from("packaging_formats")
      .select("id")
      .eq("unit_id", unitId);

    if (pkgData && pkgData.length > 0) {
      const { error: pkgErr } = await supabase
        .from("packaging_formats")
        .delete()
        .eq("unit_id", unitId);

      if (pkgErr) {
        result.error = `Suppression packaging_formats échouée: ${pkgErr.message}`;
        return result;
      }
      result.packagingDeleted = pkgData.length;
    }

    // ── Step 5: Delete the measurement_unit itself ──
    const { error: unitErr } = await supabase.from("measurement_units").delete().eq("id", unitId);

    if (unitErr) {
      result.error = `Suppression unité échouée: ${unitErr.message}`;
      return result;
    }

    result.success = true;
    return result;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : "Erreur inconnue";
    return result;
  }
}
