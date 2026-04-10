/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RESOLVE INPUT CONVERSION — Orchestrator-side conversion (outside modal)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Centralized conversion logic for quantity input flows.
 * Called by flow orchestrators (MobileWithdrawalView, MobileReceptionView)
 * AFTER the modal returns raw {unitId, quantity}.
 *
 * Uses the central BFS engine — no local calculation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { findConversionPath } from "@/modules/conditionnementV2";
import type { PackagingLevel, Equivalence } from "@/modules/conditionnementV2";
import { extractPackagingLevels, extractEquivalence } from "../engine/buildCanonicalLine";
import type { ConversionRule, UnitWithFamily } from "@/core/unitConversion/types";
import type { Json } from "@/integrations/supabase/types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversionResult {
  factor: number | null;
  error: string | null;
}

export interface QuantityEntry {
  unitId: string;
  quantity: number;
}

export interface CanonicalResult {
  canonicalQuantity: number;
  canonicalUnitId: string;
  canonicalFamily: string;
  canonicalLabel: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSION FACTOR RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve conversion factor from input unit to canonical unit using
 * the full conditionnementV2 graph (DB conversions + packaging levels + equivalence).
 * Returns { factor, error } — factor is null when conversion is impossible.
 */
export function resolveInputConversion(
  inputUnitId: string,
  canonicalUnitId: string,
  conditionnementConfig: Json | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): ConversionResult {
  // Identity — no conversion needed
  if (inputUnitId === canonicalUnitId) {
    return { factor: 1, error: null };
  }

  // Extract product-specific packaging data
  const rawLevels = extractPackagingLevels(conditionnementConfig);
  const rawEquivalence = extractEquivalence(conditionnementConfig);

  // Map to the types expected by findConversionPath
  const packagingLevels: PackagingLevel[] = rawLevels.map((l, i) => ({
    id: `level-${i}`,
    type: "",
    type_unit_id: l.type_unit_id,
    containsQuantity: l.quantity,
    containsUnit: "",
    contains_unit_id: l.contains_unit_id,
  }));

  const equivalence: Equivalence | null = rawEquivalence
    ? {
        source: "",
        source_unit_id: rawEquivalence.source_unit_id,
        quantity: rawEquivalence.quantity ?? 0,
        unit: "",
        unit_id: rawEquivalence.unit_id,
      }
    : null;

  // Use the full BFS graph from conditionnementV2
  const result = findConversionPath(
    inputUnitId,
    canonicalUnitId,
    dbUnits,
    dbConversions,
    packagingLevels,
    equivalence,
  );

  if (result.reached && result.factor !== null) {
    return { factor: result.factor, error: null };
  }

  // No path found — hard block
  const iName = dbUnits.find(u => u.id === inputUnitId)?.name ?? "unité saisie";
  const cName = dbUnits.find(u => u.id === canonicalUnitId)?.name ?? "unité stock";
  return {
    factor: null,
    error: `Conversion impossible : ${iName} → ${cName}. Vérifiez le conditionnement du produit.`,
  };
}

/**
 * Convert raw quantity entries to canonical quantity.
 * Used by orchestrators after modal returns raw entries.
 */
export function convertToCanonical(
  entries: QuantityEntry[],
  canonicalUnitId: string,
  conditionnementConfig: Json | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): { result: CanonicalResult | null; error: string | null } {
  let totalCanonical = 0;

  for (const entry of entries) {
    if (entry.quantity <= 0) continue;

    const conversion = resolveInputConversion(
      entry.unitId,
      canonicalUnitId,
      conditionnementConfig,
      dbUnits,
      dbConversions,
    );

    if (conversion.error || conversion.factor === null) {
      return { result: null, error: conversion.error };
    }

    totalCanonical += +(entry.quantity * conversion.factor).toFixed(4);
  }

  const unitInfo = dbUnits.find(u => u.id === canonicalUnitId);

  return {
    result: {
      canonicalQuantity: totalCanonical,
      canonicalUnitId,
      canonicalFamily: unitInfo?.family ?? unitInfo?.category ?? "unknown",
      canonicalLabel: unitInfo?.name ?? null,
    },
    error: null,
  };
}
