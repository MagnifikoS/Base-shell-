# AUDIT — Unification Complète du Modal de Saisie

> Date: 2026-03-29
> Objectif: Un seul modal, un seul resolver, une seule source de vérité, zéro legacy.

---

## 1. CARTOGRAPHIE DES FLOWS ACTUELS

### 1.1 Réception Mobile ✅ DÉJÀ MIGRÉ

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `UniversalQuantityModal` (direct) |
| **Resolver** | `resolveInputUnitForContext(product, "reception", config, ...)` |
| **Source de vérité** | `product_input_config.reception_*` |
| **Fichier** | `src/modules/stockLedger/components/MobileReceptionView.tsx` (ligne 972) |
| **À remplacer** | ❌ Rien — déjà conforme |

### 1.2 Retrait Mobile ✅ DÉJÀ MIGRÉ

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `UniversalQuantityModal` (direct) |
| **Resolver** | `resolveInputUnitForContext(product, "internal", config, ...)` |
| **Source de vérité** | `product_input_config.internal_*` |
| **Fichier** | `src/modules/stockLedger/components/MobileWithdrawalView.tsx` (ligne 590) |
| **À remplacer** | ❌ Rien — déjà conforme |

### 1.3 Retrait Desktop ⚠️ LEGACY

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `QuantityModalWithResolver` |
| **Resolver** | `resolveFullModeConfig` (BFS brut, ignore config) |
| **Source de vérité** | BFS direct — PAS `product_input_config` |
| **Fichier** | `src/modules/stockLedger/components/WithdrawalView.tsx` (ligne 23) |
| **À remplacer** | ✅ Passer par `resolveInputUnitForContext("internal")` |

### 1.4 Commandes (3 dialogues) ⚠️ LEGACY

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `QuantityModalWithResolver` |
| **Resolver** | `resolveFullModeConfig` (BFS brut) |
| **Source de vérité** | BFS direct — PAS `product_input_config` |
| **Fichiers** | |
| | `src/modules/commandes/components/NouvelleCommandeDialog.tsx` (ligne 747) |
| | `src/modules/commandes/components/CommandeDetailDialog.tsx` (ligne ~848) |
| | `src/modules/commandes/components/PreparationDialog.tsx` (ligne 431) |
| | `src/pages/commandes/NouvelleCommandeCompositeDialog.tsx` (ligne 823) |
| **À remplacer** | ✅ Passer par `resolveInputUnitForContext("internal")` |

### 1.5 Corrections BL / Retrait ⚠️ LEGACY

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `QuantityModalWithResolver` |
| **Resolver** | `resolveFullModeConfig` (BFS brut) |
| **Fichiers** | |
| | `src/modules/blApp/components/BlAppCorrectionDialog.tsx` (ligne ~710) |
| | `src/modules/blRetrait/components/BlRetraitCorrectionDialog.tsx` (ligne ~486) |
| **À remplacer** | ✅ Passer par `resolveInputUnitForContext("internal")` |

### 1.6 Inventaire — Popup d'édition (Mobile + Desktop) ⚠️ LEGACY

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `QuantityModalWithResolver` |
| **Resolver** | `resolveFullModeConfig` (BFS brut) |
| **Fichiers** | |
| | `src/modules/inventaire/components/MobileInventoryView.tsx` (ligne 408) |
| | `src/modules/inventaire/components/InventoryProductDrawer.tsx` (ligne 816) |
| **À remplacer** | ✅ Passer par `resolveInputUnitForContext("internal")` |

### 1.7 Inventaire — CountingModal (comptage terrain) ⚠️ LOGIQUE PARALLÈLE

| Élément | Valeur actuelle |
|---------|----------------|
| **Composant** | `CountingModal` (composant dédié, PAS l'UQM) |
| **Resolver** | `resolveProductUnitContext` (BFS brut direct) |
| **Source de vérité** | BFS direct + `usePreferredUnits` (table `inventory_zone_products`) |
| **Fichiers** | |
| | `src/modules/inventaire/components/CountingModal.tsx` (452 lignes) |
| | `src/modules/inventaire/components/useCountingModal.ts` (508 lignes, ligne 136) |
| | `src/modules/inventaire/components/countingModalHelpers.ts` (205 lignes) |
| | `src/modules/inventaire/hooks/usePreferredUnits.ts` |
| **À remplacer** | ✅ Saisie → `resolveInputUnitForContext("internal")` ; workflow intact |

---

## 2. CIBLE FINALE

### 2.1 Architecture cible

```
┌──────────────────────────────────────────────────────────────┐
│                     TOUS LES FLOWS                          │
│                                                              │
│   Réception Mobile/Desktop                                   │
│   Retrait Mobile/Desktop                                     │
│   Inventaire (CountingModal + popup edit)                     │
│   Commandes (Nouvelle, Détail, Préparation, Composite)       │
│   Corrections (BL App, BL Retrait)                           │
│   Ajustement stock (InventoryProductDrawer)                   │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │         resolveInputUnitForContext()                  │   │
│   │                                                      │   │
│   │   context = "reception" → product_input_config.reception_*│
│   │   context = "internal"  → product_input_config.internal_* │
│   │                                                      │   │
│   │   status: ok / not_configured / needs_review          │   │
│   └──────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│   ┌──────────────────────▼───────────────────────────────┐   │
│   │         UniversalQuantityModal (UQM)                  │   │
│   │         Composant UI 100% passif                      │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │    convertToCanonical() / computeCanonicalFromEntries │   │
│   │         Moteur BFS — SSOT conversion                  │   │
│   └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Composant unique

**`QuantityModalWithResolver`** reste le wrapper standard. Il sera refondu pour :
1. Accepter un `contextType` qui détermine `"reception" | "internal"`
2. Appeler `resolveInputUnitForContext()` au lieu de `resolveFullModeConfig()`
3. Bloquer le modal si `status !== "ok"`

### 2.3 Resolver unique

**`resolveInputUnitForContext(product, context, config, dbUnits, dbConversions)`**

- `context = "reception"` → lit `reception_mode`, `reception_preferred_unit_id`, `reception_unit_chain`
- `context = "internal"` → lit `internal_mode`, `internal_preferred_unit_id`, `internal_unit_chain`
- Aucun autre chemin de résolution possible
- Si pas de config → `not_configured` → modal bloqué
- Si config invalide → `needs_review` → modal bloqué

### 2.4 Mapping contextType → InputContext

| `contextType` (UI) | `InputContext` (resolver) |
|---------------------|--------------------------|
| `"reception"` | `"reception"` |
| `"withdrawal"` | `"internal"` |
| `"inventory"` | `"internal"` |
| `"order"` | `"internal"` |
| `"correction"` | `"internal"` |
| `"adjustment"` | `"internal"` |

---

## 3. SOUS-PLAN INVENTAIRE

### 3.1 Ce qui reste IDENTIQUE (workflow)

- ✅ Sélection de zone (`ZoneSelector`)
- ✅ Affichage des produits de la zone
- ✅ Progression produit par produit (auto-advance)
- ✅ Navigation Suivant / Précédent / Passer
- ✅ Mode comptage + mode correction
- ✅ Clôture de zone / session
- ✅ Possibilité de revenir / corriger
- ✅ Structure session intacte (`inventory_sessions`, `inventory_lines`)
- ✅ `useCountingModal.ts` — toute la logique d'orchestration (navigation, auto-advance, save)

### 3.2 Ce qui CHANGE (saisie uniquement)

| Avant | Après |
|-------|-------|
| `resolveProductUnitContext()` (BFS brut) | `resolveInputUnitForContext("internal")` |
| `usePreferredUnits` (source parallèle) | Config lue depuis `product_input_config.internal_*` |
| Champs calculés par `buildOrderedFields` | Champs fournis par le resolver SSOT |
| `CountingModal` avec ses propres inputs | UQM en mode embarqué OU champs pilotés par resolver |

### 3.3 Où le nouveau resolver se branche

**Fichier** : `src/modules/inventaire/components/useCountingModal.ts`

**Ligne 127-137** — Remplacer :
```typescript
// AVANT (BFS brut)
const unitContext = useMemo(() => {
  const product: ProductUnitInput = { ... };
  return resolveProductUnitContext(product, dbUnits, dbConversions);
}, [currentLine, dbUnits, dbConversions]);
```

Par :
```typescript
// APRÈS (SSOT)
const resolved = useMemo(() => {
  if (!currentLine) return null;
  const config = inputConfigs.get(currentLine.product_id) ?? null;
  return resolveInputUnitForContext(
    currentLine as ProductForResolution,
    "internal",
    config,
    dbUnits,
    dbConversions
  );
}, [currentLine, inputConfigs, dbUnits, dbConversions]);
```

### 3.4 Garantie workflow intact

Le hook `useCountingModal` garde :
- `handleSave` / `handleSaveAndNext` / `handleSkip` — inchangés
- `currentLineId` / `setCurrentLineId` — navigation inchangée
- `isReviewing` — logique correction inchangée
- `onCount` / `onUpdate` callbacks — inchangés
- La seule chose qui change : la source des champs unité affichés

---

## 4. NETTOYAGE LEGACY — LISTE COMPLÈTE

### 4.1 Fichiers à SUPPRIMER

| Fichier | Raison |
|---------|--------|
| `src/modules/produitsV2/components/WithdrawalUnitConfigPopover.tsx` | Ghost config — écrit dans `withdrawal_*` que personne ne lit |
| `src/modules/inventaire/hooks/usePreferredUnits.ts` | Source parallèle remplacée par `product_input_config.internal_*` |
| `src/modules/stockLedger/components/ReceptionQuantityModal.tsx` | Re-export pur — tous les imports peuvent aller direct sur UQM |

### 4.2 Fichiers à REFONDRE

| Fichier | Action |
|---------|--------|
| `src/components/stock/QuantityModalWithResolver.tsx` | Remplacer `resolveFullModeConfig` par `resolveInputUnitForContext` |
| `src/components/stock/resolveFullModeFields.ts` | Supprimer `resolveFullModeConfig` (garder `computeCanonicalFromEntries` si encore utile) |

### 4.3 Champs SQL à PURGER des SELECT

| Fichier | Champs à retirer |
|---------|-----------------|
| `src/modules/stockLedger/components/MobileReceptionView.tsx` (lignes 191, 225) | `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step`, jointure `withdrawal_unit` |
| `src/modules/produitsV2/services/productsV2Service.ts` (ligne 58) | `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step`, jointure `withdrawal_unit` |

### 4.4 Types à NETTOYER

| Fichier / Type | Champs à retirer |
|----------------|-----------------|
| Type `SupplierProduct` (MobileReceptionView) | `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step`, `withdrawal_unit_name` |
| Type produit dans `productsV2Service.ts` | `withdrawal_unit_id`, `withdrawal_unit_name`, `withdrawal_steps`, `withdrawal_default_step` |

### 4.5 Composants legacy à débrancher

| Composant | Utilisé où | Action |
|-----------|-----------|--------|
| `WithdrawalUnitConfigPopover` | Table produits desktop | Retirer l'import et le rendu |
| `CountingModal` custom inputs | `MobileInventoryView` | Remplacer par UQM embarqué |

---

## 5. ORDRE D'IMPLÉMENTATION (safe, séquentiel)

### Phase 1 — Refonte de `QuantityModalWithResolver` (impact: 9 consumers)

**Risque** : Faible (le composant est un wrapper, la signature publique ne change pas)

1. Ajouter `useProductInputConfigs()` dans `QuantityModalWithResolver`
2. Mapper `contextType` → `InputContext` (`"reception"` ou `"internal"`)
3. Appeler `resolveInputUnitForContext()` au lieu de `resolveFullModeConfig()`
4. Si `status !== "ok"` → passer `needsConfig=true` + `diagnosticMessage` au UQM
5. Si `status === "ok"` → construire les `initialFields` depuis `resolved.fields`

**Consumers automatiquement migrés** (9 fichiers, aucune modif nécessaire) :
- `WithdrawalView.tsx` (desktop retrait)
- `NouvelleCommandeDialog.tsx`
- `NouvelleCommandeCompositeDialog.tsx`
- `CommandeDetailDialog.tsx`
- `PreparationDialog.tsx`
- `BlAppCorrectionDialog.tsx`
- `BlRetraitCorrectionDialog.tsx`
- `MobileInventoryView.tsx` (popup edit)
- `InventoryProductDrawer.tsx` (desktop inventory)

### Phase 2 — Migration du CountingModal inventaire

**Risque** : Moyen (le workflow terrain ne doit PAS casser)

1. Ajouter `useProductInputConfigs()` dans `useCountingModal.ts`
2. Remplacer `resolveProductUnitContext()` par `resolveInputUnitForContext("internal")`
3. Adapter `buildOrderedFields` pour accepter le format du resolver SSOT
4. Retirer `usePreferredUnits` de `MobileInventoryView.tsx`
5. Tester : comptage, correction, navigation, skip, clôture zone

### Phase 3 — Nettoyage final

**Risque** : Nul (code mort)

1. Supprimer `WithdrawalUnitConfigPopover.tsx`
2. Supprimer `usePreferredUnits.ts`
3. Supprimer `ReceptionQuantityModal.tsx` (re-export)
4. Purger `withdrawal_*` des SELECT SQL et types TS
5. Nettoyer `resolveFullModeFields.ts` (supprimer `resolveFullModeConfig`, garder `computeCanonicalFromEntries` si utilisé)

### Phase 4 — DB (optionnel, post-validation)

- Migration SQL : `ALTER TABLE products_v2 DROP COLUMN withdrawal_unit_id, withdrawal_steps, withdrawal_default_step;`
- Seulement après validation que zéro code ne les référence

---

## 6. RÉPONSE À LA QUESTION FINALE

> Une fois cette phase terminée, est-ce que tous les flows de saisie de l'app utiliseront bien le même modal, la même logique de résolution, la même source de vérité, sans aucune logique legacy résiduelle ?

### ✅ OUI — avec les fichiers suivants modifiés :

| # | Fichier | Modification |
|---|---------|-------------|
| 1 | `src/components/stock/QuantityModalWithResolver.tsx` | Utilise `resolveInputUnitForContext` + `useProductInputConfigs` |
| 2 | `src/modules/inventaire/components/useCountingModal.ts` | Utilise `resolveInputUnitForContext("internal")` |
| 3 | `src/modules/inventaire/components/MobileInventoryView.tsx` | Retire `usePreferredUnits` |
| 4 | `src/modules/stockLedger/components/MobileReceptionView.tsx` | Purge `withdrawal_*` des SELECT |
| 5 | `src/modules/produitsV2/services/productsV2Service.ts` | Purge `withdrawal_*` des SELECT |

| # | Fichier | Suppression |
|---|---------|------------|
| 6 | `src/modules/produitsV2/components/WithdrawalUnitConfigPopover.tsx` | Supprimé |
| 7 | `src/modules/inventaire/hooks/usePreferredUnits.ts` | Supprimé |
| 8 | `src/modules/stockLedger/components/ReceptionQuantityModal.tsx` | Supprimé |
| 9 | `src/components/stock/resolveFullModeFields.ts` | `resolveFullModeConfig` supprimé |

### Après cette phase :

- ✅ **1 seul modal** : `UniversalQuantityModal` (via `QuantityModalWithResolver` ou direct)
- ✅ **1 seul resolver** : `resolveInputUnitForContext`
- ✅ **1 seule source de vérité** : `product_input_config` (reception_* ou internal_*)
- ✅ **1 seul moteur de conversion** : BFS / `convertToCanonical`
- ✅ **0 logique legacy** : pas de `withdrawal_*`, pas de `resolveFullModeConfig`, pas de `usePreferredUnits`
- ✅ **0 divergence mobile/desktop** : même resolver, même modal partout
