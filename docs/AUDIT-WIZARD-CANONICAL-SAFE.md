# AUDIT — Injection SAFE de validation canonical dans le Wizard

**Date** : 2026-03-30  
**Scope** : Wizard ProductFormV3 → `stock_handling_unit_id`  
**Contrainte** : ZÉRO refacto, ZÉRO migration DB, ZÉRO blocage utilisateur

---

## Section 1 — Flow exact du Wizard (où la canonical est définie)

### 1.1 — Étape 1 (Structure)
- L'utilisateur choisit `finalUnit` / `finalUnitId` → l'unité de référence physique du produit
- Optionnellement : `equivalence` (poids variable, etc.)

### 1.2 — Étape 2 (Conditionnement fournisseur)
- Packaging levels (carton, sac, boîte…)
- Chaque level a `type_unit_id` (le contenant) et `contains_unit_id` (ce qu'il contient)

### 1.3 — Étape 3 (Facturation)
- `billedUnitId` → unité facturée fournisseur

### 1.4 — Étape 4 (Gestion) — ⚡ C'EST ICI QUE LA CANONICAL EST DÉFINIE

**Fichier** : `src/modules/visionAI/components/ProductFormV3/WizardStep4.tsx`

**Mécanisme** :
1. `resolveWizardUnitContext()` calcule le graphe BFS et la `canonicalInventoryUnitId`
2. **Auto-prefill** (ligne 124-128) : si `stockHandlingUnitId` est NULL, il est initialisé à `finalUnitId`
3. **Dropdown** : l'utilisateur peut choisir parmi `unitContext.allowedInventoryEntryUnits`
4. **Verrouillage** : si `stockUnitLocked` (stock non-nul), le dropdown est disabled

**Problème clé** : Le dropdown affiche **TOUTES** les unités BFS atteignables, y compris les packagings (carton, sac, boîte). L'utilisateur peut librement choisir "Carton" comme canonical.

### 1.5 — Étape 5 (Résumé)
- Affiche la `stockHandlingUnitId` choisie
- Permet de modifier en ré-ouvrant l'étape 4

### 1.6 — Soumission (ProductFormV3Modal.tsx, ligne 499-503)
- **Guard existant** : si `effectiveStockHandlingUnitId` est NULL → toast d'erreur + retour step 5
- Ensuite → `fn_save_product_wizard` RPC ou `createProductV2()` service

### 1.7 — Auto-prefill actuel
```
Si stockHandlingUnitId == NULL → stockHandlingUnitId = finalUnitId
```
Ceci est **correct pour les produits simples** (pce, kg, L) mais l'utilisateur peut le changer vers un packaging dans le dropdown.

---

## Section 2 — Points d'injection SAFE

| # | Point d'injection | Safe ? | Risque | Impact | Recommandation |
|---|---|---|---|---|---|
| **P1** | Auto-prefill (Step 4, après calcul BFS) | ✅ OUI | Aucun | Auto-selection intelligente | Utiliser `canonicalInventoryUnitId` du BFS au lieu de `finalUnitId` brut |
| **P2** | Dropdown (Step 4, après sélection) | ✅ OUI | Faible | Warning UX non bloquant | Afficher un badge ⚠️ si l'unité choisie est un packaging |
| **P3** | Avant soumission (Modal, ligne 499) | ✅ OUI | Faible | Soft warning | Toast d'avertissement si canonical = packaging, laisser soumettre |
| **P4** | Step 5 (Résumé) | ✅ OUI | Aucun | Feedback visuel | Badge qualité sur la canonical (✅ physique / ⚠️ packaging) |
| **P5** | Dans le dropdown items (Step 4) | ✅ OUI | Aucun | UX guidée | Grouper les unités : "Recommandé" vs "Autres" |

### Détails par point

**P1 — Auto-prefill amélioré** (PRIORITÉ HAUTE)
```
Avant : stockHandlingUnitId = finalUnitId
Après  : stockHandlingUnitId = unitContext.canonicalInventoryUnitId ?? finalUnitId
```
Le BFS calcule déjà la bonne canonical (ligne 100-127 de `resolveProductUnitContext.ts`). Il suffit de l'utiliser comme valeur par défaut au lieu du `finalUnitId` brut. Impact = 0 sur les produits existants.

**P2 — Warning inline dans le dropdown** (PRIORITÉ MOYENNE)
Après que l'utilisateur sélectionne une unité de type packaging, afficher :
```
⚠️ "Carton" est une unité de conditionnement. L'inventaire sera compté en cartons.
    Recommandé : Pièce (pce) — unité physique stable.
```
Non bloquant, informatif.

**P3 — Soft guard avant soumission** (PRIORITÉ BASSE)
Si la canonical choisie a `family === "packaging"`, afficher un toast info :
```
ℹ️ Unité de stock = Carton. Les mouvements seront comptés en cartons.
```
L'utilisateur peut toujours soumettre.

**P4 — Badge qualité dans le résumé** (PRIORITÉ MOYENNE)
Dans Step 5, après le label de l'unité d'inventaire :
- ✅ `Physique` si `family ∈ {weight, volume, count}`
- ⚠️ `Packaging` si `family === "packaging"`

**P5 — Dropdown groupé** (PRIORITÉ BASSE)
Séparer le `<SelectContent>` en 2 groupes :
- **Recommandé** : unités physiques (weight, volume, count)
- **Autres** : unités packaging

---

## Section 3 — Impact système (confirmation zéro casse)

| Module | Impacté ? | Justification |
|--------|:-:|---|
| BFS / resolveProductUnitContext | ❌ NON | Aucune modification du moteur BFS |
| Stock ledger / stock_events | ❌ NON | Pas de changement de données |
| Inventaire (CountingModal) | ❌ NON | Lit `stock_handling_unit_id` tel quel |
| Réception / Retrait | ❌ NON | Lit `stock_handling_unit_id` tel quel |
| Import B2B | ❌ NON | Son flow est séparé (copie du fournisseur) |
| product_input_config | ❌ NON | Résolveur indépendant |
| fn_save_product_wizard (SQL) | ❌ NON | Aucune modification RPC |
| Trigger guard_stock_unit_change | ❌ NON | Aucune modification trigger |
| Prix / facturation | ❌ NON | Pas de lien avec canonical |

**Verdict : ZÉRO module impacté. Toutes les modifications sont UI-only dans Step 4 et Step 5.**

---

## Section 4 — Dépendances de la canonical (référence)

| Consommateur | Fichier | Comment il lit la canonical |
|---|---|---|
| Stock courant | `useProductCurrentStock.ts` | `SUM(delta_quantity_canonical)` filtré par `canonical_family` |
| Inventaire | `CountingModal`, `QuantityModalWithResolver` | Via `resolveInputUnitForContext` → `product_input_config` |
| Réception | `useReceptionLines` | Via `buildCanonicalLine` → BFS |
| Retrait | `useWithdrawalLines` | Via `buildCanonicalLine` → BFS |
| BFS moteur | `resolveProductUnitContext` | `stock_handling_unit_id` est le `baseTargetId` |
| Stock init | `fn_initialize_product_stock` | Utilise `stock_handling_unit_id` du produit |
| Import B2B | `b2b_imported_products` | Copie la canonical du fournisseur |

---

## Section 5 — Typologie des mauvaises canonical actuelles

| Type | Exemple | Risque | Cause |
|---|---|---|---|
| Packaging comme canonical | Carton, Boîte, Sachet | 🔴 Élevé — dépend de la logistique fournisseur | Dropdown non filtré + utilisateur choisit le contenant |
| Packaging multi-fournisseur | Sac (fournisseur A = 5kg, B = 10kg) | 🔴 Élevé — canonical ambiguë | Import B2B copie le packaging source |
| Unité de packaging auto-prefill | Wizard auto-selectionne `finalUnitId` qui est un packaging | 🟡 Moyen | finalUnit parfois mal définie |

### Analyse quantitative (données audit 2026-03-30)
- 52.4% des produits (227/433) ont une canonical = packaging
- 8 produits ont des familles mélangées dans stock_events
- 18 produits ont des événements historiques avec une unité différente de la canonical actuelle

---

## Section 6 — Plan d'évolution SAFE (4 étapes)

### Phase 1 — Auto-prefill intelligent (immédiat, 0 risque)
- **Fichier** : `WizardStep4.tsx`, ligne 124-128
- **Changement** : remplacer `finalUnitId` par `unitContext.canonicalInventoryUnitId ?? finalUnitId`
- **Impact** : les nouveaux produits auront une meilleure canonical par défaut
- **Risque** : 0 — l'utilisateur peut toujours changer

### Phase 2 — Warning visuel packaging (faible effort)
- **Fichier** : `WizardStep4.tsx`, après le `<Select>` inventaire
- **Changement** : si l'unité sélectionnée a `family === "packaging"`, afficher un `<Alert>` jaune
- **Impact** : information + guidage
- **Risque** : 0 — purement informatif

### Phase 3 — Dropdown groupé "Recommandé / Autres"
- **Fichier** : `WizardStep4.tsx`, dans le `<SelectContent>`
- **Changement** : `<SelectGroup>` avec label "Recommandé" pour les physiques, "Autres" pour packaging
- **Impact** : UX améliorée, choix guidé
- **Risque** : 0

### Phase 4 — Badge qualité Step 5 (résumé)
- **Fichier** : `WizardStep5.tsx`, section inventaire
- **Changement** : badge coloré vert/jaune selon la famille
- **Impact** : feedback avant soumission
- **Risque** : 0

---

## Section 7 — Risques si mal implémenté

| Risque | Impact | Mitigation |
|---|---|---|
| Bloquer le dropdown à uniquement les unités physiques | 🔴 Certains produits DOIVENT être comptés en cartons (fromage, etc.) | Ne JAMAIS bloquer, uniquement guider |
| Modifier le BFS pour forcer une canonical | 🔴 Casse tout le moteur de conversion | Ne JAMAIS toucher au BFS |
| Ajouter une validation côté SQL/RPC | 🟡 Risque de bloquer les imports B2B | Pas recommandé dans cette phase |
| Changer le auto-prefill pour un packaging quand finalUnit est packaging | 🟡 Changerait le comportement par défaut | Utiliser `canonicalInventoryUnitId` du BFS (déjà correct) |

---

## Section 8 — Verdict

| Question | Réponse |
|---|---|
| Le wizard empêche-t-il les mauvaises canonical ? | ❌ NON — dropdown non filtré |
| Le système a-t-il un resolver intelligent ? | ✅ OUI — `resolveCanonical()` calcule la bonne canonical |
| Le résultat du resolver est-il utilisé comme défaut ? | ❌ NON — l'auto-prefill utilise `finalUnitId` brut |
| Peut-on améliorer sans casser ? | ✅ OUI — 4 phases UI-only |
| Le BFS doit-il changer ? | ❌ NON |
| La DB doit-elle changer ? | ❌ NON |

### Recommandation principale

> Le resolver BFS (`resolveCanonical()`) calcule DÉJÀ la bonne canonical.
> Le problème est que l'auto-prefill de Step 4 utilise `finalUnitId` au lieu de `canonicalInventoryUnitId`.
> La correction est triviale (1 ligne) et n'impacte aucun module existant.

---

*Fin de l'audit — Aucun code n'a été modifié.*
