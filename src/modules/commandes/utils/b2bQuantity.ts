/**
 * B2B Quantity Translation — Single source of truth for cross-org conversions.
 *
 * canonical_quantity in commande_lines is always in CLIENT reference space.
 * The supplier sees/edits in their own reference space.
 *
 * These helpers convert between the two spaces using unit name/abbreviation matching
 * against the supplier's BFS-resolved unit options.
 */

import type { ReachableUnit } from "@/core/unitConversion/resolveProductUnitContext";
import { isSuspiciousQty, trackFallbackUsed, trackSuspiciousQty, trackMappingMiss, trackTranslationOk } from "./b2bMonitor";

export interface B2bTranslationResult {
  /** Translated quantity */
  quantity: number;
  /** The factorToTarget used for translation (needed for reverse conversion) */
  factor: number;
  /** Whether a matching unit was found */
  matched: boolean;
}

/**
 * Translate a client-space quantity to supplier-space.
 *
 * Example: 0.25 Carton (client) → 50 Pièce (supplier) if factorToTarget = 200
 *
 * @param clientQty         - Quantity in client canonical space
 * @param clientUnitLabel   - unit_label_snapshot from commande_line (client's unit name)
 * @param supplierOptions   - BFS-resolved units from supplier's product context
 * @param unitMapping       - Optional persisted UUID mapping { clientUnitId → supplierUnitId }
 * @param clientUnitId      - Optional client canonical_unit_id for UUID-based lookup
 * @param monitorCtx        - Optional context for monitoring events
 */
export function translateClientQtyToSupplier(
  clientQty: number,
  clientUnitLabel: string | null | undefined,
  supplierOptions: ReachableUnit[],
  unitMapping?: Record<string, string> | null,
  clientUnitId?: string | null,
  monitorCtx?: { productId?: string; establishmentId?: string | null },
): B2bTranslationResult {
  if (supplierOptions.length === 0) {
    return { quantity: clientQty, factor: 1, matched: false };
  }

  // ── Priority 1: UUID-based lookup via persisted mapping ──
  if (unitMapping && clientUnitId) {
    const supplierUnitId = unitMapping[clientUnitId];
    if (supplierUnitId) {
      const matchingUnit = supplierOptions.find((o) => o.id === supplierUnitId);
      if (matchingUnit) {
        const supplierQty = Math.round(clientQty * matchingUnit.factorToTarget * 10000) / 10000;
        if (import.meta.env.DEV) {
          console.info(
            `[b2bQuantity] client→supplier (UUID mapping): ${clientQty} × ${matchingUnit.factorToTarget} = ${supplierQty}`,
          );
        }
        // Monitor: track success + suspicious qty check
        if (monitorCtx) {
          trackTranslationOk(monitorCtx.productId ?? "", monitorCtx.establishmentId);
          if (isSuspiciousQty(supplierQty)) {
            trackSuspiciousQty({ productId: monitorCtx.productId ?? "", qty: supplierQty, factor: matchingUnit.factorToTarget, establishmentId: monitorCtx.establishmentId });
          }
        }
        return { quantity: supplierQty, factor: matchingUnit.factorToTarget, matched: true };
      }
    }
  }

  // ── Priority 2: Text-based fallback ──
  if (!clientUnitLabel) {
    // Monitor: no label + no UUID mapping = total miss
    if (monitorCtx) {
      trackMappingMiss({ productId: monitorCtx.productId ?? "", clientUnitId, establishmentId: monitorCtx.establishmentId });
    }
    return { quantity: clientQty, factor: 1, matched: false };
  }

  const matchingUnit = findMatchingUnit(clientUnitLabel, supplierOptions);

  if (!matchingUnit || matchingUnit.factorToTarget === 1) {
    if (!matchingUnit) {
      if (import.meta.env.DEV) {
        console.warn(
          `[b2bQuantity] B2B_UNIT_MATCH_FAIL client→supplier — ` +
          `label="${clientUnitLabel}" not found in supplier options: ` +
          `[${supplierOptions.map((o) => o.name).join(", ")}]. Using raw qty.`,
        );
      }
      // Monitor: text fallback also failed
      if (monitorCtx) {
        trackMappingMiss({ productId: monitorCtx.productId ?? "", clientUnitId, establishmentId: monitorCtx.establishmentId });
      }
    } else if (monitorCtx) {
      // Monitor: UUID mapping missed, text fallback used (factor=1 identity)
      trackFallbackUsed({ productId: monitorCtx.productId ?? "", label: clientUnitLabel, supplierOptionsCount: supplierOptions.length, establishmentId: monitorCtx.establishmentId });
    }
    return { quantity: clientQty, factor: 1, matched: matchingUnit?.factorToTarget === 1 };
  }

  // factorToTarget converts from the matched unit → supplier canonical
  // clientQty is expressed in that unit, so multiply
  const supplierQty = Math.round(clientQty * matchingUnit.factorToTarget * 10000) / 10000;

  // Monitor: text fallback was used (UUID mapping missed)
  if (monitorCtx) {
    trackFallbackUsed({ productId: monitorCtx.productId ?? "", label: clientUnitLabel, supplierOptionsCount: supplierOptions.length, establishmentId: monitorCtx.establishmentId });
    if (isSuspiciousQty(supplierQty)) {
      trackSuspiciousQty({ productId: monitorCtx.productId ?? "", qty: supplierQty, factor: matchingUnit.factorToTarget, establishmentId: monitorCtx.establishmentId });
    }
  }

  if (import.meta.env.DEV) {
    console.info(
      `[b2bQuantity] client→supplier: ${clientQty} "${clientUnitLabel}" × ${matchingUnit.factorToTarget} = ${supplierQty}`,
    );
  }

  return { quantity: supplierQty, factor: matchingUnit.factorToTarget, matched: true };
}

/**
 * Translate a supplier-space quantity back to client-space.
 *
 * This is the INVERSE of translateClientQtyToSupplier.
 * Used when the supplier confirms a modified quantity in the BFS modal.
 *
 * @param supplierQty - Quantity in supplier canonical space (from BFS modal)
 * @param factor      - The factorToTarget used in the original client→supplier translation
 */
export function translateSupplierQtyToClient(
  supplierQty: number,
  factor: number,
): number {
  if (factor === 0 || factor === 1) return supplierQty;
  const clientQty = Math.round(supplierQty / factor * 10000) / 10000;

  if (import.meta.env.DEV) {
    console.info(
      `[b2bQuantity] supplier→client: ${supplierQty} / ${factor} = ${clientQty}`,
    );
  }

  return clientQty;
}

/** Find a unit in supplier options by matching name or abbreviation */
function findMatchingUnit(
  label: string,
  options: ReachableUnit[],
): ReachableUnit | undefined {
  const normalized = label.toLowerCase().trim();
  return (
    options.find((o) => o.name.toLowerCase().trim() === normalized) ??
    options.find((o) => o.abbreviation.toLowerCase().trim() === normalized)
  );
}
