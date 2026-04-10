/**
 * ═══════════════════════════════════════════════════════════════════════════
 * resolveStockDisplay — SSOT for stock display across desktop & mobile
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single shared function that:
 *  1. Resolves the BFS unit context for a product
 *  2. Picks the display unit via the canonical cascade
 *  3. Computes a greedy breakdown (e.g. "2 cartons + 4 pièces")
 *
 * Consumers: EstimatedStockCell, StockBreakdownCell, MobileStockListView.
 * This file MUST NOT write to DB — purely ephemeral display logic.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import {
  resolveProductUnitContext,
  type ProductUnitInput,
  type ReachableUnit,
} from "@/core/unitConversion/resolveProductUnitContext";
import { computeDisplayBreakdown, type DisplayBreakdownResult } from "./computeDisplayBreakdown";
import { displayUnitName } from "@/lib/units/displayUnitName";
import type { ProductInputConfigRow } from "@/modules/inputConfig/types";
import { resolveInputUnitForContext } from "@/modules/inputConfig/utils/resolveInputUnitForContext";

// ── Input types ────────────────────────────────────────────────────────

export interface StockDisplayProductInput {
  stock_handling_unit_id?: string | null;
  final_unit_id?: string | null;
  delivery_unit_id?: string | null;
  supplier_billing_unit_id?: string | null;
  conditionnement_config?: unknown;
  /** Per-zone preferred display unit (from inventory_zone_products) */
  preferred_display_unit_id?: string | null;
  /** Product-level display unit preference */
  inventory_display_unit_id?: string | null;
}

export type StockUnitMode = "canonical" | "supplier";

// ── Output types ───────────────────────────────────────────────────────

export type StockDisplayResult =
  | { mode: "canonical"; result: DisplayBreakdownResult; canonicalName: string; isSimple: boolean }
  | { mode: "supplier"; qty: number; unitName: string }
  | { mode: "no_supplier" }
  | { mode: "no_conversion" }
  | null; // null = unit context not resolvable

// ── Main function ──────────────────────────────────────────────────────

/**
 * Resolve how a canonical stock quantity should be displayed for a product.
 *
 * @param product   - Product unit configuration fields
 * @param qty       - Canonical stock quantity (already clamped ≥ 0 by caller)
 * @param dbUnits   - Full unit referential
 * @param dbConversions - Conversion rules
 * @param stockUnitMode - "canonical" (default) or "supplier"
 */
export function resolveStockDisplay(
  product: StockDisplayProductInput,
  qty: number,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
  stockUnitMode: StockUnitMode = "canonical",
  inputConfig?: ProductInputConfigRow | null,
): StockDisplayResult {
  const productForGraph: ProductUnitInput = {
    stock_handling_unit_id: product.stock_handling_unit_id ?? null,
    final_unit_id: product.final_unit_id ?? null,
    delivery_unit_id: product.delivery_unit_id ?? null,
    supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
    conditionnement_config: product.conditionnement_config as ProductUnitInput["conditionnement_config"],
  };

  const unitContext = resolveProductUnitContext(productForGraph, dbUnits, dbConversions);
  if (unitContext.needsConfiguration || !unitContext.canonicalInventoryUnitId) return null;

  // ── Supplier mode ──────────────────────────────────────────────────
  if (stockUnitMode === "supplier") {
    const deliveryUnitId = product.delivery_unit_id;
    if (!deliveryUnitId) return { mode: "no_supplier" };
    const deliveryEntry =
      unitContext.allowedInventoryEntryUnits.find((u) => u.id === deliveryUnitId) ??
      unitContext.allowedPriceDisplayUnits.find((u) => u.id === deliveryUnitId);
    if (!deliveryEntry || deliveryEntry.factorToTarget === 0)
      return { mode: "no_conversion" };
    const converted = Math.round((qty / deliveryEntry.factorToTarget) * 10000) / 10000;
    const unitObj = dbUnits.find((u) => u.id === deliveryUnitId);
    return {
      mode: "supplier",
      qty: converted,
      unitName: unitObj ? displayUnitName(unitObj) : "?",
    };
  }

  // ── Canonical mode: cascade + breakdown ────────────────────────────
  const options = unitContext.allowedInventoryEntryUnits;
  const canonicalUnit = dbUnits.find((u) => u.id === unitContext.canonicalInventoryUnitId);
  const canonicalName = canonicalUnit ? displayUnitName(canonicalUnit) : "?";

  // ── Priority 1: product_input_config "internal" context ──────────
  // When an internal config exists, use its unit chain for display
  // instead of the family-based auto-upscale heuristic.
  if (inputConfig) {
    const productForResolution = {
      id: "display", // not used for resolution logic
      nom_produit: "",
      final_unit_id: product.final_unit_id ?? null,
      stock_handling_unit_id: product.stock_handling_unit_id ?? null,
      delivery_unit_id: product.delivery_unit_id ?? null,
      supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
      conditionnement_config: product.conditionnement_config,
    };
    const resolution = resolveInputUnitForContext(
      productForResolution,
      "internal",
      inputConfig,
      dbUnits,
      dbConversions,
    );

    if (resolution.status === "ok") {
      if (resolution.mode === "multi_level") {
        // Multi-level: filter options to only the configured chain
        const chainSet = new Set(resolution.unitChain);
        // Use reachableUnits from resolver (not filtered by family like options)
        const chainUnits = resolution.reachableUnits.filter((u) => chainSet.has(u.id));
        if (chainUnits.length > 0) {
          const topUnit = chainUnits.reduce((a, b) =>
            a.factorToTarget > b.factorToTarget ? a : b
          );
          const result = computeDisplayBreakdown(qty, topUnit.id, chainUnits);
          const isSimple = result.segments.length === 1;
          return { mode: "canonical", result, canonicalName, isSimple };
        }
      } else {
        // Single unit: direct conversion (bypass computeDisplayBreakdown family filter)
        const targetUnit = resolution.reachableUnits.find((u) => u.id === resolution.unitId);
        if (targetUnit && targetUnit.factorToTarget > 0) {
          const converted = Math.round((qty / targetUnit.factorToTarget) * 10000) / 10000;
          const unitObj = dbUnits.find((u) => u.id === resolution.unitId);
          const unitName = unitObj ? displayUnitName(unitObj) : targetUnit.name;
          const segment: DisplayBreakdownResult = {
            segments: [{ unitId: targetUnit.id, abbreviation: targetUnit.abbreviation, name: targetUnit.name, quantity: converted }],
            label: `${converted % 1 === 0 ? String(converted) : converted.toFixed(2)} ${unitName}`,
            canonicalTotal: qty,
            canonicalAbbreviation: canonicalUnit?.abbreviation ?? "?",
            canonicalName,
          };
          return { mode: "canonical", result: segment, canonicalName, isSimple: true };
        }
      }
    }
    // If resolution failed, fall through to legacy cascade
  }

  // ── Priority 2: Legacy cascade (preferred_display_unit → auto-upscale → canonical) ──
  const canonicalFamily = canonicalUnit?.family;

  // Auto-upscale: pick largest available unit of same family
  const sameFamilyOptions = canonicalFamily
    ? options.filter((o) => o.family === canonicalFamily || o.factorToTarget === 1)
    : options;
  const largestUnit =
    sameFamilyOptions.length > 1
      ? sameFamilyOptions.reduce((a, b) => (b.factorToTarget > a.factorToTarget ? b : a))
      : null;

  // Cascade: preferred (per-zone) → product-level → auto-upscale → canonical
  const displayUnitId =
    product.preferred_display_unit_id ??
    product.inventory_display_unit_id ??
    largestUnit?.id ??
    unitContext.canonicalInventoryUnitId;

  const result = computeDisplayBreakdown(qty, displayUnitId, options);
  const isSimple = result.segments.length === 1;

  return { mode: "canonical", result, canonicalName, isSimple };
}

// ── Convenience: get the allowedInventoryEntryUnits for a product ─────

export function getProductEntryUnits(
  product: StockDisplayProductInput,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): ReachableUnit[] {
  const productForGraph: ProductUnitInput = {
    stock_handling_unit_id: product.stock_handling_unit_id ?? null,
    final_unit_id: product.final_unit_id ?? null,
    delivery_unit_id: product.delivery_unit_id ?? null,
    supplier_billing_unit_id: product.supplier_billing_unit_id ?? null,
    conditionnement_config: product.conditionnement_config as ProductUnitInput["conditionnement_config"],
  };
  const ctx = resolveProductUnitContext(productForGraph, dbUnits, dbConversions);
  return ctx.allowedInventoryEntryUnits;
}
