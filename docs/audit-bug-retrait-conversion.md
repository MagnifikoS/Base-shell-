# AUDIT BUG RETRAIT CONVERSION

> **Date** : 2026-03-15
> **Périmètre** : Module Retrait — conversion unité retrait → quantité canonique
> **Statut** : Bug confirmé — **CRITIQUE (P0)**

---

## 1. Résumé exécutif

### Bug confirmé : OUI — Gravité CRITIQUE

**Le bug** : Quand un salarié retire "1 sac" d'un produit dont l'unité canonique est "kg", le système écrit `-1 kg` dans le ledger au lieu de `-25 kg`.

**Point d'origine** : `WithdrawalQuantityPopup.tsx`, lignes 130-132 — un **fallback silencieux** qui traite la quantité brute comme canonique quand la conversion échoue.

**Cause racine** : Le moteur de conversion DB (`convertUnitsDB`) ne supporte que les conversions **intra-famille** (kg↔g, L↔mL). Or l'unité retrait (sac, bidon, carton) est typiquement dans une famille différente (packaging/conditionnement) de l'unité canonique (masse, volume). Le moteur retourne `null`, et le fallback passe la quantité brute.

**Impact terrain** : Chaque retrait utilisant une unité retrait différente de l'unité canonique corrompt silencieusement le stock. Le stock affiché diverge de la réalité physique sans aucune alerte.

---

## 2. Cartographie du flow réel

```
Utilisateur tape "Farine"
    ↓
MobileWithdrawalView.tsx (L.734)
    → Résout withdrawal_unit_id = "sac" (depuis products_v2.withdrawal_unit_id)
    → Résout canonical_unit_id = stock_handling_unit_id = "kg"
    → Crée objet WithdrawalProduct {withdrawal_unit_id: "sac", canonical_unit_id: "kg"}
    ↓
WithdrawalQuantityPopup.tsx
    → Affiche stepper en "sac"
    → Utilisateur sélectionne quantité = 1
    → handleConfirm() appelé
    ↓
WithdrawalQuantityPopup.tsx L.119-136 — CONVERSION
    → withdrawal_unit_id ("sac") !== canonical_unit_id ("kg") → branche conversion
    → Appelle convertUnitsDB(1, "sac", "kg", dbUnits, dbConversions)
    ↓
conversionEngine.ts — convertFactor()
    → Cherche règle directe sac→kg dans unit_conversions → NON TROUVÉE
    → Cherche via référence (même famille) → sac.family ≠ kg.family → IMPOSSIBLE
    → Retourne NULL
    ↓
WithdrawalQuantityPopup.tsx L.130-132 — ⚠️ FALLBACK SILENCIEUX
    → converted === null → canonicalQty = quantity (= 1)
    → ❌ 1 sac devient 1 kg au lieu de 25 kg
    ↓
onConfirm({canonicalQuantity: 1, canonicalUnitId: "kg"})
    ↓
MobileWithdrawalView.tsx — handleDirectWithdrawal()
    → buildCanonicalLine() avec canonicalUnitId = "kg"
    → insert stock_document_lines: delta_quantity_canonical = -1
    → POST → fn_post_stock_document
    → stock_events: delta_quantity_canonical = -1
    → Stock affiché: 149 - 1 = 148 kg (au lieu de 149 - 25 = 124 kg)
```

---

## 3. Audit unité retrait

### Comment withdrawal_unit_id est lu

**Fichier** : `MobileWithdrawalView.tsx`, ligne 734

```typescript
const wUnitId = modalProduct.withdrawal_unit_id 
  ?? modalProduct.stock_handling_unit_id 
  ?? modalProduct.final_unit_id;
```

**Fallback** : Si `withdrawal_unit_id` est null → utilise `stock_handling_unit_id` → `final_unit_id`.

**Verdict** : La lecture est correcte. Le `withdrawal_unit_id` est bien récupéré depuis `products_v2` (requête L.157-158 avec jointure `measurement_units!products_v2_withdrawal_unit_id_fkey`). Le produit "Farine" a bien `withdrawal_unit_id` = UUID du sac.

### Comment withdrawal_unit_name est résolu

**Fichier** : `MobileWithdrawalView.tsx`, lignes 735-737

```typescript
const wUnitName = modalProduct.withdrawal_unit_name
  ?? dbUnits.find((u) => u.id === wUnitId)?.name
  ?? "unité";
```

**Verdict** : Correct. Le nom "Sac" est bien affiché dans le popup.

### Incohérence identifiée

**L'unité retrait est correctement lue et affichée**, mais elle n'est **pas correctement convertie**. L'utilisateur voit "Retrait en Sac" mais le système traite sa saisie comme s'il avait saisi en kg.

---

## 4. Audit conversion

### Moteur réellement utilisé

Le flow retrait utilise bien le moteur standard `convertUnitsDB()` depuis `@/core/unitConversion/conversionEngine`.

**Aucun chemin parallèle n'a été créé.** C'est le moteur standard qui est appelé.

### Pourquoi le moteur échoue

Le moteur `convertFactor()` (conversionEngine.ts L.73-109) a **deux stratégies** :

1. **Règle directe** : cherche dans `unit_conversions` une entrée `from_unit_id=sac, to_unit_id=kg` → **N'existe probablement pas** car la table `unit_conversions` contient des conversions intra-famille (g↔kg, mL↔L), pas des conversions packaging↔masse.

2. **Via référence (même famille)** : L.92 vérifie `fromUnit.family === toUnit.family` → "Sac" est dans famille "conditionnement" ou "packaging", "kg" est dans famille "masse" → **familles différentes → court-circuit immédiat**.

```typescript
// conversionEngine.ts L.92
if (fromUnit.family && fromUnit.family === toUnit.family) {
  // Ce bloc n'est JAMAIS atteint pour sac→kg
}
```

**Résultat** : `convertFactor()` retourne `null`. C'est **le comportement attendu du moteur** — il ne sait pas convertir entre familles.

### La vraie conversion devrait venir du conditionnement

La relation "1 sac = 25 kg" est définie dans `products_v2.conditionnement_config` (structure JSON avec `levels` et `equivalence`), PAS dans la table `unit_conversions`.

Le moteur de conversion DB n'a **jamais été conçu** pour les conversions produit-spécifiques (conditionnement). Il gère les conversions universelles (1 kg = 1000 g).

### Le module conditionement/resolveProductUnitContext

Il existe un module `resolveProductUnitContext` exporté depuis `@/core/unitConversion/index.ts` qui sait résoudre les conversions produit-spécifiques en utilisant le `conditionnement_config`. **Ce module n'est PAS utilisé par le popup retrait.**

---

## 5. Audit écriture canonique

### Ce qui est écrit dans stock_document_lines

**Fichier** : `MobileWithdrawalView.tsx`, L.305-319

```typescript
const { error: lineErr } = await supabase
  .from("stock_document_lines")
  .insert({
    document_id: doc.id,
    product_id: params.productId,
    delta_quantity_canonical: negativeDelta,  // ← -1 au lieu de -25
    canonical_unit_id: canonical.canonical_unit_id,  // ← "kg" (correct)
    canonical_family: canonical.canonical_family,  // ← "mass" (correct)
    ...
  });
```

**Verdict** : L'unité canonique et la famille sont correctes. Seule la **quantité** est fausse car la conversion a échoué silencieusement en amont.

### Ce qui est écrit dans stock_events

Via `fn_post_stock_document`, les valeurs de `stock_document_lines` sont recopiées dans `stock_events`. La quantité `-1` est donc propagée telle quelle.

---

## 6. Audit affichage stock après retrait

Le stock affiché utilise `checkStockAvailability()` qui calcule `Σ delta_quantity_canonical`. Le calcul est correct — c'est la **donnée écrite** qui est fausse, pas la lecture.

**Verdict** : Le bug vient de l'écriture (conversion), pas de l'affichage.

---

## 7. Analyse de régression liée à "unité retrait"

### Avant l'ajout de l'unité retrait

Avant l'implémentation de `withdrawal_unit_id`, le module retrait utilisait `stock_handling_unit_id` comme unité de saisie **ET** comme unité canonique. Comme c'était la même unité, aucune conversion n'était nécessaire → pas de bug.

### Après l'ajout de l'unité retrait

L'implémentation a introduit la possibilité que `withdrawal_unit_id ≠ canonical_unit_id`. Le code a bien ajouté un appel à `convertUnitsDB()` pour gérer cette conversion, mais :

1. Le moteur `convertUnitsDB` ne supporte pas les conversions cross-famille
2. La conversion sac→kg n'est pas dans `unit_conversions` mais dans `conditionnement_config`
3. Le fallback silencieux masque complètement l'échec

### L'ajout a-t-il cassé quelque chose ?

**Non** — il n'a rien cassé car avant, les retraits n'utilisaient pas d'unité différente. Mais l'implémentation de la nouvelle feature est **incomplète** : elle a branché le mauvais moteur de conversion (universel au lieu de produit-spécifique).

---

## 8. Liste des failles identifiées

### FAILLE 1 — Fallback silencieux (CRITIQUE)

- **Gravité** : P0 — Corruption silencieuse du stock
- **Fichier** : `WithdrawalQuantityPopup.tsx`, L.130-132
- **Code** :
  ```typescript
  if (converted === null) {
    // Fallback: treat as same unit if conversion not found
    canonicalQty = quantity;
  }
  ```
- **Impact** : Chaque retrait avec unité retrait ≠ unité canonique écrit une quantité fausse. Aucune erreur, aucun toast, aucun log. L'utilisateur ne peut pas savoir que le stock est corrompu.
- **Correction attendue** : Ce fallback devrait **bloquer** le retrait avec un message d'erreur, ou utiliser le bon moteur de conversion.

### FAILLE 2 — Mauvais moteur de conversion (CRITIQUE)

- **Gravité** : P0 — Cause racine du bug
- **Fichier** : `WithdrawalQuantityPopup.tsx`, L.123-128
- **Code** :
  ```typescript
  const converted = convertUnitsDB(
    quantity,
    product.withdrawal_unit_id,
    product.canonical_unit_id,
    dbUnits,
    dbConversions
  );
  ```
- **Problème** : `convertUnitsDB` utilise la table `unit_conversions` qui contient des conversions universelles intra-famille (g↔kg). La conversion sac→kg est **produit-spécifique** et stockée dans `conditionnement_config`.
- **Correction attendue** : Utiliser `resolveProductUnitContext` ou lire directement le `conditionnement_config` pour résoudre le facteur de conversion produit-spécifique.

### FAILLE 3 — Badge affiché en unité canonique (MINEUR)

- **Gravité** : P2 — Confusion UX
- **Fichier** : `MobileWithdrawalView.tsx`, L.340
- **Code** :
  ```typescript
  label: params.canonicalLabel ?? canonical.canonical_label ?? "",
  ```
- **Problème** : Le badge vert affiche "1 kg" au lieu de "1 sac", ce qui confirme visuellement le bug mais confond l'utilisateur.

---

## 9. Faux positifs écartés

### Hypothèse : "Le popup retrait envoie une quantité brute sans conversion"
**FAUX** — Le popup appelle bien `convertUnitsDB()`. Le problème n'est pas l'absence de tentative de conversion, mais l'utilisation du mauvais moteur.

### Hypothèse : "La config produit n'est pas correctement lue"
**FAUX** — `withdrawal_unit_id` est correctement lu depuis `products_v2` avec la bonne jointure.

### Hypothèse : "buildCanonicalLine corrompt les données"
**FAUX** — `buildCanonicalLine` reçoit déjà `canonicalUnitId = "kg"` et le traite correctement. Le bug est en amont.

### Hypothèse : "fn_post_stock_document modifie la quantité"
**FAUX** — La fonction recopie `delta_quantity_canonical` tel quel de `stock_document_lines` vers `stock_events`.

### Hypothèse : "L'affichage stock recalcule mal"
**FAUX** — Le calcul `Σ delta_quantity_canonical` est correct. C'est la donnée source qui est fausse.

---

## 10. Verdict final

### Bug : LOCAL mais à IMPACT STRUCTUREL

Le bug est localisé dans un seul fichier (`WithdrawalQuantityPopup.tsx`), mais il affecte **tous les produits** dont l'unité retrait diffère de l'unité canonique. C'est donc un bug structurel dans le design de la feature.

### Moteur de conversion : RESPECTÉ mais INADAPTÉ

Le moteur standard `convertUnitsDB` est correctement appelé. Il fonctionne comme prévu (conversions intra-famille). Le problème est qu'il n'est **pas le bon outil** pour les conversions packaging↔masse qui sont produit-spécifiques.

### Unité retrait : CORRECTEMENT LUES, INCORRECTEMENT CONVERTIES

- ✅ Lecture : OK
- ✅ Affichage popup : OK
- ❌ Conversion vers canonique : ÉCHOUE SILENCIEUSEMENT
- ❌ Fallback : MASQUE L'ERREUR

### Classification

| Critère | Verdict |
|---------|---------|
| Bug confirmé | ✅ OUI |
| Gravité | **P0 — CRITIQUE** |
| Corruption silencieuse | ✅ OUI |
| Données historiques corrompues | ⚠️ Tous les retraits faits en unité retrait ≠ canonique |
| Flow saisie cassé | Non — il fonctionne, mais écrit des données fausses |
| Moteur standard respecté | ✅ Appelé correctement, mais inadapté au cas |
| Régression liée à unité retrait | ✅ OUI — feature incomplète |
| Safe | ❌ **NON SAFE** |

### Résumé en une phrase

> Le `WithdrawalQuantityPopup` appelle le bon moteur de conversion (`convertUnitsDB`) mais ce moteur ne gère que les conversions universelles intra-famille. Les conversions packaging→masse (sac→kg) sont produit-spécifiques et stockées dans `conditionnement_config`. Quand le moteur retourne `null`, un fallback silencieux traite 1 sac comme 1 kg, corrompant le stock sans aucune alerte.

---

## Annexe : Fichiers audités

| Fichier | Rôle | Modifié ? |
|---------|------|-----------|
| `src/modules/stockLedger/components/WithdrawalQuantityPopup.tsx` | Popup retrait + conversion | **CONTIENT LE BUG** |
| `src/modules/stockLedger/components/MobileWithdrawalView.tsx` | Vue retrait + écriture draft | Résolution unité correcte |
| `src/core/unitConversion/conversionEngine.ts` | Moteur conversion DB | Fonctionne comme prévu |
| `src/core/unitConversion/useUnitConversions.ts` | Hook chargement conversions | OK |
| `src/core/unitConversion/types.ts` | Types conversion | OK |
| `src/modules/stockLedger/engine/buildCanonicalLine.ts` | Metadata canonique | OK |
| `src/core/unitConversion/resolveProductUnitContext.ts` | Conversion produit-spécifique | **NON UTILISÉ par retrait** |
