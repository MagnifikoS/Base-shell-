/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTEXT HASH — Deterministic hash for stock event auditing
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * RULES:
 * - Depends ONLY on: canonical_unit_id, equivalences, packaging levels, billing_mode
 * - NO timestamp, NO random ID, NO JSON insertion order dependency
 * - Packaging levels sorted by type_unit_id for determinism
 * - Captured at POST time, never recalculated to interpret events
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { ContextHashInput } from "../types";

/**
 * Build a deterministic string representation of the context,
 * then hash it with a simple but collision-resistant algorithm.
 */
export function computeContextHash(input: ContextHashInput): string {
  const parts: string[] = [];

  // 1. Canonical unit (always present)
  parts.push(`CU:${input.canonical_unit_id}`);

  // 2. Billing unit
  parts.push(`BU:${input.billing_unit_id ?? "NULL"}`);

  // 3. Packaging levels — sorted by type_unit_id for determinism
  const sortedLevels = [...input.packaging_levels].sort((a, b) => {
    const aKey = a.type_unit_id ?? "";
    const bKey = b.type_unit_id ?? "";
    return aKey.localeCompare(bKey);
  });

  for (const level of sortedLevels) {
    parts.push(
      `PL:${level.type_unit_id ?? "NULL"}|${level.contains_unit_id ?? "NULL"}|${level.quantity}`
    );
  }

  // 4. Equivalence
  if (input.equivalence) {
    parts.push(
      `EQ:${input.equivalence.source_unit_id ?? "NULL"}|${input.equivalence.unit_id ?? "NULL"}|${input.equivalence.quantity ?? "NULL"}`
    );
  } else {
    parts.push("EQ:NONE");
  }

  // 5. Deterministic join
  const raw = parts.join(";");

  // 6. Simple hash (FNV-1a 32-bit — deterministic, fast, no crypto needed)
  return fnv1a32(raw);
}

/**
 * FNV-1a 32-bit hash — deterministic, fast, good distribution.
 * Returns hex string.
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to unsigned 32-bit then hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build ContextHashInput from a product's current configuration.
 * Called at POST time to capture the "epoch" of the product config.
 */
export function buildContextHashInput(params: {
  canonical_unit_id: string;
  billing_unit_id: string | null;
  packaging_levels: Array<{
    type_unit_id: string | null;
    contains_unit_id: string | null;
    quantity: number;
  }>;
  equivalence: {
    source_unit_id: string | null;
    unit_id: string | null;
    quantity: number | null;
  } | null;
}): ContextHashInput {
  return {
    canonical_unit_id: params.canonical_unit_id,
    billing_unit_id: params.billing_unit_id,
    packaging_levels: params.packaging_levels,
    equivalence: params.equivalence,
  };
}
