/**
 * ═══════════════════════════════════════════════════════════════════════════
 * checkStockAvailability — Pre-check stock before withdrawal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pre-checks estimated stock for a list of products before posting a
 * withdrawal. Returns availability info per product so the UI can
 * show adjustments (remove / reduce) before committing.
 *
 * PHASE 2D: Data-loading adapter only. Delegates 100% of stock calculation
 * to getEstimatedStock (StockEngine SSOT). No inline formula.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { getEstimatedStock, type UnitFamilyResolver, type SnapshotLine } from "../engine/stockEngine";

export interface StockCheckLine {
  product_id: string;
  product_name: string;
  requested: number; // absolute value requested
}

export type StockAction = "ok" | "reduce" | "remove";

export interface StockCheckResult {
  product_id: string;
  product_name: string;
  requested: number;
  available: number;
  action: StockAction;
}

/**
 * Check estimated stock availability for a batch of products in a given establishment.
 * Returns per-product availability and recommended action.
 *
 * FIX 3 (P2): Optional inTransitMap subtracts in-transit quantities (DRAFT)
 * from available stock to prevent over-shipment.
 * Does NOT affect standard callers (they pass no map).
 */
export async function checkStockAvailability(
  establishmentId: string,
  lines: StockCheckLine[],
  inTransitMap?: Map<string, number>
): Promise<StockCheckResult[]> {
  if (lines.length === 0) return [];

  const productIds = lines.map((l) => l.product_id);

  // ── 1. Load product zones ──────────────────────────────────────────────
  const { data: products } = await supabase
    .from("products_v2")
    .select("id, storage_zone_id")
    .in("id", productIds);

  const productZoneMap = new Map<string, string>();
  for (const p of products ?? []) {
    if (p.storage_zone_id) productZoneMap.set(p.id, p.storage_zone_id);
  }

  // ── 2. Load active snapshots for relevant zones ────────────────────────
  const zoneIds = [...new Set(productZoneMap.values())];
  if (zoneIds.length === 0) {
    return lines.map((line) => ({
      ...line,
      available: 0,
      action: "remove" as StockAction,
    }));
  }

  const { data: snapshots } = await supabase
    .from("zone_stock_snapshots")
    .select("storage_zone_id, snapshot_version_id")
    .eq("establishment_id", establishmentId)
    .in("storage_zone_id", zoneIds);

  const snapshotMap = new Map<string, string>();
  for (const s of snapshots ?? []) {
    snapshotMap.set(s.storage_zone_id, s.snapshot_version_id);
  }

  // ── 3. Load inventory lines + stock events + units in parallel ─────────
  const sessionIds = [...new Set(snapshotMap.values())];

  const [invLinesResult, eventsResult, unitsResult] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from("inventory_lines")
          .select("product_id, session_id, quantity, unit_id")
          .in("session_id", sessionIds)
          .in("product_id", productIds)
      : Promise.resolve({ data: [] as { product_id: string; session_id: string; quantity: number; unit_id: string | null }[] }),
    zoneIds.length > 0
      ? supabase
          .from("stock_events")
          .select("product_id, storage_zone_id, delta_quantity_canonical, snapshot_version_id, canonical_unit_id, canonical_family")
          .eq("establishment_id", establishmentId)
          .in("product_id", productIds)
          .in("storage_zone_id", zoneIds)
      : Promise.resolve({ data: [] as { product_id: string; storage_zone_id: string; delta_quantity_canonical: number; snapshot_version_id: string; canonical_unit_id: string | null; canonical_family: string | null }[] }),
    supabase
      .from("measurement_units")
      .select("id, name, abbreviation, family"),
  ]);

  const invLines = invLinesResult.data ?? [];
  const events = eventsResult.data ?? [];
  const dbUnits = unitsResult.data ?? [];

  // ── 4. Build unit resolver (same pattern as fetchSingleProductStock) ───
  const unitResolver: UnitFamilyResolver = {
    getFamily: (unitId: string) => dbUnits.find((u) => u.id === unitId)?.family ?? null,
    getLabel: (unitId: string) => {
      const u = dbUnits.find((x) => x.id === unitId);
      return u ? `${u.name} (${u.abbreviation})` : null;
    },
  };

  // ── 5. Per-product: delegate to getEstimatedStock ──────────────────────
  return lines.map((line) => {
    const zoneId = productZoneMap.get(line.product_id);
    if (!zoneId) {
      return { ...line, available: 0, action: "remove" as StockAction };
    }
    const snapId = snapshotMap.get(zoneId);
    if (!snapId) {
      return { ...line, available: 0, action: "remove" as StockAction };
    }

    // Build snapshot line for this product
    const inv = invLines.find(
      (il) => il.product_id === line.product_id && il.session_id === snapId
    );
    const snapshotLine: SnapshotLine | null = inv
      ? { product_id: inv.product_id, quantity: inv.quantity, unit_id: inv.unit_id }
      : null;

    // Filter events for this product+zone+snapshot
    const productEvents = events
      .filter(
        (ev) =>
          ev.product_id === line.product_id &&
          ev.storage_zone_id === zoneId &&
          ev.snapshot_version_id === snapId
      )
      .map((ev) => ({
        delta_quantity_canonical: ev.delta_quantity_canonical,
        canonical_unit_id: ev.canonical_unit_id,
        canonical_family: ev.canonical_family,
      }));

    // Delegate 100% of calculation to StockEngine SSOT
    const outcome = getEstimatedStock(
      line.product_id,
      zoneId,
      snapId,
      snapshotLine,
      productEvents,
      unitResolver
    );

    // Extract estimated quantity (0 if engine returned error)
    const estimated = outcome.ok ? outcome.data.estimated_quantity : 0;

    // Apply in-transit deduction + floor clamp (business logic preserved from original)
    const transitQty = inTransitMap?.get(line.product_id) ?? 0;
    const available = Math.max(0, estimated - transitQty);
    const availableRounded = Math.round(available * 10000) / 10000;

    let action: StockAction = "ok";
    if (availableRounded <= 0) {
      action = "remove";
    } else if (availableRounded < line.requested) {
      action = "reduce";
    }

    return {
      product_id: line.product_id,
      product_name: line.product_name,
      requested: line.requested,
      available: availableRounded,
      action,
    };
  });
}
