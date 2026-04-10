/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VOID ENGINE — Exact inversion of POSTED documents (P0-D)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * RULES:
 * - Only POSTED documents can be voided
 * - Creates VOID events that exactly invert the original deltas
 * - References voids_document_id and voids_event_id
 * - Never UPDATE or DELETE existing events
 * - Pure function: builds void events, caller persists them
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { StockEvent, StockDocument } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// VOID EVENT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export interface VoidEventTemplate {
  establishment_id: string;
  organization_id: string;
  storage_zone_id: string;
  product_id: string;
  document_id: string; // The VOID document ID (new)
  event_type: "VOID";
  event_reason: string;
  delta_quantity_canonical: number; // Exact inversion
  canonical_unit_id: string;
  canonical_family: string;
  canonical_label: string | null;
  context_hash: string;
  snapshot_version_id: string;
  override_flag: boolean;
  override_reason: string | null;
  posted_by: string;
  voids_event_id: string;
  voids_document_id: string;
}

export interface VoidPreparationResult {
  ok: boolean;
  error?: string;
  voidEvents?: VoidEventTemplate[];
}

/**
 * Prepare void events for a POSTED document.
 * Pure function: no DB calls.
 * 
 * @param document - The document being voided (must be POSTED)
 * @param originalEvents - Events from the original POST
 * @param voidDocumentId - ID of the new VOID document 
 * @param voidedBy - UUID of the user voiding
 * @param voidReason - Reason for voiding
 */
export function prepareVoidEvents(
  document: StockDocument,
  originalEvents: StockEvent[],
  voidDocumentId: string,
  voidedBy: string,
  voidReason: string
): VoidPreparationResult {
  // Guard: only POSTED documents can be voided
  if (document.status !== "POSTED") {
    return {
      ok: false,
      error: `Cannot void document with status "${document.status}". Only POSTED documents can be voided.`,
    };
  }

  // Guard: must have events to void
  if (originalEvents.length === 0) {
    return {
      ok: false,
      error: "No events found for this document. Cannot void.",
    };
  }

  // Build void events: exact inversion
  const voidEvents: VoidEventTemplate[] = originalEvents.map((event) => ({
    establishment_id: event.establishment_id,
    organization_id: event.organization_id,
    storage_zone_id: event.storage_zone_id,
    product_id: event.product_id,
    document_id: voidDocumentId,
    event_type: "VOID" as const,
    event_reason: voidReason,
    // EXACT INVERSION — opposite sign, same precision
    delta_quantity_canonical:
      Math.round(-event.delta_quantity_canonical * 10000) / 10000,
    canonical_unit_id: event.canonical_unit_id,
    canonical_family: event.canonical_family,
    canonical_label: event.canonical_label,
    context_hash: event.context_hash,
    snapshot_version_id: event.snapshot_version_id,
    override_flag: false,
    override_reason: null,
    posted_by: voidedBy,
    voids_event_id: event.id,
    voids_document_id: document.id,
  }));

  return { ok: true, voidEvents };
}

/**
 * Verify that void events exactly cancel the originals.
 * Sum of all deltas (original + void) must be exactly 0 per product.
 */
export function verifyVoidBalance(
  originalEvents: StockEvent[],
  voidEvents: VoidEventTemplate[]
): { balanced: boolean; discrepancies: string[] } {
  const productDeltas = new Map<string, number>();

  for (const e of originalEvents) {
    const current = productDeltas.get(e.product_id) ?? 0;
    productDeltas.set(
      e.product_id,
      Math.round((current + e.delta_quantity_canonical) * 10000) / 10000
    );
  }

  for (const e of voidEvents) {
    const current = productDeltas.get(e.product_id) ?? 0;
    productDeltas.set(
      e.product_id,
      Math.round((current + e.delta_quantity_canonical) * 10000) / 10000
    );
  }

  const discrepancies: string[] = [];
  for (const [productId, delta] of productDeltas) {
    if (delta !== 0) {
      discrepancies.push(
        `Product ${productId}: residual delta = ${delta} (should be 0)`
      );
    }
  }

  return {
    balanced: discrepancies.length === 0,
    discrepancies,
  };
}
