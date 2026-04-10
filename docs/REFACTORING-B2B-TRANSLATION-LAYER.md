# Refactoring B2B Translation Layer — Stratégie Ciblée

> **Auteur :** Claude (analyse du codebase 2026-03-25)  
> **Statut :** Proposition — à valider avant implémentation  
> **Objectif :** Fiabiliser la couche inter-org sans toucher au socle unités

---

## 1. Diagnostic de l'existant

### 1.1 Composants actuels de la translation B2B

| Fichier | Rôle | Problème |
|---------|------|----------|
| `src/modules/commandes/hooks/useErpQuantityLabels.ts` (292 lignes) | Affichage ERP — 2 passes (direct + B2B mapping) | Matching par nom à la volée dans Pass 2 (L.251-255) |
| `src/modules/commandes/utils/b2bQuantity.ts` (101 lignes) | Translation client↔fournisseur pour modals | Matching par nom/abréviation (L.92-100) |
| `fn_convert_b2b_quantity` (SQL, V4) | Translation backend — litiges, expédition | 4 stratégies de résolution dont matching sémantique |
| `src/modules/clientsB2B/services/b2bUnitMapper.ts` (207 lignes) | Mapping à l'import — (family, abbr) puis (family, name) puis aliases | Matching sémantique aussi, mais **one-shot** à l'import |
| `src/modules/clientsB2B/services/b2bConfigRebuilder.ts` | Remappage conditionnement_config à l'import | Utilise les résultats de `b2bUnitMapper` |

### 1.2 Consommateurs (8 fichiers front)

| Composant | Module | Utilise |
|-----------|--------|---------|
| `PreparationDialog.tsx` | commandes | `useErpQuantityLabels` + `b2bQuantity.ts` |
| `CompositePreparationDialog.tsx` | commandes (page) | `useErpQuantityLabels` + query `b2b_imported_products` |
| `CompositeDetailDialog.tsx` | commandes (page) | `useErpQuantityLabels` |
| `ReceptionDialog.tsx` | commandes | `useErpQuantityLabels` |
| `LitigeDetailDialog.tsx` | litiges | `useErpQuantityLabels` + query `b2b_imported_products` |
| `RetourDetailDialog.tsx` | retours | `useErpQuantityLabels` |

### 1.3 Le vrai problème (confirmé par le code)

**Le matching texte est fait à chaque rendu**, pas juste à l'import :

```typescript
// useErpQuantityLabels.ts L.251-255 — exécuté à CHAQUE formatQty()
const matchingUnit =
  options.find((o) => o.name.toLowerCase().trim() === normalizedLabel) ??
  options.find((o) => o.abbreviation.toLowerCase().trim() === normalizedLabel);
```

```typescript
// b2bQuantity.ts L.96-100 — même pattern
options.find((o) => o.name.toLowerCase().trim() === normalized) ??
options.find((o) => o.abbreviation.toLowerCase().trim() === normalized)
```

**Fragilité prouvée :** si un fournisseur renomme "Carton" → "Carton (12)" ou si l'abréviation diffère (ctn vs cart), le matching silencieusement échoue et la quantité brute s'affiche.

---

## 2. Mon avis sur la stratégie proposée

### ✅ Ce qui est excellent dans la proposition

1. **Ne pas toucher au socle** — 100% d'accord. Les `measurement_units`, le BFS, le `conditionnement_config` fonctionnent. Les refondre = risque disproportionné.

2. **Persister le mapping à l'import** — c'est LA bonne idée. Le code le fait déjà partiellement (`b2bUnitMapper` calcule le mapping), mais **il ne le persiste pas**. Il le jette après usage.

3. **Source unique de translation** — indispensable. Aujourd'hui, `b2bQuantity.ts` et `useErpQuantityLabels` dupliquent le matching texte.

### ⚠️ Ce que j'ajusterais

1. **Pas besoin d'une nouvelle table** — On a déjà `b2b_imported_products` qui lie `source_product_id` ↔ `local_product_id`. Il suffit d'y **ajouter une colonne JSONB `unit_mapping`** qui persiste le résultat du `b2bUnitMapper`. Aucune nouvelle FK, aucune nouvelle relation.

2. **Ne pas créer un "module central B2B"** — On a déjà les bons fichiers. Il faut les **consolider**, pas en créer un nouveau. Concrètement : fusionner `b2bQuantity.ts` dans un service partagé que `useErpQuantityLabels` utilise aussi.

3. **Le backend (`fn_convert_b2b_quantity`) doit lire le mapping persisté** — Aujourd'hui il refait son propre matching sémantique en SQL. Si on persiste le mapping, il doit le lire en priorité.

---

## 3. Stratégie recommandée (adaptée au code)

### Phase 1 — Persister le mapping d'unités (P1, risque faible)

**Quoi :** Ajouter `unit_mapping JSONB` à `b2b_imported_products`.

```sql
ALTER TABLE b2b_imported_products 
ADD COLUMN unit_mapping jsonb DEFAULT NULL;
```

**Format du JSONB :**
```json
{
  "mappings": [
    {
      "source_unit_id": "uuid-fournisseur",
      "local_unit_id": "uuid-client",
      "source_name": "Carton",
      "source_abbreviation": "ctn",
      "match_method": "family_abbreviation"
    }
  ],
  "mapped_at": "2026-03-25T10:00:00Z"
}
```

**Où le remplir :** Dans `b2bImportPipeline.ts`, la fonction `importSingleProduct` (L.106-189) a déjà calculé `product.unitMappings`. Il suffit de le passer à `fn_import_b2b_product_atomic` pour persister.

**Risque :** Quasi nul — c'est une colonne nullable ajoutée. Aucun code existant n'en dépend. Rétrocompatible à 100%.

**Impact fichiers :**
- Migration SQL : 1 ALTER TABLE
- `b2bCatalogService.ts` : ajouter le paramètre `unit_mapping` à l'appel RPC
- `fn_import_b2b_product_atomic` (SQL) : accepter et stocker le paramètre

---

### Phase 2 — Créer le service de translation unifié (P1, risque moyen)

**Quoi :** Remplacer le matching texte runtime par un lookup du mapping persisté.

**Fichier cible :** `src/modules/commandes/services/b2bTranslation.ts` (nouveau)

```typescript
// Pseudo-code
export interface B2BUnitMap {
  sourceUnitId: string;
  localUnitId: string;
}

/**
 * Lookup le mapping persisté dans b2b_imported_products.unit_mapping
 * Fallback: matching par nom (backward compat pour les imports pré-migration)
 */
export function resolveB2BUnit(
  clientUnitId: string,
  persistedMapping: B2BUnitMap[] | null,
  supplierOptions: ReachableUnit[],
  fallbackLabel?: string,
): ReachableUnit | null {
  // 1. Lookup persisté (déterministe, instantané)
  if (persistedMapping) {
    const mapped = persistedMapping.find(m => m.localUnitId === clientUnitId);
    if (mapped) {
      return supplierOptions.find(o => o.id === mapped.sourceUnitId) ?? null;
    }
  }
  // 2. Fallback texte (backward compat)
  if (fallbackLabel) {
    return findByNameOrAbbr(fallbackLabel, supplierOptions);
  }
  return null;
}
```

**Impact :**
- `useErpQuantityLabels.ts` : Pass 2 utilise `resolveB2BUnit` au lieu du matching inline
- `b2bQuantity.ts` : `translateClientQtyToSupplier` utilise `resolveB2BUnit`
- Les 6 composants consommateurs **ne changent pas** (l'API `formatQty` / `translateClientQtyToSupplier` reste identique)

**Risque :** Moyen — touche au hot path d'affichage. Atténuation : le fallback texte reste en place, donc aucune régression pour les imports existants sans `unit_mapping`.

---

### Phase 3 — Mettre à jour le backend SQL (P2, risque moyen)

**Quoi :** `fn_convert_b2b_quantity` lit `unit_mapping` de `b2b_imported_products` en priorité.

```sql
-- Pseudo-SQL ajouté en tête de fn_convert_b2b_quantity
-- Step 0: Lookup persisted mapping
SELECT um->>'local_unit_id' INTO v_mapped_unit_id
FROM b2b_imported_products bip,
     jsonb_array_elements(bip.unit_mapping->'mappings') um
WHERE bip.source_product_id = p_product_id
  AND (um->>'source_unit_id') = p_client_unit_id::text
LIMIT 1;

IF v_mapped_unit_id IS NOT NULL THEN
  -- Direct resolution, skip semantic matching
  ...
END IF;
```

**Risque :** Moyen — utilisé dans `fn_ship_commande`, `fn_resolve_litige_lines`. Test SQL obligatoire avant déploiement.

---

### Phase 4 — Backfill les imports existants (P3, risque faible)

**Quoi :** Script one-shot qui recalcule le `unit_mapping` pour les `b2b_imported_products` existants.

Logique : pour chaque import existant, charger les unités source + client, exécuter `mapSingleUnit` (le même code que le pipeline d'import), persister le résultat.

**Risque :** Faible — écriture-only sur colonne nullable. Peut être fait en batch hors heures de pointe.

---

### Phase 5 — Cleanup du fallback texte (P4, risque faible)

**Quoi :** Une fois le backfill terminé et validé, supprimer le fallback texte dans `resolveB2BUnit` et les `console.warn` associés.

**Risque :** Très faible si Phase 4 bien exécutée. Garder un log d'erreur si aucun mapping trouvé.

---

## 4. Matrice des risques

| Phase | Risque | Impact si bug | Atténuation |
|-------|--------|---------------|-------------|
| P1 — Colonne JSONB | 🟢 Très faible | Aucun — nullable, non lu | Rétrocompatible |
| P2 — Service unifié | 🟡 Moyen | Affichage quantités faux | Fallback texte conservé |
| P3 — Backend SQL | 🟡 Moyen | Mutations stock erronées | Tests SQL avant deploy |
| P4 — Backfill | 🟢 Faible | Pas d'impact si raté | Colonne nullable |
| P5 — Cleanup | 🟢 Très faible | - | Post-validation seulement |

---

## 5. Ce qu'on NE touche PAS

| Composant | Raison |
|-----------|--------|
| `measurement_units` (table) | Fonctionne, 0 régression |
| `conditionnement_config` (format) | Vérité métier, intacte |
| BFS (`findConversionPath`, `resolveProductUnitContext`) | Moteur de conversion local, fonctionne |
| `b2bConfigRebuilder.ts` | Remappage à l'import, fonctionne |
| `b2bUnitMapper.ts` | One-shot à l'import, on le garde tel quel |
| RPC `fn_ship_commande`, `fn_resolve_litige_lines` | On modifie seulement `fn_convert_b2b_quantity` qu'elles appellent |
| Les 6 composants consommateurs (dialogs) | L'API (`formatQty`, `translateClientQtyToSupplier`) ne change pas |

---

## 6. Estimation effort

| Phase | Effort | Fichiers touchés |
|-------|--------|------------------|
| P1 | 1-2h | 1 migration + 2 fichiers TS + 1 RPC SQL |
| P2 | 3-4h | 1 nouveau fichier + 2 fichiers modifiés |
| P3 | 2-3h | 1 migration SQL |
| P4 | 1-2h | 1 script edge function ou script SQL |
| P5 | 30min | 2 fichiers TS cleanup |
| **Total** | **~10h** | **~8 fichiers** |

---

## 7. Verdict

La stratégie proposée est **la bonne direction**. Ma version adaptée au code se résume en une phrase :

> **Persister le résultat du `b2bUnitMapper` (qu'on calcule déjà) dans `b2b_imported_products`, puis faire lire ce mapping par `useErpQuantityLabels` et `fn_convert_b2b_quantity` au lieu du matching texte runtime.**

C'est ~10h de travail, 0 refonte structurelle, 0 migration de données produit, et un fallback texte conservé pour backward compat. Le gain est **déterministe** : les bugs B2B de matching texte disparaissent définitivement pour tout import post-déploiement, et progressivement pour les imports existants après le backfill.
