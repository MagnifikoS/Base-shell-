/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-RETRAIT — Service CRUD
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { BlRetraitDocument, BlRetraitLine, CreateBlRetraitPayload } from "../types";

// ── Shared select with FK joins for names ──
const BL_DOC_SELECT = `
  id, establishment_id, organization_id, stock_document_id,
  destination_establishment_id, destination_name, bl_number, bl_date, total_eur,
  created_by, created_at,
  dest_est:establishments!bl_withdrawal_documents_destination_establishment_id_fkey(name),
  source_est:establishments!bl_withdrawal_documents_establishment_id_fkey(name)
`;

/** Normalize raw row from FK join → BlRetraitDocument */
function normalizeDoc(
  raw: Record<string, unknown>,
  currentEstId: string
): BlRetraitDocument {
  const destJoin = raw.dest_est as { name: string } | null;
  const srcJoin = raw.source_est as { name: string } | null;
  const stockDocJoin = raw.stock_doc as { status: string } | null;
  const direction = raw.establishment_id === currentEstId ? "sent" : "received";
  return {
    id: raw.id as string,
    establishment_id: raw.establishment_id as string,
    organization_id: raw.organization_id as string,
    stock_document_id: raw.stock_document_id as string,
    destination_establishment_id: raw.destination_establishment_id as string,
    bl_number: raw.bl_number as string,
    bl_date: raw.bl_date as string,
    total_eur: raw.total_eur as number,
    created_by: raw.created_by as string | null,
    created_at: raw.created_at as string,
    created_by_name: null, // resolved later in fetchBlRetraitDocumentsByMonth
    source_name: srcJoin?.name ?? null,
    destination_name: destJoin?.name ?? (raw.destination_name as string | null) ?? null,
    direction,
    stock_status: (stockDocJoin?.status as BlRetraitDocument["stock_status"]) ?? "POSTED",
  };
}

/**
 * Create a BL Retrait document + lines with frozen prices.
 * Fetches lines from stock_document_lines and prices from products_v2.
 */
export async function createBlRetraitDocument(
  payload: CreateBlRetraitPayload
): Promise<{ document: BlRetraitDocument; lines: BlRetraitLine[] }> {
  // 1. Fetch stock_document_lines for this withdrawal
  const { data: stockLines, error: linesErr } = await supabase
    .from("stock_document_lines")
    .select("product_id, delta_quantity_canonical, canonical_unit_id, input_payload")
    .eq("document_id", payload.stock_document_id);
  if (linesErr) throw linesErr;
  if (!stockLines || stockLines.length === 0) throw new Error("Aucune ligne trouvée");

  // 2. Fetch product prices + names + packaging config
  const productIds = [...new Set(stockLines.map((l) => l.product_id))];
  const { data: products, error: prodErr } = await supabase
    .from("products_v2")
    .select("id, nom_produit, final_unit_price, final_unit_id, conditionnement_config")
    .in("id", productIds);
  if (prodErr) throw prodErr;

  const productMap = new Map(
    (products ?? []).map((p) => [p.id, p])
  );

  // 2b. Fetch DB units & conversions for BFS (establishment-scoped)
  const { data: dbUnitsRaw } = await supabase
    .from("measurement_units")
    .select("id, name, abbreviation, category, family, is_reference, aliases")
    .eq("establishment_id", payload.establishment_id)
    .eq("is_active", true);
  const dbUnits: UnitWithFamily[] = (dbUnitsRaw ?? []) as UnitWithFamily[];

  const { data: dbConvRaw } = await supabase
    .from("unit_conversions")
    .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
    .eq("establishment_id", payload.establishment_id)
    .eq("is_active", true);
  const dbConversions: ConversionRule[] = (dbConvRaw ?? []).map((r) => ({
    ...r,
    factor: Number(r.factor),
  })) as ConversionRule[];

  // 3. Build lines with frozen prices — use BFS when units differ
  let totalEur = 0;
  const lineRows = stockLines.map((sl) => {
    const product = productMap.get(sl.product_id);
    const qty = Math.abs(sl.delta_quantity_canonical);
    const price = product?.final_unit_price ?? null;

    let lineTotal: number | null = null;

    if (price !== null && price > 0 && product?.final_unit_id) {
      if (product.final_unit_id === sl.canonical_unit_id) {
        // Units match — direct multiplication
        lineTotal = Math.round(qty * price * 100) / 100;
      } else {
        // Units differ — use BFS conversion
        const config = product.conditionnement_config as Record<string, unknown> | null;
        const packagingLevels: PackagingLevel[] =
          (config?.packagingLevels as PackagingLevel[]) ?? [];
        const equivalence: Equivalence | null =
          (config?.equivalence as Equivalence | null) ?? null;

        const path = findConversionPath(
          sl.canonical_unit_id,
          product.final_unit_id,
          dbUnits,
          dbConversions,
          packagingLevels,
          equivalence
        );

        if (path.reached && path.factor !== null) {
          lineTotal = Math.round(qty * path.factor * price * 100) / 100;
        }
        // If no path found, lineTotal stays null (acceptable — logged as missing)
      }
    }

    if (lineTotal !== null) totalEur += lineTotal;

    return {
      product_id: sl.product_id,
      product_name_snapshot: product?.nom_produit ?? (sl.input_payload as any)?.product_name ?? sl.product_id,
      quantity_canonical: qty,
      canonical_unit_id: sl.canonical_unit_id,
      unit_price_snapshot: price,
      line_total_snapshot: lineTotal,
    };
  });

  totalEur = Math.round(totalEur * 100) / 100;

  // 4. Insert document
  const { data: doc, error: docErr } = await supabase
    .from("bl_withdrawal_documents")
    .upsert(
      {
        establishment_id: payload.establishment_id,
        organization_id: payload.organization_id,
        stock_document_id: payload.stock_document_id,
        destination_establishment_id: payload.destination_establishment_id,
        bl_number: payload.bl_number,
        bl_date: payload.bl_date,
        total_eur: totalEur,
        created_by: payload.created_by,
      },
      { onConflict: "stock_document_id" }
    )
    .select()
    .single();
  if (docErr || !doc) throw docErr ?? new Error("Failed to create bl_withdrawal_document");

  // 5. Insert lines
  const { data: insertedLines, error: insertErr } = await supabase
    .from("bl_withdrawal_lines")
    .insert(
      lineRows.map((l) => ({
        bl_withdrawal_document_id: doc.id,
        ...l,
      }))
    )
    .select();
  if (insertErr) throw insertErr;

  return {
    document: {
      ...(doc as unknown as Omit<BlRetraitDocument, "source_name" | "destination_name" | "direction" | "created_by_name" | "stock_status">),
      source_name: null,
      destination_name: null,
      direction: "sent",
      created_by_name: null,
      stock_status: "POSTED",
    },
    lines: (insertedLines ?? []) as unknown as BlRetraitLine[],
  };
}

/**
 * Fetch BL Retrait documents for a given month + establishment.
 * Returns BOTH sent (establishment_id) and received (destination_establishment_id).
 * Resolves partner names via FK join, with fallback to destination_name column,
 * and ultimate fallback to a direct establishments lookup when RLS blocks FK joins.
 */
export async function fetchBlRetraitDocumentsByMonth(
  establishmentId: string,
  yearMonth: string
): Promise<BlRetraitDocument[]> {
  const startDate = `${yearMonth}-01`;
  const [y, m] = yearMonth.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  // Fetch sent BLs — exclude DRAFT stock_documents (pending validation)
  const sentPromise = supabase
    .from("bl_withdrawal_documents")
    .select(`${BL_DOC_SELECT}, stock_doc:stock_documents!bl_withdrawal_documents_stock_document_id_fkey(status)`)
    .eq("establishment_id", establishmentId)
    .gte("bl_date", startDate)
    .lt("bl_date", nextMonth)
    .order("bl_date", { ascending: false });

  // Fetch received BLs (where this establishment is the destination) — exclude DRAFTs
  const receivedPromise = supabase
    .from("bl_withdrawal_documents")
    .select(`${BL_DOC_SELECT}, stock_doc:stock_documents!bl_withdrawal_documents_stock_document_id_fkey(status)`)
    .eq("destination_establishment_id", establishmentId)
    .gte("bl_date", startDate)
    .lt("bl_date", nextMonth)
    .order("bl_date", { ascending: false });

  const [sentRes, receivedRes] = await Promise.all([sentPromise, receivedPromise]);
  if (sentRes.error) throw sentRes.error;
  if (receivedRes.error) throw receivedRes.error;

  // Include all BLs (DRAFT = in transit, POSTED = validated)
  const sentDocs = (sentRes.data as unknown as Record<string, unknown>[]).map((r) => normalizeDoc(r, establishmentId));
  const receivedDocs = (receivedRes.data as unknown as Record<string, unknown>[]).map((r) => normalizeDoc(r, establishmentId));

  // Deduplicate (in case an est sends to itself)
  const seen = new Set<string>();
  const all: BlRetraitDocument[] = [];
  for (const doc of [...sentDocs, ...receivedDocs]) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      all.push(doc);
    }
  }

  const missingDestIds = all
    .filter((d) => d.direction === "sent" && !d.destination_name && d.destination_establishment_id)
    .map((d) => d.destination_establishment_id);
  const missingSrcIds = all
    .filter((d) => d.direction === "received" && !d.source_name && d.establishment_id)
    .map((d) => d.establishment_id);
  const allMissingIds = [...new Set([...missingDestIds, ...missingSrcIds])];

  if (allMissingIds.length > 0) {
    const { data: estNames } = await supabase
      .from("establishments")
      .select("id, name")
      .in("id", allMissingIds);
    if (estNames && estNames.length > 0) {
      const nameMap = new Map(estNames.map((e) => [e.id, e.name]));
      for (const doc of all) {
        if (doc.direction === "sent" && !doc.destination_name) {
          doc.destination_name = nameMap.get(doc.destination_establishment_id) ?? null;
        }
        if (doc.direction === "received" && !doc.source_name) {
          doc.source_name = nameMap.get(doc.establishment_id) ?? null;
        }
      }
    }
  }

  // ── Resolve creator names from profiles ──
  const creatorIds = [...new Set(all.map((d) => d.created_by).filter(Boolean))] as string[];
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", creatorIds);
    if (profiles && profiles.length > 0) {
      const nameMap = new Map(profiles.map((p) => [p.user_id, p.full_name]));
      for (const doc of all) {
        if (doc.created_by) {
          doc.created_by_name = nameMap.get(doc.created_by) ?? null;
        }
      }
    }
  }

  // Sort by date descending
  all.sort((a, b) => b.bl_date.localeCompare(a.bl_date));
  return all;
}

/**
 * Fetch lines for a BL Retrait document.
 */
export async function fetchBlRetraitLines(
  blRetraitDocumentId: string
): Promise<BlRetraitLine[]> {
  const { data, error } = await supabase
    .from("bl_withdrawal_lines")
    .select("*")
    .eq("bl_withdrawal_document_id", blRetraitDocumentId);

  if (error) throw error;
  return (data ?? []) as unknown as BlRetraitLine[];
}

/**
 * Generate next BL number for an establishment.
 */
export async function generateBlRetraitNumber(
  establishmentId: string
): Promise<string> {
  const { data, error } = await supabase.rpc(
    "fn_next_bl_withdrawal_number" as never,
    { p_establishment_id: establishmentId } as never
  );
  if (error) throw error;
  return data as string;
}
