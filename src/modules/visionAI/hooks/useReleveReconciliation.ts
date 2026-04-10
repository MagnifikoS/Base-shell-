/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — useReleveReconciliation Hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE: Orchestrates the reconciliation flow for Releve (statement of account).
 * Takes a ReleveExtractionResponse, calls the reconciliation service,
 * then applies guardrails — all in memory, READ-ONLY.
 *
 * ARCHITECTURE:
 * - Dynamic import of reconciliation service (lazy loading)
 * - Guardrails applied post-reconciliation (O(n), no AI call)
 * - Session-only state — nothing is persisted
 * - Latest-only guard to prevent stale results
 */

import { useState, useRef, useCallback } from "react";
import type { ReconciliationResult, ReleveExtractionResponse } from "../types/releveTypes";
import type { ReleveGuardrailResult } from "../plugins/visionReleveGuardrails";

interface UseReleveReconciliationReturn {
  reconciliation: ReconciliationResult | null;
  guardrails: ReleveGuardrailResult | null;
  isReconciling: boolean;
  error: string | null;
  reconcile: (
    extraction: ReleveExtractionResponse,
    establishmentId: string,
    knownSupplierId?: string | null
  ) => Promise<void>;
  reset: () => void;
}

export function useReleveReconciliation(): UseReleveReconciliationReturn {
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [guardrails, setGuardrails] = useState<ReleveGuardrailResult | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest-only guard: prevents stale reconciliation results
  const requestIdRef = useRef(0);

  const reconcile = useCallback(
    async (
      extraction: ReleveExtractionResponse,
      establishmentId: string,
      knownSupplierId?: string | null
    ): Promise<void> => {
      const localRequestId = ++requestIdRef.current;

      // Reset state for new reconciliation
      setIsReconciling(true);
      setError(null);
      setReconciliation(null);
      setGuardrails(null);

      try {
        // Dynamic import to keep reconciliation service lazy-loaded
        const { reconcileReleve } = await import("../services/releveReconciliationService");

        // Guard: if a newer request started, abort
        if (localRequestId !== requestIdRef.current) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[Relevé Reconciliation] Stale request ignored", {
              localRequestId,
              current: requestIdRef.current,
            });
          }
          return;
        }

        const result = await reconcileReleve({
          releveHeader: extraction.releve,
          releveLines: extraction.releve_lines,
          establishmentId,
          knownSupplierId: knownSupplierId ?? null,
        });

        // Guard: check again after async operation
        if (localRequestId !== requestIdRef.current) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[Relevé Reconciliation] Stale result ignored after reconciliation", {
              localRequestId,
              current: requestIdRef.current,
            });
          }
          return;
        }

        setReconciliation(result);

        // Apply guardrails on the reconciliation result
        const { applyReleveGuardrails } = await import("../plugins/visionReleveGuardrails");

        // Guard: one more check after guardrails import
        if (localRequestId !== requestIdRef.current) {
          return;
        }

        const guardrailResult = applyReleveGuardrails(result, extraction.releve);
        setGuardrails(guardrailResult);

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log("[Relevé Reconciliation] Complete", {
            matched: result.matched_lines.length,
            missingFromDb: result.missing_from_db.length,
            missingFromReleve: result.missing_from_releve.length,
            flags: guardrailResult.total_flag_count,
          });
        }
      } catch (err) {
        // Only set error if this is still the current request
        if (localRequestId === requestIdRef.current) {
          const message =
            err instanceof Error ? err.message : "Erreur lors du rapprochement du relevé";
          setError(message);

          if (import.meta.env.DEV) {
            console.error("[Relevé Reconciliation] Error:", err);
          }
        }
      } finally {
        // Only clear loading if this is still the current request
        if (localRequestId === requestIdRef.current) {
          setIsReconciling(false);
        }
      }
    },
    []
  );

  const reset = useCallback(() => {
    // Increment requestId to invalidate any pending requests
    requestIdRef.current++;

    setReconciliation(null);
    setGuardrails(null);
    setIsReconciling(false);
    setError(null);

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[Relevé Reconciliation] Reset complete");
    }
  }, []);

  return {
    reconciliation,
    guardrails,
    isReconciling,
    error,
    reconcile,
    reset,
  };
}
