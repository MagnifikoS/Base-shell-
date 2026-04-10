/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE — resolveProductUnitContext (SSOT service, UUID-only, BFS-driven)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for all unit resolution across modules:
 * - Wizard Step 4 & 5
 * - Inventory CountingModal (mobile)
 * - Inventory Product Drawer (desktop)
 * - Price display resolver
 *
 * RULES:
 * - 0 hardcode, 0 text matching, UUID-only
 * - Physical units (weight/volume) are EXCLUDED from inventory entry
 *   when canonical is NOT a physical unit (e.g. Burrata canonical=pce → no kg/g)
 * - Variable weight detection: billing=physical + no fixed equivalence → canonical=billing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ConversionRule, UnitWithFamily } from "./types";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import { findConversionPath } from "@/modules/conditionnementV2";

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductUnitInput {
  stock_handling_unit_id: string | null;
  final_unit_id: string | null;
  delivery_unit_id?: string | null;
  supplier_billing_unit_id?: string | null;
  conditionnement_config?: ConditioningConfig | null;
}

/**
 * Same input but from Wizard state (not yet persisted)
 */
export interface WizardUnitInput {
  finalUnitId: string | null;
  billedUnitId: string | null;
  packagingLevels: PackagingLevel[];
  equivalence: Equivalence | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type UnitOptionKind =
  | "target"
  | "delivery"
  | "billing"
  | "packaging"
  | "equivalence"
  | "physical"
  | "reference";

export interface ReachableUnit {
  id: string;
  name: string;
  abbreviation: string;
  kind: UnitOptionKind;
  /** Conversion factor from this unit to target unit (for inventory) */
  factorToTarget: number;
  /** Unit family from measurement_units (e.g. "weight", "volume", "count", "packaging") */
  family?: string | null;
}

export interface ProductUnitContext {
  /** Canonical inventory unit ID */
  canonicalInventoryUnitId: string | null;
  /** Human label for canonical */
  canonicalLabel: string | null;
  /** Units allowed for inventory entry (chips in mobile, dropdown in desktop) */
  allowedInventoryEntryUnits: ReachableUnit[];
  /** Units allowed for price display dropdown */
  allowedPriceDisplayUnits: ReachableUnit[];
  /** Units allowed for kitchen/recipe selection (usage_category=kitchen) */
  allowedKitchenUnitIds: string[];
  /** Delivery unit candidates (packaging types only) */
  deliveryUnitCandidates: ReachableUnit[];
  /** Whether the product needs configuration (missing target) */
  needsConfiguration: boolean;
  /** HARDENING P3: stock_handling_unit_id diverges from canonical (stale config) */
  hasStaleStockHandlingUnit: boolean;
  /** Diagnostic info */
  diagnostic: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isPhysicalFamily(unit: UnitWithFamily): boolean {
  return unit.family === "weight" || unit.family === "volume";
}

/**
 * Normalisation map: abbreviation → target unit abbreviation.
 * g → kg, ml → L, cl → L. Everything else stays as-is.
 */
const NORMALIZATION_MAP: Record<string, string> = {
  g: "kg",
  ml: "L",
  cl: "L",
};

/**
 * resolveCanonical — SINGLE RULE, no special branches:
 *
 * 1. Walk the packaging tree to find the deepest terminal unit
 *    (the `contains_unit_id` of the last level, or `baseTargetId` if no levels)
 * 2. Normalize: g→kg, ml/cl→L
 * 3. Return the resulting unit ID
 */
function resolveCanonical(
  baseTargetId: string | null,
  packagingLevels: PackagingLevel[],
  dbUnits: UnitWithFamily[]
): string | null {
  if (!baseTargetId) return null;

  // ── Step 1: Find the deepest terminal unit in the packaging tree ──
  // The tree is ordered top-down: Level[0] is outermost (e.g. Carton),
  // Level[last] is innermost. The terminal unit is:
  //   - contains_unit_id of the LAST level (if levels exist and it has one)
  //   - otherwise baseTargetId (finalUnit)
  let terminalUnitId = baseTargetId;

  if (packagingLevels.length > 0) {
    // Walk from last to first to find the deepest contains_unit_id
    for (let i = packagingLevels.length - 1; i >= 0; i--) {
      const lvl = packagingLevels[i];
      if (lvl.contains_unit_id) {
        terminalUnitId = lvl.contains_unit_id;
        break;
      }
    }
  }

  // ── Step 2: Normalize g→kg, ml/cl→L ──
  const terminalUnit = dbUnits.find((u) => u.id === terminalUnitId);
  if (!terminalUnit) return terminalUnitId; // unit not in DB — return as-is

  const targetAbbr = NORMALIZATION_MAP[terminalUnit.abbreviation];
  if (targetAbbr) {
    const normalizedUnit = dbUnits.find((u) => u.abbreviation === targetAbbr);
    if (normalizedUnit) return normalizedUnit.id;
  }

  return terminalUnitId;
}

function collectCandidates(
  packagingLevels: PackagingLevel[],
  equivalence: Equivalence | null,
  finalUnitId: string | null,
  billedUnitId: string | null,
  deliveryUnitId: string | null,
  dbConversions: ConversionRule[]
): Map<string, UnitOptionKind> {
  const candidates = new Map<string, UnitOptionKind>();

  if (finalUnitId) candidates.set(finalUnitId, "reference");
  if (billedUnitId && !candidates.has(billedUnitId)) {
    candidates.set(billedUnitId, "billing");
  }
  if (deliveryUnitId && !candidates.has(deliveryUnitId)) {
    candidates.set(deliveryUnitId, "delivery");
  }

  for (const level of packagingLevels) {
    if (level.type_unit_id && !candidates.has(level.type_unit_id)) {
      candidates.set(level.type_unit_id, "packaging");
    }
    if (level.contains_unit_id && !candidates.has(level.contains_unit_id)) {
      candidates.set(level.contains_unit_id, "packaging");
    }
  }

  if (equivalence) {
    if (equivalence.source_unit_id && !candidates.has(equivalence.source_unit_id)) {
      candidates.set(equivalence.source_unit_id, "equivalence");
    }
    if (equivalence.unit_id && !candidates.has(equivalence.unit_id)) {
      candidates.set(equivalence.unit_id, "equivalence");
    }
  }

  // Expand one level via DB conversions
  const extra = new Set<string>();
  for (const rule of dbConversions) {
    if (!rule.is_active) continue;
    if (candidates.has(rule.from_unit_id) && !candidates.has(rule.to_unit_id)) {
      extra.add(rule.to_unit_id);
    }
    if (candidates.has(rule.to_unit_id) && !candidates.has(rule.from_unit_id)) {
      extra.add(rule.from_unit_id);
    }
  }
  for (const uid of extra) {
    if (!candidates.has(uid)) {
      candidates.set(uid, "physical");
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE — From persisted product data
// ─────────────────────────────────────────────────────────────────────────────

export function resolveProductUnitContext(
  product: ProductUnitInput,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): ProductUnitContext {
  const config = product.conditionnement_config;

  // ── PATCH 2: Detect legacy conditioning (text-based instead of UUID) ──
  const rawLevels = config?.packagingLevels ?? [];
  const hasLegacyConditioning =
    rawLevels.length > 0 &&
    rawLevels.some(
      (lvl: PackagingLevel) =>
        (lvl.type && !lvl.type_unit_id) || (lvl.containsUnit && !lvl.contains_unit_id)
    );

  if (hasLegacyConditioning) {
    return {
      canonicalInventoryUnitId: null,
      canonicalLabel: null,
      allowedInventoryEntryUnits: [],
      allowedPriceDisplayUnits: [],
      allowedKitchenUnitIds: [],
      deliveryUnitCandidates: [],
      needsConfiguration: true,
      hasStaleStockHandlingUnit: false,
      diagnostic: [
        "Conditionnement legacy détecté — format texte au lieu de UUID. Mise à jour via Wizard requise.",
      ],
    };
  }

  const packagingLevels: PackagingLevel[] = rawLevels;
  const equivalence: Equivalence | null = config?.equivalence ?? null;
  const billingId = product.supplier_billing_unit_id ?? null;
  const finalUnitId = product.final_unit_id ?? null;
  const deliveryUnitId = product.delivery_unit_id ?? null;

  // P2-1 FIX: If stock_handling_unit_id is NULL, product needs configuration.
  // We still allow fallback to finalUnitId for BFS graph resolution (read-only display),
  // but we flag needsConfiguration = true so the UI can block counting.
  const hasExplicitStock = !!product.stock_handling_unit_id;
  const baseTargetId = product.stock_handling_unit_id ?? finalUnitId;

  const result = resolveContext({
    baseTargetId,
    billingId,
    finalUnitId,
    deliveryUnitId,
    packagingLevels,
    equivalence,
    dbUnits,
    dbConversions,
  });

  // P2-1: Override needsConfiguration if stock_handling_unit_id was not explicitly set
  if (!hasExplicitStock && !result.needsConfiguration) {
    return {
      ...result,
      needsConfiguration: true,
      diagnostic: [
        ...result.diagnostic,
        "stock_handling_unit_id is NULL — product needs Wizard Step 4 validation",
      ],
    };
  }

  // HARDENING P3: Detect stale stock_handling_unit_id
  const isStale =
    hasExplicitStock &&
    result.canonicalInventoryUnitId !== null &&
    product.stock_handling_unit_id !== result.canonicalInventoryUnitId;
  if (isStale) {
    result.hasStaleStockHandlingUnit = true;
    result.diagnostic.push(
      `Unités incohérentes : stock_handling (${product.stock_handling_unit_id}) ≠ canonical calculé (${result.canonicalInventoryUnitId})`
    );
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE — From Wizard state (not yet persisted)
// ─────────────────────────────────────────────────────────────────────────────

export function resolveWizardUnitContext(
  input: WizardUnitInput,
  deliveryUnitId: string | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): ProductUnitContext {
  return resolveContext({
    baseTargetId: input.finalUnitId,
    billingId: input.billedUnitId,
    finalUnitId: input.finalUnitId,
    deliveryUnitId,
    packagingLevels: input.packagingLevels,
    equivalence: input.equivalence,
    dbUnits,
    dbConversions,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

interface ResolveInput {
  baseTargetId: string | null;
  billingId: string | null;
  finalUnitId: string | null;
  deliveryUnitId: string | null;
  packagingLevels: PackagingLevel[];
  equivalence: Equivalence | null;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
}

function resolveContext(input: ResolveInput): ProductUnitContext {
  const {
    baseTargetId,
    billingId,
    finalUnitId,
    deliveryUnitId,
    packagingLevels,
    equivalence,
    dbUnits,
    dbConversions,
  } = input;

  const diagnostic: string[] = [];

  // 1. Canonical
  const canonicalId = resolveCanonical(baseTargetId, packagingLevels, dbUnits);

  if (!canonicalId) {
    return {
      canonicalInventoryUnitId: null,
      canonicalLabel: null,
      allowedInventoryEntryUnits: [],
      allowedPriceDisplayUnits: [],
      allowedKitchenUnitIds: [],
      deliveryUnitCandidates: [],
      needsConfiguration: true,
      hasStaleStockHandlingUnit: false,
      diagnostic: ["No canonical unit: stock_handling_unit_id and final_unit_id are both null"],
    };
  }

  const canonicalUnit = dbUnits.find((u) => u.id === canonicalId);
  const canonicalLabel = canonicalUnit
    ? `${canonicalUnit.name} (${canonicalUnit.abbreviation})`
    : null;
  const canonicalIsPhysical = canonicalUnit ? isPhysicalFamily(canonicalUnit) : false;

  // 2. Collect all candidate IDs
  const candidates = collectCandidates(
    packagingLevels,
    equivalence,
    finalUnitId,
    billingId,
    deliveryUnitId,
    dbConversions
  );

  // Ensure canonical is in candidates
  if (!candidates.has(canonicalId)) {
    candidates.set(canonicalId, "target");
  }

  // 3. BFS: Inventory entry units (reachable TO canonical)
  const inventoryEntry: ReachableUnit[] = [];

  for (const [unitId, kind] of candidates) {
    const unit = dbUnits.find((u) => u.id === unitId);
    if (!unit) continue;

    // Cross-family units (e.g. kg when canonical is Sachet) are now allowed
    // as long as a BFS conversion path exists. The hard-block in the withdrawal
    // popup guarantees safety if no path is found.
    // Previously excluded: if (!canonicalIsPhysical && isPhysicalFamily(unit)) continue;

    if (unitId === canonicalId) {
      inventoryEntry.push({
        id: unitId,
        name: unit.name,
        abbreviation: unit.abbreviation,
        kind: "target",
        factorToTarget: 1,
        family: unit.family,
      });
      continue;
    }

    const path = findConversionPath(
      unitId,
      canonicalId,
      dbUnits,
      dbConversions,
      packagingLevels,
      equivalence
    );

    if (path.reached && path.factor !== null) {
      inventoryEntry.push({
        id: unitId,
        name: unit.name,
        abbreviation: unit.abbreviation,
        kind,
        factorToTarget: path.factor,
        family: unit.family,
      });
    } else {
      diagnostic.push(`No BFS path: ${unit.abbreviation} → canonical`);
    }
  }

  // Sort: target first, then delivery, packaging, reference, equivalence, physical, billing
  const kindOrder: Record<UnitOptionKind, number> = {
    target: 0,
    delivery: 1,
    packaging: 2,
    reference: 3,
    equivalence: 4,
    physical: 5,
    billing: 6,
  };
  inventoryEntry.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);

  // 4. BFS: Price display units (reachable FROM base price unit = finalUnitId)
  const priceDisplayUnits: ReachableUnit[] = [];
  const basePriceUnitId = finalUnitId;

  if (basePriceUnitId) {
    for (const [unitId] of candidates) {
      const unit = dbUnits.find((u) => u.id === unitId);
      if (!unit) continue;

      if (unitId === basePriceUnitId) {
        priceDisplayUnits.push({
          id: unitId,
          name: unit.name,
          abbreviation: unit.abbreviation,
          kind: "reference",
          factorToTarget: 1,
          family: unit.family,
        });
        continue;
      }

      const path = findConversionPath(
        unitId,
        basePriceUnitId,
        dbUnits,
        dbConversions,
        packagingLevels,
        equivalence
      );

      if (path.reached && path.factor !== null) {
        priceDisplayUnits.push({
          id: unitId,
          name: unit.name,
          abbreviation: unit.abbreviation,
          kind: "reference",
          factorToTarget: path.factor,
          family: unit.family,
        });
      }
    }

    // Sort: base first then alphabetical
    priceDisplayUnits.sort((a, b) => {
      if (a.id === basePriceUnitId) return -1;
      if (b.id === basePriceUnitId) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  // 5. Delivery candidates (packaging types only from packaging levels)
  const deliveryCandidates: ReachableUnit[] = [];
  const addedDelivery = new Set<string>();
  for (const level of packagingLevels) {
    if (level.type_unit_id && !addedDelivery.has(level.type_unit_id)) {
      const unit = dbUnits.find((u) => u.id === level.type_unit_id);
      if (unit) {
        deliveryCandidates.push({
          id: unit.id,
          name: unit.name,
          abbreviation: unit.abbreviation,
          kind: "delivery",
          factorToTarget: 1,
        });
        addedDelivery.add(unit.id);
      }
    }
  }

  // 6. Kitchen units are not BFS-driven — they come from usage_category=kitchen filter
  // This is handled at the hook level (useUnits.kitchenUnits), not here.
  // We just return an empty array to signify "use hook's kitchenUnits directly".

  return {
    canonicalInventoryUnitId: canonicalId,
    canonicalLabel,
    allowedInventoryEntryUnits: inventoryEntry,
    allowedPriceDisplayUnits: priceDisplayUnits,
    allowedKitchenUnitIds: [],
    deliveryUnitCandidates: deliveryCandidates,
    needsConfiguration: false,
    hasStaleStockHandlingUnit: false,
    diagnostic,
  };
}
