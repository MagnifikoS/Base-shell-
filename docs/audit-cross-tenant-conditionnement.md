# AUDIT CROSS TENANT CONDITIONNEMENT

**Date** : 2026-03-18  
**Statut** : Audit parano — aucune modification effectuée  
**Auteur** : Système d'audit automatisé

---

## 1. RÉSUMÉ EXÉCUTIF

| Critère | Valeur |
|---------|--------|
| **Gravité réelle** | 🔴 **CRITIQUE** — plus grave que prévu |
| **Périmètre** | 4 établissements touchés sur 7 |
| **Produits affectés** | **342 produits** (JSON config) |
| **Références cassées (JSON)** | **700 UUID** cross-tenant + orphelins |
| **Stock events contaminés** | **306 mouvements** dans 2 établissements (FO, NONNA) |
| **FK directes (colonnes SQL)** | ✅ 100% propres — **zéro** cross-tenant |
| **Risque immédiat** | Le BFS de conversion échoue silencieusement → les unités dérivées (kg, g, ml) ne s'affichent pas dans les popups de retrait/inventaire |
| **Risque latent** | Les 306 stock_events cross-tenant pourraient fausser les calculs de stock si le filtre par `establishment_id` n'est pas systématique |

**Conclusion simple** : Le problème est **double**. Le JSON `conditionnement_config` est contaminé (attendu), mais les `stock_events` le sont aussi (découverte critique). La correction du JSON est faisable et sûre. La correction des stock_events nécessite plus de prudence.

---

## 2. CARTOGRAPHIE DU PROBLÈME

### 2.1 Contamination du JSON `conditionnement_config`

| Établissement touché | Produits affectés | Réfs cross-tenant | Source des UUID étrangers | Réfs orphelines |
|---------------------|-------------------|-------------------|--------------------------|-----------------|
| **Magnifiko** | 164 / 235 (70%) | 336 | NONNA SECRET | 22 |
| **Piccolo Magnifiko** | 147 / 151 (97%) | 290 | NONNA SECRET | 20 |
| **NONNA SECRET** | 26 / 258 (10%) | 0 | — | 26 |
| **CL** | 2 / 4 (50%) | 6 | FO | 0 |
| **FO** | 0 / 3 | 0 | — | 0 |
| **Sapori MIEI** | 0 / 3 | 0 | — | 0 |
| **PANOZZO** | 0 / 0 | 0 | — | 0 |

**Total** : 339 produits, 632 réfs cross-tenant, 68 réfs orphelines = **700 UUID problématiques**

### 2.2 UUID orphelin unique

Un seul UUID orphelin est partagé par les 3 établissements touchés :

| UUID | Label d'origine | Produits touchés | Présent dans |
|------|----------------|------------------|-------------|
| `0d2550fd-98ba-48ab-92a2-233a2da40c92` | Millilitre (ml) — **supprimé** | 68 produits | NONNA (26), Magnifiko (22), Piccolo (20) |

Cet UUID était probablement le "Millilitre" original de NONNA SECRET qui a été supprimé/recréé. Il apparaît systématiquement dans le champ `equivalence.unit_id` des produits dont l'équivalence est en `ml`.

### 2.3 Structures JSON touchées

Les UUID cross-tenant apparaissent dans **3 zones** du JSON :

| Zone JSON | Champs contaminés | Impact |
|-----------|-------------------|--------|
| `equivalence` | `unit_id`, `source_unit_id`, `from_unit_id`, `to_unit_id` | 🔴 Le BFS ne trouve pas l'unité cible → pas de conversion cross-famille |
| `packagingLevels[]` | `type_unit_id`, `contains_unit_id` | 🔴 Le BFS ne construit pas les arêtes packaging → unités intermédiaires invisibles |
| `final_unit_id` (dans JSON) | `final_unit_id` | 🟡 Redondant avec la colonne FK (qui est propre), mais peut être lu par du code legacy |

### 2.4 ⚠️ DÉCOUVERTE CRITIQUE : Stock Events contaminés

| Établissement | Events cross-tenant | Total events | % contaminé | Source des UUID |
|---------------|--------------------:|-------------:|------------:|-----------------|
| **NONNA SECRET** | 226 | 1 018 | **22%** | Magnifiko (majorité), Piccolo |
| **FO** | 80 | 85 | **94%** | CL |
| **Magnifiko** | 0 | 338 | 0% | — |
| **Piccolo** | 0 | 66 | 0% | — |
| **CL** | 0 | 69 | 0% | — |

Les `stock_events` de NONNA et FO contiennent des `canonical_unit_id` pointant vers des unités d'autres établissements. **Ce n'est PAS un problème de JSON** — c'est un problème dans les colonnes SQL directes des mouvements de stock.

Unités cross-tenant dans les events NONNA :
- Pièce (Magnifiko) : 70 events
- Kilogramme (Magnifiko) : 28 events  
- Pièce (Piccolo) : 23 events
- Paquet, Bouteille, Boîte, Bidon, Sachet, Pot, etc.

---

## 3. CE QUI EST CASSÉ / CE QUI NE L'EST PAS

### ✅ Ce qui fonctionne correctement

| Élément | Statut | Détail |
|---------|--------|--------|
| **Colonnes FK sur products_v2** | ✅ 100% propre | `stock_handling_unit_id`, `final_unit_id`, `withdrawal_unit_id` — **zéro** cross-tenant sur **tous** les établissements |
| **Stock events Magnifiko** | ✅ Propre | 338 events, 0 cross-tenant |
| **Stock events Piccolo** | ✅ Propre | 66 events, 0 cross-tenant |
| **Stock events CL** | ✅ Propre | 69 events, 0 cross-tenant |
| **Calcul de stock (solde)** | ✅ Probablement OK | Le solde utilise `delta_quantity_canonical` (un nombre) + `canonical_unit_id`. Même si l'UUID est cross-tenant, la valeur numérique reste correcte |
| **Inventaires existants** | ✅ Non impactés | `inventory_lines` stocke des quantités, pas des UUID conditionnement |

### ❌ Ce qui est cassé

| Élément | Statut | Impact |
|---------|--------|--------|
| **Graphe BFS** pour 339 produits | ❌ Cassé | Le moteur de conversion ne charge que les unités locales → les UUID étrangers dans le JSON sont introuvables → pas de chemin de conversion |
| **Popup retrait** | ❌ Unités manquantes | L'utilisateur ne voit pas kg/g/ml comme option de retrait pour les produits affectés |
| **Popup inventaire** | ❌ Unités manquantes | Même problème |
| **Wizard conditionnement** | 🟡 Partiel | Si l'utilisateur réouvre le wizard, il peut voir des incohérences sur les unités pré-remplies |

### ⚠️ Ce qui est suspect mais non confirmé cassé

| Élément | Risque | Analyse |
|---------|--------|---------|
| **Stock events FO** (94% cross-tenant) | ⚠️ Moyen | Les events utilisent des UUID de CL. Le `canonical_unit_id` pointe vers "Pièce (CL)" au lieu de "Pièce (FO)". Le nom et l'abréviation sont identiques → le calcul de stock est **numériquement correct** mais **référentiellement impropre** |
| **Stock events NONNA** (22% cross-tenant) | ⚠️ Moyen | Même diagnostic : les UUID pointent vers Magnifiko/Piccolo mais désignent les mêmes unités logiques |

---

## 4. IMPACT SUR LA PRODUCTION

### 4.1 Effets possibles aujourd'hui

| Flux | Impact | Sévérité |
|------|--------|----------|
| **Retrait stock** | L'utilisateur ne peut pas saisir en kg/g/ml pour les produits affectés | 🔴 Bloquant UX |
| **Inventaire** | L'utilisateur ne voit pas toutes les unités de saisie | 🟡 Gênant mais contournable (saisie en unité de base) |
| **Réception BL** | Pas d'impact direct (utilise les FK colonnes, pas le JSON) | ✅ OK |
| **Commandes** | Pas d'impact direct | ✅ OK |
| **Calcul de stock** | Le solde est numériquement correct | ✅ OK |
| **Affichage prix** | Utilise les FK colonnes | ✅ OK |

### 4.2 Effets possibles demain

| Risque | Probabilité | Impact |
|--------|------------|--------|
| Si on ajoute un filtre `establishment_id` strict sur les requêtes stock_events | Moyenne | Les 306 events cross-tenant seraient **exclus** → stock faussé pour NONNA et FO |
| Si on fait un audit d'intégrité automatique | Haute | Faux positifs massifs |
| Si on migre les unités vers un référentiel global | Moyenne | Conflit d'UUID |

---

## 5. PRODUITS À RISQUE — CLASSIFICATION

### 5.1 Magnifiko (166 produits affectés)

| Catégorie | Nombre | Exemples | Risque correction |
|-----------|--------|----------|-------------------|
| **VIVANT** (stock events > 0) | **114** | FARINE PIZZA, FIOR DI LATTE, Avocat, Crème liquide | 🟡 Prudence — vérifier que la correction ne change pas l'interprétation |
| **INACTIF** (0 stock events) | **52** | Produits importés mais jamais utilisés | ✅ Correction sûre |

### 5.2 Piccolo Magnifiko (148 produits affectés)

| Catégorie | Nombre | Risque correction |
|-----------|--------|-------------------|
| **VIVANT** | **48** | 🟡 Prudence |
| **INACTIF** | **100** | ✅ Correction sûre |

### 5.3 NONNA SECRET (26 produits — orphelins uniquement)

| Catégorie | Nombre | Risque correction |
|-----------|--------|-------------------|
| **VIVANT** | **20** | 🟡 Prudence — UUID orphelin (ml supprimé) |
| **INACTIF** | **6** | ✅ Correction sûre |

### 5.4 CL (2 produits)

| Catégorie | Nombre | Risque correction |
|-----------|--------|-------------------|
| **VIVANT** | **2** (TEST 1, TEST 3) | 🟡 Prudence |

### 5.5 Résumé

| | Total | Corrigeable sans risque | Prudence requise |
|-|------:|------------------------:|------------------:|
| **JSON config** | 342 | **158** (inactifs) | **184** (vivants) |
| **Stock events** | 306 | **0** | **306** |

---

## 6. RISQUES D'UNE CORRECTION BRUTE

### Pourquoi un remapping global direct est dangereux

1. **Stock events NONNA/FO** : Si on remappe les `canonical_unit_id` dans les stock_events, on risque de casser la cohérence entre `canonical_unit_id` et `canonical_label` (qui est dénormalisé). Un remapping partiel ou incorrect rendrait le ledger incohérent.

2. **Produits vivants avec inventaires** : Si un produit a eu 18 sessions d'inventaire avec l'ancien graphe BFS (même cassé), modifier le JSON pourrait changer la façon dont un futur inventaire interprète les données historiques.

3. **Mapping par abréviation** : Le remapping repose sur la correspondance `abbreviation` → local unit. Si deux unités partagent la même abréviation mais pas la même sémantique (ex: "Tranche" n'existe pas chez NONNA), le mapping serait faux.

4. **Atomicité** : Un remapping à moitié appliqué (crash mid-update) laisserait des produits dans un état hybride.

5. **Non-réversibilité** : Sans backup, un remapping incorrect ne peut pas être annulé.

---

## 7. STRATÉGIE ZÉRO RISQUE RECOMMANDÉE

### Phase 0 — Préparation (avant toute modification)

| Étape | Action | Validation |
|-------|--------|-----------|
| 0.1 | **Snapshot complet** : extraire tous les `conditionnement_config` des produits affectés dans un fichier JSON de backup | Le fichier contient exactement 342 entrées |
| 0.2 | **Table de mapping** : construire une table de correspondance `nonna_uuid → local_uuid` par établissement, validée manuellement | 100% des abréviations matchent (vérifié : ✅ Magnifiko 18/18, Piccolo 16/16, CL 3/3) |
| 0.3 | **Vérifier les unités manquantes** : identifier si des unités NONNA n'ont pas d'équivalent local | Aucune manquante (vérifié ✅) |
| 0.4 | **Documenter l'UUID orphelin** : `0d2550fd` = ancien Millilitre de NONNA → mapper vers le ml local de chaque établissement | Mapping clair |

### Phase 1 — Correction des produits INACTIFS (zéro stock events)

| Étape | Action | Volume | Risque |
|-------|--------|--------|--------|
| 1.1 | Corriger les 52 produits inactifs de **Magnifiko** | 52 | ✅ Nul |
| 1.2 | Corriger les 100 produits inactifs de **Piccolo** | 100 | ✅ Nul |
| 1.3 | Corriger les 6 produits inactifs de **NONNA** | 6 | ✅ Nul |
| 1.4 | **Validation** : pour chaque produit corrigé, vérifier que le BFS produit un graphe valide | Automatisable | |

### Phase 2 — Correction pilote des produits VIVANTS (petit lot)

| Étape | Action | Volume | Risque |
|-------|--------|--------|--------|
| 2.1 | Sélectionner **5 produits vivants** de Magnifiko avec peu de stock events (1-2) | 5 | 🟡 Faible |
| 2.2 | Corriger le JSON de ces 5 produits | 5 | |
| 2.3 | **Vérifier** : stock affiché identique avant/après, BFS produit les bonnes unités, popup retrait affiche kg/g/ml | Manuel | |
| 2.4 | Si OK → procéder à l'étape 3 | | |

### Phase 3 — Correction de tous les produits VIVANTS (JSON config uniquement)

| Étape | Action | Volume | Risque |
|-------|--------|--------|--------|
| 3.1 | Corriger les 114 produits vivants de **Magnifiko** | 114 | 🟡 Faible (validé par pilote) |
| 3.2 | Corriger les 48 produits vivants de **Piccolo** | 48 | 🟡 Faible |
| 3.3 | Corriger les 20 produits vivants de **NONNA** (orphelin ml) | 20 | 🟡 Faible |
| 3.4 | Corriger les 2 produits de **CL** | 2 | 🟡 Faible |
| 3.5 | **Validation complète** : BFS OK sur 100% des produits corrigés | Automatisable | |

### Phase 4 — Évaluation des stock_events (NE PAS CORRIGER IMMÉDIATEMENT)

| Étape | Action | Détail |
|-------|--------|--------|
| 4.1 | **Auditer** si les stock_events cross-tenant causent un problème réel | Les calculs sont numériquement corrects car l'UUID pointe vers une unité de même nom/abréviation |
| 4.2 | **Évaluer** si le code filtre déjà correctement | Vérifier les requêtes qui joignent `stock_events` avec `measurement_units` |
| 4.3 | **Décider** : correction ou tolérance | Si aucun bug constaté → tolérer et prévenir pour le futur |
| 4.4 | Si correction décidée : remapper avec la même table de correspondance | ⚠️ Après backup complet du ledger |

### Phase 5 — Prévention

| Étape | Action |
|-------|--------|
| 5.1 | **Corriger le pipeline d'import B2B** : ajouter un remapping des UUID dans `conditionnement_config` au moment de l'import |
| 5.2 | **Corriger le pipeline de création de stock_events** : vérifier que `canonical_unit_id` est toujours local |
| 5.3 | **Ajouter un trigger de validation** : empêcher l'insertion d'un stock_event avec un `canonical_unit_id` cross-tenant |
| 5.4 | **Ajouter un health-check** périodique : requête qui détecte les UUID cross-tenant |

---

## 8. PLAN PILOTE

### Critères de sélection du lot pilote

- Produit **vivant** (stock events > 0) mais avec **peu de mouvements** (≤ 3)
- Appartient à **Magnifiko** (le plus gros volume, donc le plus représentatif)
- A une équivalence en `kg` ou `g` (cas d'usage le plus demandé par l'utilisateur)

### Critères de validation

| # | Vérification | Méthode |
|---|-------------|---------|
| 1 | Le stock affiché ne change pas après correction | Comparer `Σ delta_quantity_canonical` avant/après |
| 2 | Le BFS produit un graphe valide | Appeler `resolveProductUnitContext()` et vérifier que kg/g apparaît |
| 3 | La popup de retrait affiche les nouvelles unités | Test manuel dans l'interface |
| 4 | Aucune erreur console | Vérifier la console navigateur |
| 5 | Le JSON corrigé est syntaxiquement valide | `JSON.parse()` OK |
| 6 | Tous les UUID du JSON corrigé appartiennent à l'établissement local | Requête de vérification |

### Produits pilotes suggérés (Magnifiko)

Sélectionner parmi : Sel fin (3 events), Sel gros (3 events), MENTHE (2 events), CAPRES (2 events) — produits simples avec peu de mouvements.

---

## 9. PRODUITS / CAS À CORRIGER MANUELLEMENT

### 9.1 Produits avec l'UUID orphelin `0d2550fd` (Millilitre supprimé)

**68 produits** sur 3 établissements. Le mapping est clair (ml → ml local) mais nécessite une attention particulière :
- Ce UUID n'existe **nulle part** dans `measurement_units` → il faut s'assurer que le ml local existe bien
- **Vérifié** : Magnifiko a `824ee66f` (ml), Piccolo a un ml local, NONNA a `dc97a0d9` (ml)
- **Décision** : correction automatique possible ✅

### 9.2 Unité "Tranche" (présente dans stock_events NONNA mais pas dans le mapping standard)

- 2 stock_events NONNA référencent "Tranche" de Magnifiko
- Vérifier si NONNA a une unité "Tranche" locale
- Si non → ces events doivent rester tels quels ou être traités manuellement

### 9.3 Stock events FO (94% cross-tenant)

- 80 events sur 85 utilisent des UUID de CL
- FO semble avoir été créé **à partir de** CL, ou les produits FO viennent de CL
- **Recommandation** : ne pas toucher pour l'instant, auditer séparément l'historique de création de FO

---

## 10. VERDICT FINAL

### La question posée :

> *Si l'application est déjà en production avec stock, inventaires et mouvements utilisés, comment corriger les UUID cross-tenant dans `conditionnement_config` sans aucun risque métier ?*

### La réponse :

**La correction du JSON `conditionnement_config` est SÛRE et peut être faite dès maintenant**, sous les conditions suivantes :

1. **Faire un backup** des 342 JSON avant toute modification
2. **Commencer par les 158 produits inactifs** (zéro risque)
3. **Puis un pilote de 5 produits vivants** avec validation manuelle
4. **Puis le reste des vivants** si le pilote est concluant
5. **Ne PAS toucher aux stock_events** dans un premier temps

**Pourquoi c'est sûr :**
- Le JSON `conditionnement_config` est de la **pure configuration** — il décrit comment construire le graphe de conversion, il ne stocke pas de données de stock
- Les mouvements de stock existants (stock_events) ne sont **pas lus via ce JSON** — ils utilisent leurs propres colonnes `canonical_unit_id` et `delta_quantity_canonical`
- Modifier le JSON ne change pas le solde de stock, ne modifie pas les inventaires passés, ne touche pas les mouvements existants
- Cela **ajoute** simplement la capacité de convertir entre unités (ex: afficher kg dans la popup de retrait)

**Ce qu'il faut traiter séparément :**
- Les 306 stock_events cross-tenant (NONNA + FO) → audit dédié, pas de correction immédiate
- Le pipeline d'import B2B → correction du code pour empêcher la récidive

### Ordre d'exécution recommandé :

```
1. Backup JSON                          → 5 min
2. Correction 158 produits inactifs     → 10 min (script)
3. Validation BFS sur les 158           → 2 min (script)
4. Pilote 5 produits vivants            → 15 min (script + test manuel)
5. Correction 184 produits vivants      → 10 min (script)
6. Validation BFS sur les 184           → 2 min (script)
7. Fix pipeline import B2B             → 30 min (code)
8. Audit stock_events (séparé)         → à planifier
```

---

*Audit complété le 2026-03-18. Aucune donnée modifiée. Aucun remapping exécuté.*
