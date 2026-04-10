# Audit — Import Produit B2B (Catalogue Fournisseur → Client)

**Date :** 2026-03-14  
**Périmètre :** Flux complet d'importation d'un produit fournisseur via le catalogue B2B  
**Fichiers audités :**
- `src/modules/clientsB2B/services/b2bImportPipeline.ts`
- `src/modules/clientsB2B/services/b2bConfigRebuilder.ts`
- `src/modules/clientsB2B/services/b2bUnitMapper.ts`
- `src/modules/clientsB2B/services/b2bCatalogService.ts`
- `src/modules/clientsB2B/services/b2bTypes.ts`
- `supabase/migrations/20260313165427_*.sql` — `fn_import_b2b_product_atomic`
- `supabase/migrations/20260313170119_*.sql` — `fn_initialize_product_stock`
- `supabase/migrations/20260303150251_*.sql` — `fn_get_b2b_catalogue`
- `src/modules/visionAI/components/ProductFormV3/WizardStep1.tsx` (Structure)
- `src/modules/visionAI/components/ProductFormV3/useWizardState.ts`

---

## Résumé exécutif

L'import B2B souffre de **3 bugs confirmés** dont 2 critiques :

| # | Sévérité | Bug | Impact |
|---|----------|-----|--------|
| F1 | 🔴 CRITIQUE | Equivalence remappée avec les mauvais noms de champs | Produits importés avec conditionnement cassé — le chip kg/g/L/ml n'est pas sélectionné dans le Wizard |
| F2 | 🔴 CRITIQUE | `fn_initialize_product_stock` exige `stock_handling_unit_id` non-null, mais celui-ci est souvent null | Stock jamais initialisé → "Non initialisé" permanent |
| F3 | 🟡 MODÉRÉ | Pas d'init stock pour les produits existants retrouvés (UPDATE path) | Produits existants mis à jour sans initialisation de stock |

---

## F1 — Equivalence remappée avec les mauvais noms de champs

### Localisation exacte
`src/modules/clientsB2B/services/b2bConfigRebuilder.ts` — lignes 59-67

### Le bug

Le rebuilder remappe les UUID de l'équivalence en utilisant les champs `from_unit_id` et `to_unit_id` :

```typescript
result.equivalence = {
  ...eq,
  from_unit_id: remapUuid(uuidMap, eq.from_unit_id as string | null),  // ❌ WRONG KEY
  to_unit_id: remapUuid(uuidMap, eq.to_unit_id as string | null),      // ❌ WRONG KEY
};
```

Mais le type `Equivalence` (`src/modules/conditionnementV2/types.ts`) utilise :
- `source_unit_id` (pas `from_unit_id`)
- `unit_id` (pas `to_unit_id`)

### Conséquence

Le spread `...eq` **conserve** les UUIDs fournisseur dans `source_unit_id` et `unit_id` (car ils ne sont pas écrasés). Deux champs inutiles `from_unit_id` et `to_unit_id` sont ajoutés avec les UUIDs locaux, mais **personne ne les lit**.

Résultat dans la DB :
```json
{
  "equivalence": {
    "source": "Pot",
    "source_unit_id": "uuid-supplier-pot",    // ❌ UUID fournisseur, pas local !
    "quantity": 1,
    "unit": "kg",
    "unit_id": "uuid-supplier-kg",            // ❌ UUID fournisseur, pas local !
    "from_unit_id": "uuid-local-pot",          // ✅ UUID local, mais champ ignoré
    "to_unit_id": "uuid-local-kg"              // ✅ UUID local, mais champ ignoré
  }
}
```

### Impact UI

Dans le Wizard (Step 2 "Structure"), le chip kg/g/L/ml est sélectionné par comparaison `equivalenceUnitId === u.id`. Comme `equivalenceUnitId` contient l'UUID fournisseur (qui n'existe pas chez le client), **aucun chip n'est sélectionné** visuellement, même si la valeur textuelle ("kg") est affichée.

C'est exactement ce que montre le screenshot : "1 Pot =" avec la valeur 1, mais aucun chip kg/g/L/ml n'est en surbrillance.

### Correction requise

```typescript
result.equivalence = {
  ...eq,
  source_unit_id: remapUuid(uuidMap, eq.source_unit_id as string | null),  // ✅
  unit_id: remapUuid(uuidMap, eq.unit_id as string | null),                // ✅
};
```

---

## F2 — `fn_initialize_product_stock` exige `stock_handling_unit_id` non-null

### Localisation exacte
`fn_initialize_product_stock` — ligne 40-42 dans la migration `20260313170119`

### Le bug

```sql
IF v_product.stock_handling_unit_id IS NULL THEN
  RETURN jsonb_build_object('ok', false, 'error', 'PRODUCT_NO_UNIT');
END IF;
```

Or, dans tout le reste du système, l'unité canonique est résolue avec fallback :
```typescript
const canonicalUnitId = product.stock_handling_unit_id ?? product.final_unit_id;
```

Quand un produit fournisseur n'a pas de `stock_handling_unit_id` explicite (cas fréquent — beaucoup de produits utilisent `final_unit_id` comme unité canonique implicite), le remap donne null :
```typescript
stock_handling_unit_id: remapDirectUnit(product.stock_handling_unit_id, product.unitMappings) ?? null,
// Si product.stock_handling_unit_id est null → remapDirectUnit(null, ...) → null
```

Le produit est inséré avec `stock_handling_unit_id = NULL`. Ensuite `fn_initialize_product_stock` échoue avec `PRODUCT_NO_UNIT`, l'exception est levée, et **toute la transaction est rollback** — le produit n'est jamais créé.

### Cas alternatif : stock_handling_unit_id est défini mais identique à final_unit_id

Si le fournisseur a bien un `stock_handling_unit_id`, le produit EST créé et le stock EST initialisé. Mais il y a un second scénario :

### F2b — Le cas UPDATE (produit existant retrouvé)

Quand `fn_import_b2b_product_atomic` retrouve un produit existant (via code ou nom — lignes 89-109), il fait un UPDATE mais **n'appelle pas `fn_initialize_product_stock`**. Si ce produit n'avait jamais eu son stock initialisé, il reste "Non initialisé" après l'import.

### Correction requise

1. Dans `fn_initialize_product_stock` : utiliser le fallback `COALESCE(stock_handling_unit_id, final_unit_id)`
2. Dans `fn_import_b2b_product_atomic` : appeler `fn_initialize_product_stock` aussi dans le path UPDATE
3. Dans la pipeline frontend : si `stock_handling_unit_id` est null mais `final_unit_id` est non-null, passer `final_unit_id` comme `stock_handling_unit_id`

---

## F3 — Pas d'initialisation stock pour le path UPDATE

### Localisation exacte
`fn_import_b2b_product_atomic` — lignes 89-116

### Le bug

Le bloc UPDATE (quand un produit existant est retrouvé par code ou nom) :
1. Met à jour les champs du produit ✅
2. Insère dans `inventory_zone_products` (ON CONFLICT DO NOTHING) ✅
3. **N'appelle PAS `fn_initialize_product_stock`** ❌

Résultat : le produit est mis à jour, mais si son stock n'était pas initialisé avant, il reste "Non initialisé".

### Correction requise

Ajouter l'appel `fn_initialize_product_stock(v_product_id, p_user_id, 0)` après le UPDATE, identique au path INSERT.

---

## Audit complémentaire — Vérifications OK

| Vérification | Résultat |
|---|---|
| Unit mapping (Phase B) | ✅ Correct — matching par family+abbreviation, family+name, aliases |
| Category mapping (Phase C) | ✅ Correct — matching par name_normalized |
| Packaging levels remap (Phase D) | ✅ Correct — `type_unit_id` et `contains_unit_id` remappés correctement, IDs régénérés |
| `final_unit_id` remap | ✅ Correct — `remapDirectUnit` fonctionne pour les champs directs |
| `conditionnement_config.final_unit_id` remap | ✅ Correct — ligne 46 du rebuilder |
| Duplicate/ambiguity guards | ✅ Correct — AMBIGUOUS_IDENTITY, duplicate key handling |
| Auth/RLS guards | ✅ Correct — `get_user_establishment_ids()` vérifié, SECURITY DEFINER |
| B2B tracking insert | ✅ Correct — `ON CONFLICT DO NOTHING`, cleanup des orphelins |
| Catalogue RPC (`fn_get_b2b_catalogue`) | ✅ Correct — retourne tous les champs nécessaires |
| Zone de stockage | ✅ Correct — `storage_zone_id` passé depuis le dialogue de sélection |
| Prix (`final_unit_price`) | ✅ Correct — transmis tel quel |
| `min_stock_quantity_canonical` | ✅ Correct — mis à 0 par défaut |
| `inventory_zone_products` routing | ✅ Correct — inséré pour la zone choisie |

---

## Scénarios terrain

### Scénario A : CAPRES (Pot, 1 Pot = 1 kg)

**Source fournisseur :**
- `final_unit_id` = uuid-fo-pot
- `stock_handling_unit_id` = uuid-fo-pot (ou null)
- `conditionnement_config.equivalence` = `{ source: "Pot", source_unit_id: "uuid-fo-pot", quantity: 1, unit: "kg", unit_id: "uuid-fo-kg" }`

**Après import (bugué) :**
- `final_unit_id` = uuid-local-pot ✅ (remapDirectUnit fonctionne)
- `conditionnement_config.equivalence.source_unit_id` = uuid-fo-pot ❌ (pas remappé)
- `conditionnement_config.equivalence.unit_id` = uuid-fo-kg ❌ (pas remappé)

**Impact :** Le chip "kg" n'est pas sélectionné visuellement. Le moteur BFS de conversion ne peut pas résoudre l'équivalence car les UUIDs pointent vers des unités inexistantes chez le client. **Le produit ne peut pas convertir Pot ↔ kg.**

### Scénario B : Produit simple (kg, pas d'équivalence)

**Source fournisseur :**
- `final_unit_id` = uuid-fo-kg
- `stock_handling_unit_id` = null
- Pas d'équivalence

**Après import :**
- `final_unit_id` = uuid-local-kg ✅
- `stock_handling_unit_id` = null (car source est null)
- `fn_initialize_product_stock` → `PRODUCT_NO_UNIT` → exception → transaction rollback → **produit jamais créé**

### Scénario C : Produit avec stock_handling_unit_id défini

- Import fonctionne ✅
- Stock initialisé à 0 ✅
- Mais équivalence cassée si elle existe (F1)

---

## Verdict

**Non safe pour le MVP** — Les bugs F1 et F2 corrompent silencieusement les données des produits importés :
- F1 rend les conversions d'unité impossibles (food cost faux, commandes impossibles en bonne unité)
- F2 empêche soit la création du produit, soit l'initialisation du stock

## Stratégie de correction recommandée

1. **C1** — `b2bConfigRebuilder.ts` : corriger les noms de champs `from_unit_id` → `source_unit_id`, `to_unit_id` → `unit_id`
2. **C2** — `fn_initialize_product_stock` : utiliser `COALESCE(stock_handling_unit_id, final_unit_id)` au lieu de `stock_handling_unit_id` seul
3. **C3** — `fn_import_b2b_product_atomic` : appeler `fn_initialize_product_stock` aussi dans le path UPDATE
4. **C4** — Pipeline frontend : si `stock_handling_unit_id` source est null, utiliser `final_unit_id` comme fallback avant envoi

### Données existantes corrompues

Les produits déjà importés avec F1 ont des `conditionnement_config.equivalence` avec des UUIDs fournisseur. Une migration de données sera nécessaire pour :
1. Identifier les produits dans `b2b_imported_products`
2. Re-résoudre les UUIDs d'équivalence vers les unités locales
3. Ré-initialiser le stock des produits "Non initialisé"
