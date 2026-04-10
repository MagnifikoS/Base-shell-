/**
 * Vision AI Page — State and handlers hook
 *
 * Extracted from VisionAI.tsx for file size compliance.
 * Contains all state management, callbacks, and effect logic.
 */

import { useState, useRef, useCallback, useEffect } from "react";
// Direct imports to avoid Rollup circular chunk warnings through barrel re-exports
import {
  validatePdfBeforeExtraction,
  type PdfValidationError,
} from "@/modules/visionAI/utils/pdfPreValidation";
import {
  VISION_AI_SESSION_KEYS,
  markInvoiceAsRegistered,
  saveProductsValidatedState,
} from "@/modules/visionAI/utils/sessionPersistence";
import { useExtractProducts } from "@/modules/visionAI/hooks/useExtractProducts";
import { useExtractDocument } from "@/modules/visionAI/hooks/useExtractDocument";
import { useReleveReconciliation } from "@/modules/visionAI/hooks/useReleveReconciliation";
import { saveReleveStatement } from "@/modules/visionAI/services/releveStatementService";
import type { InvoiceSavingStatus } from "@/modules/visionAI/components/InvoiceSavingModal";
import type { BLExtractionResponse } from "@/modules/visionAI/types/blTypes";
import type { ReleveExtractionResponse } from "@/modules/visionAI/types/releveTypes";
import { useAnalyzeExtraction } from "@/modules/analyseFacture";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { createPurchaseLines, buildPurchaseLineInputs } from "@/modules/achat";
import type { Invoice } from "@/modules/factures";
import type { ResolvedProductLine } from "@/modules/achat";
import { logPurchaseLinesBatch, logPriceEvolutionBatch } from "@/modules/theBrain";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export function useVisionAIState() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [pdfValidationError, setPdfValidationError] = useState<PdfValidationError | null>(null);

  // Modal states
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [productsModalOpen, setProductsModalOpen] = useState(false);
  const [productsValidated, setProductsValidated] = useState(false);
  const [savingModalOpen, setSavingModalOpen] = useState(false);
  const [savingStatus, setSavingStatus] = useState<InvoiceSavingStatus>("idle");
  const [savingErrorMessage, setSavingErrorMessage] = useState<string | undefined>(undefined);
  const [validateRequestId, setValidateRequestId] = useState<number | null>(null);

  // Duplicate invoice handling
  const [duplicateDismissed, setDuplicateDismissed] = useState(() => {
    return sessionStorage.getItem(VISION_AI_SESSION_KEYS.DUPLICATE_DISMISSED) === "1";
  });

  // Replace mode: when user chooses to replace an existing invoice
  const [replaceInvoiceId, setReplaceInvoiceId] = useState<string | null>(null);
  const [replaceFilePath, setReplaceFilePath] = useState<string | null>(null);

  const [showFilteredProducts, setShowFilteredProducts] = useState(false);

  // Single AI model: always Claude (no user-facing model selection)
  const precisionMode = "claude" as const;

  // BL/Relevé modal states
  const [blModalOpen, setBlModalOpen] = useState(false);
  const [releveModalOpen, setReleveModalOpen] = useState(false);
  // BL: supplier must be chosen BEFORE product review (same pattern as Relevé)
  const [blSupplierModalOpen, setBlSupplierModalOpen] = useState(false);
  const [blExtractedSupplierName, setBlExtractedSupplierName] = useState<string | null>(null);
  const [blSupplierId, setBlSupplierId] = useState<string | null>(null);
  // Relevé: supplier must be chosen BEFORE reconciliation starts
  const [releveSupplierModalOpen, setReleveSupplierModalOpen] = useState(false);
  const [releveExtractedSupplierName, setReleveExtractedSupplierName] = useState<string | null>(null);
  // Holds the reconciliation supplier_id chosen specifically for this relevé
  const [releveSupplierId, setReleveSupplierId] = useState<string | null>(null);

  // Scan history: rescan mode (reuses existing scan, creates new run only)
  const [rescanScanId, setRescanScanId] = useState<string | null>(null);

  // Supplier validation state (SSOT)
  const [validatedSupplierId, setValidatedSupplierId] = useState<string | null>(null);
  const [validatedSupplierName, setValidatedSupplierName] = useState<string | null>(null);

  // ACHAT MODULE: Store resolved lines
  const [pendingResolvedLines, setPendingResolvedLines] = useState<ResolvedProductLine[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guard: true when supplier was just confirmed (prevents onOpenChange cancel race)
  const releveSupplierConfirmedRef = useRef(false);
  // Guard: true when BL supplier was just confirmed (prevents onOpenChange cancel race)
  const blSupplierConfirmedRef = useRef(false);
  // HARDENING: Ref-based guard to prevent concurrent extraction requests
  const isExtractingRef = useRef(false);
  const extractionHook = useExtractProducts();

  // BL/Relevé extraction hook (separate from facture)
  const documentHook = useExtractDocument();
  const {
    hardReset: documentHardReset,
    blResponse: docBlResponse,
    releveResponse: docReleveResponse,
    isLoading: docIsLoading,
  } = documentHook;

  // Relevé reconciliation hook
  const releveHook = useReleveReconciliation();
  const {
    reconcile: releveReconcile,
    reset: releveReset,
    isReconciling,
    reconciliation: releveReconciliation,
  } = releveHook;
  const {
    extractFromPdf,
    isLoading,
    error,
    items,
    invoice,
    insights,
    invoiceValidated,
    isFreshExtraction,
    hardReset,
    removeItem: _removeItem,
    updateInvoice,
    getPdfFile,
  } = extractionHook;

  // Analysis engine hook
  const analysisHook = useAnalyzeExtraction({
    items,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    invoiceTotal: invoice.invoice_total,
    supplierId: validatedSupplierId,
    enabled: items.length > 0,
  });

  const {
    filteredItems,
    filteredOutCount,
    duplicateResult,
    isLoading: analysisLoading,
  } = analysisHook;

  // Duplicate check status logic
  const duplicateCheckStatus = duplicateResult?.status ?? "not_checked";
  const isDuplicateConfirmed =
    duplicateCheckStatus === "checked" && duplicateResult?.isDuplicate === true;
  const isDuplicateCleared =
    duplicateCheckStatus === "checked" && duplicateResult?.isDuplicate === false;
  const showDuplicatePopup = isDuplicateConfirmed && !duplicateDismissed && items.length > 0;

  const displayItems = showFilteredProducts ? items : filteredItems;
  const hasExtractionData =
    items.length > 0 ||
    invoice.invoice_number !== null ||
    docBlResponse !== null ||
    docReleveResponse !== null;

  // Auto-open modal flow
  useEffect(() => {
    if (
      !isLoading &&
      !analysisLoading &&
      items.length > 0 &&
      !productsValidated &&
      isFreshExtraction &&
      !savingModalOpen
    ) {
      if (validatedSupplierId === null) {
        setSupplierModalOpen(true);
        setProductsModalOpen(false);
        return;
      }

      if (duplicateCheckStatus === "not_checked") {
        return;
      }

      if (duplicateCheckStatus === "checked") {
        if (isDuplicateConfirmed && !duplicateDismissed) {
          setProductsModalOpen(false);
        } else if (isDuplicateCleared || duplicateDismissed) {
          if (displayItems.length > 0) {
            setSupplierModalOpen(false);
            setProductsModalOpen(true);
          }
        }
      }
    }
  }, [
    isLoading,
    analysisLoading,
    items.length,
    displayItems.length,
    productsValidated,
    duplicateCheckStatus,
    isDuplicateConfirmed,
    isDuplicateCleared,
    duplicateDismissed,
    isFreshExtraction,
    validatedSupplierId,
    savingModalOpen,
  ]);

  // Bench auto-capture: fire-and-forget capture of PDF + extraction results
  // Dynamic import ensures zero impact if the visionAIBench module is deleted
  const benchCapturedRef = useRef(false);
  useEffect(() => {
    if (!isFreshExtraction || items.length === 0 || isLoading) return;
    if (benchCapturedRef.current) return;
    const pdfFile = getPdfFile();
    if (!pdfFile) return;
    benchCapturedRef.current = true;
    import("@/modules/visionAIBench")
      .then(({ benchAutoCapture }) => {
        benchAutoCapture({
          file: pdfFile,
          precisionMode,
          invoice,
          items,
          insights,
          establishmentId: activeEstablishment?.id,
        }).catch((err) => {
          if (import.meta.env.DEV) console.error("[ScanHistory] Auto-capture failed:", err);
        });
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.error("[ScanHistory] Auto-capture failed:", err);
      });
  }, [
    isFreshExtraction,
    items.length,
    isLoading,
    getPdfFile,
    precisionMode,
    invoice,
    items,
    insights,
    activeEstablishment,
  ]);

  // Reset bench capture ref on full reset
  useEffect(() => {
    if (!isFreshExtraction && items.length === 0) {
      benchCapturedRef.current = false;
    }
  }, [isFreshExtraction, items.length]);

  // Scan history auto-capture: fire-and-forget save of document + extraction results
  // Dynamic import ensures zero impact if the service is unavailable
  const scanCapturedRef = useRef(false);
  useEffect(() => {
    if (!isFreshExtraction || items.length === 0 || isLoading) return;
    if (scanCapturedRef.current) return;
    if (!activeEstablishment?.id) return;
    const pdfFile = getPdfFile();
    if (!pdfFile) return;
    scanCapturedRef.current = true;

    const captureStart = Date.now();
    import("@/modules/visionAI/services/scanHistoryService")
      .then(async ({ uploadScanFile, createScan, recordScanRun }) => {
        // If this is a rescan, skip upload + scan creation — just record the new run
        if (rescanScanId) {
          await recordScanRun({
            scanId: rescanScanId,
            precisionMode,
            invoice,
            items,
            insights,
            durationMs: Date.now() - captureStart,
          });
          setRescanScanId(null);
          queryClient.invalidateQueries({ queryKey: ["vision-ai-scans"] });
          return;
        }

        // Upload file to storage
        const storagePath = await uploadScanFile(pdfFile);
        if (!storagePath) {
          toast.error("Impossible d'enregistrer dans l'historique des scans");
          return;
        }

        // Create scan document
        const scan = await createScan({
          establishmentId: activeEstablishment.id,
          file: pdfFile,
          storagePath,
        });
        if (!scan) {
          toast.error("Impossible d'enregistrer dans l'historique des scans");
          return;
        }

        // Record the extraction run
        await recordScanRun({
          scanId: scan.id,
          precisionMode,
          invoice,
          items,
          insights,
          durationMs: Date.now() - captureStart,
        });

        // Refresh scan history cache so the list shows new data
        queryClient.invalidateQueries({ queryKey: ["vision-ai-scans"] });
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.error("[ScanHistory] Auto-capture failed:", err);
        toast.error("Impossible d'enregistrer dans l'historique des scans");
      });
  }, [
    isFreshExtraction,
    items.length,
    isLoading,
    getPdfFile,
    precisionMode,
    invoice,
    items,
    insights,
    activeEstablishment,
    rescanScanId,
    queryClient,
  ]);

  // Reset scan capture ref on full reset
  useEffect(() => {
    if (!isFreshExtraction && items.length === 0) {
      scanCapturedRef.current = false;
    }
  }, [isFreshExtraction, items.length]);

  // Scan history auto-capture for BL/Releve (separate from facture capture above)
  const scanBLRevCapturedRef = useRef(false);
  useEffect(() => {
    const hasBL = docBlResponse !== null;
    const hasReleve = docReleveResponse !== null;
    if (!hasBL && !hasReleve) return;
    if (docIsLoading) return;
    if (scanBLRevCapturedRef.current) return;
    if (!activeEstablishment?.id) return;
    const docFile = documentHook.getDocumentFile?.();
    // File may not be set yet if ref hasn't been populated — retry on next render
    if (!docFile) return;
    scanBLRevCapturedRef.current = true;

    const captureStart = Date.now();
    import("@/modules/visionAI/services/scanHistoryService")
      .then(async ({ uploadScanFile, createScan, recordScanRun }) => {
        const storagePath = await uploadScanFile(docFile);
        if (!storagePath) {
          // Scan history is non-critical — log silently without blocking the user
          if (import.meta.env.DEV) console.warn("[ScanHistory] Upload failed — skipping scan capture");
          return;
        }

        const docType = hasBL ? ("bl" as const) : ("releve" as const);
        const scan = await createScan({
          establishmentId: activeEstablishment.id,
          file: docFile,
          storagePath,
          doc_type: docType,
          bl_number: hasBL ? (docBlResponse?.bl?.bl_number ?? undefined) : undefined,
          releve_period_start: hasReleve
            ? (docReleveResponse?.releve?.period_start ?? undefined)
            : undefined,
          releve_period_end: hasReleve
            ? (docReleveResponse?.releve?.period_end ?? undefined)
            : undefined,
        });
        if (!scan) {
          if (import.meta.env.DEV) console.warn("[ScanHistory] createScan failed — skipping");
          return;
        }

        await recordScanRun({
          scanId: scan.id,
          precisionMode,
          invoice: {
            supplier_name: hasBL
              ? (docBlResponse?.bl?.supplier_name ?? null)
              : (docReleveResponse?.releve?.supplier_name ?? null),
            invoice_number: null,
            invoice_date: null,
            invoice_total: null,
          },
          items: [],
          insights: hasBL ? (docBlResponse?.insights ?? []) : (docReleveResponse?.insights ?? []),
          durationMs: Date.now() - captureStart,
          doc_type: docType,
          result_bl: hasBL ? docBlResponse?.bl : undefined,
          result_bl_items: hasBL ? docBlResponse?.bl_items : undefined,
          result_releve: hasReleve ? docReleveResponse?.releve : undefined,
          result_releve_lines: hasReleve ? docReleveResponse?.releve_lines : undefined,
          result_reconciliation: hasReleve ? releveReconciliation : undefined,
        });

        // Refresh scan history cache so the list shows new data
        queryClient.invalidateQueries({ queryKey: ["vision-ai-scans"] });
      })
      .catch((err) => {
        // Scan history is non-critical — fail silently
        if (import.meta.env.DEV) console.error("[ScanHistory] Auto-capture failed (non-critical):", err);
      });
  }, [
    docBlResponse,
    docReleveResponse,
    docIsLoading,
    activeEstablishment,
    precisionMode,
    documentHook,
    releveReconciliation,
    queryClient,
  ]);

  // Reset BL/Releve scan capture ref on document reset
  useEffect(() => {
    if (!docBlResponse && !docReleveResponse) {
      scanBLRevCapturedRef.current = false;
    }
  }, [docBlResponse, docReleveResponse]);

  // Step 1: When BL extraction completes → open supplier picker FIRST (block product review)
  useEffect(() => {
    if (docBlResponse && !docIsLoading && !blSupplierModalOpen && !blModalOpen) {
      setBlExtractedSupplierName(docBlResponse.bl?.supplier_name ?? null);
      setBlSupplierId(null);
      setBlSupplierModalOpen(true);
    }
  }, [docBlResponse, docIsLoading, blSupplierModalOpen, blModalOpen]);

  // Step 1: When Relevé extraction completes → open supplier picker FIRST (block reconciliation)
  useEffect(() => {
    if (docReleveResponse && !docIsLoading && !releveSupplierModalOpen && !releveModalOpen) {
      // Store the AI-extracted supplier name for pre-filling the picker
      setReleveExtractedSupplierName(docReleveResponse.releve?.supplier_name ?? null);
      setReleveSupplierId(null); // reset any previous choice
      setReleveSupplierModalOpen(true);
    }
  }, [docReleveResponse, docIsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2: Once supplier chosen → run reconciliation with the confirmed supplier_id
  useEffect(() => {
    if (
      docReleveResponse &&
      !docIsLoading &&
      !isReconciling &&
      !releveReconciliation &&
      releveSupplierId !== null &&
      activeEstablishment?.id
    ) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[VisionAI] Starting reconciliation with confirmed supplierId:", {
          releveSupplierId,
          establishmentId: activeEstablishment.id,
        });
      }
      setReleveModalOpen(true);
      releveReconcile(docReleveResponse, activeEstablishment.id, releveSupplierId);
    }
  }, [
    docReleveResponse,
    docIsLoading,
    isReconciling,
    releveReconciliation,
    releveSupplierId,
    activeEstablishment?.id,
    releveReconcile,
  ]);

  const handleSupplierValidated = useCallback((supplierId: string, supplierName: string) => {
    setValidatedSupplierId(supplierId);
    setValidatedSupplierName(supplierName);
    setSupplierModalOpen(false);
  }, []);

  const handleImportClick = () => {
    if (isLoading || docIsLoading) return;
    if (hasExtractionData && !productsValidated) {
      setLockDialogOpen(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const resetDuplicateState = useCallback(() => {
    setDuplicateDismissed(false);
    sessionStorage.removeItem(VISION_AI_SESSION_KEYS.DUPLICATE_DISMISSED);
  }, []);

  const dismissDuplicatePopup = useCallback(() => {
    setDuplicateDismissed(true);
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.DUPLICATE_DISMISSED, "1");
  }, []);

  /** User wants to see the extraction results before deciding */
  const handleDuplicateContinueReview = useCallback(() => {
    dismissDuplicatePopup();
  }, [dismissDuplicatePopup]);

  /** User wants to replace the existing invoice with the new extraction */
  const handleDuplicateReplace = useCallback(async () => {
    if (duplicateResult?.existingInvoice) {
      const invoiceId = duplicateResult.existingInvoice.id;
      setReplaceInvoiceId(invoiceId);
      // Fetch file_path for storage cleanup during replacement
      const { data } = await supabase
        .from("invoices")
        .select("file_path")
        .eq("id", invoiceId)
        .maybeSingle();
      if (data?.file_path) {
        setReplaceFilePath(data.file_path);
      }
    }
    dismissDuplicatePopup();
  }, [duplicateResult, dismissDuplicatePopup]);

  const fullReset = useCallback(() => {
    hardReset();
    setValidatedSupplierId(null);
    setValidatedSupplierName(null);
    resetDuplicateState();
    setShowFilteredProducts(false);
    setProductsValidated(false);
    setProductsModalOpen(false);
    setSupplierModalOpen(false);
    setSavingModalOpen(false);
    setSavingStatus("idle");
    setSavingErrorMessage(undefined);
    setPendingResolvedLines([]);
    setReplaceInvoiceId(null);
    setReplaceFilePath(null);
    setRescanScanId(null);
    // BL/Relevé reset
    documentHardReset();
    releveReset();
    setBlModalOpen(false);
    setReleveModalOpen(false);
    // BL supplier picker reset
    setBlSupplierModalOpen(false);
    setBlExtractedSupplierName(null);
    setBlSupplierId(null);
    // Relevé supplier picker reset
    setReleveSupplierModalOpen(false);
    setReleveExtractedSupplierName(null);
    setReleveSupplierId(null);
  }, [hardReset, resetDuplicateState, documentHardReset, releveReset]);

  const handleCancelExtraction = useCallback(() => {
    fullReset();
    toast.info("Extraction annulée");
  }, [fullReset]);

  /** Process a single file (shared by click upload and drag-and-drop). */
  const processFile = async (file: File) => {
    if (isExtractingRef.current) return;

    const validationError = await validatePdfBeforeExtraction(file);
    if (validationError) {
      setPdfValidationError(validationError);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    fullReset();
    isExtractingRef.current = true;
    try {
      // Always use auto-classification: backend detects document type
      const result = await extractFromPdf(file, precisionMode, activeEstablishment?.id);

      if (result.success && result.docType === "bl" && result.rawResponse) {
        // Auto-classified as BL → inject into document hook
        documentHook.injectBLResponse(result.rawResponse as BLExtractionResponse);
      } else if (result.success && result.docType === "releve" && result.rawResponse) {
        // Auto-classified as Relevé → inject into document hook + pass the file so it can be uploaded on validation
        documentHook.injectReleveResponse(result.rawResponse as ReleveExtractionResponse, file);
      }
      // docType === "facture" or absent → already handled by extractFromPdf
    } finally {
      isExtractingRef.current = false;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  /** Handle files dropped via drag-and-drop. */
  const handleFileDrop = async (files: FileList) => {
    const file = files[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleToggleFilteredProducts = () => {
    setShowFilteredProducts((prev) => !prev);
  };

  const handleProductsValidated = useCallback(() => {
    setProductsValidated(true);
    setProductsModalOpen(false);
    saveProductsValidatedState(true);
  }, []);

  const handleInvoiceValidate = useCallback(async () => {
    markInvoiceAsRegistered();
  }, []);

  const handleValidateFinished = useCallback(
    async (result: { ok: boolean; errorMessage?: string; invoice?: Invoice }) => {
      if (result.ok && result.invoice) {
        if (pendingResolvedLines.length > 0) {
          try {
            const purchaseInputs = buildPurchaseLineInputs(result.invoice, pendingResolvedLines);
            if (purchaseInputs.length > 0) {
              const purchaseResult = await createPurchaseLines(purchaseInputs);
              if (!purchaseResult.success) {
                if (import.meta.env.DEV)
                  console.error("[VisionAI] Achat lines write failed:", purchaseResult.error);
                toast.error("Erreur lors de l'enregistrement des lignes d'achat", {
                  description:
                    "La facture est enregistrée, mais les données Achat n'ont pas été sauvegardées.",
                });
              } else {
                if (import.meta.env.DEV)
                  // eslint-disable-next-line no-console
                  console.log(`[VisionAI] ${purchaseResult.insertedCount} lignes Achat créées`);

                logPurchaseLinesBatch(
                  result.invoice.establishment_id,
                  result.invoice.id,
                  purchaseInputs.map((line) => ({
                    productId: line.product_id,
                    supplierId: line.supplier_id,
                    yearMonth: line.year_month,
                    quantity: line.quantite_commandee,
                    unit: line.unit_snapshot,
                  }))
                );

                logPriceEvolutionBatch(
                  result.invoice.establishment_id,
                  result.invoice.id,
                  purchaseInputs
                    .filter((line) => line.product_id !== null)
                    .map((line) => ({
                      invoiceId: result.invoice!.id,
                      productId: line.product_id as string,
                      supplierId: line.supplier_id,
                      yearMonth: line.year_month,
                      quantity: line.quantite_commandee ?? 0,
                      lineTotal: line.line_total ?? 0,
                      unit: line.unit_snapshot,
                    }))
                );
              }
            }
          } catch (achatError) {
            if (import.meta.env.DEV) console.error("[VisionAI] Achat module error:", achatError);
            toast.error("Erreur module Achat", {
              description:
                "La facture est enregistrée, mais les données Achat n'ont pas été sauvegardées.",
            });
          }
        }

        setSavingStatus("success");
        markInvoiceAsRegistered();
      } else {
        setSavingStatus("error");
        setSavingErrorMessage(result.errorMessage);
      }
      setValidateRequestId(null);
    },
    [pendingResolvedLines]
  );

  const handleAllProductsResolved = useCallback(async (resolvedLines?: ResolvedProductLine[]) => {
    if (resolvedLines && resolvedLines.length > 0) {
      setPendingResolvedLines(resolvedLines);
    }

    setProductsValidated(true);
    setProductsModalOpen(false);
    saveProductsValidatedState(true);

    setSavingModalOpen(true);
    setSavingStatus("uploading");
    setSavingErrorMessage(undefined);

    setValidateRequestId(Date.now());
  }, []);

  const handleSavingRetry = useCallback(() => {
    setSavingStatus("uploading");
    setSavingErrorMessage(undefined);
    setValidateRequestId(Date.now());
  }, []);

  const handleSavingCancel = useCallback(() => {
    setSavingModalOpen(false);
    setSavingStatus("idle");
    setSavingErrorMessage(undefined);
    setProductsValidated(false);
    setProductsModalOpen(true);
  }, []);

  const handleSavingSuccess = useCallback(() => {
    fullReset();
    toast.success("Facture enregistrée");
  }, [fullReset]);

  // ── Relevé supplier picker handler ──

  const handleReleveSupplierValidated = useCallback((supplierId: string, _supplierName: string) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[VisionAI] Relevé supplier confirmed:", { supplierId, _supplierName });
    }
    // Mark as confirmed BEFORE closing — prevents onOpenChange from triggering cancel
    releveSupplierConfirmedRef.current = true;
    setReleveSupplierId(supplierId);
    setReleveSupplierModalOpen(false);
  }, []);

  // Called by the Dialog's onOpenChange when user closes via X/backdrop (NOT after validation)
  const handleReleveSupplierOnOpenChange = useCallback((open: boolean) => {
    if (!open) {
      if (releveSupplierConfirmedRef.current) {
        // Modal closed because supplier was validated — don't cancel
        releveSupplierConfirmedRef.current = false;
        return;
      }
      // Modal closed by user dismissal → cancel
      setReleveSupplierModalOpen(false);
      documentHardReset();
      releveReset();
      toast.info("Extraction relevé annulée");
    }
  }, [documentHardReset, releveReset]);

  const handleReleveSupplierCancel = useCallback(() => {
    releveSupplierConfirmedRef.current = false;
    setReleveSupplierModalOpen(false);
    documentHardReset();
    releveReset();
    toast.info("Extraction relevé annulée");
  }, [documentHardReset, releveReset]);

  // ── BL Supplier Picker Handlers (Step 1) ──

  const handleBLSupplierValidated = useCallback((supplierId: string, _supplierName: string) => {
    // Mark as confirmed BEFORE closing — prevents onOpenChange from triggering cancel
    blSupplierConfirmedRef.current = true;
    setBlSupplierId(supplierId);
    setBlSupplierModalOpen(false);
    setBlModalOpen(true);
  }, []);

  const handleBLSupplierOnOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      if (blSupplierConfirmedRef.current) {
        // Modal closed because supplier was validated — don't cancel
        blSupplierConfirmedRef.current = false;
        return;
      }
      // Modal closed by user dismissal → cancel
      setBlSupplierModalOpen(false);
      documentHardReset();
      toast.info("Extraction BL annulée");
    }
  }, [documentHardReset]);

  const handleBLSupplierCancel = useCallback(() => {
    blSupplierConfirmedRef.current = false;
    setBlSupplierModalOpen(false);
    documentHardReset();
    toast.info("Extraction BL annulée");
  }, [documentHardReset]);

  // ── BL Handlers ──

  const handleBLValidated = useCallback(() => {
    setBlModalOpen(false);
    toast.success("BL validé — brouillon créé");
    // Reset document extraction state (SAS cleanup)
    documentHardReset();
    setBlSupplierId(null);
  }, [documentHardReset]);

  const handleBLCancel = useCallback(() => {
    setBlModalOpen(false);
    documentHardReset();
    setBlSupplierId(null);
    toast.info("Extraction BL annulée");
  }, [documentHardReset]);

  // ── Relevé Handlers ──

  const handleReleveValidated = useCallback(async () => {
    // Close modal immediately for snappy UX
    setReleveModalOpen(false);

    // ── Persist relevé to invoice_monthly_statements ──
    const file = documentHook.getDocumentFile();
    const reconciliation = releveHook.reconciliation;

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[handleReleveValidated] Starting save", {
        hasFile: !!file,
        hasReconciliation: !!reconciliation,
        supplierId: reconciliation?.supplier_id,
        establishmentId: activeEstablishment?.id,
      });
    }

    if (file && reconciliation && activeEstablishment?.id) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;
        const orgId = activeEstablishment.organization_id;

        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log("[handleReleveValidated] Auth check", { userId, orgId });
        }

        if (userId && orgId) {
          const result = await saveReleveStatement({
            reconciliation,
            file,
            establishmentId: activeEstablishment.id,
            organizationId: orgId,
            userId,
          });

          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[handleReleveValidated] Save result", result);
          }

          if (result.ok) {
            toast.success("Relevé enregistré et rapprochement terminé");
            // Invalider le cache — matching partiel sur le préfixe de la clé
            queryClient.invalidateQueries({ queryKey: ["factures", "statements"] });
            queryClient.invalidateQueries({ queryKey: ["factures"] });
          } else {
            toast.warning(
              `Rapprochement terminé mais non enregistré : ${result.error ?? "erreur inconnue"}`
            );
            if (import.meta.env.DEV) {
              console.warn("[handleReleveValidated] Save failed:", result.error);
            }
          }
        } else {
          if (import.meta.env.DEV) {
            console.warn("[handleReleveValidated] Missing userId or orgId — skipping save");
          }
          toast.success("Rapprochement du relevé terminé");
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("[handleReleveValidated] Unexpected error:", err);
        }
        toast.error("Erreur inattendue lors de l'enregistrement du relevé");
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn("[handleReleveValidated] Missing file, reconciliation or establishmentId — skipping save", {
          hasFile: !!file,
          hasReconciliation: !!reconciliation,
          establishmentId: activeEstablishment?.id,
        });
      }
      toast.success("Rapprochement du relevé terminé");
    }

    // Reset both extraction + reconciliation state (SAS cleanup)
    documentHardReset();
    releveReset();
  }, [documentHardReset, releveReset, documentHook, releveHook, activeEstablishment, queryClient]);

  const handleReleveCancel = useCallback(() => {
    setReleveModalOpen(false);
    documentHardReset();
    releveReset();
    toast.info("Rapprochement annulé");
  }, [documentHardReset, releveReset]);

  const canValidateInvoice =
    productsValidated &&
    validatedSupplierId !== null &&
    invoice.invoice_number !== null &&
    invoice.invoice_date !== null &&
    invoice.invoice_total !== null;

  return {
    // State
    settingsOpen,
    setSettingsOpen,
    lockDialogOpen,
    setLockDialogOpen,
    pdfValidationError,
    setPdfValidationError,
    supplierModalOpen,
    setSupplierModalOpen,
    productsModalOpen,
    setProductsModalOpen,
    productsValidated,
    savingModalOpen,
    setSavingModalOpen,
    savingStatus,
    savingErrorMessage,
    validateRequestId,
    showFilteredProducts,
    validatedSupplierId,
    validatedSupplierName,
    fileInputRef,
    // Extraction data (facture)
    isLoading,
    error,
    items,
    invoice,
    insights,
    invoiceValidated,
    getPdfFile,
    updateInvoice,
    // BL/Relevé extraction data
    documentHook,
    releveHook,
    blModalOpen,
    setBlModalOpen,
    releveModalOpen,
    setReleveModalOpen,
    // BL supplier picker
    blSupplierModalOpen,
    blExtractedSupplierName,
    blSupplierId,
    handleBLSupplierValidated,
    handleBLSupplierOnOpenChange,
    handleBLSupplierCancel,
    // Relevé supplier picker
    releveSupplierModalOpen,
    releveExtractedSupplierName,
    handleReleveSupplierValidated,
    handleReleveSupplierOnOpenChange,
    handleReleveSupplierCancel,
    // Analysis data
    filteredItems,
    filteredOutCount,
    displayItems,
    hasExtractionData,
    duplicateResult,
    showDuplicatePopup,
    canValidateInvoice,
    replaceInvoiceId,
    replaceFilePath,
    rescanScanId,
    setRescanScanId,
    // Handlers
    processFile,
    handleDuplicateContinueReview,
    handleDuplicateReplace,
    handleSupplierValidated,
    handleImportClick,
    handleCancelExtraction,
    handleFileChange,
    handleFileDrop,
    handleToggleFilteredProducts,
    handleProductsValidated,
    handleInvoiceValidate,
    handleValidateFinished,
    handleAllProductsResolved,
    handleSavingRetry,
    handleSavingCancel,
    handleSavingSuccess,
    handleBLValidated,
    handleBLCancel,
    handleReleveValidated,
    handleReleveCancel,
    fullReset,
  };
}
