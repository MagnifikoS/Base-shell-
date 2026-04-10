# Audit Architecture des Unités — Pourquoi le matching par nom existe

**Date :** 2026-03-25  
**Scope :** Architecture réelle `measurement_units`, import B2B, snapshots, matching par nom  
**Méthode :** Audit factuel basé sur le code source et les migrations SQL

---

## 0. Reformulation simple du problème

L'application possède un module central d'unités. Chaque établissement a ses propres unités dans `measurement_units`. Les produits pointent vers ces unités par UUID. En théorie, tout devrait fonctionner par ID.

**Pourtant**, dans le flow B2B (commandes inter-organisations), le code fait du matching par **nom et abréviation** d'unité. La question est : pourquoi ?

---

## 1. Architecture réelle de la table des unités

### Structure

```sql
-- Migration 20260205230035
CREATE TABLE public.measurement_units (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'base',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(establishment_id, abbreviation)
);
```

### Faits clés

| Fait | Conséquence |
|------|-------------|
| `id` = `gen_random_uuid()` | Chaque ligne a un UUID **unique généré à l'insertion** |
| `establishment_id` est NOT NULL + FK | Chaque unité **appartient à un seul établissement** |
| Contrainte UNIQUE sur `(establishment_id, abbreviation)` | Pas deux "kg" dans le même établissement, mais deux établissements ont chacun **leur propre** "kg" avec un **UUID différent** |

### Conclusion section 1

> **Les unités ne sont PAS globales.** Elles sont **dupliquées par établissement** avec des UUID distincts. "Carton" chez le fournisseur et "Carton" chez le client sont **deux lignes différentes avec deux UUID différents.**

---

## 2. Processus d'import des unités à la création d'un établissement

### Recherche effectuée

Aucune fonction `fn_seed_units`, `fn_create_establishment`, ou `seed_measurement_units` n'a été trouvée dans le code source ou les migrations.

### Mécanisme observé

Les unités sont injectées par des **migrations SQL directes** qui insèrent des lignes dans `measurement_units` pour les établissements existants. Exemple (migration `20260211071254`) :

```sql
-- Les conversions sont créées par jointure sur abbreviation + establishment_id
SELECT g.id, kg.id, 0.001, g.establishment_id
FROM measurement_units g
JOIN measurement_units kg 
  ON kg.abbreviation = 'kg' 
  AND kg.establishment_id = g.establishment_id
WHERE g.abbreviation = 'g'
```

### Conclusion section 2

> Il n'existe **aucune fonction de seeding automatique** à la création d'un établissement. Les unités sont créées manuellement (UI Settings) ou injectées par migration. Chaque établissement reçoit **des copies physiques** avec **de nouveaux UUID** (`gen_random_uuid()`). C'est une **copie physique, pas une référence partagée**.

---

## 3. Lien réel produit ↔ unités

### Champs d'unité sur `products_v2`

| Champ | Type | Référence |
|-------|------|-----------|
| `final_unit_id` | UUID FK → `measurement_units(id)` | Unité de référence |
| `stock_handling_unit_id` | UUID FK → `measurement_units(id)` | Unité de manipulation stock |
| `delivery_unit_id` | UUID FK → `measurement_units(id)` | Unité de livraison |
| `supplier_billing_unit_id` | UUID FK → `measurement_units(id)` | Unité de facturation fournisseur |
| `kitchen_unit_id` | UUID FK → `measurement_units(id)` | Unité cuisine |
| `price_display_unit_id` | UUID FK → `measurement_units(id)` | Unité d'affichage prix |
| `min_stock_unit_id` | UUID FK → `measurement_units(id)` | Unité de stock minimum |

### Portée des IDs

Tous ces champs pointent vers `measurement_units` qui est **scopé par établissement**. Donc :
- Un produit de l'établissement A a `final_unit_id = UUID-A-kg`
- Un produit de l'établissement B a `final_unit_id = UUID-B-kg`
- **Ces deux UUID sont différents** même si c'est "la même unité" sémantiquement

### `conditionnement_config` (JSONB)

Ce champ stocke la configuration de conditionnement complète, incluant des UUID d'unités dans :
- `packagingLevels[].type_unit_id`
- `packagingLevels[].contains_unit_id`
- `equivalence.source_unit_id`
- `equivalence.unit_id`
- `priceLevel.billed_unit_id`

Tous ces UUID doivent être **locaux** à l'établissement du produit.

### Conclusion section 3

> Les produits pointent vers des unités **locales à leur établissement**. Deux établissements n'ont jamais les mêmes UUID d'unité, même pour "kg". La cohérence repose sur le fait que les UUID du produit et ceux de `measurement_units` sont dans le même `establishment_id`.

---

## 4. Comportement réel de l'import B2B produit

### Pipeline d'import (6 phases)

Le pipeline est implémenté dans `src/modules/clientsB2B/services/` :

#### Phase B — Mapping des unités (`b2bUnitMapper.ts`)

C'est **ici** que le matching par nom se produit structurellement :

```typescript
// 1. Match par (famille, abréviation) — signal le plus fort
const abbrMatches = localUnits.filter(
  lu => lu.family === sourceUnit.family &&
        normalize(lu.abbreviation) === normalize(sourceUnit.abbreviation)
);

// 2. Match par (famille, nom normalisé)
const nameMatches = localUnits.filter(lu => {
  if (lu.family !== sourceUnit.family) return false;
  return normalizeUnitText(lu.name) === normalizeUnitText(sourceUnit.name);
});

// 3. Match par aliases
const aliasMatches = localUnits.filter(lu => {
  if (lu.family !== sourceUnit.family) return false;
  return lu.aliases?.some(a => normalizeUnitText(a) === normalizeUnitText(sourceUnit.name));
});
```

**Pourquoi ?** Parce que le fournisseur a `UUID-FOURNISSEUR-kg` et le client a `UUID-CLIENT-kg`. Ce sont deux UUID distincts. Le pipeline **doit** retrouver l'équivalent local par nom/abréviation/famille.

#### Phase D — Remapping de `conditionnement_config` (`b2bConfigRebuilder.ts`)

Tous les UUID du fournisseur dans `conditionnement_config` sont remplacés par les UUID locaux du client :

```typescript
function rebuildConditionnementConfig(sourceConfig, unitMappings) {
  const uuidMap = buildUuidMap(unitMappings); // source UUID → local UUID
  // Remap final_unit_id, packagingLevels, equivalence, priceLevel
}
```

#### Phase F — Commit atomique (`fn_import_b2b_product_atomic`)

La fonction SQL reçoit les UUID **déjà remappés** côté frontend. Elle insère directement les UUID locaux du client.

### Conclusion section 4

> **Le lien par ID se perd au moment de l'import B2B**, parce que les unités du fournisseur et du client ont des UUID différents. Le pipeline d'import **doit** matcher par nom/abréviation/famille pour construire une table de correspondance `UUID-fournisseur → UUID-client`, puis remapper tous les UUID dans le produit importé.

---

## 5. Où et pourquoi le matching par nom apparaît

### Inventaire complet des occurrences

| Fichier | Mécanisme | Pourquoi |
|---------|-----------|----------|
| `b2bUnitMapper.ts` (Phase B import) | Match par famille+abréviation, famille+nom, aliases | Import B2B : les UUID fournisseur n'existent pas côté client |
| `b2bConfigRebuilder.ts` (Phase D import) | Utilise la table de mapping Phase B | Remapper `conditionnement_config` en UUID locaux |
| `useErpQuantityLabels.ts` (Pass 2, lignes 250-266) | Match par nom/abréviation du `fallbackLabel` | Affichage fournisseur : le `canonical_unit_id` de la commande est un UUID client, inutilisable dans le contexte BFS fournisseur |
| `b2bQuantity.ts` (`findMatchingUnit`) | Match par nom/abréviation | Translation client→fournisseur dans les modals de préparation |
| `fn_convert_b2b_quantity` (SQL, step 5) | Match par `lower(trim(name))` + `family` | Backend : quand le BFS échoue car l'UUID client est étranger au graphe fournisseur |
| `fn_convert_b2b_quantity` (SQL, step 6) | Remap via `conditionnement_config` + match nom | Backend : dernier recours, retrouver un UUID local dans le config |

### Pourquoi le code n'utilise pas un ID direct

**Parce qu'il n'en existe pas.** Les deux établissements ont des UUID distincts pour la même unité sémantique. Il n'y a aucune table de mapping `unit_mapping(source_unit_id, target_unit_id)` persistée. Le matching par nom est le **seul pont** entre les deux espaces d'UUID.

### Est-ce un vrai besoin ou un contournement ?

> C'est un **besoin structurel** causé par l'architecture de duplication des unités par établissement. Ce n'est pas un bug, c'est une **conséquence directe** du design.

---

## 6. Rôle réel des snapshots d'unité

### `unit_label_snapshot` (sur `commande_lines`)

- **Ce qu'il contient :** Le nom de l'unité au moment de la création de la commande (ex: "Carton", "kg")
- **Pourquoi il existe :** Préserver l'affichage même si l'unité est renommée ou supprimée après la commande
- **Comment il est utilisé en B2B :** C'est le **pont textuel** entre les deux espaces d'UUID. Quand le fournisseur consulte une commande, le `canonical_unit_id` est un UUID client (inutilisable). Le système utilise `unit_label_snapshot` pour matcher dans le contexte BFS du fournisseur.

### `canonical_unit_id` (sur `commande_lines`)

- **Ce qu'il contient :** L'UUID de l'unité du client (`measurement_units.id` de l'établissement client)
- **Qui peut l'utiliser :** Uniquement le client (c'est son UUID local)
- **Problème B2B :** Le fournisseur ne peut **pas** utiliser cet UUID car il n'existe pas dans son `measurement_units`

### Rôle du snapshot en B2B

> Le `unit_label_snapshot` est **devenu un pont B2B faute de vraie identité partagée**. Il compense l'absence d'une table de mapping inter-organisations persistée. C'est un **fallback structurel**, pas un bug accidentel.

---

## 7. Explication de la contradiction apparente

### Hypothèse théorique
> "Les unités viennent d'un module central, donc elles devraient être partagées et identifiées par ID."

### Réalité prouvée par le code

**L'hypothèse est partiellement fausse.** Les unités viennent d'un "module central" dans le sens où elles sont gérées dans la page Settings, mais elles sont **physiquement dupliquées** par établissement avec des UUID distincts. Il n'y a pas de "module plateforme" qui partage des UUID entre organisations.

### Voici exactement ce qui se passe

```
Organisation NONNA (fournisseur)
  └── Établissement NONNA
       └── measurement_units
            ├── uuid-nonna-kg  (name="kg", abbreviation="kg")
            ├── uuid-nonna-pce (name="Pièce", abbreviation="pce")
            └── uuid-nonna-car (name="Carton", abbreviation="car")

Organisation PICCOLO (client)
  └── Établissement PICCOLO
       └── measurement_units
            ├── uuid-piccolo-kg  (name="kg", abbreviation="kg")
            ├── uuid-piccolo-pce (name="Pièce", abbreviation="pce")
            └── uuid-piccolo-car (name="Carton", abbreviation="car")
```

**Même nom, même abréviation, UUID différent.** Le seul lien possible entre `uuid-nonna-kg` et `uuid-piccolo-kg` est la correspondance textuelle `name="kg"`.

### Lequel des énoncés est vrai ?

| Énoncé | Vrai/Faux |
|--------|-----------|
| Les unités ne sont pas réellement partagées | ✅ **VRAI** — chaque établissement a sa propre copie |
| Les unités sont copiées avec de nouveaux IDs | ✅ **VRAI** — `gen_random_uuid()` à chaque insertion |
| Le produit importé perd le lien direct | ✅ **VRAI** — les UUID fournisseur sont remappés vers des UUID client |
| Le `conditionnement_config` est remappé avec des IDs locaux | ✅ **VRAI** — via `b2bConfigRebuilder.ts` |
| Le B2B travaille avec deux espaces d'IDs différents | ✅ **VRAI** — c'est la cause racine |

**Tous les 5 sont vrais simultanément.** C'est cohérent : l'architecture de duplication crée 5 conséquences qui sont toutes réelles.

---

## 8. Conséquences sur le B2B

### Impact par flow

| Flow B2B | Impact | Mécanisme de contournement actuel |
|----------|--------|----------------------------------|
| **Import produit** | UUID fournisseur → remapping obligatoire vers UUID client | `b2bUnitMapper.ts` + `b2bConfigRebuilder.ts` (matching par nom/abréviation/famille) |
| **Création commande** | Le client stocke ses UUID. OK. | Pas de problème — single-org |
| **Affichage fournisseur** | `canonical_unit_id` = UUID client, inutilisable | `useErpQuantityLabels` Pass 2 : fetch le produit source du fournisseur via `b2b_imported_products`, match le `unit_label_snapshot` par nom |
| **Préparation fournisseur** | Doit convertir qté client → qté fournisseur | `b2bQuantity.ts` → `findMatchingUnit` (match par nom/abréviation) |
| **Expédition (backend)** | `fn_ship_commande` reçoit des qtés en espace client | `fn_convert_b2b_quantity` : 7 stratégies de résolution dont match par nom |
| **Réception client** | Le client reçoit ses propres UUID. OK. | Pas de problème — single-org |
| **Litiges** | Stock fournisseur touché par retour | `fn_convert_b2b_quantity` pour reconvertir |
| **Snapshots de commande** | `unit_label_snapshot` = seul lien cross-org | Pont textuel, pas un ID |

### Le matching par nom est-il aujourd'hui inévitable ?

> **OUI**, avec l'architecture actuelle. Il n'existe aucune table de mapping persisté `(source_unit_id, target_unit_id, relationship)` entre les établissements. Le seul pont entre les deux espaces d'UUID est la correspondance textuelle (nom, abréviation, famille).

### Existe-t-il une structure plus fiable qu'on n'utilise pas ?

> **NON.** La table `b2b_imported_products` lie les produits (`local_product_id ↔ source_product_id`) mais **pas les unités**. Il n'existe aucun équivalent pour les unités.

---

## 9. Conclusion claire

### A. Comment fonctionne réellement la table des unités

`measurement_units` est scopée par `establishment_id`. Chaque établissement a sa propre copie indépendante avec des UUID générés aléatoirement. Il n'y a pas de référentiel global partagé.

### B. Les unités sont-elles partagées globalement ou dupliquées ?

**Dupliquées par établissement.** Chaque établissement a ses propres lignes avec ses propres UUID. "kg" chez NONNA ≠ "kg" chez PICCOLO au niveau UUID.

### C. Pourquoi le matching par nom existe aujourd'hui

Parce que les UUID sont **locaux** à chaque établissement, et qu'il n'existe **aucune table de mapping inter-établissements** pour les unités. Le nom/abréviation/famille est le **seul identifiant sémantique commun** entre deux espaces d'UUID.

### D. À quel moment le lien par ID se perd

**Le lien par ID n'a jamais existé entre établissements.** Les UUID sont générés indépendamment à la création de chaque établissement. Le seul moment où un "lien" est créé est lors de l'import B2B, quand le pipeline construit une table de correspondance éphémère (en mémoire, non persistée) par matching textuel.

### E. Ce matching est-il structurellement normal ou révélateur d'un bug ?

**C'est structurellement normal** vu l'architecture actuelle de duplication. Ce n'est pas un bug, c'est une **conséquence directe** du design initial qui a choisi de dupliquer les unités par établissement plutôt que de les partager via un référentiel global.

Cela dit, c'est un **point de fragilité** :
- Si un établissement renomme "Carton" en "Ctn", le matching casse
- Si deux unités ont le même nom mais des sémantiques différentes, le matching est faux
- Les aliases atténuent partiellement ce risque

### F. Quelle est la vraie source de vérité unité dans l'app

| Contexte | Source de vérité |
|----------|-----------------|
| Intra-établissement | `measurement_units.id` (UUID local) — fiable à 100% |
| Inter-établissements (B2B) | **Il n'y en a pas de formelle.** Le système repose sur la convention textuelle (même nom + même famille = même unité) |
| Import B2B (ponctuel) | `b2bUnitMapper.ts` construit un mapping éphémère par correspondance textuelle |
| Affichage B2B (runtime) | `useErpQuantityLabels` + `b2bQuantity.ts` + `fn_convert_b2b_quantity` refont du matching textuel à chaque appel |

---

## STOP

### Résumé en une phrase

> Le matching par nom dans le B2B est **structurellement inévitable** car les unités sont dupliquées par établissement avec des UUID indépendants, et il n'existe aucun référentiel d'identité partagé entre organisations — le texte (nom, abréviation, famille) est aujourd'hui le **seul pont** entre les deux espaces d'UUID.
