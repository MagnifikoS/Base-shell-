/**
 * Vision AI — BL (Bon de Livraison) Types
 *
 * Types for delivery note extraction and quality assessment.
 * Used by the BL extraction pipeline and guardrails plugin.
 */

import type { Insight } from "../types";

// ── BL Header ──

export interface BLHeader {
  supplier_name: string | null;
  bl_number: string | null;
  bl_date: string | null; // YYYY-MM-DD if readable
  order_reference: string | null;
}

// ── BL Item ──

export interface BLItem {
  raw_label: string;
  /** Code article fournisseur extrait du document. null si absent ou illisible. */
  product_code?: string | null;
  product_name: string; // Cleaned name, or "UNREADABLE"
  qty_delivered: number | null;
  unit: string | null; // kg, pce, bte, etc.
  notes: string | null;
  field_confidence: {
    product_name: number; // 0.0 - 1.0
    qty_delivered: number;
    unit: number;
  };
  unreadable_fields: Array<{
    field: string;
    reason: string; // "handwriting_unclear", "photo_blurry", "text_cut_off", etc.
  }>;
}

// ── Document Quality ──

export interface DocumentQuality {
  score: number; // 0.0 - 1.0
  issues: string[]; // "low_resolution", "skewed", "partial_page", etc.
}

// ── BL Extraction Response ──

export interface BLExtractionResponse {
  success: true;
  doc_type: "bl";
  bl: BLHeader;
  bl_items: BLItem[];
  document_quality: DocumentQuality;
  insights: Insight[];
  needs_human_review: true;
  warnings: string[];
}
