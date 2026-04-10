/**
 * Module Analyse Facture
 * 
 * RESPONSABILITÉS:
 * - Recevoir les données extraites de Vision AI
 * - Comparer avec produits et factures existants
 * - Générer alertes et décisions
 * - Match produits V2
 * 
 * INTERDICTIONS:
 * - N'appelle JAMAIS Vision AI
 * - N'effectue AUCUNE extraction
 * - Travaille uniquement en mémoire
 */

// Types
export type {
  AlertLevel,
  AlertCode,
  AnalysisAlert,
  AnalysisResult,
  ExtractionSettings,
  ExistingProduct,
  InvoiceRecord,
  DuplicateInvoiceResult,
  DuplicateReason,
  DuplicateCheckStatus,
  AnalysisInput,
} from "./types";

export { DEFAULT_EXTRACTION_SETTINGS } from "./types";

// Hooks
export { useExtractionSettings } from "./hooks/useExtractionSettings";
export { useAnalyzeExtraction } from "./hooks/useAnalyzeExtraction";
export { useProductStatusV2 } from "./hooks/useProductStatusV2";

// Engine (V1)
export { analyzeExtraction } from "./engine/analyzeExtraction";
export { detectDuplicateInvoice } from "./engine/detectDuplicateInvoice";
export { filterExistingProducts } from "./engine/filterExistingProducts";

// Engine (V2 - Products matching)
export { matchProductV2, matchProductsV2Batch } from "./engine/matchProductV2";
export type { MatchResult, ProductV2Match, MatchType } from "./engine/matchProductV2";

export {
  determineLineStatus,
  determineAllLineStatuses,
  canValidateAll as canValidateAllStatuses,
  countByStatus,
} from "./engine/productLineStatusV2";
export type { LineStatus, LineStatusResult, LineAction } from "./engine/productLineStatusV2";

// Components
export { ExtractionSettingsPanel } from "./components/ExtractionSettingsPanel";
