# Agent 07: QA & Integration Tests

## Mission
Ensure all 6 agents' work integrates correctly with zero regression on existing functionality.

## Test Categories

### 1. Migration Tests
- [ ] `inventory_articles` table created with correct schema
- [ ] `products_v2.inventory_article_id` column added
- [ ] 1:1 migration creates one article per product
- [ ] Products without `stock_handling_unit_id` skipped
- [ ] `stock_events.inventory_article_id` backfilled correctly

### 2. Stock Engine Tests
- [ ] 2 products linked to same article → single stock total
- [ ] Withdrawal posts `inventory_article_id` on stock events
- [ ] Receipt posts `inventory_article_id` on stock events
- [ ] Void copies `inventory_article_id` from original event
- [ ] Products without article → old behavior unchanged
- [ ] Existing stock calculations unchanged after migration

### 3. Wizard Tests
- [ ] Step 6 shows after zone selection
- [ ] Default "Créer nouvel article" for new products
- [ ] Fuzzy matching shows similar articles
- [ ] Different canonical family → never suggested
- [ ] "Associer" links product to article
- [ ] Edit mode shows current article link

### 4. Articles UI Tests
- [ ] Article list renders with correct counts
- [ ] Search filters by name
- [ ] Article detail shows linked products
- [ ] Détacher removes link (confirmation required)
- [ ] Product fiche shows article info or badge

### 5. Withdrawal UX Tests
- [ ] Zone → Products list (no category step)
- [ ] Products sorted alphabetically
- [ ] Search bar filters correctly
- [ ] Reason toggle inline
- [ ] Tap product → quantity modal → cart
- [ ] POST flow unchanged

### 6. BL Retrait Tests
- [ ] Popup shows after withdrawal POST
- [ ] BL number auto-generated
- [ ] Destination dropdown works
- [ ] Lines + prices correctly stored
- [ ] Tab shows in Factures
- [ ] Detail view renders correctly
- [ ] No stock events created by BL

### 7. Regression Tests
- [ ] All 2,539 existing tests still pass
- [ ] Inventory counting unchanged
- [ ] Stock valuation unchanged
- [ ] BL APP unchanged
- [ ] Factures unchanged
- [ ] Reception flow unchanged
- [ ] Vision AI unchanged

## Quality Gates
- [ ] `npm run lint` — 0 errors
- [ ] `npm run build` — succeeds
- [ ] `npx vitest run` — all pass
- [ ] No `as any` added
- [ ] No deep imports
- [ ] No TODOs in code
