# AUDIT FINAL — PREUVE OU RÉFUTATION DE LA COHÉRENCE DU SYSTÈME

**Date** : 2026-03-26  
**Méthode** : Analyse code déployé + requêtes production  
**Périmètre** : B2B commandes + stock + litiges + inventaire + facturation + commandes_plats

---

## PARTIE 1 — AUDIT PAR CHAÎNES FERMÉES

### CHAÎNE 1 : Commande → Expédition → Stock fournisseur → Sync → Commande

**Fonction déployée** : `fn_ship_commande` (migration `20260319201217`)

| Étape | Action | Table | Unité |
|-------|--------|-------|-------|
| Step 1 | Écriture `shipped_quantity` = LEAST(input, ordered) | `commande_lines` | **CLIENT** ✅ |
| Step 5 (temp) | `_ship_lines` = JOIN `b2b_imported_products` + `fn_convert_b2b_quantity` | temp table | supplier_quantity = **FOURNISSEUR** |
| Step 5d | `stock_document_lines` = -supplier_quantity | `stock_document_lines` | **FOURNISSEUR** ✅ |
| Step 5e | `stock_events` = clamped(-supplier_quantity) | `stock_events` | **FOURNISSEUR** ✅ |
| Step 5f | SYNC: `shipped_quantity = ABS(stock_event.delta)` | `commande_lines` | **🔴 FOURNISSEUR — ÉCRASEMENT** |

#### 🔴 BUG-CRITIQUE-1 : Step 5f écrase shipped_quantity en unité fournisseur

**Preuve production** — SERVIETTE TABLE (CMD-000053) :
- Commandé : 800 Pièces (client)
- Step 1 écrit : shipped_quantity = 800 Pièces (client) ✅
- fn_convert_b2b_quantity : 800 Pièces → 1 Paquet (fournisseur)
- stock_event.delta = -1.0000 (Pièce fournisseur — même nom, UUID différent)
- Step 5f sync : `shipped_quantity = ABS(-1) = 1.0000`
- **Résultat** : shipped_quantity = 1.0000 dans colonne annotée "Pièce client" mais valeur = 1 Paquet fournisseur

**Impact cascade** :
- Réception compare `shipped_quantity(1)` vs `received_quantity` → faux litige
- Facturation utilise `received_quantity` basée sur `shipped_quantity` corrompu → montant faux
- Litige calcule `delta = shipped(1) - received(X)` → ajustement stock absurde

#### 🔴 BUG-CRITIQUE-2 : Pas de DISTINCT ON dans _ship_lines

Le `JOIN b2b_imported_products` ne comporte pas de `DISTINCT ON (cl.id)`.

**Preuve production** — MASCARPONE GRANAROLO :
- 2 entrées BIP pour le même `local_product_id` (source_product différents) :
  - `52020c2e` → MASCARPONE GRANAROLO
  - `1f68f271` → MASCARPONE GRANAROLO
- Résultat : Cartesian product → 2 lignes dans `_ship_lines` pour 1 `commande_line`
- Step 5e tente 2 écritures stock → l'une est possiblement sans stock → rupture fantôme
- **Preuve** : MASCARPONE est en `rupture` avec `shipped_quantity=0` MAIS stock_event = -18

#### ⚠️ DIVERGENCE STRUCTURELLE : stock_document_lines ≠ stock_events

**Preuve** : 15 documents POSTED montrent une divergence entre `stock_document_lines.total` et `stock_events.total`.

Exemples :
| Document | doc_lines_total | events_total | Divergence |
|----------|----------------|--------------|-----------|
| `bee21986` (CMD-000053 zone) | -920 | -121 | **799** |
| `0bded6d0` (CMD-000053 zone) | -330.85 | -202.85 | **128** |

**Cause** : `stock_document_lines` (step 5d) écrit la quantité demandée, `stock_events` (step 5e) écrit la quantité clampée. Le document ne reflète pas la réalité du mouvement.

#### ❓ Incohérence possible ?  → **OUI** 🔴
#### ❓ Double écriture ?       → **OUI** (step 1 + step 5f) 🔴
#### ❓ Perte d'information ?   → **OUI** (shipped_quantity original client perdue) 🔴
#### ❓ Divergence tables ?     → **OUI** (doc_lines ≠ events) 🔴

---

### CHAÎNE 2 : Commande → Réception → Stock client

**Fonction déployée** : `fn_receive_commande` (migration `20260305153303`)

| Étape | Action | Table | Unité |
|-------|--------|-------|-------|
| Écriture received_quantity | Depuis frontend input | `commande_lines` | **CLIENT** ✅ |
| _recv_lines | JOIN products_v2 (client) | temp | CLIENT ✅ |
| stock_document_lines | received_qty en unité client | `stock_document_lines` | **CLIENT** ✅ |
| fn_post_stock_document | stock_events via moteur central | `stock_events` | **CLIENT** ✅ |
| Écart detection | Compare shipped vs received | logic | **🔴 CORROMPU si BUG-1** |

**Verdict** : L'écriture stock client est correcte (unité client, via moteur central). MAIS la détection d'écart compare `shipped_quantity` (potentiellement corrompu par BUG-1) avec `received_quantity` → peut créer un **faux litige** ou **manquer un vrai écart**.

#### ❓ Incohérence possible ?  → **OUI** (si shipped corrompu) 🔴

---

### CHAÎNE 3 : Expédition → Réception → Litige → Ajustement stock fournisseur

**Fonction déployée** : `fn_resolve_litige` (migration `20260321061136`)

| Étape | Action | Source | Unité |
|-------|--------|--------|-------|
| `litige_lines.shipped_quantity` | Copié depuis `commande_lines.shipped_quantity` | `fn_receive_commande` | **🔴 POTENTIELLEMENT CORROMPU** |
| delta = shipped - received | Calcul écart | en mémoire | **🔴 SI shipped corrompu → delta faux** |
| fn_convert_b2b_quantity(ABS(delta)) | Conversion vers fournisseur | RPC | FOURNISSEUR ✅ |
| stock_document_lines | delta_sign * supplier_abs_quantity | `stock_document_lines` | FOURNISSEUR ✅ |
| fn_post_stock_document | Moteur central avec clamp | `stock_events` | FOURNISSEUR ✅ |

**Scénario cascade** :
1. SERVIETTE : shipped_quantity corrompu = 1 (devrait être 800)
2. received_quantity = 800 (réel)
3. litige_lines.shipped = 1, received = 800
4. delta = 1 - 800 = -799 → surplus massif
5. stock fournisseur débité de 799 unités → **CATASTROPHE**

**Pas de DISTINCT ON** dans le JOIN `b2b_imported_products` → même risque Cartesian.

#### ❓ Incohérence possible ?  → **OUI** 🔴
#### ❓ Double débit stock ?    → **OUI** (expédition + litige surplus) 🔴

---

### CHAÎNE 4 : Stock → Inventaire → Snapshot → Nouveau stock

| Étape | Action | Intégrité |
|-------|--------|-----------|
| Inventory session | Compte physique | ✅ |
| inventory_lines | Snapshot immutable | ✅ |
| zone_stock_snapshots | Nouveau snapshot_version_id | ✅ |
| Stock = snapshot + Σevents | Formule SSOT | ✅ |
| Filtrage canonical_family | Isolation famille | ✅ |

**Verdict** : ✅ PROUVÉ CORRECT. Le moteur d'inventaire est isolé, immutable, et la formule SSOT est cohérente.

#### ❓ Incohérence possible ?  → **NON** ✅

---

### CHAÎNE 5 : Commande → Réception → Facturation

**Fonction** : `fn_generate_app_invoice`

| Donnée facturée | Source | Fiabilité |
|-----------------|--------|-----------|
| `received_quantity` | `commande_lines` | ✅ (écrit par frontend) |
| `unit_price_snapshot` | `commande_lines` (écrit à l'envoi) | ✅ |
| Exclusion ruptures | `WHERE line_status != 'rupture'` | **🔴 SI rupture fantôme → perte revenu** |

**Verdict** : Les montants facturés sont corrects SI `received_quantity` est fiable. MAIS les lignes en rupture fantôme (MASCARPONE : rupture avec stock débité) sont exclues de la facturation → **perte de revenu fournisseur**.

#### ❓ Incohérence possible ?  → **OUI** (ruptures fantômes) 🟡

---

### CHAÎNE 6 : Void → Annulation → Stock

**Fonction** : `fn_void_stock_document` (migration `20260318200516`)

| Étape | Action | Intégrité |
|-------|--------|-----------|
| Vérification POSTED | Bloque si pas POSTED | ✅ |
| Clamp inverse | GREATEST(void_delta, -current_stock) | ✅ |
| VOID events | Avec voids_event_id, voids_document_id | ✅ (traçabilité) |
| Pas de mise à jour commande | N/A | ⚠️ (commande reste 'expediee') |

**Verdict** : ✅ Le void est correct techniquement. MAIS il ne corrige pas les données corrompues dans `commande_lines` (shipped_quantity, line_status).

---

## PARTIE 2 — TRAÇAGE D'UNE DONNÉE UNIQUE

### Produit : SERVIETTE TABLE — CMD-000053

| Étape | Fonction | Table.colonne | Valeur | Unité |
|-------|----------|---------------|--------|-------|
| Création | fn_send_commande | commande_lines.canonical_quantity | 800 | Pièce client |
| Expédition Step 1 | fn_ship_commande | commande_lines.shipped_quantity | 800 | Pièce client ✅ |
| Conversion | fn_convert_b2b_quantity | _ship_lines.supplier_quantity | 1 | Paquet fournisseur |
| Stock doc | fn_ship_commande 5d | stock_document_lines.delta | -1 | Pièce fournisseur |
| Stock event | fn_ship_commande 5e | stock_events.delta | -1.0000 | Pièce fournisseur |
| **SYNC 5f** | fn_ship_commande | **commande_lines.shipped_quantity** | **1.0000** | **🔴 Pièce fournisseur écrit dans colonne client** |
| Réception | fn_receive_commande | commande_lines.received_quantity | ? | Pièce client |
| Litige | fn_receive_commande | litige_lines.shipped_quantity | 1.0000 | 🔴 CORROMPU |

**Conclusion** : La donnée `shipped_quantity` change de référentiel à l'étape 5f sans back-conversion. **FAIL**.

---

## PARTIE 3 — STOCK : PREUVE ABSOLUE

### ✅ Pas de stock négatif actuel
```sql
-- 0 rows returned
SELECT ... WHERE current_stock < 0;
```

### 🔴 Duplicate stock_events confirmés
10 documents avec des `context_hash` dupliqués (ex: document `042d9be2` a 5 events avec le même hash).

**Cause probable** : Cartesian product BIP dans `_ship_lines` → INSERT INTO stock_events produit des doublons.

### 🔴 stock_document_lines ≠ stock_events sur 15 documents
La quantité demandée (doc_lines) diverge de la quantité effective (events) à cause du clamp inline.

### Rejouabilité
**❓ Si je rejoue tout depuis zéro avec les mêmes inputs, j'obtiens le même stock ?**

**NON** → Le clamp dépend du stock courant au moment de l'exécution. Si les commandes sont rejouées dans un ordre différent, les clamps seront différents → stock final différent.

**MAIS** ceci est un comportement attendu (le clamp est une protection, pas un calcul déterministe). Le problème réel est que le clamp produit une divergence document ↔ événement non réconciliable.

---

## PARTIE 4 — ISOLATION DES FLOWS

| Question | Réponse |
|----------|---------|
| Un flow peut-il casser un autre ? | **OUI** — expédition corrompt shipped_quantity → réception détecte faux écart → litige créé à tort → ajustement stock faux |
| Réception casse litige ? | **OUI** — si shipped_quantity corrompu, litige_lines.shipped copie la corruption |
| Litige casse stock ? | **OUI** — delta basé sur shipped corrompu → débit/crédit stock faux |
| Inventaire masque bug ? | **NON** — l'inventaire est isolé, mais les events corrompus persistent dans le ledger |

---

## PARTIE 5 — CAS DESTRUCTION

### Cas 1 : Doublons BIP
**CASSÉ** ✅ — MASCARPONE : 2 BIP → Cartesian → rupture fantôme + stock débité

### Cas 2 : Conversion avec clamp
**CASSÉ** ✅ — SERVIETTE : conversion OK, mais sync 5f réécrit en unité fournisseur

### Cas 3 : Stock insuffisant
**OK** ✅ — Clamp fonctionne. Mais divergence doc_lines vs events.

### Cas 4 : Réception après rupture fantôme
**CASSÉ** ✅ — Client reçoit le produit (stock débité côté fournisseur) mais ligne = rupture → pas de received_quantity → pas facturé

### Cas 5 : Litige sur données corrompues
**CASSÉ** ✅ — Delta calculé sur shipped_quantity corrompu → ajustement absurde

### Cas 6 : Void après corruption
**PARTIEL** ⚠️ — Void annule les stock_events mais ne corrige pas commande_lines

---

## PARTIE 6 — FRONTEND

**Frontend `shipCommande`** envoie :
```json
{ "commande_id": "...", "lines": [{ "line_id": "...", "shipped_quantity": N, "line_status": "ok|modifie|rupture" }] }
```

- `shipped_quantity` est en **unité client** ✅
- Pas de validation backend de la cohérence line_status ↔ quantity (ex: `line_status=ok` avec `shipped_quantity=0` serait rejeté par Step 3 ✅)
- Le frontend ne contrôle pas que la saisie est ≤ ordered → le backend le fait (Step 1 LEAST) ✅

---

## PARTIE 7 — ZONES AUDITÉES

| Zone | Auditée ? | Verdict |
|------|-----------|---------|
| fn_ship_commande | ✅ OUI | 🔴 3 bugs critiques |
| fn_receive_commande | ✅ OUI | 🟡 Dépend de shipped_quantity |
| fn_resolve_litige | ✅ OUI | 🔴 Cascade corruption + pas de DISTINCT ON |
| fn_post_b2b_reception | ✅ OUI | ✅ Strict (RAISE si family manquante) |
| fn_void_stock_document | ✅ OUI | ✅ Correct (clamp inverse) |
| fn_convert_b2b_quantity | ✅ OUI | ✅ V4.2 DIVISION correcte |
| fn_post_stock_document | ⚠️ INDIRECT | ✅ Utilisé par receive et resolve |
| fn_ship_commande_plat | ✅ OUI | 🟡 Pas de stock, pas de validation qty |
| Imports B2B | ✅ OUI | 🔴 Pas de UNIQUE constraint |
| Inventaire | ✅ OUI | ✅ Correct et isolé |
| Facturation | ✅ OUI | 🟡 Correcte mais perte revenu si rupture fantôme |
| Frontend ship | ✅ OUI | ✅ Envoi correct en unité client |

---

## PARTIE 8 — SOURCE DE VÉRITÉ UNIQUE

| Donnée | Source unique ? | Écrivains | Verdict |
|--------|---------------|-----------|---------|
| shipped_quantity | **NON** | Step 1 (client) + Step 5f (fournisseur) | 🔴 FAIL |
| received_quantity | OUI | fn_receive_commande | ✅ |
| stock réel | OUI | Σ stock_events | ✅ |
| stock affiché | OUI | snapshot + Σevents | ✅ |
| stock_document_lines | OUI | fn_ship_commande 5d | 🔴 Diverge de events |
| line_status | **NON** | Step 1 (frontend) + Step 5f (sync) | 🔴 FAIL |
| quantité facturée | OUI | received_quantity | ✅ |
| litige delta | NON | Calculé depuis shipped (corrompu) | 🔴 FAIL |

---

## PARTIE 9 — VERDICT FINAL

### 🔴 FAIL

Le système n'est **PAS correct**. Voici les incohérences prouvées :

#### Bugs critiques confirmés avec preuves production :

1. **BUG-CRITIQUE-1** : `fn_ship_commande` Step 5f écrase `shipped_quantity` avec la quantité fournisseur (après conversion) sans back-conversion vers l'unité client. Preuve : SERVIETTE TABLE CMD-000053 (800 → 1.0000).

2. **BUG-CRITIQUE-2** : Absence de `DISTINCT ON` dans `_ship_lines` (fn_ship_commande) et `_litige_adj_lines` (fn_resolve_litige). Cause des ruptures fantômes avec BIP duplicates. Preuve : MASCARPONE CMD-000053 (rupture avec stock_event = -18).

3. **BUG-CRITIQUE-3** : `stock_document_lines` diverge systématiquement de `stock_events` sur les documents d'expédition (15 documents vérifiés, divergences de 1 à 799 unités).

4. **BUG-CRITIQUE-4** : Duplicate `stock_events` (même document, même context_hash) causés par le Cartesian product BIP.

5. **BUG-CRITIQUE-5** : 2 doublons BIP actifs en production (MASCARPONE, Lait Demi Ecreme) sans contrainte UNIQUE empêchant leur réapparition.

6. **BUG-CASCADE** : La corruption de `shipped_quantity` se propage dans :
   - `litige_lines.shipped_quantity` (copié tel quel)
   - `fn_resolve_litige` delta (shipped - received = valeur absurde)
   - Ajustement stock fournisseur (débit/crédit basé sur delta corrompu)
   - Facturation (lignes en rupture fantôme exclues = perte revenu)

#### Système commandes_plats :
- `fn_ship_commande_plat` : Aucune intégration stock, aucune validation quantité côté serveur. Pas de bug de corruption (pas de stock) mais pas de protection non plus.

#### Ce qui fonctionne ✅ :
- Moteur d'inventaire (snapshot + events)
- fn_post_stock_document (clamp universel)
- fn_void_stock_document (annulation clampée)
- fn_convert_b2b_quantity V4.2 (division correcte)
- fn_post_b2b_reception (validation stricte family)
- Frontend : envoi correct en unité client
- Pas de stock négatif actuel en production (0 rows)

---

### INVARIANTS À RESPECTER AVANT REFONTE

1. **1 donnée = 1 écriture** → shipped_quantity ne doit être écrit qu'UNE FOIS, en unité CLIENT
2. **1 action = 1 écriture stock** → stock_document_lines doit refléter le mouvement effectif (post-clamp)
3. **DISTINCT ON obligatoire** → Tout JOIN sur b2b_imported_products DOIT utiliser DISTINCT ON
4. **UNIQUE constraint BIP** → `(local_product_id, establishment_id, source_establishment_id)` 
5. **Pas de back-conversion silencieuse** → Si sync nécessaire, convertir supplier→client explicitement
6. **stock_document_lines = stock_events** → Le document doit être mis à jour post-clamp

---

*Aucune correction n'a été proposée. Ce document est un constat factuel.*
