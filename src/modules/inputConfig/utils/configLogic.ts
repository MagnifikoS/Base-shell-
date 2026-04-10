/**
 * Pure DECLARATIVE logic for input configuration.
 *
 * ARCHITECTURE RULE (v2 — engine-aligned validation):
 *
 * This module is strictly declarative. It does NOT resolve units or convert.
 *
 * VALIDATION SOURCE OF TRUTH:
 * - computeConfigStatusFromChoices() validates saved config against the
 *   actual UnitChoice[] produced by buildUnitChoicesFromEngine (BFS-driven).
 *   This is the ONLY validation function used for status/badges.
 *
 * - getAllowedModes() is kept ONLY for:
 *   • BulkConfigDialog (where per-product BFS is impractical)
 *   • getDefaultModes() (sensible defaults for express config)
 *   It must NEVER be used for final validation or status computation.
 *
 * - ProductNature / classifyProductNature are kept ONLY for:
 *   • UX labels and hints
 *   • Default mode suggestions
 *   They must NEVER drive validation or status.
 */

import type {
  InputMode,
  ConfigStatus,
  UnitNature,
  ProductNature,
  ProductInputConfigRow,
} from "../types";
import type { UnitChoice } from "./buildUnitChoices";

// ─── UNIT NATURE ────────────────────────────────────────────

/**
 * Determines unit nature from measurement_units.family.
 * weight/volume → continuous, count → discrete.
 * This is a simple classification, not a conversion.
 */
export function resolveUnitNature(family: string | null | undefined): UnitNature {
  if (family === "weight" || family === "volume") return "continuous";
  return "discrete";
}

// ─── PRODUCT NATURE CLASSIFICATION ──────────────────────────

/**
 * Classifies the full physical nature of a product based on
 * its unit family, equivalence, and supplier context.
 *
 * PURPOSE: UX labels, default suggestions, display hints.
 * NOT FOR: validation, status computation, mode authorization.
 */
export function classifyProductNature(
  baseNature: UnitNature,
  hasEquivalence: boolean,
  equivalenceTargetFamily: UnitNature | null,
  supplierBillingFamily: UnitNature | null,
): ProductNature {
  if (baseNature === "continuous") return "continuous_pure";
  if (hasEquivalence && equivalenceTargetFamily === "continuous") {
    return "hybrid_discrete_continuous";
  }
  if (supplierBillingFamily === "continuous") {
    return "variable_weight";
  }
  return "discrete_pure";
}

// ═══════════════════════════════════════════════════════════════
// ENGINE-ALIGNED VALIDATION (v2) — Single source of truth
// ═══════════════════════════════════════════════════════════════

/**
 * Validates a saved config against engine-derived UnitChoice[] lists.
 *
 * This is the ONLY function that should determine config status.
 * It ensures perfect alignment: if a choice was proposable by the
 * dialog (buildUnitChoicesFromEngine), the saved config is valid.
 *
 * Returns per-context status so badges can reflect independent validity.
 */
export function computeConfigStatusFromChoices(
  config: ProductInputConfigRow | null,
  receptionChoices: UnitChoice[],
  internalChoices: UnitChoice[],
  reachableUnitIds?: Set<string>,
): { global: ConfigStatus; reception: ConfigStatus; internal: ConfigStatus } {
  if (!config) {
    return {
      global: "not_configured",
      reception: "not_configured",
      internal: "not_configured",
    };
  }

  // If the engine returned no choices (legacy conditioning, missing data),
  // we can't validate — flag for review
  if (receptionChoices.length === 0 || internalChoices.length === 0) {
    return {
      global: "needs_review",
      reception: receptionChoices.length === 0 ? "needs_review" : "configured",
      internal: internalChoices.length === 0 ? "needs_review" : "configured",
    };
  }

  const receptionValid = isContextConfigValid(
    config.reception_mode as InputMode,
    config.reception_preferred_unit_id,
    config.reception_unit_chain,
    receptionChoices,
    reachableUnitIds,
  );
  const internalValid = isContextConfigValid(
    config.internal_mode as InputMode,
    config.internal_preferred_unit_id,
    config.internal_unit_chain,
    internalChoices,
    reachableUnitIds,
  );

  const receptionStatus: ConfigStatus = receptionValid ? "configured" : "needs_review";
  const internalStatus: ConfigStatus = internalValid ? "configured" : "needs_review";
  const globalStatus: ConfigStatus =
    receptionValid && internalValid ? "configured" : "needs_review";

  return { global: globalStatus, reception: receptionStatus, internal: internalStatus };
}

/**
 * Validates a single context config (reception OR internal).
 *
 * INVARIANT:
 * - mode === "multi_level" → validate unit_chain against reachable units
 * - mode !== "multi_level" → validate preferred_unit_id against choices (existing logic)
 */
function isContextConfigValid(
  savedMode: InputMode,
  savedUnitId: string | null,
  savedUnitChain: string[] | null,
  choices: UnitChoice[],
  reachableUnitIds?: Set<string>,
): boolean {
  // ── Multi-level: validate unit_chain ──
  if (savedMode === "multi_level") {
    if (!savedUnitChain || savedUnitChain.length < 2) return false;
    // Check for duplicates
    if (new Set(savedUnitChain).size !== savedUnitChain.length) return false;
    // If we have reachable IDs, validate every unit in chain
    if (reachableUnitIds) {
      return savedUnitChain.every((id) => reachableUnitIds.has(id));
    }
    // Fallback: at least check chain is non-empty (reachableIds not available in bulk)
    return true;
  }

  // ── Simple modes: existing logic ──
  // CRITICAL: non-multi_level modes MUST have a preferred_unit_id
  if (!savedUnitId) return false;
  return isModeValidForChoices(savedMode, savedUnitId, choices);
}

/**
 * Checks if a saved mode + preferred unit matches any engine-derived choice.
 *
 * Handles the fraction ↔ integer+partial mapping:
 * - saved "fraction" is valid if there's a choice with mode="integer" and supportsPartial=true
 * - saved "integer" is valid if there's a choice with mode="integer"
 */
function isModeValidForChoices(
  savedMode: InputMode,
  savedUnitId: string | null,
  choices: UnitChoice[],
): boolean {
  // Fraction = integer + partial toggle enabled
  // Decimal and continuous are interchangeable for physical units
  let effectiveMode: InputMode = savedMode;
  if (savedMode === "fraction") effectiveMode = "integer";

  // 1. Try exact match: mode + unit
  if (savedUnitId) {
    const exactMatch = choices.some(
      (c) => areModeCompatible(effectiveMode, c.mode) && c.primaryUnitId === savedUnitId,
    );
    if (exactMatch) return true;
  }

  // 2. Mode-only match (unit may have changed but mode is still structurally valid)
  const modeMatch = choices.some((c) => areModeCompatible(effectiveMode, c.mode));
  if (modeMatch) {
    // For fraction, also verify that partial is actually supported
    if (savedMode === "fraction") {
      return choices.some((c) => c.mode === "integer" && c.supportsPartial);
    }
    return true;
  }

  return false;
}

/**
 * Checks if two modes are compatible for validation purposes.
 * "continuous" and "decimal" are compatible (both are physical-unit modes).
 */
function areModeCompatible(a: InputMode, b: InputMode): boolean {
  if (a === b) return true;
  const physicalModes = new Set<InputMode>(["continuous", "decimal"]);
  return physicalModes.has(a) && physicalModes.has(b);
}

// ═══════════════════════════════════════════════════════════════
// LEGACY / BULK HELPERS — NOT for final validation
// ═══════════════════════════════════════════════════════════════

/**
 * @deprecated for validation use. Use computeConfigStatusFromChoices instead.
 *
 * Still used by:
 * - BulkConfigDialog (where per-product BFS is impractical)
 * - getDefaultModes (sensible defaults)
 * - getCommonAllowedModes (bulk intersection)
 *
 * IMPORTANT: This is intentionally PERMISSIVE — it includes all modes
 * that could theoretically apply, to avoid false rejections in bulk.
 */
export function getAllowedModes(
  nature: UnitNature,
  levelsCount: number,
  context: "reception" | "internal",
  productNature?: ProductNature,
): InputMode[] {
  // ── Continuous pure ───────────────────────────────
  // When packaging levels exist, integer is valid (user can count packages)
  if (nature === "continuous" || productNature === "continuous_pure") {
    if (levelsCount === 0) return ["continuous", "decimal"];
    // With packaging: continuous (stepper), decimal (free input), integer (count packages), multi_level
    const modes: InputMode[] = ["continuous", "decimal", "integer"];
    if (context === "internal") modes.push("fraction");
    modes.push("multi_level");
    return modes;
  }

  // ── Hybrid discrete↔continuous ──
  if (productNature === "hybrid_discrete_continuous") {
    if (context === "reception") {
      const modes: InputMode[] = ["continuous", "decimal", "integer"];
      if (levelsCount > 0) modes.push("multi_level");
      return modes;
    }
    const modes: InputMode[] = ["integer", "fraction", "continuous", "decimal"];
    if (levelsCount > 0) modes.push("multi_level");
    return modes;
  }

  // ── Variable weight ──
  if (productNature === "variable_weight") {
    if (context === "reception") {
      const modes: InputMode[] = ["continuous", "decimal", "integer"];
      if (levelsCount > 0) modes.push("multi_level");
      return modes;
    }
    const modes: InputMode[] = ["integer", "fraction", "continuous", "decimal"];
    if (levelsCount > 0) modes.push("multi_level");
    return modes;
  }

  // ── Discrete pure ────────
  const base: InputMode[] = context === "reception"
    ? ["integer"]
    : ["integer", "fraction"];
  if (levelsCount > 0) base.push("multi_level");
  return base;
}

// ─── DEFAULT MODES ─────────────────────────────────

/**
 * Returns sensible default MODES for a product based on its structure.
 * Used for express/auto-configuration. NOT for validation.
 */
export function getDefaultModes(
  nature: UnitNature,
  levelsCount: number,
  productNature?: ProductNature,
): { reception_mode: InputMode; internal_mode: InputMode } {
  if (nature === "continuous" || productNature === "continuous_pure") {
    return {
      reception_mode: levelsCount > 0 ? "multi_level" : "continuous",
      internal_mode: "continuous",
    };
  }
  if (productNature === "hybrid_discrete_continuous") {
    return { reception_mode: "continuous", internal_mode: "integer" };
  }
  if (productNature === "variable_weight") {
    return { reception_mode: "continuous", internal_mode: "integer" };
  }
  return {
    reception_mode: levelsCount > 0 ? "multi_level" : "integer",
    internal_mode: "integer",
  };
}

// ─── BULK COMPATIBILITY ─────────────────────────────

/**
 * For a set of products, find the common allowed modes.
 * Returns null if no common modes exist.
 *
 * NOTE: Uses getAllowedModes (heuristic), not engine BFS.
 * This is a known limitation for bulk — acceptable because bulk
 * is approximate by nature and doesn't claim per-product precision.
 */
export function getCommonAllowedModes(
  products: Array<{
    unit_family: UnitNature;
    packaging_levels_count: number;
    product_nature: ProductNature;
  }>,
  context: "reception" | "internal",
): InputMode[] | null {
  if (products.length === 0) return null;

  const first = getAllowedModes(
    products[0].unit_family,
    products[0].packaging_levels_count,
    context,
    products[0].product_nature,
  );
  const common = first.filter((mode) =>
    products.every((p) =>
      getAllowedModes(p.unit_family, p.packaging_levels_count, context, p.product_nature).includes(mode),
    ),
  );

  return common.length > 0 ? common : null;
}

