/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VALIDATE PRODUCT PAYLOAD — Pre-persistence validation (PR-3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Centralizes all validations before product create/update.
 * Fail-fast: stops at the first error.
 *
 * - checkRequiredFields (sync)
 * - checkUnitExists (sync)
 * - validateGraph (sync — wraps validateFullGraph from conditionnementV2)
 * - checkCollision (async — caller-injected to avoid Supabase import)
 */

import type { PackagingLevel, Equivalence, UnitWithFamily, ConversionRule } from "./types";
import { validateFullGraph } from "@/modules/conditionnementV2";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | {
      valid: false;
      code: "MISSING_FIELD" | "UNIT_NOT_FOUND" | "GRAPH_INVALID" | "COLLISION";
      message: string;
      field?: string;
      unitId?: string;
    };

export interface ProductValidationInput {
  productName: string;
  supplierId: string | null;
  storageZoneId: string | null;
  finalUnitId: string | null;
  finalUnit: string | null;
  stockHandlingUnitId: string | null;
  billedUnitId: string | null;
  deliveryUnitId: string | null;
  priceDisplayUnitId: string | null;
  kitchenUnitId: string | null;
  packagingLevels: PackagingLevel[];
  equivalence: Equivalence | null;
  /** For collision check */
  establishmentId: string;
  codeProduit?: string;
  codeBarres?: string;
  /** Exclude this product id from collision (edit mode) */
  excludeId?: string;
}

/**
 * Injected collision checker — avoids direct Supabase import,
 * keeps this module pure and testable.
 * Callers pass the result of checkProductV2Collision from productsV2Service.
 */
export type CollisionChecker = (
  establishmentId: string,
  payload: { code_barres?: string; code_produit?: string; nom_produit: string },
  excludeId?: string,
) => Promise<{ hasCollision: boolean; collisionType: string | null; existingProductName: string | null }>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. checkRequiredFields (sync)
// ─────────────────────────────────────────────────────────────────────────────

export function checkRequiredFields(input: ProductValidationInput): ValidationResult {
  if (!input.productName?.trim()) {
    return { valid: false, code: "MISSING_FIELD", field: "productName", message: "Le nom du produit est obligatoire." };
  }
  if (!input.supplierId) {
    return { valid: false, code: "MISSING_FIELD", field: "supplierId", message: "Le fournisseur est obligatoire." };
  }
  if (!input.storageZoneId) {
    return { valid: false, code: "MISSING_FIELD", field: "storageZoneId", message: "La zone de stockage est obligatoire." };
  }
  if (!input.finalUnitId) {
    return { valid: false, code: "MISSING_FIELD", field: "finalUnitId", message: "L'unité de référence est obligatoire." };
  }
  if (!input.stockHandlingUnitId) {
    return { valid: false, code: "MISSING_FIELD", field: "stockHandlingUnitId", message: "L'unité de stock est obligatoire." };
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. checkUnitExists (sync)
// ─────────────────────────────────────────────────────────────────────────────

export function checkUnitExists(
  input: ProductValidationInput,
  dbUnits: UnitWithFamily[],
): ValidationResult {
  const unitIds = new Set(dbUnits.map((u) => u.id));

  const idsToCheck: Array<{ id: string | null | undefined; label: string }> = [
    { id: input.finalUnitId, label: "finalUnitId" },
    { id: input.billedUnitId, label: "billedUnitId" },
    { id: input.stockHandlingUnitId, label: "stockHandlingUnitId" },
    { id: input.deliveryUnitId, label: "deliveryUnitId" },
    { id: input.priceDisplayUnitId, label: "priceDisplayUnitId" },
  ];

  for (const level of input.packagingLevels) {
    if (level.type_unit_id) {
      idsToCheck.push({ id: level.type_unit_id, label: `packagingLevel[${level.id}].type_unit_id` });
    }
    if (level.contains_unit_id) {
      idsToCheck.push({ id: level.contains_unit_id, label: `packagingLevel[${level.id}].contains_unit_id` });
    }
  }

  for (const { id, label } of idsToCheck) {
    if (id && !unitIds.has(id)) {
      return {
        valid: false,
        code: "UNIT_NOT_FOUND",
        unitId: id,
        message: `L'unité "${label}" (${id}) n'existe pas dans la base.`,
      };
    }
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateGraph (sync — wraps conditionnementV2/validateFullGraph)
// ─────────────────────────────────────────────────────────────────────────────

export function validateGraph(
  input: ProductValidationInput,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): ValidationResult {
  const result = validateFullGraph({
    finalUnitId: input.finalUnitId,
    finalUnit: input.finalUnit,
    packagingLevels: input.packagingLevels,
    equivalence: input.equivalence,
    billedUnitId: input.billedUnitId,
    deliveryUnitId: input.deliveryUnitId,
    stockHandlingUnitId: input.stockHandlingUnitId,
    kitchenUnitId: input.kitchenUnitId,
    priceDisplayUnitId: input.priceDisplayUnitId,
    dbUnits,
    dbConversions,
  });

  if (!result.valid) {
    const firstError = result.errors[0];
    return {
      valid: false,
      code: "GRAPH_INVALID",
      message: firstError?.message ?? "Le graphe de conditionnement est invalide.",
    };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. checkCollision (async — uses injected checker)
// ─────────────────────────────────────────────────────────────────────────────

export async function checkCollision(
  input: ProductValidationInput,
  collisionChecker: CollisionChecker,
): Promise<ValidationResult> {
  const result = await collisionChecker(
    input.establishmentId,
    {
      nom_produit: input.productName,
      code_produit: input.codeProduit,
      code_barres: input.codeBarres,
    },
    input.excludeId,
  );

  if (result.hasCollision) {
    return {
      valid: false,
      code: "COLLISION",
      message: `Un produit "${result.existingProductName}" existe déjà (collision: ${result.collisionType}).`,
    };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — validateProductPayload (fail-fast)
// ─────────────────────────────────────────────────────────────────────────────

export async function validateProductPayload(
  input: ProductValidationInput,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
  collisionChecker: CollisionChecker,
): Promise<ValidationResult> {
  // 1. Required fields (sync)
  const reqResult = checkRequiredFields(input);
  if (!reqResult.valid) return reqResult;

  // 2. Unit existence (sync)
  const unitResult = checkUnitExists(input, dbUnits);
  if (!unitResult.valid) return unitResult;

  // 3. Graph validation (sync)
  const graphResult = validateGraph(input, dbUnits, dbConversions);
  if (!graphResult.valid) return graphResult;

  // 4. Collision check (async)
  const collisionResult = await checkCollision(input, collisionChecker);
  if (!collisionResult.valid) return collisionResult;

  return { valid: true };
}
