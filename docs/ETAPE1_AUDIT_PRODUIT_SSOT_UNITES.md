# ÉTAPE 1 — AUDIT : Produit = Source Unique de Vérité pour les Unités

> Date : 2026-03-28  
> Scope : Code audit complet — structure d'unités dans le système

---

## 1. AUDIT — OÙ LES UNITÉS SONT DÉFINIES AUJOURD'HUI

### 1.1 Source Principale ✅ (SSOT actuel)

| Source | Localisation | Rôle |
|--------|-------------|------|
| `products_v2.conditionnement_config` | JSONB sur la table produit | Structure complète : finalUnit, packagingLevels, equivalence, priceLevel |
| `products_v2.stock_handling_unit_id` | FK → measurement_units | Unité canonique du stock (verrouillée si historique > 0) |
| `products_v2.final_unit_id` | FK → measurement_units | Unité de base (pièce, kg, etc.) |
| `products_v2.delivery_unit_id` | FK → measurement_units | Unité de livraison fournisseur |
| `products_v2.supplier_billing_unit_id` | FK → measurement_units | Unité de facturation fournisseur |

**Verdict :** La structure d'unités EST déjà centralisée sur le produit via `conditionnement_config` + les colonnes FK. Le moteur BFS (`findConversionPath`) lit cette config pour construire le graphe de conversion.

### 1.2 Sources Parasites ⚠️ (À éliminer)

| Source Parasite | Localisation | Problème |
|----------------|-------------|----------|
| **`products_v2.withdrawal_unit_id`** | Colonne legacy sur products_v2 | Duplique la logique d'unité de retrait — devrait être dans `product_input_configs` |
| **`products_v2.withdrawal_steps`** | JSONB legacy sur products_v2 | Steps de retrait stockés sur le produit au lieu d'`inputConfig` |
| **`products_v2.withdrawal_default_step`** | Colonne legacy sur products_v2 | Idem — step par défaut |
| **`conversionEngine.ts`** | `src/core/unitConversion/conversionEngine.ts` | Code mort — ancien moteur linéaire remplacé par BFS (`findConversionPath`) |
| **`conversions.ts`** | `src/modules/conditionnementV2/conversions.ts` | Stubs deprecated retournant `null` — code mort |
| **Deep imports** | 3 fichiers dans stockLedger | Importent depuis `conditionnementV2/conversionGraph` et `conditionnementV2/types` au lieu du barrel `index.ts` |

### 1.3 Cartographie des Usages

| Module | Utilise `conditionnement_config` ? | Utilise `resolveProductUnitContext` ? | Utilise legacy withdrawal_* ? |
|--------|:--:|:--:|:--:|
| Commandes | ✅ | ✅ | ❌ |
| Expédition | ✅ | ✅ | ❌ |
| Réception | ✅ | ✅ | ❌ |
| Inventaire | ✅ | ✅ | ❌ |
| **Retrait (Mobile)** | ✅ | ⚠️ partiel | **✅ ← PROBLÈME** |
| **Retrait (Desktop)** | ✅ | ✅ | ❌ |
| BL App | ✅ | ✅ | ❌ |
| Vision AI / Wizard | ✅ | ✅ | ❌ |
| Input Config | ✅ | ✅ | ❌ |
| Prix / Factures | ✅ | ✅ | ❌ |

---

## 2. DÉFINITION DE LA SOURCE UNIQUE

### 2.1 Architecture Cible (DÉJÀ EN PLACE à 90%)

```
┌──────────────────────────────────────┐
│          products_v2                  │
│                                      │
│  conditionnement_config (JSONB)      │  ← Structure d'unités
│  ├── finalUnit                       │
│  ├── packagingLevels[]               │    (Carton → Boîte → Pièce)
│  ├── equivalence                     │    (Poids ↔ Pièce)
│  └── priceLevel                      │
│                                      │
│  stock_handling_unit_id (FK)         │  ← Unité canonique stock
│  final_unit_id (FK)                  │  ← Unité de base
│  delivery_unit_id (FK)              │  ← Unité livraison
│  supplier_billing_unit_id (FK)      │  ← Unité facturation
└──────────────┬───────────────────────┘
               │
               ▼
  resolveProductUnitContext()          ← Resolver unique (construit le graphe)
               │
               ▼
  findConversionPath() (BFS)           ← Moteur de conversion unique
               │
       ┌───────┼───────┐
       ▼       ▼       ▼
   Commande  Stock   Prix             ← Tous les flows lisent, jamais ne modifient
```

### 2.2 Ce Qui Manque

Le seul trou : **MobileWithdrawalView.tsx** lit `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step` directement sur `products_v2` au lieu de passer par `resolveProductUnitContext` + `inputConfig`.

---

## 3. PLAN DE MIGRATION

### Phase 1 — Nettoyage du Code Mort (30 min, 0 risque)

| Action | Fichier | Détail |
|--------|---------|--------|
| **SUPPRIMER** | `src/core/unitConversion/conversionEngine.ts` | Code mort — jamais importé directement |
| **SUPPRIMER export** | `src/core/unitConversion/index.ts` ligne 12 | Retirer les re-exports de conversionEngine |
| **SUPPRIMER** | `src/modules/conditionnementV2/conversions.ts` | Stubs deprecated retournant null |
| **FIXER imports** | `SimpleQuantityPopup.tsx` | `conditionnementV2/conversionGraph` → `@/modules/conditionnementV2` |
| **FIXER imports** | `WithdrawalQuantityPopup.tsx` | Idem |
| **FIXER imports** | `useWithdrawalHistory.ts` | Idem |
| **FIXER imports types** | `SimpleQuantityPopup.tsx` | `conditionnementV2/types` → `@/modules/conditionnementV2` |
| **FIXER imports types** | `WithdrawalQuantityPopup.tsx` | Idem |

### Phase 2 — Migration Retrait vers InputConfig (2h, risque faible)

| # | Action | Détail |
|---|--------|--------|
| 1 | Ajouter contexte `withdrawal` à `product_input_configs` | Si pas encore fait |
| 2 | Modifier `MobileWithdrawalView.tsx` | Remplacer lecture de `withdrawal_unit_id/steps/default_step` par `resolveProductUnitContext` |
| 3 | Fallback temporaire | Si pas d'inputConfig → lire les anciennes colonnes (backward compat) |
| 4 | Migrer `WithdrawalUnitConfigPopover.tsx` | Écrire vers `product_input_configs` au lieu de `products_v2` |
| 5 | Tester retrait mobile + desktop | Vérifier cohérence |

### Phase 3 — Verrouillage (Post-MVP)

| Action | Détail |
|--------|--------|
| Supprimer colonnes `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step` de `products_v2` | Migration SQL DROP COLUMN |
| Supprimer `WithdrawalUnitConfigPopover.tsx` | Remplacé par le dialogue inputConfig |

---

## 4. NETTOYAGE

### À Supprimer

| Fichier/Code | Raison |
|-------------|--------|
| `src/core/unitConversion/conversionEngine.ts` | Remplacé par BFS (`findConversionPath`) |
| `src/modules/conditionnementV2/conversions.ts` | Stubs vides — aucun appelant |
| Exports de `conversionEngine` dans `src/core/unitConversion/index.ts` | Code mort exposé |

### À Déplacer

| Donnée | De | Vers |
|--------|-----|------|
| Configuration de retrait (unité, steps) | `products_v2.withdrawal_*` | `product_input_configs` (contexte `withdrawal`) |

### À Interdire

| Règle | Enforcement |
|-------|------------|
| Aucun module ne définit d'unité | Seul le Wizard produit écrit `conditionnement_config` |
| Aucun deep import dans conditionnementV2 | Tout passe par `@/modules/conditionnementV2` (barrel) |
| Aucune conversion hardcodée | Tout passe par `findConversionPath` |

---

## 5. RISQUES

### Tableau des Risques

| # | Risque | Probabilité | Impact | Mitigation |
|---|--------|:-----------:|:------:|------------|
| R1 | Suppression de `conversionEngine.ts` casse un import caché | **Très faible** | Moyen | Vérifié : 0 import direct. Seul `index.ts` le ré-exporte, et aucun consommateur externe n'utilise ces fonctions directement |
| R2 | Fix des deep imports cause erreur de build | **Très faible** | Faible | Les exports existent déjà dans le barrel `index.ts` |
| R3 | Migration retrait mobile casse le flow | **Faible** | **Élevé** | Fallback temporaire vers les anciennes colonnes pendant la transition |
| R4 | Produits sans `conditionnement_config` | **Faible** | Moyen | `resolveProductUnitContext` gère déjà ce cas (fallback vers `stock_handling_unit_id`) |
| R5 | `b2b_imported_products.unit_mapping` diverge | **Nul** | — | C'est une translation inter-tenant, pas une définition d'unité — conforme à l'architecture |

### Flows Sensibles

| Flow | Risque Phase 1 | Risque Phase 2 |
|------|:-:|:-:|
| Commande | ❌ Aucun | ❌ Aucun |
| Expédition | ❌ Aucun | ❌ Aucun |
| Réception | ❌ Aucun | ❌ Aucun |
| Inventaire | ❌ Aucun | ❌ Aucun |
| **Retrait Mobile** | ❌ Aucun | ⚠️ **Fallback requis** |
| Retrait Desktop | ❌ Aucun | ❌ Aucun |

---

## 6. VALIDATION — Critères de Succès

### Critères Concrets

| # | Critère | Méthode de Vérification |
|---|---------|------------------------|
| V1 | `conversionEngine.ts` supprimé | `grep -r "conversionEngine" src/` → 0 résultat |
| V2 | `conversions.ts` supprimé | `grep -r "conditionnementV2/conversions" src/` → 0 résultat |
| V3 | 0 deep imports dans conditionnementV2 | `grep -r "conditionnementV2/" src/ \| grep -v "conditionnementV2\"" \| grep -v index` → 0 |
| V4 | Build passe | `npm run build` → 0 erreur |
| V5 | Tests passent | `npm run test` → 0 régression |
| V6 | Retrait mobile fonctionne | Test manuel : retirer un produit avec conditionnement multi-niveaux |

### Signaux de Réussite

- ✅ Un seul chemin pour résoudre les unités d'un produit : `resolveProductUnitContext()`
- ✅ Un seul moteur de conversion : `findConversionPath()` (BFS)
- ✅ Aucun code mort de conversion dans le repo
- ✅ Tous les imports passent par les barrels (`index.ts`)
- ✅ Le produit (`products_v2.conditionnement_config`) est la seule source de vérité structurelle

---

## RÉSUMÉ EXÉCUTIF

| Aspect | État Actuel | Après Phase 1 |
|--------|:-----------:|:-------------:|
| SSOT produit | 90% ✅ | **100% ✅** |
| Code mort conversion | 2 fichiers ⚠️ | **0 ✅** |
| Deep imports | 3 fichiers ⚠️ | **0 ✅** |
| Retrait mobile | Legacy columns ⚠️ | Fallback → Migration Phase 2 |
| Risque de régression | — | **Quasi nul** (Phase 1) |

**Conclusion :** Le système est déjà à 90% SSOT. La Phase 1 est un nettoyage de code mort et de deep imports — **zéro risque métier, 30 minutes de travail**. La Phase 2 (migration retrait) est le seul changement fonctionnel et nécessite un fallback.
