/**
 * Vision AI Scan History — Types
 *
 * Types for persistent scan document tracking and extraction run history.
 */

import type { InvoiceData, ExtractedProductLine, Insight } from "../types";

// ── Document Type ──

export type ScanDocType = "facture" | "bl" | "releve";

// ── Database Row Types ──

export interface ScanDocument {
  id: string;
  establishment_id: string;
  owner_id: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number | null;
  storage_path: string;
  supplier_name: string | null;
  invoice_number: string | null;
  runs_count: number;
  last_run_at: string | null;
  created_at: string;
  created_by: string | null;
  doc_type: ScanDocType;
  bl_number: string | null;
  releve_period_start: string | null;
  releve_period_end: string | null;
}

export interface ScanRun {
  id: string;
  scan_id: string;
  model_id: string;
  model_label: string;
  precision_mode: string;
  result_invoice: InvoiceData | null;
  result_items: ExtractedProductLine[] | null;
  result_insights: Insight[] | null;
  items_count: number;
  insights_count: number;
  duration_ms: number | null;
  status: "success" | "error";
  error_message: string | null;
  created_at: string;
  created_by: string | null;
  doc_type: ScanDocType;
  result_bl: unknown;
  result_bl_items: unknown;
  result_releve: unknown;
  result_releve_lines: unknown;
  result_reconciliation: unknown;
}

// ── Model Mapping ──

export const SCAN_MODEL_MAP: Record<string, { id: string; label: string }> = {
  claude: {
    id: "claude-sonnet-4-5-20250929",
    label: "Vision AI",
  },
};
