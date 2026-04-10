# Catalogue Recettes B2B — Audit stratégique complet

> **Statut :** Audit + Recommandation — Aucun code à produire avant validation.  
> **Date :** 2026-03-09  
> **Contrainte absolue :** Totalement isolé du catalogue produit B2B existant.

---

## SECTION 1 — Audit des identités du module Recettes

### Résultat : ✅ Solide — tout repose sur des UUIDs

| Entité | ID unique (UUID) | Champ texte comme clé ? | Verdict |
|--------|:---:|:---:|---------|
| `recipes.id` | ✅ | Non | Stable |
| `recipes.recipe_type_id` | ✅ FK → `recipe_types.id` | Non | Stable |
| `recipe_types.id` | ✅ | Non | Stable |
| `recipe_lines.id` | ✅ | Non | Stable |
| `recipe_lines.recipe_id` | ✅ FK → `recipes.id` | Non | Stable |
| `recipe_lines.product_id` | ✅ FK → `products_v2.id` | Non | Stable |
| `recipe_lines.unit_id` | ✅ FK → `measurement_units.id` | Non | Stable |

**Aucune dépendance texte dangereuse détectée.** Le filtrage par type se fait via `recipe_type_id` (UUID), pas par nom. Les noms sont purement cosmétiques (affichage). Si un utilisateur renomme une recette ou un type, aucune logique métier ne casse.

**Points vérifiés :**
- `RecipeListView` filtre par `r.recipe_type_id === filterTypeId` → UUID ✅
- `RecipeDetail` résout le nom du type via `recipeTypes.find(t => t.id === recipe?.recipe_type_id)` → UUID ✅
- Création via RPC `fn_create_recipe_with_lines` passe `_recipe_type_id` → UUID ✅
- Les noms sont normalisés en UPPERCASE mais uniquement pour l'affichage

**Conclusion :** Le module Recettes est prêt à servir de base au catalogue recettes B2B. Toute future entité de publication peut se lier par `recipe_id` UUID en toute sécurité.

---

## SECTION 2 — Audit du B2B existant

### Architecture actuelle du B2B Produit

| Composant | Rôle | Réutilisable pour recettes ? |
|-----------|------|:---:|
| `b2b_partnerships` | Lien fournisseur ↔ client | ✅ OUI — même relation |
| `b2b_invitation_codes` | Création de partenariat | ✅ OUI — inchangé |
| `b2b_imported_products` | Traçabilité import produit | ❌ NON — spécifique produit |
| `fn_get_b2b_catalogue` (RPC) | Lecture catalogue fournisseur | ❌ NON — retourne `products_v2` |
| `fn_import_b2b_product_atomic` (RPC) | Import atomique produit | ❌ NON — crée un `products_v2` |
| `B2BCatalogBrowser` (composant) | UI de browsing catalogue | 🔶 Pattern réutilisable, code non |
| `PartnershipList` | Liste des partenaires | ✅ OUI — point d'accroche pour onglet |
| Notifications changement prix | Alerte client si prix fournisseur change | 🔶 Pattern réutilisable si nouvelle entité |

### Ce qu'on peut réutiliser

1. **La relation `b2b_partnerships`** — Le lien fournisseur/client existe déjà. Le catalogue recettes se branche sur le même `partnership_id`.
2. **L'infrastructure de partenariat** — Codes d'invitation, validation, liste partenaires.
3. **Le pattern SECURITY DEFINER** — Pour exposer les recettes du fournisseur au client sans accès direct.
4. **Le pattern d'onglets** — Dans l'espace partenaire, ajouter un onglet "Catalogue recettes" à côté de "Catalogue produits".

### Ce qu'il ne faut SURTOUT PAS toucher

1. **`fn_get_b2b_catalogue`** — Ne pas modifier, ne pas étendre. Créer une RPC séparée.
2. **`fn_import_b2b_product_atomic`** — Ne pas modifier. L'import recette aura sa propre RPC.
3. **`b2b_imported_products`** — Table dédiée produits. Ne pas y mettre de recettes.
4. **`B2BCatalogBrowser`** — Ne pas ajouter de logique recette dedans. Créer un composant dédié.
5. **`commande_lines`** — FK vers `product_id`. Ne pas y ajouter un `recipe_id`.

---

## SECTION 3 — Audit du risque côté Commandes

### Hypothèses actuelles du module Commandes

Le module Commandes est **entièrement construit autour de `products_v2`** :

| Hypothèse | Preuve code | Risque si on mélange |
|-----------|-------------|:---:|
| `CommandeLine.product_id` → `products_v2.id` | FK dans la table + types TS | 🔴 CRITIQUE |
| `CartItem.productId` = toujours un produit | Utilisé pour créer les lignes | 🔴 CRITIQUE |
| `PreparationDialog` résout le produit via `b2b_imported_products.local_product_id` | Code explicite | 🔴 CRITIQUE |
| `ReceptionDialog` utilise `products_v2` pour stock, DLC, unités | Requête directe | 🔴 CRITIQUE |
| Prix snapshot = `final_unit_price` du produit | Logique à l'envoi | 🟡 MOYEN |
| ERP quantity labels = basé sur config produit | `useErpQuantityLabels` | 🔴 CRITIQUE |

### Verdict Commandes

**Le module Commandes ne doit PAS être étendu pour les recettes.** Il est trop couplé à `products_v2` (unités, conditionnement, stock, DLC, BFS). Mélanger serait une source de bugs garantie.

**Stratégie recommandée :**
- Phase 1 : Catalogue recettes B2B sans commande (consultation + import uniquement)
- Phase 2 (future, optionnelle) : Commandes recettes = module séparé `commandes-recettes` avec ses propres tables (`commande_recette_lines` etc.)
- **Jamais** de mélange dans `commande_lines`

### Points spécifiques à ne pas fragiliser

- Le flow `Préparation → Expédition → Réception` suppose des mouvements de stock (BL, stock_events). Les recettes n'ont pas de stock.
- Le calcul de facturation snapshot (`unit_price_snapshot`, `line_total_snapshot`) est basé sur le prix unitaire produit. Pour une recette, la logique de prix est différente.

---

## SECTION 4 — Analyse de la bonne structure cible

### Option A — Exposer la recette brute

| + | - |
|---|---|
| Simple | Le client verrait la composition interne (ingrédients) = fuite d'information |
| Pas de nouvelle table | Pas de contrôle sur ce qui est exposé |
| | Couplage direct au module Recettes |

**Verdict : ❌ Non recommandé**

### Option B — Créer un faux `products_v2`

| + | - |
|---|---|
| Réutilise le pipeline existant | Viole la règle d'or (pas de mélange) |
| | Pollue le référentiel produit |
| | Casse Food Cost et inventaire |

**Verdict : ❌ Interdit** (contrainte non négociable)

### Option C — Entité commerciale dédiée ✅ RECOMMANDÉ

Créer une table `b2b_recipe_listings` :

```
b2b_recipe_listings
├── id                      UUID PK
├── establishment_id        UUID FK → establishments (fournisseur)
├── recipe_id               UUID FK → recipes
├── is_published             boolean (visible dans le catalogue)
├── b2b_price_mode           enum('fixed', 'coefficient')
├── b2b_fixed_price          numeric | null
├── b2b_coefficient          numeric | null  (ex: 1.3 = food cost × 1.3)
├── b2b_price_per_portion    boolean (prix affiché = par portion ou par recette)
├── created_at              timestamptz
├── updated_at              timestamptz
└── UNIQUE(establishment_id, recipe_id)
```

**Pourquoi :**
- La recette reste intacte dans son module
- L'entité commerciale porte uniquement les infos B2B (prix, visibilité)
- Le client ne voit jamais la composition (ingrédients protégés)
- Supprimable sans impact : `DROP TABLE b2b_recipe_listings` et c'est fini

### Côté client : table d'import

```
b2b_imported_recipes
├── id                      UUID PK
├── establishment_id        UUID FK → establishments (client)
├── source_establishment_id UUID FK → establishments (fournisseur)
├── source_listing_id       UUID FK → b2b_recipe_listings
├── local_name              text (nom snapshot ou personnalisé)
├── last_known_price        numeric (gelé à l'import, mis à jour par sync)
├── price_per_portion       boolean
├── imported_at             timestamptz
├── imported_by             UUID
└── UNIQUE(establishment_id, source_listing_id)
```

**Avantages :**
- Le client a sa propre copie de référence
- Pas de FK vers `recipes` directement (isolation cross-org)
- Le prix est tracé et synchronisable
- Supprimable indépendamment

---

## SECTION 5 — Analyse de la stratégie prix

### Sources de vérité actuelles

| Donnée | Source | Table/Champ |
|--------|--------|-------------|
| Prix de vente recette | `recipes.selling_price` | Défini par le créateur |
| Mode prix (recette/portion) | `recipes.selling_price_mode` | `per_recipe` ou `per_portion` |
| Portions | `recipes.portions` | Nombre de portions |
| Food cost (coût matière) | Calculé dynamiquement | `Σ(recipe_lines.quantity × product.final_unit_price)` |

### Stratégie prix B2B recommandée

Le fournisseur choisit dans `b2b_recipe_listings` :

**Mode 1 — Prix fixe :**
- `b2b_price_mode = 'fixed'`
- `b2b_fixed_price = 25.00` (ex: 25€ la recette)
- Indépendant du food cost → stable, prévisible

**Mode 2 — Coefficient sur food cost :**
- `b2b_price_mode = 'coefficient'`
- `b2b_coefficient = 1.5` (food cost × 1.5)
- Le prix évolue automatiquement avec le coût des ingrédients
- ⚠️ Plus complexe : nécessite un calcul côté serveur lors de la consultation

### Compatibilité avec le mécanisme de notification prix existant

Le B2B produit a déjà un système de détection de changement de prix. Pour les recettes :
- **Prix fixe** : notification si le fournisseur change `b2b_fixed_price` → même pattern que produit
- **Coefficient** : notification si le prix calculé change significativement → plus complexe, phase 2

**Recommandation :** Commencer avec le mode **prix fixe uniquement**. Le coefficient est une optimisation future.

### Prix affiché côté client

| Cas | Prix affiché |
|-----|-------------|
| Recette entière, pas de portions | `b2b_fixed_price` |
| Recette portionnable, prix par recette | `b2b_fixed_price` + indication "X portions" |
| Recette portionnable, prix par portion | `b2b_fixed_price / portions` |

---

## SECTION 6 — Isolation / visibilité / supprimabilité

### Condition d'affichage du catalogue recettes

Le client voit l'onglet "Catalogue recettes" chez un fournisseur partenaire **uniquement si** :

```sql
SELECT EXISTS (
  FROM b2b_recipe_listings
  WHERE establishment_id = <supplier_establishment_id>
    AND is_published = true
)
```

Si le fournisseur n'a aucune recette publiée → onglet invisible. Pas de hack, une simple requête.

### Architecture d'isolation

```
src/modules/catalogueRecettesB2B/    ← NOUVEAU MODULE ISOLÉ
├── index.ts                          (barrel export)
├── types.ts                          (B2BRecipeListing, B2BImportedRecipe)
├── components/
│   ├── B2BRecipeCatalogBrowser.tsx   (consultation catalogue fournisseur)
│   ├── B2BRecipePublishToggle.tsx    (fournisseur: publier/dépublier)
│   └── B2BImportedRecipesList.tsx    (client: ses recettes importées)
├── hooks/
│   ├── useB2BRecipeCatalog.ts        (query catalogue fournisseur)
│   ├── useB2BRecipePublish.ts        (mutations publication)
│   └── useB2BImportedRecipes.ts      (query recettes importées client)
├── services/
│   └── b2bRecipeCatalogService.ts    (RPC calls)
└── pages/
    └── B2BRecipeCatalogPage.tsx      (page principale)
```

**Tables dédiées :**
- `b2b_recipe_listings` (fournisseur)
- `b2b_imported_recipes` (client)

**Zéro FK vers :**
- `products_v2`
- `commande_lines`
- `b2b_imported_products`

### Test de supprimabilité

Si on supprime le module :
1. `DROP TABLE b2b_imported_recipes, b2b_recipe_listings;`
2. `rm -rf src/modules/catalogueRecettesB2B/`
3. Supprimer route dans `App.tsx`
4. Supprimer entrée dans `navRegistry.ts` + `sidebarSections.ts`
5. **Résultat** : tout le reste fonctionne (B2B produit ✅, Commandes ✅, Recettes ✅, Food Cost ✅)

---

## SECTION 7 — Verdict final

### L'idée est-elle saine ?

**✅ OUI.** Commercialiser des recettes en B2B est un besoin métier légitime et complémentaire au catalogue produit existant.

### Est-ce faisable proprement ?

**✅ OUI**, à condition de respecter l'isolation stricte :

| Prérequis | Statut |
|-----------|--------|
| Module Recettes repose sur UUIDs | ✅ Vérifié |
| Aucune dépendance texte dans les recettes | ✅ Vérifié |
| B2B partnerships réutilisable | ✅ Vérifié |
| Commandes produit non impactées | ✅ Par design (tables séparées) |
| Entité commerciale dédiée (`b2b_recipe_listings`) | 📋 À créer |
| RPC dédiées (catalogue + import) | 📋 À créer |
| Module frontend isolé | 📋 À créer |

### Ce qu'il faut absolument éviter

1. ❌ Ajouter un `recipe_id` dans `commande_lines`
2. ❌ Modifier `fn_get_b2b_catalogue` pour retourner aussi des recettes
3. ❌ Réutiliser `b2b_imported_products` pour les recettes
4. ❌ Transformer une recette en `products_v2`
5. ❌ Exposer les ingrédients (recipe_lines) au client partenaire
6. ❌ Baser une logique sur le nom de la recette plutôt que son UUID
7. ❌ Mélanger les commandes produits et recettes dans une même table

### Plan d'implémentation recommandé

| Étape | Scope | Testable ? |
|-------|-------|:---:|
| **1** | Créer les tables `b2b_recipe_listings` + RLS | ✅ |
| **2** | RPC `fn_get_b2b_recipe_catalogue` (lecture catalogue) | ✅ |
| **3** | UI fournisseur : publier/dépublier ses recettes | ✅ |
| **4** | UI client : onglet "Catalogue recettes" dans l'espace partenaire | ✅ |
| **5** | Table `b2b_imported_recipes` + RPC d'import | ✅ |
| **6** | UI client : voir ses recettes importées (sous-onglet "Plats" dans Produits V2 ou espace dédié) | ✅ |
| **7** | Notifications changement de prix (si prix fixe change) | ✅ |
| **8 (futur)** | Mode coefficient sur food cost | ✅ |
| **9 (futur)** | Commandes recettes (module séparé) | ✅ |

### Comment procéder

1. **Valider ce document** avec les décideurs métier
2. **Implémenter étape par étape** — chaque étape est un PR isolé et testable
3. **Ne jamais toucher** aux modules existants (Commandes, B2B Produit, Produits V2)
4. **Le module est optionnel** — feature flag dans `featureFlags.ts` pour activer/désactiver

---

> **Rappel :** Ce document est la stratégie. Pas de code avant validation.  
> Le but : améliorer l'app sans casser ce qui marche, sans mélanger les domaines, sans créer de dette.
