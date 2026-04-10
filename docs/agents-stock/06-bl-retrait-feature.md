# Agent 06: BLRetraitFeature

## Mission
After a successful withdrawal POST, show a popup to generate a "BL Retrait" document. Store it in a new table and display it as a sub-tab in Factures alongside "BL-APP".

## Current State
- Withdrawal POST creates a `stock_document` (type: WITHDRAWAL) + `stock_events`
- No BL document is generated
- `src/modules/factures/pages/FacturesPage.tsx` has tabs: "Factures" | "BL-APP"

## Feature 1: Post-Withdrawal Popup

After a successful withdrawal POST (in `MobileWithdrawalView.tsx` or desktop equivalent), show:

```
┌──────────────────────────────────────────────┐
│ ✅ Retrait enregistré                         │
│                                               │
│ Générer un BL Retrait ?                       │
│                                               │
│ N° BL Retrait: BL-R-00042 (auto)             │
│                                               │
│ Établissement destinataire:                   │
│ [▼ Sélectionner...]                          │
│   ○ Magnifiko                                │
│   ○ Piccolo Magnifiko                        │
│                                               │
│ [Annuler]                    [Valider]        │
└──────────────────────────────────────────────┘
```

### Fields
- **BL number**: Auto-generated `BL-R-XXXXX` (5 digits, sequential per establishment)
- **Destination establishment**: Dropdown of all establishments in the organization (exclude current)
- **Annuler**: Skip BL generation (just close popup)
- **Valider**: Create BL Retrait document

## Feature 2: Database

### New Table: `bl_retraits`
```sql
CREATE TABLE public.bl_retraits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stock_document_id UUID NOT NULL REFERENCES public.stock_documents(id),
  bl_number TEXT NOT NULL, -- "BL-R-00042"
  destination_establishment_id UUID REFERENCES public.establishments(id),
  destination_name TEXT, -- Snapshot of destination name
  total_amount NUMERIC(12, 2), -- Total prix computed at generation
  status TEXT NOT NULL DEFAULT 'FINAL', -- FINAL (immutable once created)
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lines
CREATE TABLE public.bl_retrait_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bl_retrait_id UUID NOT NULL REFERENCES public.bl_retraits(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id),
  product_name_snapshot TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit_label TEXT, -- "kg", "pce", etc.
  unit_price NUMERIC(12, 4), -- Reference price at time of generation
  line_total NUMERIC(12, 2), -- quantity × unit_price
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.bl_retraits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bl_retrait_lines ENABLE ROW LEVEL SECURITY;

-- Sequence for BL numbers
CREATE SEQUENCE IF NOT EXISTS bl_retrait_seq START 1;

-- Index
CREATE INDEX idx_bl_retraits_establishment ON public.bl_retraits(establishment_id);
CREATE INDEX idx_bl_retraits_date ON public.bl_retraits(created_at DESC);
```

### Price Logic
- `unit_price`: Use the product's `final_unit_price` from `products_v2` (same logic as BL APP)
- `line_total`: `quantity × unit_price`
- `total_amount`: Sum of all `line_total`
- Prices are **frozen at generation time** (snapshot, not live)

## Feature 3: Factures Tab

### Add "BL Retraits" Tab
In `src/modules/factures/pages/FacturesPage.tsx`:
```
Tabs: [Factures] [BL-APP] [BL Retraits]
```

### BL Retraits List
```
┌──────────────────────────────────────────────────────────┐
│ BL Retraits (12)                           [Mois ◄ ►]   │
├──────────────────────────────────────────────────────────┤
│ BL-R-00042 │ → Piccolo Magnifiko │ 17/02/2026 │ 234.50€ │
│ BL-R-00041 │ → Magnifiko         │ 15/02/2026 │ 189.20€ │
│ BL-R-00040 │ → Piccolo Magnifiko │ 12/02/2026 │ 412.00€ │
└──────────────────────────────────────────────────────────┘
```

### BL Retrait Detail (click to expand)
```
BL-R-00042 — 17/02/2026
Destination: Piccolo Magnifiko

┌──────────────────────────────────────────────────┐
│ Produit          │ Quantité │ Prix unit. │ Total  │
├──────────────────┼──────────┼────────────┼────────┤
│ Grana Padano     │ 2 kg     │ 11.70€/kg  │ 23.40€ │
│ Saumon fumé      │ 0.5 kg   │ 42.00€/kg  │ 21.00€ │
│ Basilic frais    │ 3 bte    │ 2.50€/bte  │  7.50€ │
├──────────────────┼──────────┼────────────┼────────┤
│                  │          │ TOTAL      │ 51.90€ │
└──────────────────┴──────────┴────────────┴────────┘
```

## Coherence Rules (CRITICAL)
- The withdrawal remains a `WITHDRAWAL` document in the stock ledger — **no change to SSOT**
- The BL Retrait is a **reporting document** linked to the withdrawal via `stock_document_id`
- It does NOT create stock events — the withdrawal already did that
- Prices are **frozen snapshots** — not live-computed
- If withdrawal is voided, BL Retrait stays (archived, not deleted)

## Files to create/modify
- NEW: `supabase/migrations/YYYYMMDD_bl_retraits.sql`
- NEW: `src/modules/stockLedger/types/blRetrait.ts`
- NEW: `src/modules/stockLedger/hooks/useBlRetraits.ts`
- NEW: `src/modules/stockLedger/hooks/useCreateBlRetrait.ts`
- NEW: `src/modules/stockLedger/components/BlRetraitPostPopup.tsx`
- NEW: `src/modules/stockLedger/components/BlRetraitTab.tsx`
- NEW: `src/modules/stockLedger/components/BlRetraitDetail.tsx`
- MODIFY: `src/modules/stockLedger/components/MobileWithdrawalView.tsx` — show popup after POST
- MODIFY: `src/modules/factures/pages/FacturesPage.tsx` — add "BL Retraits" tab
- MODIFY: `src/modules/stockLedger/index.ts` — export new components

## Tests
- [ ] BL Retrait popup shows after successful withdrawal
- [ ] BL number auto-increments correctly
- [ ] Destination establishment dropdown excludes current
- [ ] BL Retrait created with correct lines and prices
- [ ] Total computed correctly
- [ ] BL Retraits tab shows in Factures
- [ ] Detail view shows all lines with prices
- [ ] No stock events created by BL Retrait (reporting only)

## Definition of Done
- [ ] Post-withdrawal popup functional
- [ ] BL Retrait stored in DB with frozen prices
- [ ] Tab in Factures with list + detail
- [ ] Zero impact on stock ledger SSOT
