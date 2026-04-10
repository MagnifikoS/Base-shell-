# Agent 03: WizardArticleStep

## Mission
Add an "Article inventaire" step to the Product V3 Wizard (after Zone de stockage) that allows linking a supplier product to an existing inventory article OR creating a new one.

## Context
The V3 Wizard currently has steps: Identity → Packaging → Pricing → Management → Stock/Zone. After zone selection, add a step to link to an inventory article.

## Current Wizard Files
- `src/modules/visionAI/components/ProductFormV3/WizardStep1.tsx` — Identity
- `src/modules/visionAI/components/ProductFormV3/WizardStep2.tsx` — Packaging
- `src/modules/visionAI/components/ProductFormV3/WizardStep3.tsx` — Pricing
- `src/modules/visionAI/components/ProductFormV3/WizardStep4.tsx` — Management (units)
- `src/modules/visionAI/components/ProductFormV3/WizardStep5.tsx` — Min stock
- `src/modules/visionAI/components/ProductFormV3/WizardStep5Stock.tsx` — Stock/Zone
- `src/modules/visionAI/components/ProductFormV3/useWizardState.ts` — State management
- `src/modules/visionAI/components/ProductFormV3/ProductFormV3Modal.tsx` — Modal wrapper

## New Step: WizardStep6Article.tsx

### UI Design
After zone selection, show:

```
📦 Article inventaire

○ Créer un nouvel article inventaire (default for new products)
○ Associer à un article existant

[If "Associer" selected:]
🔎 Articles similaires détectés :
┌─────────────────────────────────────────┐
│ Grana Padano râpé                       │
│ Zone: Chambre froide 1 · Stock: 12 kg  │
│                            [Associer]   │
├─────────────────────────────────────────┤
│ Parmesan Reggiano                       │
│ Zone: Chambre froide 1 · Stock: 8 kg   │
│                            [Associer]   │
└─────────────────────────────────────────┘

[Rechercher un article...]
```

### Matching Logic (fuzzy)
When the user enters this step, automatically search for similar articles:
1. Normalize product name (lowercase, trim, remove accents)
2. Score against existing `inventory_articles.name_normalized` in same establishment
3. Filter: same `canonical_family` (mass/volume/unit) — **mandatory**
4. Filter: same `storage_zone_id` — **recommended** (boost score)
5. Show articles with score ≥ 0.7
6. **Never suggest if canonical family differs** (kg product can't share stock with "pièce" product)

### State Changes in `useWizardState.ts`
```typescript
// New state fields
inventoryArticleId: string | null;       // Selected existing article ID
inventoryArticleMode: "create" | "link"; // User's choice
```

### On Save
- If `mode === "create"`: Create new `inventory_article` with product's name/zone/unit, then set `products_v2.inventory_article_id`
- If `mode === "link"`: Set `products_v2.inventory_article_id` to selected article

## Files to create/modify
- NEW: `src/modules/visionAI/components/ProductFormV3/WizardStep6Article.tsx`
- MODIFY: `src/modules/visionAI/components/ProductFormV3/useWizardState.ts` — add article state
- MODIFY: `src/modules/visionAI/components/ProductFormV3/ProductFormV3Modal.tsx` — add step 6
- NEW: `src/modules/inventaire/hooks/useInventoryArticles.ts` — fetch/create articles
- NEW: `src/modules/inventaire/hooks/useArticleMatching.ts` — fuzzy matching logic

## Tests
- [ ] Default is "Créer un nouvel article" for new products
- [ ] Fuzzy matching shows similar articles (score ≥ 0.7)
- [ ] Never shows articles with different canonical family
- [ ] "Associer" correctly links product to article
- [ ] "Créer" creates a new article and links it
- [ ] Existing products (edit mode) show current article link

## Definition of Done
- [ ] New wizard step integrated and functional
- [ ] Fuzzy matching with canonical family guard
- [ ] Article created/linked on product save
- [ ] Barrel exports for new hooks
