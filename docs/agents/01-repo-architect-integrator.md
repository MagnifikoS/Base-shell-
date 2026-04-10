# Agent: RepoArchitectIntegrator

## Mission
Integrate BL + Relevé support into the existing Vision AI system with minimal changes.
Do NOT rewrite. Identify exact integration points and propose a safe implementation plan.

## Context: Three Document Types
| Type | Description | Output target |
|------|-------------|---------------|
| **Facture** (existing) | Invoice from supplier | `invoices` table via existing flow |
| **BL** (new) | Bon de Livraison — delivery note | `blApp` module (DRAFT document) |
| **Relevé** (new) | Supplier statement listing all invoices for a period | Reconciliation report (cross-ref with `invoices` table) |

## Context: Existing Modules
- `src/modules/blApp/` — Manual BL documents (DRAFT/FINAL, lines, files). BL extraction MUST feed into this module.
- `src/modules/factures/` — Invoice management. Uses `invoices` table. The Relevé reconciliation MUST query this data.
- `src/modules/analyseFacture/` — In-memory invoice analysis. Relevé can reuse patterns but must NOT modify this module.

## Must respect existing principles
- SAS / Airlock: extraction state is temporary, discarded after validation/cancel
- Latest-only guard: `requestIdRef` mechanism in `useExtractProducts.ts`
- Fire-and-forget: scan history + bench capture never block the main flow
- Barrel export rule: import only through `index.ts` — no deep imports
- Existing Facture flow must remain 100% functional and unchanged
- `analyseFacture` is in-memory only — NEVER writes to DB

## Current architecture (source of truth)
| Component | File | Role |
|-----------|------|------|
| Edge function | `supabase/functions/vision-ai-extract/index.ts` | AI extraction (Gemini/Pixtral/Claude) |
| Sanitization | `supabase/functions/_shared/visionSanitize.ts` | Clean AI output, enforce types |
| Frontend hook | `src/modules/visionAI/hooks/useExtractProducts.ts` | Extraction state, abort, latest-only |
| UI orchestration | `src/pages/useVisionAIState.ts` | 3-modal flow (supplier → products → save) |
| Guardrails | `src/modules/visionAI/plugins/visionAiGuardrails.ts` | Post-extraction quality checks |
| Analysis | `src/modules/analyseFacture/*` | In-memory duplicate/price/quantity checks |
| Scan history | `src/modules/visionAI/services/scanHistoryService.ts` | Persist scan + runs |
| Scan history DB | `supabase/migrations/20260217100000_vision_ai_scan_history.sql` | Tables: `vision_ai_scans`, `vision_ai_scan_runs` |
| BL App module | `src/modules/blApp/*` | Manual BL documents (DRAFT/FINAL, lines, files) |
| Factures module | `src/modules/factures/*` | Invoice CRUD, `invoices` table, supplier grouping |
| Invoice types | `src/modules/factures/types.ts` | `Invoice` type: id, supplier_id, invoice_number, invoice_date, amount_eur |
| Types | `src/modules/visionAI/types.ts` | `ExtractionResponse`, `InvoiceData`, `ExtractedProductLine`, `Insight` |
| Types (scan) | `src/modules/visionAI/types/scanHistory.ts` | `ScanDocument`, `ScanRun` |
| File validation | `src/modules/visionAI/utils/pdfPreValidation.ts` | Size/type checks before upload |

## Deliverables
1. A minimal diff plan (file-by-file) showing exactly what changes in each file
2. A safe response envelope strategy:
   - Facture callers get unchanged `ExtractionResponse`
   - BL callers get a new `BLExtractionResponse` with `doc_type: "bl"`
   - Relevé callers get a new `ReleveExtractionResponse` with `doc_type: "releve"` + reconciliation report
   - All share the same edge function endpoint
3. Integration plan: Vision AI BL extraction → blApp DRAFT document
4. Integration plan: Vision AI Relevé extraction → reconciliation against `invoices` table
5. Migration plan for scan history to support `doc_type` column

## Definition of Done
- [ ] Diff plan reviewed and approved
- [ ] No existing test broken
- [ ] Backward compatibility verified for all Facture API consumers
