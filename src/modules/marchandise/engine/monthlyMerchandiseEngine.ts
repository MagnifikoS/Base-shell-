/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MONTHLY MERCHANDISE ENGINE — Pure, isolated, read-only
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Calculates merchandise consumption between consecutive inventory sessions.
 * A "period" = between two consecutive completed sessions (per zone).
 *
 * Formula:
 *   Consommation = Stock(A) + Réceptions(A→B) − Stock(B)
 *
 * SSOT rules:
 * - inventory_sessions + inventory_lines = snapshot data (intouchable)
 * - stock_events = movements (append-only ledger)
 * - products_v2.final_unit_price = SSOT for prices
 * - ZERO writes, ZERO side effects, ZERO persisted totals
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { findConversionPath } from "@/modules/conditionnementV2";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConditioningConfig } from "@/modules/produitsV2";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface MerchandisePeriod {
  id: string;
  label: string;
  session_a_id: string;
  session_b_id: string;
  session_a_completed_at: string;
  session_b_completed_at: string;
  zone_id: string;
  zone_name: string;
  stock_start_eur: number;
  receipts_eur: number;
  stock_end_eur: number;
  consumption_eur: number;
  product_count: number;
  has_missing_prices: boolean;
}

export interface MerchandiseProductLine {
  product_id: string;
  nom_produit: string;
  category: string | null;
  supplier_name: string | null;
  qty_start: number;
  qty_received: number;
  qty_end: number;
  qty_consumed: number;
  unit_label: string;
  unit_price_eur: number;
  total_consumed_eur: number;
  price_is_live: boolean;
  has_price: boolean;
  /** Product classification for period comparison */
  classification: "comparable" | "new" | "removed";
}

export interface MerchandisePeriodDetail {
  period: MerchandisePeriod;
  lines: MerchandiseProductLine[];
  /** Aggregated stats by classification */
  stats: {
    comparable_count: number;
    new_count: number;
    removed_count: number;
    comparable_consumption_eur: number;
  };
}

interface ProductMapEntry {
  id: string;
  nom_produit: string;
  final_unit_price: number | null;
  final_unit_id: string | null;
  conditionnement_config: unknown;
  category: string | null;
  supplier_id: string | null;
  stock_handling_unit_id?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

interface LineToValue {
  product_id: string;
  quantity: number;
  unit_id: string | null;
}

async function valueLines(
  lines: LineToValue[],
  productMap: Map<string, ProductMapEntry>,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): Promise<{ totalEur: number; hasMissingPrices: boolean }> {
  let total = 0;
  let hasMissingPrices = false;

  for (const line of lines) {
    const product = productMap.get(line.product_id);
    if (!product || !product.final_unit_price || product.final_unit_price <= 0) {
      hasMissingPrices = true;
      continue;
    }

    const qty = round4(line.quantity);
    const finalUnitId = product.final_unit_id;
    const canonicalUnitId = line.unit_id;

    if (!canonicalUnitId || !finalUnitId || canonicalUnitId === finalUnitId) {
      total += round2(qty * product.final_unit_price);
      continue;
    }

    const config = product.conditionnement_config as ConditioningConfig | null;
    const packagingLevels: PackagingLevel[] = config?.packagingLevels ?? [];
    const equivalence: Equivalence | null = config?.equivalence ?? null;

    const path = findConversionPath(canonicalUnitId, finalUnitId, dbUnits, dbConversions, packagingLevels, equivalence);
    if (path.reached && path.factor !== null) {
      total += round2(qty * path.factor * product.final_unit_price);
    } else {
      hasMissingPrices = true;
    }
  }

  return { totalEur: round2(total), hasMissingPrices };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE — LIST PERIODS
// ─────────────────────────────────────────────────────────────────────────────

export async function computeMerchandisePeriods(
  establishmentId: string,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): Promise<MerchandisePeriod[]> {
  const { data: sessions, error } = await supabase
    .from("inventory_sessions")
    .select("id, storage_zone_id, started_at, completed_at, storage_zones(name)")
    .eq("establishment_id", establishmentId)
    .eq("status", "termine")
    .not("completed_at", "is", null)
    .order("storage_zone_id")
    .order("completed_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch sessions: ${error.message}`);
  if (!sessions || sessions.length < 2) return [];

  const byZone = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!byZone.has(s.storage_zone_id)) byZone.set(s.storage_zone_id, []);
    byZone.get(s.storage_zone_id)!.push(s);
  }

  const pairs: Array<{ a: (typeof sessions)[0]; b: (typeof sessions)[0] }> = [];
  for (const zoneSessions of byZone.values()) {
    for (let i = 0; i < zoneSessions.length - 1; i++) {
      pairs.push({ a: zoneSessions[i], b: zoneSessions[i + 1] });
    }
  }

  if (pairs.length === 0) return [];

  const allSessionIds = [...new Set([...pairs.map((p) => p.a.id), ...pairs.map((p) => p.b.id)])];
  const { data: allLines } = await supabase
    .from("inventory_lines")
    .select("session_id, product_id, quantity, unit_id")
    .in("session_id", allSessionIds);

  const linesBySession = new Map<string, Array<{ session_id: string; product_id: string; quantity: number | null; unit_id: string | null }>>();
  for (const line of allLines ?? []) {
    if (!linesBySession.has(line.session_id)) linesBySession.set(line.session_id, []);
    linesBySession.get(line.session_id)!.push(line);
  }

  const productIds = [...new Set((allLines ?? []).map((l) => l.product_id))];
  const { data: products } = productIds.length
    ? await supabase
        .from("products_v2")
        .select("id, nom_produit, final_unit_price, final_unit_id, conditionnement_config, category, supplier_id")
        .in("id", productIds)
    : { data: [] as ProductMapEntry[] };
  const productMap = new Map<string, ProductMapEntry>();
  for (const p of products ?? []) {
    productMap.set(p.id, p as unknown as ProductMapEntry);
  }

  const { data: receiptEvents } = await supabase
    .from("stock_events")
    .select("product_id, delta_quantity_canonical, canonical_unit_id, posted_at, storage_zone_id")
    .eq("establishment_id", establishmentId)
    .eq("event_type", "RECEIPT")
    .order("posted_at");

  const periods: MerchandisePeriod[] = [];

  for (const { a, b } of pairs) {
    const linesA = (linesBySession.get(a.id) ?? []).map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity ?? 0,
      unit_id: l.unit_id,
    }));
    const linesB = (linesBySession.get(b.id) ?? []).map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity ?? 0,
      unit_id: l.unit_id,
    }));

    const receiptsInPeriod = (receiptEvents ?? []).filter(
      (e) =>
        e.storage_zone_id === a.storage_zone_id &&
        e.posted_at >= (a.completed_at ?? "") &&
        e.posted_at < b.started_at
    );

    const receiptLinesByProduct = new Map<string, { qty: number; unit_id: string | null }>();
    for (const evt of receiptsInPeriod) {
      const cur = receiptLinesByProduct.get(evt.product_id);
      receiptLinesByProduct.set(evt.product_id, {
        qty: (cur?.qty ?? 0) + evt.delta_quantity_canonical,
        unit_id: evt.canonical_unit_id,
      });
    }

    const receiptLines = [...receiptLinesByProduct.entries()].map(([product_id, v]) => ({
      product_id,
      quantity: v.qty,
      unit_id: v.unit_id,
    }));

    const [startVal, receiptVal, endVal] = await Promise.all([
      valueLines(linesA, productMap, dbUnits, dbConversions),
      valueLines(receiptLines, productMap, dbUnits, dbConversions),
      valueLines(linesB, productMap, dbUnits, dbConversions),
    ]);

    const consumption = round2(startVal.totalEur + receiptVal.totalEur - endVal.totalEur);
    const zoneData = a.storage_zones as { name: string } | null;
    const periodProductIds = new Set([
      ...linesA.map((l) => l.product_id),
      ...linesB.map((l) => l.product_id),
    ]);

    periods.push({
      id: `${a.id}_${b.id}`,
      label: `${formatDate(a.completed_at ?? "")} → ${formatDate(b.completed_at ?? "")}`,
      session_a_id: a.id,
      session_b_id: b.id,
      session_a_completed_at: a.completed_at ?? "",
      session_b_completed_at: b.completed_at ?? "",
      zone_id: a.storage_zone_id,
      zone_name: zoneData?.name ?? "Zone inconnue",
      stock_start_eur: startVal.totalEur,
      receipts_eur: receiptVal.totalEur,
      stock_end_eur: endVal.totalEur,
      consumption_eur: consumption,
      product_count: periodProductIds.size,
      has_missing_prices: startVal.hasMissingPrices || receiptVal.hasMissingPrices || endVal.hasMissingPrices,
    });
  }

  return periods.sort((a, b) => b.session_b_completed_at.localeCompare(a.session_b_completed_at));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE — PERIOD DETAIL
// ─────────────────────────────────────────────────────────────────────────────

export async function computeMerchandisePeriodDetail(
  sessionAId: string,
  sessionBId: string,
  establishmentId: string,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): Promise<MerchandisePeriodDetail> {
  const { data: sessions } = await supabase
    .from("inventory_sessions")
    .select("id, storage_zone_id, started_at, completed_at, storage_zones(name)")
    .in("id", [sessionAId, sessionBId]);

  const sessionA = sessions?.find((s) => s.id === sessionAId);
  const sessionB = sessions?.find((s) => s.id === sessionBId);
  if (!sessionA || !sessionB) throw new Error("Sessions not found");

  const [{ data: linesA }, { data: linesB }, { data: receiptEvents }] = await Promise.all([
    supabase.from("inventory_lines").select("product_id, quantity, unit_id").eq("session_id", sessionAId),
    supabase.from("inventory_lines").select("product_id, quantity, unit_id").eq("session_id", sessionBId),
    supabase
      .from("stock_events")
      .select("product_id, delta_quantity_canonical, canonical_unit_id")
      .eq("establishment_id", establishmentId)
      .eq("event_type", "RECEIPT")
      .eq("storage_zone_id", sessionA.storage_zone_id)
      .gte("posted_at", sessionA.completed_at ?? "")
      .lt("posted_at", sessionB.started_at),
  ]);

  const allProductIds = new Set([
    ...(linesA ?? []).map((l) => l.product_id),
    ...(linesB ?? []).map((l) => l.product_id),
    ...(receiptEvents ?? []).map((e) => e.product_id),
  ]);

  const productIdsArr = [...allProductIds];
  const { data: products } = productIdsArr.length
    ? await supabase
        .from("products_v2")
        .select("id, nom_produit, final_unit_price, final_unit_id, stock_handling_unit_id, conditionnement_config, category, supplier_id")
        .in("id", productIdsArr)
    : { data: [] as ProductMapEntry[] };

  const supplierIds = [...new Set((products ?? []).map((p) => (p as ProductMapEntry).supplier_id).filter(Boolean))] as string[];
  const { data: suppliers } = supplierIds.length
    ? await supabase.from("invoice_suppliers").select("id, name").in("id", supplierIds)
    : { data: [] as Array<{ id: string; name: string }> };

  const supplierMap = new Map<string, string>((suppliers ?? []).map((s) => [s.id, s.name]));
  const productMap = new Map<string, ProductMapEntry>(
    (products ?? []).map((p) => [p.id, p as ProductMapEntry])
  );

  const { data: units } = await supabase
    .from("measurement_units")
    .select("id, name")
    .eq("establishment_id", establishmentId);
  const unitMap = new Map<string, string>((units ?? []).map((u) => [u.id, u.name]));

  const lineAMap = new Map((linesA ?? []).map((l) => [l.product_id, l]));
  const lineBMap = new Map((linesB ?? []).map((l) => [l.product_id, l]));
  const receiptMap = new Map<string, number>();
  const receiptUnitMap = new Map<string, string | null>();
  for (const e of receiptEvents ?? []) {
    receiptMap.set(e.product_id, (receiptMap.get(e.product_id) ?? 0) + e.delta_quantity_canonical);
    receiptUnitMap.set(e.product_id, e.canonical_unit_id);
  }

  const productLines: MerchandiseProductLine[] = [];
  let totalStartEur = 0;
  let totalReceiptsEur = 0;
  let totalEndEur = 0;
  let hasMissingPrices = false;

  for (const productId of allProductIds) {
    const product = productMap.get(productId);
    const lineA = lineAMap.get(productId);
    const lineB = lineBMap.get(productId);
    const qtyReceived = round4(receiptMap.get(productId) ?? 0);
    const qtyStart = round4(lineA?.quantity ?? 0);
    const qtyEnd = round4(lineB?.quantity ?? 0);
    const qtyConsumed = round4(qtyStart + qtyReceived - qtyEnd);

    // ── Classification: comparable / new / removed ──
    const inA = !!lineA;
    const inB = !!lineB;
    let classification: "comparable" | "new" | "removed";
    if (inA && inB) {
      classification = "comparable";
    } else if (!inA && inB) {
      classification = "new";
    } else {
      classification = "removed";
    }

    const canonicalUnitId = lineA?.unit_id ?? lineB?.unit_id ?? receiptUnitMap.get(productId) ?? null;
    const unitLabel = canonicalUnitId ? (unitMap.get(canonicalUnitId) ?? canonicalUnitId) : "—";

    let unitPriceEur = 0;
    let totalConsumedEur = 0;
    let hasPrice = false;

    if (product?.final_unit_price && product.final_unit_price > 0) {
      hasPrice = true;
      const finalUnitId = product.final_unit_id;

      if (!canonicalUnitId || !finalUnitId || canonicalUnitId === finalUnitId) {
        unitPriceEur = product.final_unit_price;
      } else {
        const config = product.conditionnement_config as ConditioningConfig | null;
        const packagingLevels: PackagingLevel[] = config?.packagingLevels ?? [];
        const equivalence: Equivalence | null = config?.equivalence ?? null;
        const path = findConversionPath(canonicalUnitId, finalUnitId, dbUnits, dbConversions, packagingLevels, equivalence);
        if (path.reached && path.factor !== null) {
          // Keep full precision on unit price — round only final line totals
          unitPriceEur = path.factor * product.final_unit_price;
        } else {
          hasPrice = false;
          hasMissingPrices = true;
        }
      }

      // Only include comparable products in consumption totals
      if (hasPrice && classification === "comparable") {
        totalConsumedEur = round2(qtyConsumed * unitPriceEur);
        totalStartEur += round2(qtyStart * unitPriceEur);
        totalReceiptsEur += round2(qtyReceived * unitPriceEur);
        totalEndEur += round2(qtyEnd * unitPriceEur);
      } else if (hasPrice) {
        totalConsumedEur = round2(qtyConsumed * unitPriceEur);
      }
    } else {
      hasMissingPrices = true;
    }

    productLines.push({
      product_id: productId,
      nom_produit: product?.nom_produit ?? "Produit inconnu",
      category: product?.category ?? null,
      supplier_name: product?.supplier_id ? (supplierMap.get(product.supplier_id) ?? null) : null,
      qty_start: qtyStart,
      qty_received: qtyReceived,
      qty_end: qtyEnd,
      qty_consumed: qtyConsumed,
      unit_label: unitLabel,
      unit_price_eur: unitPriceEur,
      total_consumed_eur: totalConsumedEur,
      price_is_live: true,
      has_price: hasPrice,
      classification,
    });
  }

  productLines.sort((a, b) => b.total_consumed_eur - a.total_consumed_eur);

  // ── Stats by classification ──
  const stats = {
    comparable_count: productLines.filter((l) => l.classification === "comparable").length,
    new_count: productLines.filter((l) => l.classification === "new").length,
    removed_count: productLines.filter((l) => l.classification === "removed").length,
    comparable_consumption_eur: round2(
      productLines
        .filter((l) => l.classification === "comparable")
        .reduce((sum, l) => sum + l.total_consumed_eur, 0)
    ),
  };

  const zoneData = sessionA.storage_zones as { name: string } | null;
  const period: MerchandisePeriod = {
    id: `${sessionAId}_${sessionBId}`,
    label: `${formatDate(sessionA.completed_at ?? "")} → ${formatDate(sessionB.completed_at ?? "")}`,
    session_a_id: sessionAId,
    session_b_id: sessionBId,
    session_a_completed_at: sessionA.completed_at ?? "",
    session_b_completed_at: sessionB.completed_at ?? "",
    zone_id: sessionA.storage_zone_id,
    zone_name: zoneData?.name ?? "Zone inconnue",
    stock_start_eur: round2(totalStartEur),
    receipts_eur: round2(totalReceiptsEur),
    stock_end_eur: round2(totalEndEur),
    consumption_eur: round2(totalStartEur + totalReceiptsEur - totalEndEur),
    product_count: allProductIds.size,
    has_missing_prices: hasMissingPrices,
  };

  return { period, lines: productLines, stats };
}
