/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CREATE PRODUCT PIPELINE — Pure async orchestrator (PR-7 + PR-14)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates the complete product creation flow in 8 steps.
 * Zero React, zero hooks, zero side effects (toasts, cache, navigation).
 *
 * PR-14: When USE_ATOMIC_RPC is true, steps 5+7 are replaced by a single
 * call to fn_create_product_complete (atomic transaction).
 *
 * The wizard (or any headless caller) injects:
 * - collisionChecker (async, avoids direct Supabase import)
 * - saveInputConfigFn (async, avoids hook dependency)
 * - upsertFn (async, avoids direct Supabase import)
 */

import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { PackagingLevel, PriceLevel, Equivalence, ConditioningConfig } from "./types";
import type { ProductValidationInput, CollisionChecker } from "./validateProductPayload";
import type { InputConfigPayload } from "./buildInputConfigPayload";
import type { WizardState, ProductV3InitialData } from "@/modules/visionAI/components/ProductFormV3/types";
import type { UpsertProductV2Payload, UpsertProductV2Result } from "@/modules/produitsV2/services/productsV2Service";

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
import { normalizeProductNameV2 } from "../utils/normalizeProductName";
import { USE_ATOMIC_RPC } from "@/config/featureFlags";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineResult =
  | { ok: true; productId: string; wasCreated: boolean; warnings: string[] }
  | {
      ok: false;
      code: "COLLISION" | "VALIDATION" | "UNIT_NOT_FOUND" | "FK_ERROR" | "NETWORK" | "CONFIG_ERROR";
      message: string;
      retryable: boolean;
    };

export type SaveInputConfigFn = (
  productId: string,
  payload: InputConfigPayload,
  establishmentId: string,
) => Promise<void>;

export type UpsertProductFn = (
  establishmentId: string,
  payload: UpsertProductV2Payload,
) => Promise<UpsertProductV2Result>;

export interface CreateProductPipelineInput {
  wizardState: WizardState;
  establishmentId: string;
  userId: string;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
  initialData?: ProductV3InitialData | null;
  collisionChecker: CollisionChecker;
  saveInputConfigFn: SaveInputConfigFn;
  upsertFn: UpsertProductFn;
  /** Calculation result from conditionnementV2 engine */
  calculationResult?: { unitPriceFinal: number | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOMIC RPC PATH (PR-14)
// ─────────────────────────────────────────────────────────────────────────────

interface AtomicRpcResult {
  ok: boolean;
  product_id?: string;
  error?: string;
  existing_id?: string;
}

function classifyRpcError(errorMessage: string): PipelineResult & { ok: false } {
  if (errorMessage.includes("COLLISION")) {
    return { ok: false, code: "COLLISION", message: errorMessage, retryable: false };
  }
  if (errorMessage.includes("STOCK_INIT_FAILED")) {
    return { ok: false, code: "CONFIG_ERROR", message: errorMessage, retryable: false };
  }
  if (errorMessage.includes("violates foreign key") || errorMessage.includes("fkey")) {
    return { ok: false, code: "FK_ERROR", message: errorMessage, retryable: false };
  }
  if (errorMessage.includes("unique") || errorMessage.includes("duplicate") || errorMessage.includes("idx_products_v2")) {
    return { ok: false, code: "COLLISION", message: errorMessage, retryable: false };
  }
  return { ok: false, code: "NETWORK", message: errorMessage, retryable: true };
}

async function executeAtomicRpc(
  upsertPayload: UpsertProductV2Payload,
  inputConfigPayload: InputConfigPayload,
  establishmentId: string,
  userId: string,
  allowUnitSale: boolean,
  dlcWarningDays: number | null,
): Promise<PipelineResult> {
  const nameNormalized = normalizeProductNameV2(upsertPayload.nom_produit);

  const { data, error } = await supabase.rpc("fn_create_product_complete", {
    p_establishment_id: establishmentId,
    p_user_id: userId,
    p_nom_produit: upsertPayload.nom_produit,
    p_name_normalized: nameNormalized,
    p_code_produit: upsertPayload.code_produit ?? undefined,
    p_code_barres: upsertPayload.code_barres ?? undefined,
    p_supplier_id: upsertPayload.supplier_id ?? undefined,
    p_info_produit: upsertPayload.info_produit ?? undefined,
    p_category_id: upsertPayload.category_id ?? undefined,
    p_conditionnement_config: JSON.parse(JSON.stringify(upsertPayload.conditionnement_config ?? null)),
    p_conditionnement_resume: upsertPayload.conditionnement_resume ?? undefined,
    p_final_unit_id: upsertPayload.final_unit_id ?? undefined,
    p_stock_handling_unit_id: upsertPayload.stock_handling_unit_id ?? undefined,
    p_delivery_unit_id: upsertPayload.delivery_unit_id ?? undefined,
    p_supplier_billing_unit_id: upsertPayload.supplier_billing_unit_id ?? undefined,
    p_price_display_unit_id: upsertPayload.price_display_unit_id ?? undefined,
    p_kitchen_unit_id: upsertPayload.kitchen_unit_id ?? undefined,
    p_final_unit_price: upsertPayload.final_unit_price ?? undefined,
    p_supplier_billing_quantity: upsertPayload.supplier_billing_quantity ?? undefined,
    p_supplier_billing_line_total: upsertPayload.supplier_billing_line_total ?? undefined,
    p_storage_zone_id: upsertPayload.storage_zone_id ?? undefined,
    p_min_stock_quantity_canonical: upsertPayload.min_stock_quantity_canonical ?? undefined,
    p_min_stock_unit_id: upsertPayload.min_stock_unit_id ?? undefined,
    p_initial_stock_quantity: upsertPayload.initial_stock_quantity ?? undefined,
    p_initial_stock_unit_id: upsertPayload.initial_stock_unit_id ?? undefined,
    p_allow_unit_sale: allowUnitSale,
    p_dlc_warning_days: dlcWarningDays ?? undefined,
    p_purchase_mode: inputConfigPayload.purchase_mode,
    p_purchase_preferred_unit_id: inputConfigPayload.purchase_preferred_unit_id ?? undefined,
    p_purchase_unit_chain: inputConfigPayload.purchase_unit_chain ?? undefined,
    p_reception_mode: inputConfigPayload.reception_mode,
    p_reception_preferred_unit_id: inputConfigPayload.reception_preferred_unit_id ?? undefined,
    p_reception_unit_chain: inputConfigPayload.reception_unit_chain ?? undefined,
    p_internal_mode: inputConfigPayload.internal_mode,
    p_internal_preferred_unit_id: inputConfigPayload.internal_preferred_unit_id ?? undefined,
    p_internal_unit_chain: inputConfigPayload.internal_unit_chain ?? undefined,
  });

  // PostgREST error (network, SQL exception propagated)
  if (error) {
    return classifyRpcError(error.message);
  }

  const result = data as unknown as AtomicRpcResult;

  // RPC returned a structured collision response
  if (!result.ok) {
    if (result.error === "COLLISION") {
      return {
        ok: false,
        code: "COLLISION",
        message: `Produit existant : ${result.existing_id ?? "unknown"}`,
        retryable: false,
      };
    }
    return classifyRpcError(result.error ?? "Unknown RPC error");
  }

  return {
    ok: true,
    productId: result.product_id!,
    wasCreated: true,
    warnings: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

export async function createProductPipeline(
  input: CreateProductPipelineInput,
): Promise<PipelineResult> {
  const {
    wizardState: ws,
    establishmentId,
    userId,
    dbUnits,
    dbConversions,
    initialData,
    collisionChecker,
    saveInputConfigFn,
    upsertFn,
    calculationResult,
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

  // 1c. Stock handling unit (depends on 1a)
  // Equivalence removed from wizard — always null
  const equivalenceObject = null;

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

  // 1d. Equivalence already resolved above (needed for 1c)

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
  // ÉTAPE 2 — Construction conditionnement
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
  // ÉTAPE 3 — Validation complète (fail-fast)
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
  };

  const validation = await validateProductPayload(
    validationInput,
    dbUnits,
    dbConversions,
    collisionChecker,
  );

  if (!validation.valid) {
    const v = validation as { valid: false; code: string; message: string };
    const code = v.code === "COLLISION" ? "COLLISION" as const
      : v.code === "UNIT_NOT_FOUND" ? "UNIT_NOT_FOUND" as const
      : "VALIDATION" as const;
    return { ok: false, code, message: v.message, retryable: false };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 — Construction payload produit (25+ champs)
  // ══════════════════════════════════════════════════════════════════════════

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

  const canonicalInitialStock = resolveCanonicalQuantity(
    {
      rawQty: parseLocalFloat(ws.initialStockQuantity),
      selectedUnitId: ws.initialStockUnitId,
      stockHandlingUnitId: effectiveStockHandlingUnitId,
      deliveryUnitId: effectiveDeliveryUnitId,
      billedUnitId: ws.billedUnitId,
      finalUnitId: ws.finalUnitId,
      condConfig,
    },
    dbUnits,
    dbConversions,
  );

  const dlcDays = ws.dlcWarningDays ? parseInt(ws.dlcWarningDays, 10) : null;
  const billedQtyNum = parseLocalFloat(ws.billedQuantity);
  const lineTotalNum = parseLocalFloat(ws.lineTotal);

  const upsertPayload: UpsertProductV2Payload = {
    nom_produit: ws.productName.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(),
    code_produit: ws.productCode.trim() || null,
    code_barres: ws.barcode?.trim() || null,
    supplier_id: ws.identitySupplierId!,
    info_produit: initialData?.info_produit?.trim() || null,
    category_id: ws.categoryId || null,
    supplier_billing_unit_id: ws.billedUnitId,
    storage_zone_id: ws.storageZoneId || null,
    conditionnement_config: condConfig,
    conditionnement_resume: condResume || null,
    final_unit_price: calculationResult?.unitPriceFinal ?? null,
    final_unit_id: ws.finalUnitId,
    delivery_unit_id: effectiveDeliveryUnitId,
    price_display_unit_id: effectivePriceDisplayUnitId,
    stock_handling_unit_id: effectiveStockHandlingUnitId,
    kitchen_unit_id: null,
    min_stock_quantity_canonical: canonicalMinStock.qty,
    min_stock_unit_id: canonicalMinStock.unitId,
    initial_stock_quantity: canonicalInitialStock.qty,
    initial_stock_unit_id: canonicalInitialStock.unitId,
    supplier_billing_quantity: billedQtyNum > 0 ? billedQtyNum : null,
    supplier_billing_line_total: lineTotalNum > 0 ? lineTotalNum : null,
    allow_unit_sale: ws.allowUnitSale ?? false,
    dlc_warning_days: dlcDays,
    created_by: userId,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 6 — Construction config saisie (needed for both paths)
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
  // PR-14: ATOMIC RPC PATH (if USE_ATOMIC_RPC enabled)
  // Replaces steps 5 + 7 with a single fn_create_product_complete call
  // ══════════════════════════════════════════════════════════════════════════

  if (USE_ATOMIC_RPC) {
    return executeAtomicRpc(upsertPayload, inputConfigPayload, establishmentId, userId, ws.allowUnitSale ?? false, dlcDays);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 5 — Persistance produit (via upsertFn injectée) — LEGACY PATH
  // ══════════════════════════════════════════════════════════════════════════

  let upsertResult: UpsertProductV2Result;
  try {
    upsertResult = await upsertFn(establishmentId, upsertPayload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("idx_products_v2") || msg.includes("unique") || msg.includes("duplicate")) {
      return { ok: false, code: "COLLISION", message: msg, retryable: false };
    }
    if (msg.includes("violates foreign key") || msg.includes("fkey")) {
      return { ok: false, code: "FK_ERROR", message: msg, retryable: false };
    }
    return { ok: false, code: "NETWORK", message: msg, retryable: true };
  }

  const productId = upsertResult.product.id;

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 7 — Persistance config (BLOQUANTE — pas de catch silencieux) — LEGACY PATH
  // ══════════════════════════════════════════════════════════════════════════

  try {
    await saveInputConfigFn(productId, inputConfigPayload, establishmentId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "CONFIG_ERROR", message: msg, retryable: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 8 — Retour
  // ══════════════════════════════════════════════════════════════════════════

  return {
    ok: true,
    productId,
    wasCreated: upsertResult.wasCreated,
    warnings: [],
  };
}
