# AUDIT FINAL — B2B INTER-ORG (VALIDATION AVANT CORRECTION)

**Date :** 2026-03-25  
**Scope :** Flow B2B complet — modification fournisseur, écrans secondaires, robustesse config, logiques parallèles, symétrie bidirectionnelle  
**Méthode :** Lecture exhaustive du code source (frontend + SQL)  
**Résultat :** ⚠️ 2 bugs confirmés, 3 failles silencieuses, 2 duplications

---

## 1. AUDIT 1 — MODIFICATION FOURNISSEUR (CRITIQUE)

### 1A. Scénario : Fournisseur ne modifie pas (conforme — Swipe OK)

| Étape | Quantité | Référentiel | OK/NOK |
|-------|----------|-------------|--------|
| canonical_quantity en base | ex: 0.25 | Client (Carton) | — |
| Affichée fournisseur via erpFormat | 50 | Fournisseur (Pièce) | ✅ |
| handleOk → localShippedQty = canonical_quantity | 0.25 | Client | ✅ |
| persistLine → shipped_quantity = 0.25 | 0.25 | Client | ✅ |
| handleShip → shipped_quantity envoyé au backend | 0.25 | Client | ✅ |
| fn_ship_commande L60-66 → LEAST(0.25, 0.25) = 0.25 | 0.25 | Client | ✅ |
| fn_ship_commande L128-131 → fn_convert_b2b_quantity(0.25 Carton) → 50 Pièce | 50 | Fournisseur | ✅ |
| stock_events delta = -50 | 50 | Fournisseur | ✅ |
| shipped_quantity finale en base | 0.25 | Client | ✅ |
| Client lit shipped_quantity = 0.25 | 0.25 | Client | ✅ |

**Verdict : ✅ SAIN** — Le flow conforme est parfaitement cohérent.

---

### 1B. Scénario : Fournisseur modifie via modal BFS (quantité différente)

**Exemple :** Commande 0.25 Carton client (= 50 Pièce fournisseur). Le fournisseur veut expédier 40 Pièce.

| Étape | Quantité | Référentiel | OK/NOK |
|-------|----------|-------------|--------|
| canonical_quantity en base | 0.25 | Client (Carton) | — |
| **PreparationDialog L237-264** : translation client→fournisseur via factorToTarget | 50 | Fournisseur (Pièce) | ✅ |
| BFS modal pré-rempli avec 50 | 50 | Fournisseur | ✅ |
| Fournisseur saisit 40, confirme → handleBfsConfirm reçoit canonicalQuantity=40 | 40 | **Fournisseur (canonical supplier)** | ⚠️ |
| persistLine(lineId, **40**, "modifie") → shipped_quantity = 40 | 40 | **FOURNISSEUR écrit dans champ CLIENT** | 🔴 |
| fn_ship_commande L60-66 → LEAST(**40**, 0.25) = **0.25** | 0.25 | Client | 🔴 |
| fn_ship_commande L128 → fn_convert_b2b_quantity(0.25 Carton) → 50 Pièce | 50 | Fournisseur | 🔴 |
| stock_events delta = -50 (= quantité commandée complète) | 50 | Fournisseur | 🔴 |
| **La modification du fournisseur (40 au lieu de 50) est IGNORÉE** | — | — | 🔴 |

**Verdict : 🔴 BUG CONFIRMÉ** — La modification fournisseur via BFS est silencieusement écrasée par le clamp `LEAST(input, canonical_quantity)` car `shipped_quantity` reçoit une valeur en espace fournisseur (40 Pièce) qui est comparée à `canonical_quantity` en espace client (0.25 Carton). Comme 40 > 0.25, le clamp ramène à 0.25, annulant la modification.

---

### 1C. Scénario : Fournisseur met une quantité plus faible (ex: 20 Pièce)

Même mécanisme que 1B :
- persistLine écrit 20 dans shipped_quantity
- LEAST(20, 0.25) = 0.25 → **modification ignorée**

**Verdict : 🔴 MÊME BUG**

---

### 1D. Scénario : Fournisseur fait une rupture partielle (shipped=0 via bouton)

| Étape | Quantité | Référentiel | OK/NOK |
|-------|----------|-------------|--------|
| handleRupture → localShippedQty = 0, status = rupture | 0 | Client | ✅ |
| persistLine → shipped_quantity = 0 | 0 | Client | ✅ |
| fn_ship_commande → 0, line_status = rupture → pas de stock_event | 0 | — | ✅ |

**Verdict : ✅ SAIN** — La rupture totale fonctionne car elle utilise la valeur 0 (pas de conversion).

---

### 1E. Scénario : CompositePreparationDialog — Modal BFS

| Étape | Quantité | Référentiel | OK/NOK |
|-------|----------|-------------|--------|
| **L236** : `setBfsExistingQty(line.canonical_quantity)` | 0.25 | Client | 🔴 |
| BFS modal reçoit 0.25 au lieu de 50 | 0.25 | **Client injecté comme fournisseur** | 🔴 |
| Fournisseur voit "0.25" et ne comprend pas | — | — | 🔴 |
| Même problème d'écriture que 1B ensuite | — | — | 🔴 |

**Verdict : 🔴 BUG CONFIRMÉ** — Double bug : pré-remplissage brut + écriture dans mauvais référentiel.

---

### ⚠️ Résumé CRITIQUE — Bug de double conversion

Le problème fondamental est que `handleBfsConfirm` dans **PreparationDialog** (L276) et **CompositePreparationDialog** (L242) écrivent `params.canonicalQuantity` directement dans `shipped_quantity`. Cette valeur est en **espace fournisseur** (output du BFS modal qui opère sur le produit fournisseur). Or `shipped_quantity` est interprété par `fn_ship_commande` comme étant en **espace client**, puisqu'il est clampé contre `canonical_quantity` (client) et reconverti par `fn_convert_b2b_quantity`.

**Conséquence :** Toute modification via BFS est soit ignorée (clamp à canonical_quantity) soit produit une valeur absurde.

---

## 2. AUDIT 2 — ÉCRANS SECONDAIRES B2B

| Composant | Problème | Impact | Priorité |
|-----------|----------|--------|----------|
| **CompositeDetailDialog** L196 | `{line.canonical_quantity} {line.unit_label_snapshot}` affiché en dur, sans erpFormat | Fournisseur voit "0.25 Carton" au lieu de "50 Pièce" pour les qtés modifiées (barré) | P2 |
| **CompositeDetailDialog** L200 | idem pour le texte barré | Même problème | P2 |
| **RetourDetailDialog** L117-119 | `{productReturn.quantity} {productReturn.unit_label_snapshot}` sans erpFormat | Fournisseur voit la quantité/unité du client non traduite | P2 |
| **CommandeDetailDialog** L567, 605, 608, 677 | Utilise erpFormat correctement ✅ | — | — |
| **PreparationDialog** L710-724 | Utilise erpFormat correctement ✅ | — | — |
| **CompositePreparationDialog** L535-536 | Utilise erpFormat correctement ✅ | — | — |
| **LitigeDetailDialog** L277-281 | Utilise erpFormat correctement ✅ | — | — |
| **ReceptionDialog** L1377-1381 | Utilise erpFormat (client-side, correct) ✅ | — | — |

---

## 3. AUDIT 3 — ROBUSTESSE AUX CHANGEMENTS PRODUIT

| Scénario | Impact | Stable / Instable |
|----------|--------|-------------------|
| Client change stock_handling_unit_id après commande | **Stable** — commande_lines a `canonical_unit_id` et `unit_label_snapshot` snapshotés. erpFormat utilise le label snapshot en fallback | Stable |
| Client change nom d'unité | **Fragile** — erpFormat Pass 2 fait un matching textuel par nom/abréviation. Si le nom change, le matching échoue → fallback raw qty | Fragile |
| Fournisseur change son packaging | **Fragile** — erpFormat refetch le produit fournisseur actuel. Si les niveaux changent, le BFS produit un résultat différent pour les mêmes snapshots | Fragile |
| Suppression unité client | **Stable** — `canonical_unit_id` UUID reste en base, l'affichage utilise `unit_label_snapshot` en fallback | Stable |
| Ajout/suppression niveau conditionnement fournisseur | **Fragile** — erpFormat et BFS modal utilisent le produit fournisseur actuel, pas un snapshot | Fragile |
| Produit importé mis à jour (b2b_imported_products change) | **Stable** — le mapping est résolu dynamiquement, les commandes existantes gardent leurs snapshots | Stable |
| Unité avec family = null | **Stable** — fn_convert_b2b_quantity gère ce cas (fallback sémantique) | Stable |

**Protection snapshot :** `product_name_snapshot`, `unit_label_snapshot`, `canonical_unit_id`, `canonical_quantity` sont tous snapshotés à la création. La fragilité réside uniquement dans la résolution dynamique du packaging fournisseur pour l'affichage.

---

## 4. AUDIT STRUCTUREL — LOGIQUES PARALLÈLES

| Logique | Où | Utilisée par | Différences |
|---------|-----|-------------|-------------|
| **erpFormat (Pass 2 b2b_mapped)** | `useErpQuantityLabels.ts` L246-267 | CommandeDetailDialog, PreparationDialog, CompositePreparationDialog, LitigeDetailDialog, ReceptionDialog | Translation par matching nom/abréviation du `unit_label_snapshot` |
| **Translation BFS pré-remplissage** | `PreparationDialog.ts` L224-264 | PreparationDialog uniquement | Même logique que Pass 2 mais **dupliquée** inline. Utilise `resolveProductUnitContext` + matching nom |
| **Translation BFS pré-remplissage (Composite)** | `CompositePreparationDialog.tsx` L236 | CompositePreparationDialog | **ABSENTE** — injecte canonical_quantity brut |
| **fn_convert_b2b_quantity** | SQL migration | fn_ship_commande, fn_resolve_litige, fn_post_b2b_reception | Autoritaire. Résolution par UUID, BFS, sémantique, ou remappage conditionnement_config |
| **Affichage brut RetourDetailDialog** | `RetourDetailDialog.tsx` L118 | RetoursList | **Aucune translation** — affiche `quantity` + `unit_label_snapshot` tel quel |
| **Affichage brut CompositeDetailDialog** | `CompositeDetailDialog.tsx` L196-200 | Commandes composites | **Aucune translation** — affiche raw canonical_quantity + unit_label_snapshot |

### Duplications identifiées

1. **PreparationDialog L224-264** duplique la logique de `useErpQuantityLabels` Pass 2. Même pattern : matching nom/abréviation → factorToTarget.
2. **CompositePreparationDialog** devrait avoir la même logique mais ne l'a pas.

### Logiques absentes

1. **CompositePreparationDialog** L236 : pas de translation avant injection BFS
2. **RetourDetailDialog** : pas de erpFormat
3. **CompositeDetailDialog** L196-200 : pas de erpFormat pour les quantités barrées
4. **handleBfsConfirm** (les deux dialogs) : pas de re-translation supplier→client avant persistLine

---

## 5. AUDIT FINAL — SYMÉTRIE B2B

### Sens A — Client → Fournisseur

| Point | Cohérent | Bugs |
|-------|----------|------|
| Affichage quantité fournisseur (erpFormat) | ✅ | — |
| Modal préparation (PreparationDialog) — conforme | ✅ | — |
| Modal préparation (PreparationDialog) — BFS modification | 🔴 | Pré-remplissage OK, mais écriture shipped_quantity en supplier-space |
| Modal préparation (CompositePreparationDialog) — BFS | 🔴 | Pré-remplissage brut + écriture supplier-space |
| Expédition conforme | ✅ | — |
| Litige affichage | ✅ | Via erpFormat |

### Sens B — Fournisseur → Client

| Point | Cohérent | Bugs |
|-------|----------|------|
| shipped_quantity en base après conforme | ✅ | Reste en client-space |
| shipped_quantity en base après BFS modification | 🔴 | Contient valeur supplier-space, clampée à canonical_quantity |
| fn_ship_commande conversion stock | ✅ | Correct pour conforme, **masque** le bug BFS (clamp) |
| Réception client (ReceptionDialog) | ✅ | Lit shipped_quantity comme client-space |
| Litige (fn_resolve_litige) | ✅ | Utilise fn_convert_b2b_quantity |
| Retour (RetourDetailDialog) | ⚠️ | Affichage brut sans translation |

---

## 6. BUGS CONFIRMÉS (AVEC PREUVE)

### Bug 1 : CompositePreparationDialog — Pré-remplissage BFS brut

- **Fichier :** `src/pages/commandes/CompositePreparationDialog.tsx`
- **Ligne :** 236
- **Code :** `setBfsExistingQty(line.canonical_quantity)`
- **Scénario :** Commande 0.25 Carton (client) = 50 Pièce (fournisseur). Modal BFS affiche 0.25 au lieu de 50.
- **Impact :** Le fournisseur ne peut pas modifier intelligemment la quantité.

### Bug 2 : PreparationDialog + CompositePreparationDialog — Écriture BFS en mauvais référentiel

- **Fichier :** `src/modules/commandes/components/PreparationDialog.tsx` L276-284 et `src/pages/commandes/CompositePreparationDialog.tsx` L242-247
- **Code :** `persistLine(bfsLineId, qty, status)` où `qty = params.canonicalQuantity` (supplier-space)
- **Scénario :** Le BFS modal retourne 40 Pièce (fournisseur). Ceci est écrit dans `shipped_quantity`. `fn_ship_commande` LEAST(40, 0.25) = 0.25. La modification est annulée.
- **Impact :** **Toute modification fournisseur via BFS est silencieusement ignorée.** Le fournisseur pense avoir modifié mais la quantité complète est expédiée.

---

## 7. FAILLES SILENCIEUSES POTENTIELLES

| # | Description | Probabilité | Impact |
|---|-------------|-------------|--------|
| 1 | Matching textuel `unit_label_snapshot` échoue si unité renommée | Faible | Affichage brut au lieu de packaging structuré |
| 2 | CompositeDetailDialog affiche raw qty côté fournisseur pour les lignes modifiées | Moyenne | Confusion visuelle pour le fournisseur |
| 3 | RetourDetailDialog affiche quantité/unité client brute au fournisseur | Moyenne | Fournisseur voit "0.25 Carton" au lieu de "50 Pièce" |

---

## 8. LOGIQUES DUPLIQUÉES

| Où | Pourquoi | Risque |
|----|----------|--------|
| PreparationDialog L224-264 (translation inline) vs useErpQuantityLabels Pass 2 | Même logique de matching nom/abréviation + factorToTarget | Divergence si l'un est corrigé sans l'autre |
| CompositePreparationDialog devrait avoir la même logique mais l'a oubliée | Oubli lors de la création du composite | Bug actif |

---

## 9. ÉTAT GLOBAL

### Fiabilité estimée : ~88%

| Zone | État |
|------|------|
| Flow conforme (OK/Rupture) — PreparationDialog | ✅ Sain |
| Flow conforme (OK/Rupture) — CompositePreparationDialog | ✅ Sain |
| Affichage principal fournisseur (erpFormat) | ✅ Sain |
| Backend fn_ship_commande (conversion stock) | ✅ Sain |
| Backend fn_resolve_litige | ✅ Sain |
| Backend fn_post_b2b_reception | ✅ Sain |
| Réception client (ReceptionDialog) | ✅ Sain |
| Litige (LitigeDetailDialog) | ✅ Sain |
| BFS modification fournisseur (PreparationDialog) | 🔴 Cassé (écriture mauvais ref) |
| BFS modification fournisseur (CompositePreparationDialog) | 🔴 Cassé (pré-remplissage + écriture) |
| Affichage CompositeDetailDialog (lignes modifiées) | ⚠️ Fragile (raw display) |
| Affichage RetourDetailDialog | ⚠️ Fragile (raw display) |
| Matching textuel unités | ⚠️ Fragile (renommage possible) |

---

## 10. LISTE DES CORRECTIONS À FAIRE (SANS CODER)

### Priorité 1 — Critique

1. **CompositePreparationDialog L236 :** Ajouter la translation client→fournisseur avant injection BFS (extraire de PreparationDialog L224-264)
2. **PreparationDialog + CompositePreparationDialog handleBfsConfirm :** Après réception de `canonicalQuantity` (supplier-space), re-traduire en client-space avant d'écrire dans `shipped_quantity`. Utiliser la logique inverse : `supplierQty / factorToTarget`.

### Priorité 2 — Affichage

3. **CompositeDetailDialog L196-200 :** Remplacer `{line.canonical_quantity} {line.unit_label_snapshot}` par `erpFormat(...)` (nécessite d'ajouter useErpQuantityLabels au composant)
4. **RetourDetailDialog L118 :** Remplacer `{productReturn.quantity} {productReturn.unit_label_snapshot}` par un affichage traduit (nécessite de brancher erpFormat ou un helper équivalent)

### Priorité 3 — Unification

5. **Extraire un helper partagé** `translateClientQtyToSupplier(canonicalQty, unitLabelSnapshot, supplierOptions)` pour éliminer la duplication entre PreparationDialog L224-264 et le Pass 2 de useErpQuantityLabels
6. **Extraire un helper inverse** `translateSupplierQtyToClient(supplierQty, unitLabelSnapshot, supplierOptions)` pour le retour après BFS

### Non-prioritaire

7. Le matching textuel (nom/abréviation) est le meilleur compromis actuel sans refonte majeure. Un matching par UUID nécessiterait de stocker `canonical_unit_id` du fournisseur dans le snapshot, ce qui est un changement de schéma.

---

## STOP
