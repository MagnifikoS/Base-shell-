# Agent: FrontendBLFlow

## Mission
Add BL flow to the UI with minimal changes, preserving the existing Facture modal flow exactly as-is.

## Critical: Existing blApp Module
The `src/modules/blApp/` module already exists with:
- `BlAppDocument` type (DRAFT/FINAL status, supplier, bl_number, bl_date)
- `BlAppLine` type (product name, quantity, unit)
- `useCreateBlApp` hook, `useCompleteBlApp` hook
- `BlAppTab` component, `BlAppPostPopup` component

**The BL extraction flow MUST produce a blApp DRAFT document** as its output. Do NOT create a parallel persistence system.

## Architecture: BL Flow

```
User uploads photo/PDF
  ↓
useExtractDocument.ts (NEW hook)
  ↓ (calls vision-ai-extract with document_mode="bl")
  ↓
BLExtractionResponse received
  ↓
visionBlGuardrails.ts adds flags
  ↓
BLReviewModal opens (human-in-the-loop)
  ↓ (user reviews/edits lines, confirms)
  ↓
useCreateBlApp → creates DRAFT BlAppDocument + BlAppLines
  ↓
User can then finalize via existing blApp flow
```

## New Hook: `src/modules/visionAI/hooks/useExtractDocument.ts`
- Reuse patterns from `useExtractProducts.ts`:
  - `requestIdRef` for latest-only guard
  - `AbortController` with 60s timeout
  - `hardReset()` function for SAS cleanup
  - `isExtractingRef` for concurrent prevention
- Must NOT break `useExtractProducts.ts` — it stays unchanged for Facture
- Accepts `document_mode: "auto" | "facture" | "bl"` parameter

## New Component: `src/modules/visionAI/components/BLReviewModal.tsx`
- Shows extracted BL header (supplier, BL number, date)
- Shows line-by-line review table:
  - Product name (editable)
  - Quantity delivered (editable)
  - Unit (editable)
  - Confidence indicators (color-coded)
  - Unreadable flags (highlighted in orange/red)
  - Notes (expandable)
- "Valider" button → creates blApp DRAFT
- "Annuler" button → discards extraction (SAS reset)

## UI Integration
Extend `src/pages/VisionAI.tsx` with a document type selector (3 options):
- 📄 **Facture** (existing, default)
- 📦 **Bon de Livraison** (BL)
- 📊 **Relevé Fournisseur** (handled by Agent 09 — not this agent's scope)

Option A: Toggle at upload time — user selects document type before uploading.
Option B: Auto-detect (`document_mode="auto"`) then show appropriate review flow.
The existing Facture 3-modal flow (supplier → products → save) must remain untouched.

## Human-in-the-loop (MANDATORY)
- For BL: ALWAYS open `BLReviewModal` after extraction
- No automatic saving to inventory/stock
- Approval creates a DRAFT `BlAppDocument` via `useCreateBlApp`
- User finalizes via existing `BlAppTab` / `BlAppPostPopup`

## Files to create
- NEW: `src/modules/visionAI/hooks/useExtractDocument.ts`
- NEW: `src/modules/visionAI/components/BLReviewModal.tsx`
- MODIFY: `src/pages/VisionAI.tsx` — add document type selector
- MODIFY: `src/pages/useVisionAIState.ts` — add BL state management (separate from Facture state)

## Files NOT to modify
- `src/modules/visionAI/hooks/useExtractProducts.ts` — MUST remain unchanged
- `src/modules/analyseFacture/*` — MUST remain unchanged
- `src/modules/blApp/*` — use as-is, do NOT modify

## Tests
- [ ] BL extraction hook discards stale requests (latest-only guard)
- [ ] BL extraction hook aborts after 60s timeout
- [ ] BLReviewModal renders all line items with confidence indicators
- [ ] "Valider" creates a DRAFT blApp document
- [ ] "Annuler" resets extraction state (SAS cleanup)
- [ ] Facture flow completely unchanged when BL features are added
- [ ] Document type selector defaults to current behavior (Facture)

## Definition of Done
- [ ] BL extraction works end-to-end (upload → extract → review → DRAFT blApp)
- [ ] Facture flow unchanged
- [ ] Human must explicitly approve BL extraction
- [ ] BL data persisted as blApp DRAFT document
- [ ] No deep imports — everything through barrel exports
