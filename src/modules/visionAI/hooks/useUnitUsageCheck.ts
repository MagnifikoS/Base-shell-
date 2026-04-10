/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GUARD: Check if a measurement unit is used across the system
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Checks usage in:
 * - products_v2.final_unit_id / supplier_billing_unit_id / stock_handling_unit_id / kitchen_unit_id
 * - inventory_lines.unit_id
 * - packaging_formats.unit_id
 * - unit_conversions.from_unit_id / to_unit_id
 * - products_v2.conditionnement_config (JSONB deep scan)
 *
 * Returns a structured report of all usages.
 */

import { supabase } from "@/integrations/supabase/client";

export interface UnitUsageReport {
  isUsed: boolean;
  totalReferences: number;
  details: {
    productsFinalUnit: number;
    productsBillingUnit: number;
    productsStockUnit: number;
    productsKitchenUnit: number;
    inventoryLines: number;
    packagingFormats: number;
    conversions: number;
    productsJsonb: number;
  };
  /** First 50 product names using this unit (FK or JSONB) */
  sampleProducts: string[];
  /** Whether inventory_lines reference this unit (blocks Option B) */
  hasInventoryHistory: boolean;
}

/**
 * Scan conditionnement_config JSONB for any *_unit_id matching unitId.
 * Returns product names that reference the unit inside their JSON config.
 */
async function findJsonbUsages(unitId: string): Promise<{ count: number; names: string[] }> {
  // Use textual search on the JSONB column — look for the UUID string
  const { data, error } = await supabase
    .from("products_v2")
    .select("nom_produit, conditionnement_config")
    .is("archived_at", null)
    .not("conditionnement_config", "is", null);

  if (error || !data) return { count: 0, names: [] };

  const matching: string[] = [];
  for (const p of data) {
    const json = JSON.stringify(p.conditionnement_config ?? "");
    if (json.includes(unitId)) {
      matching.push(p.nom_produit);
    }
  }
  return { count: matching.length, names: matching };
}

export async function checkUnitUsage(unitId: string): Promise<UnitUsageReport> {
  const [
    finalUnitRes,
    billingUnitRes,
    stockUnitRes,
    kitchenUnitRes,
    inventoryRes,
    packagingRes,
    conversionsRes,
    sampleRes,
    jsonbResult,
  ] = await Promise.all([
    supabase
      .from("products_v2")
      .select("id", { count: "exact", head: true })
      .eq("final_unit_id", unitId)
      .is("archived_at", null),
    supabase
      .from("products_v2")
      .select("id", { count: "exact", head: true })
      .eq("supplier_billing_unit_id", unitId)
      .is("archived_at", null),
    supabase
      .from("products_v2")
      .select("id", { count: "exact", head: true })
      .eq("stock_handling_unit_id", unitId)
      .is("archived_at", null),
    supabase
      .from("products_v2")
      .select("id", { count: "exact", head: true })
      .eq("kitchen_unit_id", unitId)
      .is("archived_at", null),
    supabase
      .from("inventory_lines")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unitId),
    supabase
      .from("packaging_formats")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unitId),
    supabase
      .from("unit_conversions")
      .select("id", { count: "exact", head: true })
      .or(`from_unit_id.eq.${unitId},to_unit_id.eq.${unitId}`),
    // Sample products for display (FK-based)
    supabase
      .from("products_v2")
      .select("nom_produit")
      .is("archived_at", null)
      .or(
        `final_unit_id.eq.${unitId},supplier_billing_unit_id.eq.${unitId},stock_handling_unit_id.eq.${unitId},kitchen_unit_id.eq.${unitId}`
      )
      .limit(50),
    // JSONB deep scan
    findJsonbUsages(unitId),
  ]);

  const details = {
    productsFinalUnit: finalUnitRes.count ?? 0,
    productsBillingUnit: billingUnitRes.count ?? 0,
    productsStockUnit: stockUnitRes.count ?? 0,
    productsKitchenUnit: kitchenUnitRes.count ?? 0,
    inventoryLines: inventoryRes.count ?? 0,
    packagingFormats: packagingRes.count ?? 0,
    conversions: conversionsRes.count ?? 0,
    productsJsonb: jsonbResult.count,
  };

  const totalReferences = Object.values(details).reduce((a, b) => a + b, 0);

  // Merge FK sample + JSONB sample, deduplicate, limit 50
  const fkNames = (sampleRes.data ?? []).map((p) => p.nom_produit);
  const allNames = [...new Set([...fkNames, ...jsonbResult.names])].slice(0, 50);

  return {
    isUsed: totalReferences > 0,
    totalReferences,
    details,
    sampleProducts: allNames,
    hasInventoryHistory: (inventoryRes.count ?? 0) > 0,
  };
}
