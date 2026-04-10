/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCTS V2 — Price Display Resolver (Graph-driven, UUID-only)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Converts the stored `final_unit_price` to any reachable display unit
 * using the BFS conversion graph.
 *
 * RULES:
 * - NEVER modifies `final_unit_price` in DB
 * - Read-only conversion for UI display
 * - UUID-only, zero hardcode, zero text matching
 * - Returns null if no conversion path exists
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import type { ConditioningConfig } from "../types";
import { findConversionPath } from "@/modules/conditionnementV2";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PriceDisplayProduct {
  final_unit_price: number | null;
  final_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  price_display_unit_id: string | null;
  conditionnement_config: ConditioningConfig | null;
}

export interface PriceDisplayOption {
  unitId: string;
  name: string;
  abbreviation: string;
}

export interface PriceDisplayResult {
  /** Original stored price */
  basePrice: number | null;
  /** Unit of the stored price (final_unit_id) */
  baseUnitId: string | null;
  baseUnitAbbr: string | null;
  /** Unit chosen for display */
  displayUnitId: string | null;
  displayUnitAbbr: string | null;
  /** Converted price in display unit (null if no path) */
  convertedPrice: number | null;
  /** Conversion factor from base to display unit */
  factor: number | null;
  /** Available display unit options (graph-reachable) */
  displayOptions: PriceDisplayOption[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export function resolveDisplayPrice(
  product: PriceDisplayProduct,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): PriceDisplayResult {
  const basePrice = product.final_unit_price;
  const baseUnitId = product.final_unit_id;
  const displayUnitId = product.price_display_unit_id ?? baseUnitId;

  const baseUnit = baseUnitId ? dbUnits.find((u) => u.id === baseUnitId) : null;
  const displayUnit = displayUnitId ? dbUnits.find((u) => u.id === displayUnitId) : null;

  // Extract packaging & equivalence from config
  const config = product.conditionnement_config;
  const packagingLevels: PackagingLevel[] = config?.packagingLevels ?? [];
  const equivalence: Equivalence | null = config?.equivalence ?? null;

  // ── Build reachable display options ──
  // Collect candidate unit IDs from product config
  const candidateIds = new Set<string>();

  if (baseUnitId) candidateIds.add(baseUnitId);
  if (product.supplier_billing_unit_id) candidateIds.add(product.supplier_billing_unit_id);

  for (const level of packagingLevels) {
    if (level.type_unit_id) candidateIds.add(level.type_unit_id);
    if (level.contains_unit_id) candidateIds.add(level.contains_unit_id);
  }

  if (equivalence) {
    if (equivalence.source_unit_id) candidateIds.add(equivalence.source_unit_id);
    if (equivalence.unit_id) candidateIds.add(equivalence.unit_id);
  }

  // Expand by one level via DB conversions
  for (const rule of dbConversions) {
    if (!rule.is_active) continue;
    if (candidateIds.has(rule.from_unit_id)) candidateIds.add(rule.to_unit_id);
    if (candidateIds.has(rule.to_unit_id)) candidateIds.add(rule.from_unit_id);
  }

  // Filter: only those with a valid BFS path FROM baseUnitId
  const displayOptions: PriceDisplayOption[] = [];

  if (baseUnitId) {
    for (const unitId of candidateIds) {
      const unit = dbUnits.find((u) => u.id === unitId);
      if (!unit) continue;

      if (unitId === baseUnitId) {
        displayOptions.push({
          unitId,
          name: unit.name,
          abbreviation: unit.abbreviation,
        });
        continue;
      }

      // Price conversion: base → display means we need factor from base to display
      // If base is "per pièce" and display is "per carton", and 1 carton = 12 pièces,
      // then price per carton = price per pièce * 12
      // So we need findConversionPath(displayUnit → baseUnit) to get factor,
      // then multiply: displayPrice = basePrice * factor
      const result = findConversionPath(
        unitId,
        baseUnitId,
        dbUnits,
        dbConversions,
        packagingLevels,
        equivalence
      );

      if (result.reached && result.factor !== null) {
        displayOptions.push({
          unitId,
          name: unit.name,
          abbreviation: unit.abbreviation,
        });
      }
    }
  }

  // Sort: base unit first, then alphabetical
  displayOptions.sort((a, b) => {
    if (a.unitId === baseUnitId) return -1;
    if (b.unitId === baseUnitId) return 1;
    return a.name.localeCompare(b.name);
  });

  // ── Compute converted price ──
  let convertedPrice: number | null = null;
  let factor: number | null = null;

  if (basePrice !== null && baseUnitId && displayUnitId) {
    if (displayUnitId === baseUnitId) {
      convertedPrice = basePrice;
      factor = 1;
    } else {
      // Price per displayUnit = basePrice * (how many baseUnits in 1 displayUnit)
      // = basePrice * factorFromDisplayToBase
      const result = findConversionPath(
        displayUnitId,
        baseUnitId,
        dbUnits,
        dbConversions,
        packagingLevels,
        equivalence
      );

      if (result.reached && result.factor !== null) {
        factor = result.factor;
        convertedPrice = basePrice * result.factor;
      }
    }
  }

  return {
    basePrice,
    baseUnitId,
    baseUnitAbbr: baseUnit?.abbreviation ?? null,
    displayUnitId,
    displayUnitAbbr: displayUnit?.abbreviation ?? null,
    convertedPrice,
    factor,
    displayOptions,
  };
}
