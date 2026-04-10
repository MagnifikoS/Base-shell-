# DOC — Recette Prod & Prépa

> Stratégie produit + proposition d'implémentation pour les préparations intermédiaires et les recettes composées.

---

## 1. Problème actuel

Le module recette actuel permet :
- ✅ Créer une recette avec des ingrédients (produits `products_v2`)
- ✅ Définir un nombre de portions
- ✅ Calculer un coût de revient via le moteur Food Cost
- ✅ Définir un prix de vente et un ratio

**Ce qui manque :**

Une recette ne peut contenir **que des produits bruts** (`products_v2`). Il est impossible de :
- Créer une **préparation intermédiaire** (sauce tomate, pâte à pizza, pesto…)
- Définir un **rendement final** de cette préparation (ex : "cette recette produit 3 kg de sauce")
- **Utiliser cette préparation comme ingrédient** dans une autre recette
- Calculer automatiquement le **coût de la part utilisée** dans le plat final

Conséquence : le chef ne peut pas modéliser la réalité de sa cuisine. Les coûts des plats composés (lasagne, pizza, tiramisu…) sont incomplets ou nécessitent des calculs manuels.

---

## 2. Objectif produit

Permettre à n'importe quel restaurant de :

1. **Créer une préparation** (sauce, pâte, crème, fond…) avec ses ingrédients et un rendement final
2. **Obtenir automatiquement un coût unitaire** de cette préparation (€/g, €/kg, €/L, €/pièce)
3. **Utiliser cette préparation dans un plat** comme s'il s'agissait d'un ingrédient
4. **Calculer le food cost complet** du plat final incluant les parts de préparations

Sans complexifier l'UX existante.

---

## 3. Proposition métier

### 3.1 Concepts clés

| Concept | Définition | Exemple |
|---------|-----------|---------|
| **Produit** | Matière première achetée (existe déjà) | Tomates pelées, farine, beurre |
| **Préparation** | Recette intermédiaire avec un rendement final | Sauce tomate (rend 3 kg), Pâte à pizza (rend 2 kg) |
| **Plat / Recette finale** | Recette vendue, peut contenir produits ET préparations | Pâtes arrabiata, Pizza margherita |
| **Rendement** | Quantité produite par une préparation | 3000 g, 2.5 L, 50 pièces |
| **Coût unitaire de sortie** | Coût total de la prépa ÷ rendement | 8.40 € / 3000 g = 0.0028 €/g |

### 3.2 Distinction Préparation vs Plat

Au lieu d'un type de recette rigide, on utilise **un seul booléen** sur la recette existante :

```
recipes.is_preparation  BOOLEAN  DEFAULT false
```

- `is_preparation = false` → **Plat** (comportement actuel, inchangé)
- `is_preparation = true` → **Préparation** (nouveau comportement : rendement obligatoire, utilisable comme ingrédient)

**Pourquoi pas un nouveau "type de recette" ?**  
Les types de recettes (`recipe_types`) sont des catégories visuelles (Entrée, Plat, Dessert). La distinction Préparation/Plat est un comportement fonctionnel, pas une catégorie. Les deux sont orthogonaux : une préparation peut être de type "Base", "Sauce", "Pâtisserie"… Les types restent libres.

### 3.3 Rendement final (préparations uniquement)

Deux nouveaux champs sur `recipes` :

```
recipes.yield_quantity   NUMERIC   NULL    -- ex: 3000
recipes.yield_unit_id    UUID      NULL    -- FK → measurement_units (ex: "g")
```

- Obligatoires quand `is_preparation = true`
- `NULL` quand `is_preparation = false`
- Constraint : `yield_quantity > 0` si non null

### 3.4 Ligne de recette : produit OU préparation

Aujourd'hui `recipe_lines` a :
```
recipe_lines.product_id   UUID  NOT NULL  FK → products_v2
```

On ajoute :
```
recipe_lines.sub_recipe_id   UUID  NULL  FK → recipes
```

**Règle** : une ligne a SOIT `product_id`, SOIT `sub_recipe_id` (jamais les deux).

```sql
-- Contrainte d'exclusivité
ALTER TABLE recipe_lines 
  ALTER COLUMN product_id DROP NOT NULL;
  
ALTER TABLE recipe_lines
  ADD COLUMN sub_recipe_id UUID REFERENCES recipes(id) ON DELETE RESTRICT;

ALTER TABLE recipe_lines
  ADD CONSTRAINT chk_line_source 
  CHECK (
    (product_id IS NOT NULL AND sub_recipe_id IS NULL) OR
    (product_id IS NULL AND sub_recipe_id IS NOT NULL)
  );
```

`ON DELETE RESTRICT` empêche de supprimer une préparation encore utilisée dans un plat.

---

## 4. UX proposée

### 4.1 Création de recette (Wizard)

**Step 1 modifié** — Ajout d'un toggle "Préparation" AVANT les portions :

```
┌─────────────────────────────────────┐
│  Nouvelle recette                    │
├─────────────────────────────────────┤
│  NOM DE LA RECETTE                   │
│  [Sauce tomate maison        ]       │
│                                      │
│  TYPE DE RECETTE                     │
│  [Sauce] [Base] [Pâtisserie] [Plat]  │
│                                      │
│  ┌─────────────────────────────┐     │
│  │ 🔧 Préparation de base      │     │
│  │ Cette recette sera utilisable│     │
│  │ comme ingrédient dans        │     │
│  │ d'autres recettes.      [✓] │     │
│  └─────────────────────────────┘     │
│                                      │
│  (si préparation = ON)               │
│  RENDEMENT FINAL                     │
│  [3000        ] [g ▾]               │
│                                      │
│  (si préparation = OFF)              │
│  ┌─────────────────────────────┐     │
│  │ Recette portionnable    [○] │     │
│  └─────────────────────────────┘     │
│                                      │
│  [ Continuer ]                       │
└─────────────────────────────────────┘
```

**Logique :**
- Si "Préparation" = ON → pas de portions, mais rendement obligatoire
- Si "Préparation" = OFF → portions optionnelles (comme aujourd'hui)

**Step 2 modifié** — Le formulaire d'ingrédient peut maintenant chercher dans les produits ET dans les préparations existantes :

```
┌─────────────────────────────────────┐
│  INGRÉDIENT                          │
│  [🔍 Rechercher un produit ou prépa…]│
│                                      │
│  ┌─────────── Résultats ──────────┐  │
│  │ 🥫 Tomates pelées        produit│  │
│  │ 🧅 Oignons              produit│  │
│  │ 🍳 SAUCE TOMATE     ← prépa   │  │
│  │ 🍳 PESTO BASILIC    ← prépa   │  │
│  └────────────────────────────────┘  │
│                                      │
│  QUANTITÉ                            │
│  [        250        ]               │
│                                      │
│  UNITÉ                               │
│  (g) (kg) (ml) (L) (pièce)          │
│                                      │
│  [ Ajouter l'ingrédient ]            │
└─────────────────────────────────────┘
```

**Différenciation visuelle** : les préparations ont un badge `🍳 prépa` ou une icône dédiée pour que le chef les distingue immédiatement des produits bruts.

### 4.2 Fiche recette (RecipeDetail)

**Pour une préparation :**
```
┌─────────────────────────────────────┐
│  ← SAUCE TOMATE MAISON        ✏️    │
├─────────────────────────────────────┤
│  [Sauce] [Rend. 3 kg ✏️]            │
│  [Préparation 🍳]                   │
│                                      │
│  INGRÉDIENTS (5)         [+ Ajouter]│
│  ┌────────────────────────────────┐  │
│  │ Tomates pelées        2000  g │  │
│  │ Oignons                300  g │  │
│  │ Ail                     50  g │  │
│  │ Huile d'olive          100 ml │  │
│  │ Sel                     15  g │  │
│  └────────────────────────────────┘  │
│                                      │
│  COÛT DE REVIENT                     │
│  Total : 8.40 €                      │
│  Coût unitaire : 2.80 €/kg           │
│                                      │
│  ⚠️ Utilisée dans : Pâtes arrabiata, │
│     Pizza margherita                  │
│                                      │
│  [🗑️ Supprimer la préparation]       │
└─────────────────────────────────────┘
```

**Pour un plat avec préparation :**
```
┌─────────────────────────────────────┐
│  ← PÂTES ARRABIATA            ✏️    │
├─────────────────────────────────────┤
│  [Plat] [4 portions ✏️] [9.00€/port]│
│                                      │
│  INGRÉDIENTS (3)         [+ Ajouter]│
│  ┌────────────────────────────────┐  │
│  │ Pâtes penne              400  g │ │
│  │ 🍳 SAUCE TOMATE          250  g │ │  ← prépa, badge visuel
│  │ Parmesan                  40  g │ │
│  └────────────────────────────────┘  │
│                                      │
│  COÛT DE REVIENT                     │
│  Total : 3.60 € · Portion : 0.90 €  │
│  Ratio : x10.0                       │
└─────────────────────────────────────┘
```

### 4.3 Liste des recettes (RecipeListView / RecettesPage)

Pas de changement de layout. Les préparations apparaissent dans la même liste, filtrables par type. Un petit badge `🍳` distingue visuellement les préparations dans la liste.

### 4.4 Food Cost

Le tableau Food Cost affiche **toutes** les recettes (préparations + plats). Les préparations ont un ratio "—" (pas de prix de vente en général) et un coût unitaire affiché à la place.

---

## 5. Architecture proposée

### 5.1 Stratégie : extension légère du module recettes

**Pas de nouveau module.** On étend le module existant `src/modules/recettes/` avec des ajouts ciblés :

```
src/modules/recettes/
├── components/
│   ├── IngredientForm.tsx        ← MODIFIÉ (recherche prépas + produits)
│   ├── RecipeDetail.tsx          ← MODIFIÉ (affichage rendement + coût unitaire)
│   ├── RecipeWizard.tsx          ← MODIFIÉ (toggle préparation + rendement)
│   ├── RecipeListView.tsx        ← MODIFIÉ (badge préparation)
│   ├── SubRecipeRow.tsx          ← NOUVEAU (affichage ligne sous-recette)
│   └── YieldEditor.tsx           ← NOUVEAU (éditeur rendement inline)
├── hooks/
│   ├── useRecipes.ts             ← MODIFIÉ (support sub_recipe_id dans lines)
│   ├── useSubRecipeSearch.ts     ← NOUVEAU (recherche préparations)
│   └── useRecipeUsage.ts         ← NOUVEAU (où est utilisée une prépa)
├── types.ts                      ← MODIFIÉ (nouveaux champs)
└── index.ts                      ← MODIFIÉ (export nouveaux hooks)
```

### 5.2 Impact sur le module Food Cost

```
src/modules/foodCost/
├── engine/
│   └── foodCostEngine.ts         ← MODIFIÉ (calcul coût ligne sub-recette)
├── hooks/
│   └── useFoodCostData.ts        ← MODIFIÉ (charger rendement + sous-recettes)
└── types.ts                      ← MODIFIÉ (FoodCostProduct → union type)
```

### 5.3 Supprimabilité

**Partiellement supprimable.** Les colonnes DB (`is_preparation`, `yield_quantity`, `yield_unit_id`, `sub_recipe_id`) peuvent être supprimées par migration inverse. Le code frontend est concentré dans des composants identifiables. Cependant, ce n'est **pas un module séparé** — c'est une extension organique du module recettes. C'est le bon choix car les préparations SONT des recettes.

---

## 6. Impact sur l'existant

### ✅ Ce qui reste INCHANGÉ

| Élément | Statut |
|---------|--------|
| `RecipeType` / `recipe_types` table | Inchangé |
| Logique de portions | Inchangée (désactivée pour préparations) |
| Prix de vente / mode | Inchangé |
| `useRecipeTypes` | Inchangé |
| `useProductUnitsForRecipe` | Inchangé |
| B2B Listing | Inchangé |
| Module conditionnementV2 | Inchangé |
| Module produitsV2 | Inchangé |
| RPC `fn_create_recipe_with_lines` | Modifié (ajout paramètres optionnels) |

### ⚠️ Ce qui est MODIFIÉ

| Élément | Nature du changement | Risque |
|---------|---------------------|--------|
| Table `recipes` | 3 colonnes ajoutées (additif) | Faible |
| Table `recipe_lines` | 1 colonne ajoutée, `product_id` nullable | Moyen |
| `types.ts` | Nouveaux champs sur interfaces existantes | Faible |
| `RecipeWizard.tsx` | Ajout toggle + rendement dans step 1 | Faible |
| `IngredientForm.tsx` | Recherche étendue aux préparations | Moyen |
| `RecipeDetail.tsx` | Affichage rendement + badge prépa | Faible |
| `foodCostEngine.ts` | Nouvelle branche de calcul pour sous-recettes | Moyen |
| `useFoodCostData.ts` | Chargement des données rendement | Faible |

### 🔴 Ce qui est RISQUÉ

| Risque | Mitigation |
|--------|-----------|
| `product_id` nullable casse les queries existantes | Migration progressive : les lignes existantes gardent product_id. Seules les nouvelles lignes peuvent avoir sub_recipe_id |
| Boucle infinie : recette A utilise B qui utilise A | Contrainte applicative : interdire les cycles (check en frontend + trigger DB) |
| Food cost récursif : prépa dans prépa dans prépa | Limiter à 1 niveau de profondeur en V1 (une prépa ne peut pas contenir d'autres prépas) |

---

## 7. Stratégie d'implémentation

### Étape 1 — Migration DB (30 min)

```sql
-- 1. Nouveaux champs sur recipes
ALTER TABLE recipes ADD COLUMN is_preparation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE recipes ADD COLUMN yield_quantity NUMERIC NULL;
ALTER TABLE recipes ADD COLUMN yield_unit_id UUID NULL REFERENCES measurement_units(id);

-- Contrainte : rendement requis pour les préparations
-- (via trigger, pas CHECK, pour flexibilité)
CREATE OR REPLACE FUNCTION fn_validate_recipe_preparation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_preparation = true THEN
    IF NEW.yield_quantity IS NULL OR NEW.yield_quantity <= 0 THEN
      RAISE EXCEPTION 'yield_quantity required for preparations';
    END IF;
    IF NEW.yield_unit_id IS NULL THEN
      RAISE EXCEPTION 'yield_unit_id required for preparations';
    END IF;
    -- Préparations n'ont pas de portions
    NEW.portions := NULL;
    NEW.selling_price_mode := 'per_recipe';
  ELSE
    NEW.yield_quantity := NULL;
    NEW.yield_unit_id := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_recipe_preparation
  BEFORE INSERT OR UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION fn_validate_recipe_preparation();

-- 2. Sous-recette dans recipe_lines
ALTER TABLE recipe_lines ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE recipe_lines ADD COLUMN sub_recipe_id UUID REFERENCES recipes(id) ON DELETE RESTRICT;
ALTER TABLE recipe_lines ADD CONSTRAINT chk_line_source 
  CHECK (
    (product_id IS NOT NULL AND sub_recipe_id IS NULL) OR
    (product_id IS NULL AND sub_recipe_id IS NOT NULL)
  );

-- 3. Anti-cycle V1 : une préparation ne peut pas contenir de sous-recettes
CREATE OR REPLACE FUNCTION fn_prevent_sub_recipe_cycle()
RETURNS TRIGGER AS $$
DECLARE
  _is_prep BOOLEAN;
BEGIN
  IF NEW.sub_recipe_id IS NOT NULL THEN
    -- Le parent ne doit pas être une prépa qui contient des prépas (V1 : 1 niveau)
    SELECT is_preparation INTO _is_prep FROM recipes WHERE id = NEW.recipe_id;
    IF _is_prep = true THEN
      RAISE EXCEPTION 'A preparation cannot contain sub-recipes (V1 limitation)';
    END IF;
    -- La sous-recette doit être une préparation
    SELECT is_preparation INTO _is_prep FROM recipes WHERE id = NEW.sub_recipe_id;
    IF _is_prep = false THEN
      RAISE EXCEPTION 'Only preparations can be used as sub-recipes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_sub_recipe_cycle
  BEFORE INSERT OR UPDATE ON recipe_lines
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_sub_recipe_cycle();

-- 4. RLS : mêmes politiques, pas de changement
```

### Étape 2 — Types + Hook recettes (20 min)

- Ajouter `is_preparation`, `yield_quantity`, `yield_unit_id` dans `types.ts`
- Ajouter `sub_recipe_id` dans `RecipeLine`
- Modifier `useRecipes` : `createRecipe` et `updateRecipe` supportent les nouveaux champs
- Créer `useSubRecipeSearch` : cherche les recettes avec `is_preparation = true`
- Créer `useRecipeUsage` : liste les recettes qui utilisent une prépa donnée

### Étape 3 — Wizard modifié (30 min)

- Ajouter le toggle "Préparation de base" dans Step 1
- Si ON : afficher rendement (quantité + unité) au lieu des portions
- Si OFF : comportement identique à aujourd'hui
- Step 2 : modifier `IngredientForm` pour chercher dans produits + préparations

### Étape 4 — RecipeDetail modifié (30 min)

- Afficher badge "Préparation" si `is_preparation`
- Afficher/éditer le rendement (via `YieldEditor`, même pattern que `PortionsEditor`)
- Afficher le coût unitaire (total / rendement) 
- Afficher "Utilisée dans : …" si d'autres recettes l'utilisent
- Les lignes sous-recette affichent le nom de la prépa avec un badge 🍳

### Étape 5 — Food Cost Engine (45 min)

- Modifier `computeLineCost` pour gérer les lignes `sub_recipe_id`
- Pour une ligne sous-recette : 
  1. Calculer le coût total de la sous-recette (récursivement, mais V1 = 1 niveau)
  2. Coût unitaire = coût total / yield_quantity (en unité de rendement)
  3. Convertir la quantité utilisée dans l'unité de rendement
  4. Coût de la ligne = quantité convertie × coût unitaire
- Modifier `useFoodCostData` pour charger les données de rendement

### Étape 6 — Tests + validation (30 min)

- Tests unitaires du moteur food cost avec sous-recettes
- Vérifier les cas limites (prépa sans ingrédient, rendement 0, etc.)

---

## 8. Calculs Food Cost

### 8.1 Coût d'une préparation

```
Préparation "Sauce tomate" :
  - Tomates pelées : 2000 g × 0.0023 €/g = 4.60 €
  - Oignons :         300 g × 0.0015 €/g = 0.45 €
  - Ail :              50 g × 0.0080 €/g = 0.40 €
  - Huile d'olive :   100 ml × 0.0070 €/ml = 0.70 €
  - Sel :              15 g × 0.0005 €/g = 0.01 €
  ─────────────────────────────────────────
  Coût total : 6.16 €
  Rendement : 3000 g
  Coût unitaire : 6.16 / 3000 = 0.00205 €/g = 2.05 €/kg
```

### 8.2 Coût d'un plat avec préparation

```
Plat "Pâtes arrabiata" (4 portions) :
  - Pâtes penne :      400 g × 0.0018 €/g = 0.72 €
  - SAUCE TOMATE :     250 g × 0.00205 €/g = 0.51 €  ← coût calculé depuis la prépa
  - Parmesan :          40 g × 0.0250 €/g = 1.00 €
  ─────────────────────────────────────────
  Coût total : 2.23 €
  Coût/portion : 0.56 €
  Prix de vente : 9.00 € / portion
  Ratio : x16.1
```

### 8.3 Formule pour une ligne sous-recette

```
coût_ligne = quantité_utilisée × (coût_total_prépa / rendement_prépa)
```

Avec conversion d'unité si l'unité de la ligne ≠ l'unité de rendement (via le moteur de conversion existant).

### 8.4 Cas particuliers

| Cas | Comportement |
|-----|-------------|
| Prépa sans ingrédient | Coût = 0, statut "vide" |
| Prépa avec ingrédients incomplets | Coût approximatif (≈), statut "partiel" |
| Prépa utilisée dans un plat, mais coût incomplet | La ligne du plat est marquée "partiel" |
| Rendement = 0 | Impossible (trigger DB) |
| Boucle A→B→A | Impossible (trigger DB V1 : 1 niveau max) |

---

## 9. Cas concrets

### Cas 1 — Sauce tomate (Préparation)

1. Créer recette → toggle "Préparation" ON
2. Nom : SAUCE TOMATE MAISON
3. Type : Sauce
4. Rendement : 3000 g
5. Ingrédients : tomates pelées 2 kg, oignons 300 g, ail 50 g, huile 100 ml, sel 15 g
6. → Coût total automatique : 6.16 €
7. → Coût unitaire affiché : 2.05 €/kg

### Cas 2 — Pâte à pizza (Préparation)

1. Préparation ON, rendement : 2000 g
2. Ingrédients : farine 1 kg, eau 500 ml, levure 10 g, huile 50 ml, sel 20 g
3. → Coût total : 1.30 €
4. → Coût unitaire : 0.65 €/kg

### Cas 3 — Crème pâtissière (Préparation)

1. Préparation ON, rendement : 1500 g
2. Ingrédients : lait 1 L, sucre 200 g, jaunes d'œufs 6 pièces, fécule 60 g, vanille 1 pièce
3. → Coût total : 3.80 €
4. → Coût unitaire : 2.53 €/kg

### Cas 4 — Pâtes arrabiata (Plat vendu)

1. Préparation OFF, portions : 4, prix vente : 9.00 €/portion
2. Ingrédients : pâtes penne 400 g, **🍳 SAUCE TOMATE** 250 g, parmesan 40 g
3. → Coût total : 2.23 €
4. → Coût/portion : 0.56 €
5. → Ratio : x16.1

### Cas 5 — Pizza margherita (Plat vendu)

1. Préparation OFF, portions : 1, prix vente : 12.00 €/portion
2. Ingrédients : **🍳 PÂTE À PIZZA** 280 g, **🍳 SAUCE TOMATE** 100 g, mozzarella 150 g, basilic 5 g
3. → Coût pâte : 280 × 0.00065 = 0.18 €
4. → Coût sauce : 100 × 0.00205 = 0.21 €
5. → Coût total : 2.14 €
6. → Ratio : x5.6

### Cas 6 — Tarte au citron (Plat vendu avec 2 préparations)

1. Préparation OFF, portions : 8
2. Ingrédients : **🍳 PÂTE SABLÉE** 500 g, **🍳 CRÈME CITRON** 400 g, meringue italienne 200 g
3. → Chaque prépa apporte son coût proportionnel automatiquement

---

## 10. Recommandation finale

### Version recommandée : V1 "1 niveau, simple et propre"

| Aspect | Choix V1 |
|--------|---------|
| Profondeur | 1 niveau max (prépa ne contient pas d'autres prépas) |
| Toggle | Booléen `is_preparation` sur la recette |
| Rendement | `yield_quantity` + `yield_unit_id` (champs simples) |
| Sous-recette | `sub_recipe_id` sur `recipe_lines` (exclusif avec `product_id`) |
| Calcul | Séquentiel : d'abord les prépas, puis les plats |
| UX | Même écran, même liste, badge distinctif |
| Food Cost | Extension du moteur existant, pas de réécriture |
| Sécurité cycles | Trigger DB empêche prépa→prépa |

**Pourquoi cette version :**
- Couvre 95% des cas réels en restauration
- Aucune réécriture de code existant
- Risque minimal de régression
- Compréhensible immédiatement par un chef
- Extensible vers V2 (multi-niveaux) si besoin un jour

### V2 future (pas maintenant)

- Préparations multi-niveaux (fond de sauce → sauce → plat)
- Rendement variable (batch de production)
- Historique des coûts de préparation
- Suggestions automatiques de préparations à créer

---

## Annexe — Glossaire terrain

| Terme app | Terme cuisine |
|-----------|--------------|
| Préparation | Mise en place, base, appareil, fond |
| Rendement | "Ça donne combien", poids final |
| Coût unitaire | "Combien ça me coûte au kilo" |
| Sous-recette | "J'utilise ma sauce dans ce plat" |
| Plat | Recette vendue, fiche technique |
