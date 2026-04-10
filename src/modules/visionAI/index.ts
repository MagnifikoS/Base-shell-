/**
 * Vision AI Module - Entry Point
 *
 * This module is fully decoupled and can be removed by:
 * 1. Deleting this folder (src/modules/visionAI)
 * 2. Removing the route from App.tsx
 * 3. Removing the sidebar entry from navRegistry.ts
 *
 * V1/V2 SUPPRIMÉS — V3 est le seul chemin (SSOT products_v2)
 *
 * @see docs/DO_NOT_TOUCH_VISION_AI_STABLE.md
 * @see docs/snapshots/vision-ai-stable-v10.6/README.md
 */

// ── Components ──
// VisionAISettings moved to @/components/settings/VisionAISettings to break circular dep.
// Import directly from @/components/settings/VisionAISettings instead.
export { ExtractionProgressModal } from "./components/ExtractionProgressModal";
export { InvoiceHeader } from "./components/InvoiceHeader";
export { InsightsPanel } from "./components/InsightsPanel";
export { DuplicateInvoiceDialog } from "./components/DuplicateInvoiceDialog";
export { ExtractedProductsModal } from "./components/ExtractedProductsModal";
export { SupplierValidationModal } from "./components/SupplierValidationModal";
export { InvoiceSavingModal } from "./components/InvoiceSavingModal";
export { FilteredProductsBanner } from "./components/FilteredProductsBanner";
export { VisionAIEmptyState } from "./components/VisionAIEmptyState";
export { VisionAIInvoiceHistory } from "./components/VisionAIInvoiceHistory";

// ── BL/Relevé Components ──
export { BLReviewModal } from "./components/BLReviewModal";
export { ReleveReconciliationModal } from "./components/ReleveReconciliationModal";

// ── Scan History ──
export { ScanHistoryTab } from "./components/scanHistory";

// ── Config ──
export { VISION_AI_SAFE_MODE, isVisionAISafeMode } from "./config/safeMode";

// ── Hooks ──
export { usePackagingFormats } from "./hooks/usePackagingFormats";
export { useMeasurementUnits } from "./hooks/useMeasurementUnits";
export { useExtractProducts } from "./hooks/useExtractProducts";
export { useSeedVisionAIData } from "./hooks/useSeedVisionAIData";
export { useExtractDocument } from "./hooks/useExtractDocument";
export { useReleveReconciliation } from "./hooks/useReleveReconciliation";

// ── Services ──
export { checkUnitUsage } from "./hooks/useUnitUsageCheck";
export { executeOptionBDeletion } from "./services/unitDeletionService";
export { saveReleveStatement } from "./services/releveStatementService";
export type { ReleveStatementSaveParams, ReleveStatementSaveResult } from "./services/releveStatementService";

// ── Utils ──
export {
  VISION_AI_SESSION_KEYS,
  markInvoiceAsRegistered,
  saveProductsValidatedState,
} from "./utils/sessionPersistence";
export { validatePdfBeforeExtraction, isImageFile } from "./utils/pdfPreValidation";
export { scanDocument } from "./utils/opencvScanner";
export type { PreprocessResult } from "./utils/imagePreprocessor.types";

// ── Types ──
export type {
  MeasurementUnit,
  MeasurementUnitFormData,
  PackagingFormat,
  PackagingFormatFormData,
  ExtractedProductLine,
} from "./types";
export type { UnitUsageReport } from "./hooks/useUnitUsageCheck";
export type { InvoiceSavingStatus } from "./components/InvoiceSavingModal";
export type { PdfValidationError } from "./utils/pdfPreValidation";
export type { InvoiceValidateResult } from "./components/InvoiceHeader";
export type { ScanDocument, ScanRun, ScanDocType } from "./types/scanHistory";
export type { DocumentMode } from "./hooks/useExtractDocument";

// ── BL Types ──
export type { BLHeader, BLItem, DocumentQuality, BLExtractionResponse } from "./types/blTypes";

// ── Relevé Types ──
export type {
  ReleveHeader,
  ReleveLine,
  ReleveExtractionResponse,
  ReconciliationResult,
  ReconciliationAlert,
} from "./types/releveTypes";
