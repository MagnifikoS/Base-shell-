# PHASE 4 — PRÉVENTION DE RÉCIDIVE

## Document : phase 4 cross tenant

**Date** : 2026-03-18  
**Statut** : Implémenté  
**Périmètre** : Correction durable du pipeline d'import B2B + health check automatique

---

## 1. ORIGINE EXACTE DU BUG

### 1.1 Cause racine principale : `priceLevel.billed_unit_id` non remappé

**Fichier** : `src/modules/clientsB2B/services/b2bConfigRebuilder.ts`

La fonction `rebuildConditionnementConfig()` était responsable de remapper tous les UUID dans le JSON `conditionnement_config` lors de l'import B2B. Elle couvrait :
- ✅ `final_unit_id`
- ✅ `packagingLevels[].type_unit_id`
- ✅ `packagingLevels[].contains_unit_id`
- ✅ `equivalence.source_unit_id`
- ✅ `equivalence.unit_id`
- ❌ **`priceLevel.billed_unit_id`** — **OUBLIÉ**

Cet oubli a causé la copie directe de l'UUID de l'unité du fournisseur dans la configuration du client, cassant le moteur BFS pour tous les produits importés ayant un `priceLevel` de type `billed_physical`.

### 1.2 Cause racine secondaire : extraction incomplète dans `b2bUnitMapper.ts`

**Fichier** : `src/modules/clientsB2B/services/b2bUnitMapper.ts`

La fonction `mapProductUnits()` collectait les UUID depuis le JSON pour construire la table de mapping. Elle cherchait :
- ❌ `equivalence.from_unit_id` et `equivalence.to_unit_id` — **noms de champs incorrects**
- ❌ `priceLevel.billed_unit_id` — **non extrait**

Les vrais noms de champs (définis dans `conditionnementV2/types.ts`) sont `source_unit_id` et `unit_id`. Cette erreur de nommage signifie que certains UUID de l'equivalence n'étaient pas collectés pour le mapping, bien que le rebuilder les remappait correctement.

### 1.3 Pourquoi `stock_events` n'a PAS été contaminé

Les `stock_events` utilisent `canonical_unit_id` qui provient de `products_v2.stock_handling_unit_id` (colonne directe, pas JSON). Cette colonne EST correctement remappée par `remapDirectUnit()` dans le pipeline. Seul le JSON `conditionnement_config` était affecté.

---

## 2. CORRECTIONS IMPLÉMENTÉES

### 2.1 Fix `b2bConfigRebuilder.ts` — Remap `priceLevel.billed_unit_id`

```typescript
// AJOUTÉ — Phase 4
if (result.priceLevel && typeof result.priceLevel === "object") {
  const pl = result.priceLevel as Record<string, unknown>;
  if (typeof pl.billed_unit_id === "string") {
    result.priceLevel = {
      ...pl,
      billed_unit_id: remapUuid(uuidMap, pl.billed_unit_id as string | null),
    };
  }
}
```

### 2.2 Fix `b2bUnitMapper.ts` — Extraction correcte des UUID

**Avant (buggé)** :
```typescript
// Cherchait from_unit_id / to_unit_id → noms incorrects
if (typeof eqObj.from_unit_id === "string") unitIds.add(eqObj.from_unit_id);
if (typeof eqObj.to_unit_id === "string") unitIds.add(eqObj.to_unit_id);
// priceLevel non extrait
```

**Après (corrigé)** :
```typescript
// Noms corrects alignés sur conditionnementV2/types.ts
if (typeof eqObj.source_unit_id === "string") unitIds.add(eqObj.source_unit_id);
if (typeof eqObj.unit_id === "string") unitIds.add(eqObj.unit_id);

// Extraction de priceLevel.billed_unit_id
const pl = c.priceLevel;
if (pl && typeof pl === "object") {
  const plObj = pl as Record<string, unknown>;
  if (typeof plObj.billed_unit_id === "string") unitIds.add(plObj.billed_unit_id);
}
```

---

## 3. GARDE-FOU PERMANENT : HEALTH CHECK SQL

### Fonction `fn_health_check_cross_tenant_uuids`

Fonction SQL `SECURITY DEFINER` qui scanne tous les produits actifs et vérifie que chaque UUID dans leur `conditionnement_config` appartient bien aux `measurement_units` de l'établissement local.

**Couverture** :
- `final_unit_id`
- `packagingLevels[].type_unit_id`
- `packagingLevels[].contains_unit_id`
- `equivalence.source_unit_id`
- `equivalence.unit_id`
- `priceLevel.billed_unit_id`

**Usage** :
```sql
-- Vérifier tous les établissements
SELECT * FROM fn_health_check_cross_tenant_uuids();

-- Vérifier un établissement spécifique
SELECT * FROM fn_health_check_cross_tenant_uuids('establishment-uuid-here');
```

**Résultat attendu** : 0 ligne = aucune contamination.

---

## 4. EXHAUSTIVITÉ DES CLÉS JSON COUVERTES

| Clé JSON | Extraction (UnitMapper) | Remapping (ConfigRebuilder) | Statut |
|----------|------------------------|---------------------------|--------|
| `final_unit_id` | ✅ | ✅ | OK |
| `packagingLevels[].type_unit_id` | ✅ | ✅ | OK |
| `packagingLevels[].contains_unit_id` | ✅ | ✅ | OK |
| `equivalence.source_unit_id` | ✅ (corrigé) | ✅ | OK |
| `equivalence.unit_id` | ✅ (corrigé) | ✅ | OK |
| `priceLevel.billed_unit_id` | ✅ (ajouté) | ✅ (ajouté) | OK |

---

## 5. RÉCAPITULATIF GLOBAL (Phases 1→4)

| Phase | Action | Résultat |
|-------|--------|---------|
| Phase 1 | Correction 292 produits inactifs | ✅ 0 UUID étranger |
| Phase 2 | Pilote 5 produits vivants | ✅ Stock inchangé |
| Phase 3 | Extension 179 produits vivants | ✅ 0 UUID étranger global |
| Phase 4 | Prévention récidive | ✅ Code corrigé + health check |

| Métrique finale | Valeur |
|----------------|--------|
| Produits corrigés | **476** |
| UUID cross-tenant éliminés | **~700** |
| UUID orphelins éliminés | **~76** |
| stock_events modifiés | **0** |
| Bugs code corrigés | **3** (priceLevel remap, equivalence field names, priceLevel extraction) |
| Health check déployé | **oui** |

---

## 6. RECOMMANDATIONS FUTURES

1. **Exécuter le health check périodiquement** après chaque campagne d'import B2B
2. **Ajouter un test unitaire** sur `rebuildConditionnementConfig` vérifiant que TOUTES les clés UUID sont remappées
3. **Considérer un trigger SQL** sur `products_v2` qui bloque l'INSERT/UPDATE si `conditionnement_config` contient des UUID n'appartenant pas à l'établissement (coûteux mais infaillible)
