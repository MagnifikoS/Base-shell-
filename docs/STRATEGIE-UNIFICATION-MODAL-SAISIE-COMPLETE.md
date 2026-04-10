# STRATÉGIE COMPLÈTE — Unification du Modal de Saisie

> **Date** : 2026-03-29  
> **Objectif** : Un seul modal, un seul resolver, une seule source de vérité, zéro legacy.  
> **Statut** : Plan d'implémentation verrouillé, prêt à exécuter.

---

## TABLE DES MATIÈRES

1. [Contexte et Principes Fondamentaux](#1-contexte-et-principes-fondamentaux)
2. [État Actuel — Cartographie Exhaustive des 12 Flows](#2-état-actuel--cartographie-exhaustive-des-12-flows)
3. [Architecture Cible](#3-architecture-cible)
4. [Analyse Technique Détaillée — Le Resolver SSOT](#4-analyse-technique-détaillée--le-resolver-ssot)
5. [Analyse Technique Détaillée — Le Wrapper `QuantityModal

their Resolver`](#5-analyse-technique-détaillée--le-wrapper-quantitymodalwithresolver)
6. [Analyse Technique Détaillée — CountingModal Inventaire](#6-analyse-technique-détaillée--countingmodal-inventaire)
7. [Sous-Plan Inventaire](#7-sous-plan-inventaire)
8. [Nettoyage Legacy — Inventaire Complet](#8-nettoyage-legacy--inventaire-complet)
9. [Plan d'Implémentation Séquentiel](#9-plan-dimplémentation-séquentiel)
10. [Matrice de Risques](#10-matrice-de-risques)
11. [Validation Finale](#11-validation-finale)

---

## 1. CONTEXTE ET PRINCIPES FONDAMENTAUX

### 1.1 Règle d'Or — Séparation Binaire des Contextes

Le système applique une séparation **binaire stricte** :

| Contexte | Source de vérité | Champs lus |
|----------|-----------------|------------|
| **Réception** (Mobile + Desktop) | `product_input_config.reception_*` | `reception_mode`, `reception_preferred_unit_id`, `reception_unit_chain` |
| **Tout le reste** | `product_input_config.internal_*` | `internal_mode`, `internal_preferred_unit_id`, `internal_unit_chain` |

**"Tout le reste"** inclut explicitement :
- Retrait (mobile + desktop)
- Inventaire (comptage terrain + popup d'édition + ajustement desktop)
- Commandes (nouvelle, détail, préparation, composite)
- Corrections (BL réception, BL retrait)
- Ajustement stock

### 1.2 Les 4 Piliers

| # | Pilier | Composant SSOT |
|---|--------|---------------|
| 1 | **Source de vérité saisie** | `product_input_config` (table DB) |
| 2 | **Resolver unique** | `resolveInputUnitForContext()` |
| 3 | **Modal unique** | `UniversalQuantityModal` (UQM) |
| 4 | **Moteur de conversion unique** | BFS / `convertToCanonical()` |

### 1.3 Politique de Blocage Strict

```
SI product_input_config existe ET est valide → status: "ok" → modal ouvert
SI product_input_config existe MAIS invalide → status: "needs_review" → modal BLOQUÉ
SI product_input_config absent → status: "not_configured" → modal BLOQUÉ
```

**Aucun fallback legacy ne permet jamais la saisie.**

### 1.4 Modes de Saisie Supportés

| Mode | Rendu UI | Famille d'unité |
|------|----------|----------------|
| `integer` | Stepper +/- (entiers seuls) | Discrète (pce, carton) |
| `fraction` | Stepper + jetons ¼, ½, ¾ | Discrète |
| `continuous` | Stepper +/- (décimaux) | Continue (kg, L) |
| `decimal` | Saisie libre pavé numérique | Continue |
| `multi_level` | Rangée par unité (mix stepper + libre) | Mixte |

---

## 2. ÉTAT ACTUEL — CARTOGRAPHIE EXHAUSTIVE DES 12 FLOWS

### 2.1 FLOWS DÉJÀ MIGRÉS ✅

#### Flow 1 — Réception Mobile
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/stockLedger/components/MobileReceptionView.tsx` |
| **Ligne** | ~960-975 |
| **Composant UI** | `UniversalQuantityModal` (direct, pas de wrapper) |
| **Resolver** | `resolveInputUnitForContext(product, "reception", config, ...)` |
| **Source config** | `useProductInputConfigs()` → `product_input_config.reception_*` |
| **Conversion** | `resolveInputConversion()` + `convertToCanonical()` |
| **Statut** | ✅ **CONFORME SSOT** |
| **Action** | Aucune (purger `withdrawal_*` des SELECT SQL uniquement) |

#### Flow 2 — Retrait Mobile
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/stockLedger/components/MobileWithdrawalView.tsx` |
| **Ligne** | ~585-600 |
| **Composant UI** | `UniversalQuantityModal` (direct) |
| **Resolver** | `resolveInputUnitForContext(product, "internal", config, ...)` |
| **Source config** | `useProductInputConfigs()` → `product_input_config.internal_*` |
| **Conversion** | `resolveInputConversion()` + `convertToCanonical()` |
| **Statut** | ✅ **CONFORME SSOT** |
| **Action** | Aucune |

---

### 2.2 FLOWS UTILISANT `QuantityModalWithResolver` ⚠️ LEGACY

Ces 9 flows utilisent tous le même wrapper `QuantityModalWithResolver`, qui appelle `resolveFullModeConfig()` (BFS brut, ignore `product_input_config`).

**Refondre le wrapper = migrer les 9 d'un coup.**

#### Flow 3 — Retrait Desktop
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/stockLedger/components/WithdrawalView.tsx` |
| **Ligne** | 23 (import), usage dans le JSX |
| **Import** | `QuantityModalWithResolver as ReceptionQuantityModal` |
| **contextType passé** | Aucun actuellement (le wrapper ignore) |
| **Action** | Aucune modif du consumer — le wrapper sera refondu |

#### Flow 4 — Nouvelle Commande
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/commandes/components/NouvelleCommandeDialog.tsx` |
| **Ligne** | 747 |
| **contextType passé** | `"order"` |
| **Action** | Aucune modif du consumer |

#### Flow 5 — Commande Composite
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/pages/commandes/NouvelleCommandeCompositeDialog.tsx` |
| **Ligne** | 823 |
| **contextType passé** | `"order"` |
| **Action** | Aucune modif du consumer |

#### Flow 6 — Détail Commande
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/commandes/components/CommandeDetailDialog.tsx` |
| **Ligne** | ~848 |
| **contextType passé** | `"order"` |
| **Action** | Aucune modif du consumer |

#### Flow 7 — Préparation Commande
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/commandes/components/PreparationDialog.tsx` |
| **Ligne** | 431 |
| **contextType passé** | `"order"` |
| **Action** | Aucune modif du consumer |

#### Flow 8 — Correction BL Réception
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/blApp/components/BlAppCorrectionDialog.tsx` |
| **Ligne** | ~710 |
| **contextType passé** | `"correction"` |
| **Action** | Aucune modif du consumer |

#### Flow 9 — Correction BL Retrait
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/blRetrait/components/BlRetraitCorrectionDialog.tsx` |
| **Ligne** | ~486 |
| **contextType passé** | `"correction"` |
| **Action** | Aucune modif du consumer |

#### Flow 10 — Popup Édition Inventaire Mobile
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/inventaire/components/MobileInventoryView.tsx` |
| **Ligne** | 408 |
| **contextType passé** | `"inventory"` |
| **Action** | Aucune modif du consumer |

#### Flow 11 — Ajustement Stock Desktop (InventoryProductDrawer)
| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/modules/inventaire/components/InventoryProductDrawer.tsx` |
| **Ligne** | 816 |
| **contextType passé** | `"adjustment"` |
| **Action** | Aucune modif du consumer |

---

### 2.3 FLOW AVEC LOGIQUE PARALLÈLE COMPLÈTE ⚠️⚠️

#### Flow 12 — CountingModal Inventaire (Comptage Terrain)
| Attribut | Valeur |
|----------|--------|
| **Fichiers** | 4 fichiers dédiés (voir ci-dessous) |
| **Composant UI** | `CountingModal` — composant dédié avec ses propres `<Input>` |
| **Resolver** | `resolveProductUnitContext()` (BFS brut direct, dans `useCountingModal.ts` ligne 136) |
| **Source unité préférée** | `usePreferredUnits()` → table `inventory_zone_products.preferred_unit_id` |
| **Ordonnancement champs** | `buildOrderedFields()` dans `countingModalHelpers.ts` |
| **Breakdown** | `computeBreakdownForFields()` dans `countingModalHelpers.ts` |
| **Conversion** | Calcul local dans `useCountingModal.ts` (lignes 228-240) |

**Fichiers impliqués :**
```
src/modules/inventaire/components/CountingModal.tsx          (452 lignes — JSX shell)
src/modules/inventaire/components/useCountingModal.ts        (508 lignes — logique orchestration + saisie)
src/modules/inventaire/components/countingModalHelpers.ts    (205 lignes — helpers purs)
src/modules/inventaire/hooks/usePreferredUnits.ts            (44 lignes — source parallèle)
```

**Problèmes identifiés :**
1. `resolveProductUnitContext()` ignore complètement `product_input_config`
2. `usePreferredUnits` est une source parallèle (table `inventory_zone_products`)
3. `buildOrderedFields` a sa propre logique de priorité (delivery > packaging > target)
4. Le mode de saisie n'est pas piloté par la config (toujours "full mode" libre)
5. Aucun blocage si pas de config → n'importe quelle unité BFS est utilisable

---

## 3. ARCHITECTURE CIBLE

### 3.1 Diagramme de Flux Unifié

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TOUS LES FLOWS (12/12)                         │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │  Réception   │  │   Retrait   │  │  Inventaire  │               │
│  │  (Mobile/    │  │  (Mobile/   │  │ (Comptage/   │               │
│  │   Desktop)   │  │   Desktop)  │  │  Edit/Ajust) │               │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│  ┌──────┴─────┐  ┌───────┴──────┐  ┌──────┴───────┐               │
│  │  Commandes │  │  Corrections │  │  Ajustement  │               │
│  │ (4 flows)  │  │  (2 flows)   │  │   Stock      │               │
│  └──────┬─────┘  └──────┬───────┘  └──────┬───────┘               │
│         │               │                  │                        │
│         └───────────┬────┴──────────────────┘                       │
│                     │                                               │
│    ┌────────────────▼─────────────────────┐                        │
│    │     useProductInputConfigs()          │                        │
│    │     → Map<productId, ConfigRow>       │                        │
│    └────────────────┬─────────────────────┘                        │
│                     │                                               │
│    ┌────────────────▼─────────────────────┐                        │
│    │   resolveInputUnitForContext()        │                        │
│    │                                       │                        │
│    │   Entrée:                              │                        │
│    │     product: ProductForResolution      │                        │
│    │     context: "reception" | "internal"  │                        │
│    │     config: ProductInputConfigRow      │                        │
│    │     dbUnits, dbConversions             │                        │
│    │                                       │                        │
│    │   Sortie (discriminated union):       │                        │
│    │     { status: "ok", mode, unitId, ... }│                       │
│    │     { status: "ok", mode: "multi_level", unitChain, ... }     │
│    │     { status: "not_configured", reason }│                      │
│    │     { status: "needs_review", reason }  │                      │
│    └────────────────┬─────────────────────┘                        │
│                     │                                               │
│    ┌────────────────▼─────────────────────┐                        │
│    │   UniversalQuantityModal (UQM)       │                        │
│    │   Composant UI 100% passif           │                        │
│    │                                       │                        │
│    │   Modes: stepper, fixed-unit,        │                        │
│    │          full, multi_level            │                        │
│    │                                       │                        │
│    │   Sortie: QuantityEntry[]            │                        │
│    │   (unitId + quantity bruts)           │                        │
│    └────────────────┬─────────────────────┘                        │
│                     │                                               │
│    ┌────────────────▼─────────────────────┐                        │
│    │   convertToCanonical()               │                        │
│    │   computeCanonicalFromEntries()      │                        │
│    │                                       │                        │
│    │   Moteur BFS → quantité canonique    │                        │
│    └──────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Table de Mapping contextType → InputContext

Le wrapper `QuantityModalWithResolver` accepte un `contextType` (UI sémantique) et le mappe vers un `InputContext` (résolution) :

```typescript
function mapContextToInput(contextType: QuantityContextType): InputContext {
  return contextType === "reception" ? "reception" : "internal";
}
```

| `contextType` (UI) | `InputContext` (resolver) | Champs lus |
|---------------------|--------------------------|------------|
| `"reception"` | `"reception"` | `reception_mode`, `reception_preferred_unit_id`, `reception_unit_chain` |
| `"withdrawal"` | `"internal"` | `internal_mode`, `internal_preferred_unit_id`, `internal_unit_chain` |
| `"inventory"` | `"internal"` | idem |
| `"order"` | `"internal"` | idem |
| `"correction"` | `"internal"` | idem |
| `"adjustment"` | `"internal"` | idem |

---

## 4. ANALYSE TECHNIQUE DÉTAILLÉE — LE RESOLVER SSOT

### 4.1 Fichier Source

`src/modules/inputConfig/utils/resolveInputUnitForContext.ts` (313 lignes)

### 4.2 Signature

```typescript
function resolveInputUnitForContext(
  product: ProductForResolution,
  context: InputContext,          // "reception" | "internal"
  config: ProductInputConfigRow | null,
  dbUnits: UnitWithFamily[],
  dbConversions: ConversionRule[],
): InputResolutionResult
```

### 4.3 Algorithme

```
1. Exécuter le moteur BFS → obtenir reachableUnits + canonicalUnitId
2. Si config === null → return { status: "not_configured" }
3. Lire mode + unit_id + unit_chain selon le context
4. Si mode === "multi_level" :
   a. Valider unit_chain (≥2 unités, pas de doublons, toutes BFS-reachable)
   b. Si invalide → return { status: "needs_review" }
   c. Si valide → return { status: "ok", mode: "multi_level", unitChain, unitNames, unitFamilies }
5. Si mode ou unit_id manquant → return { status: "not_configured" }
6. Valider unit_id contre BFS reachability
   a. Si non atteignable → return { status: "needs_review" }
7. Return { status: "ok", mode, unitId, unitName, steps, defaultStep }
```

### 4.4 Sortie (Discriminated Union)

```typescript
// Mode simple (integer, fraction, continuous, decimal)
{ status: "ok", mode, unitId, unitName, steps, defaultStep, canonicalUnitId, source: "config", reachableUnits }

// Mode multi-niveaux
{ status: "ok", mode: "multi_level", unitChain, unitNames, unitFamilies, canonicalUnitId, source: "config", reachableUnits }

// Pas de config
{ status: "not_configured", reason: string }

// Config invalide
{ status: "needs_review", reason: string }
```

### 4.5 Ce que le Resolver NE fait JAMAIS

- ❌ Lire `withdrawal_unit_id` / `withdrawal_steps` / `withdrawal_default_step`
- ❌ Lire `delivery_unit_id` comme source de saisie
- ❌ Lire `stock_handling_unit_id` comme fallback de saisie
- ❌ Fournir un fallback silencieux si pas de config
- ❌ Calculer des conversions (délégué au moteur BFS en amont)

---

## 5. ANALYSE TECHNIQUE DÉTAILLÉE — LE WRAPPER `QuantityModalWithResolver`

### 5.1 Fichier Source

`src/components/stock/QuantityModalWithResolver.tsx` (128 lignes)

### 5.2 État Actuel (LEGACY)

```typescript
// ACTUELLEMENT (à remplacer) :
import { resolveFullModeConfig, computeCanonicalFromEntries } from "./resolveFullModeFields";

const config = useMemo(() => {
  return resolveFullModeConfig(product, dbUnits, dbConversions, existingQuantity);
}, [product, dbUnits, dbConversions, existingQuantity]);
```

**Problème** : `resolveFullModeConfig` appelle directement `resolveProductUnitContext()` (BFS brut) sans consulter `product_input_config`. Il expose TOUTES les unités BFS-reachable au lieu de celles configurées par l'utilisateur.

### 5.3 Cible (SSOT)

```typescript
// APRÈS REFONTE :
import { useProductInputConfigs, resolveInputUnitForContext } from "@/modules/inputConfig";
import type { InputContext } from "@/modules/inputConfig";

const inputConfigs = useProductInputConfigs();

const inputContext: InputContext = contextType === "reception" ? "reception" : "internal";
const config = inputConfigs.get(product.id) ?? null;

const resolved = useMemo(() => {
  return resolveInputUnitForContext(product, inputContext, config, dbUnits, dbConversions);
}, [product, inputContext, config, dbUnits, dbConversions]);
```

### 5.4 Impact sur les Consumers

**AUCUNE modification nécessaire** dans les 9 consumers. Le wrapper garde la même interface publique :

```typescript
<QuantityModalWithResolver
  open={open}
  onClose={onClose}
  product={product}
  dbUnits={dbUnits}
  dbConversions={dbConversions}
  onConfirm={handleConfirm}
  existingQuantity={qty}
  contextType="order"        // ← déjà passé par tous les consumers
  contextLabel="Commande"
/>
```

Le `contextType` est DÉJÀ passé par chaque consumer (vérifié dans le code) :
- `WithdrawalView` → implicite (defaulte à `"reception"`, à ajuster)
- `NouvelleCommandeDialog` → `"order"`
- `NouvelleCommandeCompositeDialog` → `"order"`
- `CommandeDetailDialog` → `"order"`
- `PreparationDialog` → `"order"`
- `BlAppCorrectionDialog` → `"correction"`
- `BlRetraitCorrectionDialog` → `"correction"`
- `MobileInventoryView` (popup edit) → `"inventory"`
- `InventoryProductDrawer` → `"adjustment"`

**Note** : `WithdrawalView.tsx` n'envoie pas de `contextType` explicitement, donc il utilise le default `"reception"`. Ce default doit être changé en `"withdrawal"` OU le consumer doit ajouter `contextType="withdrawal"`.

### 5.5 Gestion du Blocage

Quand `resolved.status !== "ok"`, le wrapper passe au UQM :
```typescript
needsConfig={true}
diagnosticMessage={resolved.reason}
```
Le UQM affiche alors un écran bloqué avec le message d'erreur, sans champs de saisie.

---

## 6. ANALYSE TECHNIQUE DÉTAILLÉE — CountingModal Inventaire

### 6.1 Architecture Actuelle

```
MobileInventoryView
  └── CountingModal
        └── useCountingModal
              ├── resolveProductUnitContext() ← BFS brut
              ├── usePreferredUnits() ← source parallèle (inventory_zone_products)
              └── buildOrderedFields() ← logique d'ordonnancement locale
                    └── computeBreakdownForFields() ← calcul local
```

### 6.2 Logique de Résolution Actuelle (`useCountingModal.ts` lignes 127-143)

```typescript
// BFS BRUT — ignore product_input_config
const unitContext = useMemo(() => {
  const product: ProductUnitInput = {
    stock_handling_unit_id: currentLine.product_stock_handling_unit_id,
    final_unit_id: currentLine.product_final_unit_id,
    delivery_unit_id: currentLine.product_delivery_unit_id,
    supplier_billing_unit_id: currentLine.product_supplier_billing_unit_id,
    conditionnement_config: currentLine.product_conditionnement_config,
  };
  return resolveProductUnitContext(product, dbUnits, dbConversions);
}, [currentLine, dbUnits, dbConversions]);

const targetUnitId = unitContext?.canonicalInventoryUnitId ?? null;
const allOptions = unitContext?.allowedInventoryEntryUnits ?? []; // TOUTES les unités BFS
```

**Problème critique** : Expose toutes les unités BFS au lieu de celles configurées. Le `preferredUnits` map tente de corriger l'ordonnancement mais ne restreint pas les unités.

### 6.3 Logique d'Ordonnancement Actuelle (`countingModalHelpers.ts` lignes 83-157)

```
buildOrderedFields(allOptions, preferredUnitId, ...) :
  1. preferred_unit_id (de inventory_zone_products) → en premier
  2. delivery unit → en second
  3. packaging units (par facteur décroissant) → ensuite
  4. canonical (target) → ensuite
  5. remaining → à la fin
  → Tronquer à MAX_VISIBLE_FIELDS (3)
```

**Problème** : L'ordonnancement utilise `usePreferredUnits` (source parallèle) et ne respecte pas la configuration utilisateur.

### 6.4 Architecture Cible

```
MobileInventoryView
  └── CountingModal
        └── useCountingModal
              ├── useProductInputConfigs() ← SSOT
              ├── resolveInputUnitForContext("internal") ← resolver unique
              └── Champs construits depuis resolved.fields
                    └── Conversion via moteur BFS standard
```

### 6.5 Ce Qui Change vs. Ce Qui Ne Change Pas

**INCHANGÉ (workflow d'orchestration)** :
- `currentLineId` / `setCurrentLineId` — navigation par lineId
- `findNextUncountedLineId` / `findFirstUncountedLineId` — auto-advance
- `handlePrev` / `handleNext` / `handleSkip` — navigation
- `handleConfirm` / `executeConfirm` — sauvegarde
- `onCount` / `onUpdate` callbacks — mutations DB
- `isReviewing` — mode relecture
- `isSaving` — état de sauvegarde
- `progress` / `countedCount` — progression
- Mode `comptage` vs `correction` — logique intacte
- `computedTotal` — calcul canonique (reste Σ qty × factor)

**CHANGÉ (résolution des unités)** :
- `resolveProductUnitContext()` → `resolveInputUnitForContext("internal")`
- `usePreferredUnits` → supprimé, lu depuis `product_input_config.internal_*`
- `buildOrderedFields()` → adapté pour le format du resolver SSOT
- `allOptions` → restreint aux unités de la config (pas tout le BFS)

---

## 7. SOUS-PLAN INVENTAIRE

### 7.1 Invariants du Workflow (NE PAS TOUCHER)

| # | Invariant | Vérifié |
|---|-----------|---------|
| 1 | `counted_at != null` = "compté" partout | ✅ Inchangé |
| 2 | Mode COMPTAGE auto-advance vers les non-comptés | ✅ Inchangé |
| 3 | Navigation par `lineId` + `display_order`, jamais par index | ✅ Inchangé |
| 4 | Toute mutation = `.eq("id", lineId)` | ✅ Inchangé |
| 5 | `qty=0` est VALIDE (stock vide) | ✅ Inchangé |
| 6 | Sélection de zone → produits de la zone → saisie | ✅ Inchangé |
| 7 | Skip / Retour / Correction / Re-comptage | ✅ Inchangé |
| 8 | Clôture de zone / session | ✅ Inchangé |

### 7.2 Point de Branchement Précis

**Fichier** : `src/modules/inventaire/components/useCountingModal.ts`

**Lignes 125-143** — Remplacement du resolver :

```typescript
// ══ AVANT ══
const unitContext = useMemo(() => {
  if (!currentLine) return null;
  const product: ProductUnitInput = {
    stock_handling_unit_id: currentLine.product_stock_handling_unit_id,
    final_unit_id: currentLine.product_final_unit_id,
    delivery_unit_id: currentLine.product_delivery_unit_id,
    supplier_billing_unit_id: currentLine.product_supplier_billing_unit_id,
    conditionnement_config: currentLine.product_conditionnement_config,
  };
  return resolveProductUnitContext(product, dbUnits, dbConversions);
}, [currentLine, dbUnits, dbConversions]);

const targetUnitId = unitContext?.canonicalInventoryUnitId ?? null;
const allOptions = useMemo(
  () => unitContext?.allowedInventoryEntryUnits ?? [],
  [unitContext?.allowedInventoryEntryUnits]
);
```

```typescript
// ══ APRÈS ══
const resolved = useMemo(() => {
  if (!currentLine) return null;
  const product: ProductForResolution = {
    id: currentLine.product_id,
    nom_produit: currentLine.product_name ?? "",
    final_unit_id: currentLine.product_final_unit_id,
    stock_handling_unit_id: currentLine.product_stock_handling_unit_id,
    delivery_unit_id: currentLine.product_delivery_unit_id,
    supplier_billing_unit_id: currentLine.product_supplier_billing_unit_id,
    conditionnement_config: currentLine.product_conditionnement_config,
  };
  const cfg = inputConfigs.get(currentLine.product_id) ?? null;
  return resolveInputUnitForContext(product, "internal", cfg, dbUnits, dbConversions);
}, [currentLine, inputConfigs, dbUnits, dbConversions]);

// Extraire targetUnitId et allOptions depuis resolved
const targetUnitId = resolved?.status === "ok" ? resolved.canonicalUnitId : null;
const allOptions = useMemo(
  () => resolved?.status === "ok" ? resolved.reachableUnits : [],
  [resolved]
);
```

### 7.3 Gestion du Cas "Produit Non Configuré"

Quand `resolved?.status !== "ok"` pour un produit dans la zone :
- Le champ de saisie est désactivé
- Un message d'avertissement s'affiche
- Le bouton Skip reste fonctionnel pour passer au suivant
- Le produit n'est PAS compté

### 7.4 Interface du Hook — Changement Minimal

```typescript
// AJOUT au UseCountingModalParams :
interface UseCountingModalParams {
  // ... existant inchangé ...
  preferredUnits?: Map<string, string>;  // → SUPPRIMÉ
  inputConfigs: Map<string, ProductInputConfigRow>;  // → AJOUTÉ
}
```

Le `preferredUnits` prop est retiré de `CountingModal` et de `MobileInventoryView`.

---

## 8. NETTOYAGE LEGACY — INVENTAIRE COMPLET

### 8.1 Fichiers à SUPPRIMER

| # | Fichier | Lignes | Raison |
|---|---------|--------|--------|
| 1 | `src/modules/produitsV2/components/WithdrawalUnitConfigPopover.tsx` | ~150 | Ghost config — écrit dans `withdrawal_*` que rien ne lit au runtime |
| 2 | `src/modules/inventaire/hooks/usePreferredUnits.ts` | 44 | Source parallèle → remplacée par `product_input_config.internal_*` |
| 3 | `src/modules/stockLedger/components/ReceptionQuantityModal.tsx` | 20 | Re-export pur → imports directs suffisants |

### 8.2 Fonctions à SUPPRIMER

| # | Fonction | Fichier | Raison |
|---|----------|---------|--------|
| 1 | `resolveFullModeConfig()` | `src/components/stock/resolveFullModeFields.ts` | Remplacé par `resolveInputUnitForContext` |

**Note** : `computeCanonicalFromEntries()` dans le même fichier est CONSERVÉ — c'est une agrégation pure utilisée par le wrapper.

### 8.3 Champs SQL à PURGER

| # | Fichier | Lignes | Champs à retirer de la requête SELECT |
|---|---------|--------|--------------------------------------|
| 1 | `MobileReceptionView.tsx` | 191, 225 | `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step`, jointure `withdrawal_unit:measurement_units!products_v2_withdrawal_unit_id_fkey(id, name)` |
| 2 | `productsV2Service.ts` | 58-60, 77-80, 123-126 | Mêmes champs + mapping |

### 8.4 Types TypeScript à NETTOYER

| # | Type/Interface | Fichier | Champs à retirer |
|---|----------------|---------|-----------------|
| 1 | `SupplierProduct` (interface locale) | `MobileReceptionView.tsx` L86-91 | `withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step`, `withdrawal_unit_name` |
| 2 | Objet retourné par `productsV2Service` | `productsV2Service.ts` L121-126 | `withdrawal_unit_id`, `withdrawal_unit_name`, `withdrawal_steps`, `withdrawal_default_step` |
| 3 | `ProductForResolution` | `resolveInputUnitForContext.ts` L46-48 | `withdrawal_steps`, `withdrawal_default_step` (commentaires legacy) |

### 8.5 Composants à DÉBRANCHER

| # | Composant | Utilisé où | Action |
|---|-----------|-----------|--------|
| 1 | `WithdrawalUnitConfigPopover` | Table produits desktop (`ProduitsV2Page` ou équivalent) | Retirer l'import et le rendu dans le parent |
| 2 | `preferredUnits` prop | `CountingModal` et `MobileInventoryView` | Retirer la prop et l'appel `usePreferredUnits()` |

### 8.6 Imports à METTRE À JOUR

| # | Fichier | Import actuel | Import cible |
|---|---------|--------------|-------------|
| 1 | `WithdrawalView.tsx` L23 | `QuantityModalWithResolver as ReceptionQuantityModal` | `QuantityModalWithResolver` (même fichier, renommage alias optionnel) |
| 2 | Tout fichier important `ReceptionQuantityModal.tsx` | Via `./ReceptionQuantityModal` | Direct `@/components/stock/UniversalQuantityModal` |

### 8.7 Migration DB (Phase 4 — post-validation)

```sql
-- À exécuter SEULEMENT quand 0 référence dans le code
ALTER TABLE products_v2
  DROP COLUMN IF EXISTS withdrawal_unit_id,
  DROP COLUMN IF EXISTS withdrawal_steps,
  DROP COLUMN IF EXISTS withdrawal_default_step;
```

---

## 9. PLAN D'IMPLÉMENTATION SÉQUENTIEL

### Phase 1 — Refonte de `QuantityModalWithResolver` (1 fichier → 9 flows migrés)

**Risque** : ⬜ Faible — Le wrapper est un adaptateur, la signature publique ne change pas  
**Durée estimée** : 1 session

**Étapes détaillées :**

1. **Ajouter `useProductInputConfigs()`** dans le wrapper
2. **Ajouter le mapping** `contextType → InputContext`
3. **Remplacer `resolveFullModeConfig()`** par `resolveInputUnitForContext()`
4. **Construire les `initialFields`** depuis le `resolved` :
   - Si `status === "ok"` et mode simple → 1 field (unitId, unitName)
   - Si `status === "ok"` et mode `multi_level` → N fields (unitChain)
   - Si `status !== "ok"` → `needsConfig=true`, `diagnosticMessage=resolved.reason`
5. **Vérifier** : `WithdrawalView.tsx` ne passe pas de `contextType` → ajouter default `"withdrawal"` dans le wrapper OU ajouter `contextType="withdrawal"` dans le consumer
6. **Garder `computeCanonicalFromEntries()`** pour la conversion retour
7. **Test** : Ouvrir le modal dans chaque flow, vérifier saisie + blocage

**Fichiers modifiés :**
- `src/components/stock/QuantityModalWithResolver.tsx` (refonte)
- `src/components/stock/resolveFullModeFields.ts` (supprimer `resolveFullModeConfig`)

### Phase 2 — Migration CountingModal Inventaire (3 fichiers)

**Risque** : 🟡 Moyen — Le workflow terrain est critique  
**Durée estimée** : 1-2 sessions

**Étapes détaillées :**

1. **Ajouter `inputConfigs` prop** à `UseCountingModalParams` (remplace `preferredUnits`)
2. **Remplacer le resolver** dans `useCountingModal.ts` (lignes 127-143)
3. **Adapter `buildOrderedFields`** ou le remplacer :
   - Mode simple → 1 champ visible (+ overflow si besoin)
   - Mode `multi_level` → N champs selon `unitChain`
   - Mode non configuré → 0 champs, message d'erreur
4. **Propager** dans `CountingModal.tsx` :
   - Retirer `preferredUnits` prop
   - Ajouter `inputConfigs` prop
5. **Propager** dans `MobileInventoryView.tsx` :
   - Retirer `usePreferredUnits()`
   - Ajouter `useProductInputConfigs()`
   - Passer `inputConfigs` au lieu de `preferredUnits`
6. **Gestion produit non configuré** : Afficher un avertissement, permettre Skip
7. **Test complet** :
   - Sélection zone → comptage produit par produit
   - Navigation Suivant / Précédent / Passer
   - Correction d'un produit déjà compté
   - Clôture zone
   - Re-comptage

**Fichiers modifiés :**
- `src/modules/inventaire/components/useCountingModal.ts`
- `src/modules/inventaire/components/CountingModal.tsx`
- `src/modules/inventaire/components/MobileInventoryView.tsx`

### Phase 3 — Nettoyage Legacy

**Risque** : ⬜ Nul — Code mort uniquement  
**Durée estimée** : 1 session

**Étapes détaillées :**

1. **Supprimer** `WithdrawalUnitConfigPopover.tsx` + retirer son import/rendu du parent
2. **Supprimer** `usePreferredUnits.ts`
3. **Supprimer** `ReceptionQuantityModal.tsx` + mettre à jour les imports (si encore utilisé)
4. **Purger `withdrawal_*`** des SELECT SQL :
   - `MobileReceptionView.tsx` (2 requêtes)
   - `productsV2Service.ts` (1 requête)
5. **Nettoyer les types** TS (retirer `withdrawal_*` des interfaces locales)
6. **Nettoyer `resolveFullModeFields.ts`** : garder uniquement `computeCanonicalFromEntries`, supprimer tout le reste
7. **Nettoyer `ProductForResolution`** : retirer les champs `withdrawal_steps`, `withdrawal_default_step`
8. **Vérification finale** : `grep -r "withdrawal_unit\|withdrawal_steps\|withdrawal_default_step\|resolveFullModeConfig\|usePreferredUnits" src/`

**Fichiers supprimés :**
- `src/modules/produitsV2/components/WithdrawalUnitConfigPopover.tsx`
- `src/modules/inventaire/hooks/usePreferredUnits.ts`
- `src/modules/stockLedger/components/ReceptionQuantityModal.tsx`

**Fichiers modifiés :**
- `src/modules/stockLedger/components/MobileReceptionView.tsx` (purge SQL)
- `src/modules/produitsV2/services/productsV2Service.ts` (purge SQL)
- `src/components/stock/resolveFullModeFields.ts` (suppression de `resolveFullModeConfig`)
- `src/modules/inputConfig/utils/resolveInputUnitForContext.ts` (nettoyage type)

### Phase 4 — Migration DB (optionnel)

**Risque** : ⬜ Nul (si Phase 3 validée)  
**Prérequis** : Zéro référence au code

```sql
ALTER TABLE products_v2
  DROP COLUMN IF EXISTS withdrawal_unit_id,
  DROP COLUMN IF EXISTS withdrawal_steps,
  DROP COLUMN IF EXISTS withdrawal_default_step;
```

---

## 10. MATRICE DE RISQUES

| Phase | Risque | Impact si erreur | Mitigation |
|-------|--------|-----------------|------------|
| Phase 1 | Faible | Saisie bloquée si config manquante → produits non configurés ne peuvent plus saisir | C'est le comportement VOULU (blocage strict) |
| Phase 1 | Faible | `WithdrawalView` manque de `contextType` → default incorrect | Vérifier et ajouter `contextType="withdrawal"` |
| Phase 2 | Moyen | Workflow inventaire cassé → impossibilité de compter en terrain | Tests exhaustifs sur tous les modes (comptage, correction, skip, clôture) |
| Phase 2 | Moyen | Produit sans config → champs vides au lieu de blocage | Ajouter gestion explicite dans le CountingModal |
| Phase 3 | Nul | Code mort supprimé → aucun impact runtime | Grep final avant suppression |
| Phase 4 | Nul | Colonnes DB supprimées → aucun code ne les lit plus | Exécuter seulement après grep = 0 résultat |

---

## 11. VALIDATION FINALE

### 11.1 Question Finale

> Une fois cette phase terminée, est-ce que tous les flows de saisie de l'app utiliseront bien le même modal, la même logique de résolution, la même source de vérité, sans aucune logique legacy résiduelle ?

### ✅ OUI — Confirmé avec preuves

| Critère | Avant (12 flows) | Après |
|---------|-------------------|-------|
| **Modals différents** | 3 (UQM direct, QuantityModalWithResolver, CountingModal) | **1** (UQM, via wrapper ou direct) |
| **Resolvers différents** | 3 (`resolveInputUnitForContext`, `resolveFullModeConfig`, `resolveProductUnitContext`) | **1** (`resolveInputUnitForContext`) |
| **Sources de vérité** | 3 (`product_input_config`, BFS brut, `inventory_zone_products`) | **1** (`product_input_config`) |
| **Logiques legacy actives** | `withdrawal_*` dans SQL, `usePreferredUnits`, `WithdrawalUnitConfigPopover` | **0** |
| **Divergence mobile/desktop** | Oui (mobile = SSOT, desktop = BFS brut) | **Non** |

### 11.2 Fichiers Impactés — Résumé Final

**Phase 1 (2 fichiers modifiés, 9 flows migrés) :**
| Fichier | Action |
|---------|--------|
| `src/components/stock/QuantityModalWithResolver.tsx` | Refonte : `resolveFullModeConfig` → `resolveInputUnitForContext` |
| `src/components/stock/resolveFullModeFields.ts` | Suppression de `resolveFullModeConfig`, conservation de `computeCanonicalFromEntries` |

**Phase 2 (3 fichiers modifiés, 1 flow migré) :**
| Fichier | Action |
|---------|--------|
| `src/modules/inventaire/components/useCountingModal.ts` | `resolveProductUnitContext` → `resolveInputUnitForContext("internal")` |
| `src/modules/inventaire/components/CountingModal.tsx` | Retirer `preferredUnits`, ajouter `inputConfigs` |
| `src/modules/inventaire/components/MobileInventoryView.tsx` | `usePreferredUnits` → `useProductInputConfigs` |

**Phase 3 (3 fichiers supprimés, 4 fichiers nettoyés) :**
| Fichier | Action |
|---------|--------|
| `WithdrawalUnitConfigPopover.tsx` | **SUPPRIMÉ** |
| `usePreferredUnits.ts` | **SUPPRIMÉ** |
| `ReceptionQuantityModal.tsx` | **SUPPRIMÉ** |
| `MobileReceptionView.tsx` | Purge `withdrawal_*` des SELECT SQL |
| `productsV2Service.ts` | Purge `withdrawal_*` des SELECT SQL |
| `resolveFullModeFields.ts` | Nettoyage résiduel |
| `resolveInputUnitForContext.ts` | Nettoyage type `ProductForResolution` |

---

> **Ce document est la référence unique pour l'implémentation. Aucune décision n'est laissée à l'interprétation.**
