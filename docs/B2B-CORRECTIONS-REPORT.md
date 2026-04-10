# RAPPORT — Corrections Globales B2B Frontend

**Date** : 2026-03-25  
**Scope** : Frontend uniquement (aucune modification SQL/backend)  
**Statut** : ✅ Implémenté

---

## 1. CONTEXTE & PROBLÈME

### Situation initiale

Le système B2B de Restaurant OS permet à un **client** de passer commande auprès d'un **fournisseur**. Les deux organisations peuvent utiliser des **unités de gestion différentes** pour un même produit (ex : le client commande en "Carton", le fournisseur gère en "Pièce").

**Règle fondamentale** : `canonical_quantity` en base est **toujours en espace client**.

### Problèmes identifiés

| # | Problème | Impact | Sévérité |
|---|----------|--------|----------|
| 1 | Modal fournisseur simple : la quantité modifiée par le fournisseur était envoyée en espace fournisseur sans reconversion | Modification ignorée ou incorrecte | 🔴 Critique |
| 2 | Modal fournisseur composite : même problème + pré-remplissage en espace client brut | Valeurs incohérentes dans le modal | 🔴 Critique |
| 3 | Pas de stockage du facteur de conversion lors de l'ouverture du modal BFS | Conversion inverse impossible | 🔴 Critique |
| 4 | `localShippedQty` mis à jour en espace fournisseur au lieu de client | Incohérence UI post-validation | 🟠 Moyen |
| 5 | `CompositeDetailDialog` : affichage brut sans distinction client/fournisseur | Confusion utilisateur | 🟡 Bas |
| 6 | `RetourDetailDialog` : quantité retour (espace client) affichée telle quelle côté fournisseur | Confusion utilisateur | 🟡 Bas |
| 7 | Logique de conversion dupliquée (risque de divergence) | Dette technique | 🟡 Bas |

---

## 2. STRATÉGIE APPLIQUÉE

### Principe directeur

| Contexte | Référentiel attendu |
|----------|---------------------|
| Base de données (`commande_lines`) | CLIENT |
| UI fournisseur — affichage | FOURNISSEUR (traduit) |
| UI fournisseur — édition (modal BFS) | FOURNISSEUR |
| Persistance vers backend (`persistLine`) | CLIENT (reconverti) |
| UI client — affichage | CLIENT (brut) |

### Règle d'affichage bidirectionnel

```
if (viewer === supplier) → affichage traduit via erpFormat
if (viewer === client)   → affichage brut (canonical_quantity + unit_label_snapshot)
```

---

## 3. IMPLÉMENTATION

### 3.1 Utilitaire centralisé — `b2bQuantity.ts` (CRÉÉ)

**Fichier** : `src/modules/commandes/utils/b2bQuantity.ts`

**Rôle** : Source unique de vérité (SSOT) pour les conversions de quantité inter-organisations côté frontend.

| Fonction | Direction | Usage |
|----------|-----------|-------|
| `translateClientQtyToSupplier()` | Client → Fournisseur | Ouverture du modal BFS |
| `translateSupplierQtyToClient()` | Fournisseur → Client | Validation du modal BFS |
| `findMatchingUnit()` | — | Matching par nom/abréviation d'unité |

**Type exporté** : `B2bTranslationResult { quantity, factor, matched }`

**Sécurités intégrées** :
- Logs `console.warn` en DEV si aucune unité ne matche (`B2B_UNIT_MATCH_FAIL`)
- Logs `console.info` en DEV pour tracer chaque conversion
- Fallback à `factor = 1` (quantité brute) si pas de match → pas de crash

---

### 3.2 PreparationDialog.tsx (MODIFIÉ)

**Fichier** : `src/modules/commandes/components/PreparationDialog.tsx` (752 lignes)

**Corrections** :

1. **Ajout de `bfsConversionFactor` (state)** — stocke le facteur lors de l'ouverture du modal
2. **Ouverture du modal** — appel `translateClientQtyToSupplier()` pour convertir la quantité client en quantité fournisseur avant pré-remplissage
3. **Validation du modal** — appel `translateSupplierQtyToClient()` pour reconvertir avant `persistLine()`
4. **Status** — calculé sur `clientQty` (reconverti), pas sur `supplierQty`
5. **`localShippedQty`** — mis à jour avec `clientQty` (espace client)
6. **Reset** — `bfsConversionFactor` remis à `1` après fermeture

**Flow complet** :
```
[Ouverture] canonical_quantity (client) × factor → quantité fournisseur
[Édition]   fournisseur travaille dans son espace
[Validation] quantité fournisseur / factor → clientQty → persistLine()
```

---

### 3.3 CompositePreparationDialog.tsx (MODIFIÉ)

**Fichier** : `src/pages/commandes/CompositePreparationDialog.tsx` (617 lignes)

**Corrections identiques** au PreparationDialog :
- Ajout `bfsConversionFactor` state
- Conversion à l'ouverture via `translateClientQtyToSupplier()`
- Reconversion à la validation via `translateSupplierQtyToClient()`
- Status calculé sur `clientQty`
- `localShippedQty` mis à jour en espace client
- Reset du facteur après fermeture

---

### 3.4 CompositeDetailDialog.tsx (MODIFIÉ)

**Fichier** : `src/pages/commandes/CompositeDetailDialog.tsx` (343 lignes)

**Correction** : Affichage bidirectionnel conditionnel.

- Détection du viewer via `activeEstablishment.id === commande.supplier_establishment_id`
- **Fournisseur** : utilise `useErpQuantityLabels` (traduit)
- **Client** : affiche `canonical_quantity` + `unit_label_snapshot` (brut)

---

### 3.5 RetourDetailDialog.tsx (MODIFIÉ)

**Fichier** : `src/modules/retours/components/RetourDetailDialog.tsx` (275 lignes)

**Audit préalable** : Vérification que `productReturn.quantity` est en espace client (confirmé via `SignalerRetourDialog` + `retourService.ts`).

**Correction** : Affichage bidirectionnel conditionnel.

- Détection du viewer via `activeEstablishment.id === productReturn.supplier_establishment_id`
- **Fournisseur** : utilise `useErpQuantityLabels` (traduit)
- **Client** : affiche quantité brute + `unit_label_snapshot`

---

## 4. CE QUI N'A PAS ÉTÉ TOUCHÉ (VOLONTAIREMENT)

| Composant | Raison |
|-----------|--------|
| `fn_convert_b2b_quantity` (SQL) | Déjà correct (V3) |
| `fn_ship_commande` (SQL) | Fonctionne en espace client, correct |
| `StockEngine` | Opère dans le bon référentiel |
| Réception client | Affiche/valide en espace client, correct |
| Litiges backend | Pas de conversion nécessaire |
| `useErpQuantityLabels` | Hook existant réutilisé tel quel |
| `resolveProductUnitContext` | Moteur BFS réutilisé tel quel |

---

## 5. ARBRE DE DÉPENDANCES

```
b2bQuantity.ts (SSOT conversion)
├── PreparationDialog.tsx        (import translateClientQtyToSupplier, translateSupplierQtyToClient)
├── CompositePreparationDialog.tsx (import translateClientQtyToSupplier, translateSupplierQtyToClient)
└── (utilisable par tout futur module B2B)

useErpQuantityLabels (hook affichage ERP existant)
├── CompositeDetailDialog.tsx    (affichage bidirectionnel)
├── RetourDetailDialog.tsx       (affichage bidirectionnel)
├── PreparationDialog.tsx        (affichage lignes)
└── CompositePreparationDialog.tsx (affichage lignes)
```

---

## 6. MATRICE DE VALIDATION

### Cas critiques

| Scénario | Avant | Après |
|----------|-------|-------|
| Fournisseur modifie 50 → 40 (Pièce) | Valeur ignorée ou clampée à tort | `40 / factor` → client qty correcte |
| Fournisseur modifie 50 → 0 | Status potentiellement faux | `0 / factor = 0` → status "rupture" ✅ |
| Fournisseur confirme sans modifier | Pas de reconversion | `factor = 1` si même unité → passthrough ✅ |
| Composite : pré-remplissage modal | Quantité client brute injectée | Quantité traduite en espace fournisseur ✅ |
| Retour vu par fournisseur | Quantité client brute affichée | Quantité traduite via erpFormat ✅ |
| Retour vu par client | Affichage correct | Inchangé (brut) ✅ |

### Cas edge

| Scénario | Comportement |
|----------|-------------|
| Unité non trouvée chez fournisseur | `factor = 1`, warning DEV, quantité brute utilisée |
| `factorToTarget = 0` | Guard → passthrough (pas de division par 0) |
| Même unité client/fournisseur | `factor = 1` → pas de conversion |

---

## 7. RÉSUMÉ DES FICHIERS

| Fichier | Action | Lignes |
|---------|--------|--------|
| `src/modules/commandes/utils/b2bQuantity.ts` | **Créé** | 101 |
| `src/modules/commandes/components/PreparationDialog.tsx` | Modifié | 752 |
| `src/pages/commandes/CompositePreparationDialog.tsx` | Modifié | 617 |
| `src/pages/commandes/CompositeDetailDialog.tsx` | Modifié | 343 |
| `src/modules/retours/components/RetourDetailDialog.tsx` | Modifié | 275 |

**Total** : 1 fichier créé, 4 fichiers modifiés. **0 fichier backend touché.**

---

## 8. POINTS D'ATTENTION POUR LE FUTUR

1. **Tout nouveau écran B2B** doit utiliser `b2bQuantity.ts` pour les conversions — ne jamais dupliquer la logique
2. **Le matching d'unités** repose sur le nom/abréviation (textuel) — si un produit change de nom d'unité, le matching échouera gracieusement (fallback à quantité brute + warning DEV)
3. **`useErpQuantityLabels`** reste le hook standard pour l'affichage traduit — `b2bQuantity.ts` est réservé aux conversions numériques (ouverture/fermeture modal)

---

*Rapport généré le 2026-03-25 — Corrections B2B Frontend v1.0*
