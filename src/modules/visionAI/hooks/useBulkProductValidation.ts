/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — useBulkProductValidation Hook (V2 ONLY)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Provides the EditableProductLine type used across Vision AI components.
 * V1 bulk creation logic has been REMOVED — all product creation goes 
 * through the Drawer / Wizard V3 flow (SSOT: products_v2).
 */

import type { ExtractedProductLine } from "../types";

export interface EditableProductLine extends ExtractedProductLine {
  /** Unique ID for React key and tracking */
  _id: string;
  /** Validation error message if any */
  _error?: string;
  /** Has been successfully created */
  _validated?: boolean;
}
