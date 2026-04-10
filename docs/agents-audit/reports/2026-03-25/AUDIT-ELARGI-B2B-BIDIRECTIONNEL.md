# AUDIT ÉLARGI FINAL PRÉ-CORRECTION — FLOW B2B CLIENT ↔ FOURNISSEUR

**Date** : 2026-03-25  
**Périmètre** : Tous les flux B2B inter-organisations, dans les deux sens  
**Statut** : Audit uniquement — aucune correction

---

## 0. Reformulation du but

Vérifier que le système B2B inter-organisations est **cohérent et unifié dans les deux sens** (Client→Fournisseur et Fournisseur→Client), qu'il ne reste aucune ambiguïté de référentiel, aucune double conversion, aucune injection de quantité brute, et aucune faille silencieuse avant de procéder aux corrections identifiées.

---

## 1. CONTRAT DE RÉFÉRENTIEL DES QUANTITÉS

### Tableau de vérité

| Champ | Réf. | Écrit par | Lu par | Traduire ? |
|-------|------|-----------|--------|------------|
| `commande_lines.canonical_quantity` | **CLIENT** | Client (création commande) | FO (via erpFormat) + backend (fn_ship/fn_receive) | **OUI** côté FO affichage + modal. **NON** pour fn_ship (qui traduit en SQL) |
| `commande_lines.canonical_unit_id` | **CLIENT** (UUID client) | Client | FO (erpFormat Pass 2), backend (fn_convert_b2b_quantity) | UUID client — **JAMAIS** l'utiliser pour chercher l'unité FO directement |
| `commande_lines.unit_label_snapshot` | **CLIENT** (nom textuel) | Client (figé à l'envoi) | FO (erpFormat Pass 2 matching textuel), RetourDetailDialog | Sert de pont textuel inter-org. **Fragile** si renommage |
| `commande_lines.shipped_quantity` | **CLIENT** ⚠️ | fn_ship_commande (étape 1 : clamp à canonical_quantity). **Puis** sync éventuel (étape 5f) | Client (ReceptionDialog), LitigeDetailDialog | En base = référentiel CLIENT. fn_ship_commande peut le réécrire (sync post-clamp stock) |
| `commande_lines.received_quantity` | **CLIENT** | fn_receive_commande | LitigeDetailDialog, litige_lines | Même espace que shipped_quantity |
| `litige_lines.shipped_quantity` | **CLIENT** | fn_receive_commande (copie de commande_lines) | LitigeDetailDialog | Idem — affiché via erpFormat (traduit) |
| `litige_lines.received_quantity` | **CLIENT** | fn_receive_commande | LitigeDetailDialog | Idem |
| `stock_events.delta_quantity_canonical` (WITHDRAWAL B2B) | **FOURNISSEUR** | fn_ship_commande (via fn_convert_b2b_quantity) | StockEngine FO | **Non** — déjà dans le bon espace |
| `stock_events.delta_quantity_canonical` (RECEIPT B2B) | **CLIENT** | fn_receive_commande | StockEngine CL | **Non** — déjà dans le bon espace |
| `stock_events.delta_quantity_canonical` (LITIGE_CORRECTION) | **FOURNISSEUR** | fn_resolve_litige (via fn_convert_b2b_quantity) | StockEngine FO | **Non** — déjà converti |

### Verdict référentiels

✅ **Le contrat est clair et bien séparé** :
- `commande_lines` vit dans l'espace CLIENT
- `stock_events` côté FO vivent dans l'espace FOURNISSEUR (post-conversion SQL)
- `stock_events` côté CL vivent dans l'espace CLIENT (pas de conversion nécessaire)

⚠️ **Point d'attention** : `shipped_quantity` en base est dans l'espace CLIENT. Quand fn_ship_commande fait le sync post-clamp (étape 5f), il compare `supplier_quantity` (espace FO) avec `effective_delta` (espace FO) puis écrit le résultat **en espace FO** dans `shipped_quantity` — cela crée une **ambiguïté** car ce champ est ensuite lu côté client pour la réception.

**→ BUG POTENTIEL P1 (voir section 3)**

---

## 2. AUDIT DU FLOW CLIENT → FOURNISSEUR

### Étape par étape

| # | Étape | Fichiers | Quantité | Réf. | Conversion | Verdict |
|---|-------|----------|----------|------|------------|---------|
| 1 | Client crée commande + lignes | NouvelleCommandeCompositeDialog | canonical_quantity | CLIENT | Aucune | ✅ Sain |
| 2 | Client envoie (fn_send_commande) | commandes-api `?action=send` | Fige snapshots | CLIENT | Aucune | ✅ Sain |
| 3 | FO voit la liste | UnifiedCommandesList | Statut seulement | — | — | ✅ Sain |
| 4 | FO ouvre le détail | CommandeDetailDialog | canonical_quantity via `erpFormat()` | CLIENT→traduit FO | useErpQuantityLabels Pass 2 | ✅ Sain |
| 5 | FO ouvre préparation simple | PreparationDialog | Affichage via `erpFormat()` | CLIENT→traduit FO | Pass 2 | ✅ Sain |
| 6a | FO swipe OK | PreparationDialog L147-157 | `line.canonical_quantity` → `localShippedQty` | **CLIENT** brut | Aucune | ✅ Sain (backend convertira) |
| 6b | FO swipe Rupture | PreparationDialog L160-168 | 0 | Neutre | Aucune | ✅ Sain |
| 6c | FO tap → BFS modal (simple) | PreparationDialog L173-264 | `translatedQty` | CLIENT→**traduit FO** | ✅ Traduction faite L237-261 | ✅ **Sain (corrigé)** |
| 6d | FO tap → BFS modal (composite) | CompositePreparationDialog L209-236 | `line.canonical_quantity` **brut** | **CLIENT non traduit** | ❌ **AUCUNE traduction** | 🔴 **BUG ACTIF P1** |
| 7 | BFS confirm → persistLine | PreparationDialog L268-306 | `canonicalQuantity` | **FO** (sortie modal FO) | Aucune (persisté tel quel) | ⚠️ Voir section 3 |
| 8 | Expédition (handleShip) | PreparationDialog L308-327 | `localShippedQty` → p_lines | **Mixte** (voir analyse) | Envoyé au backend | ⚠️ Voir section 3 |

### 🔴 Bug actif confirmé : CompositePreparationDialog L236

```typescript
setBfsExistingQty(line.canonical_quantity); // ← CLIENT brut, non traduit
```

**Impact** : Le modal BFS s'ouvre pré-rempli avec la quantité CLIENT (ex: 0.25 Carton) dans le contexte produit FOURNISSEUR (qui a Pièce comme canonique). Le fournisseur voit "0.25" au lieu de "50".

---

## 3. AUDIT DU RISQUE DE DOUBLE CONVERSION

### Analyse du chemin "Modifier via BFS"

Traçons le chemin complet quand le fournisseur modifie via le modal BFS :

1. **Pré-remplissage** (PreparationDialog L237-264) : `canonical_quantity` CLIENT (ex: 0.25 Carton) est traduit → `translatedQty` FO (ex: 50 pce). ✅
2. **Modal BFS** : Le fournisseur saisit dans l'espace FO. Le modal retourne `canonicalQuantity` = quantité en canonical FO (ex: 45 pce). ✅  
3. **handleBfsConfirm** (PreparationDialog L268-306) : `qty = params.canonicalQuantity` (45 pce FO). Stocké dans `localShippedQty`. ✅
4. **Comparaison status** (L281) : `qty === line.canonical_quantity` → 45 !== 0.25 → status = "modifie". ✅ Correct.
5. **persistLine** (L284) : Écrit `shipped_quantity = 45` (espace FO) dans `commande_lines`. ⚠️
6. **handleShip** (L311-314) : Envoie `shipped_quantity: l.localShippedQty` (= 45, espace FO) au backend.
7. **fn_ship_commande** (SQL L58-73) : `v_final_qty := LEAST(v_input_qty, v_ordered_qty)` → LEAST(45, 0.25) = **0.25**. Le clamp ramène à la qty client !
8. **fn_ship_commande** (SQL L128-131) : `fn_convert_b2b_quantity(source_product_id, cl.canonical_unit_id, cl.shipped_quantity)` → convertit 0.25 (espace CL) → espace FO = 50 pce.

### Verdict double conversion

**PAS de double conversion au final** — le clamp SQL (étape 7) "corrige" involontairement le problème en ramenant la quantité FO à la quantité CL maximale. Cependant :

⚠️ **Le résultat est FAUX mais pas doublement converti** :
- Le fournisseur saisit 45 pce (il veut envoyer 45 pièces, moins que les 50 commandées)
- Le backend reçoit 45, le clamp à 0.25 (qty client)
- fn_convert_b2b_quantity convertit 0.25 → 50 pce (stock withdrawal)
- Le stock est retiré de 50 pce au lieu de 45 pce
- `shipped_quantity` est à 0.25 → le client voit 0.25 Carton (= 50 pce) → correct visuellement mais **la modification du fournisseur est perdue**

**→ BUG STRUCTUREL P1 : La modification fournisseur via BFS est silencieusement ignorée car le clamp la ramène toujours à ≤ canonical_quantity (client).**

### Ce bug est-il réel ou théorique ?

**RÉEL** — il se produit à chaque fois que le fournisseur utilise le modal BFS pour modifier une quantité dans PreparationDialog. Le chemin "Swipe OK" n'est pas affecté car il envoie `canonical_quantity` (client) directement.

### Composants affectés

| Composant | Affecté ? | Raison |
|-----------|-----------|--------|
| PreparationDialog (simple OK) | ✅ Non | Envoie canonical_quantity client |
| PreparationDialog (BFS modify) | 🔴 Oui | Envoie qty FO, clampée à qty CL |
| CompositePreparationDialog (OK) | ✅ Non | Même logique que simple OK |
| CompositePreparationDialog (BFS) | 🔴 Oui (double bug : pas de traduction + même problème) | |
| Litiges | ✅ Non | Aucune modification de qty |
| Réception | ✅ Non | Client = même espace |

---

## 4. AUDIT DES POINTS DE RÉINJECTION DE QUANTITÉ

### Tableau exhaustif

| Point | Fichier | Quantité injectée | Espace | Traduite ? | Verdict |
|-------|---------|-------------------|--------|------------|---------|
| Affichage ligne commande FO | CommandeDetailDialog L677 | canonical_quantity via erpFormat | CL→FO | ✅ Pass 2 | ✅ Sain |
| Affichage shipped FO | CommandeDetailDialog L608 | shipped_quantity via erpFormat | CL→FO | ✅ Pass 2 | ✅ Sain |
| Pré-remplissage init localShippedQty | PreparationDialog L124 | `shipped_quantity ?? canonical_quantity` | CLIENT | Non traduit mais OK (utilisé pour persistLine en espace CL) | ✅ Sain |
| Pré-remplissage BFS modal simple | PreparationDialog L264 | `translatedQty` | FO | ✅ Traduit L237-261 | ✅ Sain |
| **Pré-remplissage BFS modal composite** | CompositePreparationDialog L236 | `line.canonical_quantity` | **CLIENT brut** | ❌ Pas traduit | 🔴 **Bug** |
| Réception init receivedQtys | ReceptionDialog L234 | `shipped_quantity ?? canonical_quantity` | CLIENT | Non traduit (client = même espace) | ✅ Sain |
| Réception popup | ReceptionDialog L358-370 | `shipped_quantity ?? canonical_quantity` | CLIENT | Non traduit (même espace) | ✅ Sain |
| Litige shipped/received display | LitigeDetailDialog L277-281 | via erpFormat | CL→traduit | ✅ Pass 2 | ✅ Sain |
| Litige delta display | LitigeDetailDialog L271 | computeEcart(shipped, received) | CLIENT brut (les deux sont CL) | Calcul CL−CL = cohérent | ✅ Sain |
| **Retour détail** | RetourDetailDialog L117-119 | `productReturn.quantity` + `unit_label_snapshot` | **CLIENT brut** | ❌ Pas d'erpFormat | ⚠️ **Fragile** |
| CompositeDetailDialog produits | CompositeDetailDialog L196 | `qty` + `unit_label_snapshot` brut | **CLIENT** | ❌ Pas d'erpFormat | ⚠️ **Fragile** |

---

## 5. AUDIT DES SNAPSHOTS ET LABELS TEXTUELS

### Champs snapshot utilisés

| Champ | Utilisé pour | Risque |
|-------|-------------|--------|
| `unit_label_snapshot` | erpFormat fallback + Pass 2 matching + CompositeDetailDialog display brut | ⚠️ Matching textuel fragile |
| `product_name_snapshot` | Affichage uniquement | ✅ Aucun risque |
| `created_by_name_snapshot` | Affichage uniquement | ✅ Aucun risque |

### Risques du matching textuel

Le **Pass 2 de useErpQuantityLabels** (L250-266) fait :
```typescript
const matchingUnit =
  options.find((o) => o.name.toLowerCase().trim() === normalizedLabel) ??
  options.find((o) => o.abbreviation.toLowerCase().trim() === normalizedLabel);
```

La même logique existe dans **PreparationDialog** (L241-244).

| Scénario | Résultat |
|----------|----------|
| Unité "Pièce" chez CL et FO | ✅ Match |
| Unité "pce" (abréviation) chez CL, "Pièce" chez FO | ✅ Match via 2e fallback |
| Unité "Pièces" (pluriel) chez CL, "Pièce" chez FO | ❌ **Pas de match → raw qty** |
| Unité renommée après commande | ❌ **Snapshot figé ≠ nom actuel → match possible** (car on compare snapshot vs nom actuel FO) |
| Unité avec family=null | ⚠️ Frontend : pas de blocage (match par nom seulement). SQL fn_convert_b2b_quantity L89 : exige `v_client_family = v_supplier_family` → si l'un est null, pas de match → error |

### Verdict snapshots

⚠️ **Le matching textuel est le maillon faible structurel du B2B frontend**. Le backend SQL est plus robuste (UUID → BFS → nom+famille). Le frontend ne fait que nom/abréviation sans vérification de famille.

---

## 6. AUDIT DE LA ROBUSTESSE AUX CHANGEMENTS DE CONFIG

| Scénario | Expédition (SQL) | Affichage (Frontend) | Réception | Verdict |
|----------|-----------------|---------------------|-----------|---------|
| Client change `stock_handling_unit_id` après commande | ✅ SQL lit canonical_unit_id figé dans commande_lines | ✅ erpFormat utilise canonical_unit_id figé | ✅ Reception lit canonical_unit_id figé | ✅ Robuste (snapshot protège) |
| Fournisseur change `stock_handling_unit_id` après commande | ⚠️ fn_convert_b2b_quantity utilise le **stock_handling_unit_id actuel** du produit FO → résultat différent | ⚠️ erpFormat Pass 2 fetch le produit FO actuel → affichage potentiellement différent | N/A | ⚠️ **Fragile** — la conversion change si config FO évolue |
| Packaging change (ajout/suppression niveau) | ⚠️ BFS peut trouver un chemin différent | ⚠️ Affichage breakdown change | N/A | ⚠️ Fragile |
| Unité renommée | ✅ SQL utilise UUID | ⚠️ Frontend matching textuel peut casser | N/A | ⚠️ Fragile côté frontend |
| Produit importé mis à jour | ✅ b2b_imported_products mapping reste stable | ✅ | ✅ | ✅ Robuste |

---

## 7. AUDIT DES LOGIQUES PARALLÈLES

### Logiques de traduction B2B existantes

| Logique | Localisation | Méthode | Utilisée par |
|---------|-------------|---------|--------------|
| **fn_convert_b2b_quantity** | SQL | UUID → BFS → Nom+Famille | fn_ship_commande, fn_resolve_litige |
| **useErpQuantityLabels Pass 2** | Frontend hook | Fetch FO product → BFS → format | CommandeDetailDialog, ReceptionDialog, LitigeDetailDialog, PreparationDialog (affichage), CompositePreparationDialog (affichage) |
| **PreparationDialog L220-264** | Frontend inline | Fetch FO product → resolveProductUnitContext → match nom/abréviation → factorToTarget | PreparationDialog (pré-remplissage BFS modal) |
| **CompositePreparationDialog** | Frontend inline | **AUCUNE** traduction | CompositePreparationDialog (pré-remplissage BFS modal) — 🔴 BUG |

### Duplications identifiées

1. **PreparationDialog L220-264** duplique partiellement la logique de useErpQuantityLabels Pass 2 mais pour un usage différent (pré-remplissage vs affichage). La logique est similaire mais pas identique :
   - erpFormat : `matchingUnit.factorToTarget` appliqué à `qty` pour **affichage**
   - PreparationDialog : `matchingUnit.factorToTarget` appliqué à `canonical_quantity` pour **pré-remplissage modal**
   
2. **CompositePreparationDialog** n'a aucune logique de traduction → c'est le bug P1.

### Ce qui devrait être la source unique

| Besoin | Source unique recommandée |
|--------|-------------------------|
| Traduction qty CL→FO pour **affichage** | useErpQuantityLabels (existant, ✅) |
| Traduction qty CL→FO pour **pré-remplissage modal** | Helper partagé `translateClientQtyToSupplier()` (à extraire) |
| Traduction qty pour **stock** | fn_convert_b2b_quantity SQL (existant, ✅) |
| Traduction qty pour **litige** | fn_convert_b2b_quantity SQL (existant, ✅) |

---

## 8. AUDIT BIDIRECTIONNEL — B2B DANS LES 2 SENS

### Sens A : Client → Fournisseur

| Point de vérification | Verdict | Détail |
|----------------------|---------|--------|
| Quantité correcte côté FO ? | ✅ | erpFormat Pass 2 traduit correctement |
| Unité correcte côté FO ? | ✅ | Pass 2 résout le produit FO pour le packaging |
| Modal pré-rempli correct (simple) ? | ✅ | PreparationDialog traduit L237-264 |
| Modal pré-rempli correct (composite) ? | 🔴 | CompositePreparationDialog L236 — **BUG** |
| Affichage détail correct ? | ✅ | CommandeDetailDialog utilise erpFormat |
| Préparation "Conforme" correct ? | ✅ | Envoie canonical_quantity client → backend convertit |

### Sens B : Fournisseur → Client

| Point de vérification | Verdict | Détail |
|----------------------|---------|--------|
| shipped_quantity cohérente ? | ✅ (swipe OK) / 🔴 (BFS modify) | Swipe OK envoie qty client → OK. BFS modify envoie qty FO → clampée → modification perdue |
| Conversion stock FO correcte ? | ✅ | fn_ship_commande + fn_convert_b2b_quantity |
| Réception client cohérente ? | ✅ | fn_receive_commande utilise canonical_unit_id client pour stock CL |
| Litige cohérent ? | ✅ | fn_resolve_litige utilise fn_convert_b2b_quantity |
| Affichage litige correct ? | ✅ | LitigeDetailDialog utilise erpFormat |
| Stock FO cohérent ? | ✅ | Écritures en espace FO via fn_convert_b2b_quantity |
| Double référentiel caché ? | ⚠️ | shipped_quantity post-sync (étape 5f) peut contenir une valeur FO dans un champ normalement CL |

### Symétrie

Le système est **asymétrique par design** (et c'est correct) :
- `commande_lines` vit en espace CLIENT
- Les conversions se font en SQL au moment de l'expédition/litige
- Le client n'a jamais besoin de traduire (il lit ses propres unités)
- Seul le fournisseur a besoin de translation (erpFormat Pass 2 + modal)

---

## 9. VERDICT FINAL

### A. Ce qui est sain ✅

1. **fn_convert_b2b_quantity** — Robuste, 4 stratégies de résolution (UUID → BFS → Nom+Famille → erreur)
2. **fn_ship_commande** — Conversion B2B correcte pour les écritures stock
3. **fn_resolve_litige** — Utilise fn_convert_b2b_quantity, produit les bons deltas FO
4. **fn_receive_commande** — Opère en espace client, écritures stock client correctes
5. **useErpQuantityLabels** — Pass 1 + Pass 2 bien séparés, affichage correct
6. **CommandeDetailDialog** — Affichage via erpFormat, correct dans les deux sens
7. **LitigeDetailDialog** — Affichage via erpFormat, computeEcart en espace homogène
8. **ReceptionDialog** — Tout en espace client, pas de traduction nécessaire
9. **StockEngine** — Lectures centralisées, formule SSOT respectée
10. **Swipe OK / Rupture** — Chemin simple, envoie canonical_quantity client, backend convertit

### B. Ce qui est fragile ⚠️

1. **Matching textuel** (PreparationDialog L241-244, erpFormat L250-255) — Nom/abréviation sans vérification de famille côté frontend
2. **CompositeDetailDialog** (L196) — Affiche `qty` + `unit_label_snapshot` brut sans erpFormat → fournisseur voit unités client
3. **RetourDetailDialog** (L117-119) — Affiche `quantity` + `unit_label_snapshot` brut sans erpFormat
4. **Changement config FO post-commande** — fn_convert_b2b_quantity utilise le stock_handling_unit_id actuel, pas un snapshot
5. **shipped_quantity post-sync** — L'étape 5f de fn_ship_commande peut écrire une valeur FO dans un champ normalement client

### C. Ce qui est encore cassé 🔴

1. **CompositePreparationDialog L236** — `setBfsExistingQty(line.canonical_quantity)` injecte la qty CLIENT brute dans le modal FO → affichage absurde (ex: 0.25 au lieu de 50)
2. **Modification via BFS (PreparationDialog + Composite)** — La qty retournée par le modal (espace FO) est envoyée comme `shipped_quantity` au backend, qui la clamp à `canonical_quantity` (espace CL) → la modification est silencieusement ignorée

### D. Ce qui est ambigu 🟡

1. **`shipped_quantity` en base** — Normalement espace CLIENT, mais le sync post-clamp (fn_ship_commande étape 5f) peut y écrire une valeur FO en cas de rupture partielle stock
2. **`localShippedQty`** dans PreparationDialog — Contient tantôt une valeur CLIENT (init, swipe OK) tantôt FO (après BFS confirm)

### E. Ce qui reste dupliqué

1. **Logique de traduction pour pré-remplissage** — PreparationDialog L220-264 (inline) vs aucune logique dans CompositePreparationDialog
2. **Logique de matching textuel** — Dupliquée entre PreparationDialog et useErpQuantityLabels (même pattern mais pas partagée)

### F. Ce qui doit devenir source unique

| Besoin | Source unique à créer/désigner |
|--------|-------------------------------|
| Traduction qty CL→FO pour modal | `translateClientQtyToSupplier()` helper partagé |
| Traduction qty FO→CL pour persistance | `translateSupplierQtyToClient()` helper partagé (inverse) |
| Matching d'unité inter-org | Fonction partagée `findMatchingSupplierUnit()` |
| Affichage qty B2B | useErpQuantityLabels (déjà SSOT) |

---

## 10. STRATÉGIE CIBLE DE STABILISATION

### Priorité 1 — Bugs actifs (P1)

**1a. Fix CompositePreparationDialog L236**
- Copier la logique de traduction de PreparationDialog L220-264
- Ou mieux : extraire dans un helper partagé et l'appeler des deux endroits

**1b. Fix handleBfsConfirm (PreparationDialog + Composite)**
- Le modal retourne une quantité en espace FO
- Avant de persister dans `localShippedQty` (utilisé comme `shipped_quantity` envoyé au backend), il faut reconvertir FO→CL
- Le backend attend `shipped_quantity` en espace CLIENT (car il fait `LEAST(input, canonical_quantity)` et `canonical_quantity` est en espace CL)
- **Solution** : dans handleBfsConfirm, diviser par le même facteur utilisé pour la traduction initiale

### Priorité 2 — Unification

**2a. Extraire `translateClientQtyToSupplier()`**
- Input : canonical_quantity (CL), unit_label_snapshot, supplierProductId, dbUnits, dbConversions
- Output : { translatedQty: number, matchedUnit: ReachableUnit | null }
- Utilisé par : PreparationDialog, CompositePreparationDialog

**2b. Extraire `translateSupplierQtyToClient()`**
- Inverse de 2a
- Utilisé par : handleBfsConfirm pour reconvertir avant envoi au backend

**2c. Extraire `findMatchingSupplierUnit()`**
- Input : clientUnitLabel, supplierOptions
- Output : ReachableUnit | null
- Utilisé par : 2a, 2b, useErpQuantityLabels Pass 2

### Priorité 3 — Affichages fragiles

**3a. CompositeDetailDialog** — Remplacer `{qty} {line.unit_label_snapshot}` par `erpFormat()` (useErpQuantityLabels déjà disponible dans le parent)

**3b. RetourDetailDialog** — Ajouter useErpQuantityLabels pour traduire `quantity` + `unit_label_snapshot`

### Ce qu'il ne faut PAS toucher

- **fn_convert_b2b_quantity** — Sain, robuste, testé
- **fn_ship_commande** — Sain côté stock (la conversion est correcte)
- **fn_resolve_litige** — Sain, utilise fn_convert_b2b_quantity
- **fn_receive_commande** — Sain, pas de conversion nécessaire
- **useErpQuantityLabels** — Sain pour l'affichage
- **StockEngine** — Sain, centralisé

### Ordre de traitement recommandé

1. **Extraire le helper** `translateClientQtyToSupplier()` + `translateSupplierQtyToClient()`
2. **Fix CompositePreparationDialog** L236 (utiliser le helper)
3. **Fix handleBfsConfirm** dans PreparationDialog et CompositePreparationDialog (reconvertir FO→CL avant persistLine)
4. **Fix CompositeDetailDialog** (utiliser erpFormat)
5. **Fix RetourDetailDialog** (utiliser erpFormat)
6. **Tests** : cas Carton↔Pièce, multi-niveaux, même packaging UUID différents

---

## RÉSUMÉ EXÉCUTIF

**Le B2B est-il propre dans les 2 sens ?**

**Non — il reste 2 bugs structurels et 2 affichages fragiles :**

| # | Problème | Impact | Priorité |
|---|----------|--------|----------|
| 1 | CompositePreparationDialog pré-remplissage brut | FO voit quantité absurde dans modal composite | P1 |
| 2 | BFS modify → qty FO envoyée au backend attendant qty CL | Modification FO silencieusement perdue, stock faux | P1 |
| 3 | CompositeDetailDialog affichage brut | FO voit unités client au lieu de FO | P2 |
| 4 | RetourDetailDialog affichage brut | FO voit unités client pour les retours | P3 |

**Tout le reste (backend SQL, StockEngine, erpFormat, réception, litiges) est sain et unifié.**

---

**STOP**
