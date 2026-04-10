/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE STOCK LEDGER V1 — Public API
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Modular, retirable: `rm -rf src/modules/stockLedger`
 * No V0 module modified.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Types
export type {
  StockDocumentType,
  StockDocumentStatus,
  StockEventType,
  ZoneStockSnapshot,
  StockDocument,
  StockDocumentLine,
  StockEvent,
  EstimatedStockResult,
  StockEngineError,
  StockEngineWarning,
  EstimatedStockOutcome,
  ContextHashInput,
  PostDocumentInput,
  PostDocumentResult,
  VoidDocumentInput,
  VoidDocumentResult,
  StockLineInputPayload,
} from "./types";

// Input Payload Helpers
export { getInputPayloadProductName } from "./types";

// StockEngine
export {
  getEstimatedStock,
  getEstimatedStockBatch,
} from "./engine/stockEngine";
export type {
  SnapshotLine,
  UnitFamilyResolver,
  BatchStockInput,
} from "./engine/stockEngine";

// Single-product adapter (Phase 2A — delegates 100% to StockEngine)
export { fetchSingleProductStock } from "./engine/fetchSingleProductStock";

// Context Hash
export { computeContextHash, buildContextHashInput } from "./engine/contextHash";

// Canonical Line Builder (unified SSOT)
export {
  buildCanonicalLine,
  extractPackagingLevels,
  extractEquivalence,
} from "./engine/buildCanonicalLine";
export type {
  BuildCanonicalLineInput,
  CanonicalLineMetadata,
  ProductConfig,
} from "./engine/buildCanonicalLine";

// Post Guards
export { validatePrePost, generateIdempotencyKey, checkNegativeStock } from "./engine/postGuards";
export type {
  PrePostValidationInput,
  PrePostValidationResult,
  NegativeStockCheck,
} from "./engine/postGuards";

// Void Engine
export { prepareVoidEvents, verifyVoidBalance } from "./engine/voidEngine";
// BL Retrait Types
export type {
  BlRetrait,
  BlRetraitLine,
  CreateBlRetraitPayload,
  CreateBlRetraitLinePayload,
} from "./types/blRetrait";

export type { VoidEventTemplate, VoidPreparationResult } from "./engine/voidEngine";

// Hooks
export { useVoidDocument } from "./hooks/useVoidDocument";
export type { VoidResult } from "./hooks/useVoidDocument";

// BL Retrait Hooks
export { useBlRetraits } from "./hooks/useBlRetraits";
export type { BlRetraitWithLines } from "./hooks/useBlRetraits";
export { useCreateBlRetrait } from "./hooks/useCreateBlRetrait";

// Error Diagnostics
export { getErrorDiagnosticLabel } from "./engine/errorDiagnostics";

// Components (used by inventaire module)
export { MobileReceptionView } from "./components/MobileReceptionView";
export { MobileWithdrawalView } from "./components/MobileWithdrawalView";
export { WithdrawalTabWrapper } from "./components/WithdrawalTabWrapper";

// BL Retrait Components
export { BlRetraitPostPopup } from "./components/BlRetraitPostPopup";
export { BlRetraitTab } from "./components/BlRetraitTab";
export { BlRetraitDetail } from "./components/BlRetraitDetail";

// Quantity modal — Universal (Phase 1)
export { UniversalQuantityModal, ReceptionQuantityModal } from "./components/ReceptionQuantityModal";
export type { QuantityProduct, ReceptionProduct, UniversalQuantityModalProps, QuantityContextType, QuantityEntry, StepperConfig, UiMode } from "./components/ReceptionQuantityModal";

// Conversion utility (orchestrator-side)
export { resolveInputConversion, convertToCanonical } from "./utils/resolveInputConversion";
export type { ConversionResult, CanonicalResult } from "./utils/resolveInputConversion";
