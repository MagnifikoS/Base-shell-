# 🔍 Audit Hard — Module Inventaire

**Date :** 2026-03-06  
**Scope :** `src/modules/inventaire/`, `src/modules/stockLedger/`, `src/modules/stockAlerts/`, `src/hooks/realtime/channels/useStockEventsChannel.ts`  
**Version :** Post-ajout Articles Inventaire

---

## SECTION A — Executive Summary

### Verdict : **GO CONDITIONNEL**

Le module Inventaire est architecturalement solide : StockEngine pur, formule verrouillée (Snapshot + ΣEvents), atomicité RPC, agrégation read-only, zéro modification du pipeline d'écriture par les articles. Cependant **3 problèmes P0** et **5 P1** doivent être traités.

### 🔴 3 Risques Critiques

| # | Risque | Impact |
|---|--------|--------|
| **C1** | Tous les accès à `inventory_article_id` et `inventory_articles` utilisent `(supabase as any)` — 18 occurrences dans 8 fichiers. Aucune vérification de retour sur les `update()`. | Liaisons silencieusement échouées, articles créés mais jamais liés, fausses ruptures |
| **C2** | `useStockAlerts` ne connaît PAS les articles inventaire — les alertes sont **produit-only**. Un article dont le stock agrégé est OK affiche quand même "Rupture" sur chaque sous-produit individuellement. | Double alerte / fausse alerte utilisateur, confusion métier |
| **C3** | `CreateArticleDialog` lie les produits en boucle `for...of await` sans transaction — si un lien échoue à mi-chemin, l'article existe avec une liaison partielle. Pas de rollback. | Article incomplet, stock agrégé faux |

### 🟡 5 Risques Moyens

| # | Risque |
|---|--------|
| **M1** | `useDesktopStock` ne remonte pas `inventory_article_id` — le hook `useArticleGrouping` doit faire une requête supplémentaire pour reconstituer le mapping |
| **M2** | `getEstimatedStockByArticle` existe dans `stockEngine.ts` mais n'est utilisé nulle part — code mort |
| **M3** | `ArticleDetailView` détache un produit sans vérifier si c'est le `threshold_product_id` → trigger DB le remet à NULL mais l'UI ne prévient pas l'utilisateur |
| **M4** | `useArticleStock` somme les quantités sans vérifier la cohérence d'unité — si deux produits liés ont des familles canoniques différentes (bug de liaison), le total est mathématiquement faux |
| **M5** | Session `completeSession` utilise `updateSessionStatus("termine")` qui appelle le RPC atomique, mais l'invalidation côté client ne couvre pas `["product-article-mapping"]` ni `["article-product-map"]` |

### ✅ Points Solides

- **StockEngine pur** : formule `Snapshot + Σ(Events)` isolée, testée (stockEngine.ts, 195 lignes, zéro side-effect)
- **Snapshot immutabilité** : `zone_stock_snapshots` → `snapshot_version_id`, jamais modifié après clôture
- **Atomicité RPC** : `fn_complete_inventory_session`, `fn_quick_adjustment`, `fn_transfer_product_zone`, `fn_initialize_product_stock`
- **Guard anti-doublon session** : index unique DB + garde applicatif dans `createInventorySession`
- **Éligibilité produit unifiée** : `isProductInventoryEligible` + BFS `resolveProductUnitContext` identiques entre session creation et desktop display
- **Realtime centralisé** : `useStockEventsChannel` et `useInventorySessionsChannel` dans `useAppRealtimeSync`
- **Article agrégation read-only** : `useArticleGrouping` et `useArticleStock` ZÉRO modification au pipeline d'écriture

---

## SECTION B — Cartographie des Sources de Vérité

| Domaine | SSOT | Qui écrit | Qui lit | Garde-fous | Double vérité ? |
|---------|------|-----------|---------|------------|----------------|
| **Stock réel (par produit)** | `zone_stock_snapshots` + `inventory_lines` + `stock_events` → StockEngine | Sessions (clôture RPC), BL POST, Ajustement, Retrait | `useEstimatedStock`, `useStockAlerts`, `useProductCurrentStock` | StockEngine refuse événements famille ≠ snapshot | ✅ Pas de double vérité |
| **Stock affiché (desktop)** | `useDesktopStock` (snapshot direct) + `useEstimatedStock` (calculé) | Lecture seule | `DesktopInventoryView` | Dual mode "snapshot" vs "realtime" | ⚠️ Deux sources affichées, mais complémentaires |
| **Stock agrégé (article)** | `useArticleStock` = Σ(`useEstimatedStock` par produit lié) | Lecture seule | `InventoryArticlesPage`, `useArticleGrouping` | Somme produits du même article | ✅ Dérivé de la SSOT produit |
| **Seuil de stock (produit)** | `products_v2.min_stock_quantity_canonical` + `min_stock_unit_id` | Wizard Step 6, inline `MinStockInlineEdit` | `StockStatusBadge`, `useStockAlerts`, `ArticleStatusBadge` | Conversion BFS canonical | ✅ Unique |
| **Seuil agrégé (article)** | `inventory_articles.threshold_product_id` → `products_v2.min_stock_quantity_canonical` du porteur | `CreateArticleDialog`, Wizard Step 7 | `useArticleGrouping.effectiveThreshold` | Triggers DB validation | ✅ Pas de double vérité |
| **Produit porteur** | `inventory_articles.threshold_product_id` (FK → `products_v2`) | `CreateArticleDialog`, Wizard Step 7 | `useArticleGrouping`, `ArticleDetailView` | Trigger DB : doit être lié, même famille/unité | ✅ Protégé DB |
| **Article inventaire** | `inventory_articles` (table) | `CreateArticleDialog`, Wizard Step 7, `ArticleDetailView` (liaison/détachement) | `useInventoryArticles`, `useArticleGrouping`, `useArticleStock` | RLS, soft-delete (`archived_at`) | ✅ Unique |
| **Famille canonique** | `products_v2.canonical_family` + `inventory_articles.canonical_family` | Wizard (produit), `CreateArticleDialog` (article) | `useArticleMatching`, `CreateArticleDialog` (filtre), `ArticleDetailView` (validation) | Filtre UI + validation mutation `linkMutation` | ⚠️ Pas de trigger DB sur family match produit↔article |
| **Session d'inventaire** | `inventory_sessions` | `createInventorySession`, `updateSessionStatus`, `cancelAndDeleteSession` | `useInventorySessions`, `useDesktopStock`, `useEstimatedStock` | Index unique partial (1 active/zone), RPC atomique clôture | ✅ Solide |
| **Zone de stockage** | `products_v2.storage_zone_id` (FK) | Wizard, `fn_transfer_product_zone` | Inventaire, stock, filtres | RPC atomique avec WITHDRAWAL/RECEIPT | ✅ Solide |
| **Unité canonique** | `products_v2.stock_handling_unit_id` → `resolveProductUnitContext` → `canonical_unit_id` | Wizard | StockEngine, `useEstimatedStock`, `useDesktopStock` | BFS validation graphe | ✅ Solide |
| **Rupture** | `estimated_quantity ≤ 0` | Calculé (jamais stocké) | `StockStatusBadge`, `ArticleStatusBadge`, `useStockAlerts` | Même formule partout | 🔴 Produit-only dans alertes (C2) |
| **Sous-seuil** | `estimated_quantity < min_stock_quantity_canonical` | Calculé | `StockStatusBadge`, `ArticleStatusBadge`, `useStockAlerts` | Même logique | 🔴 Alertes ignorent agrégation (C2) |
| **Standalone vs agrégé** | `products_v2.inventory_article_id` NULL = standalone | Wizard Step 7, `CreateArticleDialog`, `ArticleDetailView` | `useArticleGrouping` | Fallback gracieux (NULL = standalone inchangé) | ✅ Propre |

---

## SECTION C — Audit Métier des Articles Inventaire

### Rôle exact

L'article inventaire est une **entité de regroupement opérationnel** qui agrège visuellement le stock de N produits fournisseur identiques (ex: "Lasagne" = "Lasagne Rummo" + "Lasagne Barilla"). C'est une **entité métier réelle** (table `inventory_articles`) avec :
- identité propre (nom, famille canonique, unité, zone)
- liaison N:1 via `products_v2.inventory_article_id` 
- seuil via produit porteur

### Différence avec produit fournisseur

| | Produit fournisseur | Article inventaire |
|--|--------------------|--------------------|
| Identité | Spécifique (nom, code, supplier) | Générique (nom regroupement) |
| Prix | Oui (`final_unit_price`) | Non |
| Commandes | Oui (commandable) | Non |
| Stock | Individuel | Agrégé (somme produits liés) |
| Seuil | Propre | Hérité du porteur |

### L'article est-il une simple vue ou une vraie entité ?

**Vraie entité** — table DB dédiée, FK produit → article, triggers de validation porteur. Ce n'est PAS un simple GROUP BY à la lecture.

### Le stock agrégé est-il cohérent ?

✅ **Oui** — `useArticleStock` somme les `estimated_quantity` individuels des produits liés. La formule est : `ArticleStock = Σ(StockEngine(produit_i))`. Aucune écriture, aucun cache séparé.

⚠️ **Risque M4** : si un produit a une famille canonique différente de l'article (liaison incohérente passée), la somme mélange des kg et des litres. La validation est UI-only (pas de trigger DB sur `canonical_family` du produit vs article).

### Le seuil agrégé est-il bien porté par un seul produit porteur ?

✅ **Oui** — `inventory_articles.threshold_product_id` → `products_v2.min_stock_quantity_canonical`. `useArticleGrouping` résout `effectiveThreshold` en cherchant le porteur dans la liste des produits affichés. Triggers DB valident que le porteur est lié et compatible.

### Double vérité seuil produit / article ?

✅ **Non** — le seuil article N'EXISTE PAS comme colonne sur `inventory_articles`. Il est TOUJOURS résolu depuis le produit porteur. Pas de double vérité.

### L'agrégation corrige-t-elle les fausses ruptures ?

✅ **OUI au niveau du desktop** — `ArticleStatusBadge` compare le stock agrégé au seuil du porteur. Un produit en rupture individuelle mais dont l'article est OK affiche correctement "OK" au niveau parent.

🔴 **NON au niveau des alertes** — `useStockAlerts` ne connaît pas les articles. Chaque produit est évalué individuellement. Un produit porteur en rupture génère une alerte "Rupture" même si l'article agrégé a suffisamment de stock (C2).

### Ambiguïtés métier ?

⚠️ **Cas problématique** : Produit A (porteur, min_stock=5kg, stock=0kg) + Produit B (stock=10kg) → Article stock agrégé = 10kg > seuil 5kg = OK. MAIS l'alerte stock montre "Rupture" pour Produit A individuellement. L'utilisateur reçoit un signal contradictoire entre la vue inventaire (OK) et la vue alertes (Rupture).

---

## SECTION D — Audit Compatibilité par Famille Canonique

### Protections existantes

| Point de contrôle | Niveau | Protection |
|-------------------|--------|-----------|
| `CreateArticleDialog` — sélection produits | UI | Filtre `canonical_unit_id` + `canonical_family` sur premier sélectionné |
| `CreateArticleDialog` — submit | UI | Validation explicite `incompatible.length > 0` → toast erreur |
| `ArticleDetailView` — liaison | UI | `linkMutation` vérifie `product.canonical_family !== article.canonical_family` |
| `findMatchingArticles` (Wizard) | UI | Filtre `canonical_family` MANDATORY |
| `inventory_articles` insert | DB | Aucune contrainte CHECK sur famille vs unité |
| `products_v2.inventory_article_id` update | DB | Aucun trigger de validation famille |

### Verdict

⚠️ **Protection UI-only, pas de protection DB**. Si un appel direct à `supabase.update({ inventory_article_id })` est fait sans passer par le UI (ex: migration, script, autre module), un produit en "volume" peut être lié à un article en "mass". Les triggers DB ne valident que le `threshold_product_id`, pas la liaison produit → article.

**Risque** : faible à court terme (tous les chemins passent par le UI), mais violation possible en cas d'évolution.

---

## SECTION E — Audit Seuils et Alertes Stock

### Source de vérité du seuil

- **Produit standalone** : `products_v2.min_stock_quantity_canonical` (direct)
- **Produit sous article** : même colonne, mais le seuil effectif de l'article est résolu via `threshold_product_id → produit.min_stock_quantity_canonical`

### Règle multi-produit agrégé

Le seuil de l'article est celui du **produit porteur uniquement**. Les seuils des autres produits liés sont ignorés pour l'agrégation. Chaque produit garde son propre seuil pour son badge individuel.

### Alertes — État actuel

| Composant | Connaît les articles ? | Logique |
|-----------|----------------------|---------|
| `StockStatusBadge` (desktop, par produit) | Non | `estimated_quantity ≤ 0 → Rupture`, `< min_stock → Sous seuil` |
| `ArticleStatusBadge` (desktop, parent) | Oui | `aggregatedQty ≤ 0 → Rupture`, `< effectiveThreshold → Sous seuil` |
| `useStockAlerts` (page alertes) | 🔴 **Non** | Produit-only, aucune agrégation |
| `MobileStockAlertsView` | 🔴 **Non** | Produit-only |

### Cas métier analysé

> Produit A (porteur) : stock = 0 kg, seuil = 5 kg → "Rupture" individuel  
> Produit B (lié) : stock = 10 kg → "OK" individuel  
> Article : stock agrégé = 10 kg > 5 kg → "OK" agrégé

**Desktop :** La ligne parent montre "OK" ✅. La sous-ligne A montre "Rupture" ⚠️ (son propre seuil). **Cohérent mais potentiellement confus** si l'utilisateur ne comprend pas que le badge parent prime.

**Alertes :** Page alertes montre "Rupture" pour Produit A sans contexte article. **Fausse alerte** au sens métier article (C2).

### Standalone inchangé

✅ Les produits sans `inventory_article_id` gardent exactement le même comportement qu'avant. Zero regression.

---

## SECTION F — Audit Sessions d'Inventaire

### Architecture

```
createInventorySession()
  → Fetch products zone (with BFS eligibility)
  → Insert session (unique partial index guard)
  → Insert inventory_lines (batched 100)
  
countProduct() [mobile/desktop]
  → Update inventory_lines.quantity + unit_id + counted_at
  → RPC increment_counted_products (atomic counter)
  
completeSession() → RPC fn_complete_inventory_session
  → Reconciles counts
  → Sets status = 'termine'
  → Updates zone_stock_snapshots (SSOT)
  → Single PG transaction
```

### Mobile ↔ Articles Inventaire

✅ **Aucun conflit** — le comptage mobile opère toujours au niveau **produit** (inventory_lines référence product_id, pas article_id). L'agrégation article est strictement desktop / lecture-seule. Le mobile ne connaît pas et n'a pas besoin de connaître les articles.

### Desktop lecture agrégée vs mobile comptage

✅ **Cohérent** — le desktop affiche la somme agrégée, le mobile compte produit par produit. Les deux convergent vers les mêmes `inventory_lines` → même `zone_stock_snapshots` → même StockEngine.

### Risque de session incohérente avec articles liés ?

✅ **Non** — les sessions sont par zone + par produit. Un article qui regroupe des produits de la même zone verra tous ses produits dans la même session. Si les produits sont dans des zones différentes, ils apparaissent dans leurs sessions respectives. L'agrégation reste correcte car elle somme les estimés indépendamment de la zone.

### Guards solides

- **Anti-doublon** : index unique partial + garde applicatif `fetchActiveSessionForZone`
- **Race condition** : code erreur `23505` catch → `SESSION_ACTIVE_EXISTS`
- **Rollback batch** : si insertion lignes échoue, session supprimée (cascade)
- **Soft cancel** : `cancelAndDeleteSession` → status='annule' (audit trail)
- **Eligibilité** : même logique BFS que desktop (`isProductInventoryEligible`)

---

## SECTION G — Audit Interactions Autres Modules

### Commandes

| Aspect | Statut | Détail |
|--------|--------|--------|
| Disponibilité | ✅ | Commandes ne lisent pas le stock inventaire |
| Ruptures | ⚠️ | Alertes stock ignorent l'agrégation article — un produit commandable peut être signalé "rupture" alors que l'article est OK |
| Produits commandables | ✅ | Via `products_v2` + `b2b_partnerships`, indépendant de l'inventaire |
| Prix | ✅ | Pas de lien |

**Couplage : ✅ Sain** — les commandes ne dépendent pas du module inventaire.

### DLC

| Aspect | Statut | Détail |
|--------|--------|--------|
| Produits agrégés | ✅ | DLC opère au niveau lot/produit, pas article |
| Cohérence | ✅ | `dlcCompute.ts` résout par produit, pas d'interaction article |

**Couplage : ✅ Sain**

### B2B

| Aspect | Statut | Détail |
|--------|--------|--------|
| Produits importés | ✅ | `b2b_imported_products` reste indépendant de `inventory_article_id` |
| Mapping | ✅ | Pas de conflit — la liaison article est locale au client |
| Identité | ✅ | `supplier_id` verrouillé, article n'affecte pas l'identité produit |

**Couplage : ✅ Sain**

### Stock Ledger

| Aspect | Statut | Détail |
|--------|--------|--------|
| Source stock | ✅ | `stock_events` + `zone_stock_snapshots` = SSOT |
| Agrégation vs mouvements | ✅ | L'agrégation article est STRICTEMENT additive en lecture. Zéro événement article dans `stock_events` |
| `getEstimatedStockByArticle` | ⚠️ | Fonction existe dans `stockEngine.ts` mais n'est jamais appelée (M2) |

**Couplage : ✅ Sain**

### Future Facture

| Aspect | Statut | Détail |
|--------|--------|--------|
| Lisibilité | ✅ | Facture utilise `commande_lines.product_id` → produit, pas article |
| Prix | ✅ | `unit_price_snapshot` figé, indépendant de l'inventaire |
| Packaging | ✅ | Pas de lien |

**Couplage : ✅ Sain** — l'article inventaire n'interfère à aucun moment avec la chaîne transactionnelle (commande → BL → facture).

---

## SECTION H — Audit UX / Compréhension Utilisateur

### Points Forts
- Ligne parent avec chevron collapsible → claire
- Badge 👑 (Crown) sur le produit porteur avec tooltip explicatif
- Badge "agrégé" quand pas de seuil défini
- Sous-lignes indentées avec `└` visuel
- Standalone identique à avant → zéro surprise

### Points Faibles

| Problème | Sévérité | Détail |
|----------|----------|--------|
| **Badge contradictoire** | 🟡 | Ligne parent "OK" mais sous-ligne porteur "Rupture" — l'utilisateur peut ne pas comprendre que le badge parent prime |
| **Alertes stock ignorent les articles** | 🔴 | La page alertes montre des ruptures qui n'en sont pas au niveau article (C2) |
| **Pas d'explication "porteur"** | 🟡 | Le tooltip "Produit porteur du seuil pour cet article" est minimal. Pas d'explication de ce que ça implique concrètement. |
| **Détachement sans avertissement porteur** | 🟡 | L'utilisateur peut détacher le produit porteur sans savoir que le seuil article va tomber à NULL (M3) |
| **Liaison partielle silencieuse** | 🔴 | Si `CreateArticleDialog` échoue à mi-chemin du for-loop, pas de feedback (C3) |
| **`canonical_family` affiché brut** | 🟡 | L'utilisateur voit "mass", "volume", "unit" — pas de traduction française |

### Cohérence Mobile / Desktop

✅ **Correcte** — le mobile compte par produit, le desktop affiche agrégé. Le mobile ne montre pas les articles (non nécessaire pour le comptage).

---

## SECTION I — Audit Technique / Taille / Complexité

| Fichier | Rôle | Lignes | Criticité | Risque | Recommandation |
|---------|------|--------|-----------|--------|---------------|
| `useEstimatedStock.ts` | SSOT stock temps réel | 174 | 🔴 Critique | Clean | **keep** |
| `useDesktopStock.ts` | Fusion produits + snapshot + sessions | 350 | 🔴 Critique | Manque `inventory_article_id` | **fix** (M1) |
| `useArticleGrouping.ts` | Grouping display | 212 | 🟡 Élevé | Requête supplémentaire évitable | **refactor** (M1) |
| `useArticleStock.ts` | Stock agrégé article | 101 | 🟡 | Pas de validation famille | document |
| `useInventorySessions.ts` | Sessions CRUD | 158 | 🟡 | Clean | **keep** |
| `useInventoryLines.ts` | Lignes CRUD | 74 | ✅ | Clean | **keep** |
| `useQuickAdjustment.ts` | Ajustement atomique | 105 | ✅ | Clean | **keep** |
| `useTransferProductZone.ts` | Transfer zone atomique | 104 | ✅ | Clean | **keep** |
| `useInitializeProductStock.ts` | Init stock produit | 77 | ✅ | Clean | **keep** |
| `inventorySessionService.ts` | Service sessions | 255 | 🟡 | Clean | **keep** |
| `inventoryLineService.ts` | Service lignes | 218 | ✅ | Clean | **keep** |
| `DesktopInventoryView.tsx` | Vue desktop principale | 410 | 🟡 | Acceptable | **keep** |
| `ProductStockTable.tsx` | Table stock avec articles | 397 | 🟡 | Clean, bien structuré | **keep** |
| `CreateArticleDialog.tsx` | Création article + liaison | 506 | 🟡 | Liaison non-transactionnelle (C3) | **fix** |
| `ArticleDetailView.tsx` | Détail article | 472 | 🟡 | Détachement porteur sans warning (M3) | **fix** |
| `StockStatusBadge.tsx` | Badge produit | 91 | ✅ | Clean | **keep** |
| `stockEngine.ts` | Moteur pur | 242 | 🔴 Critique | `getEstimatedStockByArticle` inutilisé | **clean** (M2) |
| `useStockAlerts.ts` | Alertes stock | 423 | 🔴 Critique | Ignorance articles (C2) | **fix** |
| `StockAlertsView.tsx` | Vue alertes desktop | 613 | 🟡 Élevé | Gros mais fonctionnel | document |
| `useInventoryArticles.ts` | CRUD articles | 73 | ✅ | Clean | **keep** |
| `useArticleMatching.ts` | Fuzzy matching | 91 | ✅ | Clean | **keep** |
| `useProductsForArticleLinking.ts` | Produits éligibles liaison | 56 | ✅ | Clean | **keep** |

---

## SECTION J — Code Mort / Incohérences / Dette

### Code Mort

| Élément | Fichier | Statut |
|---------|---------|--------|
| `getEstimatedStockByArticle` | `stockEngine.ts:222-242` | Exporté, jamais appelé. L'agrégation article est faite dans `useArticleStock` (approche différente : somme des estimated individuels vs redeltas par article). |
| `ArticleStockEvent` type | `stockEngine.ts:201-205` | Utilisé uniquement par `getEstimatedStockByArticle` → mort |
| `inTransitStock` | `DesktopInventoryView.tsx:63` | `new Map<string, number>()` — déclaré mais toujours vide, passé à `ProductStockTable` sans jamais être rempli |
| `warningsBadge = null` | `StockStatusBadge.tsx:53` | Variable déclarée null, rendue dans le JSX → no-op |

### Incohérences

| Problème | Détail |
|----------|--------|
| **`(supabase as any)` × 18** | Tous les accès à `inventory_article_id` et `inventory_articles` bypasse le typage. La colonne et la table existent en DB mais ne sont pas dans le type TS généré. |
| **Alertes stock vs Desktop** | Desktop affiche article-level status (OK/Rupture agrégé), page alertes affiche produit-level (Rupture individuel). Signal contradictoire. |
| **`category` texte** dans `useStockAlerts` | Utilise `products_v2.category` (texte legacy) au lieu de `category_id` UUID |
| **`useArticleGrouping` requête N+1** | Fait 2 requêtes (produits liés + articles) alors que `useDesktopStock` pourrait embarquer `inventory_article_id` directement |

### États visuels ≠ états métier

| État visuel | État métier réel | Risque |
|-------------|-----------------|--------|
| Sous-produit "Rupture" dans article | Article "OK" (stock agrégé suffisant) | Confusion utilisateur |
| Alerte stock "Rupture" | Article "OK" | Fausse alerte |

---

## SECTION K — Pré-requis Avant d'Aller Plus Loin

### P0 — Bloquants

| # | Problème | Impact | Preuve | Recommandation | Risque si non corrigé |
|---|----------|--------|--------|---------------|----------------------|
| **P0-1** | `useStockAlerts` ne connaît pas les articles inventaire — alertes produit-only | Fausses alertes rupture, confusion métier | `useStockAlerts.ts` lignes 328-383 : évalue `est ≤ 0` par produit, jamais par article | Option A : ajouter une colonne `suppress_individual_alert` si produit lié à un article avec stock OK. Option B : enrichir l'alerte d'un champ `article_context` pour UX. | Utilisateur commande du stock inutilement |
| **P0-2** | `(supabase as any)` × 18 sans vérification de retour | Liaisons silencieusement échouées, articles fantômes | `CreateArticleDialog.tsx:249`, `ArticleDetailView.tsx:131,159`, `InventoryArticlesPage.tsx:46`, `useArticleGrouping.ts:64,83`, `useArticleStock.ts:42`, `useProductsForArticleLinking.ts:41` | Ajouter `inventory_article_id` au type `products_v2` autogénéré (migration DB déjà faite) OU wrapper typé. Vérifier tous les `.update()` retours. | Données corrompues silencieusement |
| **P0-3** | `CreateArticleDialog` lie les produits en boucle non-transactionnelle | Article avec liaison partielle si erreur réseau | `CreateArticleDialog.tsx:247-253` : `for (const p of selectedProducts) { await update... }` sans rollback | Créer un RPC `fn_create_article_with_links(article_data, product_ids[])` transactionnel | Article incomplet → stock agrégé faux |

### P1 — Moyens

| # | Problème | Recommandation | Risque si non corrigé |
|---|----------|---------------|----------------------|
| **P1-1** | `useDesktopStock` ne remonte pas `inventory_article_id` → requête supplémentaire dans `useArticleGrouping` | Ajouter `inventory_article_id` au select de `useDesktopStock` | Performance (requête N+1) |
| **P1-2** | `ArticleDetailView` détache le porteur sans avertissement | Ajouter confirmation spécifique "Ce produit est le porteur du seuil, le détacher supprimera l'alerte de seuil" | Seuil article supprimé silencieusement |
| **P1-3** | `useArticleStock` ne vérifie pas la cohérence famille canonique | Ajouter un warning si des produits liés ont des familles différentes | Somme kg + litres = absurde |
| **P1-4** | `getEstimatedStockByArticle` code mort dans stockEngine.ts | Supprimer ou brancher | Code mort pollue le moteur |
| **P1-5** | `canonical_family` affiché brut ("mass", "volume") | Mapper vers labels français ("Poids", "Volume", "Unité") | UX technique |

### P2 — Dette Acceptable

| # | Problème | Recommandation |
|---|----------|---------------|
| **P2-1** | `inTransitStock` toujours vide dans `DesktopInventoryView` | Implémenter ou supprimer quand feature "in transit" sera développée |
| **P2-2** | `warningsBadge = null` dans `StockStatusBadge` | Supprimer ou implémenter le système de warnings StockEngine |
| **P2-3** | `StockAlertsView.tsx` 613 lignes | Extraire les filtres et le rendu de table en sous-composants |
| **P2-4** | `category` texte legacy encore utilisé dans `useStockAlerts` | Migrer vers `category_id` UUID |
| **P2-5** | `zone_stock_snapshots` pas de cleanup des snapshots orphelins | Ajouter cleanup périodique ou trigger |

---

## Réponses Explicites aux 7 Questions

### 1. Le module Inventaire a-t-il une seule vérité de stock ?

**✅ Oui** — StockEngine (`Snapshot + Σ(Events)`) est la SSOT absolue. Jamais stocké en DB. Les deux vues (estimé temps réel et snapshot brut) sont complémentaires, pas contradictoires.

### 2. Les Articles Inventaire sont-ils correctement intégrés ou créent-ils une couche ambiguë ?

**⚠️ Partiellement** — L'intégration desktop (grouping, badges, agrégation) est propre et read-only. Mais l'intégration alertes stock est **absente** (C2), créant une contradiction entre ce que l'utilisateur voit sur le desktop (article OK) et la page alertes (produit en rupture).

### 3. La logique de produit porteur est-elle saine métierment ?

**✅ Oui** — protégée par triggers DB, résolution cohérente, pas de double vérité. Le seul risque est le détachement sans avertissement (P1-2).

### 4. Les alertes rupture / sous-seuil sont-elles fiables après agrégation ?

**🔴 Non** — les alertes stock ignorent l'agrégation article (C2). Un article OK peut générer des alertes "Rupture" individuelles sur ses sous-produits.

### 5. La séparation desktop/mobile est-elle cohérente ?

**✅ Oui** — mobile compte par produit, desktop affiche agrégé. Les deux convergent vers les mêmes `inventory_lines` et `zone_stock_snapshots`. Aucun conflit.

### 6. Y a-t-il un risque que les articles liés cassent plus tard ?

- **Commandes :** ✅ Non — indépendantes
- **DLC :** ✅ Non — opère par produit/lot
- **Facture :** ✅ Non — snapshots produit, pas article

### 7. Peut-on considérer le module Inventaire comme clean pour la V0 élargie ?

**GO CONDITIONNEL** — après correction de P0-1 (alertes article-aware), P0-2 (typage), et P0-3 (liaison transactionnelle). Le reste peut suivre en P1.
