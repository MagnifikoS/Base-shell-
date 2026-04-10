# PHASE 1 — CORRECTION DES PRODUITS INACTIFS

## Document : phase 1 cross tenant

**Date** : 2026-03-18  
**Statut** : Correction terminée et vérifiée  
**Périmètre** : Produits à 0 stock_events uniquement

---

## 1. CRITÈRE "INACTIF" UTILISÉ

**Définition stricte** : Un produit est considéré inactif si et seulement si :
```sql
NOT EXISTS (SELECT 1 FROM stock_events se WHERE se.product_id = products_v2.id)
```

Cela signifie : **zéro mouvement de stock** — aucune réception, aucun retrait, aucun inventaire, aucune correction. Le produit existe dans le catalogue mais n'a jamais participé à aucun flow stock critique.

✅ **Confirmation explicite** : ce critère couvre tous les flows critiques (réception, retrait, inventaire, correction stock) car ils passent tous par `stock_events`.

---

## 2. PRODUITS CORRIGÉS PAR ÉTABLISSEMENT

| Établissement | Produits corrigés | Statut |
|---|---|---|
| **CL** | 1 | ✅ Tous clean |
| **Magnifiko** | 101 | ✅ Tous clean |
| **NONNA SECRET** | 89 | ✅ Tous clean |
| **Piccolo Magnifiko** | 101 | ✅ Tous clean |
| **TOTAL** | **292** | ✅ |

---

## 3. CLÉS JSON REMAPPÉES

Toutes les clés UUID du JSON ont été remappées, incluant :

| Clé JSON | Remappée ? |
|---|---|
| `equivalence.unit_id` | ✅ OUI |
| `equivalence.source_unit_id` | ✅ OUI |
| `packagingLevels[].type_unit_id` | ✅ OUI |
| `packagingLevels[].contains_unit_id` | ✅ OUI |
| `priceLevel.billed_unit_id` | ✅ OUI |
| `final_unit_id` (dans JSON) | ✅ OUI (si étranger) |

**Garde-fou #1 respecté** : `priceLevel.billed_unit_id` et toute clé UUID touchée ont été remappées.

---

## 4. ERREURS DE MAPPING DÉTECTÉES ET CORRIGÉES EN COURS DE PHASE

Pendant la vérification post-correction, 3 erreurs de mapping ont été détectées dans la table de Phase 0 :

| Unité | UUID Phase 0 (FAUX) | UUID réel (CORRIGÉ) | Établissement |
|---|---|---|---|
| Sachet (sach) | `77d0f1a1-...` ❌ inexistant | `06dc2476-92f8-4fb5-812e-65bccfb9e5e3` ✅ | Magnifiko |
| Rouleau (roul) | `0b6f0acf-...` ❌ inexistant | `fe61c2ae-fe06-41b5-a9b6-ebc7b951e0a9` ✅ | Magnifiko |
| Seau (seau) | ❌ absent du mapping | `93f63d30-a69d-4375-a0d2-472a39a31b85` ✅ | Magnifiko |
| Seau (seau) | ❌ absent du mapping | `d888bfb9-a1dc-459f-b92b-b2f970ccd6b8` ✅ | Piccolo |

**Actions correctives** :
1. Les produits corrigés avec les mauvais UUIDs ont été immédiatement re-corrigés vers les bons UUIDs
2. La vérification finale confirme 0 UUID orphelin restant

---

## 5. VÉRIFICATION POST-CORRECTION (GARDE-FOU #2)

### Résultat : ✅ AUCUN UUID étranger ou orphelin restant sur les produits inactifs

```
Requête de vérification : 0 résultats (aucun UUID cross-tenant ni orphelin)
```

### Détail par établissement — produits inactifs 100% locaux :

| Établissement | Produits clean | Produits dirty |
|---|---|---|
| CL | 1 | **0** |
| Magnifiko | 101 | **0** |
| NONNA SECRET | 89 | **0** |
| Piccolo Magnifiko | 101 | **0** |

**Garde-fou #2 respecté** : Tous les UUID restants dans les JSON corrigés appartiennent à l'établissement local.

---

## 6. PRODUITS VIVANTS NON TOUCHÉS (GARDE-FOU #3)

### Preuve que les produits actifs n'ont PAS été modifiés :

Les compteurs cross-tenant des produits actifs sont **identiques** à ceux de Phase 0 :

| Établissement | Type | Produits actifs (Phase 0) | Produits actifs (Post Phase 1) | Changement |
|---|---|---|---|---|
| CL | CROSS_TENANT | 2 | 2 | **0** ✅ |
| Magnifiko | CROSS_TENANT | 116 | 116 | **0** ✅ |
| Magnifiko | ORPHAN | 13 | 13 | **0** ✅ |
| NONNA SECRET | ORPHAN | 20 | 20 | **0** ✅ |
| Piccolo Magnifiko | CROSS_TENANT | 47 | 47 | **0** ✅ |
| Piccolo Magnifiko | ORPHAN | 3 | 3 | **0** ✅ |

**Garde-fou #3 respecté** : Aucun produit avec stock_events n'a été touché.

---

## 7. PRODUITS EXPLICITEMENT IGNORÉS

Tous les produits actifs (avec au moins 1 stock_event) ont été ignorés :

| Établissement | Produits ignorés (actifs) | Raison |
|---|---|---|
| CL | 2 | stock_events > 0 |
| Magnifiko | 129 (116 cross-tenant + 13 orphan) | stock_events > 0 |
| NONNA SECRET | 20 | stock_events > 0 (orphan uniquement) |
| Piccolo Magnifiko | 50 (47 cross-tenant + 3 orphan) | stock_events > 0 |
| **TOTAL ignorés** | **201** | — |

---

## 8. TABLE DE MAPPING CORRIGÉE POUR PHASES 2-3

### Corrections par rapport à Phase 0 :

**Magnifiko ← NONNA SECRET** (mapping corrigé) :

| Unité | NONNA UUID | Magnifiko UUID (CORRIGÉ) |
|---|---|---|
| Sachet | `922fde96-4e1c-4605-aa45-da802e07c582` | `06dc2476-92f8-4fb5-812e-65bccfb9e5e3` |
| Rouleau | `06ae69f9-2d21-45a7-a1bd-ce40b486d68d` | `fe61c2ae-fe06-41b5-a9b6-ebc7b951e0a9` |
| Seau | `6fe9f6b7-3bb2-4033-8c30-9bbbd5c8b7d2` | `93f63d30-a69d-4375-a0d2-472a39a31b85` |

**Piccolo ← NONNA SECRET** (ajout) :

| Unité | NONNA UUID | Piccolo UUID |
|---|---|---|
| Seau | `6fe9f6b7-3bb2-4033-8c30-9bbbd5c8b7d2` | `d888bfb9-a1dc-459f-b92b-b2f970ccd6b8` |

---

## 9. VALIDATION JSON

- ✅ Toutes les corrections utilisent `::jsonb` cast — si le JSON était invalide, le UPDATE aurait échoué
- ✅ Aucune erreur retournée par les UPDATEs
- ✅ La vérification post-correction a pu parser tous les JSON corrigés

---

## 10. STOCK_EVENTS NON MODIFIÉS

- ✅ **Confirmation** : Aucune requête UPDATE/INSERT/DELETE n'a été exécutée sur `stock_events`
- ✅ Les stock_events cross-tenant restent en l'état (hors périmètre de cette mission)

---

## 11. CONCLUSION

| Métrique | Valeur |
|---|---|
| Produits inactifs corrigés | **292** |
| UUID cross-tenant éliminés (inactifs) | **~450** |
| UUID orphelins éliminés (inactifs) | **~45** |
| Erreurs de mapping détectées/corrigées | **3** |
| Produits actifs restant à traiter (Phase 2-3) | **201** |
| Produits actifs modifiés | **0** |
| Stock_events modifiés | **0** |
| JSON invalides après correction | **0** |

---

## STOP — En attente de validation pour passer à la PHASE 2
