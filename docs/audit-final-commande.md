# AUDIT FINAL COMMANDE — Produits / Plats / Recettes / Food Cost / Catalogue B2B

**Date** : 2026-03-09  
**Périmètre** : Modules commandes, commandesPlats, recettes, foodCost, catalogue B2B, litiges, réception composite  
**Objectif** : Vérifier la cohérence, l'isolation et l'absence de casse avant mise en production

---

## SECTION 1 — Executive Summary

| Critère | Verdict |
|---------|---------|
| **Module commande produit** | ✅ Intact — aucune régression détectée |
| **Module commande plat** | ✅ Bien séparé — isolation complète |
| **Réception composite** | ⚠️ GO CONDITIONNEL — 2 risques P1 identifiés |
| **Recettes** | ✅ Prêt prod |
| **Food Cost** | ✅ Prêt prod |
| **Catalogue B2B V1** | ✅ Propre et isolé |
| **Verdict global** | **GO CONDITIONNEL** |

### Risques résiduels bloquants :

1. **P1 — Double exécution de la réception produit** dans le wrapper composite (le `handleReceive` du produit appelle `onClose()` qui ferme tout AVANT que la réception plats ne s'exécute)
2. **P1 — Absence de dialogue DLC dans le mode embedded** (le wrapper composite bypasse le flow DLC du produit en appelant `executeReceive` directement)

### Décision :
**GO si les 2 P1 sont corrigés. Le reste est de la dette acceptable.**

---

## SECTION 2 — Audit Commandes Produit

### État du module

Le module `src/modules/commandes/` est **autonome et complet** :

- **Tables** : `commandes` + `commande_lines` (types dédiés, aucun champ plat)
- **Cycle de vie** : Brouillon → Envoyée → Ouverte → Expédiée → Reçue/Litige → Clôturée
- **Edge function** : `commandes-api` (send/open/ship/receive) — isolée
- **Logique métier** :
  - BFS (UniversalQuantityModal) ✓
  - DLC (module dlc importé) ✓
  - Retours (module retours importé) ✓
  - Surplus/manque ✓
  - Validation ligne par ligne ✓
  - Swipe mobile ✓
  - Snapshots prix à l'envoi ✓

### Sources de vérité
- `commande_lines.shipped_quantity` → SSOT expédition
- `commande_lines.received_quantity` → SSOT réception
- `commande_lines.unit_price_snapshot` / `line_total_snapshot` → SSOT facture
- `commande_lines.product_name_snapshot` → snapshot produit
- `commandes.status` → SSOT état (géré par edge function, pas client)

### Isolation vérifiée
- **Zéro import** de `commandesPlats`, `recettes`, `foodCost`, `b2b_recipe_listings`
- Le service `commandeService.ts` ne touche que `commandes` et `commande_lines`
- Les hooks ne font aucune jointure avec les plats
- L'index.ts exporte uniquement des composants produit

### Risques identifiés
- **P2** : Le `ReceptionDialog` a désormais 2 branches (embedded vs standalone = ~1431 lignes) → code dupliqué pour les modals, risque de divergence future
- **P3** : `as any` cast sur le client Supabase dans les services (acceptable, pattern projet)

### Verdict : ✅ **Intact, aucune régression**

---

## SECTION 3 — Audit Commandes Plats

### État du module

Module `src/modules/commandesPlats/` : **100% isolé et fonctionnel**.

- **Tables** : `commande_plats` + `commande_plat_lines` (tables dédiées, aucun champ produit)
- **Cycle de vie** : identique au produit mais moteur séparé
- **Edge function** : `commandes-plats-api` (send/open/ship/receive/resolve_litige) — isolée
- **Litiges** : `litige_plats` + `litige_plat_lines` — tables et hooks séparés
- **Table de liaison** : `order_groups` (FK nullable vers `commande_id` et `commande_plat_id`)

### Sources de vérité
- `commande_plat_lines.commercial_name_snapshot` → snapshot nom commercial
- `commande_plat_lines.unit_price_snapshot` → snapshot prix
- `commande_plat_lines.listing_id` → FK vers `b2b_recipe_listings` (UUID stable)
- `commande_plats.status` → SSOT état

### Isolation vérifiée
- **Zéro import** de `commandes` (module produit), `products_v2`, `stock`, `inventory`
- Le lifecycle appelle `commandes-plats-api` (edge function dédiée)
- Les types sont dans un fichier séparé, aucun type partagé avec produit
- L'index.ts est exhaustif et propre

### ID vs texte
- `listing_id` (UUID) → ✅ stable
- `commercial_name_snapshot` → texte figé au moment de la commande → ✅ safe
- Aucune logique métier basée sur un nom

### Risques identifiés
- **P3** : Le `DishReceptionSection` cap les quantités reçues à `shipped_quantity` (ligne 74 : `Math.min(qty, l.shipped_quantity)`) → pas de surplus possible pour les plats. C'est peut-être voulu mais c'est asymétrique avec les produits. À documenter.
- **P3** : `getGroupDisplayStatus` utilise une logique de priorité statique (ligne 192-197 de `useUnifiedCommandes.ts`) → si produit=recue et plat=expediee, affiche "expediee". Cohérent mais non testé unitairement.

### Verdict : ✅ **Bien séparé, fonctionnel**

---

## SECTION 4 — Audit Réception Composite

### Architecture actuelle

`CompositeReceptionDialog.tsx` (page-level) :
1. Monte `ReceptionDialog` en mode `embedded=true`
2. Monte `DishReceptionSection` en dessous
3. Footer unifié avec statut produit + plat
4. Bouton "Valider réception" unifié

### État de validation
- Produit : état remonté via `onValidationStateChange` → `ReceptionValidationState`
- Plat : état local via `dishReceived` Map
- Validation finale : `allReady = productReady && dishAllConfirmed`

### 🔴 RISQUE P1 — Double exécution / race condition sur `onClose`

**Problème critique identifié** (CompositeReceptionDialog.tsx, ligne 100-117) :

```typescript
// 1. Execute product reception
await productStateRef.current.executeReceive();
// 2. Execute dish reception
await receiveDishCmd.mutateAsync({ ... });
```

Le `executeReceive()` du produit (ReceptionDialog ligne 341-428) appelle `onClose()` à la fin (ligne 421). Or ce `onClose` est la même prop que celle du wrapper composite.

**Conséquence** : Si `executeReceive()` appelle `onClose()`, le composant se démonte AVANT que la réception plat ne s'exécute.

**Gravité** : P1 — La réception plat peut ne jamais s'exécuter en mode composite.

### 🔴 RISQUE P1 — Flow DLC bypassé en mode composite

Le `handleReceive` du produit gère :
1. La mutation de réception
2. Le batch DLC
3. Les refus DLC → retours
4. Les retours manuels

Mais le wrapper composite appelle `productStateRef.current.executeReceive()` qui EST ce `handleReceive`. Le problème : le flow DLC commence par `handleValidateClick` qui vérifie `dlcIssues` et ouvre le dialogue DLC Summary AVANT d'appeler `handleReceive`.

En mode composite, ce dialogue de vérification DLC est **bypassé** car le wrapper appelle directement `executeReceive` sans passer par `requestValidate`.

**Conséquence** : Les produits avec DLC problématiques sont acceptés sans avertissement en mode composite.

**Gravité** : P1 — Contournement silencieux du contrôle DLC.

### Analyse de réversibilité

Si on supprime `CompositeReceptionDialog.tsx` :
- `ReceptionDialog` continue à fonctionner en mode standalone (branche `embedded=false` intacte)
- `DishReceptionDialog` existe aussi en standalone
- Les modules produit et plat ne dépendent PAS du composite
- **→ Réversibilité confirmée à 100%**

### Risques supplémentaires
- **P2** : Le `useEffect` qui remonte l'état produit (ligne 434-445) s'exécute à chaque render sans dépendances → performance OK mais pattern fragile
- **P2** : Le commentaire ligne 117 dit "onClose is already called by product's executeReceive" → confirme le bug P1

### Verdict : ⚠️ **GO CONDITIONNEL — 2 P1 à corriger**

---

## SECTION 5 — Audit Recettes

### État du module

Module `src/modules/recettes/` : **propre, stable, bien isolé**.

- **Tables** : `recipes`, `recipe_lines`, `recipe_types`
- **Création atomique** : RPC `fn_create_recipe_with_lines` (transaction SQL)
- **Tri stable** : `display_order` sur les ingrédients
- **Noms** : normalisation automatique `trim().toUpperCase()`
- **Portions** : nullable, integer, contrainte >= 1 si défini
- **Prix de vente** : `selling_price` + `selling_price_mode` (per_recipe | per_portion)
- **Trigger DB** : force `per_recipe` si portions is NULL

### Sources de vérité
- `recipes.id` → UUID stable pour toute la logique
- `recipe_lines.product_id` → FK vers `products_v2`
- `recipe_lines.unit_id` → FK vers `measurement_units`
- Aucune logique basée sur des noms

### Isolation vérifiée
- Aucun import de `commandes`, `commandesPlats`, `stock`, `inventory`
- Le module food cost IMPORTE depuis recettes (type `SellingPriceMode`) — dépendance unidirectionnelle OK
- Le module B2B listing IMPORTE depuis recettes (via hook `useRecipeB2BListing`) — dépendance unidirectionnelle OK

### Tests mentaux
| Cas | Résultat |
|-----|----------|
| Recette sans portions | ✅ `portions=null`, mode forcé à `per_recipe` |
| Recette avec portions | ✅ `portions>=1`, mode libre |
| Prix vente recette | ✅ `selling_price` + `per_recipe` |
| Prix vente portion | ✅ `selling_price` + `per_portion` |
| Changement de nom | ✅ UUID stable, nom = affichage uniquement |
| Changement de type | ✅ `recipe_type_id` = FK UUID |
| Suppression ingrédient | ✅ `deleteLine` par ID |
| Publication B2B | ✅ Snapshot initial depuis recette, puis édition autonome |

### Risques identifiés
- **P2** : `selling_price` et `selling_price_mode` sont mis à jour APRÈS la RPC de création (2 requêtes, lignes 83-96 de `useRecipes.ts`). Si la 2e échoue, la recette existe sans prix. Acceptable car le prix est optionnel.
- **P3** : Aucun test unitaire pour le hook `useRecipes` lui-même (mais la logique pure est dans le moteur food cost, qui lui est testable)

### Verdict : ✅ **Prêt prod**

---

## SECTION 6 — Audit Food Cost

### État du module

Module `src/modules/foodCost/` : **lecture seule, pur, bien isolé**.

- **Moteur pur** : `foodCostEngine.ts` — zéro React, zéro Supabase
- **Dépendances** : `conditionnementV2` (conversion), `recettes` (type `SellingPriceMode`)
- **Batch loading** : 3 requêtes max (recipes + products + units)
- **Statuts** : complet / partiel / impossible / vide

### Sources de vérité
- `products_v2.final_unit_price` → prix d'achat unitaire (SSOT prix)
- `products_v2.final_unit_id` → unité du prix d'achat
- `products_v2.conditionnement_config` → config BFS pour conversions
- `recipes.selling_price` + `selling_price_mode` → SSOT prix de vente

### Moteur de calcul vérifié

```
Coût ligne = quantity × conversionFactor × final_unit_price
Coût total = Σ(coûts lignes calculables)
Coût/portion = totalCost / portions (si portions >= 1)
Ratio = sellingPrice / coût (selon mode)
```

| Cas | Calcul | Résultat |
|-----|--------|----------|
| Coût complet + prix recette | ratio = selling_price / totalCost | ✅ |
| Coût complet + prix portion | ratio = selling_price / costPerPortion | ✅ |
| Coût partiel | totalCost affiché avec préfixe ≈, ratio = null | ✅ |
| Coût impossible (aucune ligne calculable) | totalCost = 0, status = impossible | ✅ |
| Vide (0 lignes) | status = vide | ✅ |
| Vente vide (selling_price = null) | ratio = null | ✅ |
| Portions nulles | costPerPortion = null, ratio per_recipe seulement | ✅ |

### Isolation vérifiée
- Aucun import de `commandes`, `commandesPlats`, `stock`
- Dépendance vers `recettes` = uniquement le type `SellingPriceMode` → one-way
- Dépendance vers `conditionnementV2` = `findConversionPath` → one-way
- Module supprimable sans impact sur aucun autre module

### Risques identifiés
- **P3** : Le `productsQuery` ne filtre pas les produits archivés. Si un ingrédient de recette pointe vers un produit archivé, le prix sera manquant → status `partiel`. Acceptable (dégradation gracieuse).
- **P3** : Pas de test unitaire pour `computeRecipeCost` (la fonction pure est testable mais non testée actuellement)

### Verdict : ✅ **Prêt prod — lecture seule, aucun risque de mutation**

---

## SECTION 7 — Audit Catalogue Recettes B2B V1

### État du module

Composant `B2BListingSection.tsx` + hook `useRecipeB2BListing.ts` : **isolé et cohérent**.

- **Table** : `b2b_recipe_listings`
- **Upsert** : `onConflict: "establishment_id,recipe_id"` → idempotent
- **Snapshot initial** : nom, portions, recipe_type_id copiés depuis la recette source à la première publication
- **Édition autonome** : après création, la fiche commerciale vit indépendamment
- **Confidentialité** : aucun accès aux `recipe_lines` (ingrédients) depuis le client

### Sources de vérité
- `b2b_recipe_listings.id` → UUID stable pour `commande_plat_lines.listing_id`
- `b2b_recipe_listings.b2b_price` → prix commercial (indépendant de `selling_price`)
- `b2b_recipe_listings.commercial_name` → nom visible client
- `b2b_recipe_listings.is_published` → visibilité catalogue

### Isolation vérifiée
- Aucun import de `commandes`, `products_v2`, `stock`, `food_cost`
- Le hook est dans `src/modules/recettes/hooks/` (rattaché au domaine recette, pas commandes)
- La suppression de `B2BListingSection` ne casse rien d'autre

### Tests mentaux
| Cas | Résultat |
|-----|----------|
| Fournisseur sans recette publiée | ✅ Catalogue masqué (RPC filtre `is_published=true`) |
| Fournisseur avec recettes publiées | ✅ Catalogue visible |
| Client suit un plat | ✅ `b2b_followed_recipes` + `listing_id` |
| Client retire un plat | ✅ Suppression du suivi, pas de la fiche |
| Suppression du module | ✅ Aucun impact sur commandes ou recettes |
| Recette renommée côté fournisseur | ✅ `commercial_name` autonome, pas affecté |

### Risques identifiés
- **P3** : Le `getDishesForSupplier` dans `commandePlatService.ts` fait 2 requêtes (RPC + filtre listings). Si un listing est dépublié entre les deux, le plat apparaît dans le catalogue suivi mais pas dans la commande. Acceptable (dégradation gracieuse).

### Verdict : ✅ **Propre et isolé**

---

## SECTION 8 — Matrice des Risques

| # | Priorité | Module | Risque | Impact | Action |
|---|----------|--------|--------|--------|--------|
| 1 | **P1** | Réception composite | `executeReceive` du produit appelle `onClose` → démontage avant réception plat | Réception plat non exécutée | **Corriger avant prod** : ne pas appeler `onClose` dans `executeReceive` quand `embedded=true` |
| 2 | **P1** | Réception composite | Flow DLC bypassé en mode composite (appel direct `executeReceive` sans `requestValidate`) | Produits avec DLC critique acceptés sans contrôle | **Corriger avant prod** : le wrapper doit appeler `requestValidate` puis exécuter séquentiellement |
| 3 | P2 | Réception produit | ReceptionDialog = 1431 lignes avec 2 branches (embedded/standalone) | Risque de divergence future | Refactor ultérieur |
| 4 | P2 | Réception composite | `useEffect` sans dépendances pour remonter l'état | Re-render inutiles | Ajouter dépendances |
| 5 | P2 | Recettes | Prix de vente mis à jour en 2e requête post-RPC | Recette sans prix si échec | Acceptable (prix optionnel) |
| 6 | P3 | Commande plat | Pas de surplus autorisé en réception plat | Asymétrie avec produits | Documenter comme choix fonctionnel |
| 7 | P3 | Food Cost | `computeRecipeCost` non testé unitairement | Régression possible | Ajouter tests |
| 8 | P3 | Catalogue B2B | Race condition possible entre suivi et dépublication | Dégradation gracieuse | Acceptable |
| 9 | P3 | Services | `as any` cast sur le client Supabase | Pattern projet, cohérent | Acceptable |

---

## SECTION 9 — Réponses Nettes

| Question | Réponse |
|----------|---------|
| Le module commande produit est-il intact ? | **OUI** — aucun import plat, aucune modification de logique métier, tous les flows (DLC, BFS, retours, validation) intacts en mode standalone |
| Le module commande plat est-il bien séparé ? | **OUI** — tables dédiées, edge function dédiée, types dédiés, litiges dédiés, zéro couplage avec produit |
| La réception composite est-elle sûre ? | **NON en l'état** — 2 P1 : (1) `onClose` appelé trop tôt tue la réception plat, (2) flow DLC contourné |
| Recettes est-il prêt prod ? | **OUI** — atomicité RPC, UUID partout, isolation totale |
| Food Cost est-il prêt prod ? | **OUI** — moteur pur, lecture seule, calculs vérifiés |
| Le catalogue recettes B2B V1 est-il propre et isolé ? | **OUI** — snapshot autonome, confidentialité préservée, supprimable sans impact |
| Y a-t-il un risque de casse si on part en prod ? | **OUI si le composite n'est pas corrigé** — les 2 P1 peuvent causer une réception plat silencieusement ignorée et un contournement DLC |

---

## SECTION 10 — Verdict Final

### Peut-on partir en prod ?

**GO CONDITIONNEL.**

### Conditions obligatoires avant prod :

1. **Corriger P1 #1** : Dans `ReceptionDialog.handleReceive`, quand `embedded=true`, ne PAS appeler `onClose()`. Laisser le wrapper composite gérer la fermeture après les deux réceptions.

2. **Corriger P1 #2** : Dans `CompositeReceptionDialog.handleUnifiedValidate`, appeler `productStateRef.current.requestValidate()` (qui gère le flow DLC) au lieu de passer directement au dialogue de confirmation. Puis enchaîner la réception plat après confirmation.

### Ce qui peut attendre :

- Le refactor du `ReceptionDialog` (1431 lignes, 2 branches) → post-prod
- Les tests unitaires du moteur Food Cost → post-prod
- La documentation du choix "pas de surplus plat" → post-prod

### Ce qui est safe :

- Module commande produit : **safe**
- Module commande plat : **safe**
- Module recettes : **safe**
- Module food cost : **safe**
- Catalogue B2B V1 : **safe**
- Table `order_groups` : **safe** (liaison additive, nullable)
- Unified list (`useUnifiedCommandes`) : **safe** (lecture seule, page-level)

### Résumé en une phrase :

> **Les modules métier sont solides et bien isolés. La seule fissure se trouve dans le wrapper de réception composite qui contourne 2 contrôles critiques (fermeture prématurée + bypass DLC). Corriger ces 2 points et c'est un GO.**

---

*Audit réalisé le 2026-03-09 par analyse statique exhaustive du code source.*
*Fichiers analysés : 25+ fichiers dans 6 modules, ~5000 lignes de code auditées.*
