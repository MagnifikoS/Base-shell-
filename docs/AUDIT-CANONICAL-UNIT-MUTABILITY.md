# AUDIT — Mutabilité de l'unité canonique produit

**Date** : 2026-03-11  
**Scope** : `products_v2.stock_handling_unit_id` → `stock_events.canonical_unit_id`

---

## Section 1 — Où l'unité canonique est stockée

| Élément | Valeur |
|---------|--------|
| Table | `products_v2` |
| Colonne | `stock_handling_unit_id` (UUID) |
| Type | `UUID`, nullable |
| FK | → `measurement_units.id` |
| Contrainte d'immutabilité | **AUCUNE** |
| Trigger de protection | **AUCUN** |

> Note : dans `stock_events`, la colonne s'appelle `canonical_unit_id` et recopie la valeur de `stock_handling_unit_id` au moment de l'écriture.

---

## Section 2 — Où elle peut être modifiée

### 2.1 — fn_save_product_wizard (SQL RPC)

**Fichier** : `20260307110917_*.sql`, ligne 108  
```sql
UPDATE products_v2
SET stock_handling_unit_id = p_stock_handling_unit_id,
    ...
WHERE id = p_product_id;
```
**Aucune vérification** : pas de `IF stock_events EXISTS`, pas de comparaison avec l'ancien `stock_handling_unit_id`.

### 2.2 — productsV2Service.updateProduct()

**Fichier** : `src/modules/produitsV2/services/productsV2Service.ts`, ligne 358-359  
```ts
if (payload.stock_handling_unit_id !== undefined)
    updateData.stock_handling_unit_id = payload.stock_handling_unit_id;
```
Écriture directe via `.update()` — **aucune garde**.

### 2.3 — productsV2Service.patchProduct()

**Fichier** : même fichier, ligne 460-461  
```ts
if (patch.stock_handling_unit_id !== undefined)
    updateData.stock_handling_unit_id = patch.stock_handling_unit_id;
```
Idem — **aucune garde**.

### 2.4 — productsV2Service.upsertProduct()

**Fichier** : même fichier, ligne 678-679  
Idem — **aucune garde**.

---

## Section 3 — Accès utilisateur

| Source | Peut modifier ? | Détail |
|--------|:-:|--------|
| Product Wizard (Step 4) | **OUI** | Dropdown `stock_handling_unit_id` affiché et éditable via `ProductConditionnementEditButton` |
| Product Config Summary | **OUI** | Ouvre le même wizard |
| API directe (updateProduct) | **OUI** | Aucun guard |
| API directe (patchProduct) | **OUI** | Aucun guard |
| SQL direct (fn_save_product_wizard) | **OUI** | Aucun guard |
| fn_post_stock_document | Non | Copie l'unité du document, ne modifie pas le produit |

---

## Section 4 — Protections existantes

| Protection | Présente ? |
|-----------|:-:|
| Blocage SQL si stock_events existants | ❌ **NON** |
| Trigger `BEFORE UPDATE` immutabilité | ❌ **NON** |
| Validation UI (warning/confirmation) | ❌ **NON** |
| CHECK constraint | ❌ **NON** |
| RLS restriction sur la colonne | ❌ **NON** |

**Verdict : ZÉRO protection.**

---

## Section 5 — Données réelles corrompues

### 25 produits avec multi-unités dans stock_events

```
Produit                        | Unités mélangées | Unité actuelle
-------------------------------|------------------|---------------
BURRATA 125G                   | bte, car, pce    | bte
Calamar anneau                 | kg, sach         | sach
BÛCHE DE CHÈVRE LONG           | 3 unités mêlées  | pce
Beurre doux                    | 3 unités mêlées  | pce
CHORIZO BOEUF PIQUANNT IKBAL   | kg, pack         | pack
CÉLERI BRANCHE                 | kg, pce          | pce
BURRATA SAPORI MIEI            | bte              | bte
BURRATA 125G (autre)           | car, pce         | car
```

**5 produits mélangent des familles incompatibles** (ex: kg + pce) → `SUM(delta_quantity_canonical)` donne un résultat **mathématiquement faux**.

---

## Section 6 — Modules impactés par une corruption

| Module | Fichier | Impact |
|--------|---------|--------|
| Stock courant | `useProductCurrentStock.ts` | SUM erroné si multi-unité |
| Stock estimé | `useEstimatedStock.ts` | Idem |
| buildCanonicalLine | `buildCanonicalLine.ts` | Lit l'unité actuelle, ignore l'historique |
| fn_post_stock_document | SQL | Copie l'unité du document_line, pas du produit |
| Inventaire | `fn_upsert_inventory_line` | Utilise `stock_handling_unit_id` courant, peut diverger |
| Conversions | `conversionEngine.ts` | Utilise l'unité courante pour convertir |

---

## Section 7 — Scénario de bug

1. Produit "BURRATA 125G" créé avec unité = `pce`
2. 10 réceptions enregistrées : +50 pce total dans stock_events
3. Utilisateur ouvre le Wizard, change l'unité en `carton` (car=6 pce)
4. **Aucune conversion/migration des events existants**
5. Nouveau mouvement : +2 cartons → stock_events écrit +2 avec `canonical_unit_id=carton`
6. `SUM(delta_quantity_canonical)` = 50 + 2 = **52** (mix pce + cartons = non-sens)
7. Stock affiché = 52 cartons (faux, devrait être ~10 cartons)

---

## Section 8 — Verdict

| Cas | Statut |
|-----|--------|
| Unité canonique modifiable après création | **OUI — sans restriction** |
| Protection existante | **AUCUNE** |
| Risque stock | **P0 — corruption active sur 25 produits** |
| Mitigation actuelle | L'inventaire du 10/03 a "reset" les snapshots, masquant le problème pour le calcul courant |

### Recommandation immédiate (non implémentée — audit seulement)

1. **Trigger SQL** : `BEFORE UPDATE ON products_v2` → si `stock_handling_unit_id` change ET des `stock_events` existent → RAISE EXCEPTION
2. **UI** : désactiver le dropdown unité stock si le produit a des mouvements
3. **Migration curative** : pour les 25 produits pollués, recalculer le stock en filtrant sur l'unité canonique actuelle uniquement

---

*Fin de l'audit — Aucun code n'a été modifié.*
