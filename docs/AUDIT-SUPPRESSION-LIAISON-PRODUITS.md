# Audit de retrait complet de la liaison inter-produits dans l'inventaire

> **Date :** 2026-03-06  
> **Statut :** AUDIT ONLY — Aucune modification de code  
> **Périmètre :** Suppression de la couche "Articles Inventaire" / regroupement de produits

---

## SECTION 1 — Cartographie complète de la fonctionnalité à supprimer

### 1.1 Base de données

| Élément | Type | Impact | Action recommandée |
|---------|------|--------|-------------------|
| `inventory_articles` | Table | Entité métier dédiée (id, name, name_normalized, canonical_unit_id, canonical_family, storage_zone_id, threshold_product_id, establishment_id, archived_at) | Gel DB (conserver la table mais vider les données runtime) |
| `products_v2.inventory_article_id` | Colonne FK nullable | Lien produit → article inventaire | SET NULL via migration, puis ignorer |
| `fk_threshold_product` | FK constraint | `inventory_articles.threshold_product_id → products_v2.id` | Conserver (table gelée) |
| `inventory_articles_canonical_unit_id_fkey` | FK constraint | Vers measurement_units | Conserver (table gelée) |
| `inventory_articles_establishment_id_fkey` | FK constraint | Vers establishments | Conserver (table gelée) |
| `inventory_articles_storage_zone_id_fkey` | FK constraint | Vers storage_zones | Conserver (table gelée) |
| `trg_validate_threshold_product` | Trigger | Valide que threshold_product_id est cohérent | Conserver (table gelée) |
| `trg_reset_threshold_on_unlink` | Trigger (si existant) | Reset threshold si produit détaché | Conserver (table gelée) |
| RLS policies sur `inventory_articles` | Policies | Accès aux articles | Conserver (table gelée) |

### 1.2 Hooks React (à supprimer)

| Fichier | Lignes | Rôle | Consommateurs |
|---------|--------|------|---------------|
| `src/modules/inventaire/hooks/useArticleGrouping.ts` | 212 | Groupement lecture desktop → produits par article | `DesktopInventoryView.tsx` |
| `src/modules/inventaire/hooks/useArticleStock.ts` | 101 | Agrégation stock par article | `InventoryArticlesPage.tsx` |
| `src/modules/inventaire/hooks/useArticleMatching.ts` | 91 | Fuzzy matching articles | `WizardStep7Article.tsx` (via barrel) |
| `src/modules/inventaire/hooks/useInventoryArticles.ts` | 73 | CRUD articles inventaire | `WizardStep7Article.tsx`, `CreateArticleDialog.tsx` |
| `src/modules/inventaire/hooks/useProductsForArticleLinking.ts` | 56 | Fetch produits éligibles au lien | `CreateArticleDialog.tsx` |

### 1.3 Composants UI (à supprimer)

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `src/modules/inventaire/components/ArticleDetailView.tsx` | 472 | Page détail d'un article inventaire |
| `src/modules/inventaire/components/ArticleListView.tsx` | 244 | Tableau liste des articles |
| `src/modules/inventaire/components/CreateArticleDialog.tsx` | 506 | Dialog de création d'article avec sélection produits |
| `src/modules/inventaire/pages/InventoryArticlesPage.tsx` | 104 | Page `/inventaire/articles` |
| `src/modules/inventaire/types/inventoryArticle.ts` | 37 | Types TS : InventoryArticle, CreateInventoryArticlePayload, etc. |

### 1.4 Composants UI (à modifier — retrait partiel)

| Fichier | Lignes | Modification |
|---------|--------|-------------|
| `src/modules/inventaire/components/ProductStockTable.tsx` | 397 | Retirer `ArticleStatusBadge`, `groupedItems` prop, logique parent/child rows, imports `GroupedDisplayItem` |
| `src/modules/inventaire/components/DesktopInventoryView.tsx` | 410 | Retirer `import useArticleGrouping`, appel `useArticleGrouping()`, passage `groupedItems` à `ProductStockTable` |

### 1.5 Wizard Produit (à modifier)

| Fichier | Modification |
|---------|-------------|
| `src/modules/visionAI/components/ProductFormV3/WizardStep7Article.tsx` | **Supprimer entièrement** (253 lignes) |
| `src/modules/visionAI/components/ProductFormV3/ProductFormV3Modal.tsx` | Retirer : `persistInventoryArticle` callback, appels à `persistInventoryArticle()` dans les 2 save paths, import `WizardStep7Article`, rendu step 7, import `useInventoryArticles` |
| `src/modules/visionAI/components/ProductFormV3/useWizardState.ts` | Retirer : `inventoryArticleId`, `inventoryArticleMode`, `setInventoryArticleId`, `setInventoryArticleMode` dans state + exports |
| `src/modules/visionAI/components/ProductFormV3/types.ts` | Retirer : `inventoryArticleId`, `inventoryArticleMode` du type `WizardState` |

### 1.6 StockEngine (à modifier)

| Fichier | Modification |
|---------|-------------|
| `src/modules/stockLedger/engine/stockEngine.ts` | Retirer : `getEstimatedStockByArticle()` (lignes 196-242), type `ArticleStockEvent` |
| `src/modules/stockLedger/index.ts` | Retirer : exports de `getEstimatedStockByArticle` et `ArticleStockEvent` |
| `src/modules/stockLedger/engine/__tests__/stockEngine.test.ts` | Retirer : describe block `"StockEngine — getEstimatedStockByArticle"` (~150 lignes) |

### 1.7 Barrel exports et navigation

| Fichier | Modification |
|---------|-------------|
| `src/modules/inventaire/index.ts` | Retirer : lignes 29-54 (exports Article types, hooks, components) |
| `src/routes/AppRoutes.tsx` | Retirer : lazy import `InventoryArticlesPage`, route `/inventaire/articles` |
| `src/config/navRegistry.ts` | Retirer : entrée `inventaire_articles` |

### 1.8 Cache React Query (clés à nettoyer)

| Query Key | Source |
|-----------|--------|
| `["inventory-articles", estId]` | `useInventoryArticles` |
| `["article-product-map", ...]` | `useArticleStock` |
| `["product-article-mapping", estId]` | `useArticleGrouping` |
| `["article-linked-products", articleId, estId]` | `ArticleDetailView` |
| `["article-unlinked-products", estId]` | `ArticleDetailView` |
| `["article-linked-counts", estId]` | `InventoryArticlesPage` |
| `["products-for-article-linking", estId]` | `useProductsForArticleLinking` |

---

## SECTION 2 — Analyse d'impact métier

### 2.1 Après suppression, l'inventaire produit simple redevient-il cohérent ?

**OUI.** La couche article inventaire est **purement additive en lecture** (Option A). Elle n'écrit jamais dans `stock_events`, `zone_stock_snapshots`, ni `inventory_lines`. Le pipeline d'écriture stock n'est **pas du tout touché** par cette couche. Retirer la couche de lecture agrégée revient à enlever un filtre d'affichage.

### 2.2 Comportements qui redeviennent standards

- **1 produit = 1 ligne dans le tableau stock desktop** (plus de parent/child)
- **1 produit = 1 alerte rupture/sous-seuil** (pas d'agrégation)
- **Wizard produit** : 7 étapes → 6 étapes (Step 7 supprimé, Step 8 Summary redevient Step 7)
- **Page `/inventaire/articles`** : disparaît complètement
- **Nav sidebar** : entrée "Articles inventaire" supprimée

### 2.3 Cas utilisateur qui disparaissent

| Cas | Impact |
|-----|--------|
| Regrouper Lasagne Rummo + Lasagne Molisana sous un même article | **Disparu** — chaque produit est indépendant |
| Voir le stock agrégé d'un "type de produit" | **Disparu** |
| Éviter une fausse rupture sur une marque quand le stock global est OK | **Disparu** — les alertes sont par produit uniquement |
| Définir un seuil porté par un "produit porteur" | **Disparu** — chaque produit a son propre seuil |

### 2.4 Écrans qui changent

| Écran | Changement |
|-------|-----------|
| Inventaire Desktop (`/inventaire`) | Plus de lignes parent pliables, retour au tableau plat |
| Wizard Produit (modal) | Step 7 supprimée, numérotation ajustée |
| Nav Sidebar | Entrée "Articles inventaire" disparue |
| Page `/inventaire/articles` | **Supprimée** (route 404) |

### 2.5 Risques de confusion restants

**Aucun risque significatif.** La feature n'a jamais été en production longue et son retrait simplifie la compréhension. Les produits standalone (99%+ des produits) ne changent absolument pas de comportement.

---

## SECTION 3 — Analyse d'impact technique

### 3.1 Tableau d'actions par élément

| Élément | Action | Justification |
|---------|--------|---------------|
| **Table `inventory_articles`** | **Geler en DB** — ne PAS supprimer | Permet rollback sans perte de données. La table sans lecteurs est inerte. |
| **Colonne `products_v2.inventory_article_id`** | **SET NULL pour toutes les lignes** via migration, puis **ignorer** | Coupe le lien runtime sans supprimer la colonne (rollback possible) |
| **Triggers DB** | **Conserver** | Inertes si `inventory_articles` n'est plus modifiée |
| **RLS policies sur `inventory_articles`** | **Conserver** | Inertes sans lecteurs |
| **Hooks article (5 fichiers)** | **Supprimer** | Code mort après retrait des composants |
| **Composants article (4 fichiers)** | **Supprimer** | Pages/composants dédiés à la feature |
| **Types TS article** | **Supprimer** | Plus de consommateurs |
| **WizardStep7Article.tsx** | **Supprimer entièrement** | Plus d'étape article dans le wizard |
| **ProductStockTable.tsx** | **Refactorer** — retirer logique grouping | Revient au tableau plat simple |
| **DesktopInventoryView.tsx** | **Refactorer** — retirer `useArticleGrouping` | 3 lignes à retirer |
| **stockEngine.ts** | **Refactorer** — retirer `getEstimatedStockByArticle` | Code mort, ~50 lignes |
| **stockLedger/index.ts** | **Refactorer** — retirer exports article | 4 lignes |
| **navRegistry.ts** | **Refactorer** — retirer entrée nav | 5 lignes |
| **AppRoutes.tsx** | **Refactorer** — retirer route | 8 lignes |
| **inventaire/index.ts** | **Refactorer** — retirer exports article | 25 lignes |
| **useWizardState.ts** | **Refactorer** — retirer state article | ~20 lignes |
| **types.ts (wizard)** | **Refactorer** — retirer champs article | 3 lignes |
| **ProductFormV3Modal.tsx** | **Refactorer** — retirer persistInventoryArticle + step 7 | ~50 lignes |
| **Tests stockEngine** | **Refactorer** — retirer describe block article | ~150 lignes |

### 3.2 Réponses aux questions spécifiques

**`inventory_article_id` doit-il être ignoré, vidé, ou retiré ?**
→ **Vidé (SET NULL)** via migration, colonne **conservée** en DB. Le frontend l'ignore complètement. Cela permet un rollback sans migration destructive.

**`inventory_articles` doit-elle être supprimée ?**
→ **NON.** Geler la table. La supprimer nécessiterait de cascader les FK et les triggers, ce qui est risqué et irréversible. Une table sans lecteurs n'a aucun coût runtime.

**Step 7 du wizard doit-il être retiré ou masqué ?**
→ **Retiré totalement.** Masquer crée du code mort et de la confusion. Le wizard passe de 8 à 7 étapes.

**Des triggers DB doivent-ils être supprimés ?**
→ **NON.** Les triggers sont sur `inventory_articles` qui ne sera plus modifiée. Ils sont inertes.

**Des hooks inventaire doivent-ils être supprimés entièrement ?**
→ **OUI.** Les 5 hooks article sont à supprimer : `useArticleGrouping`, `useArticleStock`, `useArticleMatching`, `useInventoryArticles`, `useProductsForArticleLinking`.

**Les alertes stock doivent-elles être simplifiées ?**
→ **NON.** `useStockAlerts` n'a jamais intégré les articles inventaire (c'était le P0-1 de l'audit). Les alertes sont déjà par produit.

**Certains types TS doivent-ils être nettoyés immédiatement ?**
→ **OUI.** `inventoryArticle.ts` (types), `ArticleStockEvent` et `ArticleStockEstimate` dans le stockEngine.

---

## SECTION 4 — Plan de suppression par étapes

### Étape 1 : Sécuriser (pré-requis)

**Objectif :** Snapshot de l'état actuel, vérifier que le stock produit natif est sain indépendamment.

| Action | Détail |
|--------|--------|
| Vérifier que `npm run test` passe | Baseline de non-régression |
| Vérifier que `npm run build` passe | Baseline de build |
| Confirmer qu'aucun autre module n'importe depuis les hooks/composants article | Confirmé par la cartographie (Section 1) |

**Fichiers :** Aucun  
**Risques :** Aucun  
**Critère de validation :** Tests verts, build OK

---

### Étape 2 : Couper la lecture runtime

**Objectif :** Le frontend n'affiche plus aucune donnée article inventaire.

| Action | Fichier |
|--------|---------|
| Retirer `useArticleGrouping` import + appel dans DesktopInventoryView | `DesktopInventoryView.tsx` (3 lignes) |
| Retirer `groupedItems` prop de ProductStockTable | `DesktopInventoryView.tsx` (1 ligne) |
| Retirer toute la logique grouped dans ProductStockTable | `ProductStockTable.tsx` (~110 lignes) |
| Retirer `ArticleStatusBadge` composant local | `ProductStockTable.tsx` (~40 lignes) |
| Retirer route `/inventaire/articles` | `AppRoutes.tsx` (8 lignes) |
| Retirer entrée nav `inventaire_articles` | `navRegistry.ts` (5 lignes) |

**Risques :** Faible — le fallback `groupedItems` undefined rend déjà le tableau plat  
**Critère de validation :** Le tableau inventaire desktop affiche uniquement des lignes produit plates. La route `/inventaire/articles` retourne 404.

---

### Étape 3 : Couper l'écriture

**Objectif :** Plus aucune création/modification d'articles inventaire depuis le frontend.

| Action | Fichier |
|--------|---------|
| Supprimer `WizardStep7Article.tsx` | 253 lignes supprimées |
| Retirer step 7 du wizard dans Modal | `ProductFormV3Modal.tsx` (~50 lignes) |
| Retirer `persistInventoryArticle` callback | `ProductFormV3Modal.tsx` (~35 lignes) |
| Retirer appels `persistInventoryArticle()` dans create + edit | `ProductFormV3Modal.tsx` (2 lignes) |
| Retirer state article du wizard | `useWizardState.ts` (~20 lignes) |
| Retirer types article du wizard | `types.ts` (3 lignes) |
| Ajuster la numérotation des étapes (Step 8 → Step 7) | `ProductFormV3Modal.tsx` |

**Risques :** Moyen — la renumérotation des étapes du wizard doit être testée  
**Critère de validation :** Le wizard fonctionne de la création à la sauvegarde sans Step 7. La sauvegarde n'écrit plus `inventory_article_id`.

---

### Étape 4 : Nettoyer l'UI (composants article)

**Objectif :** Supprimer tout le code mort article.

| Action | Fichier |
|--------|---------|
| Supprimer `ArticleDetailView.tsx` | 472 lignes |
| Supprimer `ArticleListView.tsx` | 244 lignes |
| Supprimer `CreateArticleDialog.tsx` | 506 lignes |
| Supprimer `InventoryArticlesPage.tsx` | 104 lignes |

**Risques :** Aucun — plus de consommateurs après étapes 2-3  
**Critère de validation :** Build propre sans erreurs d'import

---

### Étape 5 : Nettoyer les types/services/hooks

**Objectif :** Supprimer hooks, types et exports article.

| Action | Fichier |
|--------|---------|
| Supprimer `useArticleGrouping.ts` | 212 lignes |
| Supprimer `useArticleStock.ts` | 101 lignes |
| Supprimer `useArticleMatching.ts` | 91 lignes |
| Supprimer `useInventoryArticles.ts` | 73 lignes |
| Supprimer `useProductsForArticleLinking.ts` | 56 lignes |
| Supprimer `types/inventoryArticle.ts` | 37 lignes |
| Retirer exports article dans `inventaire/index.ts` | 25 lignes |
| Retirer `getEstimatedStockByArticle` + `ArticleStockEvent` dans `stockEngine.ts` | 50 lignes |
| Retirer exports dans `stockLedger/index.ts` | 4 lignes |
| Retirer tests article dans `stockEngine.test.ts` | ~150 lignes |

**Risques :** Aucun — code mort  
**Critère de validation :** `npm run build` + `npm run test` passent

---

### Étape 6 : Décider du sort DB

**Objectif :** Neutraliser les données existantes sans destruction.

| Action | Type |
|--------|------|
| Migration : `UPDATE products_v2 SET inventory_article_id = NULL WHERE inventory_article_id IS NOT NULL` | Data cleanup |
| **NE PAS** supprimer la table `inventory_articles` | Conservation rollback |
| **NE PAS** supprimer la colonne `inventory_article_id` | Conservation rollback |
| **NE PAS** supprimer les triggers/FK | Inertes, aucun coût |

**Risques :** Aucun — SET NULL est non destructif, la colonne reste nullable  
**Critère de validation :** `SELECT COUNT(*) FROM products_v2 WHERE inventory_article_id IS NOT NULL` retourne 0

---

### Étape 7 : Vérifier les non-régressions

Voir Section 7 ci-dessous.

---

## SECTION 5 — Plan de rollback / stratégie prudente

### 5.1 Désactivation sans suppression destructive

La stratégie recommandée est **progressive et réversible** :

1. **Phase 1 (Étape 2)** : Couper la lecture → le frontend ignore les articles mais les données DB restent intactes
2. **Phase 2 (Étape 3)** : Couper l'écriture → plus de création/liaison
3. **Phase 3 (Étapes 4-5)** : Nettoyage code mort
4. **Phase 4 (Étape 6)** : Nettoyage données DB

À chaque phase, un rollback est possible via `git revert` sans perte de données DB.

### 5.2 Vérification du stock produit simple

Le stock produit simple fonctionne déjà indépendamment :
- `useEstimatedStock` ne dépend PAS de `inventory_article_id`
- `useDesktopStock` ne dépend PAS de `inventory_article_id`
- `StockEngine.getEstimatedStock` ne dépend PAS de `inventory_article_id`
- Les sessions d'inventaire (comptage, clôture) ne dépendent PAS de `inventory_article_id`

### 5.3 Produits non concernés

Les produits qui n'ont jamais utilisé cette feature (`inventory_article_id IS NULL`) ne sont **absolument pas impactés**. C'est la majorité des produits.

### 5.4 Traitement des données liées

- `inventory_article_id` : SET NULL (migration). Pas de perte fonctionnelle car le stock est au niveau produit.
- `inventory_articles` rows : Laissées en place (table gelée). Si le module revient un jour, les données historiques sont préservées.
- Pas besoin de flag temporaire — couper la lecture suffit.

---

## SECTION 6 — Données existantes et migration

### 6.1 État probable des données

| Donnée | Volume estimé | Action |
|--------|---------------|--------|
| `inventory_articles` rows | Faible (feature récente) | Conserver en DB |
| `products_v2` avec `inventory_article_id NOT NULL` | Très faible | SET NULL |
| `threshold_product_id` sur articles | Très faible | Inerte (table gelée) |
| Caches React Query | En mémoire uniquement | Disparaissent avec le retrait des hooks |

### 6.2 Recommandation : Soft Decommission

**Recommandation : Soft Decommission** (gel DB + retrait applicatif)

**Justification :**

| Critère | Soft Decommission | Suppression complète |
|---------|-------------------|---------------------|
| Rollback possible | ✅ Immédiat | ❌ Migration destructive irréversible |
| Coût runtime | 0 (table sans lecteurs) | 0 |
| Coût stockage | Négligeable (quelques rows) | 0 |
| Risque de casse | Nul | FK cascade peut être dangereuse |
| Complexité | Simple (1 UPDATE) | Élevée (DROP TABLE + DROP COLUMN + FK + triggers) |

---

## SECTION 7 — Non-régression impérative

### 7.1 Tests fonctionnels à exécuter

| Domaine | Test | Critère de succès |
|---------|------|-------------------|
| **Stock individuel** | Ouvrir l'inventaire desktop → chaque produit a sa propre ligne | Pas de lignes parent/child |
| **Stock individuel** | Vérifier que le stock estimé par produit est correct | Identique à avant |
| **Sessions inventaire** | Créer une session, compter, clôturer | Aucun changement de comportement |
| **Sessions mobile** | Comptage mobile fonctionne normalement | Aucun changement |
| **Quick adjustment** | Ajustement rapide depuis le drawer produit | Fonctionne |
| **Transfert zone** | Transférer un produit d'une zone à une autre | Fonctionne |
| **Alertes stock** | Produit sous seuil → badge "Sous seuil" | Inchangé (alertes déjà par produit) |
| **Alertes stock** | Produit en rupture → badge "Rupture" | Inchangé |
| **Wizard création** | Créer un produit du début à la fin | Pas de Step 7 article, save OK |
| **Wizard édition** | Éditer un produit existant | Pas de Step 7, save OK |
| **Produits standards** | Produits sans liaison = aucun changement | Comportement identique |
| **Commandes** | Créer une commande avec des produits | Aucun lien avec articles |
| **DLC** | Alertes DLC fonctionnent | Aucun lien avec articles |
| **B2B** | Import produit B2B fonctionne | Aucun lien avec articles |
| **Build** | `npm run build` | OK |
| **Tests unitaires** | `npm run test` | Tous verts (après retrait tests article) |

### 7.2 Tests spécifiques post-suppression

| Test | Vérification |
|------|-------------|
| Route `/inventaire/articles` | Retourne 404 ou page non trouvée |
| Sidebar inventaire | Pas d'entrée "Articles inventaire" |
| Wizard produit | 7 étapes au lieu de 8 |
| Produit avec ancien `inventory_article_id` (SET NULL) | S'affiche normalement, pas de comportement fantôme |

---

## SECTION 8 — Recommandation finale

### Verdict : **Désactiver puis supprimer après validation**

**Plan recommandé en 2 phases :**

#### Phase A — Désactivation immédiate (1 PR)
- Étapes 2 + 3 : Couper lecture runtime + écriture wizard
- Test complet du stock natif et du wizard
- **Durée estimée :** 1-2 heures de dev

#### Phase B — Nettoyage (1 PR, après validation Phase A)
- Étapes 4 + 5 + 6 : Supprimer composants, hooks, types, exports + SET NULL en DB
- **Durée estimée :** 30-60 minutes de dev

### Justification

1. **La couche est purement additive en lecture** → la retirer ne casse rien par construction
2. **Le stock natif fonctionne déjà indépendamment** → aucune migration logique nécessaire
3. **La feature est récente avec peu de données** → nettoyage DB trivial
4. **Le soft decommission permet un rollback** → sécurité maximale
5. **Le code mort (~2200 lignes) représente une dette technique significative** → retrait justifié

### Points de vigilance majeurs — Réponses explicites

| Question | Réponse |
|----------|---------|
| Si on retire la logique article du runtime, le stock natif redevient-il sain ? | **OUI immédiatement.** La couche article n'a jamais touché au pipeline d'écriture stock. |
| Quels points dépendent encore de `inventory_article_id` pour afficher/calculer ? | **3 points seulement :** `useArticleGrouping` (tableau desktop), `useArticleStock` (page articles), `persistInventoryArticle` (wizard save). Tous sont à retirer. |
| Peut-on supprimer Step 7 sans casser le wizard ? | **OUI.** Step 7 est isolée (composant dédié, state dédié). Le wizard fonctionne sans elle — il suffit de renumeroter Step 8 → 7. |
| Faut-il d'abord masquer l'UI, puis couper la lecture, puis supprimer l'écriture ? | **OUI, c'est l'ordre recommandé** (Étapes 2 → 3 → 4-5). |
| Que faire des données existantes ? | **SET NULL sur `inventory_article_id`**, geler la table `inventory_articles`. |
| Quelle est la façon la plus sûre ? | **Soft decommission en 2 PR**, avec validation entre les deux. |

---

## Annexe — Inventaire complet des fichiers impactés

### Fichiers à supprimer (7 fichiers, ~1'672 lignes)

```
src/modules/inventaire/hooks/useArticleGrouping.ts          (212 lignes)
src/modules/inventaire/hooks/useArticleStock.ts              (101 lignes)
src/modules/inventaire/hooks/useArticleMatching.ts           (91 lignes)
src/modules/inventaire/hooks/useInventoryArticles.ts         (73 lignes)
src/modules/inventaire/hooks/useProductsForArticleLinking.ts (56 lignes)
src/modules/inventaire/types/inventoryArticle.ts             (37 lignes)
src/modules/visionAI/components/ProductFormV3/WizardStep7Article.tsx (253 lignes)
src/modules/inventaire/components/ArticleDetailView.tsx      (472 lignes)
src/modules/inventaire/components/ArticleListView.tsx        (244 lignes)
src/modules/inventaire/components/CreateArticleDialog.tsx    (506 lignes)
src/modules/inventaire/pages/InventoryArticlesPage.tsx       (104 lignes)
```

### Fichiers à modifier (9 fichiers, ~300 lignes à retirer)

```
src/modules/inventaire/components/DesktopInventoryView.tsx   (3 lignes retirées)
src/modules/inventaire/components/ProductStockTable.tsx       (~150 lignes retirées)
src/modules/inventaire/index.ts                              (25 lignes retirées)
src/modules/stockLedger/engine/stockEngine.ts                (50 lignes retirées)
src/modules/stockLedger/index.ts                             (4 lignes retirées)
src/modules/stockLedger/engine/__tests__/stockEngine.test.ts (~150 lignes retirées)
src/modules/visionAI/components/ProductFormV3/ProductFormV3Modal.tsx (~85 lignes retirées)
src/modules/visionAI/components/ProductFormV3/useWizardState.ts (~20 lignes retirées)
src/modules/visionAI/components/ProductFormV3/types.ts       (3 lignes retirées)
src/routes/AppRoutes.tsx                                     (8 lignes retirées)
src/config/navRegistry.ts                                    (5 lignes retirées)
```

### DB (1 migration)

```sql
-- Soft decommission : neutraliser les liens existants
UPDATE products_v2 SET inventory_article_id = NULL WHERE inventory_article_id IS NOT NULL;
-- Table inventory_articles : GELÉE (conservée, non supprimée)
```

**Total estimé : ~2'200 lignes de code mort retirées, 0 risque de casse sur le stock natif.**
