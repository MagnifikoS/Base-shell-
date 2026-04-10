# Agent: ReleveFrontendFlow

## Mission
Add Relevé review and reconciliation UI flow to the Vision AI page, preserving Facture and BL flows exactly as-is.

## Architecture: Relevé Flow

```
User uploads Relevé PDF/photo
  ↓
useExtractDocument.ts (same hook as BL, with document_mode="releve")
  ↓ (calls vision-ai-extract with document_mode="releve")
  ↓
ReleveExtractionResponse received
  ↓
visionReleveGuardrails.ts adds flags
  ↓
releveReconciliationService.ts runs cross-reference against invoices DB
  ↓
ReleveReconciliationModal opens (human-in-the-loop)
  ↓ (user reviews matched/unmatched lines, investigates alerts)
  ↓
User validates → reconciliation report persisted to scan history
```

## Key Principle: Verification Only
The Relevé flow is a **verification tool**, NOT a creation tool:
- It does NOT create new invoices
- It does NOT mark invoices as paid
- It does NOT modify any existing data
- It produces a **reconciliation report** the owner reviews
- The owner then decides what manual actions to take

---

## New Components

### `src/modules/visionAI/components/ReleveReconciliationModal.tsx`
Main modal with 3 sections:

#### Section 1: Relevé Header Summary
- Supplier name (with match indicator if found in DB)
- Period (start → end)
- Previous balance / Total invoiced / Total credits / Balance due
- Document quality indicator

#### Section 2: Reconciliation Table
| Relevé Line | Our Invoice | Status | Action |
|---|---|---|---|
| FA-001 — 150.00€ — 15/01 | ✅ FA-001 — 150.00€ — 15/01 | ✅ Exact match | — |
| FA-002 — 230.00€ — 20/01 | ⚠️ FA-002 — 225.00€ — 20/01 | ⚠️ Amount mismatch (5.00€) | Investigate |
| FA-003 — 90.00€ — 25/01 | ❌ Not found | 🚨 Missing from DB | À vérifier |
| — | FA-004 — 180.00€ — 28/01 | ℹ️ Not in relevé | — |

Color coding:
- 🟢 Green: exact match — all good
- 🟡 Yellow: minor discrepancy (date mismatch, small amount diff)
- 🔴 Red: critical alert (missing invoice, large amount mismatch)
- 🔵 Blue: info (invoice in DB but not in relevé)

#### Section 3: Summary & Alerts
- Total from Relevé vs Total from our DB
- Balance difference (highlighted if ≠ 0)
- List of all alerts sorted by severity
- For each alert: severity badge + message + affected line

### Bottom Actions
- **"Valider le rapprochement"** — marks reconciliation as reviewed, persists report to scan history
- **"Exporter le rapport"** — download reconciliation as CSV/PDF (Phase 2, optional)
- **"Annuler"** — discards everything (SAS cleanup)

---

## Hook: `src/modules/visionAI/hooks/useReleveReconciliation.ts` (NEW)

```typescript
interface UseReleveReconciliationReturn {
  // State
  reconciliation: ReconciliationResult | null;
  isReconciling: boolean;
  error: string | null;
  
  // Actions
  reconcile: (extraction: ReleveExtractionResponse, establishmentId: string) => Promise<void>;
  reset: () => void;
}
```

This hook:
1. Takes the extraction response
2. Identifies the supplier (fuzzy match on name)
3. Fetches invoices from the `invoices` table for that supplier + period
4. Runs the reconciliation service
5. Returns the result for the modal to display

---

## UI Integration

### Document Type Selector
In `src/pages/VisionAI.tsx`, the document type selector now has 3 options:
- 📄 Facture (existing)
- 📦 Bon de Livraison (BL)
- 📊 Relevé Fournisseur (new)

### Flow Routing in `useVisionAIState.ts`
After extraction, route based on `doc_type`:
- `"facture"` → existing 3-modal flow (supplier → products → save)
- `"bl"` → BLReviewModal → blApp DRAFT
- `"releve"` → ReleveReconciliationModal → persist report

---

## Files to create
- NEW: `src/modules/visionAI/components/ReleveReconciliationModal.tsx`
- NEW: `src/modules/visionAI/hooks/useReleveReconciliation.ts`
- MODIFY: `src/pages/VisionAI.tsx` — add "Relevé" option to document type selector
- MODIFY: `src/pages/useVisionAIState.ts` — add Relevé state management

## Files NOT to modify
- `src/modules/visionAI/hooks/useExtractProducts.ts` — MUST remain unchanged
- `src/modules/analyseFacture/*` — MUST remain unchanged
- `src/modules/factures/*` — use read-only queries only, do NOT modify
- `src/modules/blApp/*` — not involved in Relevé flow

## Tests
- [ ] Reconciliation modal renders all matched/unmatched lines
- [ ] Color coding correct for each status type
- [ ] Alerts sorted by severity (critical → warning → info)
- [ ] "Valider" persists reconciliation report to scan history
- [ ] "Annuler" resets all state (SAS cleanup)
- [ ] Supplier fuzzy matching works (e.g., "METRO" matches "Metro Cash & Carry")
- [ ] Period inference from line dates when header period is null
- [ ] Facture and BL flows completely unchanged

## Definition of Done
- [ ] Relevé reconciliation modal with 3 sections (header, table, alerts)
- [ ] Color-coded status indicators
- [ ] Alert system displayed with severity badges
- [ ] Human must explicitly validate reconciliation
- [ ] Report persisted to scan history
- [ ] No deep imports — barrel exports only
- [ ] No modifications to invoices table (read-only reconciliation)
