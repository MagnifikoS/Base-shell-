/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — Releve Reconciliation Service (READ-ONLY)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cross-references extracted releve (statement of account) lines against
 * existing invoices in the database.
 *
 * RULES:
 * - READ-ONLY: Never writes to the invoices table
 * - Matches releve lines to DB invoices using multi-tier matching logic
 * - Generates alerts for discrepancies
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";
import { getMonthBoundsParis, getYearMonthFromDateParis } from "@/lib/time/dateKeyParis";
import type {
  ReconciliationResult,
  ReconciliationAlert,
  MatchedLine,
  ReleveHeader,
  ReleveLine,
} from "../types/releveTypes";

// ── Types for DB query results ──

interface DbInvoiceRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  amount_eur: number;
  is_paid: boolean;
  supplier_id: string;
  supplier_name: string | null;
}

interface DbSupplierRow {
  id: string;
  name: string;
}

// ── Invoice number normalization ──

/**
 * Normalize an invoice reference for robust matching.
 *
 * Step 1 (full normalization): uppercase + remove separators + strip leading zeros.
 *   "FAC-2026-00946" → "FAC202600946"
 *   "2026-00946"     → "202600946"
 *
 * Step 2 (digits-only normalization): extract ALL digits (not just trailing) + strip leading zeros.
 *   "FAC-2026-00946" → "202600946"
 *   "2026-00946"     → "202600946"   ← same → match!
 *
 * The caller (findBestMatch) tries full normalization first, then digits-only.
 * This handles the common case where the supplier's own reference includes a
 * text prefix (e.g. "FAC-") that we don't store, or vice-versa.
 */
function normalizeInvoiceNumber(ref: string): string {
  return ref
    .toUpperCase()
    .replace(/[\s\-_./]/g, "") // Remove separators
    .replace(/^0+/, ""); // Remove leading zeros
}

/**
 * Extract only the significant digit sequence from a reference.
 * Strips all non-digit characters, then removes leading zeros.
 * Used as a secondary matching key to handle prefix mismatches
 * like "FAC-2026-00946" vs "2026-00946".
 *
 * Returns null if the ref contains no digits at all (e.g. "AVOIR").
 */
function normalizeToDigits(ref: string): string | null {
  const digits = ref.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length > 0 ? digits : null;
}

// ── Amount comparison ──

const AMOUNT_TOLERANCE = 0.01;

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

// ── Supplier lookup ──

/**
 * Find a supplier by name using case-insensitive fuzzy match.
 * Tries exact ilike first, then a broader pattern with wildcards.
 */
async function findSupplierByName(
  supplierName: string,
  establishmentId: string
): Promise<DbSupplierRow | null> {
  // Try exact case-insensitive match first
  const { data: exactMatch, error: exactError } = await supabase
    .from("invoice_suppliers")
    .select("id, name")
    .eq("establishment_id", establishmentId)
    .ilike("name", supplierName.trim())
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (!exactError && exactMatch) {
    return exactMatch as DbSupplierRow;
  }

  // Try broader fuzzy match with wildcards around the name
  const { data: fuzzyMatch, error: fuzzyError } = await supabase
    .from("invoice_suppliers")
    .select("id, name")
    .eq("establishment_id", establishmentId)
    .ilike("name", `%${supplierName.trim()}%`)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (!fuzzyError && fuzzyMatch) {
    return fuzzyMatch as DbSupplierRow;
  }

  return null;
}

// ── Fetch invoices for reconciliation ──

/**
 * Fetch invoices for a supplier within a period window.
 * The window covers the FULL months implied by periodStart and periodEnd,
 * plus a 7-day buffer on each side to catch edge cases.
 *
 * Key fix: We always expand to full month boundaries so that a February
 * invoice (e.g. 2026-02-01 → 2026-02-28) is never excluded when the
 * statement covers February — regardless of which lines the AI extracted.
 */
function addDays(dateStr: string, days: number): string {
  // Parse as local date (avoid UTC midnight shifting to previous day)
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Expand a date range to cover full calendar months.
 * "2026-02-05" → "2026-02-01" for start
 * "2026-02-05" → "2026-02-28" for end
 */
function expandToFullMonths(start: string, end: string): { start: string; end: string } {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);

  // First day of start month
  const fullStart = `${sy}-${String(sm).padStart(2, "0")}-01`;

  // Last day of end month
  const lastDay = new Date(ey, em, 0).getDate(); // day 0 of next month = last day of this month
  const fullEnd = `${ey}-${String(em).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return { start: fullStart, end: fullEnd };
}

async function fetchInvoicesForPeriod(
  supplierId: string,
  establishmentId: string,
  periodStart: string,
  periodEnd: string
): Promise<DbInvoiceRow[]> {
  // Expand to full calendar months:
  // - Start: 7-day buffer before the first day of the month (captures edge cases)
  // - End: STRICT last day of the month — NO buffer to avoid fetching next-month invoices
  const fullMonths = expandToFullMonths(periodStart, periodEnd);
  const fetchStart = addDays(fullMonths.start, -7);
  const fetchEnd = fullMonths.end; // Strict: last day of period month only

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[releveReconciliation] fetchInvoicesForPeriod", {
      supplierId,
      establishmentId,
      periodStart,
      periodEnd,
      fetchStart,
      fetchEnd,
    });
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_date, amount_eur, is_paid, supplier_id, supplier_name")
    .eq("establishment_id", establishmentId)
    .eq("supplier_id", supplierId)
    .gte("invoice_date", fetchStart)
    .lte("invoice_date", fetchEnd)
    .order("invoice_date", { ascending: true });

  if (error) {
    if (import.meta.env.DEV) {
      console.error("[releveReconciliation] fetchInvoicesForPeriod error:", error);
    }
    return [];
  }

  const rows = (data ?? []) as DbInvoiceRow[];

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[releveReconciliation] fetched ${rows.length} invoice(s)`, rows.map((r) => ({
      id: r.id.slice(0, 8),
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      amount_eur: r.amount_eur,
    })));
  }

  return rows;
}

// ── Period inference ──

/**
 * Infer the period for reconciliation using a 4-tier fallback:
 *   1. Header period_start + period_end (explicit from AI extraction)
 *   2. Min/max of line dates, expanded to full month boundaries
 *   3. Header issue_date (statement emission date), expanded to that month
 *   4. Current month in Europe/Paris timezone (last resort, with dev warning)
 *
 * Expanding to full month boundaries ensures we fetch ALL invoices for the
 * relevant month(s), not just those between the first and last line dates.
 */
function inferPeriod(header: ReleveHeader, lines: ReleveLine[]): { start: string; end: string } {
  // Priority 1: Use explicit period dates from the header
  if (header.period_start && header.period_end) {
    return { start: header.period_start, end: header.period_end };
  }

  // Priority 2: Infer from line dates (min/max expanded to full month boundaries)
  const dates = lines
    .map((line) => line.date)
    .filter((d): d is string => d !== null)
    .sort();

  if (dates.length > 0) {
    const firstDateYM = dates[0].substring(0, 7); // "YYYY-MM"
    const lastDateYM = dates[dates.length - 1].substring(0, 7);
    const startBounds = getMonthBoundsParis(firstDateYM);
    const endBounds = getMonthBoundsParis(lastDateYM);
    // Always use computed bounds from line dates — do NOT mix partial header
    // values, since we only reach this branch when the header is incomplete
    return {
      start: startBounds.start,
      end: endBounds.end,
    };
  }

  // Priority 3: Use header issue_date to derive the month
  if (header.issue_date) {
    const issueYM = header.issue_date.substring(0, 7); // "YYYY-MM"
    const bounds = getMonthBoundsParis(issueYM);
    return { start: bounds.start, end: bounds.end };
  }

  // Priority 4 (last resort): current month in Europe/Paris timezone
  if (import.meta.env.DEV) {
    console.warn(
      "[releveReconciliation] No period dates found in header or lines, falling back to current month"
    );
  }
  const currentYM = getYearMonthFromDateParis(new Date());
  const fallbackBounds = getMonthBoundsParis(currentYM);
  return { start: fallbackBounds.start, end: fallbackBounds.end };
}

// ── Main reconciliation ──

export async function reconcileReleve(params: {
  releveHeader: ReleveHeader;
  releveLines: ReleveLine[];
  establishmentId: string;
  /**
   * Optional: known supplier UUID from the UI context (e.g. selected supplier).
   * When provided, the fuzzy name-based lookup is skipped entirely — this
   * fixes the #1 cause of "0 matched" when the AI-extracted supplier name
   * doesn't exactly match the DB name (e.g. "SARL JAWAR FRAIS" vs "Jawar Frais").
   */
  knownSupplierId?: string | null;
}): Promise<ReconciliationResult> {
  const { releveHeader, releveLines, establishmentId, knownSupplierId } = params;
  const alerts: ReconciliationAlert[] = [];
  const supplierName = releveHeader.supplier_name?.trim() ?? "";

  // ── Step 1: Identify supplier ──

  let supplier: DbSupplierRow | null = null;

  if (knownSupplierId) {
    // SSOT: knownSupplierId is authoritative — no fuzzy fallback allowed.
    // If the supplier is archived or missing, we stop immediately with a critical alert.
    const { data, error } = await supabase
      .from("invoice_suppliers")
      .select("id, name")
      .eq("id", knownSupplierId)
      .is("archived_at", null)
      .maybeSingle();

    if (error) {
      if (import.meta.env.DEV) {
        console.error("[releveReconciliation] knownSupplierId DB error:", { knownSupplierId, error });
      }
      throw error;
    }

    if (!data) {
      // knownSupplierId is SSOT — fuzzy fallback is explicitly forbidden here.
      if (import.meta.env.DEV) {
        console.warn("[releveReconciliation] knownSupplierId not found or archived — blocking reconciliation", { knownSupplierId });
      }
      return buildEmptyResult({
        supplierName,
        period: inferPeriod(releveHeader, releveLines),
        alerts: [
          {
            severity: "critical",
            type: "supplier_not_found",
            message:
              "Le fournisseur sélectionné est introuvable ou archivé. Réactivez-le ou sélectionnez un autre fournisseur avant de relancer le rapprochement.",
          },
        ],
        releveLines,
      });
    }

    supplier = data as DbSupplierRow;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[releveReconciliation] supplier_resolution", {
        knownSupplierId,
        found: true,
        id: supplier.id,
        name: supplier.name,
      });
    }
  }

  // Fuzzy name lookup — only when knownSupplierId was NOT provided.
  if (!supplier) {
    if (!supplierName) {
      return buildEmptyResult({
        supplierName: "",
        period: inferPeriod(releveHeader, releveLines),
        alerts: [
          {
            severity: "critical",
            type: "supplier_not_found",
            message: "Nom du fournisseur absent du releve. Reconciliation impossible.",
          },
        ],
        releveLines,
      });
    }

    supplier = await findSupplierByName(supplierName, establishmentId);

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[releveReconciliation] Name lookup result:", {
        supplierName,
        found: supplier ? `${supplier.id} (${supplier.name})` : "NOT FOUND",
      });
    }

    if (!supplier) {
      return buildEmptyResult({
        supplierName,
        period: inferPeriod(releveHeader, releveLines),
        alerts: [
          {
            severity: "critical",
            type: "supplier_not_found",
            message: `Fournisseur "${supplierName}" introuvable dans la base de donnees. Reconciliation impossible.`,
          },
        ],
        releveLines,
      });
    }
  }

  // ── Step 2: Determine period ──

  const period = inferPeriod(releveHeader, releveLines);

  // ── Step 3: Fetch DB invoices ──

  const dbInvoices = await fetchInvoicesForPeriod(
    supplier.id,
    establishmentId,
    period.start,
    period.end
  );

  // ── Step 4: Cross-reference each releve line ──

  // Filter to invoice lines only (skip credit_notes, payments, other)
  const invoiceLines = releveLines.filter((line) => line.line_type === "invoice");

  const matchedLines: MatchedLine[] = [];
  const missingFromDb: ReleveLine[] = [];
  const matchedDbInvoiceIds = new Set<string>();

  // DEV: log first releve line vs first DB invoice for quick diagnosis
  if (import.meta.env.DEV && invoiceLines.length > 0 && dbInvoices.length > 0) {
    const sample = invoiceLines[0];
    // eslint-disable-next-line no-console
    console.log("[releveReconciliation] DIAGNOSTIC — sample line vs DB invoices", {
      releveLine: {
        reference: sample.reference,
        referenceNormText: sample.reference ? normalizeInvoiceNumber(sample.reference) : null,
        referenceDigits: sample.reference ? normalizeToDigits(sample.reference) : null,
        amount_ttc: sample.amount_ttc,
        date: sample.date,
      },
      dbInvoices: dbInvoices.map((inv) => ({
        id: inv.id.slice(0, 8),
        invoice_number: inv.invoice_number,
        normText: inv.invoice_number ? normalizeInvoiceNumber(inv.invoice_number) : null,
        digits: inv.invoice_number ? normalizeToDigits(inv.invoice_number) : null,
        amount_eur: inv.amount_eur,
        invoice_date: inv.invoice_date,
      })),
    });
  }

  if (import.meta.env.DEV && dbInvoices.length === 0) {
    console.warn("[releveReconciliation] ⚠️ 0 invoices fetched — check supplier_id and period");
  }

  for (const releveLine of invoiceLines) {
    const match = findBestMatch(releveLine, dbInvoices, matchedDbInvoiceIds);

    if (match) {
      matchedLines.push(match);
      matchedDbInvoiceIds.add(match.db_invoice.id);
    } else {
      missingFromDb.push(releveLine);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[releveReconciliation] No match for line:", {
          reference: releveLine.reference,
          amount_ttc: releveLine.amount_ttc,
          date: releveLine.date,
        });
      }
    }
  }

  // ── Step 5: Find DB invoices not matched ──

  // Only flag as "missing from relevé" invoices that fall STRICTLY within the relevé period.
  // Invoices outside the period month (e.g. a February invoice in a January relevé)
  // are legitimately absent from the relevé and must NOT be shown as discrepancies.
  const missingFromReleve = dbInvoices
    .filter(
      (inv) =>
        !matchedDbInvoiceIds.has(inv.id) &&
        inv.invoice_date >= period.start &&
        inv.invoice_date <= period.end
    )
    .map((inv) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      invoice_date: inv.invoice_date,
      amount_eur: inv.amount_eur,
      is_paid: inv.is_paid,
    }));

  // ── Step 6: Compute totals ──

  const totalReleve = invoiceLines.reduce((sum, line) => {
    const amount = line.amount_ttc ?? 0;
    return sum + (line.is_credit ? -amount : amount);
  }, 0);

  const totalDb = matchedLines.reduce((sum, m) => sum + m.db_invoice.amount_eur, 0);

  const balanceDifference = Math.abs(totalReleve - totalDb);

  // ── Step 7: Generate alerts ──

  // Missing from DB
  for (const line of missingFromDb) {
    alerts.push({
      severity: "critical",
      type: "invoice_not_in_db",
      message: `Facture "${line.reference ?? "sans reference"}" du releve introuvable dans la base de donnees.`,
      releve_line: line,
    });
  }

  // Amount mismatches
  for (const matched of matchedLines) {
    if (matched.status === "amount_mismatch") {
      alerts.push({
        severity: "warning",
        type: "amount_mismatch",
        message: `Ecart de montant sur la facture "${matched.db_invoice.invoice_number ?? ""}": releve ${matched.releve_line.amount_ttc ?? 0} EUR vs base ${matched.db_invoice.amount_eur} EUR (difference: ${matched.amount_difference?.toFixed(2) ?? "0.00"} EUR).`,
        releve_line: matched.releve_line,
        db_invoice: matched.db_invoice,
      });
    }
  }

  // Missing from releve
  for (const inv of missingFromReleve) {
    alerts.push({
      severity: "warning",
      type: "invoice_not_in_releve",
      message: `Facture "${inv.invoice_number ?? inv.id}" presente dans la base mais absente du releve.`,
      db_invoice: inv,
    });
  }

  // Balance discrepancy
  if (balanceDifference > AMOUNT_TOLERANCE) {
    alerts.push({
      severity: "critical",
      type: "balance_discrepancy",
      message: `Ecart de solde detecte: total releve ${totalReleve.toFixed(2)} EUR vs total base ${totalDb.toFixed(2)} EUR (difference: ${balanceDifference.toFixed(2)} EUR).`,
    });
  }

  return {
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    period,
    matched_lines: matchedLines,
    missing_from_db: missingFromDb,
    missing_from_releve: missingFromReleve,
    total_releve: totalReleve,
    total_db: totalDb,
    balance_difference: balanceDifference,
    alerts,
  };
}

// ── Matching logic ──

/**
 * Build a MatchedLine from a releve line and a DB invoice.
 * Determines the match quality (exact, amount_mismatch, date_mismatch, partial).
 *
 * @param notes Optional note to append (e.g. "digits_normalized" to indicate how the match was found)
 */
function buildMatchResult(
  releveLine: ReleveLine,
  dbInv: DbInvoiceRow,
  releveAmount: number | null,
  releveDate: string | null,
  matchNote?: string
): MatchedLine {
  const amountOk = releveAmount !== null && amountsMatch(releveAmount, dbInv.amount_eur);
  const dateOk = releveDate !== null && releveDate === dbInv.invoice_date;

  const dbSnapshot = {
    id: dbInv.id,
    invoice_number: dbInv.invoice_number,
    invoice_date: dbInv.invoice_date,
    amount_eur: dbInv.amount_eur,
    is_paid: dbInv.is_paid,
  };

  // Exact match: reference + amount + date all align
  if (amountOk && dateOk) {
    return {
      releve_line: releveLine,
      db_invoice: dbSnapshot,
      status: "exact_match",
      amount_difference: null,
      notes: matchNote ?? null,
    };
  }

  // Amount mismatch: reference matches but amounts differ
  if (!amountOk && releveAmount !== null) {
    const diff = releveAmount - dbInv.amount_eur;
    return {
      releve_line: releveLine,
      db_invoice: dbSnapshot,
      status: "amount_mismatch",
      amount_difference: diff,
      notes: `Montant releve: ${releveAmount} EUR, montant base: ${dbInv.amount_eur} EUR${matchNote ? ` (${matchNote})` : ""}`,
    };
  }

  // Date mismatch: reference + amount match but dates differ
  if (amountOk && !dateOk) {
    return {
      releve_line: releveLine,
      db_invoice: dbSnapshot,
      status: "date_mismatch",
      amount_difference: null,
      notes: `Date releve: ${releveDate ?? "inconnue"}, date base: ${dbInv.invoice_date}${matchNote ? ` (${matchNote})` : ""}`,
    };
  }

  // Partial match: reference matches but amount/date are null or both mismatched
  return {
    releve_line: releveLine,
    db_invoice: dbSnapshot,
    status: "partial_match",
    amount_difference: null,
    notes: `Correspondance partielle sur la reference uniquement.${matchNote ? ` (${matchNote})` : ""}`,
  };
}

function findBestMatch(
  releveLine: ReleveLine,
  dbInvoices: DbInvoiceRow[],
  alreadyMatched: Set<string>
): MatchedLine | null {
  const releveRef = releveLine.reference;
  const releveAmount = releveLine.amount_ttc;
  const releveDate = releveLine.date;

  // ── Strategy 1a: Match by full-normalized invoice reference ──
  // Handles separator differences: "FA-001" == "FA001" == "FA 001"
  if (releveRef) {
    const normalizedReleveRef = normalizeInvoiceNumber(releveRef);

    for (const dbInv of dbInvoices) {
      if (alreadyMatched.has(dbInv.id)) continue;
      if (!dbInv.invoice_number) continue;

      const normalizedDbRef = normalizeInvoiceNumber(dbInv.invoice_number);
      if (normalizedReleveRef !== normalizedDbRef) continue;

      return buildMatchResult(releveLine, dbInv, releveAmount, releveDate);
    }
  }

  // ── Strategy 1b: Match by digits-only normalization ──
  // Handles prefix mismatches: "FAC-2026-00946" (DB) vs "2026-00946" (relevé)
  // Both yield digits "202600946" → same → match.
  // Guard: ≥5 digits required to avoid false positives on short refs like "001".
  if (releveRef) {
    const releveDigits = normalizeToDigits(releveRef);

    if (releveDigits !== null && releveDigits.length >= 5) {
      for (const dbInv of dbInvoices) {
        if (alreadyMatched.has(dbInv.id)) continue;
        if (!dbInv.invoice_number) continue;

        const dbDigits = normalizeToDigits(dbInv.invoice_number);
        if (dbDigits === null || dbDigits.length < 5) continue;
        if (releveDigits !== dbDigits) continue;

        return buildMatchResult(releveLine, dbInv, releveAmount, releveDate, "digits_normalized");
      }
    }
  }

  // ── Strategy 2a: Fallback — match by amount + exact date ──
  if (releveAmount !== null && releveDate !== null) {
    for (const dbInv of dbInvoices) {
      if (alreadyMatched.has(dbInv.id)) continue;

      if (amountsMatch(releveAmount, dbInv.amount_eur) && releveDate === dbInv.invoice_date) {
        return {
          releve_line: releveLine,
          db_invoice: {
            id: dbInv.id,
            invoice_number: dbInv.invoice_number,
            invoice_date: dbInv.invoice_date,
            amount_eur: dbInv.amount_eur,
            is_paid: dbInv.is_paid,
          },
          status: "partial_match",
          amount_difference: null,
          notes: "Correspondance par montant + date (reference absente du releve).",
        };
      }
    }
  }

  // ── Strategy 2b: Fallback — match by amount alone (same month) ──
  // When the date on the relevé line doesn't exactly match the DB date,
  // or when there's no date on the line at all — but the amount is unique
  // within the fetched window (which is already scoped to the correct month).
  if (releveAmount !== null) {
    // Only apply this if there's exactly ONE invoice with this amount in the window
    // to avoid false positives.
    const candidates = dbInvoices.filter(
      (dbInv) => !alreadyMatched.has(dbInv.id) && amountsMatch(releveAmount, dbInv.amount_eur)
    );

    if (candidates.length === 1) {
      const dbInv = candidates[0];
      return {
        releve_line: releveLine,
        db_invoice: {
          id: dbInv.id,
          invoice_number: dbInv.invoice_number,
          invoice_date: dbInv.invoice_date,
          amount_eur: dbInv.amount_eur,
          is_paid: dbInv.is_paid,
        },
        status: "partial_match",
        amount_difference: null,
        notes: "Correspondance par montant uniquement (référence ou date introuvable).",
      };
    }
  }

  // No match found at all
  return null;
}

// ── Helper: build empty result for early returns ──

function buildEmptyResult(params: {
  supplierName: string;
  period: { start: string; end: string };
  alerts: ReconciliationAlert[];
  releveLines: ReleveLine[];
}): ReconciliationResult {
  const invoiceLines = params.releveLines.filter((l) => l.line_type === "invoice");
  const totalReleve = invoiceLines.reduce((sum, line) => {
    const amount = line.amount_ttc ?? 0;
    return sum + (line.is_credit ? -amount : amount);
  }, 0);

  return {
    supplier_id: null,
    supplier_name: params.supplierName,
    period: params.period,
    matched_lines: [],
    missing_from_db: invoiceLines,
    missing_from_releve: [],
    total_releve: totalReleve,
    total_db: 0,
    balance_difference: Math.abs(totalReleve),
    alerts: params.alerts,
  };
}

// ── Exported for unit testing only ──

export const _testInternals = {
  normalizeInvoiceNumber,
  normalizeToDigits,
  amountsMatch,
  inferPeriod,
  findBestMatch,
};

