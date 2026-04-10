/**
 * B2B Import Pipeline — 6-phase orchestrator
 * Phase A: Extract → Phase B: Map Units → Phase C: Map Category
 * Phase D: Rebuild Config → Phase E: Validate → Phase F: Atomic Commit
 * Phase G: Auto-generate product_input_config (Step 2 — Supplier Unit V1)
 */

import type {
  B2BCatalogProduct,
  B2BSupplierUnit,
  LocalUnit,
  LocalCategory,
  EnrichedCatalogProduct,
  ImportProductResult,
  ImportProductStatus,
  UnitMappingResult,
} from "./b2bTypes";
import { mapProductUnits, allUnitsMapped, getUnitBlockReason } from "./b2bUnitMapper";
import { mapCategory } from "./b2bCategoryMapper";
import { rebuildConditionnementConfig, remapDirectUnit } from "./b2bConfigRebuilder";
import { importProductAtomic } from "./b2bCatalogService";

import { normalizeProductNameV2 } from "@/modules/produitsV2";
import { buildReceptionConfig, buildPurchaseConfig, buildInternalConfig } from "@/modules/inputConfig";
import { supabase } from "@/integrations/supabase/client";

// ── BUG-002: Cross-family detection ──

/**
 * Detect if a product's supplier stock_handling_unit family differs from
 * the client's mapped final_unit family. If families differ and no
 * equivalence exists, fn_convert_b2b_quantity will fail at shipment.
 * Returns a block reason string, or null if OK.
 */
function detectCrossFamilyMismatch(
  product: B2BCatalogProduct,
  unitMappings: UnitMappingResult[],
  supplierUnits: B2BSupplierUnit[],
  localUnits: LocalUnit[]
): string | null {
  // Get supplier's stock_handling_unit (what fn_convert_b2b_quantity uses)
  const supplierStockUnitId = product.stock_handling_unit_id ?? product.final_unit_id;
  if (!supplierStockUnitId) return null;

  const supplierUnit = supplierUnits.find((u) => u.id === supplierStockUnitId);
  if (!supplierUnit?.family) return null;

  // Get the client's mapped final_unit
  const finalUnitMapping = unitMappings.find(
    (m) => m.sourceUnitId === product.final_unit_id && m.status === "MAPPED" && m.localUnitId
  );
  if (!finalUnitMapping?.localUnitId) return null;

  const clientUnit = localUnits.find((u) => u.id === finalUnitMapping.localUnitId);
  if (!clientUnit?.family) return null;

  // Same family → OK
  if (supplierUnit.family === clientUnit.family) return null;

  // Cross-family: check if product has an equivalence in conditionnement_config
  // that could bridge the families (e.g., 1 pièce = 0.15 kg)
  if (product.conditionnement_config) {
    const eq = product.conditionnement_config.equivalence;
    if (eq && typeof eq === "object") {
      const eqObj = eq as Record<string, unknown>;
      if (eqObj.source_unit_id && eqObj.unit_id && eqObj.quantity) {
        // An equivalence exists — the BFS might resolve it
        return null;
      }
    }
  }

  return `Familles incompatibles : fournisseur "${supplierUnit.name}" (${supplierUnit.family}) ≠ client "${clientUnit.name}" (${clientUnit.family}). Ajoutez une équivalence dans la configuration produit.`;
}

// ── Unit mapping serialization for persistence ──

/**
 * Serialize UnitMappingResult[] into a compact JSONB-friendly format.
 * Only persists MAPPED entries (source UUID → local UUID).
 * Returns null if no mappings — caller MUST treat null as a blocking error.
 */
function serializeUnitMapping(
  mappings: UnitMappingResult[]
): Record<string, string> | null {
  const mapped = mappings.filter((m) => m.status === "MAPPED" && m.localUnitId);
  if (mapped.length === 0) return null;
  const result: Record<string, string> = {};
  for (const m of mapped) {
    result[m.sourceUnitId] = m.localUnitId!;
  }
  return result;
}

// ── Helpers for Phase G: product_input_config auto-generation ──

/**
 * Extract packaging levels from remapped conditionnement_config.
 * Returns array with type_unit_id for buildReceptionConfig consumption.
 */
function extractPackagingLevels(
  config: Record<string, unknown> | null,
): Array<{ type_unit_id?: string | null }> {
  if (!config) return [];
  const levels = config.packagingLevels;
  if (!Array.isArray(levels)) return [];
  return levels as Array<{ type_unit_id?: string | null }>;
}

/**
 * Check if a local unit is continuous (weight/volume).
 */
function isLocalUnitContinuous(
  unitId: string | null,
  localUnits: LocalUnit[],
): boolean {
  if (!unitId) return false;
  const unit = localUnits.find((u) => u.id === unitId);
  return unit?.family === "weight" || unit?.family === "volume";
}

// ── Compensatory cleanup for Phase G failure ──

/**
 * Archive an orphan product created during a failed B2B import.
 * Called when Phase F succeeded but Phase G (config creation) failed.
 *
 * Cannot hard-delete due to ON DELETE RESTRICT on stock_events / commande_lines.
 * Instead: archive the product + remove B2B tracking so it doesn't block re-import.
 *
 * getImportedProducts already filters out archived products (archived_at IS NOT NULL),
 * so the product becomes invisible to B2B and can be re-imported fresh.
 */
async function cleanupOrphanProduct(
  localProductId: string,
  establishmentId: string,
  sourceProductId: string,
  sourceEstablishmentId: string,
): Promise<void> {
  // 1. Remove B2B tracking (so product doesn't show as "already imported")
  await supabase
    .from("b2b_imported_products")
    .delete()
    .eq("local_product_id", localProductId)
    .eq("establishment_id", establishmentId)
    .eq("source_product_id", sourceProductId)
    .eq("source_establishment_id", sourceEstablishmentId);

  // 2. Archive the product (soft-delete — respects ON DELETE RESTRICT)
  await supabase
    .from("products_v2")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", localProductId);
}

// ── Phase A+B+C: Enrich catalogue products with mapping analysis ──

export function enrichCatalogProducts(
  products: B2BCatalogProduct[],
  supplierUnits: B2BSupplierUnit[],
  localUnits: LocalUnit[],
  localCategories: LocalCategory[],
  alreadyImportedSourceIds: Set<string>
): EnrichedCatalogProduct[] {
  return products.map((product) => {
    // Already imported?
    if (alreadyImportedSourceIds.has(product.id)) {
      return {
        ...product,
        importStatus: "ALREADY_IMPORTED" as ImportProductStatus,
        blockReason: "Déjà dans votre catalogue",
        unitMappings: [],
        categoryMapping: {
          sourceCategoryId: product.category_id,
          sourceCategoryName: product.category_name,
          status: "NULL_OK" as const,
          localCategoryId: null,
          localCategoryName: null,
        },
      };
    }

    // Phase B: Map units
    const unitMappings = mapProductUnits(product, supplierUnits, localUnits);
    const unitBlock = getUnitBlockReason(unitMappings);

    if (unitBlock) {
      return {
        ...product,
        importStatus: unitBlock.status as ImportProductStatus,
        blockReason: unitBlock.reason,
        unitMappings,
        categoryMapping: {
          sourceCategoryId: product.category_id,
          sourceCategoryName: product.category_name,
          status: "NULL_OK" as const,
          localCategoryId: null,
          localCategoryName: null,
        },
      };
    }

    // Phase B2 (BUG-002): Cross-family guard
    // A product where the supplier's final_unit family differs from the
    // client's mapped final_unit family will fail fn_convert_b2b_quantity
    // at shipment time. Block import to prevent zombie orders.
    const crossFamilyBlock = detectCrossFamilyMismatch(
      product, unitMappings, supplierUnits, localUnits
    );
    if (crossFamilyBlock) {
      return {
        ...product,
        importStatus: "BLOCKED_UNIT_FAMILY_MISMATCH" as ImportProductStatus,
        blockReason: crossFamilyBlock,
        unitMappings,
        categoryMapping: {
          sourceCategoryId: product.category_id,
          sourceCategoryName: product.category_name,
          status: "NULL_OK" as const,
          localCategoryId: null,
          localCategoryName: null,
        },
      };
    }

    // Phase C: Map category
    const categoryMapping = mapCategory(
      product.category_id,
      product.category_name,
      localCategories
    );

    if (categoryMapping.status === "NOT_FOUND") {
      return {
        ...product,
        importStatus: "BLOCKED_CATEGORY" as ImportProductStatus,
        blockReason: `Catégorie "${product.category_name}" introuvable dans votre établissement`,
        unitMappings,
        categoryMapping,
      };
    }

    // All clear — eligible
    return {
      ...product,
      importStatus: "ELIGIBLE" as ImportProductStatus,
      unitMappings,
      categoryMapping,
    };
  });
}

// ── Phase D+E+F: Import a single product ──

export interface ImportContext {
  establishmentId: string;
  userId: string;
  supplierId: string;
  storageZoneId: string;
  sourceEstablishmentId: string;
  /** Local measurement units — needed for buildReceptionConfig (family detection) */
  localUnits: LocalUnit[];
}

export async function importSingleProduct(
  product: EnrichedCatalogProduct,
  ctx: ImportContext
): Promise<ImportProductResult> {
  try {
    // Phase D: Rebuild config with local UUIDs
    const remappedConfig = rebuildConditionnementConfig(
      product.conditionnement_config,
      product.unitMappings
    );

    const localFinalUnitId = remapDirectUnit(product.final_unit_id, product.unitMappings);
    if (!localFinalUnitId) {
      return {
        sourceProductId: product.id,
        nom_produit: product.nom_produit,
        status: "BLOCKED_UNIT_UNKNOWN",
        reason: "Unité de référence introuvable après remap",
      };
    }

    // Phase E: Validate unit_mapping completeness — STRICT, no fallback
    const serializedMapping = serializeUnitMapping(product.unitMappings);
    if (!serializedMapping || Object.keys(serializedMapping).length === 0) {
      return {
        sourceProductId: product.id,
        nom_produit: product.nom_produit,
        status: "BLOCKED_UNIT_UNKNOWN",
        reason: "Mapping d'unités incomplet — import impossible sans fallback",
      };
    }

    // Phase F: Atomic commit (product + unit_mapping in single transaction)
    const localProductId = await importProductAtomic({
      establishment_id: ctx.establishmentId,
      user_id: ctx.userId,
      nom_produit: product.nom_produit,
      name_normalized: normalizeProductNameV2(product.nom_produit),
      code_produit: product.code_produit ?? null,
      category: null,
      category_id: product.categoryMapping.localCategoryId ?? null,
      supplier_id: ctx.supplierId,
      final_unit_id: localFinalUnitId,
      supplier_billing_unit_id: remapDirectUnit(product.supplier_billing_unit_id, product.unitMappings) ?? null,
      delivery_unit_id: remapDirectUnit(product.delivery_unit_id, product.unitMappings) ?? null,
      stock_handling_unit_id: remapDirectUnit(product.stock_handling_unit_id, product.unitMappings) ?? null,
      kitchen_unit_id: remapDirectUnit(product.kitchen_unit_id, product.unitMappings) ?? null,
      price_display_unit_id: remapDirectUnit(product.price_display_unit_id, product.unitMappings) ?? null,
      min_stock_unit_id: remapDirectUnit(product.min_stock_unit_id, product.unitMappings) ?? localFinalUnitId,
      final_unit_price: product.final_unit_price ?? 0,
      conditionnement_config: remappedConfig ?? null,
      conditionnement_resume: product.conditionnement_resume ?? null,
      min_stock_quantity_canonical: product.min_stock_quantity_canonical ?? 0,
      storage_zone_id: ctx.storageZoneId,
      source_product_id: product.id,
      source_establishment_id: ctx.sourceEstablishmentId,
      supplier_billing_quantity: product.supplier_billing_quantity ?? null,
      supplier_billing_line_total: product.supplier_billing_line_total ?? null,
      unit_mapping: serializedMapping,
      allow_unit_sale: product.allow_unit_sale === true,
    });

    // ── Phase G: Auto-generate product_input_config (Supplier Unit V1) ──
    // Uses buildReceptionConfig — SAME logic as wizard (Step 1)
    // BLOCKING: if config creation fails on FIRST import, we archive the
    // orphan product to prevent a "not_configured" state in modals.
    // On RE-IMPORT, config UPDATE failure is non-destructive (old config survives).
    const packagingLevels = extractPackagingLevels(remappedConfig);
    const localStockUnit = remapDirectUnit(product.stock_handling_unit_id, product.unitMappings) ?? localFinalUnitId;

    // Reception: auto-generated via buildReceptionConfig (single source of truth)
    const sourceAllowUnitSale = product.allow_unit_sale === true;
    const receptionConfig = buildReceptionConfig(
      packagingLevels,
      sourceAllowUnitSale,
      localFinalUnitId,
      ctx.localUnits, // dbUnits for family detection
    );

    // Purchase: auto-generated via buildPurchaseConfig (L0, independent of toggle)
    const purchaseConfig = buildPurchaseConfig(
      packagingLevels,
      localFinalUnitId,
      ctx.localUnits,
    );

    // Internal: copy faithfully from source product's config (not recalculated)
    // This ensures the client gets the exact same internal logic as the supplier.
    // If the source config is unavailable, fall back to buildInternalConfig.
    let internalMode: string;
    let internalPreferredUnitId: string | null;
    let internalUnitChain: string[] | null;

    // Use SECURITY DEFINER RPC to bypass RLS (client cannot read supplier's config)
    const { data: sourceInputConfigRaw, error: rpcError } = await supabase.rpc(
      "fn_get_b2b_source_input_config",
      {
        _source_product_id: product.id,
        _source_establishment_id: ctx.sourceEstablishmentId,
        _client_establishment_id: ctx.establishmentId,
      },
    );
    if (rpcError) {
      console.error(
        `[B2B Import] RPC fn_get_b2b_source_input_config FAILED for product ${product.id}: ${rpcError.message}`,
      );
    }
    const sourceInputConfig = rpcError ? null : (sourceInputConfigRaw as {
      internal_mode: string | null;
      internal_preferred_unit_id: string | null;
      internal_unit_chain: string[] | null;
    } | null);

    if (sourceInputConfig) {
      // Copy source internal_* with UUID remapping
      internalMode = sourceInputConfig.internal_mode ?? "integer";
      internalPreferredUnitId = remapDirectUnit(
        sourceInputConfig.internal_preferred_unit_id,
        product.unitMappings,
      );
      internalUnitChain = sourceInputConfig.internal_unit_chain
        ? (sourceInputConfig.internal_unit_chain as string[]).map(
            (uid) => remapDirectUnit(uid, product.unitMappings) ?? uid,
          ).filter(Boolean)
        : null;
    } else {
      // Fallback: recalculate (should not happen for properly configured products)
      console.warn(
        `[B2B Import] INTERNAL_CONFIG_FALLBACK_USED — product ${product.id} (${product.nom_produit}): ` +
        `source product_input_config missing or incomplete for establishment ${ctx.sourceEstablishmentId}. ` +
        `Falling back to buildInternalConfig. Internal config may differ from supplier.`,
      );
      const fallbackConfig = buildInternalConfig(
        packagingLevels,
        sourceAllowUnitSale,
        localStockUnit,
        localFinalUnitId,
        ctx.localUnits,
      );
      internalMode = fallbackConfig.internal_mode;
      internalPreferredUnitId = fallbackConfig.internal_preferred_unit_id;
      internalUnitChain = fallbackConfig.internal_unit_chain;
    }

    // Check if config already exists (protect internal_* on re-import)
    const { data: existingConfig } = await supabase
      .from("product_input_config")
      .select("id")
      .eq("product_id", localProductId)
      .eq("establishment_id", ctx.establishmentId)
      .maybeSingle();

    if (existingConfig) {
      // RE-IMPORT: only update reception_* (supplier truth), NEVER touch internal_*
      // If this fails, the old config survives → product stays usable → no cleanup needed
      const { error: updateErr } = await supabase
        .from("product_input_config")
        .update({
          reception_mode: receptionConfig.reception_mode,
          reception_preferred_unit_id: receptionConfig.reception_preferred_unit_id,
          reception_unit_chain: receptionConfig.reception_unit_chain,
          purchase_mode: purchaseConfig.purchase_mode,
          purchase_preferred_unit_id: purchaseConfig.purchase_preferred_unit_id,
          purchase_unit_chain: purchaseConfig.purchase_unit_chain,
          updated_by: ctx.userId,
        })
        .eq("product_id", localProductId)
        .eq("establishment_id", ctx.establishmentId);

      if (updateErr) {
        throw new Error(`CONFIG_UPDATE_FAILED: ${updateErr.message}`);
      }
    } else {
      // FIRST IMPORT: create full config (reception + internal defaults)
      const { error: insertErr } = await supabase
        .from("product_input_config")
        .insert({
          product_id: localProductId,
          establishment_id: ctx.establishmentId,
          reception_mode: receptionConfig.reception_mode,
          reception_preferred_unit_id: receptionConfig.reception_preferred_unit_id,
          reception_unit_chain: receptionConfig.reception_unit_chain,
          purchase_mode: purchaseConfig.purchase_mode,
          purchase_preferred_unit_id: purchaseConfig.purchase_preferred_unit_id,
          purchase_unit_chain: purchaseConfig.purchase_unit_chain,
          internal_mode: internalMode,
          internal_preferred_unit_id: internalPreferredUnitId,
          internal_unit_chain: internalUnitChain,
          updated_by: ctx.userId,
        });

      if (insertErr) {
        // ── COMPENSATORY CLEANUP ──
        // Product was just created (Phase F) but config failed → orphan.
        // Cannot hard-delete due to ON DELETE RESTRICT on stock tables.
        // Archive the product + remove tracking so it can be re-imported fresh.
        console.error("[B2B Import] Config insert failed, archiving orphan product:", localProductId);
        await cleanupOrphanProduct(localProductId, ctx.establishmentId, product.id, ctx.sourceEstablishmentId);
        throw new Error(`CONFIG_INSERT_FAILED: ${insertErr.message}`);
      }
    }

    return {
      sourceProductId: product.id,
      nom_produit: product.nom_produit,
      status: "IMPORTED",
      localProductId,
    };
  } catch (err: unknown) {
    const rawMsg = (err as Error).message ?? "";
    
    // Always log raw error for debugging (even in prod for B2B import issues)
    console.error("[B2B Import] Product:", product.nom_produit, "| Raw error:", rawMsg);

    let userReason: string;
    if (rawMsg.includes("AMBIGUOUS_IDENTITY")) {
      userReason = `Conflit d'identité : le code produit et le nom correspondent à deux produits différents. Vérification manuelle requise.`;
    } else if (rawMsg.includes("idx_products_v2_establishment_code_produit") || 
        (rawMsg.includes("duplicate key") && rawMsg.includes("code_produit"))) {
      userReason = `Le code produit "${product.code_produit ?? "(vide)"}" existe déjà dans votre catalogue.`;
    } else if (rawMsg.includes("duplicate key") && rawMsg.includes("name_normalized")) {
      userReason = `Un produit avec le même nom existe déjà dans votre catalogue.`;
    } else if (rawMsg.includes("STOCK_INIT_FAILED")) {
      userReason = `Erreur d'initialisation du stock. Vérifiez que la zone de stockage est configurée.`;
    } else if (rawMsg.includes("NOT_AUTHORIZED")) {
      userReason = `Vous n'avez pas accès à cet établissement.`;
    } else {
      userReason = rawMsg.length > 150 
        ? rawMsg.substring(0, 150) + "…" 
        : rawMsg || "Erreur inconnue";
    }

    return {
      sourceProductId: product.id,
      nom_produit: product.nom_produit,
      status: "ERROR",
      reason: userReason,
    };
  }
}

/**
 * Import multiple products sequentially. Returns results for each.
 */
export async function importBatch(
  products: EnrichedCatalogProduct[],
  ctx: ImportContext,
  onProgress?: (done: number, total: number) => void
): Promise<ImportProductResult[]> {
  const eligible = products.filter((p) => p.importStatus === "ELIGIBLE");
  const results: ImportProductResult[] = [];

  for (let i = 0; i < eligible.length; i++) {
    const result = await importSingleProduct(eligible[i], ctx);
    results.push(result);
    onProgress?.(i + 1, eligible.length);
  }

  return results;
}
