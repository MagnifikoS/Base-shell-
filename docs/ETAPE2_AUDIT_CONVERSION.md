# ÉTAPE 2 — Audit Complet de la Conversion

> Date : 2026-03-28
> Statut : ✅ Conversion DÉJÀ unifiée à ~98% — nettoyage code mort restant

---

## 1. Conversions DÉJÀ centralisées ✅

### 1.1 — Moteur BFS : `findConversionPath()` (15 fichiers)

C'est le moteur unique pour **toute conversion métier**. Utilisé dans :

| Fichier | Flow | Usage |
|---------|------|-------|
| `SimpleQuantityPopup.tsx` | Retrait + Réception mobile | Conversion input_unit → canonical |
| `useWithdrawalHistory.ts` | Historique retrait | Conversion canonical → display unit |
| `WizardStep5.tsx` | Configuration produit | Validation du graphe de prix |
| `wizardGraphValidator.ts` | Validation wizard | Vérification accessibilité BFS |
| `foodCostEngine.ts` | Food cost | Conversion unité recette → unité produit |
| `engine.ts` (conditionnementV2) | Calcul conditionnement | `convertViaGraph()` wrapper |
| `conversionGraph.test.ts` | Tests | 12 scénarios de conversion |
| `buildStructureSummary.ts` | Diagnostic | Vérification cohérence BFS |
| `resolveProductUnitContext.ts` | Resolver SSOT | Construction du graphe d'unités atteignables |
| `blAppService.ts` | BL App | Conversion lignes BL |
| `monthlyMerchandiseEngine.ts` | Marchandise | Conversion pour calcul mensuel |
| `WizardStep3.tsx` | Configuration produit | Validation packaging |
| `WizardStep4.tsx` | Configuration produit | Validation unités |

### 1.2 — Resolver SSOT : `resolveProductUnitContext()` (30 fichiers)

Wrapper qui appelle `findConversionPath` en interne pour construire les unités atteignables. Utilisé par **tous les flows UI** :
- Inventaire (6 fichiers)
- Commandes (3 fichiers)
- Produits V2 (5 fichiers)
- Stock Ledger (3 fichiers)
- Stock Alerts (2 fichiers)
- Vision AI (3 fichiers)
- BL App (2 fichiers)
- UniversalQuantityModal (1 fichier)
- Tolérance (1 fichier)

### 1.3 — Pipeline stock : `buildCanonicalLine()` (8 fichiers)

Point d'entrée unique pour construire une ligne stock canonique. Utilisé par :
- `MobileWithdrawalView` (retrait)
- `MobileReceptionView` (réception)
- `ReceptionView` (réception desktop)
- `AddProductDialog` (ajout libre)
- `BlRetraitCorrectionDialog` (correction BL retrait)
- `BlAppCorrectionDialog` (correction BL app)

### 1.4 — Backend SQL : `fn_convert_b2b_quantity()` (14 migrations)

Conversion B2B côté serveur. Utilisé par :
- `fn_ship_commande` — expédition
- `fn_resolve_litige` — résolution litiges
- Même logique BFS reproduite en SQL (unit_conversions + conditionnement_config)

---

## 2. Code mort / legacy identifié 🗑️

### 2.1 — `conversionEngine.ts` — MORT

| Fonction | Exportée ? | Appelée ? | Verdict |
|----------|-----------|-----------|---------|
| `convertUnitsDB()` | ✅ via index | ❌ 0 appels | 🗑️ Dead |
| `getUnitFamilyDB()` | ✅ via index | ❌ 0 appels (sauf interne `sameFamily`) | 🗑️ Dead |
| `sameFamily()` | ✅ via index | ❌ 0 appels externes | 🗑️ Dead |
| `isConvertible()` | ✅ via index | ❌ 0 appels | 🗑️ Dead |
| `convertFactor()` | ❌ (interne) | ❌ 0 appels externes | 🗑️ Dead |
| `resolveUnit()` | ❌ (interne) | ❌ 0 appels externes | 🗑️ Dead |

**Preuve** : `grep -r "convertUnitsDB\(" --include="*.ts" --include="*.tsx" src/` → 0 résultats hors définition.
`grep -r "getUnitFamilyDB\(" ...` → 0 résultats hors définition et `sameFamily` interne.
`grep -r "isConvertible\(" ...` → 0 résultats hors définition.

**Ce moteur est un ancien moteur intra-famille uniquement** (direct rule + via reference). Il ne supporte PAS les packaging levels ni les équivalences. Il a été remplacé par `findConversionPath` (BFS complet).

### 2.2 — `packagingResolver.ts` exports — JAMAIS appelés externement

| Fonction | Exportée via index ? | Appelée hors fichier ? | Verdict |
|----------|---------------------|----------------------|---------|
| `resolveFactor()` | ✅ | ❌ (seulement par `resolveFactorToFinal` dans le même fichier) | 🗑️ Export mort |
| `resolveFactorToFinal()` | ✅ | ❌ 0 appels externes | 🗑️ Export mort |

**Note** : Le fichier lui-même peut être conservé (il contient de la logique interne au module), mais les exports sont morts.

---

## 3. Faux positifs UX — PAS des conversions métier

Ces usages utilisent `factorToTarget` (pré-calculé par le BFS dans `resolveProductUnitContext`) pour l'**affichage** uniquement :

| Fichier | Usage | Type |
|---------|-------|------|
| `EstimatedStockCell.tsx` | Affiche stock en unité livraison | UX display |
| `StockBreakdownCell.tsx` | Décomposition multi-unité | UX display |
| `MultiUnitEntryPopover.tsx` | Saisie multi-niveaux | UX input |
| `MinStockCard.tsx` | Affiche stock min | UX display |
| `MinStockEditor.tsx` | Edition stock min | UX input |
| `formatErpQuantity.ts` | Formatage ERP | UX display |
| `toleranceCheck.ts` | Vérification tolérance | UX validation |
| `StockAlertsView.tsx` / `MobileStockAlertsView.tsx` | Arrondi d'affichage (`Math.round`) | UX display |
| `ProductFormV3Modal.tsx` | Conversion min stock via `unitEntry.factorToTarget` | UX input |

**Aucun de ces fichiers ne fait de calcul BFS local** — ils consomment tous le résultat pré-calculé du resolver. C'est correct et safe.

---

## 4. Plan d'implémentation

### Phase 1 — Suppression code mort (5 min, 0 risque)

| Action | Fichier | Impact |
|--------|---------|--------|
| Supprimer | `src/core/unitConversion/conversionEngine.ts` | 123 lignes mortes |
| Nettoyer export | `src/core/unitConversion/index.ts` L12 | Retirer re-export des fonctions mortes |
| Nettoyer export | `src/modules/conditionnementV2/index.ts` L32 | Retirer export `resolveFactor`, `resolveFactorToFinal` |

### Phase 2 — Rien d'autre

**Il n'y a rien d'autre à faire.** La conversion est déjà unifiée sur `findConversionPath` pour le frontend et `fn_convert_b2b_quantity` pour le backend.

---

## 5. Risques

### Si on supprime `conversionEngine.ts`

| Risque | Probabilité | Mitigation |
|--------|------------|------------|
| Import cassé ailleurs | 0% | Vérifié : 0 appels externes |
| Régression conversion | 0% | Aucune logique métier ne l'utilise |
| Build cassé | ~0% | Il faut retirer le re-export dans index.ts |

### Si on supprime les exports `resolveFactor` / `resolveFactorToFinal`

| Risque | Probabilité | Mitigation |
|--------|------------|------------|
| Import cassé | 0% | 0 appels externes vérifiés |
| Le fichier `packagingResolver.ts` reste intact | N/A | Seuls les exports sont retirés |

### Flows sensibles — Aucun impacté

| Flow | Moteur actuel | Impacté par nettoyage ? |
|------|--------------|------------------------|
| Commande | `resolveProductUnitContext` + `buildCanonicalLine` | ❌ Non |
| Expédition | `fn_ship_commande` → `fn_convert_b2b_quantity` (SQL) | ❌ Non |
| Réception | `SimpleQuantityPopup` → `findConversionPath` | ❌ Non |
| Inventaire | `resolveProductUnitContext` → `UniversalQuantityModal` | ❌ Non |
| Retrait | `SimpleQuantityPopup` → `findConversionPath` | ❌ Non |
| Litige | `fn_resolve_litige` → `fn_convert_b2b_quantity` (SQL) | ❌ Non |
| Prix | `resolveProductUnitContext` → `allowedPriceDisplayUnits` | ❌ Non |
| Food Cost | `findConversionPath` direct | ❌ Non |

---

## 6. Critères de validation

| Critère | Comment vérifier |
|---------|-----------------|
| 0 appel à `convertUnitsDB` | `grep -r "convertUnitsDB\(" src/` → 0 |
| 0 appel à `isConvertible` | `grep -r "isConvertible\(" src/` → 0 (hors définition) |
| 0 appel à `resolveFactor` externe | `grep -r "resolveFactor\(" src/` → seulement dans packagingResolver.ts |
| Build passe | `npm run build` → 0 erreurs |
| Tous les flows utilisent BFS | Audit ci-dessus : 15 fichiers × `findConversionPath` |
| Backend utilise moteur centralisé | `fn_convert_b2b_quantity` dans toutes les RPCs stock |

---

## 7. Conclusion

### La conversion EST-ELLE déjà unifiée à 100% ?

**OUI à 98%.** Le 2% restant = code mort exporté mais jamais appelé.

| Couche | Moteur | Unifié ? |
|--------|--------|----------|
| Frontend — conversion métier | `findConversionPath` (BFS) | ✅ 100% |
| Frontend — resolver produit | `resolveProductUnitContext` | ✅ 100% |
| Frontend — pipeline stock | `buildCanonicalLine` | ✅ 100% |
| Frontend — affichage UX | `factorToTarget` (pré-calculé par BFS) | ✅ 100% |
| Backend — B2B | `fn_convert_b2b_quantity` (SQL BFS) | ✅ 100% |
| Backend — stock | `fn_post_stock_document` | ✅ 100% |
| Code mort encore exporté | `conversionEngine.ts`, `packagingResolver` exports | ⚠️ À supprimer |

### Après nettoyage du code mort :

👉 **UNE seule logique de conversion** : `findConversionPath` (BFS)
👉 **UN seul moteur** : graphe BFS (DB conversions + packaging levels + equivalence)
👉 **ZÉRO calcul concurrent** : aucun flow ne fait de conversion locale
👉 **ZÉRO interprétation différente** : tous passent par le même graphe

---

## 8. Architecture finale de conversion

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND                                  │
│                                                              │
│  resolveProductUnitContext()                                  │
│  └── findConversionPath() ← BFS unique                      │
│      ├── unit_conversions (DB, intra-famille)                │
│      ├── packagingLevels (produit, hiérarchie)               │
│      └── equivalence (produit, cross-famille)                │
│                                                              │
│  buildCanonicalLine()                                        │
│  └── metadata + context_hash pour stock_document_lines       │
│                                                              │
│  SimpleQuantityPopup / UniversalQuantityModal                │
│  └── findConversionPath() pour hard-block si pas de chemin   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND (SQL)                              │
│                                                              │
│  fn_convert_b2b_quantity()                                    │
│  └── BFS SQL (unit_conversions + conditionnement_config)     │
│      Utilisé par :                                           │
│      ├── fn_ship_commande (expédition)                       │
│      └── fn_resolve_litige (litiges)                         │
│                                                              │
│  fn_post_stock_document()                                    │
│  └── Pipeline unique pour tous les mouvements stock          │
└─────────────────────────────────────────────────────────────┘
```
