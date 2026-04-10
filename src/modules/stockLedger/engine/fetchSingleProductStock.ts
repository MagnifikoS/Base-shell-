/**
 * ═══════════════════════════════════════════════════════════════════════════
 * fetchSingleProductStock — Thin adapter over StockEngine for single product
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS IS NOT A SECOND SOURCE OF TRUTH:
 * This function does ZERO stock calculation. It only:
 *   1. Loads the required data from Supabase (product zone, snapshot, inv line, events)
 *   2. Builds a UnitFamilyResolver from pre-loaded units
 *   3. Delegates 100% of the calculation to getEstimatedStock()
 *
 * The formula lives exclusively in stockEngine.ts.
 * This is a data-loading adapter, not a calculation engine.
 *
 * USED BY: useProductCurrentStock, useProductHasStock (after migration)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { getEstimatedStock, type UnitFamilyResolver, type SnapshotLine } from "./stockEngine";
import type { EstimatedStockOutcome } from "../types";

interface DbUnit {
  id: string;
  name: string;
  abbreviation: string | null;
  family: string | null;
}

/**
 * Fetch all data needed for a single product and delegate to StockEngine.
 *
 * @param establishmentId - UUID of the establishment
 * @param productId - UUID of the product
 * @param dbUnits - Pre-loaded measurement_units (from useUnits hook)
 * @returns EstimatedStockOutcome — the exact same type returned by getEstimatedStock
 */
export async function fetchSingleProductStock(
  establishmentId: string,
  productId: string,
  dbUnits: ReadonlyArray<DbUnit>
): Promise<EstimatedStockOutcome> {
  // 1. Get product's storage zone
  const { data: product } = await supabase
    .from("products_v2")
    .select("storage_zone_id")
    .eq("id", productId)
    .single();

  if (!product?.storage_zone_id) {
    return {
      ok: false,
      error: {
        code: "NO_ACTIVE_SNAPSHOT",
        message: "Produit sans zone de stockage.",
        product_id: productId,
        storage_zone_id: "",
      },
    };
  }

  const zoneId = product.storage_zone_id;

  // 2. Get active snapshot for this zone
  const { data: snapshot } = await supabase
    .from("zone_stock_snapshots")
    .select("snapshot_version_id")
    .eq("establishment_id", establishmentId)
    .eq("storage_zone_id", zoneId)
    .maybeSingle();

  if (!snapshot) {
    return {
      ok: false,
      error: {
        code: "NO_ACTIVE_SNAPSHOT",
        message: "Aucun inventaire de référence pour cette zone.",
        product_id: productId,
        storage_zone_id: zoneId,
      },
    };
  }

  const snapshotVersionId = snapshot.snapshot_version_id;

  // 3. Load snapshot line + stock events in parallel
  const [invLineResult, eventsResult] = await Promise.all([
    supabase
      .from("inventory_lines")
      .select("product_id, quantity, unit_id")
      .eq("session_id", snapshotVersionId)
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from("stock_events")
      .select("delta_quantity_canonical, canonical_unit_id, canonical_family")
      .eq("product_id", productId)
      .eq("storage_zone_id", zoneId)
      .eq("snapshot_version_id", snapshotVersionId),
  ]);

  const snapshotLine: SnapshotLine | null = invLineResult.data
    ? {
        product_id: invLineResult.data.product_id,
        quantity: invLineResult.data.quantity,
        unit_id: invLineResult.data.unit_id,
      }
    : null;

  const events = eventsResult.data ?? [];

  // 4. Build unit resolver from pre-loaded units (same pattern as useEstimatedStock)
  const unitResolver: UnitFamilyResolver = {
    getFamily: (unitId: string) => dbUnits.find((u) => u.id === unitId)?.family ?? null,
    getLabel: (unitId: string) => {
      const u = dbUnits.find((x) => x.id === unitId);
      return u ? `${u.name} (${u.abbreviation})` : null;
    },
  };

  // 5. Delegate 100% to StockEngine — ZERO calculation here
  return getEstimatedStock(
    productId,
    zoneId,
    snapshotVersionId,
    snapshotLine,
    events,
    unitResolver
  );
}
