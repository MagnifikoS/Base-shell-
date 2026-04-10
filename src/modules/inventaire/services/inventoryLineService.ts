/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Line Service
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type { InventoryLineWithProduct } from "../types";
import type { ConditioningConfig } from "@/modules/produitsV2";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase join shape (typed instead of `as any`)
// ─────────────────────────────────────────────────────────────────────────────

interface ProductJoin {
  nom_produit: string;
  code_produit: string | null;
  archived_at: string | null;
  stock_handling_unit_id: string | null;
  final_unit_id: string | null;
  delivery_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  conditionnement_config: ConditioningConfig | null;
  product_categories: { name: string } | null;
}

interface UnitJoin {
  name: string;
  abbreviation: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH all lines for a session (with product + unit info)
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchInventoryLines(sessionId: string): Promise<InventoryLineWithProduct[]> {
  const { data, error } = await supabase
    .from("inventory_lines")
    .select(
      `
      id,
      session_id,
      product_id,
      quantity,
      unit_id,
      counted_at,
      counted_by,
      display_order,
      created_at,
      updated_at,
      products_v2!inner (
        nom_produit,
        code_produit,
        archived_at,
        stock_handling_unit_id,
        final_unit_id,
        delivery_unit_id,
        supplier_billing_unit_id,
        conditionnement_config,
        product_categories ( name )
      ),
      measurement_units (
        name,
        abbreviation
      )
    `
    )
    .eq("session_id", sessionId)
    .order("display_order", { ascending: true });

  if (error) {
    if (import.meta.env.DEV) console.error("[Inventaire] Lines fetch error:", error);
    throw error;
  }

  // Filter out archived products — keeps mobile & desktop in sync
  const activeRows = (data ?? []).filter((row) => {
    const product = row.products_v2 as unknown as ProductJoin;
    return !product.archived_at;
  });

  return activeRows.map((row) => {
    const product = row.products_v2 as unknown as ProductJoin;
    const unit = row.measurement_units as unknown as UnitJoin | null;

    return {
      id: row.id,
      session_id: row.session_id,
      product_id: row.product_id,
      quantity: row.quantity,
      unit_id: row.unit_id,
      counted_at: row.counted_at,
      counted_by: row.counted_by,
      display_order: row.display_order,
      created_at: row.created_at,
      updated_at: row.updated_at,
      product_name: product.nom_produit,
      product_category: product.product_categories?.name ?? null,
      product_code: product.code_produit,
      product_stock_handling_unit_id: product.stock_handling_unit_id ?? null,
      product_final_unit_id: product.final_unit_id ?? null,
      product_delivery_unit_id: product.delivery_unit_id ?? null,
      product_supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
      product_conditionnement_config: product.conditionnement_config ?? null,
      unit_name: unit?.name ?? null,
      unit_abbreviation: unit?.abbreviation ?? null,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNT a product (update quantity + unit)
// ═══════════════════════════════════════════════════════════════════════════

export async function countProduct(params: {
  lineId: string;
  sessionId: string;
  quantity: number;
  unitId: string | null;
  userId: string;
}): Promise<void> {
  const wasPreviouslyUncounted = await checkIfUncounted(params.lineId);

  // Update the line
  const { error } = await supabase
    .from("inventory_lines")
    .update({
      quantity: params.quantity,
      unit_id: params.unitId,
      counted_at: new Date().toISOString(),
      counted_by: params.userId,
    })
    .eq("id", params.lineId);

  if (error) throw error;

  // P1-2: Atomic increment via RPC (now guaranteed to exist)
  if (wasPreviouslyUncounted) {
    const { error: rpcError } = await supabase.rpc(
      "increment_counted_products" as never,
      {
        p_session_id: params.sessionId,
      } as never
    );

    if (rpcError && import.meta.env.DEV) {
      console.error("[InventoryLine] increment_counted_products RPC failed:", rpcError);
    }
  }
}

async function checkIfUncounted(lineId: string): Promise<boolean> {
  const { data } = await supabase
    .from("inventory_lines")
    .select("counted_at")
    .eq("id", lineId)
    .single();

  return data?.counted_at === null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE quantity (post-completion edit)
// ═══════════════════════════════════════════════════════════════════════════

export async function updateLineQuantity(
  lineId: string,
  quantity: number,
  unitId: string | null
): Promise<void> {
  // ── P0-3: Detect 0 row updated ──
  const { data, error } = await supabase
    .from("inventory_lines")
    .update({ quantity, unit_id: unitId })
    .eq("id", lineId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("NO_ROW_UPDATED");
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE line (for retro-active addition to completed session)
// ═══════════════════════════════════════════════════════════════════════════

export async function createInventoryLine(params: {
  sessionId: string;
  productId: string;
  quantity: number;
  unitId: string | null;
}): Promise<void> {
  // RISK-02 FIX: Guard — product must have zone + stock_handling_unit before creating a line
  const { data: product, error: prodErr } = await supabase
    .from("products_v2")
    .select("storage_zone_id, stock_handling_unit_id")
    .eq("id", params.productId)
    .single();

  if (prodErr) throw prodErr;

  if (!product?.storage_zone_id || !product?.stock_handling_unit_id) {
    throw new Error(
      "PRODUCT_NOT_ELIGIBLE: Ce produit n'est pas éligible à l'inventaire. " +
      "Veuillez configurer sa zone de stockage et son unité de gestion stock via le Wizard."
    );
  }

  const { error } = await supabase.from("inventory_lines").insert({
    session_id: params.sessionId,
    product_id: params.productId,
    quantity: params.quantity,
    unit_id: params.unitId,
    counted_at: new Date().toISOString(),
  });

  if (error) throw error;
}
