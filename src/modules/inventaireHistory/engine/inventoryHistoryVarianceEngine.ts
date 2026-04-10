/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTORY HISTORY VARIANCE ENGINE — Pure, isolated, read-only
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * For each completed inventory session S, computes the variance:
 *   Variance = counted(S) − estimated_before(S)
 *
 * estimated_before(S) = prev_snapshot_qty + Σ(events where snapshot_version_id = prev_session.id
 *                                              AND posted_at < S.started_at)
 *
 * SSOT rules:
 * - inventory_sessions + inventory_lines = snapshot data (intouchable)
 * - stock_events (append-only ledger) filtered by snapshot_version_id
 * - products_v2 = product metadata (final_unit_price for EUR variance)
 * - measurement_units = unit labels
 * - ZERO writes, ZERO side effects
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface InventorySessionSummary {
  id: string;
  establishment_id: string;
  storage_zone_id: string;
  zone_name: string;
  started_at: string;
  completed_at: string;
  total_products: number;
  counted_products: number;
  /** Number of products with non-zero variance */
  variance_count: number;
  /** Total EUR variance (absolute sum), null if prices unavailable */
  total_variance_eur: number | null;
  /** Whether a "previous" snapshot exists (required for variance calc) */
  has_previous_snapshot: boolean;
}

/**
 * Grouped inventory event — one entry per day (all zones completed on the same day).
 */
export interface InventoryEventGroup {
  /** Key = "YYYY-MM-DD" — groups all sessions completed on the same calendar day */
  group_key: string;
  /** Latest completed_at timestamp in this group */
  completed_at: string;
  /** All session IDs in this group */
  session_ids: string[];
  /** Sum of counted_products across all zones */
  total_counted: number;
  /** Sum of total_products across all zones */
  total_products: number;
  /** Sum of variance_count across all zones */
  variance_count: number;
  /** Sum EUR variance (null if any zone lacks prices) */
  total_variance_eur: number | null;
  /** True only if ALL zones have a previous snapshot */
  has_previous_snapshot: boolean;
  /** Individual session summaries (for detail view) */
  sessions: InventorySessionSummary[];
}

export interface InventoryVarianceLine {
  product_id: string;
  nom_produit: string;
  zone_name: string;
  /** Estimated quantity before this inventory (in inventory unit) */
  estimated_before: number;
  /** Actually counted quantity (from this session's inventory_lines) */
  counted: number;
  /** variance = counted − estimated_before */
  variance: number;
  /** inventory unit ID */
  unit_id: string;
  /** inventory unit label (full name, not abbreviation) */
  unit_label: string;
  /** EUR variance (null if no price) */
  variance_eur: number | null;
}

export interface InventoryVarianceDetail {
  group: InventoryEventGroup;
  /** Only products with variance ≠ 0 */
  lines: InventoryVarianceLine[];
}


interface ProductPriceData {
  id: string;
  final_unit_price: number | null;
  final_unit_id: string | null;
  stock_handling_unit_id: string | null;
  conditionnement_config: unknown;
}

interface ProductDetailData {
  id: string;
  nom_produit: string;
  final_unit_price: number | null;
  final_unit_id: string | null;
  conditionnement_config: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve price factor from inventory unit to price unit via BFS.
 * Returns the factor to multiply with final_unit_price, or null if impossible.
 */
function resolvePriceFactor(
  inventoryUnitId: string | null,
  product: { final_unit_id: string | null; conditionnement_config: unknown },
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): number | null {
  if (!inventoryUnitId || !product.final_unit_id) return null;
  if (inventoryUnitId === product.final_unit_id) return 1;

  const config = product.conditionnement_config as Record<string, unknown> | null;
  const packagingLevels: PackagingLevel[] =
    (config?.packagingLevels as PackagingLevel[]) ?? [];
  const equivalence: Equivalence | null =
    (config?.equivalence as Equivalence | null) ?? null;

  const path = findConversionPath(
    inventoryUnitId,
    product.final_unit_id,
    dbUnits,
    dbConversions,
    packagingLevels,
    equivalence
  );

  return path.reached && path.factor !== null ? path.factor : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — group key: "YYYY-MM-DD" (day-level grouping — un inventaire = un jour)
// ─────────────────────────────────────────────────────────────────────────────

function toGroupKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10); // "2026-02-15"
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE — LIST ALL COMPLETED SESSIONS GROUPED BY INVENTORY EVENT
// ─────────────────────────────────────────────────────────────────────────────

export async function computeInventoryHistoryList(
  establishmentId: string
): Promise<InventoryEventGroup[]> {
  // 1. Fetch all completed sessions + zone name
  const { data: sessions, error: sessErr } = await supabase
    .from("inventory_sessions")
    .select(
      `id, establishment_id, storage_zone_id, started_at, completed_at,
       total_products, counted_products,
       storage_zones(name)`
    )
    .eq("establishment_id", establishmentId)
    .eq("status", "termine")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false });

  if (sessErr) throw new Error(`Failed to fetch sessions: ${sessErr.message}`);
  if (!sessions || sessions.length === 0) return [];

  // 2. Fetch all inventory lines for all sessions (bulk)
  const sessionIds = sessions.map((s) => s.id);
  const { data: allLines } = await supabase
    .from("inventory_lines")
    .select("session_id, product_id, quantity, unit_id")
    .in("session_id", sessionIds);

  const linesBySession = new Map<string, Array<{ session_id: string; product_id: string; quantity: number | null; unit_id: string | null }>>();
  for (const line of allLines ?? []) {
    if (!linesBySession.has(line.session_id)) linesBySession.set(line.session_id, []);
    linesBySession.get(line.session_id)!.push(line);
  }

  // 3. Fetch product prices for EUR calculation
  const productIds = [...new Set((allLines ?? []).map((l) => l.product_id))];
  const { data: products } = productIds.length
    ? await supabase
        .from("products_v2")
        .select("id, final_unit_price, final_unit_id, stock_handling_unit_id, conditionnement_config")
        .in("id", productIds)
    : { data: [] as ProductPriceData[] };
  const productMap = new Map<string, ProductPriceData>(
    (products ?? []).map((p) => [p.id, p as ProductPriceData])
  );

  // 3b. Fetch DB units & conversions for BFS price conversion
  const { data: dbUnitsRaw } = await supabase
    .from("measurement_units")
    .select("id, name, abbreviation, category, family, is_reference, aliases")
    .eq("establishment_id", establishmentId)
    .eq("is_active", true);
  const dbUnits: UnitWithFamily[] = (dbUnitsRaw ?? []) as UnitWithFamily[];

  const { data: dbConvRaw } = await supabase
    .from("unit_conversions")
    .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
    .eq("establishment_id", establishmentId)
    .eq("is_active", true);
  const dbConversions: ConversionRule[] = (dbConvRaw ?? []).map((r) => ({
    ...r,
    factor: Number(r.factor),
  })) as ConversionRule[];

  // 4. Group sessions by zone, sort ascending for prev-session lookup
  const sessionAscByZone = new Map<string, string[]>();
  const allByZone = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!allByZone.has(s.storage_zone_id)) allByZone.set(s.storage_zone_id, []);
    allByZone.get(s.storage_zone_id)!.push(s);
  }
  for (const [, zoneSessions] of allByZone) {
    const sorted = [...zoneSessions].sort((a, b) =>
      (a.completed_at ?? "").localeCompare(b.completed_at ?? "")
    );
    const zoneId = sorted[0].storage_zone_id;
    sessionAscByZone.set(zoneId, sorted.map((s) => s.id));
  }

  // 5. Fetch all relevant events
  const { data: allEvents } = await supabase
    .from("stock_events")
    .select("product_id, storage_zone_id, delta_quantity_canonical, canonical_unit_id, snapshot_version_id, posted_at")
    .eq("establishment_id", establishmentId)
    .in("snapshot_version_id", sessionIds)
    .neq("event_type", "VOID");

  const eventsBySnapshot = new Map<string, Array<{ product_id: string; delta_quantity_canonical: number; posted_at: string }>>();
  for (const evt of allEvents ?? []) {
    if (!eventsBySnapshot.has(evt.snapshot_version_id)) eventsBySnapshot.set(evt.snapshot_version_id, []);
    eventsBySnapshot.get(evt.snapshot_version_id)!.push(evt);
  }

  // 6. Build per-session summaries
  const sessionSummaries: InventorySessionSummary[] = [];

  for (const session of sessions) {
    const zoneSorted = sessionAscByZone.get(session.storage_zone_id) ?? [];
    const myIdx = zoneSorted.indexOf(session.id);
    const hasPrev = myIdx > 0;
    const prevSessionId = hasPrev ? zoneSorted[myIdx - 1] : null;

    const currentLines = linesBySession.get(session.id) ?? [];
    let varianceCount = 0;
    let totalVarianceEur = 0;
    let eurDataMissing = false;

    if (hasPrev && prevSessionId) {
      const prevLines = linesBySession.get(prevSessionId) ?? [];
      const prevLineMap = new Map(prevLines.map((l) => [l.product_id, l]));
      const prevEvents = (eventsBySnapshot.get(prevSessionId) ?? []).filter(
        (e) => e.posted_at < session.started_at
      );
      const eventDeltaByProduct = new Map<string, number>();
      for (const evt of prevEvents) {
        const cur = eventDeltaByProduct.get(evt.product_id) ?? 0;
        eventDeltaByProduct.set(evt.product_id, cur + evt.delta_quantity_canonical);
      }

      for (const line of currentLines) {
        const prevLine = prevLineMap.get(line.product_id);
        const prevQty = prevLine ? (prevLine.quantity ?? 0) : 0;
        const eventsDelta = eventDeltaByProduct.get(line.product_id) ?? 0;
        const estimatedBefore = round4(prevQty + eventsDelta);
        const counted = round4(line.quantity ?? 0);
        const variance = round4(counted - estimatedBefore);

        if (Math.abs(variance) > 0.0001) {
          varianceCount++;
          const product = productMap.get(line.product_id);
          if (product && product.final_unit_price && product.final_unit_price > 0) {
            const priceFactor = resolvePriceFactor(line.unit_id, product, dbUnits, dbConversions);
            if (priceFactor !== null) {
              totalVarianceEur = round2(totalVarianceEur + variance * priceFactor * product.final_unit_price);
            } else {
              eurDataMissing = true;
            }
          } else {
            eurDataMissing = true;
          }
        }
      }
    }

    const zoneData = session.storage_zones as { name: string } | null;
    sessionSummaries.push({
      id: session.id,
      establishment_id: session.establishment_id,
      storage_zone_id: session.storage_zone_id,
      zone_name: zoneData?.name ?? "Zone inconnue",
      started_at: session.started_at,
      completed_at: session.completed_at ?? "",
      total_products: session.total_products,
      counted_products: session.counted_products,
      variance_count: hasPrev ? varianceCount : 0,
      total_variance_eur: hasPrev && !eurDataMissing ? totalVarianceEur : null,
      has_previous_snapshot: hasPrev,
    });
  }

  // 7. Group session summaries by day key → InventoryEventGroup (un inventaire = un jour)
  const groupMap = new Map<string, InventoryEventGroup>();
  // Sessions are already sorted desc by completed_at — preserve that order
  for (const s of sessionSummaries) {
    const key = toGroupKey(s.completed_at);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        group_key: key,
        completed_at: s.completed_at, // will be updated to latest below
        session_ids: [],
        total_counted: 0,
        total_products: 0,
        variance_count: 0,
        total_variance_eur: 0,
        has_previous_snapshot: true,
        sessions: [],
      });
    }
    const group = groupMap.get(key)!;
    group.session_ids.push(s.id);
    group.sessions.push(s);
    group.total_counted += s.counted_products;
    group.total_products += s.total_products;
    group.variance_count += s.variance_count;
    // Keep the latest completed_at as the group's representative timestamp
    if (s.completed_at > group.completed_at) {
      group.completed_at = s.completed_at;
    }
    // EUR: if any session has null, the group total is null
    if (group.total_variance_eur !== null) {
      if (s.total_variance_eur === null) {
        group.total_variance_eur = null;
      } else {
        group.total_variance_eur = round2(group.total_variance_eur + s.total_variance_eur);
      }
    }
    // has_previous_snapshot: false if ANY session lacks a prev
    if (!s.has_previous_snapshot) group.has_previous_snapshot = false;
  }

  return [...groupMap.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE — DETAIL: variance lines for a single session
// ─────────────────────────────────────────────────────────────────────────────

export async function computeInventoryVarianceDetail(
  sessionId: string,
  establishmentId: string
): Promise<InventoryVarianceDetail> {
  // 1. Fetch the target session
  const { data: session, error: sessErr } = await supabase
    .from("inventory_sessions")
    .select("id, establishment_id, storage_zone_id, started_at, completed_at, total_products, counted_products, storage_zones(name)")
    .eq("id", sessionId)
    .single();

  if (sessErr || !session) throw new Error("Session not found");

  // 2. Find previous session for this zone
  const { data: prevSessions } = await supabase
    .from("inventory_sessions")
    .select("id, completed_at")
    .eq("establishment_id", establishmentId)
    .eq("storage_zone_id", session.storage_zone_id)
    .eq("status", "termine")
    .not("completed_at", "is", null)
    .lt("completed_at", session.completed_at ?? "")
    .order("completed_at", { ascending: false })
    .limit(1);

  const prevSession = prevSessions?.[0] ?? null;

  // 3. Fetch current session lines
  const { data: currentLines } = await supabase
    .from("inventory_lines")
    .select("product_id, quantity, unit_id")
    .eq("session_id", sessionId);

  // 4. Fetch units (full data for BFS + labels)
  const { data: unitsRaw } = await supabase
    .from("measurement_units")
    .select("id, name, abbreviation, category, family, is_reference, aliases")
    .eq("establishment_id", establishmentId)
    .eq("is_active", true);
  const detailDbUnits: UnitWithFamily[] = (unitsRaw ?? []) as UnitWithFamily[];
  const unitMap = new Map<string, string>((unitsRaw ?? []).map((u) => [u.id, u.name]));

  // 4b. Fetch conversions for BFS
  const { data: convRaw } = await supabase
    .from("unit_conversions")
    .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
    .eq("establishment_id", establishmentId)
    .eq("is_active", true);
  const detailDbConversions: ConversionRule[] = (convRaw ?? []).map((r) => ({
    ...r,
    factor: Number(r.factor),
  })) as ConversionRule[];

  // 5. Fetch products
  const productIds = [...new Set((currentLines ?? []).map((l) => l.product_id))];
  const { data: products } = productIds.length
    ? await supabase
        .from("products_v2")
        .select("id, nom_produit, final_unit_price, final_unit_id, conditionnement_config")
        .in("id", productIds)
    : { data: [] as ProductDetailData[] };
  const productMap = new Map<string, ProductDetailData>(
    (products ?? []).map((p) => [p.id, p as ProductDetailData])
  );

  // 6. Build prev state (snapshot + events before this session)
  const prevLineMap = new Map<string, { quantity: number; unit_id: string | null }>();
  const eventDeltaByProduct = new Map<string, number>();

  if (prevSession) {
    const { data: prevLines } = await supabase
      .from("inventory_lines")
      .select("product_id, quantity, unit_id")
      .eq("session_id", prevSession.id);

    for (const l of prevLines ?? []) {
      prevLineMap.set(l.product_id, { quantity: l.quantity ?? 0, unit_id: l.unit_id });
    }

    const { data: events } = await supabase
      .from("stock_events")
      .select("product_id, delta_quantity_canonical")
      .eq("establishment_id", establishmentId)
      .eq("snapshot_version_id", prevSession.id)
      .neq("event_type", "VOID")
      .lt("posted_at", session.started_at);

    for (const evt of events ?? []) {
      const cur = eventDeltaByProduct.get(evt.product_id) ?? 0;
      eventDeltaByProduct.set(evt.product_id, cur + evt.delta_quantity_canonical);
    }
  }

  // 7. Compute variance lines — only non-zero (filtered later)
  const allVarianceLines: InventoryVarianceLine[] = [];
  const zoneData = session.storage_zones as { name: string } | null;
  const zoneName = zoneData?.name ?? "Zone inconnue";

  for (const line of currentLines ?? []) {
    const prevState = prevLineMap.get(line.product_id);
    const prevQty = prevState?.quantity ?? 0;
    const eventsDelta = eventDeltaByProduct.get(line.product_id) ?? 0;
    const estimatedBefore = round4(prevQty + eventsDelta);
    const counted = round4(line.quantity ?? 0);
    const variance = round4(counted - estimatedBefore);

    if (!prevSession || Math.abs(variance) > 0.0001) {
      const product = productMap.get(line.product_id);
      const unitLabel = line.unit_id ? (unitMap.get(line.unit_id) ?? line.unit_id) : "—";
      let varianceEur: number | null = null;
      if (product?.final_unit_price && product.final_unit_price > 0) {
        const priceFactor = resolvePriceFactor(line.unit_id, product, detailDbUnits, detailDbConversions);
        if (priceFactor !== null) {
          varianceEur = round2(variance * priceFactor * product.final_unit_price);
        }
      }

      allVarianceLines.push({
        product_id: line.product_id,
        nom_produit: product?.nom_produit ?? "Produit inconnu",
        zone_name: zoneName,
        estimated_before: estimatedBefore,
        counted,
        variance,
        unit_id: line.unit_id ?? "",
        unit_label: unitLabel,
        variance_eur: varianceEur,
      });
    }
  }

  // Sort by |variance| descending
  allVarianceLines.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const summary: InventorySessionSummary = {
    id: session.id,
    establishment_id: session.establishment_id,
    storage_zone_id: session.storage_zone_id,
    zone_name: zoneName,
    started_at: session.started_at,
    completed_at: session.completed_at ?? "",
    total_products: session.total_products,
    counted_products: session.counted_products,
    variance_count: allVarianceLines.filter((l) => Math.abs(l.variance) > 0.0001).length,
    total_variance_eur: allVarianceLines.reduce((s, l) => s + (l.variance_eur ?? 0), 0),
    has_previous_snapshot: !!prevSession,
  };

  // Build a single-session group for compatibility
  const group: InventoryEventGroup = {
    group_key: toGroupKey(summary.completed_at),
    completed_at: summary.completed_at,
    session_ids: [summary.id],
    total_counted: summary.counted_products,
    total_products: summary.total_products,
    variance_count: summary.variance_count,
    total_variance_eur: summary.total_variance_eur,
    has_previous_snapshot: summary.has_previous_snapshot,
    sessions: [summary],
  };

  return { group, lines: allVarianceLines };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE — DETAIL: variance lines for a GROUP (multiple sessions / zones)
// ─────────────────────────────────────────────────────────────────────────────

export async function computeInventoryVarianceGroup(
  sessionIds: string[],
  establishmentId: string
): Promise<InventoryVarianceDetail> {
  if (sessionIds.length === 0) throw new Error("No session IDs provided");

  // Run detail for each session and merge
  const results = await Promise.all(
    sessionIds.map((id) => computeInventoryVarianceDetail(id, establishmentId))
  );

  // Merge all lines from all zones
  const mergedLines: InventoryVarianceLine[] = results.flatMap((r) => r.lines);
  mergedLines.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  // Merge group metadata
  const firstGroup = results[0].group;
  const mergedGroup: InventoryEventGroup = {
    group_key: firstGroup.group_key,
    completed_at: firstGroup.completed_at,
    session_ids: results.flatMap((r) => r.group.session_ids),
    total_counted: results.reduce((s, r) => s + r.group.total_counted, 0),
    total_products: results.reduce((s, r) => s + r.group.total_products, 0),
    variance_count: mergedLines.filter((l) => Math.abs(l.variance) > 0.0001).length,
    total_variance_eur: results.every((r) => r.group.total_variance_eur !== null)
      ? round2(results.reduce((s, r) => s + (r.group.total_variance_eur ?? 0), 0))
      : null,
    has_previous_snapshot: results.every((r) => r.group.has_previous_snapshot),
    sessions: results.flatMap((r) => r.group.sessions),
  };

  return { group: mergedGroup, lines: mergedLines };
}
