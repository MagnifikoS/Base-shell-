/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Service Layer (ISOLATED from V1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All DB interactions for products_v2 table.
 * Exposes createOrUpdateProductV2 for V3 wizard integration.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MIGRATION supplier_id (2026-02-09)
 * ═══════════════════════════════════════════════════════════════════════════
 * - supplier_id = SSOT unique pour l'attribution fournisseur
 * - supplier_name = DEPRECATED (lecture seule, aucune écriture)
 * - Nom fournisseur affiché via jointure invoice_suppliers
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  ProductV2,
  ProductV2ListItem,
  CreateProductV2Payload,
  UpdateProductV2Payload,
  CollisionCheckResult,
  ConditioningConfig,
  SupplierInfo,
} from "../types";
import { normalizeProductNameV2 } from "../utils/normalizeProductName";

// ═══════════════════════════════════════════════════════════════════════════
// LIST (lightweight query for table) — JOINTURE supplier
// ═══════════════════════════════════════════════════════════════════════════

/** Explicit limit — aligned with PostgREST default (P0-2: was 500, raised to 1000) */
const PRODUCT_LIST_LIMIT = 1000;

export async function fetchProductsV2List(establishmentId: string): Promise<ProductV2ListItem[]> {
  const { data, error } = await supabase
    .from("products_v2")
    .select(
      `
      id,
      code_produit,
      nom_produit,
      nom_produit_fr,
      final_unit_price,
      price_display_unit_id,
      category,
      category_id,
      code_barres,
      supplier_id,
      conditionnement_resume,
      conditionnement_config,
      storage_zone_id,
      stock_handling_unit_id,
      final_unit_id,
      supplier_billing_unit_id,
      delivery_unit_id,
      invoice_suppliers!inner (
        id,
        name
      ),
      storage_zones (
        id,
        name
      ),
      product_categories (
        id,
        name
      ),
      stock_handling_unit:measurement_units!products_v2_stock_handling_unit_id_fkey (
        id,
        name
      ),
      product_input_config (
        reception_preferred_unit_id,
        internal_preferred_unit_id
      )
    `
    )
    .eq("establishment_id", establishmentId)
    .is("archived_at", null)
    .order("nom_produit", { ascending: true })
    .limit(PRODUCT_LIST_LIMIT);

  if (error) {
    if (import.meta.env.DEV) console.error("[ProductsV2] List fetch error:", error);
    throw error;
  }

  const rows = data ?? [];

  // P1 anti-truncation guard: warn if we hit the limit (silent data loss risk)
  if (rows.length === PRODUCT_LIST_LIMIT) {
    console.warn(
      `[ProductsV2] ⚠️ fetchProductsV2List returned exactly ${PRODUCT_LIST_LIMIT} rows — possible silent truncation. Consider pagination.`
    );
  }

  return rows.map((row) => ({
    id: row.id,
    code_produit: row.code_produit,
    nom_produit: row.nom_produit,
    nom_produit_fr: row.nom_produit_fr,
    final_unit_price: row.final_unit_price,
    category: row.category,
    category_id: row.category_id,
    category_name: (row.product_categories as { name: string } | null)?.name ?? null,
    code_barres: row.code_barres,
    supplier_id: row.supplier_id,
    supplier_display_name: (row.invoice_suppliers as { name: string })?.name ?? "— Inconnu —",
    conditionnement_resume: row.conditionnement_resume,
    conditionnement_config: (row.conditionnement_config as unknown as ConditioningConfig) ?? null,
    stock_handling_unit_id: row.stock_handling_unit_id,
    stock_handling_unit_name: (row.stock_handling_unit as { name: string } | null)?.name ?? null,
    storage_zone_id: row.storage_zone_id,
    storage_zone_name: (row.storage_zones as { name: string } | null)?.name ?? null,
    final_unit_id: row.final_unit_id,
    supplier_billing_unit_id: row.supplier_billing_unit_id,
    delivery_unit_id: row.delivery_unit_id,
    price_display_unit_id: row.price_display_unit_id ?? null,
    has_input_config: (() => {
      const configs = row.product_input_config as Array<{ reception_preferred_unit_id: string | null; internal_preferred_unit_id: string | null }> | null;
      const cfg = configs?.[0];
      return !!(cfg?.reception_preferred_unit_id && cfg?.internal_preferred_unit_id);
    })(),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// GET BY ID (full details)
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchProductV2ById(id: string): Promise<ProductV2 | null> {
  const { data, error } = await supabase
    .from("products_v2")
    .select(
      "id, establishment_id, code_produit, code_barres, nom_produit, nom_produit_fr, name_normalized, variant_format, category, category_id, supplier_id, supplier_billing_unit_id, storage_zone_id, conditionnement_config, conditionnement_resume, final_unit_price, final_unit_id, stock_handling_unit_id, kitchen_unit_id, delivery_unit_id, price_display_unit_id, min_stock_quantity_canonical, min_stock_unit_id, min_stock_updated_at, min_stock_updated_by, info_produit, dlc_warning_days, supplier_billing_quantity, supplier_billing_line_total, allow_unit_sale, created_at, updated_at, archived_at, created_by"
    )
    .eq("id", id)
    .is("archived_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // Not found
    if (import.meta.env.DEV) console.error("[ProductsV2] Fetch by ID error:", error);
    throw error;
  }

  if (!data) return null;

  // Transform DB row to typed ProductV2
  return transformDbRowToProductV2(data);
}

// Helper to transform DB row with Json type to typed ProductV2
function transformDbRowToProductV2(row: Record<string, unknown>): ProductV2 {
  return {
    id: row.id as string,
    establishment_id: row.establishment_id as string,
    code_produit: row.code_produit as string | null,
    code_barres: row.code_barres as string | null,
    nom_produit: row.nom_produit as string,
    nom_produit_fr: row.nom_produit_fr as string | null,
    name_normalized: row.name_normalized as string,
    variant_format: row.variant_format as string | null,
    category: row.category as string | null,
    category_id: row.category_id as string | null,
    supplier_id: row.supplier_id as string,
    supplier_billing_unit_id: row.supplier_billing_unit_id as string | null,
    storage_zone_id: row.storage_zone_id as string | null,
    conditionnement_config: row.conditionnement_config
      ? ((typeof row.conditionnement_config === "string"
          ? JSON.parse(row.conditionnement_config)
          : row.conditionnement_config) as ConditioningConfig)
      : null,
    conditionnement_resume: row.conditionnement_resume as string | null,
    final_unit_price: row.final_unit_price as number | null,
    final_unit_id: row.final_unit_id as string | null,
    stock_handling_unit_id: row.stock_handling_unit_id as string | null,
    kitchen_unit_id: row.kitchen_unit_id as string | null,
    delivery_unit_id: row.delivery_unit_id as string | null,
    price_display_unit_id: row.price_display_unit_id as string | null,
    min_stock_quantity_canonical: row.min_stock_quantity_canonical as number | null,
    min_stock_unit_id: row.min_stock_unit_id as string | null,
    min_stock_updated_at: row.min_stock_updated_at as string | null,
    min_stock_updated_by: row.min_stock_updated_by as string | null,
    info_produit: row.info_produit as string | null,
    dlc_warning_days: (row.dlc_warning_days as number | null) ?? null,
    supplier_billing_quantity: (row.supplier_billing_quantity as number | null) ?? null,
    supplier_billing_line_total: (row.supplier_billing_line_total as number | null) ?? null,
    allow_unit_sale: row.allow_unit_sale === true,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    archived_at: row.archived_at as string | null,
    created_by: row.created_by as string | null,
    
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLISION CHECK (before insert/update)
// ═══════════════════════════════════════════════════════════════════════════

export async function checkProductV2Collision(
  establishmentId: string,
  payload: { code_barres?: string; code_produit?: string; nom_produit: string },
  excludeId?: string
): Promise<CollisionCheckResult> {
  // 1. Check barcode collision
  if (payload.code_barres?.trim()) {
    const { data: barcodeMatch } = await supabase
      .from("products_v2")
      .select("id, nom_produit")
      .eq("establishment_id", establishmentId)
      .eq("code_barres", payload.code_barres.trim())
      .is("archived_at", null)
      .maybeSingle();

    if (barcodeMatch && barcodeMatch.id !== excludeId) {
      return {
        hasCollision: true,
        collisionType: "barcode",
        existingProductId: barcodeMatch.id,
        existingProductName: barcodeMatch.nom_produit,
      };
    }
  }

  // 2. Check code_produit collision
  if (payload.code_produit?.trim()) {
    const { data: codeMatch } = await supabase
      .from("products_v2")
      .select("id, nom_produit")
      .eq("establishment_id", establishmentId)
      .eq("code_produit", payload.code_produit.trim())
      .is("archived_at", null)
      .maybeSingle();

    if (codeMatch && codeMatch.id !== excludeId) {
      return {
        hasCollision: true,
        collisionType: "code_produit",
        existingProductId: codeMatch.id,
        existingProductName: codeMatch.nom_produit,
      };
    }
  }

  // 3. Check name collision
  const nameNormalized = normalizeProductNameV2(payload.nom_produit);
  const { data: nameMatch } = await supabase
    .from("products_v2")
    .select("id, nom_produit")
    .eq("establishment_id", establishmentId)
    .eq("name_normalized", nameNormalized)
    .is("archived_at", null)
    .maybeSingle();

  if (nameMatch && nameMatch.id !== excludeId) {
    return {
      hasCollision: true,
      collisionType: "name",
      existingProductId: nameMatch.id,
      existingProductName: nameMatch.nom_produit,
    };
  }

  return {
    hasCollision: false,
    collisionType: null,
    existingProductId: null,
    existingProductName: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE — supplier_id OBLIGATOIRE, supplier_name INTERDIT en écriture
// ═══════════════════════════════════════════════════════════════════════════

export async function createProductV2(payload: CreateProductV2Payload): Promise<ProductV2> {
  // Build insert payload WITHOUT supplier_name (deprecated)
  const insertPayload = {
    establishment_id: payload.establishment_id,
    name_normalized: payload.name_normalized,
    nom_produit: payload.nom_produit.toUpperCase(),
    code_produit: payload.code_produit ?? null,
    code_barres: payload.code_barres ?? null,
    nom_produit_fr: payload.nom_produit_fr ?? null,
    variant_format: payload.variant_format ?? null,
    // category text intentionally omitted — SSOT is category_id
    category_id: payload.category_id ?? null,
    supplier_id: payload.supplier_id,
    // SSOT: UUID only — no text writes for supplier_billing_unit
    supplier_billing_unit_id: payload.supplier_billing_unit_id ?? null,
    storage_zone_id: payload.storage_zone_id ?? null,
    conditionnement_config: (payload.conditionnement_config ?? null) as never,
    conditionnement_resume: payload.conditionnement_resume ?? null,
    final_unit_price: payload.final_unit_price ?? null,
    // SSOT: UUID only — no text writes for final_unit
    final_unit_id: payload.final_unit_id ?? null,
    stock_handling_unit_id: payload.stock_handling_unit_id ?? null,
    kitchen_unit_id: payload.kitchen_unit_id ?? null,
    delivery_unit_id: payload.delivery_unit_id ?? null,
    price_display_unit_id: payload.price_display_unit_id ?? null,
    info_produit: payload.info_produit ?? null,
    min_stock_quantity_canonical: payload.min_stock_quantity_canonical ?? null,
    min_stock_unit_id: payload.min_stock_unit_id ?? null,
    supplier_billing_quantity: payload.supplier_billing_quantity ?? null,
    supplier_billing_line_total: payload.supplier_billing_line_total ?? null,
    allow_unit_sale: payload.allow_unit_sale ?? false,
    dlc_warning_days: payload.dlc_warning_days ?? null,
    created_by: payload.created_by ?? null,
    
  };

  const { data, error } = await supabase
    .from("products_v2")
    .insert(insertPayload as never)
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[ProductsV2] Create error:", error);
    throw error;
  }

  const product = transformDbRowToProductV2(data as Record<string, unknown>);

  // ── SSOT: Auto-initialize stock (bootstrap snapshot + inventory_line) ──
  // Centralized here so ALL creation paths (Wizard, upsert, direct create) benefit.
  // fn_initialize_product_stock is idempotent and handles missing snapshots.
  // Now supports initial quantity for wizard-provided stock.
  if (product.storage_zone_id && product.stock_handling_unit_id && payload.created_by) {
    const initialQty = payload.initial_stock_quantity ?? 0;
    try {
      const { error: initErr } = await supabase.rpc("fn_initialize_product_stock" as never, {
        p_product_id: product.id,
        p_user_id: payload.created_by,
        p_initial_quantity: initialQty,
      } as never);
      if (initErr && import.meta.env.DEV) {
        console.error("[ProductsV2] Stock init error (non-blocking):", initErr);
      }
    } catch (err) {
      // Non-blocking: product is created, stock init is best-effort
      if (import.meta.env.DEV) console.error("[ProductsV2] Stock init error:", err);
    }
  }

  return product;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE — supplier_name JAMAIS écrit
// ═══════════════════════════════════════════════════════════════════════════

export async function updateProductV2(
  id: string,
  payload: UpdateProductV2Payload
): Promise<ProductV2> {
  const updateData: Record<string, unknown> = {};

  // supplier_id — changement autorisé (validé utilisateur)
  if ("supplier_id" in payload && payload.supplier_id !== undefined) {
    updateData.supplier_id = payload.supplier_id;
  }

  // Build update payload — NO supplier_name (deprecated)
  if (payload.code_produit !== undefined) updateData.code_produit = payload.code_produit;
  if (payload.code_barres !== undefined) updateData.code_barres = payload.code_barres;
  if (payload.nom_produit !== undefined) updateData.nom_produit = payload.nom_produit.toUpperCase();
  if (payload.nom_produit_fr !== undefined) updateData.nom_produit_fr = payload.nom_produit_fr;
  if (payload.name_normalized !== undefined) updateData.name_normalized = payload.name_normalized;
  if (payload.variant_format !== undefined) updateData.variant_format = payload.variant_format;
  // category text intentionally skipped — SSOT is category_id
  if (payload.category_id !== undefined) updateData.category_id = payload.category_id;
  // SSOT: UUID only — skip legacy supplier_billing_unit text
  if (payload.supplier_billing_unit_id !== undefined)
    updateData.supplier_billing_unit_id = payload.supplier_billing_unit_id;
  if (payload.storage_zone_id !== undefined) updateData.storage_zone_id = payload.storage_zone_id;
  if (payload.final_unit_price !== undefined)
    updateData.final_unit_price = payload.final_unit_price;
  // SSOT: UUID only — skip legacy final_unit text
  if (payload.final_unit_id !== undefined) updateData.final_unit_id = payload.final_unit_id;
  if (payload.stock_handling_unit_id !== undefined)
    updateData.stock_handling_unit_id = payload.stock_handling_unit_id;
  if (payload.kitchen_unit_id !== undefined) updateData.kitchen_unit_id = payload.kitchen_unit_id;
  if (payload.delivery_unit_id !== undefined)
    updateData.delivery_unit_id = payload.delivery_unit_id;
  if (payload.price_display_unit_id !== undefined)
    updateData.price_display_unit_id = payload.price_display_unit_id;
  if (payload.info_produit !== undefined) updateData.info_produit = payload.info_produit;
  if (payload.min_stock_quantity_canonical !== undefined)
    updateData.min_stock_quantity_canonical = payload.min_stock_quantity_canonical;
  if (payload.min_stock_unit_id !== undefined)
    updateData.min_stock_unit_id = payload.min_stock_unit_id;
  if (payload.supplier_billing_quantity !== undefined)
    updateData.supplier_billing_quantity = payload.supplier_billing_quantity;
  if (payload.supplier_billing_line_total !== undefined)
    updateData.supplier_billing_line_total = payload.supplier_billing_line_total;
  if (payload.allow_unit_sale !== undefined)
    updateData.allow_unit_sale = payload.allow_unit_sale;
  if (payload.dlc_warning_days !== undefined)
    updateData.dlc_warning_days = payload.dlc_warning_days;
  if (payload.conditionnement_resume !== undefined)
    updateData.conditionnement_resume = payload.conditionnement_resume;

  if (payload.conditionnement_config !== undefined) {
    updateData.conditionnement_config = payload.conditionnement_config ?? null;
  }

  // F9 Optimistic lock: if caller provides expected_updated_at, we add an .eq() filter.
  // If another user wrote in between, updated_at won't match → 0 rows updated → PGRST116 error.
  // This is strict: impossible to overwrite a concurrent modification.
  let query = supabase
    .from("products_v2")
    .update(updateData)
    .eq("id", id);

  if (payload.expected_updated_at) {
    query = query.eq("updated_at", payload.expected_updated_at);
  }

  const { data, error } = await query.select().single();

  if (error) {
    // STOCK_UNIT_LOCKED: trigger blocked stock_handling_unit_id change
    if (error.message?.includes("STOCK_UNIT_LOCKED")) {
      throw new Error(
        "STOCK_UNIT_LOCKED: Impossible de modifier l'unité stock : le produit a encore du stock. Passez d'abord le stock à 0 via inventaire."
      );
    }
    // F9: PGRST116 = "0 rows returned" → optimistic lock conflict
    if (error.code === "PGRST116" && payload.expected_updated_at) {
      throw new Error(
        "OPTIMISTIC_LOCK_CONFLICT: Le produit a été modifié par un autre utilisateur. Veuillez rafraîchir et réessayer."
      );
    }
    if (import.meta.env.DEV) console.error("[ProductsV2] Update error:", error);
    throw error;
  }

  return transformDbRowToProductV2(data as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH WIZARD FIELDS — Strict whitelist, zero supplier/identity fields
// ═══════════════════════════════════════════════════════════════════════════
// P1-1: Only conditioning + management fields. supplier_id, category,
// code_produit, storage_zone_id are NEVER touched by the Wizard.

export interface PatchWizardFieldsPayload {
  conditionnement_config?: ConditioningConfig | null;
  conditionnement_resume?: string | null;
  supplier_billing_unit_id?: string | null;
  final_unit_price?: number | null;
  final_unit_id?: string | null;
  delivery_unit_id?: string | null;
  stock_handling_unit_id?: string | null;
  kitchen_unit_id?: string | null;
  price_display_unit_id?: string | null;
  min_stock_quantity_canonical?: number | null;
  min_stock_unit_id?: string | null;
  category?: string | null;
  category_id?: string | null;
  storage_zone_id?: string | null;
}

export async function patchWizardFields(
  productId: string,
  patch: PatchWizardFieldsPayload
): Promise<ProductV2> {
  // DEV guard: if any forbidden key leaks in, throw immediately
  const forbidden = [
    "supplier_id",
    "code_produit",
    "code_barres",
    "nom_produit",
    "name_normalized",
  ];
  for (const key of forbidden) {
    if (key in (patch as Record<string, unknown>)) {
      throw new Error(
        `[patchWizardFields] INTERDIT: "${key}" ne peut pas être modifié par le Wizard`
      );
    }
  }

  const updateData: Record<string, unknown> = {};

  if (patch.conditionnement_config !== undefined) {
    updateData.conditionnement_config = patch.conditionnement_config ?? null;
  }
  if (patch.conditionnement_resume !== undefined)
    updateData.conditionnement_resume = patch.conditionnement_resume;
  if (patch.supplier_billing_unit_id !== undefined)
    updateData.supplier_billing_unit_id = patch.supplier_billing_unit_id;
  if (patch.final_unit_price !== undefined) updateData.final_unit_price = patch.final_unit_price;
  if (patch.final_unit_id !== undefined) updateData.final_unit_id = patch.final_unit_id;
  if (patch.delivery_unit_id !== undefined) updateData.delivery_unit_id = patch.delivery_unit_id;
  if (patch.stock_handling_unit_id !== undefined)
    updateData.stock_handling_unit_id = patch.stock_handling_unit_id;
  if (patch.kitchen_unit_id !== undefined) updateData.kitchen_unit_id = patch.kitchen_unit_id;
  if (patch.price_display_unit_id !== undefined)
    updateData.price_display_unit_id = patch.price_display_unit_id;
  if (patch.min_stock_quantity_canonical !== undefined)
    updateData.min_stock_quantity_canonical = patch.min_stock_quantity_canonical;
  if (patch.min_stock_unit_id !== undefined) updateData.min_stock_unit_id = patch.min_stock_unit_id;
  // category text intentionally skipped — SSOT is category_id
  if (patch.category_id !== undefined) updateData.category_id = patch.category_id;
  if (patch.storage_zone_id !== undefined) updateData.storage_zone_id = patch.storage_zone_id;

  if (Object.keys(updateData).length === 0) {
    throw new Error("[patchWizardFields] Aucun champ à mettre à jour");
  }

  const { data, error } = await supabase
    .from("products_v2")
    .update(updateData)
    .eq("id", productId)
    .select()
    .single();

  if (error) {
    if (error.message?.includes("STOCK_UNIT_LOCKED")) {
      throw new Error(
        "STOCK_UNIT_LOCKED: Impossible de modifier l'unité stock : le produit a encore du stock. Passez d'abord le stock à 0 via inventaire."
      );
    }
    if (import.meta.env.DEV) console.error("[ProductsV2] PatchWizardFields error:", error);
    throw error;
  }

  return transformDbRowToProductV2(data as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════════════
// SOFT DELETE (archive) — sets archived_at, product remains in DB
// ═══════════════════════════════════════════════════════════════════════════

export async function archiveProductV2(id: string): Promise<void> {
  const { error } = await supabase.rpc("fn_archive_product_v2", { p_product_id: id });
  if (error) {
    if (import.meta.env.DEV) console.error("[ProductsV2] Archive error:", error);
    throw new Error("Erreur lors de l'archivage du produit.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent) — removes product + all linked data
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteProductV2Permanently(id: string): Promise<void> {
  const { error } = await supabase.rpc("fn_hard_delete_product_v2", { p_product_id: id });
  if (error) {
    if (import.meta.env.DEV) console.error("[ProductsV2] Hard delete error:", error);
    throw new Error("Impossible de supprimer ce produit : il est utilisé dans des bons de livraison ou commandes.");
  }
}


// _cleanupActiveInventoryLines removed — logic now handled atomically in fn_archive_product_v2 / fn_hard_delete_product_v2

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT — Auto-detect existing product (for V3 wizard integration)
// ═══════════════════════════════════════════════════════════════════════════
// Priority: 1) code_produit match → UPDATE
//           2) name_normalized match → UPDATE
//           3) No match → INSERT
//
// RULE: Only update non-null fields from payload (no destructive overwrite)
// ═══════════════════════════════════════════════════════════════════════════

export interface UpsertProductV2Payload {
  code_produit?: string | null;
  code_barres?: string | null;
  nom_produit: string;
  nom_produit_fr?: string | null;
  variant_format?: string | null;
  category?: string | null;
  category_id?: string | null;
  supplier_id: string;
  // supplier_billing_unit REMOVED — SSOT: supplier_billing_unit_id only
  supplier_billing_unit_id?: string | null;
  conditionnement_config?: ConditioningConfig | null;
  conditionnement_resume?: string | null;
  final_unit_price?: number | null;
  // final_unit REMOVED — SSOT: final_unit_id only
  final_unit_id?: string | null;
  stock_handling_unit_id?: string | null;
  kitchen_unit_id?: string | null;
  delivery_unit_id?: string | null;
  price_display_unit_id?: string | null;
  info_produit?: string | null;
  storage_zone_id?: string | null;
  min_stock_quantity_canonical?: number | null;
  min_stock_unit_id?: string | null;
  initial_stock_quantity?: number | null;
  initial_stock_unit_id?: string | null;
  supplier_billing_quantity?: number | null;
  supplier_billing_line_total?: number | null;
  allow_unit_sale?: boolean;
  dlc_warning_days?: number | null;
  created_by?: string | null;
}

export interface UpsertProductV2Result {
  product: ProductV2;
  wasCreated: boolean;
  matchedBy: "code_produit" | "name_normalized" | null;
}

/**
 * Find existing product by code_produit or name_normalized
 * Returns id, matchedBy, and existing category (for non-destructive update)
 */
async function findExistingProductV2(
  establishmentId: string,
  codeProduit: string | null | undefined,
  nomProduit: string
): Promise<{
  id: string;
  matchedBy: "code_produit" | "name_normalized";
  existingCategoryId: string | null;
} | null> {
  const hasCodeProduit = codeProduit && codeProduit.trim().length > 0;

  // 1. Try code_produit first (highest priority)
  if (hasCodeProduit) {
    const { data: codeMatch } = await supabase
      .from("products_v2")
      .select("id, category_id")
      .eq("establishment_id", establishmentId)
      .eq("code_produit", codeProduit!.trim())
      .is("archived_at", null)
      .maybeSingle();

    if (codeMatch) {
      return {
        id: codeMatch.id,
        matchedBy: "code_produit",
        existingCategoryId: codeMatch.category_id as string | null,
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    // STRICT MODE: code_produit fourni mais pas trouvé → STOP
    // Pas de fallback par nom (aligné sur matchProductV2 engine)
    // Ceci permet de créer un nouveau produit avec un code différent
    // même si un produit avec le même nom existe déjà
    // ═══════════════════════════════════════════════════════════════════
    return null;
  }

  // 2. Try name_normalized — ONLY if NO code_produit was provided
  const nameNormalized = normalizeProductNameV2(nomProduit);
  const { data: nameMatch } = await supabase
    .from("products_v2")
    .select("id, category_id")
    .eq("establishment_id", establishmentId)
    .eq("name_normalized", nameNormalized)
    .is("archived_at", null)
    .maybeSingle();

  if (nameMatch) {
    return {
      id: nameMatch.id,
      matchedBy: "name_normalized",
      existingCategoryId: nameMatch.category_id as string | null,
    };
  }

  return null;
}

/**
 * Upsert product V2 — Auto-detects if UPDATE or INSERT needed
 * Non-destructive: only updates fields that are explicitly provided (non-null)
 */
export async function upsertProductV2(
  establishmentId: string,
  payload: UpsertProductV2Payload
): Promise<UpsertProductV2Result> {
  const nameNormalized = normalizeProductNameV2(payload.nom_produit);

  // ═══════════════════════════════════════════════════════════════════
  // STANDARD PATH: match by code_produit or name
  // ═══════════════════════════════════════════════════════════════════
  const existing = await findExistingProductV2(
    establishmentId,
    payload.code_produit,
    payload.nom_produit
  );

  if (existing) {
    // UPDATE — only update fields that are provided (non-destructive)
    const updatePayload: UpdateProductV2Payload = {
      nom_produit: payload.nom_produit,
      name_normalized: nameNormalized,
    };

    // Only include fields that are explicitly set (not undefined)
    if (payload.code_produit !== undefined)
      updatePayload.code_produit = payload.code_produit ?? null;
    if (payload.code_barres !== undefined) updatePayload.code_barres = payload.code_barres ?? null;
    if (payload.nom_produit_fr !== undefined)
      updatePayload.nom_produit_fr = payload.nom_produit_fr ?? null;
    if (payload.variant_format !== undefined)
      updatePayload.variant_format = payload.variant_format ?? null;

    // CATEGORY: Only update if existing product has no category (by UUID)
    if (payload.category_id !== undefined) {
      const existingHasCategory = !!existing.existingCategoryId;
      if (!existingHasCategory) {
        updatePayload.category_id = payload.category_id ?? null;
      }
    }

    // P0-3 FIX: NEVER overwrite supplier_id on existing products via upsert.
    if (payload.supplier_billing_unit_id !== undefined)
      updatePayload.supplier_billing_unit_id = payload.supplier_billing_unit_id ?? null;
    if (payload.conditionnement_config !== undefined)
      updatePayload.conditionnement_config = payload.conditionnement_config ?? null;
    if (payload.conditionnement_resume !== undefined)
      updatePayload.conditionnement_resume = payload.conditionnement_resume ?? null;
    if (payload.final_unit_price !== undefined)
      updatePayload.final_unit_price = payload.final_unit_price ?? null;
    if (payload.final_unit_id !== undefined)
      updatePayload.final_unit_id = payload.final_unit_id ?? null;
    if (payload.stock_handling_unit_id !== undefined)
      updatePayload.stock_handling_unit_id = payload.stock_handling_unit_id ?? null;
    if (payload.kitchen_unit_id !== undefined)
      updatePayload.kitchen_unit_id = payload.kitchen_unit_id ?? null;
    if (payload.delivery_unit_id !== undefined)
      updatePayload.delivery_unit_id = payload.delivery_unit_id ?? null;
    if (payload.price_display_unit_id !== undefined)
      updatePayload.price_display_unit_id = payload.price_display_unit_id ?? null;
    if (payload.info_produit !== undefined)
      updatePayload.info_produit = payload.info_produit ?? null;
    if (payload.storage_zone_id !== undefined)
      updatePayload.storage_zone_id = payload.storage_zone_id ?? null;
    if (payload.min_stock_quantity_canonical !== undefined)
      updatePayload.min_stock_quantity_canonical = payload.min_stock_quantity_canonical ?? null;
    if (payload.min_stock_unit_id !== undefined)
      updatePayload.min_stock_unit_id = payload.min_stock_unit_id ?? null;
    if (payload.supplier_billing_quantity !== undefined)
      updatePayload.supplier_billing_quantity = payload.supplier_billing_quantity ?? null;
    if (payload.supplier_billing_line_total !== undefined)
      updatePayload.supplier_billing_line_total = payload.supplier_billing_line_total ?? null;
    if (payload.allow_unit_sale !== undefined)
      updatePayload.allow_unit_sale = payload.allow_unit_sale;
    if (payload.dlc_warning_days !== undefined)
      updatePayload.dlc_warning_days = payload.dlc_warning_days;
    // initial_stock_quantity / initial_stock_unit_id: création only,
    // not propagated in update path.

    const product = await updateProductV2(existing.id, updatePayload);
    return {
      product,
      wasCreated: false,
      matchedBy: existing.matchedBy,
    };
  }

  // INSERT — new product
  const product = await createProductV2({
    establishment_id: establishmentId,
    name_normalized: nameNormalized,
    nom_produit: payload.nom_produit,
    code_produit: payload.code_produit ?? null,
    code_barres: payload.code_barres ?? null,
    nom_produit_fr: payload.nom_produit_fr ?? null,
    variant_format: payload.variant_format ?? null,
    category_id: payload.category_id ?? null,
    supplier_id: payload.supplier_id,
    supplier_billing_unit_id: payload.supplier_billing_unit_id ?? null,
    conditionnement_config: payload.conditionnement_config ?? null,
    conditionnement_resume: payload.conditionnement_resume ?? null,
    final_unit_price: payload.final_unit_price ?? null,
    final_unit_id: payload.final_unit_id ?? null,
    stock_handling_unit_id: payload.stock_handling_unit_id ?? null,
    kitchen_unit_id: payload.kitchen_unit_id ?? null,
    delivery_unit_id: payload.delivery_unit_id ?? null,
    price_display_unit_id: payload.price_display_unit_id ?? null,
    info_produit: payload.info_produit ?? null,
    storage_zone_id: payload.storage_zone_id ?? null,
    min_stock_quantity_canonical: payload.min_stock_quantity_canonical ?? null,
    min_stock_unit_id: payload.min_stock_unit_id ?? null,
    initial_stock_quantity: payload.initial_stock_quantity ?? null,
    initial_stock_unit_id: payload.initial_stock_unit_id ?? null,
    supplier_billing_quantity: payload.supplier_billing_quantity ?? null,
    supplier_billing_line_total: payload.supplier_billing_line_total ?? null,
    allow_unit_sale: payload.allow_unit_sale ?? false,
    dlc_warning_days: payload.dlc_warning_days ?? null,
    created_by: payload.created_by ?? null,
  });

  return {
    product,
    wasCreated: true,
    matchedBy: null,
  };
}

// Legacy function for backwards compatibility
export async function createOrUpdateProductV2(
  establishmentId: string,
  payload: Omit<CreateProductV2Payload, "establishment_id" | "name_normalized">,
  existingId?: string
): Promise<ProductV2> {
  const nameNormalized = normalizeProductNameV2(payload.nom_produit);

  if (existingId) {
    return updateProductV2(existingId, {
      ...payload,
      name_normalized: nameNormalized,
    });
  }

  return createProductV2({
    ...payload,
    establishment_id: establishmentId,
    name_normalized: nameNormalized,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GET DISTINCT SUPPLIERS (for filters) — Via invoice_suppliers (SSOT)
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchDistinctSuppliers(establishmentId: string): Promise<SupplierInfo[]> {
  // Get unique supplier_ids from products_v2, then resolve names via invoice_suppliers
  const { data: productSuppliers, error: productError } = await supabase
    .from("products_v2")
    .select("supplier_id")
    .eq("establishment_id", establishmentId)
    .is("archived_at", null);

  if (productError) {
    if (import.meta.env.DEV)
      console.error("[ProductsV2] Fetch product suppliers error:", productError);
    return [];
  }

  // Extract unique supplier IDs
  const uniqueSupplierIds = [...new Set((productSuppliers ?? []).map((p) => p.supplier_id))];

  if (uniqueSupplierIds.length === 0) {
    return [];
  }

  // Fetch supplier names from invoice_suppliers
  const { data: suppliers, error: supplierError } = await supabase
    .from("invoice_suppliers")
    .select("id, name")
    .in("id", uniqueSupplierIds)
    .order("name", { ascending: true });

  if (supplierError) {
    if (import.meta.env.DEV) console.error("[ProductsV2] Fetch suppliers error:", supplierError);
    return [];
  }

  return (suppliers ?? []).map((s) => ({
    id: s.id,
    name: s.name,
  }));
}
