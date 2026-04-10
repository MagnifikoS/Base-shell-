/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WIZARD GRAPH VALIDATOR — Zero Unit Conflict Guarantee
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure functions to validate:
 * - Graph connectivity (all units reachable from reference)
 * - No cycles in packaging
 * - No duplicate packaging types
 * - No self-referencing packaging
 * - Positive quantities (integer for discrete, decimal OK for weight/volume)
 * - All management units have valid conversion paths
 *
 * SSOT: findConversionPath (BFS) for path checks.
 */

import type { PackagingLevel, Equivalence } from "./types";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import { findConversionPath } from "./conversionGraph";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphError {
  /** Machine-readable error code */
  code: string;
  /** User-facing message (FR) */
  message: string;
  /** Actionable fix suggestion (FR) */
  fix: string;
  /** Which wizard step to navigate to for fix */
  step?: number;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphError[];
}

export interface PackagingValidationResult {
  valid: boolean;
  errors: GraphError[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PACKAGING-LEVEL VALIDATION (Step 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a single packaging level for basic integrity.
 *
 * @param dbUnits — optional unit list; when provided, weight/volume content
 *   units accept decimal quantities (e.g. 2.5 kg). Without it the validator
 *   falls back to integer-only (safe default).
 */
export function validatePackagingLevel(
  level: PackagingLevel,
  index: number,
  allLevels: PackagingLevel[],
  finalUnitId: string | null,
  dbUnits?: UnitWithFamily[]
): GraphError[] {
  const errors: GraphError[] = [];
  const levelLabel = `Niveau ${index + 1}`;

  // 1. Self-reference: type === content
  if (level.type_unit_id && level.contains_unit_id && level.type_unit_id === level.contains_unit_id) {
    errors.push({
      code: "SELF_REF",
      message: `${levelLabel} : un conditionnement ne peut pas se contenir lui-même.`,
      fix: "Choisir une unité de contenu différente du type.",
      step: 3,
    });
  }

  // 2. Quantity must be positive; decimals allowed only for weight/volume content units
  const contentUnit = dbUnits?.find((u) => u.id === level.contains_unit_id);
  const contentIsPhysical = contentUnit?.family === "weight" || contentUnit?.family === "volume";

  if (level.containsQuantity === null || level.containsQuantity === undefined) {
    errors.push({
      code: "MISSING_QTY",
      message: `${levelLabel} : quantité manquante.`,
      fix: contentIsPhysical
        ? "Renseigner la quantité contenue (> 0)."
        : "Renseigner la quantité contenue (nombre entier > 0).",
      step: 3,
    });
  } else if (level.containsQuantity <= 0) {
    errors.push({
      code: "INVALID_QTY",
      message: `${levelLabel} : la quantité doit être > 0. Reçu : ${level.containsQuantity}.`,
      fix: contentIsPhysical
        ? "Corriger la quantité (ex: 0.5, 2.5, 10)."
        : "Corriger la quantité (ex: 6, 12, 24).",
      step: 3,
    });
  } else if (!contentIsPhysical && !Number.isInteger(level.containsQuantity)) {
    // Discrete units (Pièce, Carton…) must remain integer
    errors.push({
      code: "INVALID_QTY",
      message: `${levelLabel} : la quantité doit être un nombre entier > 0. Reçu : ${level.containsQuantity}.`,
      fix: "Corriger la quantité (ex: 6, 12, 24).",
      step: 3,
    });
  }

  // 3. Duplicate type_unit_id (same packaging type used twice)
  if (level.type_unit_id) {
    const duplicates = allLevels.filter(
      (l) => l.id !== level.id && l.type_unit_id === level.type_unit_id
    );
    if (duplicates.length > 0) {
      errors.push({
        code: "DUPLICATE_TYPE",
        message: `${levelLabel} : le type "${level.type}" est déjà utilisé dans un autre niveau.`,
        fix: "Supprimer le doublon ou utiliser un type différent.",
        step: 3,
      });
    }
  }

  // 4. Duplicate exact relation (same type→content pair)
  if (level.type_unit_id && level.contains_unit_id) {
    const dupeRelation = allLevels.find(
      (l) =>
        l.id !== level.id &&
        l.type_unit_id === level.type_unit_id &&
        l.contains_unit_id === level.contains_unit_id
    );
    if (dupeRelation) {
      errors.push({
        code: "DUPLICATE_RELATION",
        message: `${levelLabel} : la relation "${level.type} → ${level.containsUnit}" existe déjà.`,
        fix: "Supprimer le doublon.",
        step: 3,
      });
    }
  }

  return errors;
}

/**
 * Detect cycles in the packaging chain.
 * Build a directed graph from packaging levels and detect if any cycle exists.
 */
export function detectPackagingCycles(levels: PackagingLevel[]): GraphError[] {
  const errors: GraphError[] = [];
  const edges = new Map<string, Set<string>>();

  for (const level of levels) {
    if (!level.type_unit_id || !level.contains_unit_id) continue;
    if (!edges.has(level.type_unit_id)) edges.set(level.type_unit_id, new Set());
    edges.get(level.type_unit_id)!.add(level.contains_unit_id);
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true; // cycle found
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neighbor of edges.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(node);
    return false;
  }

  for (const node of edges.keys()) {
    if (dfs(node)) {
      errors.push({
        code: "CYCLE",
        message: "Cycle détecté dans les niveaux de conditionnement (ex: Carton → Boîte → Carton).",
        fix: "Supprimer la relation circulaire. Chaque niveau doit descendre vers l'unité de référence.",
        step: 3,
      });
      break; // One error is enough
    }
  }

  return errors;
}

/**
 * Verify each packaging level can reach the reference unit via the chain.
 */
export function validatePackagingReachability(
  levels: PackagingLevel[],
  finalUnitId: string | null,
  equivalence: Equivalence | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): GraphError[] {
  if (!finalUnitId || levels.length === 0) return [];
  const errors: GraphError[] = [];

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (!level.type_unit_id) continue;

    const result = findConversionPath(
      level.type_unit_id,
      finalUnitId,
      dbUnits,
      dbConversions,
      levels,
      equivalence
    );

    if (!result.reached) {
      errors.push({
        code: "UNREACHABLE_PACKAGING",
        message: `Niveau ${i + 1} ("${level.type}") n'a aucun chemin vers l'unité de référence.`,
        fix: `Vérifier que "${level.type}" descend bien vers l'unité de référence via la chaîne de conditionnement.`,
        step: 3,
      });
    }
  }

  return errors;
}

/**
 * Validate all packaging levels at once.
 */
export function validateAllPackaging(
  levels: PackagingLevel[],
  finalUnitId: string | null,
  equivalence: Equivalence | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): PackagingValidationResult {
  const errors: GraphError[] = [];

  // Per-level checks
  for (let i = 0; i < levels.length; i++) {
    errors.push(...validatePackagingLevel(levels[i], i, levels, finalUnitId, dbUnits));
  }

  // Cycle detection
  errors.push(...detectPackagingCycles(levels));

  // Reachability (only if no cycle)
  if (!errors.some((e) => e.code === "CYCLE")) {
    errors.push(...validatePackagingReachability(levels, finalUnitId, equivalence, dbUnits, dbConversions));
  }

  // Deduplicate by code+message
  const unique = Array.from(new Map(errors.map((e) => [`${e.code}:${e.message}`, e])).values());

  return { valid: unique.length === 0, errors: unique };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIT REACHABILITY CHECK (for billing, delivery, management units)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a specific unit can reach the reference unit.
 * Returns a descriptive error if not.
 */
export function validateUnitReachability(
  unitId: string | null,
  unitLabel: string,
  finalUnitId: string | null,
  finalUnitLabel: string | null,
  levels: PackagingLevel[],
  equivalence: Equivalence | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
  step: number
): GraphError | null {
  if (!unitId || !finalUnitId) return null;
  if (unitId === finalUnitId) return null;

  const result = findConversionPath(unitId, finalUnitId, dbUnits, dbConversions, levels, equivalence);
  if (result.reached) return null;

  // Resolve display names
  const fromName = dbUnits.find((u) => u.id === unitId)?.name ?? unitId;
  const toName = finalUnitLabel ?? (dbUnits.find((u) => u.id === finalUnitId)?.name ?? "référence");

  return {
    code: "NO_PATH",
    message: `Tu as choisi "${fromName}" en ${unitLabel}.\nAucune conversion vers "${toName}" n'existe.`,
    fix: `Solutions :\n• Modifier l'unité de ${unitLabel.toLowerCase()}\n• Ajouter un conditionnement ${fromName} → contient X ${toName}\n• Modifier l'unité de référence`,
    step,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL GRAPH VALIDATION (Step 8 — before save)
// ─────────────────────────────────────────────────────────────────────────────

export interface GlobalValidationInput {
  finalUnitId: string | null;
  finalUnit: string | null;
  packagingLevels: PackagingLevel[];
  equivalence: Equivalence | null;
  billedUnitId: string | null;
  deliveryUnitId: string | null;
  stockHandlingUnitId: string | null;
  kitchenUnitId: string | null;
  priceDisplayUnitId: string | null;
  dbUnits: UnitWithFamily[];
  dbConversions: ConversionRule[];
}

/**
 * Complete validation of the entire unit graph.
 * Must pass before product creation/update.
 */
export function validateFullGraph(input: GlobalValidationInput): GraphValidationResult {
  const errors: GraphError[] = [];
  const {
    finalUnitId, finalUnit,
    packagingLevels, equivalence,
    billedUnitId, deliveryUnitId,
    stockHandlingUnitId, kitchenUnitId, priceDisplayUnitId,
    dbUnits, dbConversions,
  } = input;

  // 1. Reference unit must exist
  if (!finalUnitId) {
    errors.push({
      code: "NO_REF_UNIT",
      message: "Aucune unité de référence sélectionnée.",
      fix: "Retourner à l'étape Structure et choisir une unité de référence.",
      step: 2,
    });
    return { valid: false, errors };
  }

  // 2. Packaging validation
  const pkgResult = validateAllPackaging(packagingLevels, finalUnitId, equivalence, dbUnits, dbConversions);
  errors.push(...pkgResult.errors);

  // 3. Billing unit reachability
  const billingError = validateUnitReachability(
    billedUnitId, "Facturation", finalUnitId, finalUnit,
    packagingLevels, equivalence, dbUnits, dbConversions, 4
  );
  if (billingError) errors.push(billingError);

  // 4. Delivery unit reachability
  const deliveryError = validateUnitReachability(
    deliveryUnitId, "Livraison", finalUnitId, finalUnit,
    packagingLevels, equivalence, dbUnits, dbConversions, 5
  );
  if (deliveryError) errors.push(deliveryError);

  // 5. Inventory unit reachability
  const inventoryError = validateUnitReachability(
    stockHandlingUnitId, "Inventaire", finalUnitId, finalUnit,
    packagingLevels, equivalence, dbUnits, dbConversions, 5
  );
  if (inventoryError) errors.push(inventoryError);

  // 6. Price display unit reachability
  const priceError = validateUnitReachability(
    priceDisplayUnitId, "Prix affiché", finalUnitId, finalUnit,
    packagingLevels, equivalence, dbUnits, dbConversions, 5
  );
  if (priceError) errors.push(priceError);

  // 7. Kitchen unit reachability (only if set)
  const kitchenError = validateUnitReachability(
    kitchenUnitId, "Cuisine", finalUnitId, finalUnit,
    packagingLevels, equivalence, dbUnits, dbConversions, 5
  );
  if (kitchenError) errors.push(kitchenError);

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// REACHABLE UNITS FILTER (for dropdowns)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter a list of candidate units to only those reachable from/to the reference unit.
 * Used to dynamically restrict dropdown options in Steps 4 & 5.
 */
export function filterReachableUnits(
  candidateIds: string[],
  finalUnitId: string,
  levels: PackagingLevel[],
  equivalence: Equivalence | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[]
): string[] {
  return candidateIds.filter((id) => {
    if (id === finalUnitId) return true;
    const result = findConversionPath(id, finalUnitId, dbUnits, dbConversions, levels, equivalence);
    return result.reached;
  });
}
