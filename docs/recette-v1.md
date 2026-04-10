# Recette V1 — Document de validation pré-implémentation

> **Statut :** Validation requise avant implémentation  
> **Date :** 2026-03-09  
> **Objectif :** Vérifier l'isolation totale, la visibilité des données, et la structure visuelle de la V1 du Catalogue Recettes B2B

---

## SECTION 1 — Réponse sur l'isolation

### La V1 est-elle complètement isolée ? **OUI.**

Voici la réponse module par module :

| Module existant | Impacté ? | Détail |
|---|---|---|
| **Produits V2** (`products_v2`, `src/modules/produitsV2/`) | ❌ NON | Aucune table, hook, composant ou service touché. Les recettes commercialisées ne deviennent jamais des `products_v2`. |
| **Catalogue Produit B2B** (`fn_get_b2b_catalogue`, `B2BCatalogBrowser`, `useB2BCatalog`) | ❌ NON | Le moteur de catalogue produit reste strictement inchangé. Le catalogue recettes utilise ses propres tables, hooks et composants. |
| **Commandes Produit** (`commandes`, `commande_lines`, `src/modules/commandes/`) | ❌ NON | Aucun impact. Les commandes de recettes ne font PAS partie de la V1. Le module Commandes existant ne voit que des `products_v2`. |
| **Inventaire** (`inventory_sessions`, `inventory_lines`, `src/modules/inventaire/`) | ❌ NON | Aucun lien. Les recettes commercialisées n'entrent pas dans l'inventaire. |
| **Food Cost** (`src/modules/foodCost/`) | ❌ NON | Le module Food Cost continue à calculer les coûts sur les recettes internes. Le catalogue B2B ne touche pas ce calcul. |
| **Recettes** (`recipes`, `recipe_lines`, `src/modules/recettes/`) | ⚠️ LECTURE SEULE | Point de branchement minimal : on **lit** `recipes.id`, `recipes.name`, `recipes.selling_price`, `recipes.portions`, `recipes.selling_price_mode` pour alimenter la publication. **Aucune modification** des tables ou de la logique recette existante. |
| **B2B Partnerships** (`b2b_partnerships`) | ⚠️ LECTURE SEULE | On **lit** les partenariats existants pour savoir quel client est lié à quel fournisseur. **Aucune modification** de la table ou de la logique existante. |

### Points de branchement minimum (lecture seule)

1. **`recipes`** → lecture de `id`, `name`, `selling_price`, `portions`, `selling_price_mode`, `establishment_id`
2. **`recipe_types`** → lecture de `id`, `name`, `icon` pour l'affichage dans le catalogue
3. **`b2b_partnerships`** → lecture de `id`, `supplier_establishment_id`, `client_establishment_id`, `status` pour conditionner la visibilité

**Aucune écriture, aucun trigger, aucun ALTER sur ces tables.**

---

## SECTION 2 — Ce que voit le client

### Ce que le client VOIT dans le catalogue recettes fournisseur

| Donnée | Visible | Source |
|---|---|---|
| Nom de la recette | ✅ | `recipes.name` (via `b2b_recipe_listings`) |
| Type de recette | ✅ | `recipe_types.name` + `icon` |
| Prix B2B de la recette entière | ✅ | `b2b_recipe_listings.b2b_fixed_price` |
| Prix B2B par portion (si applicable) | ✅ | Calculé : `b2b_fixed_price / recipes.portions` |
| Nombre de portions | ✅ | `recipes.portions` |
| Nom du fournisseur | ✅ | Via le partenariat |
| Statut "déjà importé/suivi" | ✅ | Présence dans `b2b_imported_recipes` |

### Ce que le client NE VOIT **JAMAIS**

| Donnée protégée | Visible | Raison |
|---|---|---|
| **Liste des ingrédients** | ❌ JAMAIS | `recipe_lines` n'est jamais exposée via la RPC catalogue recettes |
| **Quantités des ingrédients** | ❌ JAMAIS | Même raison |
| **Produits internes du fournisseur** | ❌ JAMAIS | Aucun lien vers `products_v2` du fournisseur |
| **Food Cost du fournisseur** | ❌ JAMAIS | Le coût de revient est propriétaire et n'apparaît dans aucune donnée exposée |
| **Marge du fournisseur** | ❌ JAMAIS | Non calculable sans food cost |
| **Unités internes des ingrédients** | ❌ JAMAIS | Non exposées |

### Garantie technique

La RPC `fn_get_b2b_recipe_catalogue` (à créer) ne joindera **que** :
- `b2b_recipe_listings` (publication commerciale)
- `recipes` (nom, portions, selling_price_mode)
- `recipe_types` (nom, icône)

Elle ne joindera **JAMAIS** `recipe_lines` ni `products_v2`.

**Principe : le client achète un "plat fini", pas une recette décomposée.**

---

## SECTION 3 — Structure visuelle dans l'app

### A. Côté fournisseur

#### Où il publie une recette B2B

Dans la **page détail d'une recette** (`RecipeDetailView`), un nouveau bloc apparaît :

```
┌─────────────────────────────────────────────┐
│  📋 TARTE CITRON MERINGUÉE                  │
│  Type: Dessert · 8 portions · PV: 32,00€   │
│                                             │
│  ── Ingrédients ──                          │
│  Beurre ......... 250g                      │
│  Sucre .......... 200g                      │
│  ...                                        │
│                                             │
│  ── Commercialisation B2B ──────────────────│
│  [Toggle] Commercialiser cette recette      │
│  Prix B2B : [___32,00€___]                  │
│  Statut : 🟢 Publiée                       │
└─────────────────────────────────────────────┘
```

#### Où il voit ses recettes commercialisées

Dans la **page Recettes**, un filtre ou badge indique les recettes publiées en B2B. Pas de page supplémentaire — on reste dans le module Recettes existant.

```
┌─────────────────────────────────────────────┐
│  🍳 Recettes                    [⚙] [+Créer]│
│  [Recherche_____________________]           │
│  [Tous] [Entrées] [Plats] [Desserts]        │
│                                             │
│  Tarte Citron Meringuée    32,00€  🏷️ B2B  │
│  Risotto Truffe            28,00€  🏷️ B2B  │
│  Sauce Béarnaise           12,00€           │
│  Crème Brûlée              18,00€           │
└─────────────────────────────────────────────┘
```

Le badge `🏷️ B2B` est un simple indicateur visuel. Pas de nouvelle page.

---

### B. Côté client

#### Espace fournisseur partenaire (page existante modifiée)

Quand le client entre dans un partenaire fournisseur, il voit **deux onglets** :

```
┌─────────────────────────────────────────────┐
│  ← Retour   BOUCHERIE MARTIN               │
│                                             │
│  [Catalogue produits]  [Catalogue recettes] │
│  ─────────────────────────────────────────  │
│                                             │
│  (contenu de l'onglet sélectionné)          │
└─────────────────────────────────────────────┘
```

**Règle de visibilité :**
- L'onglet `Catalogue recettes` n'apparaît **QUE** si le fournisseur a au moins 1 recette publiée en B2B
- Si aucune recette publiée → l'onglet est masqué → le client ne voit que `Catalogue produits` (comportement identique à aujourd'hui)

#### Contenu de l'onglet "Catalogue recettes"

```
┌─────────────────────────────────────────────┐
│  Catalogue recettes — BOUCHERIE MARTIN      │
│  [Recherche_____________________]           │
│  [Tous] [Entrées] [Plats] [Desserts]        │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🍰 Tarte Citron Meringuée          │    │
│  │    Dessert · 8 portions             │    │
│  │    Prix: 32,00€ · Portion: 4,00€   │    │
│  │    [Suivre]                         │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ 🍝 Risotto Truffe                  │    │
│  │    Plat · 6 portions               │    │
│  │    Prix: 28,00€ · Portion: 4,67€   │    │
│  │    [✓ Suivi]                        │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**Note :** Aucun ingrédient visible. Le client voit un "plat commercial", pas une fiche technique.

#### Où le client retrouve ses recettes suivies

Les recettes suivies/importées apparaissent dans une **nouvelle entrée sidebar dédiée** (voir Section 4).

```
┌─────────────────────────────────────────────┐
│  🍽️ Plats fournisseurs                     │
│  [Recherche_____________________]           │
│                                             │
│  ── BOUCHERIE MARTIN ──                     │
│  🍰 Tarte Citron Meringuée   32,00€        │
│  🍝 Risotto Truffe           28,00€        │
│                                             │
│  ── PRIMEUR DUPONT ──                       │
│  🥗 Salade César             14,00€        │
└─────────────────────────────────────────────┘
```

---

## SECTION 4 — Recommandation de navigation

### Principe directeur

**Produits = matières premières. Recettes/Plats = produits finis.**  
Ce sont deux domaines métier distincts → ils doivent avoir des entrées de navigation distinctes.

### Structure recommandée

#### Sidebar — Section "Achats & Stock"

```
📦 Produits              ← products_v2 (inchangé)
📋 Inventaire            ← inchangé
🛒 Commandes             ← commandes produit (inchangé)
📄 Factures              ← inchangé
🍽️ Plats fournisseurs    ← NOUVEAU (recettes B2B importées/suivies)
```

#### Sidebar — Section "Production"

```
🍳 Recettes              ← module recettes (inchangé)
📊 Food Cost             ← inchangé
```

### Pourquoi "Plats fournisseurs" et pas "Recettes fournisseurs" ?

- **Éviter la confusion** : "Recettes" existe déjà dans la sidebar pour les fiches techniques internes
- **Clarté métier** : côté client, ce ne sont pas des recettes décomposées — ce sont des plats finis commercialisés
- **Séparation mentale** : le client ne "cuisine" pas ces plats, il les achète

### Où Produits V2 reste ?

**Exactement au même endroit.** Aucun changement de navigation pour les produits. L'entrée "Plats fournisseurs" est une entrée **additionnelle** qui n'existe que si le client a au moins un fournisseur avec des recettes publiées.

### Faut-il un sous-onglet dans Produits V2 ?

**NON.** Les plats fournisseurs ne sont pas des produits. Les mettre dans Produits V2 créerait de la confusion et violerait le principe d'isolation.

---

## SECTION 5 — Vue projetée de l'UX

### Sidebar complète (vue client ayant des fournisseurs B2B avec recettes)

```
┌──────────────────────┐
│  🏠 Accueil          │
│                      │
│  ── Achats & Stock ──│
│  📦 Produits         │
│  📋 Inventaire       │
│  🛒 Commandes        │
│  📄 Factures         │
│  🍽️ Plats fourniss.  │  ← NOUVEAU
│                      │
│  ── Production ──────│
│  🍳 Recettes         │
│  📊 Food Cost        │
│                      │
│  ── B2B ─────────────│
│  🤝 Partenaires      │
│                      │
│  ── RH ──────────────│
│  👥 Employés         │
│  📅 Planning         │
│  ⏱️ Présence          │
│  💰 Paie             │
└──────────────────────┘
```

### Page partenaire fournisseur (vue client)

```
┌─────────────────────────────────────────────────────────┐
│  ← Partenaires                                          │
│                                                         │
│  ┌──────────────────────────────────────┐               │
│  │  🏪 BOUCHERIE MARTIN                │               │
│  │  SIRET: 123 456 789 00012           │               │
│  │  📍 12 rue du Commerce, Paris       │               │
│  └──────────────────────────────────────┘               │
│                                                         │
│  ┌──────────────────┐ ┌──────────────────┐              │
│  │ Catalogue        │ │ Catalogue        │              │
│  │ produits   (124) │ │ recettes    (8)  │              │
│  └──────────────────┘ └──────────────────┘              │
│                                                         │
│  ════════════════════════════════════════                │
│  (Contenu de l'onglet actif)                            │
│                                                         │
│  Si "Catalogue recettes" :                              │
│  ┌─────────────────────────────────────────┐            │
│  │ [Recherche_________________________]    │            │
│  │ [Tous] [Entrées] [Plats] [Desserts]     │            │
│  │                                         │            │
│  │ 🍰 Tarte Citron Meringuée              │            │
│  │    Dessert · 8 portions                 │            │
│  │    32,00€ entier · 4,00€/portion        │            │
│  │    [Suivre]                             │            │
│  │                                         │            │
│  │ 🍝 Risotto Truffe                      │            │
│  │    Plat · 6 portions                    │            │
│  │    28,00€ entier · 4,67€/portion        │            │
│  │    [✓ Suivi]                            │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

### Page "Plats fournisseurs" (vue client — ses recettes suivies)

```
┌─────────────────────────────────────────────────────────┐
│  🍽️ Plats fournisseurs                                 │
│  Recettes commercialisées par vos partenaires           │
│                                                         │
│  [Recherche_________________________]                   │
│  [Tous fournisseurs ▼]                                  │
│                                                         │
│  ── BOUCHERIE MARTIN ──────────────────────             │
│  │ 🍰 Tarte Citron Meringuée                           │
│  │    Dessert · 8 portions                              │
│  │    32,00€ · 4,00€/portion                            │
│  │                                                      │
│  │ 🍝 Risotto Truffe                                   │
│  │    Plat · 6 portions                                 │
│  │    28,00€ · 4,67€/portion                            │
│                                                         │
│  ── PRIMEUR DUPONT ────────────────────────             │
│  │ 🥗 Salade César                                     │
│  │    Entrée · 4 portions                               │
│  │    14,00€ · 3,50€/portion                            │
└─────────────────────────────────────────────────────────┘
```

### Vue fournisseur — Détail recette avec bloc B2B

```
┌─────────────────────────────────────────────────────────┐
│  ← Recettes                                            │
│                                                         │
│  📋 TARTE CITRON MERINGUÉE                              │
│  Type: Dessert · 8 portions · PV: 32,00€               │
│                                                         │
│  ── Ingrédients ────────────────────────                │
│  Beurre doux ................ 250 g                     │
│  Sucre en poudre ............ 200 g                     │
│  Œufs ....................... 6 pièce                    │
│  Citron jaune ............... 4 pièce                   │
│  Farine T55 ................. 300 g                     │
│                                                         │
│  ── Commercialisation B2B ──────────────────            │
│  ┌─────────────────────────────────────────┐            │
│  │  Commercialiser cette recette  [Toggle] │            │
│  │                                         │            │
│  │  Prix B2B : [  32,00€  ]               │            │
│  │  Statut : 🟢 Publiée auprès de         │            │
│  │           3 partenaires                 │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
```

---

## SECTION 6 — Verdict final

### Est-ce propre ?

**OUI.** La V1 repose sur :
- **2 nouvelles tables** (`b2b_recipe_listings`, `b2b_imported_recipes`) qui ne touchent à aucune table existante
- **1 nouvelle RPC** (`fn_get_b2b_recipe_catalogue`) qui fait de la lecture seule sur `recipes` + `recipe_types`
- **1 nouveau module frontend** (`src/modules/catalogueRecettesB2B/`) totalement indépendant
- **Zéro modification** des modules Produits V2, Commandes, Inventaire, Food Cost

### Est-ce compréhensible pour l'utilisateur ?

**OUI.**
- Le fournisseur publie dans un endroit qu'il connaît déjà (détail de sa recette)
- Le client voit un onglet supplémentaire clair chez son fournisseur
- Le client retrouve ses plats dans une page dédiée avec un nom explicite
- Aucun mélange visuel entre produits et plats

### Est-ce bien isolé ?

**OUI.** Test de supprimabilité :
- Supprimer `src/modules/catalogueRecettesB2B/` → l'app fonctionne
- Supprimer les tables `b2b_recipe_listings` + `b2b_imported_recipes` → aucun impact sur le reste
- Supprimer l'entrée nav "Plats fournisseurs" dans `navRegistry.ts` → aucun impact
- Supprimer l'onglet "Catalogue recettes" dans la page partenaire → retour au comportement actuel

### Est-ce une bonne V1 ?

**OUI.** Cette V1 couvre le besoin minimal :
1. Le fournisseur peut publier des recettes commercialisables
2. Le client peut les découvrir et les suivre
3. Les prix sont clairs (entier + portion)
4. Les ingrédients restent confidentiels
5. Aucune régression possible

### Ce qui est explicitement HORS V1

| Fonctionnalité | Statut | Raison |
|---|---|---|
| Commander des recettes | ❌ Hors V1 | Nécessite un module Commandes Recettes séparé |
| Coefficient sur food cost | ❌ Hors V1 | Complexité de synchronisation prix |
| Notification de changement de prix | ❌ Hors V1 | Peut être ajouté en V2 sans impact |
| Import de la composition (ingrédients) | ❌ JAMAIS | Violation du secret de fabrication |

### Prérequis à verrouiller avant implémentation

1. ✅ Tables `recipes`, `recipe_types` identifiées par UUID — **confirmé**
2. ✅ Aucun code existant ne repose sur les noms de recettes comme clé — **confirmé**
3. ✅ Le B2B produit existant n'est pas impacté — **confirmé**
4. ✅ Le module Commandes n'est pas impacté — **confirmé**
5. ⬜ Créer les tables `b2b_recipe_listings` et `b2b_imported_recipes` avec RLS
6. ⬜ Créer la RPC `fn_get_b2b_recipe_catalogue`
7. ⬜ Créer le module frontend `src/modules/catalogueRecettesB2B/`
8. ⬜ Ajouter l'entrée nav conditionnelle dans `navRegistry.ts`

---

*Ce document fait foi. Aucune implémentation ne doit commencer avant validation de ce document.*
