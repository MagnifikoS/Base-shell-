import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { purgeVisionAISession } from "../utils/sessionPersistence";
import { isImageFile } from "../utils/pdfPreValidation";
import { scanDocument } from "../utils/opencvScanner";
import { applyBLGuardrails, type BLGuardrailResult } from "../plugins/visionBlGuardrails";
import type { BLExtractionResponse } from "../types/blTypes";
import type { ReleveExtractionResponse } from "../types/releveTypes";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — useExtractDocument Hook (SAS MODE)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles BL (Bon de Livraison) and Releve (Statement of Account) extraction.
 * Facture extraction stays in useExtractProducts — this hook is ONLY for
 * document types that do NOT create invoices.
 *
 * ARCHITECTURE SAS:
 * - Vision AI is a TEMPORARY airlock, NOT a storage area
 * - NO automatic session restoration after navigation
 * - Complete reset after validation or cancellation
 * - Only ONE extraction active at a time (latest-only guard)
 *
 * SECURITY:
 * - Never run bulk delete without explicit user action
 * - This hook only manages temporary extraction data
 * - No permanent data is modified until final validation
 */

export type DocumentMode = "bl" | "releve";

export interface UseExtractDocumentReturn {
  // State
  isLoading: boolean;
  error: string | null;
  blResponse: BLExtractionResponse | null;
  releveResponse: ReleveExtractionResponse | null;
  documentMode: DocumentMode | null;
  blGuardrails: BLGuardrailResult | null;

  // Actions
  extractDocument: (
    file: File,
    mode: DocumentMode,
    precisionMode?: string,
    establishmentId?: string
  ) => Promise<boolean>;
  injectBLResponse: (data: BLExtractionResponse) => void;
  injectReleveResponse: (data: ReleveExtractionResponse, file?: File) => void;
  hardReset: () => void;
  getDocumentFile: () => File | null;
}

export function useExtractDocument(): UseExtractDocumentReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blResponse, setBlResponse] = useState<BLExtractionResponse | null>(null);
  const [releveResponse, setReleveResponse] = useState<ReleveExtractionResponse | null>(null);
  const [documentMode, setDocumentMode] = useState<DocumentMode | null>(null);
  const [blGuardrails, setBlGuardrails] = useState<BLGuardrailResult | null>(null);

  // Store document file in memory for upload during validation
  const documentFileRef = useRef<File | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // LATEST-ONLY GUARD: Prevents stale responses from overwriting newer ones
  // ═══════════════════════════════════════════════════════════════════════════
  const requestIdRef = useRef(0);

  // HARDENING: Ref-based guard to prevent concurrent extraction requests
  const isExtractingRef = useRef(false);

  /**
   * Extract document (BL or Releve) via Vision AI edge function.
   * Implements latest-only guard to prevent race conditions.
   */
  const extractDocument = useCallback(
    async (
      file: File,
      mode: DocumentMode,
      precisionMode: string = "claude",
      establishmentId?: string
    ): Promise<boolean> => {
      // Prevent concurrent extractions
      if (isExtractingRef.current) {
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.log("[Vision AI Document] Extraction already in progress, ignoring request");
        return false;
      }

      // Increment request ID — this becomes the "current" request
      const localRequestId = ++requestIdRef.current;

      // Purge any previous session data
      purgeVisionAISession();

      // Reset all state for new extraction
      setIsLoading(true);
      setError(null);
      setBlResponse(null);
      setReleveResponse(null);
      setDocumentMode(mode);
      setBlGuardrails(null);

      // Store the document file in memory for later upload
      documentFileRef.current = file;
      isExtractingRef.current = true;

      try {
        const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
        const isImage = isImageFile(file);
        if (!isPdf && !isImage) {
          setError("Formats acceptes : PDF, JPG, PNG, WebP, TIFF");
          documentFileRef.current = null;
          return false;
        }

        // Preprocess image via OpenCV (edge detection + perspective correction)
        // PDFs pass through unchanged; on error, returns original file
        const { file: processedFile, warnings } = await scanDocument(file);

        if (warnings.includes("image_very_blurry")) {
          toast.warning("Photo tres floue — reprenez la photo pour de meilleurs resultats");
        } else if (warnings.includes("image_blurry")) {
          toast.info("Photo legerement floue — traitement en cours");
        }

        const formData = new FormData();
        formData.append("file", processedFile);
        formData.append("precision_mode", precisionMode);
        formData.append("document_mode", mode);
        if (establishmentId) {
          formData.append("establishment_id", establishmentId);
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        // HARDENING: 60-second timeout to prevent infinite spinner if AI hangs
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60_000);

        let response: Response;
        try {
          response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-ai-extract`,
            {
              method: "POST",
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: formData,
              signal: controller.signal,
            }
          );
        } finally {
          clearTimeout(timeoutId);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // LATEST-ONLY GUARD CHECK: If a newer request started, ignore this result
        // ═══════════════════════════════════════════════════════════════════════
        if (localRequestId !== requestIdRef.current) {
          if (import.meta.env.DEV)
            // eslint-disable-next-line no-console
            console.log("[Vision AI Document] Stale response ignored", {
              localRequestId,
              current: requestIdRef.current,
            });
          return false;
        }

        const result = await response.json();

        // Second guard check after JSON parsing
        if (localRequestId !== requestIdRef.current) {
          if (import.meta.env.DEV)
            // eslint-disable-next-line no-console
            console.log("[Vision AI Document] Stale response ignored after parse", {
              localRequestId,
              current: requestIdRef.current,
            });
          return false;
        }

        if (!result.success) {
          setError(result.error || "Erreur lors de l'extraction");
          documentFileRef.current = null;
          return false;
        }

        // Set state based on document mode
        // Defensive: validate response has expected structure (old edge function returns facture format)
        if (mode === "bl") {
          const blResult = result as BLExtractionResponse;
          if (!Array.isArray(blResult.bl_items)) {
            setError(
              "Le serveur a retourné un format inattendu. Veuillez réessayer ou contacter le support."
            );
            documentFileRef.current = null;
            return false;
          }
          setBlResponse(blResult);

          // Apply BL guardrails (O(n) per document, no AI call, session-only flags)
          const guardrailResult = applyBLGuardrails(blResult);
          setBlGuardrails(guardrailResult);

          if (import.meta.env.DEV)
            // eslint-disable-next-line no-console
            console.log("[Vision AI Document] BL extraction complete", {
              items: blResult.bl_items.length,
              guardrailFlags: guardrailResult.total_flag_count,
            });
        } else {
          const releveResult = result as ReleveExtractionResponse;
          if (!Array.isArray(releveResult.releve_lines)) {
            setError(
              "Le serveur a retourné un format inattendu. Veuillez réessayer ou contacter le support."
            );
            documentFileRef.current = null;
            return false;
          }
          setReleveResponse(releveResult);

          if (import.meta.env.DEV)
            // eslint-disable-next-line no-console
            console.log("[Vision AI Document] Releve extraction complete", {
              lines: releveResult.releve_lines.length,
            });
        }

        return true;
      } catch (err) {
        // Only set error if this is still the current request
        if (localRequestId === requestIdRef.current) {
          if (import.meta.env.DEV) console.error("Extract document error:", err);
          const isTimeout = err instanceof DOMException && err.name === "AbortError";
          setError(
            isTimeout
              ? "L'extraction a pris trop de temps (> 60s). Reessayez ou utilisez un fichier plus leger."
              : err instanceof Error
                ? err.message
                : "Erreur inconnue"
          );
          documentFileRef.current = null;
        }
        return false;
      } finally {
        // Only clear loading if this is still the current request
        if (localRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
        isExtractingRef.current = false;
      }
    },
    []
  );

  /**
   * Inject a pre-fetched BL response from auto-classification.
   * Sets state as if extractDocument("bl") had returned.
   */
  const injectBLResponse = useCallback((data: BLExtractionResponse) => {
    setBlResponse(data);
    setDocumentMode("bl");
    setError(null);

    const guardrailResult = applyBLGuardrails(data);
    setBlGuardrails(guardrailResult);

    if (import.meta.env.DEV)
      // eslint-disable-next-line no-console
      console.log("[Vision AI Document] BL injected from auto-classification", {
        items: data.bl_items.length,
        guardrailFlags: guardrailResult.total_flag_count,
      });
  }, []);

  /**
   * Inject a pre-fetched Releve response from auto-classification.
   * Sets state as if extractDocument("releve") had returned.
   */
  const injectReleveResponse = useCallback((data: ReleveExtractionResponse, file?: File) => {
    setReleveResponse(data);
    setDocumentMode("releve");
    setError(null);

    // ── CRITICAL: store the file so getDocumentFile() works during validation ──
    if (file) {
      documentFileRef.current = file;
    }

    if (import.meta.env.DEV)
      // eslint-disable-next-line no-console
      console.log("[Vision AI Document] Releve injected from auto-classification", {
        lines: data.releve_lines.length,
        hasFile: !!file,
      });
  }, []);

  /**
   * HARD RESET: Complete purge of all document extraction state.
   * Used after validation OR cancellation.
   * Returns to empty initial state (SAS cleanup).
   */
  const hardReset = useCallback(() => {
    // Increment requestId to invalidate any pending requests
    requestIdRef.current++;

    // Clear all React state
    setError(null);
    setBlResponse(null);
    setReleveResponse(null);
    setDocumentMode(null);
    setBlGuardrails(null);
    setIsLoading(false);
    documentFileRef.current = null;
    isExtractingRef.current = false;

    // Purge ALL sessionStorage (including flags)
    purgeVisionAISession();

    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log("[Vision AI Document] Hard reset complete");
  }, []);

  /**
   * Get the stored document file for upload
   */
  const getDocumentFile = useCallback((): File | null => {
    return documentFileRef.current;
  }, []);

  return {
    // State
    isLoading,
    error,
    blResponse,
    releveResponse,
    documentMode,
    blGuardrails,

    // Actions
    extractDocument,
    injectBLResponse,
    injectReleveResponse,
    hardReset,
    getDocumentFile,
  };
}
