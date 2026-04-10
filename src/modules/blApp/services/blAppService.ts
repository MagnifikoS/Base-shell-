/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-APP — Service CRUD (V1)
 * Isolation totale. Aucune dépendance stock/ledger/factures.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type {
  BlAppDocument,
  BlAppLine,
  BlAppFile,
  CreateBlAppPayload,
  CompleteBlAppPayload,
} from "../types";

// ─── CREATE (idempotent: ON CONFLICT stock_document_id) ─────────────────

export async function createBlAppDocument(
  payload: CreateBlAppPayload
): Promise<{ document: BlAppDocument; lines: BlAppLine[] }> {
  // 1. Upsert document (idempotent via UNIQUE stock_document_id)
  const { data: doc, error: docErr } = await supabase
    .from("bl_app_documents")
    .upsert(
      {
        establishment_id: payload.establishment_id,
        stock_document_id: payload.stock_document_id,
        supplier_id: payload.supplier_id,
        supplier_name_snapshot: payload.supplier_name_snapshot,
        bl_date: payload.bl_date,
        created_by: payload.created_by,
        status: "DRAFT",
      },
      { onConflict: "stock_document_id" }
    )
    .select()
    .single();

  if (docErr || !doc) throw docErr ?? new Error("Failed to create bl_app_document");

  // 2. Merge lines by product_id (sum quantities)
  const mergedByProduct = new Map<
    string,
    {
      quantity_canonical: number;
      canonical_unit_id: string;
      context_hash: string | null;
    }
  >();

  for (const l of payload.lines) {
    const existing = mergedByProduct.get(l.product_id);
    if (existing) {
      existing.quantity_canonical += l.quantity_canonical;
    } else {
      mergedByProduct.set(l.product_id, {
        quantity_canonical: l.quantity_canonical,
        canonical_unit_id: l.canonical_unit_id,
        context_hash: l.context_hash,
      });
    }
  }

  // 3. Fetch prices + conditionnement_config for BFS resolution
  const productIds = Array.from(mergedByProduct.keys());
  const { data: products } = await supabase
    .from("products_v2")
    .select("id, nom_produit, final_unit_price, final_unit_id, conditionnement_config")
    .in("id", productIds);

  const productDataMap = new Map(
    (products ?? []).map((p) => [
      p.id,
      {
        name: p.nom_produit as string,
        price: p.final_unit_price,
        priceUnitId: p.final_unit_id as string | null,
        config: p.conditionnement_config as {
          packagingLevels?: PackagingLevel[];
          equivalence?: Equivalence | null;
        } | null,
      },
    ])
  );

  // 3b. Fetch BFS data: all units + conversions for this establishment
  // We need these to resolve canonical→priceUnit factor via findConversionPath
  const [{ data: dbUnitsRaw }, { data: dbConvsRaw }] = await Promise.all([
    supabase
      .from("measurement_units")
      .select("id, name, abbreviation, category, family, is_reference, aliases")
      .eq("establishment_id", payload.establishment_id),
    supabase
      .from("unit_conversions")
      .select("from_unit_id, to_unit_id, factor, is_active")
      .eq("establishment_id", payload.establishment_id)
      .eq("is_active", true),
  ]);

  const dbUnits: UnitWithFamily[] = (dbUnitsRaw ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    abbreviation: u.abbreviation,
    category: u.category ?? "",
    family: u.family ?? null,
    is_reference: u.is_reference,
    aliases: u.aliases ?? [],
  }));

  const dbConversions: ConversionRule[] = (dbConvsRaw ?? []).map((c) => ({
    id: "",
    establishment_id: payload.establishment_id,
    from_unit_id: c.from_unit_id,
    to_unit_id: c.to_unit_id,
    factor: c.factor,
    is_active: c.is_active,
  }));

  // 4. Build lines with frozen prices + BFS-resolved totals
  const linesToUpsert = Array.from(mergedByProduct.entries()).map(([productId, merged]) => {
    const pd = productDataMap.get(productId);
    const price = pd?.price ?? null;
    const priceUnitId = pd?.priceUnitId ?? null;
    const packagingLevels: PackagingLevel[] = pd?.config?.packagingLevels ?? [];
    const equivalence: Equivalence | null = pd?.config?.equivalence ?? null;

    let lineUnitPrice: number | null = null;
    let lineTotal: number | null = null;

    if (price !== null && priceUnitId !== null) {
      if (priceUnitId === merged.canonical_unit_id) {
        // Units match directly — price already in line unit
        lineUnitPrice = price;
        lineTotal = Math.round(merged.quantity_canonical * price * 100) / 100;
      } else {
        // Units differ — resolve factor via BFS (canonical_unit → price_unit)
        // e.g. kg → g: factor = 1000 → convertedPrice = 1000 × 0.0076 €/g = 7.60 €/kg
        const path = findConversionPath(
          merged.canonical_unit_id,
          priceUnitId,
          dbUnits,
          dbConversions,
          packagingLevels,
          equivalence
        );
        if (path.reached && path.factor !== null) {
          // Convert price FROM price-unit TO line-unit:
          // factor = how many price-units per line-unit (e.g. 1000 g/kg)
          // pricePerLineUnit = factor × pricePerPriceUnit
          lineUnitPrice = path.factor * price;
          lineTotal = Math.round(merged.quantity_canonical * lineUnitPrice * 100) / 100;
        }
        // If BFS fails → both stay null (Non calculable — truly missing config)
      }
    }

    return {
      establishment_id: payload.establishment_id,
      bl_app_document_id: doc.id,
      product_id: productId,
      product_name_snapshot: pd?.name ?? null,
      quantity_canonical: merged.quantity_canonical,
      canonical_unit_id: merged.canonical_unit_id,
      context_hash: merged.context_hash,
      unit_price: lineUnitPrice, // ← SNAPSHOT: price converted to line unit (canonical_unit_id)
      line_total: lineTotal,     // ← SNAPSHOT: qty × unit_price, null only if truly impossible
    };
  });

  const { data: lines, error: linesErr } = await supabase
    .from("bl_app_lines")
    .upsert(linesToUpsert, { onConflict: "bl_app_document_id,product_id" })
    .select();

  if (linesErr) throw linesErr;

  return {
    document: doc as unknown as BlAppDocument,
    lines: (lines ?? []) as unknown as BlAppLine[],
  };
}

// ─── COMPLETE (popup "Enregistrer") ─────────────────────────────────────

export async function completeBlAppDocument(
  documentId: string,
  payload: CompleteBlAppPayload
): Promise<BlAppDocument> {
  const { data, error } = await supabase
    .from("bl_app_documents")
    .update({
      bl_number: payload.bl_number,
      status: payload.status,
      completed_at: payload.completed_at,
    })
    .eq("id", documentId)
    .select()
    .single();

  if (error || !data) throw error ?? new Error("Failed to complete bl_app_document");
  return data as unknown as BlAppDocument;
}

// ─── READ ───────────────────────────────────────────────────────────────

export async function fetchBlAppByStockDocumentId(
  stockDocumentId: string
): Promise<BlAppDocument | null> {
  const { data, error } = await supabase
    .from("bl_app_documents")
    .select(
      "id, establishment_id, stock_document_id, supplier_id, supplier_name_snapshot, bl_number, bl_date, status, created_by, created_at, updated_at, completed_at"
    )
    .eq("stock_document_id", stockDocumentId)
    .neq("status", "VOIDED")
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as BlAppDocument) ?? null;
}

export async function fetchBlAppDocumentsByMonth(
  establishmentId: string,
  yearMonth: string, // "YYYY-MM"
  supplierId?: string
): Promise<BlAppDocument[]> {
  const startDate = `${yearMonth}-01`;
  // End of month: go to next month
  const [y, m] = yearMonth.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  let query = supabase
    .from("bl_app_documents")
    .select("*, bl_app_files(id)")
    .eq("establishment_id", establishmentId)
    // Filter out voided BL — annulés ne s'affichent plus dans la liste
    .neq("status", "VOIDED")
    .gte("bl_date", startDate)
    .lt("bl_date", nextMonth)
    .order("bl_date", { ascending: false });

  if (supplierId) {
    query = query.eq("supplier_id", supplierId);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Enrich with has_files flag
  const docs = (data ?? []).map((d) => {
    const row = d as unknown as Record<string, unknown>;
    const files = row.bl_app_files;
    return {
      ...d,
      has_files: Array.isArray(files) && files.length > 0,
      created_by_name: null,
      bl_app_files: undefined, // strip join data
    } as unknown as BlAppDocument;
  });

  // Resolve created_by → display name via profiles
  const userIds = [...new Set(docs.map((d) => d.created_by).filter(Boolean))] as string[];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);

    const nameMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p.full_name ?? null])
    );

    for (const doc of docs) {
      if (doc.created_by) {
        doc.created_by_name = nameMap.get(doc.created_by) ?? null;
      }
    }
  }

  return docs;
}

export async function fetchBlAppLines(blAppDocumentId: string): Promise<BlAppLine[]> {
  const { data, error } = await supabase
    .from("bl_app_lines")
    .select(
      "id, establishment_id, bl_app_document_id, product_id, quantity_canonical, canonical_unit_id, context_hash, unit_price, line_total, created_at"
    )
    .eq("bl_app_document_id", blAppDocumentId);

  if (error) throw error;
  return (data ?? []) as unknown as BlAppLine[];
}

export async function fetchBlAppFiles(blAppDocumentId: string): Promise<BlAppFile[]> {
  const { data, error } = await supabase
    .from("bl_app_files")
    .select(
      "id, establishment_id, bl_app_document_id, storage_path, mime_type, original_name, created_at"
    )
    .eq("bl_app_document_id", blAppDocumentId);

  if (error) throw error;
  return (data ?? []) as unknown as BlAppFile[];
}

// ─── FILE UPLOAD ────────────────────────────────────────────────────────

export async function uploadBlAppFile(
  establishmentId: string,
  blAppDocumentId: string,
  file: File
): Promise<BlAppFile> {
  const ext = file.name.split(".").pop() ?? "bin";
  const storagePath = `establishments/${establishmentId}/bl_app/${blAppDocumentId}/${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("bl_app")
    .upload(storagePath, file, { contentType: file.type });

  if (uploadErr) throw uploadErr;

  const { data, error: insertErr } = await supabase
    .from("bl_app_files")
    .insert({
      establishment_id: establishmentId,
      bl_app_document_id: blAppDocumentId,
      storage_path: storagePath,
      mime_type: file.type || null,
      original_name: file.name || null,
    })
    .select()
    .single();

  if (insertErr || !data) throw insertErr ?? new Error("Failed to insert bl_app_file");
  return data as unknown as BlAppFile;
}

export function getBlAppFileUrl(storagePath: string): string {
  const { data } = supabase.storage.from("bl_app").getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function getBlAppFileSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("bl_app")
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) throw error ?? new Error("Failed to create signed URL");
  return data.signedUrl;
}

// ─── SOFT DELETE (void) ──────────────────────────────────────────────────

export async function voidBlAppDocument(
  documentId: string,
  _voidReason: string
): Promise<BlAppDocument> {
  // La colonne voided_at n'existe pas encore en schéma prod — on supprime le document directement
  // (le stock est déjà annulé dans le ledger via fn_void_stock_document)
  const { error } = await supabase
    .from("bl_app_documents")
    .delete()
    .eq("id", documentId);

  if (error) throw error;
  // Return a minimal stub — caller only checks ok/error
  return { id: documentId } as unknown as BlAppDocument;
}

// ─── HARD DELETE — REMOVED ─────────────────────────────────────────────
// Hard delete was removed per SEC-DATA-031 (unify deletion patterns).
// BL-APP documents MUST use soft-delete via voidBlAppDocument().
// @see docs/data-deletion-policy.md
// @see supabase/migrations/20260217120000_bl_app_soft_delete.sql

/**
 * @deprecated — prefer voidBlAppDocument() for audit trail. This now delegates to soft-delete.
 */
export async function deleteBlAppDocument(
  documentId: string,
  reason = "Suppression demandée par l'utilisateur"
): Promise<void> {
  await voidBlAppDocument(documentId, reason);
}
