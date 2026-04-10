import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExtractedProductLine, ExtractionResponse, InvoiceData, Insight } from "../types";
import { purgeVisionAISession } from "../utils/sessionPersistence";
import { applyGuardrails } from "../plugins/visionAiGuardrails";
import { isImageFile } from "../utils/pdfPreValidation";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — useExtractProducts Hook (SAS MODE)
 * ═══════════════════════════════════════════════════════════════════════════
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

const EMPTY_INVOICE: InvoiceData = {
  supplier_name: null,
  invoice_number: null,
  invoice_date: null,
  invoice_total: null,
};

export function useExtractProducts() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ExtractedProductLine[]>([]);
  const [invoice, setInvoice] = useState<InvoiceData>(EMPTY_INVOICE);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [invoiceValidated, setInvoiceValidated] = useState(false);

  // Flag to track if current data is from a fresh extraction (not restored)
  const [isFreshExtraction, setIsFreshExtraction] = useState(false);

  // Store PDF file in memory for upload during validation
  const pdfFileRef = useRef<File | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // LATEST-ONLY GUARD: Prevents stale responses from overwriting newer ones
  // ═══════════════════════════════════════════════════════════════════════════
  const requestIdRef = useRef(0);

  /**
   * Extract products from PDF via Vision AI
   * Implements latest-only guard to prevent race conditions
   */
  const extractFromPdf = useCallback(
    async (
      file: File,
      precisionMode: "standard" | "precise" | "claude" = "claude",
      establishmentId?: string
    ): Promise<{ success: boolean; docType?: string; rawResponse?: unknown }> => {
      // Increment request ID - this becomes the "current" request
      const localRequestId = ++requestIdRef.current;

      // Purge any previous session data
      purgeVisionAISession();

      // Reset all state for new extraction
      setIsLoading(true);
      setError(null);
      setItems([]);
      setInvoice(EMPTY_INVOICE);
      setInsights([]);
      setInvoiceValidated(false);
      setIsFreshExtraction(false);

      // Store the PDF file in memory for later upload
      pdfFileRef.current = file;

      try {
        const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
        const isImage = isImageFile(file);
        if (!isPdf && !isImage) {
          setError("Formats acceptés : PDF, JPG, PNG, WebP, TIFF");
          pdfFileRef.current = null;
          return { success: false };
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("precision_mode", precisionMode);
        formData.append("document_mode", "auto");
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
            console.log("[Vision AI] Stale response ignored", {
              localRequestId,
              current: requestIdRef.current,
            });
          return { success: false };
        }

        const result = await response.json();

        // Second guard check after JSON parsing
        if (localRequestId !== requestIdRef.current) {
          if (import.meta.env.DEV)
            // eslint-disable-next-line no-console
            console.log("[Vision AI] Stale response ignored after parse", {
              localRequestId,
              current: requestIdRef.current,
            });
          return { success: false };
        }

        if (!result.success) {
          setError(result.error || "Erreur lors de l'extraction");
          pdfFileRef.current = null;
          return { success: false };
        }

        // Auto-classification: if backend classified as BL or releve, return early
        // without setting facture state — caller will route to the appropriate hook
        const docType: string | undefined = result.doc_type;
        if (docType === "bl" || docType === "releve") {
          // eslint-disable-next-line no-console
          if (import.meta.env.DEV) console.log("[Vision AI] Auto-classified as", docType);
          return { success: true, docType, rawResponse: result };
        }

        // Facture flow: set state as a FRESH extraction
        // Apply guardrails plugin (O(1) per line, no AI call, session-only flags)
        const typedResult = result as ExtractionResponse;
        const guardrailedItems = applyGuardrails(typedResult.items);
        setItems(guardrailedItems);
        setInvoice(typedResult.invoice);
        setInsights(typedResult.insights);
        setIsFreshExtraction(true);

        return { success: true, docType: "facture" };
      } catch (err) {
        // Only set error if this is still the current request
        if (localRequestId === requestIdRef.current) {
          if (import.meta.env.DEV) console.error("Extract products error:", err);
          const isTimeout = err instanceof DOMException && err.name === "AbortError";
          setError(
            isTimeout
              ? "L'extraction a pris trop de temps (> 60s). Réessayez ou utilisez un fichier plus léger."
              : err instanceof Error
                ? err.message
                : "Erreur inconnue"
          );
          pdfFileRef.current = null;
        }
        return { success: false };
      } finally {
        // Only clear loading if this is still the current request
        if (localRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  /**
   * HARD RESET: Complete purge of all Vision AI state
   * Used after validation OR cancellation
   * Vision AI returns to empty initial state
   */
  const hardReset = useCallback(() => {
    // Increment requestId to invalidate any pending requests
    requestIdRef.current++;

    // Clear all React state
    setError(null);
    setItems([]);
    setInvoice(EMPTY_INVOICE);
    setInsights([]);
    setInvoiceValidated(false);
    setIsFreshExtraction(false);
    pdfFileRef.current = null;

    // Purge ALL sessionStorage (including flags)
    purgeVisionAISession();

    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.log("[Vision AI] Hard reset complete");
  }, []);

  /**
   * Remove a validated/deleted item from the list
   * Uses item reference comparison (works with filtered lists)
   */
  const removeItem = useCallback((itemToRemove: ExtractedProductLine) => {
    setItems((prev) => prev.filter((item) => item !== itemToRemove));
  }, []);

  /**
   * Update invoice data (editable fields)
   */
  const updateInvoice = useCallback((data: Partial<InvoiceData>) => {
    setInvoice((prev) => ({ ...prev, ...data }));
  }, []);

  /**
   * Mark invoice as validated
   */
  const validateInvoice = useCallback(() => {
    setInvoiceValidated(true);
  }, []);

  /**
   * Check if invoice can be saved (RÈGLE DES 3 CHAMPS: reference + date + total)
   * AUCUNE EXCEPTION - les 3 champs sont OBLIGATOIRES
   */
  const canSaveInvoice = useCallback((): boolean => {
    return (
      invoiceValidated &&
      invoice.invoice_number !== null &&
      invoice.invoice_number.trim() !== "" &&
      invoice.invoice_date !== null &&
      invoice.invoice_date.trim() !== "" &&
      invoice.invoice_total !== null &&
      invoice.invoice_total > 0
    );
  }, [invoiceValidated, invoice]);

  /**
   * Get the stored PDF file for upload
   */
  const getPdfFile = useCallback((): File | null => {
    return pdfFileRef.current;
  }, []);

  return {
    extractFromPdf,
    isLoading,
    error,
    items,
    invoice,
    insights,
    invoiceValidated,
    isFreshExtraction,
    hardReset,
    removeItem,
    updateInvoice,
    validateInvoice,
    canSaveInvoice,
    getPdfFile,
  };
}
