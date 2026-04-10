/**
 * ═══════════════════════════════════════════════════════════════════════════
 * B2B Monitor — Lightweight observability for cross-org unit translations
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tracks 4 KPIs via brain_events (fire-and-forget, non-blocking):
 *   1. B2B_FALLBACK_USED  — text fallback triggered (UUID mapping miss)
 *   2. B2B_SUSPICIOUS_QTY — abnormal translated quantity (< 0.001 or > 100k)
 *   3. B2B_MAPPING_MISS   — no mapping found at all for a product
 *   4. B2B_TRANSLATION_OK — successful UUID-based translation (for rate calc)
 *
 * DEDUP: Each (action, productId) pair is tracked at most once per session
 * to prevent event spam from re-renders. The Set resets on page reload.
 *
 * Target: fallback rate < 1%, suspicious qty = 0
 */

import { brainSafeLog } from "@/modules/theBrain/services/brainEventsService";

const SUBJECT = "b2b_unit_translation";

/** Session-scoped dedup — prevents repeat events on re-renders */
const seen = new Set<string>();

function once(key: string, fn: () => void): void {
  if (seen.has(key)) return;
  seen.add(key);
  fn();
}

interface FallbackEvent {
  productId: string;
  label: string | null;
  supplierOptionsCount: number;
  establishmentId?: string | null;
}

interface SuspiciousQtyEvent {
  productId: string;
  qty: number;
  factor: number;
  establishmentId?: string | null;
}

interface MappingMissEvent {
  productId: string;
  clientUnitId?: string | null;
  establishmentId?: string | null;
}

/** Track when text fallback is used instead of UUID mapping */
export function trackFallbackUsed(event: FallbackEvent): void {
  const estId = event.establishmentId;
  if (!estId) return;

  once(`fallback-${event.productId}-${event.label}`, () => {
    brainSafeLog({
      establishmentId: estId,
      subject: SUBJECT,
      action: "fallback_used",
      context: {
        product_id: event.productId,
        label: event.label,
        supplier_options_count: event.supplierOptionsCount,
      },
    });
  });
}

/** Track suspicious translated quantities */
export function trackSuspiciousQty(event: SuspiciousQtyEvent): void {
  const estId = event.establishmentId;
  if (!estId) return;

  once(`suspicious-${event.productId}`, () => {
    brainSafeLog({
      establishmentId: estId,
      subject: SUBJECT,
      action: "suspicious_qty",
      context: {
        product_id: event.productId,
        qty: event.qty,
        factor: event.factor,
      },
    });
  });
}

/** Track when no mapping exists at all */
export function trackMappingMiss(event: MappingMissEvent): void {
  const estId = event.establishmentId;
  if (!estId) return;

  once(`miss-${event.productId}-${event.clientUnitId}`, () => {
    brainSafeLog({
      establishmentId: estId,
      subject: SUBJECT,
      action: "mapping_miss",
      context: {
        product_id: event.productId,
        client_unit_id: event.clientUnitId,
      },
    });
  });
}

/** Track successful UUID-based translation (for fallback rate calculation) */
export function trackTranslationOk(productId: string, establishmentId?: string | null): void {
  if (!establishmentId) return;

  once(`ok-${productId}`, () => {
    brainSafeLog({
      establishmentId,
      subject: SUBJECT,
      action: "translation_ok",
      context: { product_id: productId },
    });
  });
}

/**
 * Check if a translated quantity looks suspicious.
 * Returns true if qty is positive but abnormally small or large.
 */
export function isSuspiciousQty(qty: number): boolean {
  if (qty <= 0) return false;
  return qty < 0.001 || qty > 100_000;
}
