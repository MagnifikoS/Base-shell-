/**
 * Vision AI — Relevé (Statement of Account) Types
 *
 * Types for supplier account statement extraction, reconciliation,
 * and discrepancy detection against stored invoices.
 */

import type { Insight } from "../types";
import type { DocumentQuality } from "./blTypes";

// ── Relevé Header ──

export interface ReleveHeader {
  supplier_name: string | null;
  supplier_account_ref: string | null;
  period_start: string | null; // YYYY-MM-DD
  period_end: string | null; // YYYY-MM-DD
  previous_balance: number | null;
  total_invoiced: number | null;
  total_credits: number | null;
  total_payments: number | null;
  balance_due: number | null;
  issue_date: string | null; // YYYY-MM-DD
}

// ── Relevé Line ──

export type ReleveLineType = "invoice" | "credit_note" | "payment" | "other";

export interface ReleveLine {
  line_type: ReleveLineType;
  reference: string | null;
  date: string | null; // YYYY-MM-DD
  description: string | null;
  amount_ht: number | null;
  amount_ttc: number | null;
  amount_tva: number | null;
  due_date: string | null;
  is_credit: boolean;
  field_confidence: {
    reference: number;
    amount_ttc: number;
    date: number;
  };
}

// ── Relevé Extraction Response ──

export interface ReleveExtractionResponse {
  success: true;
  doc_type: "releve";
  releve: ReleveHeader;
  releve_lines: ReleveLine[];
  document_quality: DocumentQuality;
  insights: Insight[];
  needs_human_review: true;
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILIATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ReconciliationLineStatus =
  | "exact_match"
  | "amount_mismatch"
  | "date_mismatch"
  | "partial_match";

export interface MatchedLine {
  releve_line: ReleveLine;
  db_invoice: {
    id: string;
    invoice_number: string | null;
    invoice_date: string;
    amount_eur: number;
    is_paid: boolean;
  };
  status: ReconciliationLineStatus;
  amount_difference: number | null;
  notes: string | null;
}

export type ReconciliationAlertType =
  | "invoice_not_in_db"
  | "amount_mismatch"
  | "invoice_not_in_releve"
  | "balance_discrepancy"
  | "credit_note_unmatched"
  | "duplicate_reference"
  | "supplier_not_found"
  | "period_gap";

export type ReconciliationAlertSeverity = "critical" | "warning" | "info";

export interface ReconciliationAlert {
  severity: ReconciliationAlertSeverity;
  type: ReconciliationAlertType;
  message: string;
  releve_line?: ReleveLine;
  db_invoice?: MatchedLine["db_invoice"];
}

export interface ReconciliationResult {
  supplier_id: string | null;
  supplier_name: string;
  period: { start: string; end: string };
  matched_lines: MatchedLine[];
  missing_from_db: ReleveLine[];
  missing_from_releve: Array<{
    id: string;
    invoice_number: string | null;
    invoice_date: string;
    amount_eur: number;
    is_paid: boolean;
  }>;
  total_releve: number;
  total_db: number;
  balance_difference: number;
  alerts: ReconciliationAlert[];
}
