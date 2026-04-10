/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — RELEVÉ GUARDRAILS PLUGIN (Rollback-safe)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE: Post-reconciliation guardrails for Relevé (statement of account).
 * Detects missing invoices, amount mismatches, balance discrepancies, and
 * period gaps — WITHOUT any extra AI call.
 *
 * TOGGLE: VISION_AI_GUARDRAILS_ENABLED (default: true)
 * ROLLBACK: Delete this file + remove import from consumer
 *
 * ARCHITECTURE:
 * - O(n) per reconciliation, zero network calls, session-only flags
 * - Does NOT modify DB, does NOT add AI calls
 * - Pure in-memory analysis on reconciliation data already computed
 */

import type {
  ReconciliationResult,
  ReleveHeader,
  ReleveLine,
  MatchedLine,
} from "../types/releveTypes";
import { VISION_AI_GUARDRAILS_ENABLED } from "@/config/featureFlags";

// ═══════════════════════════════════════════════════════════════════════════
// FLAG TYPES (session-only, never persisted)
// ═══════════════════════════════════════════════════════════════════════════

export type ReleveFlagType =
  | "invoice_not_found" // Relevé invoice ref not found in DB
  | "amount_mismatch" // Relevé amount != stored invoice amount_eur (±0.01€)
  | "date_mismatch" // Relevé date != stored invoice invoice_date
  | "missing_invoice" // Invoice in DB for supplier+period but NOT in Relevé
  | "extra_invoice" // Invoice in Relevé but NOT in DB
  | "balance_discrepancy" // Computed balance != stated balance on Relevé
  | "period_incomplete"; // Period doesn't cover full month

export type ReleveFlagSeverity = "info" | "warning" | "alert";

export interface ReleveFlag {
  type: ReleveFlagType;
  severity: ReleveFlagSeverity;
  message: string;
  /** Optional reference to the relevé line that triggered this flag */
  releve_line?: ReleveLine;
  /** Optional reference to the DB invoice that triggered this flag */
  db_invoice?: MatchedLine["db_invoice"];
}

export interface ReleveGuardrailResult {
  /** All flags raised during guardrail analysis */
  flags: ReleveFlag[];
  /** True if any alert-severity flag was raised */
  has_alerts: boolean;
  /** True if any warning or alert flag was raised */
  has_warnings: boolean;
  /** Total number of flags */
  total_flag_count: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Tolerance for amount comparison (in euros) */
const AMOUNT_TOLERANCE = 0.01;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a period covers a full calendar month.
 * A full month means: start is the 1st and end is the last day of that month.
 */
function isFullMonth(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;

  const startDate = new Date(start);
  const endDate = new Date(end);

  // Start must be the 1st of a month
  if (startDate.getUTCDate() !== 1) return false;

  // End must be the last day of a month
  const nextDay = new Date(endDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  if (nextDay.getUTCDate() !== 1) return false;

  return true;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2) + " €";
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE CHECKS
// ═══════════════════════════════════════════════════════════════════════════

function checkInvoiceNotFound(reconciliation: ReconciliationResult): ReleveFlag[] {
  // RULE 1: invoice_not_found — Relevé invoice ref not found in invoices table
  return reconciliation.missing_from_db
    .filter((line) => line.line_type === "invoice")
    .map((line) => ({
      type: "invoice_not_found" as const,
      severity: "alert" as const,
      message: `Facture « ${line.reference ?? "sans réf."} » du relevé introuvable en base`,
      releve_line: line,
    }));
}

function checkAmountMismatches(reconciliation: ReconciliationResult): ReleveFlag[] {
  // RULE 2: amount_mismatch — Relevé amount != stored invoice amount_eur (tolerance ±0.01€)
  return reconciliation.matched_lines
    .filter((match) => {
      if (match.amount_difference === null) return false;
      return Math.abs(match.amount_difference) > AMOUNT_TOLERANCE;
    })
    .map((match) => ({
      type: "amount_mismatch" as const,
      severity: "alert" as const,
      message: `Écart de ${formatAmount(Math.abs(match.amount_difference!))} sur facture « ${match.db_invoice.invoice_number ?? match.releve_line.reference ?? "sans réf."} »`,
      releve_line: match.releve_line,
      db_invoice: match.db_invoice,
    }));
}

function checkDateMismatches(reconciliation: ReconciliationResult): ReleveFlag[] {
  // RULE 3: date_mismatch — Relevé date != stored invoice invoice_date
  return reconciliation.matched_lines
    .filter((match) => {
      if (!match.releve_line.date) return false;
      return match.releve_line.date !== match.db_invoice.invoice_date;
    })
    .map((match) => ({
      type: "date_mismatch" as const,
      severity: "warning" as const,
      message: `Date différente pour facture « ${match.db_invoice.invoice_number ?? "sans réf."} » : relevé ${match.releve_line.date} vs base ${match.db_invoice.invoice_date}`,
      releve_line: match.releve_line,
      db_invoice: match.db_invoice,
    }));
}

function checkMissingInvoices(reconciliation: ReconciliationResult): ReleveFlag[] {
  // RULE 4: missing_invoice — Invoice in DB for supplier+period but NOT in Relevé
  return reconciliation.missing_from_releve.map((invoice) => ({
    type: "missing_invoice" as const,
    severity: "warning" as const,
    message: `Facture « ${invoice.invoice_number ?? invoice.id} » (${formatAmount(invoice.amount_eur)}) présente en base mais absente du relevé`,
    db_invoice: invoice,
  }));
}

function checkExtraInvoices(reconciliation: ReconciliationResult): ReleveFlag[] {
  // RULE 5: extra_invoice — Invoice in Relevé but NOT in our DB
  // These are non-invoice lines (credit notes, payments, other) from missing_from_db
  return reconciliation.missing_from_db
    .filter((line) => line.line_type !== "invoice")
    .map((line) => ({
      type: "extra_invoice" as const,
      severity: "info" as const,
      message: `Ligne « ${line.reference ?? line.description ?? "sans réf."} » (${line.line_type}) présente dans le relevé mais pas en base`,
      releve_line: line,
    }));
}

function checkBalanceDiscrepancy(
  reconciliation: ReconciliationResult,
  releveHeader: ReleveHeader
): ReleveFlag[] {
  // RULE 6: balance_discrepancy — Computed balance != stated balance on Relevé
  if (releveHeader.balance_due === null) return [];

  const difference = Math.abs(reconciliation.balance_difference);
  if (difference <= AMOUNT_TOLERANCE) return [];

  return [
    {
      type: "balance_discrepancy",
      severity: "alert",
      message: `Écart de solde : relevé indique ${formatAmount(releveHeader.balance_due)}, calcul donne un écart de ${formatAmount(difference)}`,
    },
  ];
}

function checkPeriodIncomplete(releveHeader: ReleveHeader): ReleveFlag[] {
  // RULE 7: period_incomplete — Period doesn't cover full month
  if (isFullMonth(releveHeader.period_start, releveHeader.period_end)) return [];

  const periodDesc =
    releveHeader.period_start && releveHeader.period_end
      ? `${releveHeader.period_start} → ${releveHeader.period_end}`
      : "période non définie";

  return [
    {
      type: "period_incomplete",
      severity: "info",
      message: `La période du relevé ne couvre pas un mois complet (${periodDesc})`,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE: Apply Relevé guardrails to a reconciliation result
// ═══════════════════════════════════════════════════════════════════════════

export function applyReleveGuardrails(
  reconciliation: ReconciliationResult,
  releveHeader: ReleveHeader
): ReleveGuardrailResult {
  // Passthrough when guardrails disabled
  if (!VISION_AI_GUARDRAILS_ENABLED) {
    return {
      flags: [],
      has_alerts: false,
      has_warnings: false,
      total_flag_count: 0,
    };
  }

  const flags: ReleveFlag[] = [
    ...checkInvoiceNotFound(reconciliation),
    ...checkAmountMismatches(reconciliation),
    ...checkDateMismatches(reconciliation),
    ...checkMissingInvoices(reconciliation),
    ...checkExtraInvoices(reconciliation),
    ...checkBalanceDiscrepancy(reconciliation, releveHeader),
    ...checkPeriodIncomplete(releveHeader),
  ];

  const hasAlerts = flags.some((f) => f.severity === "alert");
  const hasWarnings = flags.some((f) => f.severity === "warning" || f.severity === "alert");

  if (flags.length > 0 && import.meta.env.DEV) {
    const alertCount = flags.filter((f) => f.severity === "alert").length;
    const warningCount = flags.filter((f) => f.severity === "warning").length;
    const infoCount = flags.filter((f) => f.severity === "info").length;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug(
        `[Vision AI Relevé Guardrails] ${flags.length} flag(s) — ` +
          `${alertCount} alerte(s), ${warningCount} avertissement(s), ${infoCount} info(s)`
      );
    }
  }

  return {
    flags,
    has_alerts: hasAlerts,
    has_warnings: hasWarnings,
    total_flag_count: flags.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/** Check if a guardrail result has any flags at all */
export function hasReleveFlags(result: ReleveGuardrailResult): boolean {
  return result.total_flag_count > 0;
}

/** Get all flag messages as a flat list */
export function getReleveFlagMessages(result: ReleveGuardrailResult): string[] {
  return result.flags.map((f) => f.message);
}

/** Get flags filtered by severity */
export function getReleveFlagsBySeverity(
  result: ReleveGuardrailResult,
  severity: ReleveFlagSeverity
): ReleveFlag[] {
  return result.flags.filter((f) => f.severity === severity);
}
