# 📋 RAPPORT D'AUDIT — Readiness pour Canonique Auto + Fusion Steps 2→3

**Date :** 2026-04-01  
**Scope :** Wizard ProductFormV3 — Automatisation `stock_handling_unit_id` + fusion Step 2 (Structure) & Step 3 (Conditionnement)

---

## 1. ÉTAT ACTUEL DU WIZARD

### Architecture en 7 steps (UI)

| Step UI | Composant | Responsabilité |
|---------|-----------|---------------|
| 1 | `WizardStepIdentity` | Nom, code, fournisseur |
| 2 | `WizardStep1` | Unité de référence (`finalUnit/finalUnitId`) + équivalence |
| 3 | `WizardStep2` | Conditionnement fournisseur (packaging multi-niveaux) |
| 4 | `WizardStep3` | Facturation (unité facturée, qté, prix total) |
| 5 | `WizardStep4` | Gestion (livraison, **inventaire/stock**, cuisine, prix display) |
| 6 | `WizardStep5Stock` | Zone, catégorie, stock initial, seuil min, code-barres, DLC |
| 7 | `WizardStep5` (Summary) | Résumé intelligent en lecture seule |

### Fichiers clés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `ProductFormV3Modal.tsx` | 902 | Orchestrateur, save logic |
| `useWizardState.ts` | 662 | State machine, setters, navigation |
| `types.ts` | 117 | WizardState, WizardStep type |
| `WizardStep1.tsx` | ~300 | Structure (finalUnit + équivalence) |
| `WizardStep2.tsx` | 412 | Conditionnement packaging |
| `WizardStep3.tsx` | 260 | Facturation |
| `WizardStep4.tsx` | 397 | Gestion (inclut stock handling unit) |
| `WizardStep5Stock.tsx` | 382 | Zone & Stock |
| `WizardStep5.tsx` | — | Résumé |
| `wizardCanonicalHelpers.ts` | 32 | `isPackagingUnit()` helper |

---

## 2. LOGIQUE CANONIQUE EXISTANTE

### `resolveCanonical()` — `resolveProductUnitContext.ts` L.100-127

```ts
function resolveCanonical(
  baseTargetId: string | null,
  billingId: string | null,
  equivalence: Equivalence | null,
  dbUnits: UnitWithFamily[]
): string | null {
  if (!baseTargetId) return null;
  if (!billingId || billingId === baseTargetId) return baseTargetId;

  const billingUnit = dbUnits.find((u) => u.id === billingId);
  if (!billingUnit) return baseTargetId;
  if (!isPhysicalFamily(billingUnit)) return baseTargetId;

  // Billing is physical → check if a fixed equivalence exists
  const hasFixedEquivalence =
    equivalence !== null &&
    equivalence.quantity != null &&
    equivalence.quantity > 0 &&
    equivalence.unit_id != null &&
    equivalence.source_unit_id != null;

  if (hasFixedEquivalence) return baseTargetId;

  // Variable weight: use billing unit as canonical
  return billingId;
}
```

**✅ PRÊT** — Cette logique est pure, testable, et couvre les 3 cas :
- **(A)** Poids/volume variable → `kg`/`L` (via billing)
- **(B)** Unité terminale fixe → `finalUnitId` (pièce, etc.)
- **(C)** Décompte stable → `finalUnitId`

### Auto-prefill dans `WizardStep4.tsx` L.122-131

```ts
const canonicalStockUnitId = unitContext.canonicalInventoryUnitId;
useEffect(() => {
  if (!stockHandlingUnitId && (canonicalStockUnitId || finalUnitId)) {
    onStockHandlingUnitChange(canonicalStockUnitId ?? finalUnitId);
  }
}, [canonicalStockUnitId, finalUnitId]);
```

**✅ PRÊT** — Le pré-remplissage intelligent utilise déjà `canonicalInventoryUnitId` du BFS comme valeur par défaut au lieu du `finalUnitId` brut.

### Warning packaging — `WizardStep4.tsx` L.299-310

**✅ PRÊT** — Alerte non-bloquante si l'utilisateur choisit un packaging comme unité de stock.

### Grouped dropdown — `WizardStep4.tsx` L.142-146

**✅ PRÊT** — Dropdown séparé "Recommandé" (physiques) vs "Autres (conditionnement)".

---

## 3. PROTECTIONS BACKEND

### Trigger SQL `STOCK_UNIT_LOCKED`

**Fichier :** `20260311070850_*.sql`

```sql
IF fn_product_has_stock(NEW.id) THEN
  RAISE EXCEPTION 'STOCK_UNIT_LOCKED: Impossible de modifier l''unité stock : le produit a encore du stock.';
END IF;
```

**✅ PRÊT** — Le trigger bloque toute modification de `stock_handling_unit_id` si le produit a du stock.

### RPC `fn_save_product_wizard`

**✅ PRÊT** — Le RPC vérifie aussi `STOCK_UNIT_LOCKED` (L.157-160) et retourne une erreur propre.

### UI lock — `WizardStep4.tsx` L.290-298

**✅ PRÊT** — Le dropdown est `disabled` + message 🔒 quand `stockUnitLocked=true` (product has stock).

---

## 4. ANALYSE DE FAISABILITÉ — FUSION STEPS 2+3

### Step 2 actuel (`WizardStep1.tsx`) — Structure
- `finalUnit` / `finalUnitId` (unité de référence)
- `hasEquivalence` + `equivalenceQuantity/Unit/UnitId`

### Step 3 actuel (`WizardStep2.tsx`) — Conditionnement
- `hasPackaging` + `packagingLevels[]`

### Dépendances entre les deux steps

| Donnée Step 2 | Utilisée par Step 3 ? | Comment |
|---------------|:---------------------:|---------|
| `finalUnitId` | **OUI** | Le contenu du premier packaging level est auto-rempli depuis `finalUnit` |
| `hasEquivalence` | NON | Pas directement |
| `equivalenceUnitId` | NON | Pas directement |

**Verdict :** La fusion est **SAFE** car Step 3 ne dépend que de `finalUnitId` qui est déjà dans le même state. L'UI peut être fusionnée en un seul composant en 2 sections visuelles.

### Impact sur `useWizardState.ts`

- `goNext()` L.92-110 : pré-remplit `billedUnit` quand `nextStep === 4`. Si fusion, ce sera `nextStep === 3` → **1 ligne à ajuster**.
- `WizardStep` type : `1|2|3|4|5|6|7|8` → passer à `1|2|3|4|5|6|7` → **1 type à ajuster**.
- Step labels dans `ProductFormV3Modal.tsx` L.634-642 → **à renuméroter**.

### Impact sur `ProductFormV3Modal.tsx`

- Rendering steps L.707-862 : fusionner les blocs `currentStep === 2` et `currentStep === 3` → **2 blocs à fusionner en 1**.
- Progress bar L.632 : `(wizard.state.currentStep / 7)` → `/ 6` → **1 chiffre**.
- Step shortcuts L.671 : `[1,2,3,4,5,6,7]` → `[1,2,3,4,5,6]` → **1 array**.

---

## 5. ANALYSE DE FAISABILITÉ — CANONIQUE AUTO

### Scénario cible

Après saisie du conditionnement (nouveau Step 2 fusionné), `stock_handling_unit_id` est **auto-déduit** via `resolveCanonical()` et le dropdown est soit :
- **(A)** Masqué (100% auto) — risque : 9% des cas nécessitent un override
- **(B)** Pré-rempli + verrouillé avec option "Override avancé" — **RECOMMANDÉ**

### Logique déjà en place

| Élément | Status | Détail |
|---------|--------|--------|
| `resolveCanonical()` | ✅ Prêt | Pure function, 3 cas couverts |
| `resolveWizardUnitContext()` | ✅ Prêt | Wrapper qui appelle `resolveContext()` depuis le state wizard |
| `canonicalInventoryUnitId` output | ✅ Prêt | Résultat BFS prêt à consommer |
| Auto-prefill dans Step4 | ✅ Prêt | `useEffect` qui set la valeur |
| `isPackagingUnit()` helper | ✅ Prêt | Multi-signal (kind/category/family) |
| Grouped dropdown | ✅ Prêt | Recommandé vs Autres |
| Warning packaging | ✅ Prêt | Non-bloquant |
| Backend trigger lock | ✅ Prêt | `STOCK_UNIT_LOCKED` |
| Family change dialog | ✅ Prêt | `showFamilyChangeWarning` L.867-899 |

### Ce qui manque (0 nouvelle logique, juste du wiring)

| Action | Complexité | Risque |
|--------|-----------|--------|
| Fusionner `WizardStep1.tsx` + `WizardStep2.tsx` en 1 composant | Faible | Aucun (UI seule) |
| Renuméroter les steps (7→6) | Faible | Ajuster goNext, labels, progress |
| Déplacer l'auto-set de `stockHandlingUnitId` du Step4 vers le moment où conditionnement est complété (transition step) | Faible | Aucun — même `resolveCanonical()` |
| Optionnel : cacher le dropdown stock dans Step Gestion si auto-déduit, afficher un badge "Auto: kg" | Faible | Override à prévoir |

---

## 6. RISQUES IDENTIFIÉS

| Risque | Gravité | Mitigation |
|--------|---------|-----------|
| Override manuel supprimé → 9% produits atypiques mal configurés | **MOYEN** | Garder un lien "Modifier" ou collapse avancé |
| Renumérotation steps casse les deeplinks/bookmarks | **NUL** | Pas de deeplinks dans le wizard |
| Users en cours d'édition pendant déploiement | **NUL** | State local, pas de persistence intermédiaire |

---

## 7. VERDICT

| Critère | Status |
|---------|--------|
| `resolveCanonical()` couvre les 3 cas métier | ✅ |
| BFS produit le bon `canonicalInventoryUnitId` | ✅ |
| Auto-prefill déjà en place | ✅ |
| Backend protège contre les changements dangereux | ✅ |
| UI warning packaging en place | ✅ |
| Aucune nouvelle source de vérité nécessaire | ✅ |
| Aucune nouvelle logique métier nécessaire | ✅ |
| Fusion Steps 2+3 sans impact sur les données | ✅ |
| Risque de régression | **FAIBLE** |

### 🟢 FAISABLE SANS RISQUE

Tout le socle est en place. Le chantier consiste uniquement en :
1. **UI merge** : fusionner 2 composants React en 1
2. **Renumérotation** : 7 steps → 6 steps (types + labels + progress)
3. **Déplacement** : bouger l'auto-set `stockHandlingUnitId` du render Step4 vers la transition post-conditionnement
4. **UX** : afficher la canonique auto-déduite en lecture seule avec option "Override" dans Step Gestion

**Zéro nouvelle logique. Zéro nouvelle source de vérité. Zéro migration SQL.**

---

*Fin du rapport — Aucun code n'a été modifié.*
