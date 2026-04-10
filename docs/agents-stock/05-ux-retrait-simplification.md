# Agent 05: UXRetraitSimplification

## Mission
Simplify the withdrawal (retrait) flow by removing the category step entirely. New flow: Zone → Product list (alphabetical, searchable) → Quantity modal → Validate.

## Current Flow (3 screens)
```
Screen 1: Zone grid
Screen 2: Reason toggle + Category icon grid
Screen 3: Product list for selected category
```

## Target Flow (2 screens)
```
Screen 1: Zone grid (unchanged)
Screen 2: Reason + ALL products from zone (alphabetical, searchable)
```

## File to modify
`src/modules/stockLedger/components/MobileWithdrawalView.tsx` (853 lines)

## Changes

### Remove Category Step
- Remove `selectedCategory` state
- Remove category grid UI (Screen 2 category icons)
- Remove `getCategoryIcon` function
- Remove category filtering in product list

### New Screen 2: Products (replaces Screen 2 + 3)
After zone selection + reason toggle:
```
┌──────────────────────────────────────────────┐
│ ← Chambre froide 1    Motif: Production  ▼   │
│                                               │
│ [🔍 Rechercher un produit...]                │
│                                               │
│ ── A ──────────────────────────────────────   │
│ Ail frais                          [+]        │
│ Anchois marinés                    [+]        │
│ Avocat                             [+]        │
│                                               │
│ ── B ──────────────────────────────────────   │
│ Basilic frais                      [+]        │
│ Beurre doux                        [2 kg ✓]  │
│ ...                                           │
│                                               │
│ ══════════════════════════════════════════     │
│ [🛒 Panier (3 produits)]     [Valider →]     │
└──────────────────────────────────────────────┘
```

### Product List Requirements
1. **All products** from the selected zone, sorted alphabetically
2. **Search bar** at top — tolerant matching (accents/spaces/case ignored, already exists as `fuzzySearch`)
3. **Tap product** → same quantity modal as before (multi-unit, guards)
4. Products already in cart → show quantity badge (e.g., "2 kg ✓")
5. Optional: **alphabetical section headers** (A, B, C...) for easy scrolling
6. **Reason toggle** moved to top of screen (compact bar, not a separate screen)

### Reason Toggle (compact)
Instead of a full screen for reason selection, show a compact toggle bar:
```
Motif: [Production] [Péremption] [Casse] [Autre]
```
This stays at the top of Screen 2, not a separate screen.

## Files to modify
- `src/modules/stockLedger/components/MobileWithdrawalView.tsx` — main refactor
- Remove or simplify category-related code

## What NOT to change
- Zone grid (Screen 1) — keep as-is
- Quantity modal — keep as-is
- POST logic — keep as-is
- `useWithdrawalDraft` hook — keep as-is
- `WithdrawalLineTable` — keep as-is (for desktop)
- Cart drawer — keep as-is

## Tests
- [ ] Zone selection → products list (no category step)
- [ ] All zone products shown alphabetically
- [ ] Search bar filters in real-time (tolerant matching)
- [ ] Reason toggle works (all reasons accessible)
- [ ] Tap product → quantity modal → product added to cart
- [ ] Products in cart show quantity badge
- [ ] POST flow unchanged

## Definition of Done
- [ ] Category step completely removed
- [ ] Products shown alphabetically with search
- [ ] Reason toggle inline (not separate screen)
- [ ] Same POST/validation behavior as before
- [ ] Mobile-optimized layout
