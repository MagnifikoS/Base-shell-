/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STOCK ENGINE — Pure, isolated, locked
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FORMULA:
 *   StockEstimé = SnapshotRéférence(zone) + Σ(stock_events POSTED liés)
 *
 * RULES:
 * - Never stores estimated stock in DB
 * - Returns quantity in snapshot's canonical unit (inventory_lines.unit_id)
 * - Refuses events with mismatched canonical_family
 * - Never uses products_v2.stock_handling_unit_id current
 * - Uses numeric precision (4 decimals)
 * - Never uses "last completed session" — explicit snapshot_version_id only
 *
 * PRECISION: 4 decimal places (matching V0 rounding)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { EstimatedStockOutcome, EstimatedStockResult, StockEvent } from "../types";

/** Precision for all stock calculations (4 decimals, matching V0) */
const _PRECISION = 4;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT LINE — minimal data from inventory_lines
// ═══════════════════════════════════════════════════════════════════════════

export interface SnapshotLine {
  product_id: string;
  quantity: number | null;
  unit_id: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIT FAMILY RESOLVER — injected dependency (no DB call inside engine)
// ═══════════════════════════════════════════════════════════════════════════

export interface UnitFamilyResolver {
  getFamily(unitId: string): string | null;
  getLabel(unitId: string): string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION — getEstimatedStock (PURE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute estimated stock for a single product in a single zone.
 *
 * @param product_id - UUID of the product
 * @param storage_zone_id - UUID of the storage zone
 * @param snapshot_version_id - Active snapshot session ID (from zone_stock_snapshots)
 * @param snapshotLine - The inventory_line for this product in the snapshot session (or null)
 * @param events - All POSTED stock_events for this product+zone linked to this snapshot
 * @param unitResolver - Injected dependency for unit family/label resolution
 */
export function getEstimatedStock(
  product_id: string,
  storage_zone_id: string,
  snapshot_version_id: string,
  snapshotLine: SnapshotLine | null,
  events: ReadonlyArray<
    Pick<StockEvent, "delta_quantity_canonical" | "canonical_unit_id" | "canonical_family">
  >,
  unitResolver: UnitFamilyResolver
): EstimatedStockOutcome {
  // ── GUARD 1: No snapshot line ──
  // Products created AFTER a zone inventory have no inventory_line in the active snapshot.
  // Their stock was initialized at 0 (fn_initialize_product_stock), so we use baseline=0
  // and infer the unit from the events. Only error if NO events either (truly unknown).
  if (!snapshotLine) {
    if (events.length === 0) {
      return {
        ok: false,
        error: {
          code: "NO_SNAPSHOT_LINE",
          message: `Aucune ligne d'inventaire trouvée pour ce produit dans le snapshot de référence.`,
          product_id,
          storage_zone_id,
        },
      };
    }

    // Infer canonical family and unit from events
    const firstEvent = events[0];
    const inferredFamily = firstEvent.canonical_family;
    const inferredUnitId = firstEvent.canonical_unit_id;
    const inferredLabel = inferredUnitId ? unitResolver.getLabel(inferredUnitId) : null;

    // Filter events by inferred family (same SSOT guard as normal path)
    const compatibleEvents = events.filter((e) => e.canonical_family === inferredFamily);
    const incompatibleEvents = events.filter((e) => e.canonical_family !== inferredFamily);

    const warnings: import("../types").StockEngineWarning[] = [];
    if (incompatibleEvents.length > 0) {
      const uniqueFamilies = [...new Set(incompatibleEvents.map((e) => e.canonical_family))];
      warnings.push({
        code: "IGNORED_EVENTS_FAMILY_MISMATCH",
        eventCount: incompatibleEvents.length,
        examples: uniqueFamilies.slice(0, 3).map((f) => ({ canonical_family: f })),
      });
    }

    let eventsDelta = 0;
    for (const event of compatibleEvents) {
      eventsDelta = round4(eventsDelta + event.delta_quantity_canonical);
    }

    // Baseline = 0 (product created after snapshot)
    const estimatedQuantity = round4(eventsDelta);

    return {
      ok: true,
      data: {
        product_id,
        storage_zone_id,
        snapshot_version_id,
        snapshot_quantity: 0,
        events_delta: eventsDelta,
        estimated_quantity: estimatedQuantity,
        canonical_unit_id: inferredUnitId,
        canonical_family: inferredFamily,
        canonical_label: inferredLabel,
        events_count: compatibleEvents.length,
        warnings,
      },
    };
  }

  // ── GUARD 2: Snapshot must have unit_id ──
  if (!snapshotLine.unit_id) {
    return {
      ok: false,
      error: {
        code: "MISSING_UNIT_INFO",
        message: `La ligne d'inventaire de référence n'a pas d'unité (unit_id null).`,
        product_id,
        storage_zone_id,
      },
    };
  }

  // ── Resolve snapshot's canonical family ──
  const snapshotFamily = unitResolver.getFamily(snapshotLine.unit_id);
  if (!snapshotFamily) {
    return {
      ok: false,
      error: {
        code: "MISSING_UNIT_INFO",
        message: `Impossible de déterminer la famille de l'unité du snapshot (${snapshotLine.unit_id}).`,
        product_id,
        storage_zone_id,
      },
    };
  }

  const snapshotLabel = unitResolver.getLabel(snapshotLine.unit_id);

  // ── GUARD 3: Filter out events with incompatible family (unit drift legacy) ──
  const compatibleEvents = events.filter((e) => e.canonical_family === snapshotFamily);
  const incompatibleEvents = events.filter((e) => e.canonical_family !== snapshotFamily);

  // ── BUILD WARNINGS ──
  const warnings: import("../types").StockEngineWarning[] = [];
  if (incompatibleEvents.length > 0) {
    const uniqueFamilies = [...new Set(incompatibleEvents.map((e) => e.canonical_family))];
    warnings.push({
      code: "IGNORED_EVENTS_FAMILY_MISMATCH",
      eventCount: incompatibleEvents.length,
      examples: uniqueFamilies.slice(0, 3).map((f) => ({ canonical_family: f })),
    });
  }

  // ── COMPUTE ──
  const snapshotQuantity = snapshotLine.quantity ?? 0;

  let eventsDelta = 0;
  for (const event of compatibleEvents) {
    eventsDelta = round4(eventsDelta + event.delta_quantity_canonical);
  }

  const estimatedQuantity = round4(snapshotQuantity + eventsDelta);

  const result: EstimatedStockResult = {
    product_id,
    storage_zone_id,
    snapshot_version_id,
    snapshot_quantity: round4(snapshotQuantity),
    events_delta: eventsDelta,
    estimated_quantity: estimatedQuantity,
    canonical_unit_id: snapshotLine.unit_id,
    canonical_family: snapshotFamily,
    canonical_label: snapshotLabel,
    events_count: compatibleEvents.length,
    warnings,
  };

  return { ok: true, data: result };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH — Multiple products in a zone
// ═══════════════════════════════════════════════════════════════════════════

export interface BatchStockInput {
  product_id: string;
  snapshotLine: SnapshotLine | null;
  events: ReadonlyArray<
    Pick<StockEvent, "delta_quantity_canonical" | "canonical_unit_id" | "canonical_family">
  >;
}

/**
 * Compute estimated stock for multiple products in a single zone.
 */
export function getEstimatedStockBatch(
  storage_zone_id: string,
  snapshot_version_id: string,
  items: BatchStockInput[],
  unitResolver: UnitFamilyResolver
): Map<string, EstimatedStockOutcome> {
  const results = new Map<string, EstimatedStockOutcome>();

  for (const item of items) {
    results.set(
      item.product_id,
      getEstimatedStock(
        item.product_id,
        storage_zone_id,
        snapshot_version_id,
        item.snapshotLine,
        item.events,
        unitResolver
      )
    );
  }

  return results;
}

