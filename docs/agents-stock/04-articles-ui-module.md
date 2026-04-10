# Agent 04: ArticlesUIModule

## Mission
Create the "Articles inventaire" UI: list page, detail view, merge/detach actions, and product fiche section. Add it to the nav under Inventaire.

## UI 1: Articles Inventaire List Page

### Navigation
Add to `src/config/navRegistry.ts` under Inventaire:
```
Inventaire
 └── Articles inventaire  (/inventaire/articles)
```

### List View
```
┌──────────────────────────────────────────────────────────┐
│ 📦 Articles inventaire (147)         [Rechercher...]     │
├──────────────────────────────────────────────────────────┤
│ Article          │ Zone           │ Stock    │ Fournisseurs │
├──────────────────┼────────────────┼──────────┼──────────────┤
│ Grana Padano     │ Chambre froide │ 12.5 kg  │ 2            │
│ Saumon fumé      │ Chambre froide │ 3 pce    │ 1            │
│ Huile d'olive    │ Réserve sèche  │ 8.2 L    │ 3            │
└──────────────────┴────────────────┴──────────┴──────────────┘
```

- Stock computed from `stock_events` aggregated by `inventory_article_id`
- "Fournisseurs" = count of `products_v2` linked to this article
- Click row → Article detail

### Filters
- Search by name (tolerant: accents, case, spaces)
- Filter by zone (dropdown)

## UI 2: Article Detail View

```
┌──────────────────────────────────────────────────────────┐
│ ← Retour    📦 Grana Padano râpé                         │
│                                                          │
│ Zone: Chambre froide 1                                   │
│ Unité inventaire: kg                                     │
│ Stock estimé: 12.5 kg                                    │
│ Seuil min: 5 kg                                          │
│                                                          │
│ ── Produits fournisseur liés (2) ────────────────────    │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Grana Cincotti (04-0232)   Prix: 11.70€/kg         │   │
│ │ Fournisseur: Cincotti      [Voir fiche] [Détacher] │   │
│ ├────────────────────────────────────────────────────┤   │
│ │ Grana Sapori (SAP-112)     Prix: 12.30€/kg         │   │
│ │ Fournisseur: Sapori        [Voir fiche] [Détacher] │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ [+ Ajouter produit fournisseur]                          │
└──────────────────────────────────────────────────────────┘
```

### Actions
- **Détacher**: Remove `inventory_article_id` from product → confirmation modal with warning
- **Ajouter**: Search products_v2 without article → link them
- **Fusionner**: Merge two articles (move all product links to target article)

## UI 3: Product Fiche Section (in ProductLineDrawer)

Add below existing sections in `src/modules/visionAI/components/ProductLineDrawer.tsx`:

```
📦 Article inventaire lié
┌────────────────────────────────────────────────┐
│ Grana Padano râpé                              │
│ Zone: Chambre froide 1 · Stock: 12 kg         │
│ [Voir article]   [Changer]                     │
└────────────────────────────────────────────────┘
```

If no article linked:
```
📦 Article inventaire
Aucun article lié
[Associer à article existant]  [Créer nouvel article]
```

Badge on products page: if `inventory_article_id === null`:
```
⚠️ À associer à un article inventaire
```

## Files to create/modify
- NEW: `src/modules/inventaire/pages/InventoryArticlesPage.tsx`
- NEW: `src/modules/inventaire/components/ArticleDetailView.tsx`
- NEW: `src/modules/inventaire/components/ArticleListView.tsx`
- NEW: `src/modules/inventaire/hooks/useInventoryArticles.ts`
- NEW: `src/modules/inventaire/hooks/useArticleStock.ts`
- MODIFY: `src/config/navRegistry.ts` — add "Articles inventaire" under Inventaire
- MODIFY: `src/routes/AppRoutes.tsx` — add route for articles page
- MODIFY: `src/modules/visionAI/components/ProductLineDrawer.tsx` — add article section
- MODIFY: `src/modules/inventaire/index.ts` — export new components

## Tests
- [ ] Article list loads with correct counts
- [ ] Search filters by name (tolerant matching)
- [ ] Zone filter works
- [ ] Article detail shows linked products
- [ ] Détacher removes link (with confirmation)
- [ ] Ajouter links unlinked product to article
- [ ] Product fiche shows article info or "À associer" badge

## Definition of Done
- [ ] Full CRUD UI for inventory articles
- [ ] Navigation entry under Inventaire
- [ ] Product fiche integration
- [ ] "À associer" badge for unlinked products
- [ ] All actions with confirmation dialogs
