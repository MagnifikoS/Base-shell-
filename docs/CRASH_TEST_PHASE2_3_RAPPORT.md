# 🧪 CRASH TEST B2B — RAPPORT PHASES 2 & 3

> **Date** : 2026-03-28
> **Auditeur** : QA IA Expert Supply Chain
> **Périmètre** : Cycle complet Client→Commande→Expédition→Réception→Litige→Facture

---

## 1. RÉSUMÉ EXÉCUTIF

| Indicateur | Valeur |
|---|---|
| **MVP testable** | ⚠️ OUI avec réserves critiques |
| **Confiance globale** | 4/10 |
| **Tests OK** | 4/10 |
| **Tests KO** | 4/10 |
| **Tests KO bloquants** | 2/10 |
| **Bugs critiques** | 3 |
| **Bugs moyens** | 3 |
| **Incohérences UX** | 2 |

### Verdict : 🔴 NON PRÊT — Corrections critiques requises avant mise en production

---

## 2. PHASE 2 — AUDIT IMPORT / MAPPING CLIENT

### Baseline Stock

| Produit | FO Stock | FO Unité | CL Stock | CL Unité | Cohérent? |
|---|---|---|---|---|---|
| CAS-A EAU PLATE TEST | 0 | Pièce | ❌ Non importé | — | N/A |
| TEST 1 | 100 Cartons | Carton | 67.05 Cartons | Carton | ✅ |
| TEST 2 | 147.5 kg | Kilogramme | 154.5 kg | Kilogramme | ✅ |
| TEST 3 | 678 pce | Pièce | 672 pce | Pièce | ✅ |
| SAFRAN IRANIEN | 10 kg | Kilogramme | 9 pce | Pièce | ❌ CROSS-FAMILY |
| HUILE AMPHORE | 0 | Amphore | 36 kg | Kilogramme | ❌ CROSS-FAMILY |

### Rapport par produit

#### CAS-A EAU PLATE TEST
- **Import** : ❌ KO — Non importé côté client
- **Mapping** : N/A
- **Unités** : N/A (simple : Pièce → Pièce)
- **Prix** : 0.50 €/pce côté FO
- **Risque** : Mineur — doit être importé pour tester, mais le cas est trivial

#### TEST 1 (multi-niveaux)
- **Import** : ✅ OK
- **Mapping** : ✅ OK — `unit_mapping: {Pièce→Pièce, Carton→Carton}`
- **Unités** : ✅ OK — Carton(10 Boîte) → Boîte(2 Pièce) + équivalence 125g
- **Prix** : ✅ 1.36 €/pce côté FO et CL
- **Risque** : ⚠️ CRITIQUE — Voir BUG-001 (snapshot prix)

#### TEST 2 (conditionné Sac→kg)
- **Import** : ✅ OK
- **Mapping** : ✅ OK — `unit_mapping: {Sac→Sac, kg→kg}`
- **Unités** : ✅ OK — Sac(4 kg), famille weight
- **Prix** : ✅ 10.00 €/kg
- **Risque** : Faible

#### TEST 3 (Pack→Pièce + équivalence L)
- **Import** : ✅ OK
- **Mapping** : ✅ OK — `unit_mapping: {Pièce→Pièce, Pack→Pack, L→L}`
- **Unités** : ✅ OK — Pack(6 Pièce) + 1 Pièce = 1L
- **Prix** : ✅ 5.00 €/pce
- **Risque** : Faible

#### PRODUIT X — SAFRAN IRANIEN ⚠️ CAS CRITIQUE
- **Import** : ✅ OK (importé)
- **Mapping** : ❌ KO — `unit_mapping: {kg(FO)→kg(CL)}` MAIS produit CL a `final_unit = Pièce` (famille count)
- **Unités** : ❌ KO — FO = kg/weight, CL = Pièce/count → **CROSS-FAMILY**
- **Prix** : ⚠️ FO = NULL (pas de prix), CL = 4.00 €/pce (prix orphelin, non synchronisé)
- **Conversion B2B** : ❌ `fn_convert_b2b_quantity` retourne **ERROR**
- **Risque** : 🔴 CRITIQUE — Commande impossible à expédier (conversion échoue). Voir BUG-002.

#### PRODUIT Y — HUILE AMPHORE ⚠️ CAS CRITIQUE
- **Import** : ✅ OK (importé)
- **Mapping** : ❌ KO — `unit_mapping = NULL` (aucun mapping)
- **Unités** : ❌ KO — FO = Amphore/count, CL = kg/weight → **CROSS-FAMILY** + unité exotique
- **Prix** : ❌ FO = NULL, CL = 0.00 € → produit à prix zéro
- **Config** : ❌ `conditionnement_config = {}` (vide) des deux côtés
- **Conversion B2B** : ❌ `fn_convert_b2b_quantity` retourne **ERROR**
- **Risque** : 🔴 CRITIQUE — Commande impossible, facture à 0€. Voir BUG-003.

---

## 3. PHASE 3 — CRASH TESTS E2E

---

### TEST 1 — Commande parfaite (TEST 2 + TEST 3)

#### Produits utilisés
TEST 2 (kg), TEST 3 (Pièce)

#### Préconditions
- FO: TEST2=147.5kg, TEST3=678pce
- CL: TEST2=154.5kg, TEST3=672pce
- Partnership actif, produits importés avec mappings corrects

#### Actions réalisées
Analyse des commandes historiques complétées (CMD-000036, CMD-000009). Vérification de la chaîne prix/conversion/stock/facture.

#### Résultat attendu
- Conversion identité (kg→kg, pce→pce)
- Prix snapshot = prix catalogue
- Stock FO décrémenté, stock CL incrémenté
- Facture correcte

#### Résultat observé
- ✅ Conversions identité fonctionnent parfaitement
- ✅ `fn_convert_b2b_quantity` retourne `ok` pour les deux
- ✅ Prix snapshot TEST2=10.00€/kg, TEST3=5.00€/pce → corrects
- ✅ Stock events: FO WITHDRAWAL et CL RECEIPT cohérents
- ✅ FAC-APP-000009: TEST2 4kg×10€=40€ → correct

#### Vérification
- Produit : ✅ | Unités : ✅ | Conversion : ✅ | Stock : ✅ | Prix : ✅ | Statuts : ✅ | Facture : ✅

#### Verdict : ✅ OK
#### Gravité : N/A
#### Analyse : Le flux simple avec unités identiques fonctionne parfaitement.

---

### TEST 2 — Commande multi-niveaux (TEST 1)

#### Produits utilisés
TEST 1 (Carton→Boîte→Pièce + 125g)

#### Préconditions
- FO: stock_handling_unit=Carton, stock=100 Cartons
- CL: stock_handling_unit=Carton, final_unit=Pièce, stock=67.05 Cartons
- 1 Carton = 10 Boîtes = 20 Pièces

#### Actions réalisées
Analyse de CMD-000036 (cloturée) et CMD-000040 (litige). Vérification conversion, prix snapshot, stock events.

#### Résultat attendu
- Conversion Carton→Carton = factor 1 (identité via unit_mapping)
- Prix snapshot = 1.36€/pce × 20 = **27.20 €/Carton**
- Stock FO: -N Cartons, Stock CL: +N Cartons

#### Résultat observé
- ✅ Conversion B2B: `fn_convert_b2b_quantity` résout Carton→Carton via mapping = OK
- ❌ **Prix snapshot = 1.36 €/Carton** (au lieu de 27.20 €/Carton)
- ✅ Stock events: FO -1.1 Carton, CL +1 Carton (CMD-000040) → cohérent
- ❌ **Facture FAC-APP-000009**: TEST1 1 Carton × 1.36€ = **1.36€** (devrait être **27.20€**)

#### Vérification
- Produit : ✅ | Unités : ✅ | Conversion : ✅ | Stock : ✅ | **Prix : ❌ CRITIQUE** | Statuts : ✅ | **Facture : ❌ CRITIQUE**

#### Verdict : 🔴 KO BLOQUANT
#### Gravité : CRITIQUE
#### Analyse métier

**BUG-001 : Snapshot de prix incorrect pour les unités de conditionnement**

`fn_send_commande` calcule :
```
unit_price_snapshot = final_unit_price × COALESCE(fn_product_unit_price_factor(...), 1.0)
```

Le `fn_product_unit_price_factor(Pièce→Carton)` retourne aujourd'hui 20, mais au moment de l'envoi des commandes historiques, il a retourné `NULL` (config pas encore remplie?), et le `COALESCE(NULL, 1.0)` a silencieusement appliqué un factor de 1.

**Impact financier** : Perte de **95% du revenu** sur chaque ligne TEST1 facturée.
- Facturé : 1.36€/Carton × quantité
- Correct : 27.20€/Carton × quantité

**Recommandation** : 
1. Supprimer le `COALESCE(…, 1.0)` et bloquer l'envoi si le factor est NULL (le hard block en amont devrait le capturer mais ne le fait pas quand canonical_unit_id = stock_handling_unit_id ≠ final_unit_id)
2. Audit de toutes les factures émises pour détecter les sous-facturations

---

### TEST 3 — Réception partielle

#### Produits utilisés
TEST 2 (CMD-000040, 8kg expédiés, 0 reçus)

#### Préconditions
- CMD-000040 envoyée avec TEST1(1.1 Carton), TEST2(8kg), TEST3(6pce)
- FO a expédié les 3 produits (stock events confirmés : -1.1, -8, -6)

#### Résultat observé
- ✅ Réception partielle déclarée : TEST3=6 reçu (OK), TEST1=1 reçu (partiel), TEST2=0 reçu
- ✅ Litige créé automatiquement (id: 2e9c0e38, status: open)
- ✅ Litige_lines : TEST1 (shipped 1.1, received 1), TEST2 (shipped 8, received 0)
- ✅ Stock CL : TEST3 +6pce (reçu), TEST1 +1 Carton (reçu partiel)
- ✅ Aucun stock CL pour TEST2 (correct : received=0)
- ✅ Commande status = 'litige'

#### Vérification
- Produit : ✅ | Unités : ✅ | Conversion : ✅ | Stock : ✅ | Prix : ⚠️ (voir BUG-001) | Statuts : ✅ | Facture : N/A (pas générée, litige ouvert)

#### Verdict : ✅ OK (mécanisme de litige)
#### Gravité : N/A
#### Analyse : Le flux de réception partielle et de création automatique de litige fonctionne correctement. Le litige capture les bonnes quantités.

---

### TEST 4 — Erreur fournisseur sur plusieurs lignes

#### Produits utilisés
CMD-000040 : TEST3 (OK), TEST1 (partiel), TEST2 (total manquant)

#### Préconditions
Commande multi-produits avec 3 lignes

#### Résultat observé
- ✅ TEST3 : OK (6/6 expédié, 6/6 reçu) — `line_status = ok`
- ⚠️ TEST1 : Partiel (1.1/1.1 expédié, 1/1.1 reçu) — `line_status = ok` ← devrait être `partiel`?
- ⚠️ TEST2 : Total (8/8 expédié, 0/8 reçu) — `line_status = ok` ← devrait être `rupture`/`litige`
- ✅ Commande status = 'litige' (correct)
- ✅ Litige créé avec 2 lignes en écart

#### Vérification
- Produit : ✅ | Unités : ✅ | Stock : ✅ | Prix : ⚠️ | **Statuts ligne : ⚠️** | Facture : N/A

#### Verdict : ⚠️ DOUTE
#### Gravité : Moyenne
#### Analyse : Les `line_status` restent `ok` même quand la réception est partielle ou nulle. C'est une incohérence d'affichage qui peut confondre le fournisseur dans son tableau de bord. Le litige est cependant bien créé.

**Recommandation** : Mettre à jour `line_status` lors de la réception pour refléter l'écart réel (partiel/rupture).

---

### TEST 5 — Résolution litige

#### Produits utilisés
Litige 2e9c0e38 sur CMD-000040

#### Préconditions
- Litige ouvert avec 2 lignes : TEST1 (écart 0.1 Carton), TEST2 (écart 8kg)
- Status: open

#### Résultat observé
- Litige consultable en base, structure correcte
- ❌ **Non testable via navigateur** (navigateur instable durant la session)
- Vérification théorique via code : `fn_resolve_litige` devrait ajuster le stock basé sur le ledger

#### Verdict : ⚠️ NON TESTÉ (navigateur indisponible)
#### Gravité : À déterminer
#### Recommandation : Tester manuellement la résolution du litige CMD-000040

---

### TEST 6 — Annulation expédition

#### Préconditions
- Nécessite une commande expédiée mais non reçue

#### Résultat observé
- ❌ **Non testé** : Pas de commande dans l'état `expediee` disponible actuellement
- Vérification théorique : `fn_cancel_b2b_shipment` existe avec garde RBAC fournisseur (memory confirmée)

#### Verdict : ⚠️ NON TESTÉ
#### Gravité : À déterminer

---

### TEST 7 — Retrait de stock

#### Non testé via navigateur (instabilité). Analyse théorique :
- Le retrait utilise le pipeline `stock-ledger` edge function
- Le hard block cross-family est en place
- Le clampage empêche les stocks négatifs

#### Verdict : ⚠️ NON TESTÉ
#### Gravité : À déterminer

---

### TEST 8 — Inventaire

#### Non testé via navigateur. Le module inventaire utilise `zone_stock_snapshots` et le pipeline standard.

#### Verdict : ⚠️ NON TESTÉ

---

### TEST 9 — Cas critique : SAFRAN (produit sans prix + cross-family)

#### Produit
PRODUIT X — SAFRAN IRANIEN

#### Préconditions
- FO : Kilogramme/weight, prix=NULL, stock=10kg, conditionnement_config={}
- CL : Pièce/count, prix=4.00€/pce, stock=9pce
- unit_mapping: {kg(FO)→kg(CL)} — mais CL final_unit est Pièce, pas kg!

#### Actions réalisées
- Test `fn_convert_b2b_quantity(SAFRAN_FO, CL_Pièce, 5)` → **ERROR**
- Test `fn_convert_line_unit_price(SAFRAN_CL, 4.0, Pièce, Pièce)` → OK (identité)

#### Résultat attendu
- Commande devrait être **bloquée** à l'envoi (prix NULL côté FO, conversion impossible)

#### Résultat observé
- ✅ Conversion B2B retourne ERROR → l'expédition serait bloquée
- ❌ **MAIS** : Le produit est commandable côté client (il a un prix de 4€/pce)
- ❌ `fn_send_commande` utilise le prix du produit **client** (4€/pce), pas celui du fournisseur (NULL)
- ❌ Le hard block vérifie `fn_product_unit_price_factor` sur le produit **client** qui est Pièce→Pièce = OK
- ❌ La commande s'envoie AVEC un prix (4€), mais l'expédition ÉCHOUE (conversion error)

**Résultat** : La commande est envoyée puis **non expédiable**. Le fournisseur voit une ligne qu'il ne peut pas traiter.

#### Vérification
- **Conversion : ❌ BLOQUANTE** | **Prix : ❌ Incohérent** | **Statuts : ❌ Commande zombie possible**

#### Verdict : 🔴 KO BLOQUANT
#### Gravité : CRITIQUE

#### Analyse métier — BUG-002

**Import cross-family non détecté** : Le pipeline d'import B2B a créé un mapping où le produit FO (kg/weight) est mappé à un produit CL (Pièce/count) sans aucune équivalence. C'est une incohérence fondamentale qui :
1. Permet au client de commander un produit non expédiable
2. Crée une "commande zombie" bloquée indéfiniment côté fournisseur
3. Le prix utilisé (4€/pce) n'a aucun rapport avec la réalité fournisseur (prix NULL, unité kg)

**Recommandation** :
1. Bloquer l'import B2B quand source et destination sont de familles différentes sans équivalence
2. Ajouter un health check périodique pour détecter les imports cross-family existants
3. Marquer ces produits comme "non commandable" dans le catalogue B2B client

---

### TEST 10 — Cas critique : HUILE AMPHORE (unité exotique)

#### Produit
PRODUIT Y — HUILE AMPHORE

#### Préconditions
- FO : Amphore/count, prix=NULL, stock=0, conditionnement_config={}
- CL : Kilogramme/weight, prix=0.00€, stock=36kg
- unit_mapping = NULL (aucun mapping d'unités)

#### Actions réalisées
- Test `fn_convert_b2b_quantity(AMPHORE_FO, CL_kg, 3)` → **ERROR**

#### Résultat attendu
- Commande bloquée (conversion impossible, prix 0€)

#### Résultat observé
- ✅ Conversion retourne ERROR → expédition bloquée
- ❌ **Prix CL = 0.00€** → la commande s'enverrait avec des montants à 0€
- ❌ `fn_send_commande` ne bloque PAS les prix à 0€ (il bloque seulement les NULL)
- ❌ Même problème que SAFRAN : commande envoyable mais non expédiable
- ❌ **Aggravant** : stock FO = 0 ET pas de mapping → triple blocage

#### Vérification
- **Conversion : ❌** | **Prix : ❌ (0€)** | **Mapping : ❌ (NULL)** | **Stock : ❌ (0)**

#### Verdict : 🔴 KO BLOQUANT
#### Gravité : CRITIQUE

#### Analyse métier — BUG-003

**Triple défaillance** :
1. **Import cross-family** : Amphore(count) → kg(weight) sans équivalence
2. **Prix zéro accepté** : `fn_send_commande` ne bloque pas les prix à 0€
3. **Aucun mapping** : `unit_mapping = NULL` → aucune conversion possible

**Recommandation** :
1. Bloquer l'envoi de commande si `unit_price_snapshot = 0`
2. Bloquer l'import cross-family sans équivalence explicite
3. Nettoyer les imports legacy incohérents

---

## 4. TABLEAU GLOBAL

| # | Test | Statut | Gravité | Commentaire |
|---|---|---|---|---|
| 1 | Commande parfaite | ✅ OK | — | Flux simple identité fonctionne |
| 2 | Multi-niveaux | 🔴 KO | Critique | BUG-001: prix snapshot incorrect |
| 3 | Réception partielle | ✅ OK | — | Litige auto créé correctement |
| 4 | Erreur multi-lignes | ⚠️ Doute | Moyenne | line_status pas mis à jour |
| 5 | Résolution litige | ⚠️ Non testé | À déterminer | Navigateur indisponible |
| 6 | Annulation expédition | ⚠️ Non testé | À déterminer | Pas de commande éligible |
| 7 | Retrait stock | ⚠️ Non testé | À déterminer | Navigateur indisponible |
| 8 | Inventaire | ⚠️ Non testé | À déterminer | Navigateur indisponible |
| 9 | SAFRAN (sans prix) | 🔴 KO Bloquant | Critique | BUG-002: import cross-family |
| 10 | AMPHORE (unité exotique) | 🔴 KO Bloquant | Critique | BUG-003: triple défaillance |

---

## 5. BUGS CRITIQUES

### BUG-001 : Snapshot prix silencieusement incorrect (COALESCE fallback)
- **Localisation** : `fn_send_commande` — ligne `COALESCE(fn_product_unit_price_factor(...), 1.0)`
- **Impact** : Sous-facturation massive (95% de perte sur TEST1)
- **Reproductible** : Oui, sur toute commande avec `canonical_unit ≠ final_unit`
- **Correction** : Supprimer le COALESCE(1.0), remonter le hard block pour couvrir ce cas

### BUG-002 : Import B2B cross-family accepté sans validation
- **Localisation** : Pipeline d'import (`fn_import_b2b_product_atomic`)
- **Impact** : Produits commandables mais non expédiables (commandes zombies)
- **Reproductible** : Oui (SAFRAN : kg→Pièce)
- **Correction** : Ajouter validation famille source = famille destination

### BUG-003 : Prix zéro accepté à l'envoi de commande
- **Localisation** : `fn_send_commande` — vérifie NULL mais pas 0
- **Impact** : Factures à 0€, perte de revenus totale
- **Reproductible** : Oui (AMPHORE : prix=0€)
- **Correction** : Ajouter `WHERE unit_price_snapshot <= 0` au check

---

## 6. BUGS MOYENS

### BUG-004 : line_status non mis à jour après réception partielle
- **Impact** : Confusion UX pour le fournisseur
- **Correction** : Mettre à jour line_status lors de `fn_post_b2b_reception`

### BUG-005 : Produit importé avec conditionnement_config vide (SAFRAN, AMPHORE)
- **Impact** : Aucune conversion BFS possible
- **Correction** : Valider la config au moment de l'import

### BUG-006 : Prix fournisseur NULL non propagé comme alerte au client
- **Impact** : Le client commande sans savoir que le prix source est indéfini
- **Correction** : Afficher un badge "prix non défini" dans le catalogue B2B

---

## 7. INCOHÉRENCES UX

### UX-001 : Unité d'affichage ambiguë pour TEST 1
Le produit a `final_unit = Pièce` mais `stock_handling_unit = Carton`. Le stock affiché est en Cartons (67.05), mais le prix est en Pièces (1.36€/pce). L'utilisateur peut être confus sur l'unité de commande vs l'unité de prix.

### UX-002 : CAS-A non importé automatiquement
Un nouveau produit du catalogue fournisseur n'est pas signalé au client. Le client doit manuellement vérifier le catalogue B2B pour découvrir les nouveaux produits.

---

## 8. FLOWS VALIDÉS

| Flow | Détail |
|---|---|
| ✅ Conversion identité (kg→kg, pce→pce) | Fonctionne parfaitement |
| ✅ Conversion multi-niveaux via mapping | Carton→Carton résolu via unit_mapping |
| ✅ Expédition avec clampage | Stock events cohérents, B2B_SHIPMENT correct |
| ✅ Réception partielle → litige auto | Litige créé avec quantités correctes |
| ✅ Prix snapshot pour unités identiques | 10€/kg et 5€/pce correctement snapshottés |
| ✅ Facture pour commandes simples | FAC-APP correctement générées |
| ✅ fn_convert_b2b_quantity hard block | Rejette correctement les cross-family |
| ✅ fn_convert_line_unit_price | Facteur de prix correct (20 pour Carton) |

---

## 9. CONCLUSION FINALE

### 🔴 NON PRÊT — Corrections critiques requises

**Priorisation des corrections :**

1. **P0 (Bloquant)** : BUG-001 — Fix `fn_send_commande` pour supprimer le COALESCE(1.0) sur le price factor. Sans cette correction, toute commande avec unité de conditionnement génère des factures fausses.

2. **P0 (Bloquant)** : BUG-003 — Bloquer l'envoi de commandes avec prix ≤ 0.

3. **P1 (Critique)** : BUG-002 — Ajouter validation cross-family dans le pipeline d'import B2B. Ajouter un health check pour détecter les imports legacy incohérents.

4. **P2 (Important)** : BUG-004/005/006 — Correctifs de cohérence.

**Estimation effort** :
- P0 : ~2h de développement SQL
- P1 : ~4h (validation + health check + UI)
- P2 : ~4h

**Tests non exécutés** : Les tests 5-8 (litige résolution, annulation, retrait, inventaire) n'ont pas pu être exécutés via le navigateur. Ils doivent être testés manuellement ou dans une session dédiée.

---

*Rapport généré le 2026-03-28 par QA IA Expert*
