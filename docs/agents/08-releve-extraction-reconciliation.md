# Agent: ReleveExtractionReconciliation

## Mission
Add Relevé (supplier account statement) extraction and automatic reconciliation against existing invoices in the database. This is a **verification & alerting** tool — it does NOT create new invoices.

## What is a Relevé?
A **Relevé de compte fournisseur** is a document sent by a supplier that lists:
- All invoices sent during a period (with numbers, dates, amounts)
- Any credit notes (avoirs)
- Previous balance (solde précédent)
- Current balance due (total dû / solde)
- Payment references (if any)

**Business value**: The restaurant owner can verify:
- Are all invoices from the supplier accounted for in our system?
- Do the amounts match?
- Are there invoices we missed?
- Is the supplier's balance correct?
- Are there discrepancies that need investigation?

---

## Relevé Extraction (Edge Function)

### Where
- `supabase/functions/vision-ai-extract/index.ts` — add Relevé extraction branch alongside Facture and BL

### Relevé Output JSON Schema
```typescript
interface ReleveExtractionResponse {
  success: true;
  doc_type: "releve";
  releve: ReleveHeader;
  releve_lines: ReleveLine[];
  document_quality: DocumentQuality;
  insights: Insight[];
  needs_human_review: true; // ALWAYS true
  warnings: string[];
}

interface ReleveHeader {
  supplier_name: string | null;
  supplier_account_ref: string | null; // "N° client" or "Réf. compte"
  period_start: string | null;          // YYYY-MM-DD
  period_end: string | null;            // YYYY-MM-DD
  previous_balance: number | null;      // Solde précédent
  total_invoiced: number | null;        // Total facturé sur la période
  total_credits: number | null;         // Total avoirs
  total_payments: number | null;        // Total règlements
  balance_due: number | null;           // Solde dû (total)
  issue_date: string | null;            // Date d'émission du relevé
}

interface ReleveLine {
  line_type: "invoice" | "credit_note" | "payment" | "other";
  reference: string | null;             // Invoice number, avoir number, etc.
  date: string | null;                  // YYYY-MM-DD
  description: string | null;           // Raw label from the document
  amount_ht: number | null;             // Montant HT
  amount_ttc: number | null;            // Montant TTC (most commonly used)
  amount_tva: number | null;            // TVA amount if separate
  due_date: string | null;              // Échéance
  is_credit: boolean;                   // true for avoirs/credit notes
  field_confidence: {
    reference: number;   // 0.0 - 1.0
    amount_ttc: number;  // 0.0 - 1.0
    date: number;        // 0.0 - 1.0
  };
}
```

### AI Prompt Rules for Relevé
- Extract EVERY line in the relevé — invoices, credit notes (avoirs), payments
- Tag each line with `line_type`
- If an amount could be HT or TTC and you're unsure, prefer TTC and note it
- Credit notes / avoirs MUST have `is_credit: true` and `amount_ttc` as positive (sign is handled via `is_credit` flag)
- NEVER skip a line because it looks like a subtotal — include it, the human will review
- If dates are in DD/MM/YYYY format, convert to YYYY-MM-DD
- If a balance is stated, extract it to `balance_due`

---

## Reconciliation Logic (Frontend — NOT in edge function)

### Where
NEW: `src/modules/visionAI/services/releveReconciliationService.ts`

### How It Works
After extraction + sanitization, the reconciliation service:

1. **Identify the supplier**: Match `releve.supplier_name` against known suppliers in the establishment
2. **Determine the period**: Use `period_start` / `period_end` from the relevé (or infer from line dates)
3. **Fetch our invoices**: Query `invoices` table for this supplier + period
4. **Cross-reference each Relevé line** against our invoices:

```typescript
interface ReconciliationResult {
  supplier_id: string | null;
  supplier_name: string;
  period: { start: string; end: string };
  
  // Per-line matching
  matched_lines: MatchedLine[];     // Found in both relevé AND our DB
  missing_from_db: ReleveLine[];    // In relevé but NOT in our DB → ALERT
  missing_from_releve: Invoice[];   // In our DB but NOT in relevé → WARNING
  
  // Summary
  total_releve: number;             // Sum of relevé amounts
  total_db: number;                 // Sum of our invoice amounts for same period
  balance_difference: number;       // Discrepancy
  
  // Flags
  alerts: ReconciliationAlert[];
}

interface MatchedLine {
  releve_line: ReleveLine;
  db_invoice: Invoice;
  status: "exact_match" | "amount_mismatch" | "date_mismatch" | "partial_match";
  amount_difference: number | null;  // null if exact match
  notes: string | null;
}

interface ReconciliationAlert {
  severity: "critical" | "warning" | "info";
  type: 
    | "invoice_not_in_db"           // Supplier says we owe for invoice X, but we don't have it
    | "amount_mismatch"             // We have the invoice but amounts differ
    | "invoice_not_in_releve"       // We have an invoice the supplier didn't list
    | "balance_discrepancy"         // Total doesn't add up
    | "credit_note_unmatched"       // Avoir without matching invoice
    | "duplicate_reference"         // Same invoice number appears twice in relevé
    | "supplier_not_found"          // Could not match supplier
    | "period_gap";                 // Missing invoices may be in a gap period
  message: string;
  releve_line?: ReleveLine;
  db_invoice?: Invoice;
}
```

### Matching Logic (fuzzy)
Invoice matching between Relevé line and DB invoice:
1. **Exact match**: `reference` matches `invoice_number` AND `amount_ttc` matches `amount_eur` (±0.01€)
2. **Amount mismatch**: `reference` matches `invoice_number` BUT amounts differ → alert
3. **Date mismatch**: Match on number + amount but dates differ → warning
4. **Partial match**: Only `reference` matches (fuzzy: ignore leading zeros, normalize separators)
5. **Not found**: No match at all → `missing_from_db` alert

### Reconciliation is READ-ONLY
- The reconciliation NEVER modifies the `invoices` table
- It NEVER creates new invoices automatically
- It produces a **report** that the human reviews
- The human decides what action to take (mark as paid, investigate, etc.)

---

## Files to create/modify
- `supabase/functions/vision-ai-extract/index.ts` — add Relevé extraction branch
- NEW: `supabase/functions/vision-ai-extract/_shared/relevePrompt.ts` — Relevé-specific prompt
- NEW: `src/modules/visionAI/services/releveReconciliationService.ts` — cross-reference logic
- NEW: `src/modules/visionAI/types/releveTypes.ts` — all Relevé types
- Reuse: `src/modules/factures/services/invoiceService.ts` → `getInvoicesForSupplierMonth()` for fetching existing invoices

## Tests
- [ ] Relevé extraction returns valid `ReleveExtractionResponse`
- [ ] All line types parsed: invoice, credit_note, payment, other
- [ ] Reconciliation: exact match found → status "exact_match"
- [ ] Reconciliation: amount mismatch detected → alert
- [ ] Reconciliation: invoice in relevé but not in DB → critical alert
- [ ] Reconciliation: invoice in DB but not in relevé → warning
- [ ] Reconciliation: balance discrepancy computed correctly
- [ ] Reconciliation: credit notes handled (positive amount + is_credit flag)
- [ ] Reconciliation: fuzzy matching on invoice numbers (ignore leading zeros, separators)
- [ ] Reconciliation is read-only (no DB writes to `invoices`)

## Definition of Done
- [ ] Relevé extraction end-to-end via edge function
- [ ] Reconciliation service with full matching logic
- [ ] Alert system with 8 alert types
- [ ] Zero impact on Facture and BL flows
- [ ] All types exported via barrel
