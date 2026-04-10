# REFACTORING — Unification des Unités (Global Units)

> Document de conception — v1 — 2026-03-25

---

## Table des matières

1. [Analyse de l'existant](#1-analyse-de-lexistant)
2. [Design cible](#2-design-cible)
3. [Stratégie de migration](#3-stratégie-de-migration)
4. [Impact code frontend](#4-impact-code-frontend)
5. [Impact backend](#5-impact-backend)
6. [Risques](#6-risques)
7. [Plan d'exécution](#7-plan-dexécution)
8. [Validation](#8-validation)

---

## 1. Analyse de l'existant

### 1.1 Architecture actuelle de `measurement_units`

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | UUID (gen_random_uuid) | PK — **unique par établissement** |
| `organization_id` | UUID FK | Org parente |
| `establishment_id` | UUID FK | **Scope physique** — chaque établissement a ses propres rows |
| `name` | text | Nom affiché (ex: "Carton") |
| `abbreviation` | text | Abréviation (ex: "car") |
| `family` | text | Famille (weight, volume, count) |
| `aliases` | text[] | Alias alternatifs |
| `is_reference` | boolean | Unité de référence de la famille |
| `is_system` | boolean | Non supprimable |
| `category` | text | Catégorie d'usage |

**Chiffres actuels en prod :**
- **245 rows** dans `measurement_units`
- **7 établissements**
- **36 noms d'unités uniques**
- ≈ 35 rows/établissement (copie identique)
- "Carton" existe en **7 UUID différents** (un par établissement)

### 1.2 Mécanisme de duplication

À la création d'un établissement, la fonction `fn_create_establishment_for_org` (migration `20260225093111`) exécute :

```sql
INSERT INTO measurement_units (establishment_id, organization_id, ...)
SELECT v_est_id, v_org_id, t.name, t.abbreviation, ...
FROM platform_unit_templates t;
```

Chaque `INSERT` génère un **nouveau UUID** via `gen_random_uuid()`. L'unité "Carton" n'est **jamais partagée** — elle est recréée à chaque établissement.

### 1.3 Endroits où le matching par nom existe

#### A. `b2bUnitMapper.ts` (import B2B)
- **Fichier :** `src/modules/clientsB2B/services/b2bUnitMapper.ts`
- **Fonction :** `mapSingleUnit()` — compare `normalizeUnitText(abbreviation)`, puis `name`, puis `aliases`
- **Raison :** Lors de l'import d'un produit fournisseur, les UUID d'unités sont ceux du fournisseur → il faut retrouver l'équivalent local chez le client

#### B. `b2bConfigRebuilder.ts` (remapping conditionement)
- **Fichier :** `src/modules/clientsB2B/services/b2bConfigRebuilder.ts`
- **Fonction :** `rebuildConditionnementConfig()` — construit une table `sourceUUID → localUUID` à partir des résultats du mapper
- **Raison :** Le JSONB `conditionnement_config` contient des UUID d'unités du fournisseur → il faut tout réécrire avec les UUID locaux

#### C. `b2bQuantity.ts` (traduction quantités B2B)
- **Fichier :** `src/modules/commandes/utils/b2bQuantity.ts`
- **Fonction :** `findMatchingUnit()` — compare `label.toLowerCase()` avec `name` et `abbreviation` des options BFS
- **Raison :** La `unit_label_snapshot` est du texte client → il faut retrouver l'unité fournisseur par nom pour appliquer le facteur de conversion

#### D. `useErpQuantityLabels.ts` (affichage ERP)
- **Fichier :** `src/modules/commandes/hooks/useErpQuantityLabels.ts`
- **Lignes 250-266 :** Pass 2 (FO side) — compare `fallbackLabel.toLowerCase()` avec `name` et `abbreviation`
- **Raison :** Le fournisseur consulte une commande client → le `canonical_unit_id` est un UUID client inutilisable côté fournisseur

#### E. `fn_convert_b2b_quantity` (backend SQL V4)
- **Fichier :** Migration `20260324205343`
- **Lignes 82-96 :** Étape 5 — compare `lower(trim(client_name)) = lower(trim(supplier_name))` + même `family`
- **Lignes 99-148 :** Étape 6 — remappe le UUID client via les UUID du `conditionnement_config` du fournisseur, en matchant par nom+famille
- **Raison :** Le `canonical_unit_id` d'une commande est un UUID client → la fonction doit retrouver l'unité fournisseur correspondante

### 1.4 Dépendances actuelles sur `measurement_units`

**49 colonnes** dans 21 tables référencent directement des UUID d'unités. Tables clés :

| Table | Colonnes unit_id |
|-------|-----------------|
| `products_v2` | `stock_handling_unit_id`, `final_unit_id`, `delivery_unit_id`, `supplier_billing_unit_id`, `kitchen_unit_id`, `price_display_unit_id`, `min_stock_unit_id`, `withdrawal_unit_id`, `inventory_display_unit_id`, `reception_tolerance_unit_id` |
| `commande_lines` | `canonical_unit_id` |
| `stock_events` | `canonical_unit_id` |
| `stock_document_lines` | `canonical_unit_id` |
| `bl_app_lines` | `canonical_unit_id` |
| `inventory_lines` | `unit_id` |
| `unit_conversions` | `from_unit_id`, `to_unit_id` |
| `packaging_formats` | `unit_id` |
| `recipe_lines` | `unit_id` |
| `product_returns` | `canonical_unit_id` |

---

## 2. Design cible

### 2.1 Nouvelle table `global_units`

```sql
CREATE TABLE public.global_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  family TEXT NOT NULL,           -- weight | volume | count
  aliases TEXT[] DEFAULT '{}',
  is_reference BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL DEFAULT 'system',
  usage_category TEXT NOT NULL DEFAULT 'general',
  display_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_global_units_name UNIQUE (name),
  CONSTRAINT uq_global_units_abbreviation UNIQUE (abbreviation)
);
```

**Propriétés clés :**
- **Pas de `establishment_id`** — table plateforme
- **Pas de `organization_id`** — partagée par tous
- UUID stable et identique pour toute la plateforme
- Contraintes d'unicité sur `name` et `abbreviation`
- **~36 rows** au total (vs 245 actuellement)

### 2.2 Suppression du scope établissement

**Approche recommandée : remplacement progressif**

1. `measurement_units` reste pendant la transition (lecture seule)
2. Toutes les FK sont rebasculées vers `global_units`
3. `measurement_units` est supprimée en phase finale

**Alternative (non retenue) :** ALTER `measurement_units` in place en supprimant `establishment_id`. Trop risqué — les FK existantes pointent vers des UUID locaux qui doivent tous être remappés.

### 2.3 Impact sur `products_v2`

Toutes les colonnes `*_unit_id` pointent actuellement vers `measurement_units.id` (UUID local). Après migration :

```
products_v2.stock_handling_unit_id → global_units.id
products_v2.final_unit_id → global_units.id
products_v2.delivery_unit_id → global_units.id
... (10 colonnes au total)
```

**Conséquence B2B :** Un produit du fournisseur et le même produit importé chez le client utiliseront les **mêmes UUID d'unités**. Plus besoin de remapping.

### 2.4 Impact sur `conditionnement_config`

Le JSONB contient des UUID d'unités dans :
- `final_unit_id`
- `packagingLevels[].type_unit_id`
- `packagingLevels[].contains_unit_id`
- `equivalence.source_unit_id`
- `equivalence.unit_id`
- `priceLevel.billed_unit_id`

Après migration, tous ces UUID pointent vers `global_units` → **plus de remapping inter-org nécessaire**. `rebuildConditionnementConfig()` devient un no-op.

### 2.5 Impact sur `unit_conversions`

La table `unit_conversions` a des colonnes `from_unit_id` et `to_unit_id` scopées par `establishment_id`. Options :

**Option A (recommandée) :** Garder `unit_conversions` scopée par établissement mais avec des UUID globaux. Les conversions restent spécifiques à chaque produit/établissement (un fournisseur peut définir 1 Carton = 10 boîtes, un autre 1 Carton = 12 boîtes).

**Option B :** Créer une table `global_unit_conversions` pour les conversions universelles (kg→g = 1000). Les conversions spécifiques restent dans `conditionnement_config`.

→ **Option A** est plus safe et ne change pas la logique BFS.

---

## 3. Stratégie de migration (CRITIQUE — PROD)

### Principe : Zero-downtime, backward-compatible

### 3.1 Phase 1 — Création de `global_units` + mapping

```sql
-- 1. Créer la table
CREATE TABLE public.global_units (...);

-- 2. Peupler avec les 36 unités uniques
INSERT INTO global_units (name, abbreviation, family, aliases, ...)
SELECT DISTINCT ON (name)
  name, abbreviation, family, aliases, is_reference,
  category, usage_category, display_order, notes
FROM measurement_units
ORDER BY name, created_at ASC;

-- 3. Créer table de mapping (temporaire)
CREATE TABLE public.unit_migration_map (
  old_id UUID NOT NULL REFERENCES measurement_units(id),
  new_id UUID NOT NULL REFERENCES global_units(id),
  PRIMARY KEY (old_id)
);

-- 4. Peupler le mapping
INSERT INTO unit_migration_map (old_id, new_id)
SELECT mu.id, gu.id
FROM measurement_units mu
JOIN global_units gu ON gu.name = mu.name;
```

**Validation :** `SELECT COUNT(*) FROM measurement_units WHERE id NOT IN (SELECT old_id FROM unit_migration_map)` doit retourner 0.

### 3.2 Phase 2 — Double colonne (compatibilité)

Pour chaque table avec un `*_unit_id`, ajouter une colonne shadow :

```sql
-- Exemple pour products_v2
ALTER TABLE products_v2 
  ADD COLUMN stock_handling_gunit_id UUID REFERENCES global_units(id);

-- Backfill
UPDATE products_v2 p
SET stock_handling_gunit_id = m.new_id
FROM unit_migration_map m
WHERE p.stock_handling_unit_id = m.old_id;
```

Tables à backfiller (21 tables, 49 colonnes) — voir Section 1.4.

### 3.3 Phase 3 — Backfill JSONB (`conditionnement_config`)

```sql
-- Fonction de remapping JSONB
CREATE OR REPLACE FUNCTION fn_remap_config_units(config jsonb)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb := config;
  v_old_id uuid;
  v_new_id uuid;
BEGIN
  -- Remap final_unit_id
  v_old_id := (config->>'final_unit_id')::uuid;
  IF v_old_id IS NOT NULL THEN
    SELECT new_id INTO v_new_id FROM unit_migration_map WHERE old_id = v_old_id;
    IF v_new_id IS NOT NULL THEN
      v_result := jsonb_set(v_result, '{final_unit_id}', to_jsonb(v_new_id::text));
    END IF;
  END IF;
  
  -- ... (même logique pour chaque UUID dans packagingLevels, equivalence, priceLevel)
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Appliquer
UPDATE products_v2
SET conditionnement_config = fn_remap_config_units(conditionnement_config)
WHERE conditionnement_config IS NOT NULL;
```

### 3.4 Phase 4 — Basculement des FK

```sql
-- Renommer les colonnes
ALTER TABLE products_v2 RENAME COLUMN stock_handling_unit_id TO stock_handling_unit_id_old;
ALTER TABLE products_v2 RENAME COLUMN stock_handling_gunit_id TO stock_handling_unit_id;

-- Ajouter FK
ALTER TABLE products_v2
  ADD CONSTRAINT fk_products_v2_stock_handling_gunit
  FOREIGN KEY (stock_handling_unit_id) REFERENCES global_units(id);
```

### 3.5 Phase 5 — Cleanup

```sql
-- Supprimer les anciennes colonnes
ALTER TABLE products_v2 DROP COLUMN stock_handling_unit_id_old;
-- ... pour toutes les tables

-- Supprimer la table de mapping
DROP TABLE unit_migration_map;

-- Supprimer l'ancienne table
DROP TABLE measurement_units CASCADE;

-- Supprimer platform_unit_templates (plus besoin de seed par établissement)
-- OU : la garder pour référence mais ne plus l'utiliser dans fn_create_establishment
```

---

## 4. Impact code frontend

### 4.1 Fichiers à modifier

| Fichier | Action | Détail |
|---------|--------|--------|
| `src/core/unitConversion/useUnitConversions.ts` | **MODIFIER** | Query `global_units` au lieu de `measurement_units.eq("establishment_id", estId)` |
| `src/modules/commandes/utils/b2bQuantity.ts` | **SUPPRIMER** | Plus besoin de `findMatchingUnit()` — les UUID sont identiques |
| `src/modules/commandes/hooks/useErpQuantityLabels.ts` | **SIMPLIFIER** | Pass 2 : plus de matching par nom (L250-266). Le `canonical_unit_id` est un UUID global → lookup direct par ID |
| `src/modules/clientsB2B/services/b2bUnitMapper.ts` | **SUPPRIMER** | Plus de matching par nom/abréviation — les UUID sont identiques |
| `src/modules/clientsB2B/services/b2bConfigRebuilder.ts` | **SUPPRIMER** | Plus de remapping — le `conditionnement_config` utilise des UUID globaux |
| `src/modules/clientsB2B/services/b2bImportPipeline.ts` | **SIMPLIFIER** | Supprimer les appels à `mapProductUnits`, `rebuildConditionnementConfig`, `remapDirectUnit` |
| `src/modules/clientsB2B/services/b2bTypes.ts` | **SIMPLIFIER** | Supprimer `UnitMappingResult`, `B2BSupplierUnit`, `LocalUnit` |
| `src/modules/visionAI/hooks/useMeasurementUnits.ts` | **MODIFIER** | Query `global_units` |
| `src/pages/commandes/CompositePreparationDialog.tsx` | **SIMPLIFIER** | Plus de translation client↔supplier via `b2bQuantity.ts` |
| `src/pages/commandes/CompositeDetailDialog.tsx` | **SIMPLIFIER** | Plus de matching par nom dans `erpFormat` |
| `src/modules/commandes/components/PreparationDialog.tsx` | **SIMPLIFIER** | Idem |
| `src/modules/commandes/components/ReceptionDialog.tsx` | **SIMPLIFIER** | Idem |
| `src/modules/litiges/components/LitigeDetailDialog.tsx` | **SIMPLIFIER** | Idem |

### 4.2 Ce qui doit disparaître

| Code | Fichier | Raison |
|------|---------|--------|
| `normalizeUnitText()` | b2bUnitMapper.ts | Plus de comparaison textuelle |
| `singularize()` | b2bUnitMapper.ts | Plus de fuzzy matching |
| `mapSingleUnit()` | b2bUnitMapper.ts | UUID identiques |
| `mapProductUnits()` | b2bUnitMapper.ts | UUID identiques |
| `rebuildConditionnementConfig()` | b2bConfigRebuilder.ts | Config copiée telle quelle |
| `remapDirectUnit()` | b2bConfigRebuilder.ts | UUID identiques |
| `findMatchingUnit()` | b2bQuantity.ts | UUID identiques |
| `translateClientQtyToSupplier()` | b2bQuantity.ts | Plus nécessaire — même espace d'unités |
| `translateSupplierQtyToClient()` | b2bQuantity.ts | Idem |
| Pass 2 name matching (L250-266) | useErpQuantityLabels.ts | UUID lookup direct |

### 4.3 Ce qui reste inchangé

| Code | Raison |
|------|--------|
| BFS conversion (`findConversionPath`) | Les conversions restent par produit/établissement |
| `computeDisplayBreakdown` / `formatErpQuantity` | Logique d'affichage ERP inchangée |
| `resolveProductUnitContext` | Le contexte produit garde la même structure |
| `useUnitConversions` | Seule la source change (global_units vs measurement_units) |
| `unit_conversions` table | Les facteurs de conversion restent par produit |

---

## 5. Impact backend

### 5.1 `fn_convert_b2b_quantity` → Simplification majeure

**Avant (V4) — 6 étapes :**
1. Get supplier unit
2. Get metadata
3. Same UUID → identity
4. BFS conversion (direct)
5. **Cross-tenant name matching** ← SUPPRIMÉ
6. **Remap via conditionnement_config name matching** ← SUPPRIMÉ
7. Error

**Après — 3 étapes :**
1. Get supplier unit
2. Same UUID → identity (maintenant le cas courant !)
3. BFS conversion si unités différentes (ex: Carton vs Pièce — même produit)
4. Error

```sql
CREATE OR REPLACE FUNCTION public.fn_convert_b2b_quantity(
  p_product_id uuid, p_client_unit_id uuid, p_client_quantity numeric
) RETURNS public.b2b_conversion_result AS $$
DECLARE
  v_supplier_unit_id uuid;
  v_supplier_family text;
  v_factor numeric;
  v_result public.b2b_conversion_result;
BEGIN
  SELECT p.stock_handling_unit_id INTO v_supplier_unit_id
  FROM products_v2 p WHERE p.id = p_product_id;
  IF v_supplier_unit_id IS NULL THEN
    v_result.status := 'error'; RETURN v_result;
  END IF;

  SELECT family INTO v_supplier_family
  FROM global_units WHERE id = v_supplier_unit_id;

  -- Same global UUID → identity (common B2B case now)
  IF p_client_unit_id = v_supplier_unit_id THEN
    v_result := (v_supplier_unit_id, p_client_quantity, v_supplier_family, 'ok');
    RETURN v_result;
  END IF;

  -- BFS conversion
  SELECT fn_product_unit_price_factor(p_product_id, p_client_unit_id, v_supplier_unit_id)
    INTO v_factor;
  IF v_factor IS NOT NULL AND v_factor != 0 THEN
    v_result := (v_supplier_unit_id, ROUND(p_client_quantity / v_factor, 4), v_supplier_family, 'ok');
    RETURN v_result;
  END IF;

  v_result.status := 'error';
  RETURN v_result;
END;
$$;
```

**Suppression de ~70 lignes** de logique de matching textuel.

### 5.2 `fn_ship_commande` — Aucun changement nécessaire

Cette fonction utilise `canonical_unit_id` et `fn_convert_b2b_quantity`. La simplification de `fn_convert_b2b_quantity` la rend automatiquement plus fiable.

### 5.3 `fn_resolve_litige` — Aucun changement nécessaire

Même logique : utilise `fn_convert_b2b_quantity` qui est simplifié.

### 5.4 `fn_import_b2b_product_atomic` — Simplification

Les paramètres `p_final_unit_id`, `p_stock_handling_unit_id`, etc. sont maintenant des UUID globaux → ils sont **directement insérables** sans remapping. Le frontend n'a plus besoin d'appeler `mapProductUnits` + `remapDirectUnit` avant l'import.

### 5.5 `fn_create_establishment_for_org` — Suppression du seed

Plus besoin d'insérer des unités dans `measurement_units` lors de la création d'un établissement. Supprimer le bloc :

```sql
INSERT INTO measurement_units (...) SELECT ... FROM platform_unit_templates;
```

### 5.6 RLS

`global_units` est en **lecture seule** pour tous les utilisateurs authentifiés :

```sql
CREATE POLICY "Anyone can read global units"
ON global_units FOR SELECT TO authenticated USING (true);
```

Seul le `service_role` peut modifier (ajout d'unités par admin plateforme).

---

## 6. Risques

### 6.1 Risques data

| Risque | Impact | Mitigation |
|--------|--------|------------|
| **Unités custom** : un établissement a créé des unités non présentes dans le template | Perte d'unicité si 2 établissements ont des unités custom homonymes | Auditer avant migration : `SELECT name, COUNT(DISTINCT establishment_id) FROM measurement_units WHERE is_system = false GROUP BY name` |
| **Mapping incomplet** : un `measurement_units.id` n'a pas de correspondance dans `global_units` | FK violation après basculement | Validation : vérifier que `unit_migration_map` couvre 100% des IDs |
| **Données historiques** : `stock_events`, `commande_lines` anciens avec des UUID locaux | Données illisibles si `measurement_units` est supprimée | Backfiller TOUTES les colonnes avant suppression |

### 6.2 Risques JSONB

| Risque | Impact | Mitigation |
|--------|--------|------------|
| **UUID manquant dans mapping** | `conditionnement_config` avec un UUID qui ne résout plus | Vérifier AVANT le backfill : extraire tous les UUID du JSONB et confirmer qu'ils sont dans le mapping |
| **Structure JSONB inattendue** | La fonction de remapping ne gère pas un format edge-case | Lister tous les variants de structure avec `jsonb_typeof` et valider |
| **Backfill partiel** | Un produit a son JSONB remappé mais pas ses colonnes directes (ou inversement) | Exécuter dans une seule transaction |

### 6.3 Risques mismatch unités existantes

| Risque | Impact | Mitigation |
|--------|--------|------------|
| **Même nom, sémantique différente** | Deux établissements utilisent "Carton" pour des contenances différentes | OK — la contenance est dans `conditionnement_config`, pas dans l'unité |
| **Noms quasi-identiques** | "Piece" vs "Pièce" dans différents établissements | Normaliser dans le mapping initial avec `normalizeUnitText()` |
| **Unités orphelines** | Des UUID dans des tables mais plus dans `measurement_units` | Auditer avec LEFT JOIN avant migration |

### 6.4 Risques UI

| Risque | Impact | Mitigation |
|--------|--------|------------|
| **Cache stale** | Après migration, les clients ont en cache les anciens UUID | Invalider les query keys `["units"]` côté frontend |
| **Sélecteurs d'unités** | Les composants filtrent par `establishment_id` | Modifier les queries pour pointer vers `global_units` |
| **RLS visible** | Un utilisateur ne voit plus les unités car la policy a changé | Tester la policy `global_units` SELECT en pré-prod |

---

## 7. Plan d'exécution

### Phase 1 : Fondation (1 jour)

- [ ] Créer `global_units`
- [ ] Peupler depuis `measurement_units` (36 unités distinctes)
- [ ] Créer `unit_migration_map`
- [ ] Valider couverture 100%
- [ ] Auditer les unités custom (is_system=false)

### Phase 2 : Double colonne + Backfill (2-3 jours)

- [ ] Ajouter colonnes `*_gunit_id` sur les 21 tables
- [ ] Backfill toutes les colonnes via `unit_migration_map`
- [ ] Backfill `conditionnement_config` JSONB
- [ ] Valider : aucun NULL inattendu dans les nouvelles colonnes
- [ ] Ajouter RLS sur `global_units`

### Phase 3 : Code frontend dual-read (1-2 jours)

- [ ] Modifier `useUnitConversions` pour lire `global_units`
- [ ] Modifier `useMeasurementUnits` pour lire `global_units`
- [ ] Tester que tous les sélecteurs d'unités fonctionnent
- [ ] Déployer — les anciennes colonnes sont encore lues par les fonctions SQL

### Phase 4 : Basculement backend (1-2 jours)

- [ ] Renommer colonnes (old → old_backup, gunit → standard)
- [ ] Mettre à jour toutes les FK
- [ ] Simplifier `fn_convert_b2b_quantity` (supprimer étapes 5-6)
- [ ] Simplifier `fn_create_establishment_for_org` (supprimer seed unités)
- [ ] Déployer

### Phase 5 : Cleanup (1 jour)

- [ ] Supprimer `b2bUnitMapper.ts`
- [ ] Supprimer `b2bConfigRebuilder.ts`
- [ ] Supprimer `b2bQuantity.ts` (`findMatchingUnit`, `translateClientQtyToSupplier`, `translateSupplierQtyToClient`)
- [ ] Simplifier `useErpQuantityLabels.ts` (supprimer Pass 2 name matching)
- [ ] Simplifier `b2bImportPipeline.ts`
- [ ] Supprimer colonnes `*_old`
- [ ] Supprimer `unit_migration_map`
- [ ] Supprimer `measurement_units`
- [ ] Supprimer `platform_unit_templates` (ou garder pour référence)

**Durée estimée totale : 6-9 jours**

---

## 8. Validation

### 8.1 Tests B2B commande

| Scénario | Attendu |
|----------|---------|
| Client crée commande avec produit importé | `canonical_unit_id` = UUID global |
| Fournisseur voit la commande | UUID reconnu directement, pas de matching par nom |
| Quantité affichée côté fournisseur | Correct sans translation textuelle |

### 8.2 Tests préparation

| Scénario | Attendu |
|----------|---------|
| Modal BFS supplier | Unités résolues par UUID direct |
| Modification quantité partielle (50→40) | Persistance correcte sans conversion nom |
| Rupture totale (50→0) | `shipped_quantity = 0` en espace client |

### 8.3 Tests expédition

| Scénario | Attendu |
|----------|---------|
| `fn_ship_commande` | `fn_convert_b2b_quantity` résout par UUID identity (cas courant) |
| Stock fournisseur débité | Quantité correcte, unité correcte |

### 8.4 Tests réception

| Scénario | Attendu |
|----------|---------|
| Client réceptionne | `canonical_unit_id` global → lookup direct dans `global_units` |
| Stock client crédité | Quantité et unité correctes |

### 8.5 Tests litige

| Scénario | Attendu |
|----------|---------|
| `fn_resolve_litige` | Conversion via `fn_convert_b2b_quantity` simplifié |
| Stock ajusté | Pas de double conversion, pas de matching textuel |

### 8.6 Tests import produit

| Scénario | Attendu |
|----------|---------|
| Import B2B nouveau produit | UUID d'unités copiés tels quels (pas de remapping) |
| Ré-import après mise à jour fournisseur | UUID identiques → UPDATE direct |
| `conditionnement_config` | Copié tel quel, tous les UUID sont globaux |

### 8.7 Tests régression

| Scénario | Attendu |
|----------|---------|
| Création d'un nouvel établissement | Plus de seed `measurement_units`, unités disponibles via `global_units` |
| Wizard produit (sélection d'unité) | Liste depuis `global_units`, pas filtrée par établissement |
| Inventaire | UUID global dans `inventory_lines.unit_id` |
| BL App | UUID global dans `bl_app_lines.canonical_unit_id` |

### 8.8 Requêtes de validation data

```sql
-- Vérifier que tous les UUID ont été remappés
SELECT 'products_v2' as tbl, COUNT(*) as orphans
FROM products_v2 WHERE stock_handling_unit_id IS NOT NULL 
  AND stock_handling_unit_id NOT IN (SELECT id FROM global_units)
UNION ALL
SELECT 'commande_lines', COUNT(*)
FROM commande_lines WHERE canonical_unit_id NOT IN (SELECT id FROM global_units)
UNION ALL
SELECT 'stock_events', COUNT(*)
FROM stock_events WHERE canonical_unit_id NOT IN (SELECT id FROM global_units);
-- Tous doivent retourner 0
```

---

## Résumé

| Aspect | Avant | Après |
|--------|-------|-------|
| Table unités | `measurement_units` (245 rows, 7 établissements) | `global_units` (36 rows, plateforme) |
| UUID "Carton" | 7 UUID différents | 1 seul UUID |
| Import B2B | Matching nom → remapping UUID → rebuild config | Copie directe des UUID |
| `fn_convert_b2b_quantity` | 7 étapes dont 2 par nom | 3 étapes, tout par UUID |
| `b2bUnitMapper.ts` | 207 lignes de matching | **Supprimé** |
| `b2bConfigRebuilder.ts` | 94 lignes de remapping | **Supprimé** |
| `b2bQuantity.ts` | 101 lignes de translation | **Supprimé** |
| Risque bug silencieux | Élevé (matching textuel fragile) | Nul (UUID déterministe) |
| Unités custom par établissement | Possible (ajout libre) | Possible (ajout dans `global_units` par admin) |
