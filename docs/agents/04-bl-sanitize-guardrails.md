# Agent: BLSanitizationGuardrails

## Mission
Extend sanitization and guardrails for BL and Relevé without impacting Facture behavior. Each doc type has DIFFERENT rules.

## Key Differences: BL vs Facture vs Relevé
| Rule | Facture | BL | Relevé |
|------|---------|-----|--------|
| Lines without price | Removed | **Kept** (BL has no prices) | **Kept** (may list amounts or not) |
| Lines without quantity | Flagged | **Kept with null** (mark unreadable) | N/A (no quantities) |
| Anti-fee filter | Applied | **NOT applied** | **NOT applied** |
| Price variation check | Applied | **NOT applicable** | **NOT applicable** |
| Duplicate detection | By invoice number | By BL number | By relevé period + supplier |
| Cross-referencing | N/A | N/A | **YES** — match against `invoices` table |

---

## Backend: `supabase/functions/_shared/visionSanitize.ts`
Add new functions (do NOT modify existing `sanitizeInvoiceHeader`/`sanitizeProductLines`):

### BL Sanitization

#### `sanitizeBLHeader(raw: unknown): BLHeader`
- Trim and normalize strings
- Validate date format (YYYY-MM-DD or null)
- Sanitize supplier name (remove extra whitespace, normalize case)

#### `sanitizeBLItems(raw: unknown[]): BLItem[]`
- Keep ALL lines, even without qty (BL items may have no quantity)
- Sanitize numeric fields (remove non-numeric chars except `.`)
- Validate confidence scores are in [0, 1]
- Ensure `unreadable_fields` is always an array
- Normalize unit strings (lowercase, trim)
- Do NOT remove null-qty lines

### Relevé Sanitization

#### `sanitizeReleveHeader(raw: unknown): ReleveHeader`
- Trim and normalize supplier name
- Validate date range (period_start, period_end) — YYYY-MM-DD or null
- Validate balance amounts (numeric, allow negative)

#### `sanitizeReleveLines(raw: unknown[]): ReleveLine[]`
- Keep ALL lines (each represents an invoice reference)
- Validate `invoice_number` is string or null
- Validate `invoice_date` format
- Validate `amount` is numeric or null
- Normalize "avoir" (credit note) indicators
- Do NOT remove lines with missing amounts

---

## Frontend Guardrails

### BL: `src/modules/visionAI/plugins/visionBlGuardrails.ts` (NEW)
Session-only flags (never persisted):

| Flag | Condition | Severity |
|------|-----------|----------|
| `missing_quantity` | `qty_delivered === null` | warning |
| `unreadable_product` | `product_name === "UNREADABLE"` | error |
| `low_quality_photo` | `document_quality.score < 0.5` | warning |
| `handwritten_ambiguous` | `notes` contains handwriting mention + `qty_delivered === null` | info |
| `all_lines_unreadable` | Every line has `product_name === "UNREADABLE"` | blocking |

### Relevé: `src/modules/visionAI/plugins/visionReleveGuardrails.ts` (NEW)
Session-only flags (never persisted):

| Flag | Condition | Severity |
|------|-----------|----------|
| `invoice_not_found` | Relevé invoice ref not found in `invoices` table | alert |
| `amount_mismatch` | Relevé amount ≠ stored invoice `amount_eur` (tolerance ±0.01€) | alert |
| `date_mismatch` | Relevé date ≠ stored invoice `invoice_date` | warning |
| `missing_invoice` | Invoice exists in DB for supplier+period but NOT in Relevé | warning |
| `extra_invoice` | Invoice in Relevé but NOT in our DB | info |
| `balance_discrepancy` | Computed balance ≠ stated balance on Relevé | alert |
| `period_incomplete` | Relevé period doesn't cover full month | info |

---

## Files to create/modify
- `supabase/functions/_shared/visionSanitize.ts` — add BL + Relevé sanitization (DO NOT touch Facture functions)
- NEW: `src/modules/visionAI/plugins/visionBlGuardrails.ts` — BL-specific guardrails
- NEW: `src/modules/visionAI/plugins/visionReleveGuardrails.ts` — Relevé-specific guardrails
- NEW: `src/modules/visionAI/types/blTypes.ts` — BL TypeScript types
- NEW: `src/modules/visionAI/types/releveTypes.ts` — Relevé TypeScript types

## Tests
- [ ] BL sanitization: keeps items without price
- [ ] BL sanitization: keeps items with null quantity
- [ ] BL sanitization: rejects malformed numerics
- [ ] Relevé sanitization: keeps lines with missing amounts
- [ ] Relevé sanitization: validates date range format
- [ ] Relevé sanitization: handles negative amounts (credit notes / avoirs)
- [ ] BL guardrails: all 5 flags fire correctly
- [ ] Relevé guardrails: all 7 flags fire correctly
- [ ] Facture sanitization completely unchanged (run existing tests)

## Definition of Done
- [ ] BL + Relevé sanitization functions with full test coverage
- [ ] BL guardrails with 5 flags
- [ ] Relevé guardrails with 7 flags (including reconciliation flags)
- [ ] Zero changes to existing Facture sanitization/guardrails
- [ ] Types exported via barrel (`index.ts`)
