/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-APP — Public API (V1)
 *
 * Module documentaire isolé. Supprimable via `rm -rf src/modules/blApp`.
 * Dependencies: stockLedger (for buildCanonicalLine, voidDocument, idempotency).
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Types
export type {
  BlAppDocument,
  BlAppLine,
  BlAppFile,
  BlAppStatus,
  CreateBlAppPayload,
  CreateBlAppLinePayload,
  CompleteBlAppPayload,
} from "./types";

// Hooks
export { useBlAppDocumentByStockDocumentId } from "./hooks/useBlAppDocumentByStockDocumentId";
export { useBlAppDocumentsByMonth } from "./hooks/useBlAppDocumentsByMonth";
export { useCreateBlApp } from "./hooks/useCreateBlApp";
export { useCompleteBlApp } from "./hooks/useCompleteBlApp";
export { useUploadBlAppFile } from "./hooks/useUploadBlAppFile";
export { useBlAppLines } from "./hooks/useBlAppLines";
export { useBlAppFiles } from "./hooks/useBlAppFiles";

// Components
export { BlAppPostPopup } from "./components/BlAppPostPopup";
export { BlAppTab } from "./components/BlAppTab";

// Services (for advanced usage)
export { getBlAppFileSignedUrl } from "./services/blAppService";
