# 🔍 AUDIT HARD — Étape "Article inventaire" du Wizard Produit

> **Date** : 2026-03-06  
> **Périmètre** : Table `inventory_articles`, Wizard Step 7, StockEngine, alertes, commandes, prix, B2B  
> **Règle** : Audit seulement. Aucune modification.

---

## VERDICT : 🟡 STRUCTURELLEMENT PRÉPARÉ, OPÉRATIONNELLEMENT DÉCONNECTÉ

L'article inventaire existe en base, dans le wizard, dans le moteur pur. Mais **il n'est branché sur aucun flux opérationnel critique** (alertes, commandes, inventaire physique, DLC). Son effet réel est aujourd'hui **cosmétique / structurel uniquement**.

---

## SECTION 1 — Rôle réel de l'article inventaire aujourd'hui

### Ce qui EXISTE

| Composant | Fichier | Statut |
|-----------|---------|--------|
| Table DB `inventory_articles` | Migration existante | ✅ Créée |
| FK `products_v2.inventory_article_id` | Migration existante | ✅ Nullable, présente |
| Colonne `stock_events.inventory_article_id` | Migration existante (Agent 02) | ✅ Ajoutée |
| Hook CRUD articles | `useInventoryArticles.ts` | ✅ Fonctionnel |
| Fuzzy matching | `useArticleMatching.ts` | ✅ Trigram + canonical_family guard |
| Wizard Step 7 (create/link) | `WizardStep7Article.tsx` | ✅ Fonctionnel |
| Page liste articles | `ArticleListView.tsx` | ✅ UI complète |
| Page détail article | `ArticleDetailView.tsx` | ✅ Lier/détacher produits |
| Stock par article (somme events) | `useArticleStock.ts` | ✅ Somme deltas |
| StockEngine `getEstimatedStockByArticle()` | `stockEngine.ts:222` | ✅ Fonction pure testée |
| Tests unitaires article | `stockEngine.test.ts` | ✅ 5+ tests couverts |

### Ce qui N'EXISTE PAS (déconnexions critiques)

| Flux opérationnel | Utilise `inventory_article_id` ? | Constat |
|-------------------|----------------------------------|---------|
| **Alertes stock (`useStockAlerts`)** | ❌ NON | Raisonne 100% au niveau `product_id` |
| **Inventaire physique (`inventory_lines`)** | ❌ NON | Ligne = produit, pas article |
| **Comptage (`CountingModal`)** | ❌ NON | Produit par produit |
| **Commandes (`commande_lines`)** | ❌ NON (correct) | Reste au produit fournisseur |
| **Achats (`purchase_line_items`)** | ❌ NON (correct) | Reste au produit fournisseur |
| **BL App (`bl_app_lines`)** | ❌ NON (correct) | Reste au produit fournisseur |
| **Edge function `stock-ledger`** | ❌ NON | N'écrit pas `inventory_article_id` sur les events |
| **DLC critique** | ❌ NON | Par produit |
| **Disponibilité commande B2B** | ❌ NON | Par produit |

---

## SECTION 2 — Analyse des 6 questions clés

### Q1 : Quel est le rôle exact de l'article inventaire aujourd'hui ?

**Réponse : Entité de regroupement structurel, sans effet opérationnel.**

L'article inventaire permet :
- De **créer un lien logique** entre N produits fournisseur via `products_v2.inventory_article_id`
- D'**afficher** un stock agrégé dans la page Articles (`useArticleStock`)
- De **lier/détacher** des produits dans `ArticleDetailView`

Il ne permet PAS :
- De modifier le calcul des alertes
- D'impacter l'inventaire physique
- De changer le flux stock réel

### Q2 : Qu'est-ce qui pointe dessus réellement ?

| Source | Pointeur | Usage |
|--------|----------|-------|
| `products_v2.inventory_article_id` | FK nullable | Lien produit → article |
| `stock_events.inventory_article_id` | FK nullable | **Prévu mais non alimenté par les edge functions** |
| `useArticleStock` | Query directe | Somme des deltas (si events existent) |
| `getEstimatedStockByArticle` | Fonction pure | **Disponible mais jamais appelée dans les flux réels** |

### Q3 : Le stock est-il agrégé par article inventaire ?

**Réponse : NON.**

Le stock opérationnel (StockEngine principal) est calculé à 100% au niveau `product_id` :
- `getEstimatedStock()` prend un `product_id`
- `getEstimatedStockBatch()` itère sur des `product_id`
- `useStockAlerts` passe des `product_id`
- L'inventaire physique (`inventory_lines`) stocke des `product_id`

La fonction `getEstimatedStockByArticle()` existe dans le moteur mais :
- **N'est appelée nulle part** dans les flux réels (alertes, inventaire, commandes)
- Est uniquement appelée par `useArticleStock` pour **l'affichage** dans la page Articles
- Les `stock_events` n'ont **pas de `inventory_article_id` rempli** car l'edge function `stock-ledger` ne le fait pas

**⚠️ Le hook `useArticleStock` fait une somme directe des deltas sans snapshot de référence — c'est une approximation, pas le vrai StockEngine.**

### Q4 : Les alertes stock/DLC utilisent-elles l'article inventaire ?

**Réponse : NON. Zéro utilisation.**

**Alertes stock** (`useStockAlerts.ts`) :
- Charge `products_v2` individuellement
- Compare `estimated_quantity` (par produit) vs `min_stock_quantity_canonical` (par produit)
- Ne regarde jamais `inventory_article_id`
- **Conséquence directe** : Si Lasagne Rummo = 0 et Lasagne Molisana = 6, l'alerte dit "Rummo en rupture" même si l'article logique "Lasagne" = 6.

**DLC critique** (`DlcCritiquePage`, `DlcAlertPage`) :
- Fonctionne par produit individuel
- Aucune agrégation article

**Disponibilité commande** :
- Vérifie le stock par `product_id`
- Aucune notion d'article

### Q5 : Les commandes/prix/factures restent-elles au niveau produit fournisseur ?

**Réponse : OUI. C'est correct et doit rester ainsi.**

| Flux | Clé | Correct ? |
|------|-----|-----------|
| Commandes (`commande_lines`) | `product_id` → `products_v2` | ✅ |
| Achats (`purchase_line_items`) | `product_id` → `products_v2` | ✅ |
| BL (`bl_app_lines`) | `product_id` → `products_v2` | ✅ |
| Factures (`invoice_line_items`) | `product_id` → fournisseur | ✅ |
| Prix | `products_v2.final_unit_price` | ✅ Par produit |
| B2B import | `b2b_imported_products` | ✅ Mapping individuel |

**Aucun risque de fusion prix/commande/facture au niveau article. La séparation est propre.**

### Q6 : L'étape corrige-t-elle les fausses ruptures ?

**Réponse : NON. L'étape est cosmétique aujourd'hui.**

Le wizard Step 7 permet de :
1. Créer un article inventaire
2. Lier un produit à un article existant

Mais :
- Les alertes ne consultent pas l'article → **les fausses ruptures persistent**
- Le stock opérationnel reste par produit → **pas d'agrégation réelle**
- L'inventaire physique reste par produit → **pas de comptage groupé**

**L'étape structure la donnée (bonne intention) mais ne produit aucun effet métier concret.**

---

## SECTION 3 — Risques et incohérences détectés

### 🔴 RISQUE CRITIQUE 1 : `useArticleStock` ne respecte pas le StockEngine

**Fichier** : `src/modules/inventaire/hooks/useArticleStock.ts`

Ce hook fait :
```
stock = Σ(stock_events.delta_quantity_canonical WHERE inventory_article_id = X)
```

Problèmes :
1. **Ignore le snapshot de référence** — le vrai StockEngine fait `Snapshot + Σ(Events)`, pas `Σ(Events)` seul
2. **Pas de filtre `snapshot_version_id`** — somme TOUS les events de tous les temps
3. **Pas de filtre `storage_zone_id`** — somme cross-zone
4. **`inventory_article_id` n'est jamais rempli** sur les events (l'edge function ne le fait pas)

**Résultat** : Le stock affiché dans la page Articles est probablement **toujours 0** ou **incorrect**.

### 🔴 RISQUE CRITIQUE 2 : Pipeline d'écriture incomplet

L'Agent 02 (docs) prévoit d'écrire `inventory_article_id` sur `stock_events` lors du posting. Mais :
- L'edge function `stock-ledger` ne le fait **pas encore**
- La colonne existe en DB mais reste **NULL** partout
- `getEstimatedStockByArticle()` filtre sur cette colonne → **résultats toujours vides**

### 🟡 RISQUE MOYEN 3 : Double vérité potentielle stock

Si un jour les alertes sont branchées sur l'article inventaire :
- Le `min_stock` est défini **à la fois** sur `inventory_articles` ET sur `products_v2`
- Lequel utilise-t-on ? → **Conflit de SSOT**
- Aujourd'hui les alertes utilisent `products_v2.min_stock_quantity_canonical` → OK
- Mais l'article a aussi `min_stock_quantity_canonical` → risque de divergence

### 🟡 RISQUE MOYEN 4 : Pas de garde canonical_family au link

`ArticleDetailView` permet de lier **n'importe quel produit** à un article (dialog "Ajouter produit fournisseur"). 

Le wizard Step 7 a un garde canonical_family (via `useArticleMatching`), mais le lien direct dans `ArticleDetailView` **ne vérifie pas** que le produit partage la même famille canonique que l'article.

**Risque** : Un produit en "pièce" lié à un article en "kg" → incohérence future.

### 🟢 POINT SOLIDE : Séparation achat/inventaire

La frontière entre produit fournisseur (achat/commande/prix/facture) et article inventaire (stock opérationnel/alertes) est **proprement définie en intention**. Les flux transactionnels ne touchent jamais `inventory_article_id`. C'est correct.

---

## SECTION 4 — Cartographie des sources de vérité

| Domaine | SSOT actuelle | Article inventaire utilisé ? |
|---------|---------------|------------------------------|
| Stock estimé | `StockEngine(product_id)` | ❌ Non |
| Alertes rupture | `products_v2.min_stock_quantity_canonical` | ❌ Non |
| Alertes DLC | `products_v2` + events DLC | ❌ Non |
| Inventaire physique | `inventory_lines.product_id` | ❌ Non |
| Commande quantité | `commande_lines.canonical_quantity` | ❌ Non (correct) |
| Prix fournisseur | `products_v2.final_unit_price` | ❌ Non (correct) |
| Facture | `invoice_line_items.product_id` | ❌ Non (correct) |
| Stock affiché article | `useArticleStock` (Σ brute events) | ⚠️ Approximation incorrecte |
| Zone de stockage | `products_v2.storage_zone_id` | ❌ Non |

---

## SECTION 5 — Audit technique fichiers

| Fichier | Lignes | Rôle | Criticité | Problème |
|---------|--------|------|-----------|----------|
| `useArticleStock.ts` | 81 | Stock par article | 🔴 | Calcul incorrect (pas de snapshot, pas de filtre zone/version) |
| `useInventoryArticles.ts` | 75 | CRUD articles | 🟢 | OK, `as any` justifié (types pas générés) |
| `useArticleMatching.ts` | 91 | Fuzzy matching | 🟢 | Propre, garde canonical_family |
| `WizardStep7Article.tsx` | ~240 | UI wizard | 🟢 | Fonctionnel |
| `ArticleDetailView.tsx` | 425 | Détail + lier/délier | 🟡 | Pas de garde canonical_family au lien |
| `ArticleListView.tsx` | 216 | Liste articles | 🟢 | OK |
| `stockEngine.ts` (article fn) | 50 | Agrégation pure | 🟢 | Correct mais jamais appelé en réel |
| `useStockAlerts.ts` | 423 | Alertes stock | 🟢 | Correct (par produit), mais ne connaît pas les articles |

---

## SECTION 6 — Recommandations

### Architecture cible recommandée

```
┌─────────────────────────────────────────────────┐
│                 ARTICLE INVENTAIRE              │
│     (regroupement logique, stock opérationnel)  │
│                                                 │
│  ✅ Stock agrégé = Σ(stocks produits liés)      │
│  ✅ Alertes rupture = stock agrégé vs min_stock │
│  ✅ DLC globale = min(DLC produits liés)        │
│  ✅ Disponibilité = stock agrégé > 0            │
└────────────┬────────────────────────────────────┘
             │ 1:N
┌────────────┴────────────────────────────────────┐
│              PRODUIT FOURNISSEUR                │
│     (achat, commande, prix, facture, B2B)       │
│                                                 │
│  ✅ Prix individuel                             │
│  ✅ Commande individuelle                       │
│  ✅ Facture individuelle                        │
│  ✅ Fournisseur distinct                        │
│  ✅ BL individuel                               │
│  ✅ Retour/litige individuel                    │
└─────────────────────────────────────────────────┘
```

### Priorités P0 / P1 / P2

#### P0 — Bloquants (à corriger avant d'activer l'article pour les alertes)

| # | Problème | Impact | Recommandation |
|---|----------|--------|----------------|
| P0-1 | `useArticleStock` calcule mal le stock (pas de snapshot, pas de filtre) | Stock affiché faux dans la page Articles | Réécrire pour utiliser `getEstimatedStockByArticle()` avec snapshot + events filtrés, OU calculer stock article = Σ(stocks produits liés via StockEngine existant) |
| P0-2 | Edge function `stock-ledger` n'écrit pas `inventory_article_id` sur les events | La colonne reste NULL → agrégation article impossible | Implémenter Agent 02 : resolve `inventory_article_id` depuis `products_v2` lors du posting |
| P0-3 | Double `min_stock` (article + produit) sans règle de priorité | Quelle valeur utilise l'alerte ? | Décider : si article existe → `min_stock` article est SSOT. Si pas d'article → `min_stock` produit. Documenter et implémenter. |

#### P1 — À corriger rapidement

| # | Problème | Impact | Recommandation |
|---|----------|--------|----------------|
| P1-1 | `ArticleDetailView` ne vérifie pas `canonical_family` au lien | Produit kg lié à article pièce → incohérence | Ajouter garde : même canonical_family obligatoire |
| P1-2 | Alertes stock (`useStockAlerts`) ignorent l'article | Fausses ruptures si 2 produits = 1 article | Ajouter mode "article" : si produit a `inventory_article_id`, agréger au niveau article pour le calcul d'alerte |
| P1-3 | Backfill `inventory_article_id` sur events existants | Events historiques sans article | Script SQL de backfill (comme prévu Agent 02) |

#### P2 — Acceptable pour V0

| # | Problème | Impact | Recommandation |
|---|----------|--------|----------------|
| P2-1 | Inventaire physique reste par produit | Le comptage n'est pas groupé | Acceptable — on compte chaque produit physiquement, l'agrégation est logique |
| P2-2 | DLC non agrégée par article | Alertes DLC par produit, pas par article | Acceptable pour V0, amélioration future |
| P2-3 | Disponibilité commande B2B par produit | Pas de notion "article dispo" cross-fournisseur | Acceptable — la commande est par produit fournisseur |

---

## SECTION 7 — Réponses aux questions structurantes

### L'étape wizard a-t-elle un vrai effet métier ?

**Aujourd'hui : NON.** Elle crée la donnée structurelle (`inventory_article_id` sur `products_v2`) mais rien ne la consomme opérationnellement. C'est un investissement de structure pour un bénéfice futur.

### Faut-il garder, recadrer ou revoir ?

**GARDER L'ÉTAPE, mais la rendre opérationnelle en branchant :**
1. L'écriture `inventory_article_id` sur les events (Agent 02)
2. Les alertes stock en mode article
3. Un calcul de stock article correct (via StockEngine, pas une somme brute)

### La séparation produit/article est-elle bonne ?

**OUI.** La frontière est saine :
- Produit fournisseur = vérité achat/prix/commande/facture ✅
- Article inventaire = vérité stock opérationnel/alertes ✅

Le problème n'est pas l'architecture, c'est que **l'article n'est pas encore branché sur les consommateurs**.

### Y a-t-il un risque pour la future facture ?

**NON.** La facture doit rester au niveau produit fournisseur (prix, quantité, fournisseur). L'article inventaire n'a aucune raison d'interférer avec la facture. La séparation est correcte.

---

## CONCLUSION

| Dimension | Score |
|-----------|-------|
| Intention métier | ✅ 10/10 — Bonne logique de regroupement |
| Structure données | ✅ 8/10 — Tables, FK, types en place |
| Wizard UX | ✅ 8/10 — Create/link avec fuzzy matching |
| Effet opérationnel | ❌ 2/10 — Aucun flux réel ne consomme l'article |
| Stock calculation | ❌ 3/10 — `useArticleStock` incorrect, edge function non branchée |
| Alertes | ❌ 0/10 — Zéro utilisation de l'article |
| Risque facture | ✅ 10/10 — Aucun risque, séparation correcte |
| Risque B2B | ✅ 10/10 — Aucune interférence |

**L'article inventaire est un bon concept métier, correctement séparé du produit fournisseur, mais aujourd'hui c'est une coquille vide : la structure existe sans effet opérationnel. Les 3 P0 doivent être corrigés pour que l'étape ait un vrai impact.**
