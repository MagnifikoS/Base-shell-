# AUDIT PARANO — Flow de création recette / préparation

> Date : 2026-03-11
> Statut : **CAUSE RACINE IDENTIFIÉE**

---

## SECTION 1 — Chemin réel du submit

```
1. Utilisateur clique "Créer la préparation" (RecipeWizard.tsx:475)
2. → handleCreate() (RecipeWizard.tsx:95)
3. → createRecipe.mutateAsync({ name, recipe_type_id, is_preparation, portions, yield_quantity, yield_unit_id, selling_price, selling_price_mode, lines })
4. → useRecipes.ts createRecipe mutation (line 60)
5. → Construit rpcParams avec _lines: JSON.stringify(linesPayload)  ← ⚠️ BUG ICI
6. → supabase.rpc("fn_create_recipe_full", rpcParams)
7. → PostgREST envoie le body JSON au serveur PostgreSQL
8. → fn_create_recipe_full() exécute jsonb_array_elements(_lines)  ← ⚠️ CRASH ICI
```

---

## SECTION 2 — Payload réel

Le payload construit par le wizard (RecipeWizard.tsx:96-112) est **correct** :

```js
{
  name: "Sauce tomate",
  recipe_type_id: "uuid-du-type",
  is_preparation: true,
  portions: null,
  yield_quantity: 3000,
  yield_unit_id: "uuid-de-l-unite",
  selling_price: null,
  selling_price_mode: "per_recipe",
  lines: [
    { product_id: "uuid", sub_recipe_id: null, quantity: 5, unit_id: "uuid" }
  ]
}
```

Le problème n'est **pas** dans le payload du wizard. Il est dans le **mapping** fait par le hook.

---

## SECTION 3 — Point exact de rupture

### Localisation : `src/modules/recettes/hooks/useRecipes.ts`, ligne 95

```typescript
_lines: JSON.stringify(linesPayload),  // ← CAUSE RACINE
```

### Mécanisme de la faille :

1. `JSON.stringify(linesPayload)` transforme l'array JS en **string** : `'[{"product_id":"uuid","sub_recipe_id":null,...}]'`

2. Le client Supabase JS envoie cette **string** comme valeur du paramètre `_lines` dans le body JSON HTTP :
   ```json
   { "_lines": "[{\"product_id\":\"uuid\",...}]" }
   ```
   → `_lines` est un **JSON string**, pas un JSON array.

3. PostgREST reçoit cette valeur et la passe à PostgreSQL comme un **JSONB string scalar** :
   ```sql
   _lines = '"[{\"product_id\":\"uuid\",...}]"'::jsonb
   ```
   Vérification : `SELECT jsonb_typeof('"[...]"'::jsonb)` → `'string'`

4. La RPC exécute `jsonb_array_elements(_lines)` sur ce JSONB string scalar → **ERREUR** :
   ```
   ERROR: cannot extract elements from a scalar
   ```
   Car `jsonb_array_elements()` attend un JSONB array, pas un JSONB string.

5. L'erreur remonte via PostgREST → supabase-js → `onError` → toast générique "Erreur lors de la création".

### Preuve DB directe :

```sql
SELECT jsonb_typeof('"[{\"product_id\":\"abc\"}]"'::jsonb);
-- Résultat : 'string'  (pas 'array')

SELECT * FROM jsonb_array_elements('"[{\"product_id\":\"abc\"}]"'::jsonb);
-- ERROR: cannot extract elements from a scalar
```

---

## SECTION 4 — Cause racine

**Double sérialisation JSON.**

Le client `supabase-js` sérialise automatiquement les paramètres RPC en JSON dans le body HTTP. En appelant `JSON.stringify()` manuellement **avant** de passer la valeur au client, la donnée est **doublement encodée** :

| Ce qu'on veut que PostgreSQL reçoive | Ce que PostgreSQL reçoit réellement |
|---|---|
| `[{"product_id":"uuid"}]::jsonb` (type: array) | `'"[{\"product_id\":\"uuid\"}]"'::jsonb` (type: string) |

Le fix est trivial : passer l'**array JS directement**, sans `JSON.stringify()`.

---

## SECTION 5 — Différence recette vs préparation

**Le bug touche TOUTES les créations** (recettes ET préparations) **dès qu'il y a au moins 1 ingrédient.**

Le bug n'est pas spécifique aux préparations. Il se manifeste à chaque appel de `fn_create_recipe_full` avec des `_lines` non vides.

Cependant, la raison pour laquelle le bug semble toucher "surtout les préparations" est probablement que :
- L'utilisateur testait toujours avec des ingrédients (obligatoire pour une préparation)
- Une recette créée sans ingrédient passerait (car `'[]'` stringify → `'"[]"'::jsonb` → `jsonb_array_elements` ne serait pas appelé sur un array vide via la boucle FOR...IN qui ne produit aucune itération... SAUF que `jsonb_array_elements('\"[]\"'::jsonb)` crasherait aussi car c'est toujours un scalar string)

**Conclusion : le bug touche TOUT le flow de création avec la RPC `fn_create_recipe_full`.** Toute recette créée avec ≥0 lignes est potentiellement affectée (la boucle FOR...IN SELECT crashe même si le résultat est vide, car la fonction `jsonb_array_elements` est invoquée dans le FROM).

### Pourquoi les logs précédents n'ont pas aidé :

Les `console.log` ajoutés précédemment logguent le payload **avant** l'appel RPC. Le payload JS est correct. Le problème est dans la **sérialisation** entre JS et PostgREST, invisible dans les logs côté client (sauf à inspecter le network payload brut).

---

## SECTION 6 — Correctif recommandé

### Fix minimal (1 ligne) :

**Fichier : `src/modules/recettes/hooks/useRecipes.ts`, ligne 95**

```diff
- _lines: JSON.stringify(linesPayload),
+ _lines: linesPayload,
```

Le client `supabase-js` gère automatiquement la sérialisation JSON du body HTTP. L'array JS sera correctement envoyé comme un JSON array dans le body, et PostgREST le passera comme `JSONB array` à PostgreSQL.

### Nettoyage secondaire (optionnel) :

Retirer les `console.log` de debug ajoutés précédemment (lignes 98, 104, 116) car ils ne sont plus nécessaires et violent la règle CLAUDE.md "no console.log in production paths".

---

## SECTION 7 — Risque de casse

| Flow | Impacté par le fix ? | Risque |
|---|---|---|
| Création recette simple | ✅ Corrigé (était cassé aussi) | Aucun — la sérialisation native est le comportement attendu |
| Création préparation | ✅ Corrigé | Aucun |
| Food Cost | ❌ Non impacté | Lecture seule, n'utilise pas la RPC de création |
| B2B Listing | ❌ Non impacté | Listing créé séparément |
| Détail recette | ❌ Non impacté | Lecture via SELECT, pas via RPC |
| Édition recette | ❌ Non impacté | Utilise `updateRecipe` (UPDATE direct, pas la RPC) |
| Ajout ligne existante | ❌ Non impacté | Utilise `addLine` (INSERT direct) |
| Suppression recette | ❌ Non impacté | Utilise `deleteRecipe` (DELETE direct) |

**Le correctif a ZÉRO risque de régression.** Il corrige le seul point d'appel de `fn_create_recipe_full`.

---

## SECTION 8 — Vérification de cohérence métier

| Règle | Respectée ? |
|---|---|
| Ingrédients depuis sources autorisées (products_v2 / recipes) | ✅ FK constraints en DB |
| Unités autorisées (measurement_units) | ✅ FK constraint en DB |
| XOR product_id / sub_recipe_id | ✅ CHECK constraint `chk_line_product_or_sub_recipe` |
| Anti-imbrication (1 niveau max) | ✅ `allowPreparations={!isPreparation}` dans IngredientForm |
| Pas de texte libre | ✅ Selectors uniquement |
| Atomicité de la transaction | ✅ SECURITY DEFINER + transaction implicite |
| RLS bypassed par SECURITY DEFINER | ✅ La RPC s'exécute en tant que owner, les policies ne bloquent pas |

**Toutes les règles métier sont respectées.** Le seul problème est technique : la double sérialisation.

---

## Annexe — Schéma DB audité

### Table `recipes` — Contraintes
- PK: `id`
- FK: `establishment_id → establishments(id) CASCADE`
- FK: `recipe_type_id → recipe_types(id) RESTRICT`
- FK: `yield_unit_id → measurement_units(id)`
- NOT NULL: `id, establishment_id, recipe_type_id, name, created_at, updated_at, selling_price_mode, is_preparation`
- Nullable: `created_by, portions, selling_price, yield_quantity, yield_unit_id`

### Table `recipe_lines` — Contraintes
- PK: `id`
- FK: `recipe_id → recipes(id) CASCADE`
- FK: `product_id → products_v2(id) RESTRICT`
- FK: `sub_recipe_id → recipes(id) CASCADE`
- FK: `unit_id → measurement_units(id) RESTRICT`
- CHECK: `chk_line_product_or_sub_recipe` — XOR entre product_id et sub_recipe_id

### RLS — `recipes`
- SELECT/UPDATE/DELETE: `establishment_id IN (user_establishments)`
- INSERT: `WITH CHECK (establishment_id IN (user_establishments))`
- **Bypassé par SECURITY DEFINER** dans la RPC

### RLS — `recipe_lines`
- Toutes policies basées sur `recipe_id IN (recipes WHERE establishment_id IN (user_establishments))`
- **Bypassé par SECURITY DEFINER** dans la RPC

### RPC `fn_create_recipe_full`
- SECURITY DEFINER ✅
- SET search_path = public ✅
- Paramètre `_lines JSONB DEFAULT '[]'::jsonb` ✅
- Logique XOR product/sub_recipe dans le CASE ✅
