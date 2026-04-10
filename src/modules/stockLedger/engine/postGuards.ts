/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST GUARDS — Verification logic before POSTing a document
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RULES:
 * - Document must be DRAFT
 * - Active snapshot must exist for the zone
 * - Optimistic lock_version must match
 * - Idempotency key generated at POST
 * - All lines must have valid canonical data
 * - Stock Zéro Simple V2: clamp universel côté backend
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { StockDocument, StockDocumentLine, ZoneStockSnapshot } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// PRE-POST VALIDATION (pure — no DB calls)
// ═══════════════════════════════════════════════════════════════════════════

export interface PrePostValidationInput {
  document: StockDocument;
  lines: StockDocumentLine[];
  zoneSnapshot: ZoneStockSnapshot | null;
  expectedLockVersion: number;
}

export interface PrePostValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate all preconditions before POSTing a document.
 * Pure function — no side effects.
 */
export function validatePrePost(input: PrePostValidationInput): PrePostValidationResult {
  const errors: string[] = [];

  // 1. Document must be DRAFT
  if (input.document.status !== "DRAFT") {
    errors.push(
      `Document status is "${input.document.status}" — only DRAFT documents can be posted.`
    );
  }

  // 2. Active snapshot must exist for the zone (P0-C)
  if (!input.zoneSnapshot) {
    errors.push(
      `Aucun snapshot actif pour la zone "${input.document.storage_zone_id}". ` +
        `Impossible de poster un mouvement sans inventaire de référence. ` +
        `Effectuez un inventaire complet de cette zone d'abord.`
    );
  }

  // 3. Optimistic locking (P0: lock_version check)
  if (input.document.lock_version !== input.expectedLockVersion) {
    errors.push(
      `Document modifié ailleurs (version attendue: ${input.expectedLockVersion}, ` +
        `version actuelle: ${input.document.lock_version}). Rechargez et réessayez.`
    );
  }

  // 4. Must have at least one line
  if (input.lines.length === 0) {
    errors.push("Le document ne contient aucune ligne. Ajoutez au moins un produit.");
  }

  // 5. All lines must have valid canonical data
  for (const line of input.lines) {
    if (!line.canonical_unit_id) {
      errors.push(`Ligne produit ${line.product_id}: unité canonique manquante.`);
    }
    if (!line.canonical_family) {
      errors.push(`Ligne produit ${line.product_id}: famille canonique manquante.`);
    }
    if (!line.context_hash) {
      errors.push(`Ligne produit ${line.product_id}: context_hash manquant.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a deterministic idempotency key for a POST operation.
 * Based on: document_id + establishment_id + lock_version.
 *
 * This key prevents duplicate POST if the same request is retried.
 */
export function generateIdempotencyKey(
  documentId: string,
  establishmentId: string,
  lockVersion: number = 0
): string {
  // STK-LED-030: Deterministic key (no Date.now()) — same inputs produce same key for idempotency
  return `post_${establishmentId}_${documentId}_v${lockVersion}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// NEGATIVE STOCK CHECK — DEPRECATED (Stock Zéro Simple V2)
// ═══════════════════════════════════════════════════════════════════════════
// The backend now handles clamping universally in fn_post_stock_document.
// These types and functions are kept temporarily for backward compatibility
// with any external consumers but are functionally unused.

/** @deprecated Stock Zéro Simple V2 — backend clamp handles this */
export interface NegativeStockCheck {
  product_id: string;
  current_estimated: number;
  delta: number;
  resulting_stock: number;
}

/**
 * @deprecated Stock Zéro Simple V2 — backend clamp handles this.
 * Kept for backward compatibility. Always returns empty array conceptually
 * but preserves original logic for any remaining callers.
 */
export function checkNegativeStock(
  lines: StockDocumentLine[],
  currentEstimates: Map<string, number>
): NegativeStockCheck[] {
  const negatives: NegativeStockCheck[] = [];

  for (const line of lines) {
    const current = currentEstimates.get(line.product_id) ?? 0;
    const resulting = Math.round((current + line.delta_quantity_canonical) * 10000) / 10000;

    if (resulting < 0) {
      negatives.push({
        product_id: line.product_id,
        current_estimated: current,
        delta: line.delta_quantity_canonical,
        resulting_stock: resulting,
      });
    }
  }

  return negatives;
}
