/**
 * ═══════════════════════════════════════════════════════════════════════════
 * resolveProductDerived — Pure functions extracted from Wizard V3
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RÈGLES:
 * - Fonctions pures (zéro side effect)
 * - Aucun import React, aucun hook, aucun useState
 * - Fidèles à la logique du wizard — aucune simplification
 *
 * Sources:
 * - ProductFormV3Modal.tsx (useMemo derivations)
 * - useWizardState.ts (equivalenceObject, autoDeducedPriceLevel)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { resolveWizardUnitContext, resolveProductUnitContext } from "@/core/unitConversion/resolveProductUnitContext";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { Equivalence, PriceLevel, PackagingLevel } from "@/modules/conditionnementV2";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import type {
  DeliveryUnitInput,
  StockHandlingUnitInput,
  EquivalenceInput,
  AutoDeducePriceLevelInput,
  CanonicalQuantityInput,
  CanonicalQuantityResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseLocalFloat
// ─────────────────────────────────────────────────────────────────────────────
// À déplacer dans buildProductPayload — PR-2

/**
 * Normalise les séparateurs décimaux français (virgule → point) avant parseFloat.
 * Source: ProductFormV3Modal.tsx L18-21
 */
export function parseLocalFloat(v: string | null | undefined): number {
  if (!v) return 0;
  return parseFloat(v.replace(",", ".")) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. resolveEffectiveDeliveryUnitId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deduces the effective delivery_unit_id from the current product structure.
 * Validates legacy values against the current structure's valid unit set.
 *
 * Source: ProductFormV3Modal.tsx L232-265
 *
 * 5 branches (faithful extraction — no simplification):
 * 1. Build valid unit ID set from structure (final, billed, packaging levels)
 * 2. If explicit deliveryUnitId exists AND is valid → keep it
 * 3. If packaging exists → first packaging level's type_unit_id
 * 4. If billed unit is weight/volume → fallback to finalUnitId
 * 5. Otherwise → billedUnitId
 */
export function resolveEffectiveDeliveryUnitId(
  input: DeliveryUnitInput,
  dbUnits: UnitWithFamily[]
): string | null {
  const { deliveryUnitId, packagingLevels, billedUnitId, finalUnitId } = input;

  // Branch 1: Build set of valid unit IDs from current product structure
  const validUnitIds = new Set<string>();
  if (finalUnitId) validUnitIds.add(finalUnitId);
  if (billedUnitId) validUnitIds.add(billedUnitId);
  for (const lvl of packagingLevels) {
    if (lvl.type_unit_id) validUnitIds.add(lvl.type_unit_id);
    if (lvl.contains_unit_id) validUnitIds.add(lvl.contains_unit_id);
  }

  // Branch 2: If user/legacy value exists, only keep it if it belongs to the current structure
  if (deliveryUnitId && validUnitIds.has(deliveryUnitId)) {
    return deliveryUnitId;
  }

  // Branch 3: Fallback — first packaging level
  if (packagingLevels.length > 0) {
    return packagingLevels[0].type_unit_id ?? null;
  }

  // Branch 4: Billed unit is weight/volume → fallback to finalUnitId
  const billedId = billedUnitId;
  if (billedId && dbUnits.length > 0) {
    const billedUnit = dbUnits.find((u) => u.id === billedId);
    if (billedUnit && (billedUnit.family === "weight" || billedUnit.family === "volume")) {
      return finalUnitId ?? null;
    }
  }

  // Branch 5: Otherwise → billedUnitId
  return billedId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. resolveEffectivePriceDisplayUnitId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the price display unit: explicit selection or fallback to finalUnitId.
 * Source: ProductFormV3Modal.tsx L268-269
 */
export function resolveEffectivePriceDisplayUnitId(
  priceDisplayUnitId: string | null | undefined,
  finalUnitId: string | null | undefined
): string | null {
  return priceDisplayUnitId ?? finalUnitId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. resolveEffectiveStockHandlingUnitId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-calculates stock_handling_unit_id via resolveWizardUnitContext (BFS).
 *
 * DÉPENDANCE SÉQUENTIELLE : 
 * appeler resolveEffectiveDeliveryUnitId() 
 * avant cette fonction
 *
 * Source: ProductFormV3Modal.tsx L272-298
 */
export function resolveEffectiveStockHandlingUnitId(
  input: StockHandlingUnitInput,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): string | null {
  if (!input.finalUnitId) return null;

  const ctx = resolveWizardUnitContext(
    {
      finalUnitId: input.finalUnitId,
      billedUnitId: input.billedUnitId,
      packagingLevels: input.packagingLevels,
      equivalence: input.equivalence,
    },
    input.deliveryUnitId,
    dbUnits,
    dbConversions
  );

  return ctx.canonicalInventoryUnitId;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. resolveEquivalenceObject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the Equivalence object from wizard state fields.
 * Returns null if equivalence is disabled or incomplete.
 *
 * Source: useWizardState.ts L354-375
 */
export function resolveEquivalenceObject(input: EquivalenceInput): Equivalence | null {
  if (!input.hasEquivalence) return null;
  if (!input.finalUnit || !input.equivalenceQuantity || !input.equivalenceUnit) return null;

  const qty = parseFloat(input.equivalenceQuantity);
  if (isNaN(qty) || qty <= 0) return null;

  return {
    source: input.finalUnit,
    source_unit_id: input.finalUnitId,
    quantity: qty,
    unit: input.equivalenceUnit,
    unit_id: input.equivalenceUnitId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. autoDeducePriceLevel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Automatically deduces the price level from billing context.
 *
 * Source: useWizardState.ts L381-421
 *
 * 5 branches (faithful extraction — no fusion, no simplification):
 * 1. billedUnit matches a packaging level's type_unit_id → "level"
 * 2. billedUnitId === finalUnitId → "final"
 * 3. billedUnitId !== finalUnitId AND doesn't match any packaging → "billed_physical"
 * 4. finalUnit exists (catch-all) → "final"
 * 5. Nothing matches → null
 */
export function autoDeducePriceLevel(input: AutoDeducePriceLevelInput): PriceLevel | null {
  const { billedUnit, billedUnitId, finalUnit, finalUnitId, packagingLevels } = input;

  // Guard: need billedUnit text to proceed
  if (!billedUnit) return null;

  // Branch 1: Check if billedUnitId matches a packaging level
  if (billedUnitId) {
    for (const level of packagingLevels) {
      if (level.type_unit_id && level.type_unit_id === billedUnitId) {
        return { type: "level", levelId: level.id, label: `au ${level.type}` };
      }
    }
  }

  // Branch 2: billedUnitId equals finalUnitId → final
  if (billedUnitId && finalUnitId && billedUnitId === finalUnitId) {
    return { type: "final", label: `à l'unité (${finalUnit})` };
  }

  // Branch 3: billedUnitId differs from finalUnitId AND no packaging match → billed_physical
  if (billedUnitId && finalUnitId && billedUnitId !== finalUnitId) {
    const matchesLevel = packagingLevels.some(
      (l) => l.type_unit_id && l.type_unit_id === billedUnitId
    );
    if (!matchesLevel) {
      return {
        type: "billed_physical",
        billedUnit: billedUnit,
        billed_unit_id: billedUnitId,
        label: `au ${billedUnit}`,
      };
    }
  }

  // Branch 4: finalUnit exists → fallback to "final"
  if (finalUnit) {
    return { type: "final", label: `à l'unité (${finalUnit})` };
  }

  // Branch 5: nothing matches → null
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. resolveEffectivePriceLevel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the effective price level: auto-deduced takes priority over manual.
 * Source: ProductFormV3Modal.tsx L161
 */
export function resolveEffectivePriceLevel(
  autoDeducedPriceLevel: PriceLevel | null,
  manualPriceLevel: PriceLevel | null
): PriceLevel | null {
  return autoDeducedPriceLevel || manualPriceLevel;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. resolveCanonicalQuantity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a raw quantity + selected unit to canonical (stock handling) units
 * using BFS factorToTarget from resolveProductUnitContext.
 *
 * Fusion of resolveCanonicalMinStock (L308-336) and resolveCanonicalInitialStock (L339-367).
 * Both had identical logic — this is the single implementation.
 *
 * CONTRAT : condConfig doit être identique à celui
 * produit par buildConditioningConfig() dans le même appel.
 * Ne jamais appeler cette fonction avec un condConfig 
 * recalculé indépendamment.
 *
 * Source: ProductFormV3Modal.tsx L308-367
 */
export function resolveCanonicalQuantity(
  input: CanonicalQuantityInput,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): CanonicalQuantityResult {
  const { rawQty, selectedUnitId, stockHandlingUnitId, deliveryUnitId, billedUnitId, finalUnitId, condConfig } = input;

  if (!rawQty || rawQty <= 0) return { qty: null, unitId: null };
  if (!selectedUnitId) return { qty: null, unitId: null };

  const productInput = {
    stock_handling_unit_id: stockHandlingUnitId,
    final_unit_id: finalUnitId,
    delivery_unit_id: deliveryUnitId,
    supplier_billing_unit_id: billedUnitId,
    conditionnement_config: condConfig,
  };

  const context = resolveProductUnitContext(productInput, dbUnits, dbConversions);
  const canonicalUnitId = context.canonicalInventoryUnitId;

  if (!canonicalUnitId) return { qty: rawQty, unitId: selectedUnitId };

  if (selectedUnitId === canonicalUnitId) {
    return { qty: Math.round(rawQty * 10000) / 10000, unitId: canonicalUnitId };
  }

  const unitEntry = context.allowedInventoryEntryUnits.find((u) => u.id === selectedUnitId);
  if (!unitEntry) {
    return { qty: Math.round(rawQty * 10000) / 10000, unitId: selectedUnitId };
  }

  const canonicalQty = Math.round(rawQty * unitEntry.factorToTarget * 10000) / 10000;
  return { qty: canonicalQty, unitId: canonicalUnitId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. buildPriceLevelOptions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the list of available PriceLevelOption from the product's physical structure.
 * Pure enumeration — zero deduction logic.
 *
 * The auto-deduced option (from autoDeducePriceLevel) is placed first if it exists
 * and matches a structural option.
 *
 * Source: useWizardState.ts L278-349 (extracted & simplified in PR-6)
 */
/** Option entry for price level selection UI */
export interface PriceLevelOption {
  value: string;
  label: string;
  priceLevel: PriceLevel;
}

export interface BuildPriceLevelOptionsInput {
  packagingLevels: PackagingLevel[];
  finalUnit: string | null;
  finalUnitId: string | null;
  hasEquivalence: boolean | null;
  equivalenceQuantity: string;
  equivalenceUnit: string;
  /** Auto-deduced level from autoDeducePriceLevel — used to prioritize ordering */
  autoDeduced: PriceLevel | null;
}

export function buildPriceLevelOptions(input: BuildPriceLevelOptionsInput): PriceLevelOption[] {
  const { packagingLevels, finalUnit, finalUnitId, hasEquivalence, equivalenceQuantity, equivalenceUnit, autoDeduced } = input;

  const options: PriceLevelOption[] = [];
  const addedKeys = new Set<string>();

  // ── 1. Packaging level options ──
  for (const level of packagingLevels) {
    if (level.type && level.type_unit_id) {
      const key = `level_${level.id}`;
      if (!addedKeys.has(key)) {
        const label = `au ${level.type}`;
        options.push({
          value: key,
          label,
          priceLevel: { type: "level", levelId: level.id, label },
        });
        addedKeys.add(key);
      }
    }
  }

  // ── 2. Final unit option ──
  if (finalUnit && finalUnitId) {
    if (!addedKeys.has("final")) {
      const label = `à l'unité (${finalUnit})`;
      options.push({ value: "final", label, priceLevel: { type: "final", label } });
      addedKeys.add("final");
    }
  }

  // ── 3. Equivalence option ──
  if (hasEquivalence && equivalenceQuantity && equivalenceUnit) {
    if (!addedKeys.has("equivalence")) {
      const label = `au/à la ${finalUnit}`;
      options.push({ value: "equivalence", label, priceLevel: { type: "equivalence", label } });
      addedKeys.add("equivalence");
    }
  }

  // ── 4. billed_physical option (from autoDeduced if applicable) ──
  if (autoDeduced && autoDeduced.type === "billed_physical") {
    const key = "billed_physical";
    if (!addedKeys.has(key)) {
      options.push({
        value: key,
        label: autoDeduced.label,
        priceLevel: autoDeduced,
      });
      addedKeys.add(key);
    }
  }

  // ── 5. Re-order: move autoDeduced match to front ──
  if (autoDeduced) {
    const matchIdx = options.findIndex((o) => {
      if (autoDeduced.type === "level" && o.priceLevel.type === "level") {
        return (o.priceLevel as PriceLevel & { levelId?: string }).levelId === (autoDeduced as PriceLevel & { levelId?: string }).levelId;
      }
      return o.priceLevel.type === autoDeduced.type;
    });
    if (matchIdx > 0) {
      const [match] = options.splice(matchIdx, 1);
      options.unshift(match);
    }
  }

  return options;
}
