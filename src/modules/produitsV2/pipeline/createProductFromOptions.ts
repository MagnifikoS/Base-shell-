/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CREATE PRODUCT FROM OPTIONS — Headless product creation (PR-12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure async function that:
 * 1. Fetches reference data via getWizardOptions
 * 2. Resolves human-readable names → UUIDs
 * 3. Builds a complete WizardState
 * 4. Delegates to createProductPipeline
 *
 * Zero React, zero hooks, zero side effects.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WIZARDSTATE FIELD AUDIT (PR-12 prerequisite)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fields consumed by createProductPipeline (ws.xxx):
 *
 * IDENTITY:
 *   productName         → from input.name (required)
 *   productCode         → from input.code ?? ""
 *   identitySupplierId  → resolved from input.supplierName
 *
 * STRUCTURE (Step 2):
 *   finalUnit           → abbreviation text for display
 *   finalUnitId         → resolved from input.finalUnitAbbr
 *
 * PACKAGING (Step 2):
 *   hasPackaging         → from input.hasPackaging ?? false
 *   packagingLevels      → resolved from input.packagingLevels
 *
 * BILLING (Step 3):
 *   billedUnit           → abbreviation text
 *   billedUnitId         → resolved from input.billedUnitAbbr
 *   billedQuantity       → String(input.billedQuantity)
 *   lineTotal            → String(input.lineTotal)
 *   priceLevel           → null (auto-deduced by pipeline)
 *   priceDisplayUnitId   → resolved from input.priceDisplayUnitAbbr
 *   deliveryUnitId       → null (auto-resolved by pipeline)
 *
 * MANAGEMENT (Step 3):
 *   stockHandlingUnitId  → null (auto-resolved by pipeline)
 *
 * CLASSIFICATION (Step 5):
 *   category             → "" (deprecated text field)
 *   categoryId           → resolved from input.categoryName
 *   storageZoneId        → resolved from input.storageZoneName
 *   minStockQuantity     → String(input.minStockQuantity ?? "")
 *   minStockUnitId       → resolved from input.minStockUnitAbbr
 *   initialStockQuantity → String(input.initialStockQuantity ?? "")
 *   initialStockUnitId   → resolved from input.initialStockUnitAbbr
 *   barcode              → from input.barcode ?? ""
 *   dlcWarningDays       → String(input.dlcWarningDays ?? "")
 *
 * INPUT CONFIG (Step 4):
 *   inputConfigReceptionMode     → null (auto-computed)
 *   inputConfigReceptionUnitId   → null
 *   inputConfigReceptionChain    → null
 *   inputConfigReceptionPartial  → false
 *   inputConfigInternalMode      → null
 *   inputConfigInternalUnitId    → null
 *   inputConfigInternalChain     → null
 *   inputConfigInternalPartial   → false
 *
 * OTHER:
 *   allowUnitSale        → from input.allowUnitSale ?? false
 *   currentStep          → 5
 *
 * SEPARATE PARAM (not in WizardState):
 *   initialData.info_produit → from input.infoProduit
 */

import type { WizardState, ProductV3InitialData } from "@/modules/visionAI/components/ProductFormV3/types";
import type { PackagingLevel } from "./types";
import type { PipelineResult } from "./createProductPipeline";
import type { InputConfigPayload } from "./buildInputConfigPayload";
import { getWizardOptions, type WizardOptions } from "./getWizardOptions";
import { createProductPipeline } from "./createProductPipeline";
import { checkProductV2Collision } from "@/modules/produitsV2/services/productsV2Service";
import { upsertProductV2 } from "@/modules/produitsV2/services/productsV2Service";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPE
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateProductInput {
  name: string;
  code?: string;
  barcode?: string;
  supplierName: string;
  categoryName?: string;
  finalUnitAbbr: string;
  hasPackaging?: boolean;
  packagingLevels?: {
    typeUnitAbbr: string;
    containsQuantity: number;
    containsUnitAbbr: string;
  }[];
  billedUnitAbbr: string;
  billedQuantity: number;
  lineTotal: number;
  priceDisplayUnitAbbr?: string;
  storageZoneName: string;
  minStockQuantity?: number;
  minStockUnitAbbr?: string;
  initialStockQuantity?: number;
  initialStockUnitAbbr?: string;
  allowUnitSale?: boolean;
  dlcWarningDays?: number;
  infoProduit?: string;
  establishmentId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveUnitByAbbr(
  units: WizardOptions["units"],
  abbr: string,
): WizardOptions["units"][number] | null {
  return units.find((u) => u.abbreviation === abbr) ?? null;
}

function resolveByNameCI<T extends { name: string }>(
  items: T[],
  name: string,
): T | null {
  const needle = name.trim().toLowerCase();
  return items.find((i) => i.name.trim().toLowerCase() === needle) ?? null;
}

function resolveZone(
  zones: WizardOptions["storageZones"],
  name: string,
): WizardOptions["storageZones"][number] | null {
  const needle = name.trim().toLowerCase();
  return (
    zones.find(
      (z) =>
        z.name.trim().toLowerCase() === needle ||
        (z.name_normalized && z.name_normalized.trim().toLowerCase() === needle),
    ) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE INPUT CONFIG (pure async, no hooks)
// ─────────────────────────────────────────────────────────────────────────────

async function saveInputConfigDirect(
  productId: string,
  payload: InputConfigPayload,
  establishmentId: string,
): Promise<void> {
  const { error } = await supabase
    .from("product_input_config")
    .upsert(
      {
        product_id: productId,
        establishment_id: establishmentId,
        purchase_mode: payload.purchase_mode,
        purchase_preferred_unit_id: payload.purchase_preferred_unit_id,
        purchase_unit_chain: payload.purchase_unit_chain,
        reception_mode: payload.reception_mode,
        reception_preferred_unit_id: payload.reception_preferred_unit_id,
        reception_unit_chain: payload.reception_unit_chain,
        internal_mode: payload.internal_mode,
        internal_preferred_unit_id: payload.internal_preferred_unit_id,
        internal_unit_chain: payload.internal_unit_chain,
      },
      { onConflict: "product_id,establishment_id" },
    );

  if (error) {
    throw new Error(`Config save failed: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export async function createProductFromOptions(
  input: CreateProductInput,
): Promise<PipelineResult> {
  if (!input.establishmentId) {
    return { ok: false, code: "VALIDATION", message: "establishmentId requis", retryable: false };
  }
  if (!input.name?.trim()) {
    return { ok: false, code: "VALIDATION", message: "Nom du produit requis", retryable: false };
  }

  // ── 1. Fetch reference data ──
  const opts = await getWizardOptions(input.establishmentId);

  // ── 2. Resolve supplier (required) ──
  const supplier = resolveByNameCI(opts.suppliers, input.supplierName);
  if (!supplier) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `Fournisseur '${input.supplierName}' introuvable`,
      retryable: false,
    };
  }

  // ── 3. Resolve category (optional) ──
  let categoryId: string | null = null;
  if (input.categoryName) {
    const cat = resolveByNameCI(opts.categories, input.categoryName);
    if (!cat) {
      return {
        ok: false,
        code: "VALIDATION",
        message: `Catégorie '${input.categoryName}' introuvable`,
        retryable: false,
      };
    }
    categoryId = cat.id;
  }

  // ── 4. Resolve storage zone (required) ──
  const zone = resolveZone(opts.storageZones, input.storageZoneName);
  if (!zone) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `Zone de stockage '${input.storageZoneName}' introuvable`,
      retryable: false,
    };
  }

  // ── 5. Resolve units ──
  const finalUnit = resolveUnitByAbbr(opts.units, input.finalUnitAbbr);
  if (!finalUnit) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `Unité '${input.finalUnitAbbr}' introuvable (abbreviation exacte requise)`,
      retryable: false,
    };
  }

  const billedUnit = resolveUnitByAbbr(opts.units, input.billedUnitAbbr);
  if (!billedUnit) {
    return {
      ok: false,
      code: "VALIDATION",
      message: `Unité facturée '${input.billedUnitAbbr}' introuvable (abbreviation exacte requise)`,
      retryable: false,
    };
  }

  // Optional units
  let priceDisplayUnitId: string | null = null;
  if (input.priceDisplayUnitAbbr) {
    const u = resolveUnitByAbbr(opts.units, input.priceDisplayUnitAbbr);
    if (!u) {
      return {
        ok: false,
        code: "VALIDATION",
        message: `Unité d'affichage prix '${input.priceDisplayUnitAbbr}' introuvable`,
        retryable: false,
      };
    }
    priceDisplayUnitId = u.id;
  }


  let minStockUnitId: string | null = null;
  if (input.minStockUnitAbbr) {
    const u = resolveUnitByAbbr(opts.units, input.minStockUnitAbbr);
    if (!u) {
      return {
        ok: false,
        code: "VALIDATION",
        message: `Unité stock min '${input.minStockUnitAbbr}' introuvable`,
        retryable: false,
      };
    }
    minStockUnitId = u.id;
  }

  let initialStockUnitId: string | null = null;
  if (input.initialStockUnitAbbr) {
    const u = resolveUnitByAbbr(opts.units, input.initialStockUnitAbbr);
    if (!u) {
      return {
        ok: false,
        code: "VALIDATION",
        message: `Unité stock initial '${input.initialStockUnitAbbr}' introuvable`,
        retryable: false,
      };
    }
    initialStockUnitId = u.id;
  }

  // ── 6. Resolve packaging levels ──
  const packagingLevels: PackagingLevel[] = [];
  if (input.hasPackaging && input.packagingLevels) {
    for (const pl of input.packagingLevels) {
      const typeUnit = resolveUnitByAbbr(opts.units, pl.typeUnitAbbr);
      if (!typeUnit) {
        return {
          ok: false,
          code: "VALIDATION",
          message: `Unité packaging '${pl.typeUnitAbbr}' introuvable`,
          retryable: false,
        };
      }
      const containsUnit = resolveUnitByAbbr(opts.units, pl.containsUnitAbbr);
      if (!containsUnit) {
        return {
          ok: false,
          code: "VALIDATION",
          message: `Unité contenu packaging '${pl.containsUnitAbbr}' introuvable`,
          retryable: false,
        };
      }
      packagingLevels.push({
        id: typeUnit.id,
        type: typeUnit.name,
        type_unit_id: typeUnit.id,
        containsQuantity: pl.containsQuantity,
        containsUnit: containsUnit.name,
        contains_unit_id: containsUnit.id,
      });
    }
  }

  // ── 7. Build complete WizardState ──
  const wizardState: WizardState = {
    currentStep: 5,

    // Identity
    productName: input.name.trim(),
    productCode: input.code?.trim() ?? "",
    identitySupplierId: supplier.id,

    // Structure
    finalUnit: finalUnit.abbreviation,
    finalUnitId: finalUnit.id,

    // Packaging
    hasPackaging: input.hasPackaging ?? false,
    packagingLevels,

    // Billing
    billedQuantity: String(input.billedQuantity),
    billedUnit: billedUnit.abbreviation,
    billedUnitId: billedUnit.id,
    lineTotal: String(input.lineTotal),
    priceLevel: null,

    // Management
    deliveryUnitId: null,
    stockHandlingUnitId: null,
    priceDisplayUnitId,

    // Classification
    category: "",
    categoryId,
    storageZoneId: zone.id,
    minStockQuantity: input.minStockQuantity != null ? String(input.minStockQuantity) : "",
    minStockUnitId: minStockUnitId,
    initialStockQuantity: input.initialStockQuantity != null ? String(input.initialStockQuantity) : "",
    initialStockUnitId: initialStockUnitId,
    barcode: input.barcode?.trim() ?? "",
    dlcWarningDays: input.dlcWarningDays != null ? String(input.dlcWarningDays) : "",

    // Input config (auto-computed by pipeline)
    inputConfigReceptionMode: null,
    inputConfigReceptionUnitId: null,
    inputConfigReceptionChain: null,
    inputConfigReceptionPartial: false,
    inputConfigInternalMode: null,
    inputConfigInternalUnitId: null,
    inputConfigInternalChain: null,
    inputConfigInternalPartial: false,

    allowUnitSale: input.allowUnitSale ?? false,
  };

  // ── 8. Build initialData for info_produit passthrough ──
  const initialData: ProductV3InitialData | null = input.infoProduit
    ? {
        nom_produit: input.name,
        quantite_commandee: null,
        prix_total_ligne: null,
        unite_facturee: null,
        code_produit: null,
        info_produit: input.infoProduit,
      }
    : null;

  // ── 9. Get current user ──
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? "headless";

  // ── 10. Call pipeline ──
  const dbUnits = opts.units.map((u) => ({
    id: u.id,
    name: u.name,
    abbreviation: u.abbreviation,
    family: u.family,
    category: u.family ?? "custom",
    is_reference: false,
    aliases: null as string[] | null,
  }));

  const dbConversions = opts.conversions.map((c) => ({
    id: `${c.from_unit_id}-${c.to_unit_id}`,
    from_unit_id: c.from_unit_id,
    to_unit_id: c.to_unit_id,
    factor: c.factor,
    establishment_id: input.establishmentId as string | null,
    is_active: true,
  }));

  const collisionChecker = async (
    estId: string,
    payload: { code_barres?: string; code_produit?: string; nom_produit: string },
  ) => {
    return checkProductV2Collision(estId, payload);
  };

  const upsertFn = async (estId: string, payload: Parameters<typeof upsertProductV2>[1]) => {
    return upsertProductV2(estId, payload);
  };

  return createProductPipeline({
    wizardState,
    establishmentId: input.establishmentId,
    userId,
    dbUnits,
    dbConversions,
    initialData,
    collisionChecker,
    saveInputConfigFn: saveInputConfigDirect,
    upsertFn,
  });
}
