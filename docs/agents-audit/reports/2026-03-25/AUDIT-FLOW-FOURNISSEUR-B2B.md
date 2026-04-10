# AUDIT CIBLÉ PROFOND — Flow Fournisseur B2B (Commande → Préparation → Expédition)

**Date** : 2026-03-25  
**Périmètre** : Tout le flow côté fournisseur depuis la réception d'une commande client jusqu'à l'expédition, le litige et au-delà.  
**Méthode** : Lecture exhaustive du code source, traçage de chaque champ de quantité, identification de chaque point d'injection.

---

## 1. REFORMULATION

Auditer la chaîne complète du fournisseur B2B pour vérifier que **chaque quantité** affichée, pré-remplie ou persistée côté fournisseur est correctement traduite du référentiel client vers le référentiel fournisseur, et qu'aucune logique parallèle ou injection brute ne subsiste.

---

## 2. CARTOGRAPHIE COMPLÈTE DU FLOW FOURNISSEUR B2B

### Étape 1 : Client crée la commande
- **Fichiers** : `NouvelleCommandeDialog.tsx`, `commandeService.ts` → `upsertCommandeLines()`
- **Données écrites** :
  - `canonical_quantity` : quantité dans l'unité canonique **du client**
  - `canonical_unit_id` : UUID de l'unité canonique **du client**
  - `unit_label_snapshot` : nom textuel de l'unité (ex: "Carton")
  - `product_id` : UUID du produit **du client**

### Étape 2 : Fournisseur voit la liste des commandes
- **Fichier** : `Commandes.tsx` → `useUnifiedCommandes`
- **Quantités** : Non affichées dans la liste (uniquement statut, date, partenaire)
- ✅ **Sain** — aucune quantité manipulée ici

### Étape 3 : Fournisseur ouvre le détail commande
- **Fichier** : `CommandeDetailDialog.tsx` (L226-234)
- **Hook d'affichage** : `useErpQuantityLabels` avec `clientEstablishmentId` + `supplierEstablishmentId`
- **Résolution** : Pass 2 (B2B mapped) → fetch produit fournisseur via `b2b_imported_products` → `resolveProductUnitContext`
- **Affichage** : `erpFormat(line.product_id, line.canonical_quantity, line.canonical_unit_id, line.unit_label_snapshot)`
- ✅ **Sain** — passe par `useErpQuantityLabels` qui gère la translation B2B

### Étape 4 : Fournisseur ouvre la préparation (simple)
- **Fichier** : `PreparationDialog.tsx`
- **Hook d'affichage** : `useErpQuantityLabels` (L96-100) ✅
- **Affichage des lignes** : `erpFormat()` partout (L710, 713, 718, 723) ✅
- **Auto-open** : `openMutation.mutate(commande.id)` (L106) ✅
- **Init local lines** : `localShippedQty: l.shipped_quantity ?? l.canonical_quantity` (L124)
  - ⚠️ **Point d'attention** : `localShippedQty` est en référentiel **client**. Mais il n'est affiché qu'à travers `erpFormat()` qui traduit → ✅ sain pour l'affichage

### Étape 4a : Swipe "OK" (Conforme)
- **Code** : `handleOk` (L147-158)
- **Action** : `persistLine(line.id, line.canonical_quantity, "ok")`
- **⚠️ POINT CRITIQUE** : `line.canonical_quantity` est la quantité **client**. Elle est persistée dans `shipped_quantity`.
- **Mais** : `fn_ship_commande` (SQL) reçoit cette valeur et la convertit via `fn_convert_b2b_quantity` avant de l'écrire dans `stock_events` → ✅ **sain** car le backend traduit.
- La valeur dans `commande_lines.shipped_quantity` reste en référentiel client → **cohérent** car `received_quantity` (côté client) est aussi en référentiel client.

### Étape 4b : Tap → Ouvrir le modal BFS (Modifier quantité)
- **Code** : `handleStartEdit` (L173-265)
- **Étapes** :
  1. Lookup `b2b_imported_products` pour trouver `source_product_id` (produit fournisseur) ✅
  2. Fetch produit fournisseur depuis `products_v2` ✅
  3. `resolveProductUnitContext` sur le produit fournisseur ✅
  4. **Translation B2B** de `line.canonical_quantity` : matching par nom/abréviation d'unité, multiplication par `factorToTarget` (L237-262) ✅
  5. `setBfsExistingQty(translatedQty)` → quantité pré-remplie en référentiel fournisseur ✅
- ✅ **Sain** — corrigé récemment, aligné avec `useErpQuantityLabels` Pass 2

### Étape 4c : Confirmation du modal BFS
- **Code** : `handleBfsConfirm` (L268-306)
- **Action** : `persistLine(bfsLineId, qty, status)` où `qty` = `canonicalQuantity` sortie du modal BFS
- **⚠️ SUBTILITÉ** : Le modal BFS travaille dans le référentiel **fournisseur** (puisque le `product` passé est le produit fournisseur). La `canonicalQuantity` renvoyée est donc en unité canonique fournisseur.
- **Mais** : `persistLine` écrit dans `commande_lines.shipped_quantity` qui est lu par `fn_ship_commande`.
- **Problème potentiel** : `fn_ship_commande` s'attend-il à une quantité en référentiel client ou fournisseur dans `shipped_quantity` ?
  - **Vérification** : `fn_ship_commande` lit `shipped_quantity` et le convertit via `fn_convert_b2b_quantity(client_canonical → supplier_canonical)` avant de créer le `stock_event`.
  - **Si `shipped_quantity` est déjà en fournisseur** : la double conversion donnerait un résultat faux.
  - **⚠️ FAILLE POTENTIELLE** : Quand le fournisseur modifie via le modal BFS, il écrit une quantité fournisseur dans `shipped_quantity`, mais `fn_ship_commande` la reconvertit comme si c'était une quantité client → **double conversion**.

### Étape 4d : Swipe "Rupture"
- **Code** : `handleRupture` (L160-169)
- **Action** : `persistLine(line.id, 0, "rupture")` → ✅ sain (0 est 0 dans tous les référentiels)

### Étape 5 : Expédition
- **Code** : `handleShip` (L308-327)
- **Envoi** : `shipMutation.mutateAsync({ commandeId, lines })` où chaque ligne contient `shipped_quantity: l.localShippedQty`
- **Backend** : `commandes-api?action=ship` → `fn_ship_commande` (SQL RPC)
- `fn_ship_commande` fait : `fn_convert_b2b_quantity(shipped_quantity, client_unit → supplier_unit)` pour le stock_event
- **Même problème que 4c** : si `localShippedQty` vient du modal BFS (déjà en fournisseur), la conversion est appliquée une deuxième fois.

### Étape 6 : Litige
- **Fichier** : `LitigeDetailDialog.tsx`
- **Affichage** : Utilise `useErpQuantityLabels` (L80-85) ✅
- **Quantités affichées** : `ll.shipped_quantity` et `ll.received_quantity` via `erpFormat()` (L276-281)
- **Résolution** : `useResolveLitige` → `fn_resolve_litige` (SQL) qui ajuste le stock
- ✅ **Sain pour l'affichage** — la translation est faite par `erpFormat`
- ⚠️ La résolution SQL de litige utilise les deltas `shipped - received` qui sont tous en référentiel client → **cohérent**

---

## 3. CARTOGRAPHIE DES POINTS D'INJECTION DE QUANTITÉ CÔTÉ FOURNISSEUR

| Point | Fichier | Ligne(s) | Quantité | Référentiel | État |
|-------|---------|----------|----------|-------------|------|
| Affichage ligne liste | `CommandeDetailDialog.tsx` | 567, 605, 608, 677 | `canonical_quantity`, `shipped_quantity` | Client → traduit via `erpFormat` | ✅ Sain |
| Affichage ligne préparation simple | `PreparationDialog.tsx` | 710-723 | `canonical_quantity`, `localShippedQty` | Client → traduit via `erpFormat` | ✅ Sain |
| Affichage ligne préparation composite | `CompositePreparationDialog.tsx` | 535-536 | `canonical_quantity`, `localShippedQty` | Client → traduit via `erpFormat` | ✅ Sain |
| **Pré-remplissage modal simple** | `PreparationDialog.tsx` | 237-264 | `canonical_quantity` | Client → **traduit** avant injection | ✅ Sain (corrigé) |
| **Pré-remplissage modal composite** | `CompositePreparationDialog.tsx` | **236** | `canonical_quantity` | Client → **BRUT, non traduit** | 🔴 **CASSÉ** |
| Init `localShippedQty` simple | `PreparationDialog.tsx` | 124 | `shipped_quantity ?? canonical_quantity` | Client (pour affichage via erpFormat) | ✅ Sain |
| Init `localShippedQty` composite | `CompositePreparationDialog.tsx` | 156 | `shipped_quantity ?? canonical_quantity` | Client (pour affichage via erpFormat) | ✅ Sain |
| Swipe OK simple | `PreparationDialog.tsx` | 149 | `canonical_quantity` (client) | Client → persisté dans `shipped_quantity` | ✅ Sain (backend traduit) |
| Swipe OK composite | `CompositePreparationDialog.tsx` | 190 | `canonical_quantity` (client) | Client → persisté dans `shipped_quantity` | ✅ Sain (backend traduit) |
| BFS confirm → persist simple | `PreparationDialog.tsx` | 283-284 | `canonicalQuantity` (du modal BFS, réf fournisseur) | **Fournisseur** → écrit dans `shipped_quantity` | ⚠️ **FRAGILE** (voir section 6) |
| BFS confirm → persist composite | `CompositePreparationDialog.tsx` | 246-247 | `canonicalQuantity` (du modal BFS, réf fournisseur) | **Fournisseur** → écrit dans `shipped_quantity` | ⚠️ **FRAGILE** (voir section 6) |
| Affichage litige | `LitigeDetailDialog.tsx` | 276-281 | `shipped_quantity`, `received_quantity` | Client → traduit via `erpFormat` | ✅ Sain |
| Retour (fournisseur) | `RetourDetailDialog.tsx` | — | `quantity_snapshot` | Snapshot brut du signalement client | ⚠️ Fragile (snapshot sans translation) |

---

## 4. LOGIQUES DE TRANSLATION EXISTANTES

### A. `useErpQuantityLabels` — SSOT pour l'affichage
- **Fichier** : `src/modules/commandes/hooks/useErpQuantityLabels.ts`
- **Mécanisme** : Pass 1 (direct) / Pass 2 (B2B via `b2b_imported_products`)
- **Translation** : Matching par nom/abréviation d'unité (L251-265) + `factorToTarget`
- **Utilisé par** : `PreparationDialog`, `CompositePreparationDialog`, `CommandeDetailDialog`, `LitigeDetailDialog`, `ReceptionDialog`
- ✅ **Unifié et cohérent** pour tous les affichages

### B. Translation manuelle dans `PreparationDialog.handleStartEdit`
- **Fichier** : `PreparationDialog.tsx` (L224-264)
- **Mécanisme** : `resolveProductUnitContext` → matching par nom/abréviation → `factorToTarget`
- **Duplication** : Logique identique à `useErpQuantityLabels` Pass 2, mais **dupliquée manuellement**
- ⚠️ **Duplication à terme** — fonctionne mais fragile

### C. Translation **absente** dans `CompositePreparationDialog.handleProductEdit`
- **Fichier** : `CompositePreparationDialog.tsx` (L236)
- **Code** : `setBfsExistingQty(line.canonical_quantity)` — **BRUT, sans translation**
- 🔴 **Bug actif confirmé**

### D. `fn_convert_b2b_quantity` — SSOT backend
- **Fichier** : SQL (migration)
- **Mécanisme** : UUID identity → BFS path → semantic identity → UUID remap via `conditionnement_config`
- ✅ **Robuste et sain** — source unique backend

### E. `fn_ship_commande` — Expédition backend
- **Appelle** `fn_convert_b2b_quantity` pour convertir `shipped_quantity` (client) → quantité fournisseur pour le `stock_event`
- ✅ **Sain** pour le flow "OK/Conforme" (swipe)

---

## 5. RÉFÉRENTIELS DES CHAMPS CRITIQUES

| Champ | Table | Référentiel | Quand traduire | Quand ne pas traduire |
|-------|-------|-------------|----------------|----------------------|
| `canonical_quantity` | `commande_lines` | **Client** (toujours) | Pour affichage côté fournisseur ; pour pré-remplissage modal fournisseur | Jamais en écriture (c'est la vérité client) |
| `canonical_unit_id` | `commande_lines` | **Client** (UUID client) | Ne JAMAIS utiliser comme lookup dans le contexte fournisseur | OK pour fallback label |
| `unit_label_snapshot` | `commande_lines` | **Client** (texte) | Utilisable pour matching cross-org (nom d'unité) | — |
| `shipped_quantity` | `commande_lines` | **Client** (convention actuelle) | `fn_ship_commande` traduit vers fournisseur pour stock_event | ReceptionDialog l'utilise tel quel (client) ✅ |
| `received_quantity` | `commande_lines` | **Client** | Jamais traduit — écrit et lu côté client | — |
| `localShippedQty` | Frontend state | **Client** (sauf après modification BFS → **fournisseur**) | — | ⚠️ Ambiguïté si modifié via BFS |
| `delta_quantity_canonical` | `litige_lines` | **Client** | Pour affichage via `erpFormat` | En résolution SQL : cohérent car tout est en client |

---

## 6. AUDIT SPÉCIFIQUE DES MODALS FOURNISSEUR

### A. `PreparationDialog` → `UniversalQuantityModal`
- **Product passé** : Produit **fournisseur** (via `b2b_imported_products` mapping) ✅
- **`existingQuantity`** : Traduit de client → fournisseur via matching nom/abréviation ✅ (corrigé)
- **`onConfirm` retourne** : `canonicalQuantity` en référentiel **fournisseur** (car produit fournisseur)
- **⚠️ Problème** : Cette quantité fournisseur est ensuite écrite dans `shipped_quantity` via `persistLine`, mais `fn_ship_commande` appliquera `fn_convert_b2b_quantity` dessus comme si c'était une quantité client.
- **Verdict** : Si le fournisseur ne modifie pas (swipe OK → qty client brute → backend traduit ✅), tout va. Si le fournisseur **modifie** via BFS → la quantité retournée est fournisseur → `fn_ship_commande` la re-traduit → **double conversion potentielle**.

### B. `CompositePreparationDialog` → `UniversalQuantityModal`
- **Product passé** : Produit **fournisseur** (via `b2b_imported_products` mapping) ✅
- **`existingQuantity`** : `line.canonical_quantity` **BRUT** — pas de translation 🔴
- **Même problème de double conversion** que A si le fournisseur modifie via BFS.

### C. `DishPreparationDialog` → `DishPreparationSection`
- **Pas de modal BFS** — saisie directe de quantité pour les plats
- **Quantités** : `quantity` du `commande_plat_lines` (unité = portions)
- ✅ **Sain** — pas de conversion inter-org nécessaire (les plats sont en unité "portion" universelle)

---

## 7. RISQUES DE MAUVAISE PRÉPARATION / EXPÉDITION

### 🔴 Bug actif : Pré-remplissage composite
- **Impact** : Le fournisseur voit "0.25 pce" au lieu de "50 pce" dans le modal de modification composite
- **Conséquence** : Risque de validation d'une quantité incorrecte
- **Fichier** : `CompositePreparationDialog.tsx` L236

### ⚠️ Risque structurel : Double conversion
- **Scénario** : 
  1. Fournisseur tap → modal BFS s'ouvre avec le produit fournisseur
  2. Fournisseur modifie la quantité (ex: met "100 pce" au lieu de "50 pce")
  3. BFS retourne `canonicalQuantity = 100` (en ref fournisseur = pce)
  4. `persistLine` écrit `shipped_quantity = 100` dans `commande_lines`
  5. `fn_ship_commande` lit `shipped_quantity = 100` et applique `fn_convert_b2b_quantity`
  6. Si factor = 200 (1 carton = 200 pces), la conversion donne 200×100 = 20000 ??? 
- **Analyse approfondie** : En réalité, `fn_convert_b2b_quantity` convertit depuis l'unité **du champ `canonical_unit_id` de la ligne** (= UUID client) vers l'unité du produit fournisseur. Si `shipped_quantity` est déjà en unité fournisseur mais que `canonical_unit_id` dit "Carton client", la conversion sera fausse.
- **Sévérité** : Critique SI le fournisseur modifie effectivement via le modal. Le flow "swipe OK" n'est pas affecté car il persiste `line.canonical_quantity` qui est en ref client.
- **Mitigation actuelle** : Le trigger "Rule 0" clamp `shipped_quantity ≤ canonical_quantity`, ce qui peut masquer partiellement le problème en plafonnant les valeurs aberrantes. Mais le clamp compare aussi des référentiels incompatibles.

### ⚠️ Risque : RetourDetailDialog
- **Fichier** : `RetourDetailDialog.tsx`
- **Quantité** : `productReturn.quantity` (snapshot au moment du signalement, réf client)
- **Affichage** : Brut, sans translation via `erpFormat`
- **Impact** : Le fournisseur voit la quantité en unité client (ex: "0.25 Carton" au lieu de "50 pce")
- **Sévérité** : Faible (informatif, pas d'action de stock)

---

## 8. LOGIQUES PARALLÈLES ENCORE PRÉSENTES

| Logique | Localisation | Statut |
|---------|-------------|--------|
| Translation affichage (SSOT) | `useErpQuantityLabels` | ✅ Unifié |
| Translation pré-remplissage modal simple | `PreparationDialog.handleStartEdit` | ⚠️ Duplique le Pass 2 manuellement |
| Translation pré-remplissage modal composite | `CompositePreparationDialog.handleProductEdit` | 🔴 Absent |
| Conversion backend expédition | `fn_ship_commande` → `fn_convert_b2b_quantity` | ✅ Unifié |
| Conversion backend réception | `fn_receive_commande` | ✅ (pas de conversion, tout est en ref client) |
| Conversion backend litige | `fn_resolve_litige` | ✅ (deltas en ref client, converti par backend) |
| Affichage retours | `RetourDetailDialog` | ⚠️ Pas de translation |

**Nombre de logiques parallèles** : 3 (erpLabels, handleStartEdit dupliqué, handleProductEdit absent)

---

## 9. ZONES SAINES

1. **`useErpQuantityLabels`** — Moteur d'affichage unifié, robuste, utilisé partout ✅
2. **`fn_ship_commande`** — Conversion SQL backend ✅
3. **`fn_convert_b2b_quantity`** — SSOT de conversion inter-org ✅
4. **Affichage des lignes** dans tous les dialogs (passent tous par `erpFormat`) ✅
5. **Flow swipe OK** — Persiste `canonical_quantity` client, backend traduit ✅
6. **Flow swipe Rupture** — 0 est universel ✅
7. **Litige affichage** — Via `erpFormat` ✅
8. **Litige résolution** — Backend gère la conversion ✅
9. **Plats (dish)** — Pas de conversion inter-org nécessaire ✅
10. **Réception client** — Tout en ref client, pas de traduction ✅

---

## 10. ZONES FRAGILES

1. **Translation manuelle dans `PreparationDialog.handleStartEdit`** — Logique dupliquée du Pass 2 de `useErpQuantityLabels`. Fonctionne mais si l'une évolue sans l'autre, divergence.
2. **Matching par nom/abréviation** — Toute la translation frontend repose sur un matching textuel. Si un client nomme son unité "Ctn" et le fournisseur "Carton", le match échoue silencieusement → fallback en quantité brute.
3. **`RetourDetailDialog`** — Affichage de quantité sans translation (informatif).
4. **`localShippedQty` ambiguïté** — Après modification via BFS, la valeur est en ref fournisseur mais le reste du code la traite implicitement comme ref client.
5. **Trigger Rule 0 (clamp)** — Compare `shipped_quantity ≤ canonical_quantity` mais ces deux valeurs pourraient être dans des référentiels différents après une modification BFS.

---

## 11. ZONES ENCORE CASSÉES

### 🔴 Bug 1 : `CompositePreparationDialog` L236
```typescript
setBfsExistingQty(line.canonical_quantity);  // BRUT — pas de translation B2B
```
Le modal s'ouvre avec la quantité client (ex: 0.25) interprétée dans l'espace fournisseur (ex: 0.25 pce au lieu de 50 pce).

### 🔴 Bug 2 (potentiel) : Double conversion BFS → shipped_quantity → fn_ship_commande
Quand le fournisseur modifie via le modal BFS (simple ou composite) :
- Le modal retourne une `canonicalQuantity` en **référentiel fournisseur**
- Cette valeur est écrite dans `shipped_quantity` (qui est censé être en ref client)
- `fn_ship_commande` la reconvertit comme si c'était du client → résultat mathématiquement faux

**Ce bug ne se manifeste que si le fournisseur modifie la quantité via le modal BFS, pas lors du swipe OK.**

---

## 12. CE QUI DOIT DEVENIR SOURCE UNIQUE

| Fonction | SSOT actuel | État |
|----------|-------------|------|
| Affichage quantité B2B | `useErpQuantityLabels` | ✅ Unifié |
| Translation qty pour pré-remplissage | Aucun (dupliqué manuellement) | 🔴 À créer |
| Conversion BFS qty retour → ref client | Aucun | ⚠️ À concevoir |

**Proposition** : Créer un helper `translateClientQtyToSupplier(clientQty, clientUnitLabel, supplierOptions)` extrait de la logique de `PreparationDialog.handleStartEdit`, et l'utiliser dans :
- `PreparationDialog.handleStartEdit`
- `CompositePreparationDialog.handleProductEdit`
- Tout futur dialog fournisseur

**Proposition complémentaire** : Créer un helper inverse `translateSupplierQtyToClient(supplierQty, supplierUnitId, clientUnitId, ...)` pour résoudre le problème de double conversion quand le fournisseur modifie via BFS.

---

## 13. VÉRIFICATION DES SCÉNARIOS

| Cas | Description | Couverture | Verdict |
|-----|-------------|-----------|---------|
| 1 | Client=Carton, Fournisseur=Pièce | Affichage ✅, Modal simple ✅, Modal composite 🔴, Swipe OK ✅ | **Partiellement couvert** |
| 2 | Client=Pièce, Fournisseur=Carton | Affichage ✅ (factorToTarget inverse), Modal simple ✅, Composite 🔴 | **Partiellement couvert** |
| 3 | Même packaging, UUID différents | `erpFormat` match par nom ✅, BFS match par nom ✅ | ✅ Couvert |
| 4 | Multi-niveaux (Carton→Paquet→Pièce) | BFS résout le chemin ✅ | ✅ Couvert |
| 5 | Client change `stock_handling_unit_id` | `erpFormat` se base sur snapshot textuel → résilient | ⚠️ Fragile (si le nom change) |
| 6 | `unit_label_snapshot` + matching textuel | Matching case-insensitive avec trim ✅ | ⚠️ Fragile (synonymes non gérés) |
| 7 | Modal simple vs composite | Simple ✅, Composite 🔴 | **Divergent** |

---

## 14. STRATÉGIE CIBLE DE STABILISATION (SANS CODER)

### Priorité 1 (Immédiat) : Corriger `CompositePreparationDialog` L236
- Appliquer exactement la même logique de translation que `PreparationDialog.handleStartEdit`
- **Avant tout, extraire cette logique** dans un helper partagé

### Priorité 2 (Court terme) : Résoudre le problème de double conversion
- **Option A** : Après le modal BFS, reconvertir la quantité fournisseur → quantité client avant de l'écrire dans `shipped_quantity` (maintient le contrat "shipped_quantity = ref client")
- **Option B** : Modifier `fn_ship_commande` pour détecter si la quantité est déjà en ref fournisseur (complexe, fragile)
- **Recommandation** : Option A — ajouter un helper `translateSupplierQtyToClient` et l'appeler dans `handleBfsConfirm` des deux dialogs

### Priorité 3 (Moyen terme) : Extraire le helper de translation
- Créer `src/modules/commandes/utils/b2bQuantityTranslation.ts`
- Fonctions : `translateClientQtyToSupplier`, `translateSupplierQtyToClient`
- L'utiliser dans `PreparationDialog`, `CompositePreparationDialog`, tout futur dialog

### Priorité 4 (Amélioration) : RetourDetailDialog
- Brancher `useErpQuantityLabels` pour l'affichage de la quantité retournée

### Ce qu'il ne faut PAS toucher
- `fn_ship_commande` / `fn_convert_b2b_quantity` — le backend est sain
- `useErpQuantityLabels` — SSOT d'affichage, ne pas complexifier
- `ReceptionDialog` — tout est en ref client, pas de translation nécessaire
- Flow des plats (`DishPreparationDialog`) — pas de conversion inter-org

---

## 15. RÉPONSE À LA QUESTION CENTRALE

> **Est-ce que tout le flow fournisseur B2B est réellement unifié aujourd'hui ?**

**Non.** Il existe encore :

1. **1 bug actif** : `CompositePreparationDialog` L236 (pré-remplissage brut)
2. **1 faille structurelle non manifestée** : double conversion quand le fournisseur modifie via BFS (les deux dialogs)
3. **2 logiques de translation parallèles** : une dans `useErpQuantityLabels`, une dupliquée manuellement dans `handleStartEdit`
4. **1 affichage non traduit** : `RetourDetailDialog`

Le flow "swipe OK" (chemin le plus fréquent) est 100% sain. Le problème se concentre sur le chemin "modifier la quantité via le modal BFS", qui est le seul endroit où le fournisseur injecte une quantité dans un référentiel différent.

---

**STOP**
