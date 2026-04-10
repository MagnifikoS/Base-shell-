# AUDIT — Refactoring Global des Unités

> Date : 2026-03-25
> Statut : Audit factuel — aucun code produit

---

## REFORMULATION DU PROBLÈME

L'application dispose d'une table `platform_unit_templates` (35 unités) servant de modèle. À la création d'un établissement, la fonction SQL `platform_create_organization_wizard` copie ces templates dans `measurement_units` **avec de nouveaux UUID** (`gen_random_uuid()`). Résultat : 7 établissements × ~35 unités = 245 lignes en base, aucune partageant un ID.

Conséquence directe : le B2B ne peut **jamais** comparer des UUID d'unités entre organisations. Tout le pipeline est contraint de matcher par nom/abréviation.

---

## 1. ÉTAT ACTUEL

### 1.1 Architecture DB

| Table | Rôle | Scope |
|-------|------|-------|
| `platform_unit_templates` | Modèle de seed (35 lignes) | Global plateforme |
| `measurement_units` | Données vivantes (245 lignes, 7 établissements) | Par établissement |

**Colonnes clés de `measurement_units`** : `id, establishment_id, organization_id, name, abbreviation, category, family, is_reference, is_system, usage_category, display_order, aliases`

### 1.2 Processus de seed

```sql
-- Dans platform_create_organization_wizard :
INSERT INTO measurement_units (establishment_id, organization_id, ...)
SELECT v_est_id, v_org_id, t.name, t.abbreviation, ...
FROM platform_unit_templates t
```

→ **Copie physique**, nouveaux UUID. Aucun lien FK vers le template source.

### 1.3 Où `measurement_units` est utilisée (135 fichiers)

**Frontend (hooks/composants)** :
- `src/hooks/useUnits.ts` — Hook SSOT de lecture
- `src/core/unitConversion/` — BFS engine (11 fichiers)
- `src/modules/produitsV2/` — Wizard produit, sélection d'unités
- `src/modules/inventaire/` — Sessions d'inventaire
- `src/modules/stockLedger/` — `buildCanonicalLine.ts`
- `src/modules/visionAI/` — Extraction factures
- `src/modules/recettes/` — Ingrédients recettes
- `src/lib/units/` — `formatErpQuantity`, `displayUnitName`

**Backend (SQL)** :
- `fn_convert_b2b_quantity` (V4) — 155 lignes, 7 étapes de résolution
- `fn_product_unit_price_factor` — BFS SQL
- `fn_ship_commande` — Expédition
- `fn_resolve_litige` — Litiges
- `fn_validate_threshold_product` — Seuils inventaire

### 1.4 Points de matching par nom (LE PROBLÈME)

| Fichier | Mécanisme | Pourquoi |
|---------|-----------|----------|
| `b2bUnitMapper.ts` | `normalizeUnitText()` → match par (family, abbreviation), puis (family, name), puis aliases | Import produit B2B : remappage UUID fournisseur → UUID client |
| `b2bConfigRebuilder.ts` | `buildUuidMap()` → remap UUID dans JSONB `conditionnement_config` | Les UUIDs dans le config sont ceux du fournisseur |
| `b2bQuantity.ts` | `findMatchingUnit()` — match par nom/abréviation | Translation quantité client→fournisseur (PreparationDialog) |
| `useErpQuantityLabels.ts` (Pass 2) | `fallbackLabel.toLowerCase().trim()` → match contre options BFS | Affichage ERP côté fournisseur |
| `fn_convert_b2b_quantity` (étape 5) | `lower(trim(v_client_name)) = lower(trim(v_supplier_name))` | Matching sémantique SQL cross-tenant |
| `fn_convert_b2b_quantity` (étape 6) | Extraction UUID du `conditionnement_config` → match par nom | Remappage UUID via config JSONB |
| Migration `20260319203647` | `local_mu.name = foreign_mu.name AND local_mu.family = foreign_mu.family` | Reset stock négatif cross-tenant |

**Total : 7 points de matching par nom actifs en production.**

---

## 2. CLASSIFICATION DES UNITÉS

### 2.1 Unités physiques (globales par nature)

Tirées de `platform_unit_templates` :

| Nom | Abréviation | Famille | is_reference |
|-----|-------------|---------|:------------:|
| Pièce | pce | count | ✅ |
| Kilogramme | kg | weight | ✅ |
| Gramme | g | weight | |
| Litre | L | volume | ✅ |
| Millilitre | ml | volume | |
| Centilitre | cl | volume | |
| Unité | u | count | |

**Total : 7 unités physiques universelles**

Ces unités ont une **valeur absolue** : 1 kg = 1000 g partout sur la planète. Elles DOIVENT avoir un UUID global unique.

### 2.2 Unités de conditionnement (par produit)

| Nom | Abréviation | Famille | Catégorie |
|-----|-------------|---------|-----------|
| Carton | car | count | packaging |
| Boîte | bte | count | packaging |
| Sachet | sach | count | packaging |
| Sac | sac | count | packaging |
| Pack | pack | count | packaging |
| Bouteille | bout | count | packaging |
| ... (20 de plus) | ... | count | packaging |

**Total : 23 unités de conditionnement**

Ces unités n'ont **aucune valeur absolue** : 1 Carton = 10 Pièces pour un produit, 200 pour un autre. Leur conversion est TOUJOURS définie par `conditionnement_config` du produit.

### 2.3 Unités ambiguës (5 doublons détectés)

| Nom | Catégories trouvées | Problème |
|-----|--------------------|----------|
| Dose | `base` ET `packaging` | Double définition |
| Portion | `base` ET `packaging` | Double définition |
| Tranche | `base` ET `packaging` | Double définition |
| Petite cuillère | `base` ET `packaging` | Double définition |
| Grande cuillère | `base` ET `packaging` | Double définition |

→ Ces 5 unités existent en double dans la table avec des catégories différentes. Source de confusion pour les Select UI et le matching.

---

## 3. DESIGN CIBLE

### 3.1 Nouvelle table `global_units`

```sql
CREATE TABLE public.global_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  abbreviation TEXT NOT NULL UNIQUE,
  family      TEXT NOT NULL,  -- 'weight', 'volume', 'count'
  category    TEXT NOT NULL,  -- 'physical' ou 'packaging'
  is_reference BOOLEAN NOT NULL DEFAULT false,
  aliases     TEXT[] DEFAULT '{}',
  display_order INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Pas de `establishment_id`**. Un seul enregistrement par unité, un seul UUID.

### 3.2 Contenu initial (35 lignes)

Exactement le contenu actuel de `platform_unit_templates`, migré avec des UUID **stables et déterministes**.

### 3.3 Impact sur `measurement_units`

**Phase transitoire** : `measurement_units` conservée avec une nouvelle colonne `global_unit_id UUID REFERENCES global_units(id)`.

**Phase finale** : toutes les FK qui pointent vers `measurement_units` sont migrées vers `global_units`. `measurement_units` est supprimée (ou vidée et conservée pour compatibilité).

### 3.4 Impact sur `products_v2`

6 colonnes FK à migrer :
- `final_unit_id`
- `supplier_billing_unit_id`
- `stock_handling_unit_id`
- `delivery_unit_id`
- `kitchen_unit_id`
- `price_display_unit_id`

Toutes pointeront vers `global_units.id` au lieu de `measurement_units.id`.

### 3.5 Impact sur `conditionnement_config` (JSONB)

Tous les UUID dans le JSONB (`final_unit_id`, `type_unit_id`, `contains_unit_id`, `source_unit_id`, `unit_id`, `billed_unit_id`) deviennent des `global_units.id`.

**CONFIRMATION** : Le conditionnement produit reste la source **unique** de toute logique de conversion. `global_units` ne porte **aucune** conversion.

---

## 4. IMPACT SUR LE CODE

### 4.1 Frontend — Fichiers à modifier

| Fichier | Action | Détail |
|---------|--------|--------|
| `src/hooks/useUnits.ts` | **Refactorer** | Lire `global_units` au lieu de `measurement_units` filtré par `establishment_id` |
| `src/core/unitConversion/*.ts` | **Adapter** | Les types `UnitWithFamily` pointent vers global |
| `src/modules/produitsV2/` | **Adapter** | Selects d'unités lisent `global_units` |
| `src/modules/inventaire/` | **Adapter** | Résolution unités via global |
| `src/modules/stockLedger/buildCanonicalLine.ts` | **Adapter** | Lookup dans `global_units` |
| `src/lib/units/formatErpQuantity.ts` | **Inchangé** | Travaille déjà avec `ReachableUnit[]` (pas de DB direct) |

### 4.2 Frontend — Code à SUPPRIMER

| Fichier | Ce qui disparaît |
|---------|-----------------|
| `b2bUnitMapper.ts` | **TOUT LE FICHIER** — le matching par nom n'a plus de raison d'être |
| `b2bConfigRebuilder.ts` | **TOUT LE FICHIER** — plus de remappage UUID cross-tenant |
| `b2bQuantity.ts` | **`findMatchingUnit()`** — plus de matching par nom |
| `useErpQuantityLabels.ts` | **Pass 2 / matching par label** — les UUID sont directement comparables |

### 4.3 Frontend — Code qui RESTE

| Composant | Pourquoi |
|-----------|----------|
| `resolveProductUnitContext` (BFS) | Le graphe de conversion par produit reste nécessaire |
| `formatErpQuantity` | L'affichage ERP multi-niveaux reste nécessaire |
| `computeDisplayBreakdown` | La décomposition reste nécessaire |
| `useErpQuantityLabels` (Pass 1 seulement) | L'affichage côté propriétaire reste valide |

### 4.4 Backend — Simplification SQL

**`fn_convert_b2b_quantity`** (actuellement 7 étapes) :

| Étape actuelle | Avec global_units |
|---------------|-------------------|
| 1. Get supplier's stock_handling_unit_id | ✅ Reste |
| 2. Get supplier unit metadata | ✅ Reste (mais via `global_units`) |
| 3. Same UUID → identity | ✅ **SUFFIT DANS 90% DES CAS** (même ID partout) |
| 4. BFS conversion | ✅ Reste (pour cas Carton→Pièce) |
| 5. Cross-tenant name+family match | ❌ **SUPPRIMÉE** |
| 6. Remap via conditionnement_config | ❌ **SUPPRIMÉE** |
| 7. Error fallback | ✅ Reste |

**Résultat : de 7 étapes à 4 étapes. Étapes 5 et 6 (matching par nom) supprimées.**

---

## 5. STRATÉGIE DE MIGRATION

### Phase 0 : Préparation (1 jour)

1. Résoudre les 5 doublons ambigus (Dose, Portion, Tranche, Petite/Grande cuillère)
   - Décider : sont-elles `base` ou `packaging` ?
   - Fusionner les lignes en double dans `platform_unit_templates`

### Phase 1 : Création `global_units` (migration SQL, ~30 min)

```sql
-- 1. Créer la table
CREATE TABLE global_units (...);

-- 2. Remplir depuis platform_unit_templates
INSERT INTO global_units (id, name, abbreviation, ...)
SELECT gen_random_uuid(), name, abbreviation, ...
FROM platform_unit_templates;

-- 3. Ajouter FK de liaison dans measurement_units
ALTER TABLE measurement_units ADD COLUMN global_unit_id UUID REFERENCES global_units(id);

-- 4. Backfill la liaison par (name, abbreviation)
UPDATE measurement_units mu
SET global_unit_id = gu.id
FROM global_units gu
WHERE lower(trim(mu.name)) = lower(trim(gu.name))
  AND lower(trim(mu.abbreviation)) = lower(trim(gu.abbreviation));
```

### Phase 2 : Double-écriture (1-2 jours)

**Sans downtime** : les nouvelles FK pointent vers `global_units`, les anciennes restent.

1. Ajouter des colonnes parallèles sur `products_v2` :
   - `global_final_unit_id`, `global_stock_handling_unit_id`, etc.
2. Les remplir via la liaison `measurement_units.global_unit_id`
3. Modifier le frontend pour lire les nouvelles colonnes **en priorité**, fallback sur les anciennes

### Phase 3 : Migration données (1-2 jours)

**Tables à migrer** (21 tables, 49 colonnes FK vers `measurement_units`) :

| Table | Colonnes FK |
|-------|-------------|
| `products_v2` | 6 colonnes (final_unit_id, stock_handling_unit_id, etc.) |
| `commande_lines` | canonical_unit_id |
| `bl_app_lines` | canonical_unit_id |
| `bl_withdrawal_lines` | canonical_unit_id |
| `stock_events` | canonical_unit_id |
| `stock_document_lines` | canonical_unit_id |
| `app_invoice_lines` | canonical_unit_id |
| `inventory_articles` | canonical_unit_id, min_stock_unit_id |
| `inventory_session_lines` | canonical_unit_id |
| `recipe_ingredients` | unit_id |
| `retour_lines` | canonical_unit_id |
| ... et ~10 autres |

**Migration JSONB** (`conditionnement_config` dans `products_v2`) :

```sql
-- Pour chaque produit, remapper les UUID locaux vers globaux
UPDATE products_v2 p
SET conditionnement_config = rebuild_config_global(
  p.conditionnement_config,
  (SELECT jsonb_object_agg(mu.id::text, mu.global_unit_id::text)
   FROM measurement_units mu
   WHERE mu.establishment_id = p.establishment_id)
);
```

### Phase 4 : Cleanup (1 jour)

1. Supprimer les colonnes `global_*` temporaires
2. Renommer les FK pour pointer vers `global_units`
3. Supprimer `b2bUnitMapper.ts`, `b2bConfigRebuilder.ts`
4. Simplifier `fn_convert_b2b_quantity` (supprimer étapes 5-6)
5. Modifier `platform_create_organization_wizard` pour NE PLUS copier les unités
6. Décider du sort de `measurement_units` (garder vide ou supprimer)

### Phase 5 : Validation

Voir section 8.

---

## 6. RISQUES

### 6.1 Risques de perte de données

| Risque | Probabilité | Mitigation |
|--------|:-----------:|-----------|
| UUID non mappable (unité custom ajoutée par un établissement) | Faible | Audit pré-migration : compter les unités sans correspondance globale |
| Corruption JSONB lors du remap conditionnement_config | Moyen | Exécuter en transaction, backup avant, valider JSON après |
| FK orphelines après suppression measurement_units | Faible | Migration séquentielle avec vérification |

### 6.2 Unités non classables

Les 5 doublons (Dose, Portion, etc.) doivent être résolus AVANT la migration. Si un établissement a ajouté des unités customs non présentes dans `platform_unit_templates`, elles n'auront pas de correspondance globale.

**Vérification nécessaire** :
```sql
SELECT mu.name, mu.abbreviation, mu.establishment_id
FROM measurement_units mu
LEFT JOIN platform_unit_templates pt
  ON lower(trim(mu.name)) = lower(trim(pt.name))
WHERE pt.name IS NULL;
```

### 6.3 Impacts UI

- Les `<Select>` d'unités changeront de source (`global_units` au lieu de `measurement_units`)
- Le hook `useUnits` n'aura plus besoin de `establishment_id` comme filtre
- Les Settings d'unités par établissement deviennent obsolètes (ou limités à activer/désactiver)

### 6.4 B2B Import Pipeline

Le pipeline actuel (`b2bImportPipeline.ts`) fait :
1. Fetch unités fournisseur
2. Fetch unités client
3. Match par nom → `UnitMappingResult[]`
4. Remap config → `rebuildConditionnementConfig()`

Avec `global_units` :
1. ~~Fetch unités fournisseur~~ → inutile
2. ~~Fetch unités client~~ → inutile
3. ~~Match par nom~~ → **les UUID sont identiques**
4. ~~Remap config~~ → **le config est directement utilisable**

**Le pipeline B2B import se réduit à une simple copie de produit sans transformation d'unités.**

---

## 7. NIVEAU DE CHANTIER

### C'est un REFACTORING STRUCTUREL PROFOND.

Pourquoi :
- Modification du modèle de données fondamental (unités)
- 21 tables avec FK à migrer
- Migration JSONB critique (conditionnement_config)
- Suppression de modules entiers (b2bUnitMapper, b2bConfigRebuilder)
- Simplification de fonctions SQL critiques (fn_convert_b2b_quantity)
- Impact sur 135 fichiers qui référencent `measurement_units`

Ce n'est PAS une amélioration incrémentale. C'est un changement de paradigme : passer d'un système distribué (unités par tenant) à un système centralisé (unités globales).

### Estimation réaliste

| Phase | Effort |
|-------|--------|
| Phase 0 : Résolution doublons + audit | 0.5 jour |
| Phase 1 : Création global_units + liaison | 0.5 jour |
| Phase 2 : Double-écriture frontend | 2 jours |
| Phase 3 : Migration données (21 tables + JSONB) | 2-3 jours |
| Phase 4 : Cleanup + suppression legacy | 1 jour |
| Phase 5 : Tests E2E | 1-2 jours |
| **Total** | **7-9 jours** |

---

## 8. PLAN D'EXÉCUTION

### Étapes concrètes par ordre

```
1. [AUDIT]     Vérifier unités customs hors template         → 0.5j
2. [DB]        Résoudre 5 doublons ambigus                   → 0.5j
3. [DB]        Créer global_units + remplir                  → 0.5j
4. [DB]        Ajouter global_unit_id sur measurement_units  → 0.5j
5. [DB]        Backfill liaison measurement→global           → 0.5j
6. [FRONTEND]  Adapter useUnits pour lire global_units       → 1j
7. [DB]        Migrer FK products_v2 → global_units          → 1j
8. [DB]        Migrer conditionnement_config JSONB            → 1j
9. [DB]        Migrer 15 autres tables (commande_lines, etc.) → 1j
10. [BACKEND]  Simplifier fn_convert_b2b_quantity             → 0.5j
11. [FRONTEND] Supprimer b2bUnitMapper + b2bConfigRebuilder   → 0.5j
12. [FRONTEND] Simplifier useErpQuantityLabels (Pass 2)       → 0.5j
13. [FRONTEND] Simplifier b2bQuantity.ts                      → 0.5j
14. [DB]       Modifier wizard pour ne plus copier unités     → 0.5j
15. [TEST]     Validation E2E complète                        → 1-2j
```

### Quick Wins (faisables immédiatement, valeur rapide)

1. **Créer `global_units`** et la liaison `global_unit_id` — sans casser l'existant
2. **Ajouter `global_unit_id`** sur `measurement_units` et backfiller — pur SQL, zero risque
3. Ces 2 étapes permettent ensuite une migration **progressive** table par table

### Refactor long (nécessite coordination)

4. Migration des 21 tables FK
5. Migration JSONB
6. Suppression du code legacy

---

## 9. VALIDATION

### Matrice de tests

| Scénario | Ce qui doit fonctionner |
|----------|----------------------|
| Création produit | Sélection d'unité fonctionne (même liste, UUID global) |
| Conditionnement produit | Config JSONB utilise des UUID globaux |
| Commande B2B (client→fournisseur) | Quantités correctes sans matching par nom |
| Préparation fournisseur | Affichage ERP correct avec UUID identiques |
| Expédition | `fn_ship_commande` utilise UUID globaux |
| Réception client | Quantités cohérentes |
| Litige | `fn_resolve_litige` → stock mouvements corrects |
| Import produit B2B | Produit copié SANS remappage d'unités |
| Inventaire | Sessions avec unités globales |
| Retrait stock | Unités de retrait résolues correctement |
| Affichage ERP | `formatErpQuantity` inchangé |
| Nouvel établissement | NE copie PLUS les unités (utilise `global_units` directement) |

### Requêtes de validation pré/post migration

```sql
-- Pré-migration : vérifier couverture du mapping
SELECT COUNT(*) AS total,
       COUNT(global_unit_id) AS mapped,
       COUNT(*) - COUNT(global_unit_id) AS unmapped
FROM measurement_units;

-- Post-migration : vérifier intégrité FK
SELECT 'products_v2' AS tbl, COUNT(*) AS broken
FROM products_v2 p
WHERE p.stock_handling_unit_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM global_units g WHERE g.id = p.stock_handling_unit_id);

-- Post-migration : vérifier JSONB
SELECT p.id, p.conditionnement_config
FROM products_v2 p
WHERE p.conditionnement_config IS NOT NULL
  AND p.conditionnement_config::text LIKE '%"type_unit_id"%'
  AND NOT EXISTS (
    SELECT 1 FROM global_units g
    WHERE p.conditionnement_config->>'final_unit_id' = g.id::text
  );
```

---

## CONCLUSION

### A. Architecture réelle actuelle
`measurement_units` est copiée physiquement par établissement depuis `platform_unit_templates`, avec de nouveaux UUID à chaque copie.

### B. Les unités sont DUPLIQUÉES, pas partagées
7 établissements × 35 unités = 245 lignes, 0 UUID en commun.

### C. Le matching par nom existe car c'est la SEULE identité stable cross-tenant
Le nom "Carton" est le même partout, pas l'UUID.

### D. Le lien par ID se perd à l'étape `platform_create_organization_wizard`
C'est là que `gen_random_uuid()` crée de nouveaux UUID pour chaque copie.

### E. Classification des unités

| Type | Nombre | Doit être global ? | Conversion globale ? |
|------|:------:|:------------------:|:-------------------:|
| Physiques (kg, g, L, ml, pce, cl, u) | 7 | ✅ OUI | ✅ OUI (1kg = 1000g) |
| Conditionnement (Carton, Boîte...) | 23 | ✅ OUI (pour UUID stable) | ❌ NON (dépend du produit) |
| Ambiguës (Dose, Portion...) | 5 | ⚠️ À résoudre | À décider |

### F. Le matching par nom est STRUCTURELLEMENT ANORMAL
C'est le symptôme direct d'une architecture où les unités sont dupliquées au lieu d'être partagées. Avec `global_units`, les 7 points de matching par nom disparaissent.

### G. Source de vérité cible
- **Identité des unités** → `global_units` (UUID unique plateforme)
- **Logique de conversion** → `conditionnement_config` par produit (inchangé)
- **Aucune logique métier** ne doit être portée par l'unité elle-même

---

**STOP**
