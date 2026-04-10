/**
 * ===============================================================================
 * SHARED — Post Popup Types
 * ===============================================================================
 *
 * Interface for the BL-APP post popup, used to break the circular dependency
 * between stockLedger and blApp modules.
 *
 * BEFORE: stockLedger -> blApp (for BlAppPostPopup component)
 *         blApp -> stockLedger (for buildCanonicalLine, etc.)
 *
 * AFTER:  stockLedger accepts renderPostPopup prop (typed here)
 *         blApp -> stockLedger (one-way, no cycle)
 *
 * ===============================================================================
 */

import type { ComponentType } from "react";

/**
 * Props interface matching BlAppPostPopup props.
 * Used by stockLedger to type its optional renderPostPopup slot.
 */
export interface PostPopupProps {
  open: boolean;
  onClose: () => void;
  stockDocumentId: string;
  establishmentId: string;
  supplierId: string | null;
  supplierName: string | null;
  userId: string;
  /** Pre-POST mode: if provided, "Valider" calls this first. */
  onPostStock?: () => Promise<{ ok: boolean; error?: string }>;
  /** Number of lines for display in pre-post mode */
  linesCount?: number;
}

export type PostPopupComponent = ComponentType<PostPopupProps>;
