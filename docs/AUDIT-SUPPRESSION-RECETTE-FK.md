# AUDIT — Échec suppression recette (FK b2b_recipe_listings)

> Date : 2026-03-11
> Statut : **CAUSE RACINE IDENTIFIÉE**

---

## SECTION 1 — Chemin réel du delete

```
1. Utilisateur clique "Supprimer la recette" (RecipeDetailSheet)
2. → deleteRecipe.mutateAsync(id)
3. → useRecipes.ts deleteRecipe mutation (ligne 156)
4. → Vérification préalable : recipe_lines.sub_recipe_id = id → OK (pas de sous-recette dépendante)
5. → supabase.from("recipes").delete().eq("id", id)
6. → PostgreSQL tente DELETE sur recipes
7. → CASCADE déclenche DELETE sur b2b_recipe_listings (via recipe_id FK CASCADE)
8. → MAIS commande_plat_lines.listing_id → b2b_recipe_listings.id est NO ACTION (RESTRICT)
9. → FK VIOLATION → erreur brute remontée au toast
```

---

## SECTION 2 — Cause racine

La table `b2b_recipe_listings` est référencée par **deux FK sans ON DELETE** (= RESTRICT implicite) :

| Table enfant | FK | ON DELETE |
|---|---|---|
| `commande_plat_lines` | `commande_plat_lines_listing_id_fkey` | **NO ACTION** (RESTRICT) |
| `app_invoice_dish_lines` | `app_invoice_dish_lines_listing_id_fkey` | **NO ACTION** (RESTRICT) |
| `b2b_followed_recipes` | `b2b_followed_recipes_listing_id_fkey` | CASCADE ✅ |

Quand une recette a été publiée en B2B **ET** qu'au moins une commande plat ou facture a été créée avec ce listing, la suppression de la recette cascade vers `b2b_recipe_listings` puis bloque sur `commande_plat_lines`.

---

## SECTION 3 — Analyse métier

Ce blocage est **légitime métier** :
- Les `commande_plat_lines` snapshotent le `listing_id` pour traçabilité historique
- Les `app_invoice_dish_lines` référencent le listing pour l'intégrité des factures
- Supprimer le listing casserait l'historique des commandes et factures

Le vrai problème est **UX** : le hook `deleteRecipe` vérifie uniquement les dépendances `recipe_lines` (sous-recettes), mais **ne vérifie pas les dépendances B2B** (listings avec commandes/factures).

---

## SECTION 4 — Garde-fous manquants dans le hook

Le hook actuel fait :
1. ✅ Vérifie si la recette est utilisée comme sous-recette → message clair
2. ❌ Ne vérifie PAS si la recette a un listing B2B avec des commandes/factures → erreur brute FK

---

## SECTION 5 — Correctif recommandé

**Ajouter un garde-fou pré-suppression dans le hook `deleteRecipe`** qui vérifie si la recette a un listing B2B référencé par des commandes ou factures.

```typescript
// Avant le DELETE, vérifier les dépendances B2B
const { data: listing } = await supabase
  .from("b2b_recipe_listings")
  .select("id")
  .eq("recipe_id", id)
  .maybeSingle();

if (listing) {
  // Vérifier si le listing est référencé par des commandes plats
  const { count: orderCount } = await supabase
    .from("commande_plat_lines")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listing.id);

  // Vérifier si le listing est référencé par des factures
  const { count: invoiceCount } = await supabase
    .from("app_invoice_dish_lines")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listing.id);

  if ((orderCount ?? 0) > 0 || (invoiceCount ?? 0) > 0) {
    throw new Error("Cette recette a un historique de commandes ou factures B2B. Dépubliez-la et archivez-la au lieu de la supprimer.");
  }
}
```

**Alternative** : si le listing n'a aucune dépendance (jamais commandé), on pourrait le supprimer manuellement avant la recette.

---

## SECTION 6 — Risque de casse du correctif

| Flow | Impact |
|---|---|
| Suppression recette sans listing B2B | ❌ Aucun impact |
| Suppression recette avec listing B2B sans commandes | ❌ Aucun impact (passe toujours) |
| Suppression recette avec listing B2B + commandes | ✅ Message clair au lieu d'erreur FK brute |
| Édition recette | ❌ Non impacté |
| Création recette | ❌ Non impacté |
| Commandes plats | ❌ Non impacté |

---

## SECTION 7 — Options de résolution

### Option A — Garde-fou UX uniquement (recommandé)
Ajouter la vérification pré-suppression dans le hook. Message clair à l'utilisateur. Aucune modification de schéma.

### Option B — Soft-delete (archivage)
Ajouter un champ `archived_at` sur `recipes` et filtrer les recettes archivées. Plus propre à long terme mais plus invasif.

### Option C — SET NULL sur les FK
Modifier les FK `commande_plat_lines_listing_id_fkey` et `app_invoice_dish_lines_listing_id_fkey` en `ON DELETE SET NULL`. Dangereux : casse la traçabilité historique des commandes/factures.

**Recommandation : Option A** — minimal, sûr, cohérent avec le pattern existant (garde-fou sous-recette déjà en place).
