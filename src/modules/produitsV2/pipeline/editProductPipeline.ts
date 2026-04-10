/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDIT PRODUCT PIPELINE — Pure async orchestrator (PR-10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates the complete product update flow.
 * Zero React, zero hooks, zero side effects (toasts, cache, navigation).
 *
 * Key differences from createProductPipeline:
 * - Optimistic locking via expectedUpdatedAt
 * - needsConfirmation pattern for stock unit family changes
 * - Zone transfer via fn_save_product_wizard (never direct UPDATE)
 * - contextHash always computed (never null)
 * - fn_initialize_product_stock if family changed & zone NOT changed
 */

import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { PackagingLevel, Equivalence } from "./types";
import type { ProductValidationInput, CollisionChecker } from "./validateProductPayload";
import type { InputConfigPayload } from "./buildInputConfigPayload";
import type { WizardState, ProductV3InitialData } from "@/modules/visionAI/components/ProductFormV3/types";
import type { SaveInputConfigFn } from "./createProductPipeline";
import type { ContextHashInput } from "@/modules/stockLedger/types";

import {
  resolveEffectiveDeliveryUnitId,
  resolveEffectivePriceDisplayUnitId,
  resolveEffectiveStockHandlingUnitId,
  resolveEquivalenceObject,
  autoDeducePriceLevel,
  resolveEffectivePriceLevel,
  resolveCanonicalQuantity,
  parseLocalFloat,
} from "./resolveProductDerived";
import { buildConditioningConfig, buildConditioningResume } from "./buildConditioningPayload";
import { validateProductPayload } from "./validateProductPayload";
import { buildInputConfigPayload } from "./buildInputConfigPayload";
import { computeContextHash } from "@/modules/stockLedger/engine/contextHash";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface EditPipelineInput {
  wizardState: WizardState;
  productId: string;
  expectedUpdatedAt: string | null;
  establishmentId: string;
  userId: string;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  initialData: ProductV3InitialData | null;
  estimatedStock?: {
    qty: number;
    unitId: string;
    family: string;
  } | null;
  collisionChecker: CollisionChecker;
  saveInputConfigFn: SaveInputConfigFn;
  /** Calculation result from conditionnementV2 engine */
  calculationResult?: { unitPriceFinal: number | null } | null;
  /** Set to true after user confirms family change */
  confirmed?: boolean;
  /** Injected RPC caller — avoids direct Supabase import */
  saveProductRpcFn: SaveProductRpcFn;
  /** Injected stock re-init — avoids direct Supabase import */
  initializeStockFn: InitializeStockFn;
}

/** Mirrors the shape of supabase.rpc("fn_save_product_wizard", ...) */
export type SaveProductRpcFn = (
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Mirrors supabase.rpc("fn_initialize_product_stock", ...) */
export type InitializeStockFn = (
  productId: string,
  userId: string,
) => Promise<{ error: { message: string } | null }>;

export type EditPipelineResult =
  | { ok: true; productId: string; warnings: string[]; zoneChanged?: boolean; transferredQty?: number }
  | {
      ok: false;
      code:
        | "OPTIMISTIC_LOCK"
        | "VALIDATION"
        | "COLLISION"
        | "FK_ERROR"
        | "NETWORK"
        | "CONFIG_ERROR"
        | "STOCK_UNIT_LOCKED";
      message: string;
      retryable: boolean;
    }
  | {
      needsConfirmation: "family_change";
      pendingPayload: EditPipelineInput;
    };

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildContextHashFromWizard(
  finalUnitId: string | null,
  billedUnitId: string | null,
  packagingLevels: PackagingLevel[],
  equivalenceObject: Equivalence | null,
): string {
  const hashInput: ContextHashInput = {
    canonical_unit_id: finalUnitId ?? "",
    billing_unit_id: billedUnitId,
    packaging_levels: packagingLevels.map((lvl) => ({
      type_unit_id: lvl.type_unit_id ?? null,
      contains_unit_id: lvl.contains_unit_id ?? null,
      quantity: lvl.containsQuantity ?? 0,
    })),
    equivalence: equivalenceObject
      ? {
          source_unit_id: equivalenceObject.source_unit_id ?? null,
          unit_id: equivalenceObject.unit_id ?? null,
          quantity: equivalenceObject.quantity ?? null,
        }
      : null,
  };
  return computeContextHash(hashInput);
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

export async function editProductPipeline(
  input: EditPipelineInput,
): Promise<EditPipelineResult> {
  const {
    wizardState: ws,
    productId,
    expectedUpdatedAt,
    establishmentId,
    userId,
    dbUnits,
    dbConversions,
    initialData,
    estimatedStock,
    collisionChecker,
    saveInputConfigFn,
    calculationResult,
    confirmed,
    saveProductRpcFn,
    initializeStockFn,
  } = input;

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 — Résolution des dérivés (ordre séquentiel impératif)
  // ══════════════════════════════════════════════════════════════════════════

  // 1a. Delivery unit
  const effectiveDeliveryUnitId = resolveEffectiveDeliveryUnitId(
    {
      deliveryUnitId: ws.deliveryUnitId,
      packagingLevels: ws.packagingLevels,
      billedUnitId: ws.billedUnitId,
      finalUnitId: ws.finalUnitId,
    },
    dbUnits,
  );

  // 1b. Price display unit
  const effectivePriceDisplayUnitId = resolveEffectivePriceDisplayUnitId(
    ws.priceDisplayUnitId,
    ws.finalUnitId,
  );

  // 1c. Equivalence removed from wizard — always null
  const equivalenceObject = null;

  // 1d. Stock handling unit (depends on 1a, 1c)
  const effectiveStockHandlingUnitId = resolveEffectiveStockHandlingUnitId(
    {
      finalUnitId: ws.finalUnitId,
      billedUnitId: ws.billedUnitId,
      packagingLevels: ws.packagingLevels,
      equivalence: equivalenceObject,
      deliveryUnitId: effectiveDeliveryUnitId,
    },
    dbUnits,
    dbConversions,
  );

  // 1e. Auto-deduced price level
  const autoDeduced = autoDeducePriceLevel({
    billedUnit: ws.billedUnit,
    billedUnitId: ws.billedUnitId,
    finalUnit: ws.finalUnit,
    finalUnitId: ws.finalUnitId,
    packagingLevels: ws.packagingLevels,
  });

  // 1f. Effective price level
  const effectivePriceLevel = resolveEffectivePriceLevel(autoDeduced, ws.priceLevel);

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 — Détection changement de famille (needsConfirmation)
  // ══════════════════════════════════════════════════════════════════════════

  const oldStockUnitId = initialData?.stock_handling_unit_id;
  const newStockUnitId = effectiveStockHandlingUnitId;
  const unitChanged = !!(newStockUnitId && oldStockUnitId && newStockUnitId !== oldStockUnitId);
  const oldFamily = unitChanged ? dbUnits.find((u) => u.id === oldStockUnitId)?.family : null;
  const newFamily = unitChanged ? dbUnits.find((u) => u.id === newStockUnitId)?.family : null;
  const unitFamilyChanged = unitChanged && oldFamily !== newFamily;

  if (unitFamilyChanged && !confirmed) {
    return {
      needsConfirmation: "family_change",
      pendingPayload: { ...input, confirmed: true },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 — Construction conditionnement
  // ══════════════════════════════════════════════════════════════════════════

  const condConfig = buildConditioningConfig({
    finalUnit: ws.finalUnit,
    finalUnitId: ws.finalUnitId,
    packagingLevels: ws.packagingLevels,
    effectivePriceLevel,
    billedUnitId: ws.billedUnitId,
    equivalenceObject,
  });

  const condResume = buildConditioningResume({
    packagingLevels: ws.packagingLevels,
    finalUnit: ws.finalUnit,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 — Validation complète (fail-fast)
  // ══════════════════════════════════════════════════════════════════════════

  const validationInput: ProductValidationInput = {
    productName: ws.productName,
    supplierId: ws.identitySupplierId,
    storageZoneId: ws.storageZoneId,
    finalUnitId: ws.finalUnitId,
    finalUnit: ws.finalUnit,
    stockHandlingUnitId: effectiveStockHandlingUnitId,
    billedUnitId: ws.billedUnitId,
    deliveryUnitId: effectiveDeliveryUnitId,
    priceDisplayUnitId: effectivePriceDisplayUnitId,
    kitchenUnitId: null,
    packagingLevels: ws.packagingLevels,
    equivalence: equivalenceObject,
    establishmentId,
    codeProduit: ws.productCode?.trim() || undefined,
    codeBarres: ws.barcode?.trim() || undefined,
    excludeId: productId,
  };

  const validation = await validateProductPayload(
    validationInput,
    dbUnits,
    dbConversions,
    collisionChecker,
  );

  if (!validation.valid) {
    const v = validation as { valid: false; code: string; message: string };
    const code =
      v.code === "COLLISION"
        ? ("COLLISION" as const)
        : v.code === "UNIT_NOT_FOUND"
          ? ("VALIDATION" as const)
          : ("VALIDATION" as const);
    return { ok: false, code, message: v.message, retryable: false };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 5 — Zone change detection + estimated stock
  // ══════════════════════════════════════════════════════════════════════════

  const newZoneId = ws.storageZoneId;
  const oldZoneId = initialData?.storage_zone_id;
  const zoneChanged = !!(newZoneId && oldZoneId && newZoneId !== oldZoneId);

  let estimatedQty = 0;
  let canonicalUnitId: string | null = null;
  let canonicalFamily: string | null = null;

  if (zoneChanged && estimatedStock) {
    estimatedQty = estimatedStock.qty;
    canonicalUnitId = estimatedStock.unitId;
    canonicalFamily = estimatedStock.family;
  } else if (zoneChanged) {
    canonicalUnitId = newStockUnitId ?? null;
    canonicalFamily = newStockUnitId
      ? dbUnits.find((u) => u.id === newStockUnitId)?.family ?? null
      : null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 6 — Construction payload RPC
  // ══════════════════════════════════════════════════════════════════════════

  const dlcDaysEdit = ws.dlcWarningDays ? parseInt(ws.dlcWarningDays, 10) : null;
  const dlcValue =
    !isNaN(dlcDaysEdit as number) && dlcDaysEdit !== null && dlcDaysEdit >= 0
      ? dlcDaysEdit
      : null;
  const billedQtyNum = parseLocalFloat(ws.billedQuantity);
  const lineTotalNum = parseLocalFloat(ws.lineTotal);

  const canonicalMinStock = resolveCanonicalQuantity(
    {
      rawQty: parseLocalFloat(ws.minStockQuantity),
      selectedUnitId: ws.minStockUnitId,
      stockHandlingUnitId: effectiveStockHandlingUnitId,
      deliveryUnitId: effectiveDeliveryUnitId,
      billedUnitId: ws.billedUnitId,
      finalUnitId: ws.finalUnitId,
      condConfig,
    },
    dbUnits,
    dbConversions,
  );

  // Context hash — NEVER null
  const contextHash = buildContextHashFromWizard(
    ws.finalUnitId,
    ws.billedUnitId,
    ws.packagingLevels,
    equivalenceObject,
  );

  const rpcParams: Record<string, unknown> = {
    p_product_id: productId,
    p_user_id: userId,
    p_nom_produit: ws.productName
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase(),
    p_name_normalized: ws.productName
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
    p_code_produit: ws.productCode.trim() || null,
    p_conditionnement_config: condConfig,
    p_conditionnement_resume: condResume || null,
    p_supplier_billing_unit_id: ws.billedUnitId,
    p_final_unit_price: calculationResult?.unitPriceFinal ?? null,
    p_final_unit_id: ws.finalUnitId,
    p_delivery_unit_id: effectiveDeliveryUnitId,
    p_price_display_unit_id: effectivePriceDisplayUnitId,
    p_stock_handling_unit_id: effectiveStockHandlingUnitId,
    p_kitchen_unit_id: null,
    p_min_stock_quantity_canonical: canonicalMinStock.qty,
    p_min_stock_unit_id: canonicalMinStock.unitId,
    p_category: null,
    p_category_id: ws.categoryId || null,
    p_new_zone_id: newZoneId || null,
    p_old_zone_id: oldZoneId || null,
    p_estimated_qty: estimatedQty,
    p_canonical_unit_id: canonicalUnitId,
    p_canonical_family: canonicalFamily,
    p_context_hash: contextHash,
    p_expected_updated_at: expectedUpdatedAt,
    p_dlc_warning_days: dlcValue,
    p_supplier_billing_quantity: billedQtyNum > 0 ? billedQtyNum : null,
    p_supplier_billing_line_total: lineTotalNum > 0 ? lineTotalNum : null,
    p_allow_unit_sale: ws.allowUnitSale,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 7 — Persistance produit (via fn_save_product_wizard RPC)
  // ══════════════════════════════════════════════════════════════════════════

  let rpcResult: Record<string, unknown> | null;
  try {
    const { data, error } = await saveProductRpcFn(rpcParams);
    if (error) {
      return {
        ok: false,
        code: "NETWORK",
        message: error.message,
        retryable: true,
      };
    }
    rpcResult = data as Record<string, unknown> | null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "NETWORK", message: msg, retryable: true };
  }

  // Check RPC-level errors
  if (rpcResult && !rpcResult.ok) {
    const errorCode = (rpcResult.error as string) ?? "";

    if (errorCode.includes("OPTIMISTIC_LOCK_CONFLICT")) {
      return {
        ok: false,
        code: "OPTIMISTIC_LOCK",
        message: "Le produit a été modifié par un autre utilisateur. Veuillez rafraîchir et réessayer.",
        retryable: false,
      };
    }
    if (errorCode.includes("STOCK_UNIT_LOCKED")) {
      return {
        ok: false,
        code: "STOCK_UNIT_LOCKED",
        message:
          "Impossible de modifier l'unité stock : le produit a encore du stock. Passez d'abord le stock à 0 via inventaire.",
        retryable: false,
      };
    }
    return {
      ok: false,
      code: "NETWORK",
      message: errorCode || "Erreur lors de la sauvegarde.",
      retryable: false,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 8 — Re-init stock si famille changée & zone PAS changée
  // ══════════════════════════════════════════════════════════════════════════

  const warnings: string[] = [];

  if (unitFamilyChanged && !zoneChanged && newZoneId && newStockUnitId) {
    try {
      const { error } = await initializeStockFn(productId, userId);
      if (error) {
        warnings.push(`Re-initialisation stock: ${error.message}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Re-initialisation stock: ${msg}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 9 — Construction config saisie
  // ══════════════════════════════════════════════════════════════════════════

  const inputConfigPayload = buildInputConfigPayload(
    {
      finalUnitId: ws.finalUnitId,
      billedUnitId: ws.billedUnitId,
      stockHandlingUnitId: effectiveStockHandlingUnitId,
      packagingLevels: ws.packagingLevels,
      allowUnitSale: ws.allowUnitSale,
      receptionModeOverride: ws.inputConfigReceptionMode,
      receptionUnitIdOverride: ws.inputConfigReceptionUnitId,
      receptionChainOverride: ws.inputConfigReceptionChain,
      internalModeOverride: ws.inputConfigInternalMode,
      internalUnitIdOverride: ws.inputConfigInternalUnitId,
      internalChainOverride: ws.inputConfigInternalChain,
    },
    dbUnits,
  );

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 10 — Persistance config (BLOQUANTE)
  // ══════════════════════════════════════════════════════════════════════════

  try {
    await saveInputConfigFn(productId, inputConfigPayload, establishmentId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "CONFIG_ERROR", message: msg, retryable: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 11 — Retour
  // ══════════════════════════════════════════════════════════════════════════

  const transferredQty = (rpcResult as Record<string, unknown> | null)?.transferred_qty as
    | number
    | undefined;

  return {
    ok: true,
    productId,
    warnings,
    zoneChanged,
    transferredQty: transferredQty ?? 0,
  };
}
