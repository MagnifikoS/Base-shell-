# Analyse de risques — Suppression liaison inter-produits inventaire

> **Date :** 2026-03-06 | **Statut :** Audit pré-décision, aucun code modifié

---

## 1. VERDICT GLOBAL

### ✅ RISQUE RÉEL : FAIBLE — La stratégie est viable

La feature article inventaire est **purement additive en lecture**. Elle n'a **jamais modifié** le pipeline natif de stock (Snapshot + ΣEvents). Le retrait est faisable avec un risque quasi nul **SI** on respecte l'ordre des phases proposé.

---

## 2. CARTOGRAPHIE EXACTE DES POINTS TOUCHÉS (11 fichiers actifs + 2 config)

### A. Écriture (Wizard — 2 points d'appel)

| Fichier | Lignes | Ce qui se passe | Risque retrait |
|---------|--------|-----------------|----------------|
| `ProductFormV3Modal.tsx` L.457-458 | `persistInventoryArticle(productId!)` | Appel après **edit** produit | **FAIBLE** — l'appel est post-save, sa suppression ne touche pas le save principal |
| `ProductFormV3Modal.tsx` L.619-620 | `persistInventoryArticle(result.product.id)` | Appel après **create** produit | **FAIBLE** — idem, post-save |
| `ProductFormV3Modal.tsx` L.243-276 | Fonction `persistInventoryArticle` | Crée ou lie un article | **FAIBLE** — fonction isolée, pas de side-effect sur le produit lui-même |

**Verdict écriture :** Les 2 appels `persistInventoryArticle` sont des **post-hooks optionnels**. Ils s'exécutent APRÈS le save RPC principal (`fn_save_product_wizard`). Les retirer ne change **rien** au flux create/edit du produit. Le `update({ inventory_article_id })` L.270-273 est un write isolé qui n'affecte aucun autre champ.

### B. UI Wizard — Step 7

| Fichier | Rôle | Risque retrait |
|---------|------|----------------|
| `WizardStep7Article.tsx` | Étape 7 complète | **MOYEN** — nécessite renumération step 8→7 |
| `types.ts` L.106-108 | `inventoryArticleId`, `inventoryArticleMode` | **FAIBLE** — champs isolés dans le state |
| `useWizardState.ts` L.92 | `Math.min(prev.currentStep + 1, 8)` | **MOYEN** — le `8` doit devenir `7` |

### C. Lecture Inventaire Desktop (2 fichiers)

| Fichier | Ce qui se passe | Risque retrait |
|---------|-----------------|----------------|
| `DesktopInventoryView.tsx` L.200 | `useArticleGrouping(displayProducts, estimatedStock)` | **FAIBLE** — si on ne l'appelle plus, les produits passent tous en standalone |
| `ProductStockTable.tsx` L.291-380 | Rendu conditionnel `article-parent` / `article-child` | **FAIBLE** — le mode standalone existe déjà et fonctionne |

### D. Pages / Navigation dédiées (3 fichiers)

| Fichier | Risque retrait |
|---------|----------------|
| `InventoryArticlesPage.tsx` | **NUL** — page autonome |
| `ArticleListView.tsx` | **NUL** — composant de la page |
| `ArticleDetailView.tsx` | **NUL** — composant de la page |
| `CreateArticleDialog.tsx` | **NUL** — composant de la page |
| `navRegistry.ts` L.643-647 | **NUL** — entrée de nav isolée |
| `AppRoutes.tsx` L.606-613 | **NUL** — route isolée |

### E. Hooks inventaire (4 fichiers)

| Fichier | Consommateurs | Risque retrait |
|---------|---------------|----------------|
| `useArticleGrouping.ts` | `DesktopInventoryView` uniquement | **FAIBLE** |
| `useInventoryArticles.ts` | `WizardStep7Article`, `CreateArticleDialog`, `InventoryArticlesPage` | **FAIBLE** |
| `useArticleStock.ts` | `InventoryArticlesPage` uniquement | **NUL** |
| `useProductsForArticleLinking.ts` | `CreateArticleDialog` uniquement | **NUL** |
| `useArticleMatching.ts` | `WizardStep7Article` uniquement | **NUL** |

### F. Stock Engine

| Fichier | Ce qui se passe | Risque retrait |
|---------|-----------------|----------------|
| `stockEngine.ts` — `getEstimatedStockByArticle()` | Fonction **jamais appelée en runtime** (seulement testée) | **NUL** |
| `stockEngine.ts` — `getEstimatedStock()` | Fonction native — **PAS TOUCHÉE** | N/A |

### G. Exports barrel (`inventaire/index.ts`)

12 exports liés aux articles à retirer. **Risque NUL** — aucun module externe n'importe ces exports sauf le wizard Step 7.

---

## 3. ANALYSE DES RISQUES SPÉCIFIQUES

### 🟢 RISQUE 1 : Casser le save produit (Create/Edit)

**Probabilité : QUASI NULLE**

`persistInventoryArticle` est appelé **après** le `fn_save_product_wizard` RPC qui est le vrai save atomique. Le retirer revient à retirer un post-hook optionnel. Le produit sera créé/édité normalement.

**Preuve :** L.457-458 et L.619-620 — l'appel est dans un bloc séquentiel post-save, pas dans le try/catch principal du RPC.

### 🟡 RISQUE 2 : Casser la navigation du Wizard (renumération steps)

**Probabilité : MODÉRÉ si mal fait**

Le wizard a 8 étapes. Step 7 = Article. Step 8 = Résumé. Si on retire Step 7 :
- `goNext()` utilise `Math.min(prev.currentStep + 1, 8)` → doit devenir `7`
- La progress bar affiche `[1,2,3,4,5,6,7,8]` → doit devenir `[1..7]`
- Les `stepLabels` doivent être réajustés
- Le résumé (`WizardStep5` = step 8) doit devenir step 7

**Mitigation Phase A :** Ne PAS retirer Step 7 d'abord. Rendre son contenu inerte (skip automatique ou contenu vide). Ça évite la renumération.

**Mitigation Phase D :** Retirer Step 7 + renumération APRÈS avoir validé que le système tourne sans.

### 🟢 RISQUE 3 : Casser l'affichage inventaire desktop

**Probabilité : QUASI NULLE**

`useArticleGrouping` a un garde-fou natif (L.117-119) :
```typescript
if (articleMap.size === 0) {
  return products.map((p) => ({ type: "standalone" as const, product: p }));
}
```

Si aucun article n'existe ou si le hook n'est plus appelé, **tous les produits deviennent standalone**. C'est exactement le comportement souhaité.

**Mieux encore :** `ProductStockTable` a déjà le rendering standalone complet. La branche `useGrouped ? groupedItems.map(...)` a un fallback natif.

### 🟢 RISQUE 4 : Casser le stock natif

**Probabilité : NULLE**

Le pipeline natif `getEstimatedStock()` n'a **jamais** été modifié par la feature article. `getEstimatedStockByArticle()` est une fonction séparée jamais appelée en runtime (seulement dans les tests). Le retrait n'affecte pas le moteur.

### 🟢 RISQUE 5 : Casser les alertes stock

**Probabilité : NULLE**

`useStockAlerts` fonctionne déjà **exclusivement au niveau produit**. L'audit précédent a noté que c'était un P0 (les alertes ignorent les articles). Ici, c'est un avantage : les alertes n'ont jamais changé, donc le retrait ne les affecte pas.

### 🟢 RISQUE 6 : Casser les sessions d'inventaire

**Probabilité : NULLE**

Les sessions comptent **par produit**. `inventory_lines` référence `product_id`, jamais `inventory_article_id`. Aucun changement nécessaire.

### 🟢 RISQUE 7 : Casser les commandes / DLC / B2B / Facture

**Probabilité : NULLE**

Aucun de ces modules n'importe ou ne référence quoi que ce soit lié aux articles inventaire. Vérification :
- `commandes` → zéro référence à `inventory_article`
- `congesAbsences` → N/A
- `factures` → zéro référence
- `B2B` → zéro référence

### 🟡 RISQUE 8 : Données orphelines post-suppression

**Probabilité : CERTAINE mais impact NUL**

Des produits ont possiblement `inventory_article_id` non-null. Des articles existent dans `inventory_articles`. Après retrait du runtime :
- Ces données restent en DB mais ne sont plus lues
- Aucun comportement fantôme possible car plus aucun lecteur
- Le `SET NULL` sur `inventory_article_id` peut être fait en Phase F sans urgence

---

## 4. MATRICE DE RISQUE PAR PHASE

| Phase | Action | Risque | Réversibilité |
|-------|--------|--------|---------------|
| **A** | Rendre `persistInventoryArticle` inerte (return early) | 🟢 Nul | 100% réversible |
| **A** | Rendre `useArticleGrouping` inerte (return all standalone) | 🟢 Nul | 100% réversible |
| **B** | Masquer Step 7 (skip auto dans goNext) | 🟡 Faible | 100% réversible |
| **B** | Retirer la nav `/inventaire/articles` | 🟢 Nul | 100% réversible |
| **C** | Tests de non-régression | N/A | N/A |
| **D** | Supprimer `WizardStep7Article.tsx` + renumération | 🟡 Moyen | Réversible via git |
| **D** | Supprimer pages/composants articles | 🟢 Nul | Réversible via git |
| **E** | Supprimer hooks articles + exports | 🟢 Nul | Réversible via git |
| **F** | `SET NULL` sur `inventory_article_id` | 🟡 Faible | Non réversible facilement |
| **G** | Gel DB / suppression table | 🟡 Moyen | Non réversible |

---

## 5. LE VRAI POINT DE VIGILANCE

### Le wizard est le seul endroit délicat

Tout le reste (inventaire, stock, alertes, sessions, modules) est soit :
- Non impacté du tout
- Protégé par des garde-fous existants (fallback standalone)

Le **seul** endroit où il faut être chirurgical, c'est le wizard :

1. **`persistInventoryArticle`** — 1 callback, 3 lignes d'appel → faire un `return` early
2. **Step 7 rendering** — 1 bloc `currentStep === 7` → skip ou masquer
3. **Renumération** — `totalSteps: 8 → 7`, stepLabels, progress bar → Phase D uniquement

**Si on fait Phase A correctement (neutralisation sans retrait), le wizard ne change PAS de structure.** Il continue à avoir 8 étapes, mais Step 7 ne fait plus rien. C'est la clé de la sécurité.

---

## 6. RÉPONSES AUX QUESTIONS DE VIGILANCE

> **Si on retire la logique article du runtime, le stock natif redevient-il sain ?**

✅ OUI. Le stock natif n'a **jamais cessé d'être sain**. La couche article était une vue de lecture additionnelle. Le pipeline `Snapshot + ΣEvents` est intact.

> **Quels points dépendent encore de `inventory_article_id` pour afficher/calculer ?**

- `useArticleGrouping` (lecture desktop) — seul point de calcul
- `ProductStockTable` (rendu conditionnel) — seul point d'affichage
- Tous deux ont un fallback standalone natif

> **Peut-on supprimer Step 7 sans casser le wizard ?**

✅ OUI, mais en 2 temps :
1. Phase A : neutraliser (le step existe mais ne fait rien)
2. Phase D : retirer + renumération

> **Faut-il d'abord masquer l'UI, puis couper la lecture, puis l'écriture ?**

La stratégie proposée est correcte. L'ordre recommandé :
1. Couper l'écriture (`persistInventoryArticle` → return early)
2. Couper la lecture (`useArticleGrouping` → return all standalone)
3. Masquer Step 7 du wizard
4. Retirer la nav/pages articles
5. Nettoyer

> **Que faire des données existantes ?**

Gel en DB. `SET NULL` sur `inventory_article_id` en Phase F. Garder la table `inventory_articles` gelée pour un éventuel futur module isolé.

> **Quelle est la façon la plus sûre ?**

Phase A (neutralisation) est **la seule phase critique**. Elle consiste en 3 modifications mineures :
1. `persistInventoryArticle` → `return;` en première ligne
2. `useArticleGrouping` → forcer le retour standalone
3. Vérifier que tout tourne

Tout le reste est du nettoyage post-stabilisation.

---

## 7. RECOMMANDATION FINALE

### ✅ GO — Risque réel évalué à FAIBLE

**Justification :**
- La feature est **purement additive en lecture** — elle n'a jamais modifié le pipeline de stock
- Tous les garde-fous standalone existent déjà dans le code
- L'écriture (`persistInventoryArticle`) est un post-hook isolé, jamais atomique avec le save produit
- Aucun module externe ne dépend de cette feature
- La stratégie en phases A→G est correcte et chaque phase est réversible

**Le seul point d'attention réel est la renumération du wizard (Phase D), qui doit être testée soigneusement.**

### Effort estimé

| Phase | Effort | Fichiers |
|-------|--------|----------|
| A (neutralisation) | ~30 min | 2 fichiers (3 lignes chacun) |
| B (blocage entrées) | ~20 min | 2 fichiers |
| C (validation) | ~1h | Tests manuels |
| D (retrait UI) | ~1h | 5-6 fichiers |
| E (nettoyage code) | ~45 min | 8-10 fichiers |
| F (neutralisation DB) | ~15 min | 1 migration |
| G (gel) | 0 | Rien à faire |

**Total : ~3h30 de travail structuré, sans précipitation.**
