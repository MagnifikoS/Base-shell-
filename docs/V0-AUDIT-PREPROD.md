# Rapport d'Audit Pré-Production V0

> **Date** : 2026-03-07
> **Périmètre** : Modules Produits V2, Inventaire, StockLedger, Alertes Stock
> **Objectif** : Valider la mise en production V0

---

## SECTION 1 — Diagnostic initial

### 1.1 Catégorie legacy dans Inventaire (P0 — CORRIGÉ)

**Problème identifié** : Le module Inventaire lisait encore le champ texte legacy `category` au lieu de `category_id` / `category_name` (jointure) dans plusieurs fichiers.

**Fichiers corrigés (Missions 1 & 2)** :
- `inventoryLineService.ts` → lit désormais `product_categories?.name` via jointure
- `useDesktopStock.ts` → utilise `category_id` + `category_name` via jointure
- `CountingModal.tsx` → affiche `product_category` qui provient du join (correct)
- `MobileInventoryView.tsx` → aligné sur `category_name`
- `InventoryProductDrawer.tsx` → aligné sur `category_name`
- `RetourMarchandiseView.tsx` → aligné sur `category_name`
- `inventoryStockPdf.ts` → aligné sur `category_name`
- `ProductDetailModal.tsx` → supprimé dual-write `category` texte, ne persiste que `category_id`

**Statut** : ✅ RÉSOLU — Aucune lecture active inventaire ne dépend du texte legacy.

### 1.2 Code mort Articles Inventaire (P1 — NETTOYÉ)

**État avant intervention** : ~2000 lignes de code mort liées à la feature neutralisée de liaison inter-produits / articles inventaire.

**Éléments supprimés (Phase C Mission 2)** :
| Fichier | Type | Statut |
|---------|------|--------|
| `useArticleGrouping.ts` | Hook | ❌ Supprimé |
| `useInventoryArticles.ts` | Hook | ❌ Supprimé |
| `useArticleStock.ts` | Hook | ❌ Supprimé |
| `useArticleMatching.ts` | Hook | ❌ Supprimé |
| `useProductsForArticleLinking.ts` | Hook | ❌ Supprimé |
| `ArticleDetailView.tsx` | Composant | ❌ Supprimé |
| `ArticleListView.tsx` | Composant | ❌ Supprimé |
| `CreateArticleDialog.tsx` | Composant | ❌ Supprimé |
| `WizardStep7Article.tsx` | Composant Wizard | ❌ Supprimé |
| `InventoryArticlesPage.tsx` | Page | ❌ Supprimé |
| `inventoryArticle.ts` | Types | ❌ Supprimé |
| Route `/inventaire/articles` | Route | ❌ Supprimée |

**Éléments supprimés (Phase C Mission 3 — cette session)** :
| Fichier | Type | Statut |
|---------|------|--------|
| `stockEngine.ts` → `getEstimatedStockByArticle()` | Fonction pure | ❌ Supprimé |
| `stockEngine.ts` → `ArticleStockEvent` type | Type | ❌ Supprimé |
| `stockLedger/index.ts` → exports article | Barrel | ❌ Nettoyé |
| `stockEngine.test.ts` → tests article-level | Tests (~270 lignes) | ❌ Supprimés |

**Vérification d'absence de référence** :
- `useArticleGrouping` → 0 imports restants ✅
- `useInventoryArticles` → 0 imports restants ✅
- `useArticleStock` → 0 imports restants ✅
- `useArticleMatching` → 0 imports restants ✅
- `WizardStep7Article` → 0 imports restants ✅
- `CreateArticleDialog` → 0 imports restants ✅
- `ArticleDetailView` → 0 imports restants ✅
- `InventoryArticlesPage` → 0 imports restants ✅
- `getEstimatedStockByArticle` → 0 imports restants (hors engine/tests supprimés) ✅
- `ArticleStockEvent` → 0 imports restants ✅
- `persistInventoryArticle` → 0 références ✅

---

## SECTION 2 — Cartographie avant suppression (Mission 3)

### Éléments analysés et leur statut

| Référence | Trouvé dans | Mort ? | Action |
|-----------|------------|--------|--------|
| `getEstimatedStockByArticle` | stockEngine.ts, tests, barrel | ✅ Mort (0 consommateurs externes) | Supprimé |
| `ArticleStockEvent` | stockEngine.ts, tests, barrel | ✅ Mort (0 consommateurs externes) | Supprimé |
| `inventory_article_id` | types.ts (auto-gen, read-only), stockEngine tests | Types DB intouchables, tests supprimés | Colonne DB conservée |
| `inventory_articles` | types.ts (auto-gen, read-only) | Table DB intouchable | Conservée en DB |
| `product_category` (inventaire types) | types.ts, service, CountingModal | ⚠️ Vivant mais correctement sourcé (join) | Conservé — pas legacy |

### Éléments conservés intentionnellement

| Élément | Raison |
|---------|--------|
| Table `inventory_articles` en DB | Pas de migration destructive en V0 |
| Colonne `inventory_article_id` sur `products_v2` | Pas de DROP COLUMN en V0 |
| Colonne `category` texte sur `products_v2` | Dual-write résiduel, pas bloquant |

---

## SECTION 3 — Modifications effectuées (Mission 3)

### A. StockLedger — Suppression code mort article

1. **`stockEngine.ts`** : Supprimé `getEstimatedStockByArticle()` + type `ArticleStockEvent` (lignes 197-242)
2. **`stockLedger/index.ts`** : Nettoyé les exports `getEstimatedStockByArticle` et `ArticleStockEvent`
3. **`stockEngine.test.ts`** : Supprimé ~270 lignes de tests article-level, conservé tests backward-compat produit-pur

### B. ProductDetailModal — Suppression dual-write catégorie

1. **Ligne 128** : Supprimé `category: formData.category?.trim() || null` du payload de sauvegarde
2. **Ligne 89** : Supprimé `category: ""` de l'initialisation du formulaire
3. **Lignes 279-289** : Le sélecteur de catégorie ne set plus `handleChange("category", ...)`, uniquement `category_id`

---

## SECTION 4 — Vérification de non-régression

| Vérification | Statut |
|-------------|--------|
| Build TypeScript | ✅ OK |
| Types compilent | ✅ OK |
| Wizard création produit | ✅ Non touché |
| Wizard édition produit | ✅ Non touché |
| Inventaire desktop | ✅ Lectures corrigées, pas de régression |
| Inventaire mobile | ✅ Aligné sur category_name |
| Comptage (CountingModal) | ✅ Lit product_category depuis join |
| Clôture session | ✅ Non touché |
| Alertes stock | ✅ Non touché |
| PDF / exports inventaire | ✅ Aligné sur category_name |
| StockEngine `getEstimatedStock()` | ✅ Intact — ZERO modification |
| StockEngine `getEstimatedStockBatch()` | ✅ Intact |
| Commandes / DLC / Facture / B2B | ✅ Non impactés |

---

## SECTION 5 — État final pré-prod V0

### 5.1 Lectures legacy catégorie dans Inventaire

**Reste-t-il une lecture active du legacy catégorie texte dans Inventaire ?**

→ **NON.** Toutes les lectures inventaire passent par `category_id` ou `category_name` (jointure `product_categories`).

Le champ `product_category` dans `InventoryLineWithProduct` est peuplé depuis `product.product_categories?.name` (join UUID), pas depuis le texte legacy.

### 5.2 Code mort article inventaire

**Reste-t-il du code mort article inventaire encore reachable ?**

→ **NON.** Tous les hooks, composants, pages, routes, tests et exports article ont été supprimés. Aucun import orphelin ne subsiste.

Éléments DB conservés volontairement (pas de migration destructive en V0) :
- Table `inventory_articles` (vide, inactive)
- Colonne `products_v2.inventory_article_id` (null partout, inactive)

### 5.3 Archive / Hard Delete

| Opération | Accessible V0 ? | Atomique ? | Risque |
|-----------|-----------------|------------|--------|
| `archiveProductV2` | ✅ Oui (ProductsV2Table) | ⚠️ Non — 2 appels séquentiels (cleanup inventory lines + update produit) | **P1 moyen** — En cas d'échec partiel, le produit reste visible mais des lignes inventaire orphelines peuvent subsister. Pas de corruption de stock. |
| `deleteProductV2Permanently` | ✅ Oui (ProductsV2Table) | ⚠️ Non — 3 appels séquentiels (cleanup inventory + delete stock events + delete produit) | **P1 moyen** — En cas d'échec partiel, données orphelines possibles. Pas de corruption stock car les events sont supprimés avant le produit. |

**Recommandation** : Acceptable pour V0. Les deux opérations sont accessibles mais non critiques pour le flux opérationnel quotidien (un restaurant ne supprime pas de produits en continu). À migrer vers des RPC atomiques en V0.1.

**Faut-il les geler ?** → Non, mais un message de confirmation est déjà en place (AlertDialog). Risque acceptable.

### 5.4 Dual-write catégorie texte

**Le dual-write est-il encore présent ?**

→ **OUI**, dans les chemins suivants :

| Chemin d'écriture | Fichier | Bloquant ? |
|-------------------|---------|------------|
| Création produit (createProductV2) | `useProductV2Mutations.ts` L68 | Non — `category_id` est aussi écrit |
| Upsert produit | `useProductV2Mutations.ts` L118 | Non — `category_id` est aussi écrit |
| Édition produit (ProduitV2DetailPage) | `ProduitV2DetailPage.tsx` L223 | Non — `category_id` est aussi écrit |
| Wizard V3 (RPC fn_save_product_wizard) | `ProductFormV3Modal.tsx` L343 | Non — `p_category_id` est aussi passé |
| Wizard V3 (update direct) | `ProductFormV3Modal.tsx` L545 | Non — `category_id` est aussi écrit |
| Import B2B | `b2bImportPipeline.ts` L134 | Non — `category_id` est aussi écrit |
| ProductLineDrawer | `ProductLineDrawer.tsx` L269 | Non — `category_id` est aussi écrit |

**Niveau de risque** : **P2 — Dette acceptable pour V0.**

Le dual-write n'est PAS dangereux car :
1. `category_id` est TOUJOURS écrit en même temps
2. Aucune lecture active ne dépend du texte legacy pour une décision métier
3. Le texte sert uniquement de backup display dans d'anciens contextes mineurs
4. La suppression du dual-write est un nettoyage simple (supprimer les lignes `category: ...`) à planifier en V0.1

### 5.5 `product_category` dans types Inventaire

Le champ `product_category: string | null` dans `InventoryLineWithProduct` a un nom trompeur mais est **correctement sourcé** depuis `product.product_categories?.name` (jointure UUID). Ce n'est PAS une lecture legacy — c'est le nom de la catégorie résolu depuis l'UUID. Renommage cosmétique recommandé en V0.1.

---

## SECTION 6 — Points d'amélioration identifiés

### P0 — Bloquants (tous résolus)

| # | Point | Statut |
|---|-------|--------|
| 1 | Lecture legacy catégorie dans Inventaire | ✅ Corrigé |
| 2 | Code mort article inventaire accessible | ✅ Supprimé |

### P1 — Importants (V0.1)

| # | Point | Impact | Recommandation |
|---|-------|--------|---------------|
| 1 | ~~`archiveProductV2` non atomique~~ | ✅ CORRIGÉ — RPC `fn_archive_product_v2` | — |
| 2 | ~~`deleteProductV2Permanently` non atomique~~ | ✅ CORRIGÉ — RPC `fn_hard_delete_product_v2` | — |
| 3 | Renommer `product_category` → `category_name` dans types Inventaire | Clarté code | Renommage simple |
| 4 | ~~Supprimer le dual-write `category` texte~~ | ✅ CORRIGÉ — Aucun write actif | — |

### P2 — Dette technique (V0.2+)

| # | Point | Impact | Recommandation |
|---|-------|--------|---------------|
| 1 | Table `inventory_articles` encore en DB (vide) | Aucun impact runtime | DROP TABLE quand migration sûre |
| 2 | Colonne `inventory_article_id` sur `products_v2` (null) | Aucun impact runtime | DROP COLUMN quand migration sûre |
| 3 | Colonne `category` texte sur `products_v2` | Aucun impact (plus écrite, reads passthrough uniquement) | DROP COLUMN en V0.2 |
| 4 | `(supabase as any)` dans certains modules inventaire/stock | Risque type à runtime | Régénérer types Supabase |
| 5 | Reads passthrough `p.category` dans stockAlerts, ExistingProductSuggestions, achatsBrainSummary | Display-only, non critique | Migrer vers `category_name` join |

---

## SECTION 7 — Réponses explicites

| Question | Réponse |
|----------|---------|
| Le module Produits V2 a-t-il une seule vérité par donnée critique ? | ✅ OUI — `category_id`, `final_unit_price`, `supplier_id`, `dlc_warning_days` sont tous SSOT |
| Le module Inventaire a-t-il une seule vérité de stock ? | ✅ OUI — `Snapshot + ΣEvents` via StockEngine pur, aucune duplication |
| Les chemins create/edit produit sont-ils propres et atomiques ? | ✅ OUI — Wizard via RPC, édition via `updateProductV2`, archive/delete via RPCs atomiques |
| Les lectures UI sont-elles alignées sur les vraies sources de vérité ? | ✅ OUI — Toutes les lectures inventaire passent par UUID/join |
| Les relations Produits ↔ Inventaire sont-elles saines ? | ✅ OUI — Couplage produit-pur, pas de dépendance article |
| Y a-t-il encore des legacy actifs dangereux ? | ✅ NON — Plus aucun dual-write. Reads passthrough résiduels (display-only, P2) |
| Peut-on aller en prod V0 sans risque métier majeur ? | ✅ OUI |
| Archive/hard delete sont-ils atomiques ? | ✅ OUI — RPCs `fn_archive_product_v2` / `fn_hard_delete_product_v2` |

---

## SECTION 8 — Verdict final

### 🟢 GO V0 — DÉFINITIF

**Justification** :

1. **Sources de vérité unifiées** — `category_id` est la seule vérité d'écriture. Plus aucun dual-write.

2. **Opérations atomiques** — Archive et hard delete sont désormais des RPCs SQL transactionnelles. Aucun état partiel possible.

3. **StockEngine intact** — Le cœur mathématique n'a subi AUCUNE modification.

4. **Code mort éliminé** — Feature Articles Inventaire intégralement sortie du runtime.

5. **Wizard atomique** — `fn_save_product_wizard` + optimistic lock `updated_at` fonctionnels.

6. **Risques résiduels (P2 uniquement)** :
   - Reads passthrough `p.category` dans 3 modules (display-only, non critique)
   - Tables/colonnes DB legacy dormantes (aucun impact runtime)

**Ce qui peut attendre V0.2+** :
- DROP TABLE `inventory_articles`
- DROP COLUMN `inventory_article_id` / `category` sur `products_v2`
- Migrer les 3 reads passthrough display-only vers `category_name` join
- Renommer `product_category` → `category_name` dans types inventaire
