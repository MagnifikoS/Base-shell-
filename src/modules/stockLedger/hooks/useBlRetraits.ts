/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useBlRetraits — Fetch BL Retraits for a given month + establishment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Query key: ["bl-retraits", establishmentId, yearMonth]
 * Fetches from bl_withdrawal_documents + bl_withdrawal_lines.
 * Joins stock_documents to get DRAFT/POSTED status.
 * DRAFT documents are marked "in_transit" and excluded from totals.
 *
 * Display strategy:
 *   - Reconverts canonical qty → stock_handling_unit via BFS
 *   - Converts unit_price to match display unit (price / factor)
 *   - Ensures qty, unit_price, unit_label are ALWAYS in the same unit
 *   - Fallback: canonical values (coherent, never mixed)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reconvertToDisplayUnit } from "../utils/reconvertToDisplayUnit";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { BlRetrait, BlRetraitLine } from "../types/blRetrait";
import type { Json } from "@/integrations/supabase/types";

export interface BlRetraitWithLines extends BlRetrait {
  lines: BlRetraitLine[];
  /** True if the underlying stock_document is still DRAFT */
  isDraft: boolean;
}

async function fetchBlRetraits(
  establishmentId: string,
  yearMonth: string
): Promise<BlRetraitWithLines[]> {
  const startDate = `${yearMonth}-01`;
  const [y, m] = yearMonth.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  // Join stock_documents to get status (DRAFT vs POSTED)
  const { data, error } = await (supabase as any)
    .from("bl_withdrawal_documents")
    .select("*, bl_withdrawal_lines(*), stock_doc:stock_documents!bl_withdrawal_documents_stock_document_id_fkey(status)")
    .eq("establishment_id", establishmentId)
    .gte("created_at", startDate)
    .lt("created_at", nextMonth)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown[];

  // Collect all canonical_unit_ids and product_ids
  const unitIdSet = new Set<string>();
  const productIdSet = new Set<string>();
  for (const row of rows) {
    const rec = row as Record<string, unknown>;
    const rawLines = Array.isArray(rec.bl_withdrawal_lines) ? rec.bl_withdrawal_lines : [];
    for (const l of rawLines as Record<string, unknown>[]) {
      if (l.canonical_unit_id) unitIdSet.add(l.canonical_unit_id as string);
      if (l.product_id) productIdSet.add(l.product_id as string);
    }
  }

  // Fetch unit abbreviations + product data + BFS resources in parallel
  const unitIds = [...unitIdSet];
  const productIds = [...productIdSet];

  const [unitsRes, productsRes, dbUnitsRes, dbConvsRes] = await Promise.all([
    unitIds.length > 0
      ? supabase.from("measurement_units").select("id, abbreviation, name").in("id", unitIds)
      : Promise.resolve({ data: [] as { id: string; abbreviation: string; name: string }[] }),
    productIds.length > 0
      ? supabase
          .from("products_v2")
          .select("id, stock_handling_unit_id, conditionnement_config, stock_handling_unit:measurement_units!products_v2_stock_handling_unit_id_fkey(id, name, abbreviation)")
          .in("id", productIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("measurement_units")
      .select("id, name, abbreviation, category, family, is_reference, aliases")
      .eq("establishment_id", establishmentId)
      .eq("is_active", true),
    supabase
      .from("unit_conversions")
      .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
      .eq("establishment_id", establishmentId)
      .eq("is_active", true),
  ]);

  const unitMap = new Map<string, { abbreviation: string; name: string }>();
  for (const u of (unitsRes.data ?? []) as { id: string; abbreviation: string; name: string }[]) {
    unitMap.set(u.id, { abbreviation: u.abbreviation, name: u.name });
  }

  type ProductInfo = {
    id: string;
    stock_handling_unit_id: string | null;
    conditionnement_config: Json | null;
    stock_handling_unit: { id: string; name: string; abbreviation: string } | null;
  };
  const productMap = new Map<string, ProductInfo>();
  for (const p of (productsRes.data ?? []) as ProductInfo[]) {
    productMap.set(p.id, p);
  }

  const dbUnits: UnitWithFamily[] = (dbUnitsRes.data ?? []).map((u: any) => ({
    ...u,
    aliases: u.aliases as string[] | null,
  }));
  const dbConversions: ConversionRule[] = (dbConvsRes.data ?? []) as ConversionRule[];

  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const rawLines = record.bl_withdrawal_lines;
    const rawLinesArr = Array.isArray(rawLines) ? rawLines : [];
    const stockDoc = record.stock_doc as { status: string } | null;
    const isDraft = stockDoc?.status === "DRAFT";

    const lines: BlRetraitLine[] = rawLinesArr.map((l: Record<string, unknown>) => {
      const canonicalQty = (l.quantity_canonical as number) ?? 0;
      const canonicalUnitId = l.canonical_unit_id as string | null;
      const canonicalUnitInfo = canonicalUnitId ? unitMap.get(canonicalUnitId) : null;
      const rawUnitPrice = (l.unit_price_snapshot as number | null) ?? null;
      const rawLineTotal = (l.line_total_snapshot as number | null) ?? null;

      // Try BFS reconversion: canonical → stock_handling_unit
      const productId = l.product_id as string;
      const product = productMap.get(productId);
      const reconverted = product
        ? reconvertToDisplayUnit(
            canonicalQty,
            canonicalUnitId,
            product.stock_handling_unit?.id ?? null,
            product.stock_handling_unit?.name ?? null,
            product.conditionnement_config,
            dbUnits,
            dbConversions
          )
        : null;

      let displayQty: number;
      let displayUnitLabel: string | null;
      let displayUnitPrice: number | null;

      if (reconverted && reconverted.factor !== 1) {
        // Convert qty and price to display unit
        displayQty = reconverted.quantity;
        displayUnitLabel = product?.stock_handling_unit?.abbreviation ?? reconverted.unitName;
        // Price must be inverse-converted: canonical_price / factor
        // So that displayQty × displayUnitPrice = original total
        displayUnitPrice = rawUnitPrice != null ? rawUnitPrice / reconverted.factor : null;
      } else {
        // No conversion needed or no path found — use canonical (always coherent)
        displayQty = canonicalQty;
        displayUnitLabel = canonicalUnitInfo?.abbreviation ?? null;
        displayUnitPrice = rawUnitPrice;
      }

      return {
        id: l.id as string,
        bl_retrait_id: l.bl_withdrawal_document_id as string,
        product_id: productId,
        product_name_snapshot: l.product_name_snapshot as string,
        quantity: displayQty,
        unit_label: displayUnitLabel,
        unit_price: displayUnitPrice,
        line_total: rawLineTotal,
        created_at: l.created_at as string,
      };
    });

    return {
      id: record.id as string,
      establishment_id: record.establishment_id as string,
      organization_id: record.organization_id as string,
      stock_document_id: record.stock_document_id as string,
      bl_number: record.bl_number as string,
      destination_establishment_id: (record.destination_establishment_id as string | null) ?? null,
      destination_name: (record.destination_name as string | null) ?? null,
      total_amount: (record.total_eur as number | null) ?? null,
      status: "FINAL" as const,
      created_by: (record.created_by as string | null) ?? null,
      created_at: record.created_at as string,
      lines,
      isDraft,
    };
  });
}

export function useBlRetraits(establishmentId: string | null, yearMonth: string | null) {
  return useQuery({
    queryKey: ["bl-retraits", establishmentId, yearMonth],
    queryFn: () => fetchBlRetraits(establishmentId!, yearMonth!),
    enabled: !!establishmentId && !!yearMonth,
  });
}
