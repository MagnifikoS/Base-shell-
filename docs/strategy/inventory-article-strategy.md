# Stratégie Cible — Article Inventaire & Regroupement Opérationnel

> **Statut : VALIDÉ — Mode "à la demande"**
> Date : 2026-03-06 | Corrigé : 2026-03-06 (seuil V0 = produit porteur, 4 verrous UX/DB, **PAS de migration 1:1**)
>
> **Règle fondamentale :** `inventory_article_id` reste NULL par défaut. Aucun article inventaire n'est créé automatiquement. Seul l'utilisateur décide de regrouper des produits sous un article via le wizard.

---

## 1. État des lieux — Résultat d'audit

### 1.1 Ce qui EXISTE dans le code

| Élément | Fichier | État |
|---------|---------|------|
| Type `InventoryArticle` | `src/modules/inventaire/types/inventoryArticle.ts` | ✅ Défini |
| Hook `useInventoryArticles` | `src/modules/inventaire/hooks/useInventoryArticles.ts` | ⚠️ Utilise `(supabase as any)` — table inexistante |
| Hook `useArticleStock` | `src/modules/inventaire/hooks/useArticleStock.ts` | ❌ **Non fonctionnel** — somme brute des deltas sans Snapshot |
| Composant `ArticleListView` | `src/modules/inventaire/components/ArticleListView.tsx` | ✅ UI prête |
| Composant `ArticleDetailView` | `src/modules/inventaire/components/ArticleDetailView.tsx` | ✅ UI prête (lie/délie produits) |
| Fonction pure `getEstimatedStockByArticle` | `src/modules/stockLedger/engine/stockEngine.ts` | ✅ Logique pure prête + tests |
| Type `ArticleStockEvent` dans stockLedger | `src/modules/stockLedger/types.ts` | ✅ `inventory_article_id` optionnel |
| Page `InventoryArticlesPage` | Exportée dans `index.ts` | ✅ Accessible |

### 1.2 Ce qui N'EXISTE PAS en base

| Élément | État |
|---------|------|
| **Table `inventory_articles`** | ❌ **N'existe pas en DB** |
| **Colonne `products_v2.inventory_article_id`** | ❌ **N'existe pas en DB** |
| **Colonne `stock_events.inventory_article_id`** | ❌ **N'existe pas en DB** |
| Edge function `stock-ledger` → alimentation `inventory_article_id` | ❌ Non implémenté |
| RLS sur `inventory_articles` | ❌ Inexistant |

### 1.3 Résumé

**L'article inventaire est aujourd'hui 100% fantôme.** Le code frontend référence une table et des colonnes qui n'existent pas. Tout fonctionne via des `(supabase as any)` qui échouent silencieusement. Aucun stock n'est réellement calculé au niveau article.

---

## 2. Règle métier cible

### 2.1 Séparation Produit Fournisseur / Article Inventaire

```
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│      PRODUIT FOURNISSEUR        │     │       ARTICLE INVENTAIRE        │
│  (products_v2)                  │     │  (inventory_articles)           │
│                                 │     │                                 │
│  SSOT pour :                    │     │  SSOT pour :                    │
│  ✅ Achat                       │     │  ✅ Nom affiché en inventaire   │
│  ✅ Prix                        │     │  ✅ Stock agrégé opérationnel   │
│  ✅ Commande B2B                │     │  ✅ Alerte rupture (via produit │
│  ✅ Facture                     │     │     porteur du seuil)           │
│  ✅ Litige / Retour             │     │  ✅ Zone de stockage            │
│  ✅ Identité fournisseur        │     │  ✅ Disponibilité opérationnelle│
│  ✅ Code produit / Réf          │     │  ✅ Produit porteur du seuil    │
│  ✅ Conditionnement             │     │     (threshold_product_id)      │
│  ✅ nom_produit (nom catalogue) │     │                                 │
│  ✅ min_stock (seuil unique)    │     │  N'impacte JAMAIS :             │
│                                 │     │  ❌ Prix                        │
│  N-to-1 → inventory_article_id  │     │  ❌ Commande                    │
└─────────────────────────────────┘     │  ❌ Facture                     │
                                        │  ❌ B2B                         │
                                        │  ❌ nom_produit fournisseur     │
                                        │  ❌ Seuil stock (pas en V0)     │
                                        └─────────────────────────────────┘
```

### 2.2 Exemple concret

| Produit fournisseur | Article inventaire | Stock agrégé |
|--------------------|--------------------|--------------|
| Lasagne Rummo (Fournisseur A) | **Lasagne** | 15 kg total |
| Lasagne Molisana (Fournisseur B) | **Lasagne** | (agrégé) |
| Huile olive Puget (Fournisseur A) | **Huile d'olive** | 8 L total |
| Huile olive Terra Delyssa (Fournisseur C) | **Huile d'olive** | (agrégé) |

- Quand on commande → on commande "Lasagne Rummo" à Fournisseur A
- Quand on facture → on facture "Lasagne Rummo" au prix figé
- Quand on regarde le stock → on voit "Lasagne : 15 kg"

### 2.3 Source de vérité du nom affiché

| Contexte | Nom affiché | Source |
|----------|-------------|--------|
| **Inventaire physique** | Nom de l'article inventaire | `inventory_articles.name` |
| **Liste stock opérationnel** | Nom de l'article inventaire | `inventory_articles.name` |
| **Alerte rupture** | Nom de l'article inventaire | `inventory_articles.name` |
| Commande B2B | Nom produit fournisseur | `products_v2.nom_produit` |
| Facture | Nom produit fournisseur (snapshot) | `product_name_snapshot` |
| Catalogue fournisseur | Nom produit fournisseur | `products_v2.nom_produit` |
| Analyse achat | Nom produit fournisseur | `products_v2.nom_produit` |

---

## 3. Risques identifiés et garde-fous

### 3.1 ✅ Règle V0 : Seuil porté par un produit (pas de seuil article)

**Décision V0 — Validée :**

Le seuil mini-stock **ne vit PAS** sur l'article inventaire. Il reste **exclusivement** sur `products_v2.min_stock_quantity_canonical`.

Quand un article regroupe plusieurs produits, l'article désigne un **produit porteur du seuil** via `inventory_articles.threshold_product_id`.

**Règle de résolution :**
```
si article lié :
    seuil effectif = seuil du produit porteur (threshold_product_id)
sinon :
    seuil effectif = seuil du produit lui-même
```

**Avantages :**
- Zéro nouvelle source de vérité seuil
- Même chemin de modification (on modifie le seuil du produit porteur)
- Zéro sync entre 2 seuils
- Les 27 fichiers qui utilisent `min_stock_quantity_canonical` ne cassent pas

**Garde-fou :** Fonction pure `getEffectiveMinStock(product, article | null, thresholdProduct | null)`.

**Interdit en V0 :**
- ❌ `inventory_articles.min_stock_quantity_canonical` → ne pas créer cette colonne
- ❌ `inventory_articles.min_stock_unit_id` → ne pas créer cette colonne
- ❌ Logique "article prime sur produit" pour le seuil
- ❌ Sync / recalcul entre seuil article et seuil produit

### 3.2 ❌ Incohérence de famille canonique

**Problème :** Si on lie "Lasagne Rummo (kg)" et "Lasagne Molisana (pce)" au même article, l'agrégation est impossible.

**Règle cible :**
> Un article inventaire a UNE famille canonique fixe (`weight`, `volume`, `count`).
> Seuls les produits de la même famille canonique peuvent être liés.
> Le lien est **refusé** si la famille du produit ne correspond pas.

**Garde-fou :** Validation au moment du `link` (UI + trigger DB).

### 3.3 ❌ Inventaire existant cassé

**Problème :** L'inventaire actuel (`inventory_sessions` + `inventory_lines`) fonctionne par `product_id`. Si on passe à `inventory_article_id`, toutes les sessions historiques deviennent incohérentes.

**Règle cible :**
> L'inventaire physique continue de compter par **produit fournisseur**.
> L'**affichage** regroupe par article, mais la **saisie** reste par produit.
> Le stock agrégé est calculé APRÈS, en sommant les produits liés.

**Garde-fou :** Zéro changement dans `inventory_lines`. Le regroupement est un **calcul de lecture**, pas un changement de structure.

### 3.4 ❌ Mauvais produit lié à un article incohérent

**Problème :** Un utilisateur lie "Sel fin" à l'article "Lasagne" par erreur.

**Garde-fous :**
1. Suggestion automatique par nom normalisé (`useArticleMatching.ts` existe déjà)
2. Confirmation visuelle avec le nom du produit + nom de l'article
3. Action réversible (détacher est toujours possible)
4. Pas de validation automatique — le lien est une décision métier humaine

### 3.5 ✅ Pas de conflit avec la Facture App

**Confirmation :** La Facture App utilise exclusivement :
- `commande_lines.product_id` → `products_v2.id`
- `product_name_snapshot` (figé à l'envoi)
- `unit_price_snapshot` (figé à l'envoi)

L'article inventaire n'intervient **jamais** dans le flux facture. Aucun risque de conflit.

### 3.6 🔒 Verrou : `threshold_product_id` — Contraintes obligatoires

**Problème :** Si le produit porteur du seuil n'est pas un produit lié à l'article, ou s'il appartient à un autre établissement, ou s'il est d'une famille canonique incompatible, le seuil effectif est incohérent.

**Règle cible :**
> `threshold_product_id` DOIT obligatoirement :
> 1. Être un produit du **même établissement** que l'article
> 2. Être **lié à cet article** (`products_v2.inventory_article_id = article.id`)
> 3. Être de **même famille canonique** que l'article

**Garde-fous :**
- Trigger DB `BEFORE INSERT OR UPDATE` sur `inventory_articles` : vérifie les 3 contraintes
- Trigger DB `BEFORE UPDATE` sur `products_v2` : si un produit est détaché d'un article et qu'il était le `threshold_product_id`, remettre `threshold_product_id = NULL` sur l'article
- UI : la liste de choix du produit porteur ne propose QUE les produits éligibles

### 3.7 🔒 Verrou : Choix du produit porteur — Explicite, jamais implicite

**Problème :** Si le produit porteur est assigné automatiquement (ex: "le premier produit lié"), l'utilisateur ne comprend pas d'où vient le seuil et ne peut pas le contrôler.

**Règle cible :**
> Le choix du produit porteur du seuil DOIT être un acte **explicite** de l'utilisateur.
> - Lors de la création d'un article avec plusieurs produits liés, l'UI demande : "Quel produit porte le seuil ?"
> - Si un seul produit est lié, le choix est pré-sélectionné mais modifiable
> - Si aucun produit porteur n'est choisi, le seuil effectif de l'article = NULL (pas d'alerte)

**Interdit :**
- ❌ Attribution automatique silencieuse du `threshold_product_id`
- ❌ Logique de fallback "prendre le premier produit lié"

### 3.8 🔒 Verrou : Nom article — Suggestion modifiable, jamais validation automatique

**Problème :** Si le nom proposé automatiquement est validé sans intervention humaine, on risque des noms absurdes ou des regroupements erronés.

**Règle cible :**
> Le wizard peut **proposer** un nom d'article à partir des similitudes entre les noms des produits liés.
> Cette proposition est **toujours modifiable** par l'utilisateur.
> **Aucune création automatique silencieuse** d'article inventaire.

**Comportement UX :**
1. Suggestion auto dans un champ texte pré-rempli
2. L'utilisateur peut accepter, modifier, ou vider le champ
3. Bouton de validation explicite pour créer/mettre à jour le nom
4. Si le champ est vide → erreur de validation, pas de nom vide accepté

### 3.9 🔒 Verrou : Affichage regroupé — Sous-lignes produit visibles ou dépliables

**Problème :** Si le regroupement masque complètement les produits individuels, l'utilisateur perd la visibilité sur les stocks par fournisseur et ne peut plus diagnostiquer les écarts.

**Règle cible :**
> L'affichage regroupé en inventaire DOIT garder les sous-lignes produit **visibles ou dépliables**.
> - Ligne parente : Nom article + stock agrégé + seuil effectif
> - Sous-lignes (dépliables ou toujours visibles) : chaque produit lié avec son stock individuel, son nom fournisseur, et son seuil propre
> - Les produits non liés à un article restent affichés comme des lignes simples (pas de changement)

**Avantages :**
- L'utilisateur voit le stock total ET le détail par fournisseur
- Il peut identifier quel produit est en rupture même quand l'agrégé est suffisant
- Il garde la traçabilité individuelle pour le diagnostic opérationnel

---

## 4. Changements nécessaires — Plan par étapes

### Étape 1 : Créer les fondations DB (Pré-requis)

```sql
-- 1a. Table inventory_articles (V0 : PAS de min_stock ici)
CREATE TABLE public.inventory_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES public.establishments(id),
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  storage_zone_id UUID REFERENCES public.storage_zones(id),
  canonical_unit_id UUID NOT NULL REFERENCES public.measurement_units(id),
  canonical_family TEXT NOT NULL,  -- 'weight' | 'volume' | 'count'
  threshold_product_id UUID,       -- produit porteur du seuil (FK ajoutée après products_v2)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- 1b. RLS
ALTER TABLE public.inventory_articles ENABLE ROW LEVEL SECURITY;
-- Policies standard (org member via establishment)

-- 1c. Colonne FK sur products_v2
ALTER TABLE public.products_v2 
  ADD COLUMN IF NOT EXISTS inventory_article_id UUID 
  REFERENCES public.inventory_articles(id);

-- 1d. FK circulaire : threshold_product_id → products_v2
ALTER TABLE public.inventory_articles
  ADD CONSTRAINT fk_threshold_product
  FOREIGN KEY (threshold_product_id) REFERENCES public.products_v2(id);

-- 1e. Index
CREATE INDEX idx_products_v2_inv_article ON public.products_v2(inventory_article_id);
CREATE INDEX idx_inv_articles_establishment ON public.inventory_articles(establishment_id);

-- 1f. Trigger : valider threshold_product_id (même établissement, lié, même famille)
CREATE OR REPLACE FUNCTION fn_validate_threshold_product()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_product RECORD;
BEGIN
  -- Si threshold_product_id est NULL, pas de validation nécessaire
  IF NEW.threshold_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Charger le produit porteur candidat
  SELECT id, establishment_id, inventory_article_id, canonical_family
  INTO v_product
  FROM products_v2
  WHERE id = NEW.threshold_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'threshold_product_id % does not exist', NEW.threshold_product_id;
  END IF;

  -- Contrainte 1 : même établissement
  IF v_product.establishment_id != NEW.establishment_id THEN
    RAISE EXCEPTION 'threshold_product_id must belong to same establishment as article';
  END IF;

  -- Contrainte 2 : lié à cet article
  IF v_product.inventory_article_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'threshold_product_id must be linked to this article (inventory_article_id = article.id)';
  END IF;

  -- Contrainte 3 : même famille canonique
  IF v_product.canonical_family != NEW.canonical_family THEN
    RAISE EXCEPTION 'threshold_product_id must have same canonical_family as article';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_threshold_product
  BEFORE INSERT OR UPDATE OF threshold_product_id ON public.inventory_articles
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_threshold_product();

-- 1g. Trigger : si un produit est détaché d'un article et qu'il était le produit porteur, le retirer
CREATE OR REPLACE FUNCTION fn_clear_threshold_on_unlink()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si le produit avait un article et qu'il n'en a plus (ou change d'article)
  IF OLD.inventory_article_id IS NOT NULL 
     AND (NEW.inventory_article_id IS NULL OR NEW.inventory_article_id != OLD.inventory_article_id) THEN
    -- Retirer ce produit comme porteur du seuil si c'était le cas
    UPDATE inventory_articles
    SET threshold_product_id = NULL, updated_at = now()
    WHERE id = OLD.inventory_article_id
      AND threshold_product_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clear_threshold_on_unlink
  BEFORE UPDATE OF inventory_article_id ON public.products_v2
  FOR EACH ROW
  EXECUTE FUNCTION fn_clear_threshold_on_unlink();
```

> **Note :** `min_stock_quantity_canonical` et `min_stock_unit_id` ne sont PAS créés sur `inventory_articles` en V0. Le seuil vit uniquement sur le produit porteur.

**Validation :** Les hooks existants (`useInventoryArticles`, `ArticleDetailView`) fonctionnent immédiatement — les `(supabase as any)` vont enfin toucher une vraie table.

### Étape 2 : Colonne `inventory_article_id` sur `stock_events`

```sql
ALTER TABLE public.stock_events 
  ADD COLUMN IF NOT EXISTS inventory_article_id UUID 
  REFERENCES public.inventory_articles(id);

CREATE INDEX idx_stock_events_inv_article ON public.stock_events(inventory_article_id);
```

**Pas de backfill** tant que l'étape 1 n'a pas de données.

### Étape 3 : Pipeline d'écriture — Edge function `stock-ledger`

Quand un `stock_event` est inséré :
1. Lire `products_v2.inventory_article_id` pour le `product_id` concerné
2. Si non null → écrire `inventory_article_id` sur le `stock_event`
3. Si null → laisser null (rétrocompatibilité)

**Fichier :** `supabase/functions/stock-ledger/index.ts`

### Étape 4 : Hook `useArticleStock` — Calcul correct

Remplacer la somme brute actuelle par l'appel à `getEstimatedStockByArticle` du StockEngine :
1. Charger les snapshots de la zone de l'article
2. Charger les `stock_events` filtrés par `inventory_article_id`
3. Appeler la fonction pure existante

### Étape 5 : Résolution du seuil effectif (Produit porteur V0)

Créer `src/lib/stock/getEffectiveMinStock.ts` :
```typescript
/**
 * Règle V0 : le seuil effectif d'un article inventaire = seuil du produit porteur.
 * Le seuil ne vit JAMAIS sur l'article. Un seul chemin de modification.
 */
function getEffectiveMinStock(
  product: { inventory_article_id: string | null; min_stock_quantity_canonical: number | null },
  thresholdProduct: { min_stock_quantity_canonical: number | null } | null
): number | null {
  // Si le produit est lié à un article ET qu'il y a un produit porteur du seuil
  if (product.inventory_article_id && thresholdProduct) {
    return thresholdProduct.min_stock_quantity_canonical;
  }
  // Sinon : produit non lié → seuil propre
  return product.min_stock_quantity_canonical;
}
```

**Ce que l'étape inventaire doit permettre :**
1. Proposer / définir le **nom de l'article inventaire** (suggestion pré-remplie, toujours modifiable, validation humaine obligatoire)
2. Choisir **explicitement** quel **produit lié porte le seuil** de l'article (`threshold_product_id`)

**Ce qui ne change PAS :**
- Le seuil se modifie toujours via `products_v2.min_stock_quantity_canonical`
- Même écran, même chemin, même colonne
- Quand on change le seuil du produit porteur, l'article le prend automatiquement

**Exemple :**
```
Lasagne Rummo  → seuil = 3  ← PRODUIT PORTEUR
Lasagne Molisana → seuil = 2

Article "Lasagne" :
  stock agrégé = Rummo + Molisana
  seuil effectif = 3 (vient de Rummo, le produit porteur)
  
Si on change le seuil de Rummo à 5 :
  seuil effectif de "Lasagne" = 5 automatiquement
```

### Étape 6 : Validation de famille canonique au lien

Ajouter un guard dans `ArticleDetailView.linkMutation` :
- Avant de lier → vérifier que `product.canonical_family === article.canonical_family`
- Si mismatch → toast d'erreur, lien refusé

### Étape 7 : Affichage inventaire regroupé (avec sous-lignes dépliables)

Dans les vues inventaire (`DesktopInventoryView`, `MobileInventoryView`) :
- Grouper les lignes par `inventory_article_id` quand il existe
- **Ligne parente** : Nom article (`inventory_articles.name`) + stock agrégé + seuil effectif (via produit porteur)
- **Sous-lignes dépliables** : chaque produit lié avec :
  - Son nom fournisseur (`products_v2.nom_produit`)
  - Son stock individuel
  - Son seuil propre (`min_stock_quantity_canonical`)
- Les produits non liés à un article restent affichés comme des lignes simples (aucun changement)
- Pattern UX : ligne cliquable / chevron pour déplier les sous-lignes

---

## 5. Ce qu'il ne faut PAS faire

| Interdit | Raison |
|----------|--------|
| Changer `inventory_lines.product_id` en `inventory_article_id` | Casse l'inventaire historique + le StockEngine |
| Fusionner les prix au niveau article | Le prix est une vérité fournisseur, jamais article |
| Supprimer `products_v2.min_stock_quantity_canonical` | 27 fichiers l'utilisent — le seuil reste sur le produit |
| Créer `inventory_articles.min_stock_quantity_canonical` en V0 | Double vérité → bugs d'alertes |
| Créer `inventory_articles.min_stock_unit_id` en V0 | Même raison — seuil = produit porteur uniquement |
| Logique "article.min_stock > product.min_stock" | Conflit de résolution, sync impossible en V0 |
| Créer un `stock_events` spécial pour l'article | Un seul type d'événement, un seul ledger |
| Rendre le lien article obligatoire | Rétrocompatibilité — les produits sans article doivent fonctionner |
| Modifier `commande_lines`, `app_invoices`, `bl_app_lines` | Aucun flux transactionnel ne doit référencer l'article |
| Attribuer `threshold_product_id` automatiquement | Décision métier = choix explicite de l'utilisateur |
| Valider un nom d'article sans confirmation humaine | Risque de noms absurdes et de regroupements erronés |
| Masquer les sous-lignes produit dans l'affichage regroupé | Perte de visibilité opérationnelle par fournisseur |
| Accepter un `threshold_product_id` hors établissement/article/famille | Seuil incohérent, alertes fausses |
| **Faire une migration 1:1 (1 produit = 1 article)** | **Pollution de données — seuls les regroupements métier réels justifient un article** |
| **Créer des articles automatiquement au save d'un produit** | **L'article est un acte métier explicite, pas un effet de bord** |

---

## 6. Ordre de mise en place recommandé

```
Étape 1 ──→ Étape 2 ──→ Étape 3 ──→ Étape 4 ──→ Étape 5 ──→ Étape 6 ──→ Étape 7
  DB          DB          Edge Fn     Hook fix    Seuil V0     Validation   UI grouping
  (table +    (col sur    (pipeline   (calcul     (produit     (guard       (affichage
   FK +       stock_ev)   écriture)   correct)    porteur      famille)     regroupé +
   triggers                                       explicite)                sous-lignes)
   threshold
   _product)
```

Chaque étape est **testable indépendamment** et ne casse rien si les suivantes ne sont pas encore faites.

---

## 7. Points à corriger AVANT de brancher les alertes stock sur les articles

1. ✅ Table `inventory_articles` doit exister en DB (avec `threshold_product_id`, SANS `min_stock`)
2. ✅ `products_v2.inventory_article_id` doit exister en DB
3. ✅ `stock_events.inventory_article_id` doit être alimenté par le pipeline
4. ✅ `useArticleStock` doit utiliser le StockEngine (Snapshot + Events), pas la somme brute
5. ✅ `getEffectiveMinStock()` doit résoudre : article lié → seuil du produit porteur, sinon seuil propre
6. ✅ Validation de famille canonique au lien pour empêcher les agrégations impossibles
7. ✅ Tests unitaires pour `getEstimatedStockByArticle` (déjà existants ✅)
8. ✅ UI inventaire doit permettre de choisir le produit porteur du seuil **explicitement** lors de la liaison
9. ✅ Trigger DB valide que `threshold_product_id` est du même établissement, lié à l'article, de même famille
10. ✅ Trigger DB nettoie `threshold_product_id` si le produit porteur est détaché
11. ✅ Le nom article est toujours une suggestion modifiable, jamais une auto-validation
12. ✅ L'affichage regroupé conserve les sous-lignes produit visibles ou dépliables

---

## 8. Confirmation : Zéro conflit avec les flux transactionnels

| Flux | Utilise l'article inventaire ? | Confirmation |
|------|-------------------------------|--------------|
| Commande B2B | ❌ Non — `product_id` uniquement | ✅ Aucun conflit |
| Facture App | ❌ Non — `product_name_snapshot` + `product_id` | ✅ Aucun conflit |
| Facture PDF / Vision AI | ❌ Non — `product_id` | ✅ Aucun conflit |
| BL App (réception) | ❌ Non — `product_id` | ✅ Aucun conflit |
| BL Retrait | ❌ Non — `product_id` | ✅ Aucun conflit |
| Analyse Achats | ❌ Non — `product_id` | ✅ Aucun conflit |
| Stock Ledger (écriture) | ✅ Oui — `inventory_article_id` ajouté en plus | ✅ Additif, pas de remplacement |
| Stock Ledger (lecture) | ✅ Oui — agrégation par article | ✅ Fonction pure existante |
| Inventaire physique (saisie) | ❌ Non — reste par `product_id` | ✅ Aucun conflit |
| Inventaire physique (affichage) | ✅ Oui — regroupement visuel avec sous-lignes | ✅ Lecture seule |

---

## 9. Règle métier finale — Résumé en 10 lignes

```
1. inventory_article_id = NULL par défaut — aucun article créé automatiquement
2. Un article inventaire n'est créé QUE quand l'utilisateur regroupe explicitement des produits
3. Le NOM affiché en inventaire vient de inventory_articles.name
4. Le STOCK agrégé = somme des stock_events des produits liés à l'article
5. Le SEUIL effectif = seuil du produit porteur (threshold_product_id), choisi explicitement
6. La SAISIE inventaire reste par produit fournisseur (product_id)
7. Les DOCUMENTS transactionnels ne voient jamais l'article inventaire
8. Le LIEN article est facultatif — un produit sans article garde son comportement actuel inchangé
9. Le threshold_product_id doit être du même établissement, lié à l'article, de même famille
10. L'affichage regroupé garde les sous-lignes produit visibles ou dépliables
```

> **Statut : VALIDÉ — Mode "à la demande" — Prêt pour implémentation étape par étape.**
