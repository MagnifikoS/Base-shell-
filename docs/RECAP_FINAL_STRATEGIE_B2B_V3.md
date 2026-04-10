# 🔴 RÉCAPITULATIF FINAL — Stratégie B2B / Stock / Commandes V3

**Date** : 2026-03-26  
**Statut** : Document de référence AVANT implémentation  
**Versions précédentes** : V1 (design initial), V2 (corrections critiques), V3 (simplification terrain)

---

## TABLE DES MATIÈRES

1. [Synthèse exécutive](#1-synthèse-exécutive)
2. [Catalogue complet des bugs et incohérences](#2-catalogue-complet-des-bugs-et-incohérences)
3. [Règles métier terrain (V3)](#3-règles-métier-terrain-v3)
4. [Architecture cible finale](#4-architecture-cible-finale)
5. [Flows corrigés (V3)](#5-flows-corrigés-v3)
6. [Invariants système](#6-invariants-système)
7. [Plan d'implémentation par étapes](#7-plan-dimplémentation-par-étapes)
8. [Plan de test](#8-plan-de-test)
9. [Verdict final et risques résiduels](#9-verdict-final-et-risques-résiduels)

---

## 1. SYNTHÈSE EXÉCUTIVE

### Le problème

Le système B2B actuel (commandes, expédition, réception, litiges, stock, facturation) est **structurellement incohérent** (FAIL). Les bugs ne sont pas des erreurs isolées mais des conséquences d'une architecture qui viole les principes fondamentaux de cohérence des données.

### La stratégie

**On ne patche PAS les bugs un par un.** On remplace l'architecture par un design cible propre, déterministe et auditable, en **8 étapes d'implémentation** séquentielles et rollbackables.

### Le résultat attendu

Un système où :
- Le stock n'est **JAMAIS négatif** (ni en base, ni temporairement)
- Chaque donnée a **UNE seule source de vérité**
- Chaque champ est écrit **UNE seule fois**
- Le système est **100% déterministe** (même inputs → même outputs)
- **Aucune sync corrective** n'existe
- **Tout mouvement stock** est traçable jusqu'à sa ligne de commande d'origine

---

## 2. CATALOGUE COMPLET DES BUGS ET INCOHÉRENCES

### 🔴 BUG-01 — Double écriture et corruption de `shipped_quantity`

**Sévérité** : CRITIQUE  
**Impact** : Corrompt réception, litiges, facturation, et stock

**Description** : `fn_ship_commande` écrit `shipped_quantity` deux fois :
1. **Étape 1** : Écrit `shipped_quantity = input fournisseur` (unité CLIENT) ✅
2. **Étape 5f (sync)** : Réécrit `shipped_quantity = effective_qty` (unité FOURNISSEUR) ❌

**Exemple concret** :
- Client commande 800 Pièces
- Fournisseur expédie 1 Paquet (= 800 Pièces)
- Step 5f écrase : `shipped_quantity = 1` (au lieu de 800)
- Le client reçoit : "on vous a expédié 1" au lieu de "800"

**Effet cascade** :
- Réception : comparaison `800 reçu vs 1 expédié` → litige fantôme
- Litige : delta = `1 - 800 = -799` → ajustement stock aberrant
- Facturation : montant basé sur données corrompues

---

### 🔴 BUG-02 — Ruptures fantômes (produit cartésien BIP)

**Sévérité** : CRITIQUE  
**Impact** : Perte de revenus fournisseur, stock débité sans trace

**Description** : Les JOINs sur `b2b_imported_products` (BIP) n'ont pas de `DISTINCT ON`. Quand un produit a 2 entrées BIP (doublons), la jointure crée un produit cartésien : 1 ligne de commande → 2 lignes de stock.

**Effet** : Le stock est débité 2× mais `shipped_quantity` n'est écrite qu'une fois. La 2e ligne est marquée "rupture" car le stock est épuisé par le 1er débit.

**Données observées** : Taux de rupture indus de 20-63% sur certaines commandes.

---

### 🔴 BUG-03 — Bypass du moteur stock central

**Sévérité** : CRITIQUE  
**Impact** : Divergence ledger, stocks négatifs

**Description** : `fn_ship_commande` écrit directement dans `stock_events` et `stock_document_lines` au lieu de passer par `fn_post_stock_document`. Le clampage "inline" diverge du moteur central.

**Conséquences mesurées** :
- **20 documents divergents** : `stock_document_lines ≠ stock_events` (quantités pre-clamp vs post-clamp)
- **60 soldes négatifs** en production
- Le moteur central gère le bootstrap snapshot — le bypass le saute parfois

---

### 🔴 BUG-04 — Litiges corrompus → double débit fournisseur

**Sévérité** : CRITIQUE  
**Impact** : Destruction de stock fournisseur

**Description** : Les litiges calculent `delta = shipped_quantity - received_quantity`. Comme `shipped_quantity` est corrompue (BUG-01), le delta est faux. La résolution du litige crée un mouvement stock basé sur un delta erroné → 2e débit injustifié du stock fournisseur.

---

### 🟠 BUG-05 — Facturation exclut les ruptures fantômes

**Sévérité** : HAUTE  
**Impact** : Perte de revenus fournisseur

**Description** : `fn_generate_app_invoice` filtre avec `WHERE line_status != 'rupture'`. Les ruptures fantômes (BUG-02) sont exclues de la facture alors que le produit a été réellement expédié et reçu.

---

### 🟠 BUG-06 — JOINs non déterministes

**Sévérité** : HAUTE  
**Impact** : Résultats non reproductibles

**Description** : Plusieurs fonctions utilisent `LIMIT 1` sans `ORDER BY` ou des JOINs sans `DISTINCT ON` sur les tables BIP. À données identiques, le résultat peut varier selon l'ordre physique des lignes en base.

**Fonctions impactées** :
- `fn_ship_commande` (temp `_ship_lines`)
- `fn_resolve_litige` (temp `_litige_adj_lines`)
- `fn_convert_b2b_quantity` (`LIMIT 1`)

---

### 🟠 BUG-07 — Mélange de référentiels d'unités

**Sévérité** : HAUTE  
**Impact** : Toute comparaison ou calcul basé sur `commande_lines` est potentiellement faux

**Description** : `commande_lines` devrait ne contenir QUE des valeurs en unité CLIENT. Après step 5f, `shipped_quantity` contient des valeurs en unité FOURNISSEUR. Les comparaisons `shipped vs received` comparent donc des Paquets avec des Pièces.

---

### 🟡 BUG-08 — Divergence stock_document_lines vs stock_events

**Sévérité** : MOYENNE  
**Impact** : Audit impossible, rapports incohérents

**Description** : Le bypass inline (BUG-03) écrit dans `stock_document_lines` la quantité **demandée** (pre-clamp) mais dans `stock_events` la quantité **effective** (post-clamp). Résultat : `SUM(doc_lines) ≠ SUM(events)` pour 20 documents.

---

### 🟡 BUG-09 — Absence de traçabilité ligne-par-ligne

**Sévérité** : MOYENNE  
**Impact** : Impossible d'auditer quel stock_event correspond à quelle commande_line

**Description** : `stock_documents` a un `source_order_id` (commande globale), mais `stock_document_lines` n'a pas de `source_line_id`. Pour une commande de 10 produits, on ne peut pas savoir quel stock_event correspond à quel produit commandé.

---

### 🟡 BUG-10 — Pas d'idempotence

**Sévérité** : MOYENNE  
**Impact** : Double mouvement stock en cas de retry réseau

**Description** : Si `fn_ship_commande` est appelée deux fois (retry réseau, double clic), le stock est débité deux fois. Pas de mécanisme `idempotency_key` ni de vérification de pré-existence.

---

### 🟡 BUG-11 — Pas de gestion de concurrence

**Sévérité** : MOYENNE  
**Impact** : Corruption en cas d'utilisation simultanée

**Description** : Deux utilisateurs qui expédient la même commande en même temps peuvent créer deux mouvements stock. Pas de `SELECT ... FOR UPDATE` ni de lock.

---

## 3. RÈGLES MÉTIER TERRAIN (V3)

Ces règles simplifient le design V2 en intégrant les contraintes opérationnelles réelles.

### 🔴 RÈGLE 1 — Stock JAMAIS négatif (ABSOLU)

Le stock ne doit **JAMAIS** être négatif : ni en base, ni en calcul, ni temporairement.

| Situation | Stock | Demande | Résultat |
|-----------|:-----:|:-------:|----------|
| Stock suffisant | 10 | 5 | stock_event = -5, stock final = 5 |
| Stock insuffisant | 3 | 5 | stock_event = -3, stock final = 0 (clamp) |
| Stock à zéro | 0 | 5 | **PAS de stock_event**, effective_qty = 0 |
| Erreur humaine (retrait) | 0 | 5 | Ignoré. stock = 0. PAS de -5 |

**Interdictions absolues** :
- ❌ Jamais de stock négatif (-5)
- ❌ Jamais de compensation future (-5 + 10 = 5)
- ❌ Jamais de mémoire d'un négatif
- ❌ Jamais de dette stock invisible

### 🔴 RÈGLE 2 — Stock = réalité physique uniquement

Si un produit est physiquement présent mais non saisi → le système ne crée PAS de dette invisible.
- Pas de backlog négatif
- Pas de correction automatique
- Pas de compensation implicite

### 🔴 RÈGLE 3 — 1 Produit = 1 Zone (simplification V1)

Un produit appartient à **UNE seule zone** de stockage.

**Conséquences** :
- 1 commande_line → **1 stock_event max**
- Pas de multi-zone
- Pas d'agrégation cross-zone
- Pas de SUM multi-source
- Idempotency key simplifiée : `ship:{commande_id}` (pas de suffix zone)

---

## 4. ARCHITECTURE CIBLE FINALE

### 4.1 Trois règles absolues

| # | Règle | Conséquence |
|---|-------|-------------|
| R1 | **ZÉRO SYNC** | Aucune réécriture corrective. Chaque champ écrit UNE FOIS |
| R2 | **STOCK = VÉRITÉ** | `stock_events` (ledger) = seule source de vérité physique |
| R3 | **INTENTION ≠ RÉALITÉ** | Saisie fournisseur ≠ stock réellement sorti |

### 4.2 Moment de vérité

> Le moment de vérité de l'expédition = **stock_document POSTED** par `fn_post_stock_document`

Pas la saisie fournisseur. Pas l'écriture dans commande_lines. Le stock **réellement sorti** est la seule réalité.

### 4.3 Référentiels d'unité — Règle de fer

| Table | Référentiel | JAMAIS |
|-------|-------------|-------|
| `commande_lines` | CLIENT | ❌ Jamais de valeur fournisseur |
| `stock_events` (fournisseur) | FOURNISSEUR | ❌ Jamais de valeur client |
| `stock_events` (client) | CLIENT | ❌ Jamais de valeur fournisseur |
| `litige_lines` | CLIENT | ❌ Jamais de valeur fournisseur |
| `app_invoice_lines` | CLIENT | ❌ Jamais de valeur fournisseur |

### 4.4 Pipeline unique

**TOUT** mouvement de stock passe par `fn_post_stock_document`.

- ❌ Jamais d'écriture directe dans `stock_events`
- ❌ Jamais de clamp inline
- ❌ Jamais de bypass

### 4.5 Séparation des responsabilités

| Composant | Fait | Ne fait PAS |
|-----------|------|-------------|
| `fn_ship_commande` | Écriture shipped_qty (CLIENT), orchestre le flow | N'écrit PAS dans stock_events |
| `fn_post_stock_document` | Clamp, écriture stock_events + doc_lines | Ne connaît PAS les commandes |
| `fn_convert_b2b_quantity` | Conversion CLIENT → FOURNISSEUR | Aucune écriture |
| `fn_convert_b2b_quantity_reverse` | Conversion FOURNISSEUR → CLIENT | Aucune écriture |
| `fn_receive_commande` | Écriture received_qty, stock client | Ne touche PAS stock fournisseur |
| `fn_resolve_litige` | Ajustement stock fournisseur | Ne modifie PAS shipped/received |

### 4.6 Flux logique global

```
COMMANDE (Client)
    │
    ▼
fn_send_commande ─── snapshots prix ──→ commande_lines figées
    │
    ▼
fn_open_commande (Fournisseur) ── accusé réception
    │
    ▼
fn_ship_commande (Fournisseur)
    ├── 1. Lock (FOR UPDATE)
    ├── 2. Idempotence (ship:{commande_id})
    ├── 3. Valider inputs (CLIENT)
    ├── 4. Résoudre BIP (DISTINCT ON)
    ├── 5. Convertir CLIENT → FOURNISSEUR
    ├── 6. fn_post_stock_document (WITHDRAWAL)
    │   └── Clamp strict: effective = MIN(demandé, dispo), jamais < 0
    │   └── Si effective = 0 → PAS de stock_event
    ├── 7. Lire quantité effective (FOURNISSEUR)
    ├── 8. Back-convertir FOURNISSEUR → CLIENT
    └── 9. Écriture UNIQUE shipped_quantity (CLIENT) + line_status
    │
    ▼
fn_receive_commande (Client)
    ├── Écriture UNIQUE received_quantity (CLIENT)
    ├── fn_post_stock_document (RECEIPT, CLIENT)
    ├── Comparaison received vs shipped (tout en CLIENT)
    └── Si écart → créer litige
    │
    ▼
fn_resolve_litige
    ├── Delta = shipped - received (litige_lines, snapshots CLIENT)
    ├── Convertir → FOURNISSEUR
    ├── fn_post_stock_document (ADJUSTMENT)
    └── Clamp (pas de stock négatif)
    │
    ▼
fn_generate_app_invoice
    ├── WHERE received_quantity > 0 (PAS WHERE line_status != 'rupture')
    └── Montant = received_qty × unit_price_snapshot (tout CLIENT)
```

---

## 5. FLOWS CORRIGÉS (V3)

### 5.a EXPÉDITION — `fn_ship_commande` (V3 simplifié)

| # | Action | Unité | Détail |
|---|--------|-------|--------|
| 1 | **Lock** | — | `SELECT ... FOR UPDATE` sur commande, vérifie `status = 'ouverte'` |
| 2 | **Idempotence** | — | Si `stock_documents WHERE idempotency_key = 'ship:{commande_id}' AND status = 'POSTED'` existe → RETURN |
| 3 | **Valider** | CLIENT | `0 <= shipped_qty <= canonical_quantity` |
| 4 | **Résoudre BIP** | — | `DISTINCT ON (cl.id) ORDER BY bip.imported_at ASC` |
| 5 | **Convertir** | CLIENT → FOUR | `supplier_qty = fn_convert_b2b_quantity(client_qty)` |
| 6 | **fn_post_stock_document** | FOUR | WITHDRAWAL, `source_line_id`, `idempotency_key = 'ship:{commande_id}'` |
| 7 | **Lire effective** | FOUR | `effective = ABS(stock_event.delta)`. Si pas d'event → `effective = 0` |
| 8 | **Back-convertir** | FOUR → CLIENT | `effective_client = fn_convert_b2b_quantity_reverse(effective_supplier)` |
| 9 | **Écriture UNIQUE** | CLIENT | `shipped_quantity = effective_client`. Status dérivé : `= 0` → rupture, `< ordered` → modifie, `= ordered` → ok |
| 10 | **Transition** | — | `status = 'expediee'` |

**Clamp V3** :
- `effective_qty = MIN(requested_qty, stock_available)`
- Si `stock = 0` → `effective_qty = 0` → **PAS de stock_event**
- ❌ Jamais de négatif

**Simplification 1 produit = 1 zone** :
- 1 commande_line → 1 stock_event max (pas de SUM, pas d'agrégation)

### 5.b RÉCEPTION — `fn_receive_commande` (V3)

| # | Action | Unité | Détail |
|---|--------|-------|--------|
| 1 | Lock | — | `FOR UPDATE`, `status = 'expediee'` |
| 2 | Idempotence | — | `idempotency_key = 'recv:{commande_id}'` |
| 3 | Valider | CLIENT | `received_quantity >= 0` |
| 4 | Écrire received_qty | CLIENT | ÉCRITURE UNIQUE |
| 5 | fn_post_stock_document | CLIENT | RECEIPT, stock client augmente |
| 6 | Comparer | CLIENT | `received ≠ shipped` → écart |
| 7 | Créer litige | CLIENT | Snapshots figés dans `litige_lines` |
| 8 | Transition | — | `recue` ou `litige` |

### 5.c LITIGE — `fn_resolve_litige` (V3)

| # | Action | Unité | Détail |
|---|--------|-------|--------|
| 1 | Lock | — | `FOR UPDATE` sur litige + commande |
| 2 | Idempotence | — | `idempotency_key = 'litige_adj:{litige_id}'` |
| 3 | Calculer delta | CLIENT | `delta = shipped - received` (litige_lines snapshots) |
| 4 | Résoudre BIP | — | `DISTINCT ON` + `ORDER BY imported_at` |
| 5 | Convertir delta | CLIENT → FOUR | `fn_convert_b2b_quantity(ABS(delta))` |
| 6 | fn_post_stock_document | FOUR | ADJUSTMENT (clampé, jamais négatif) |
| 7 | Transition | — | `resolved` |

**Direction du delta** :
- `delta > 0` (shipped > received) = MANQUE → fournisseur récupère (+RECEIPT)
- `delta < 0` (received > shipped) = SURPLUS → fournisseur perd (-WITHDRAWAL, clampé)

### 5.d ANNULATION — `cancel_shipment` (V3)

| # | Action | Détail |
|---|--------|--------|
| 1 | Lock | `FOR UPDATE`, vérifie `status = 'expediee'` (avant réception) |
| 2 | fn_void_stock_document | Inverse les stock_events (clampé, pas de négatif) |
| 3 | Reset commande_lines | `shipped_quantity = 0`, `line_status = 'ouverte'` |
| 4 | Transition | `status = 'ouverte'` (re-expédition possible) |

**Note** : Le void marque le stock_document comme VOIDED → l'idempotency check (`WHERE status = 'POSTED'`) passe → re-expédition autorisée.

### 5.e FACTURATION — `fn_generate_app_invoice` (V3)

```sql
-- AVANT (BUGGY) :
WHERE cl.line_status != 'rupture'

-- APRÈS (CORRECT) :
WHERE COALESCE(cl.received_quantity, 0) > 0
```

Montant : `line_total = received_quantity × unit_price_snapshot` (tout CLIENT, cohérent).

### 5.f INVENTAIRE — Inchangé (déjà correct)

Aucun changement. Le module inventaire est isolé et PASS :
- Sessions immutables, `inventory_lines` append-only
- `zone_stock_snapshots` avec `snapshot_version_id`
- Stock = snapshot + Σ(events filtrés)

---

## 6. INVARIANTS SYSTÈME

### 6.1 Invariants de données

| # | Invariant | Vérification |
|---|-----------|-------------|
| INV-01 | `shipped_quantity` TOUJOURS en unité CLIENT | SQL diagnostic |
| INV-02 | `shipped_quantity` écrite 1 SEULE FOIS | Code review |
| INV-03 | `SUM(doc_lines.delta) = SUM(stock_events.delta)` par document POSTED | SQL diagnostic |
| INV-04 | Aucun `stock_event` écrit hors `fn_post_stock_document` | Code review / GREP |
| INV-05 | Aucun stock négatif (`SUM(delta) >= 0` par product/establishment) | SQL diagnostic |
| INV-06 | Aucun doublon BIP | UNIQUE constraint DB |
| INV-07 | Tout JOIN BIP utilise `DISTINCT ON` + `ORDER BY imported_at` | Code review |
| INV-08 | 1 commande = 1 stock_document max (1 prod = 1 zone) | Idempotency key |
| INV-09 | `received_qty × unit_price_snapshot` = montant facturable | SQL diagnostic |
| INV-10 | Facturation par `received_quantity > 0`, PAS par `line_status` | Code review |
| INV-11 | Si `effective_qty = 0` → PAS de stock_event | Moteur central |

### 6.2 Invariants de flow

| # | Invariant | Mécanisme |
|---|-----------|-----------|
| FLOW-01 | Expédition ne corrompt PAS réception | `fn_ship` ne touche pas `received_quantity` |
| FLOW-02 | Réception ne touche PAS stock fournisseur | `fn_receive` écrit stock CLIENT uniquement |
| FLOW-03 | Litige ne modifie PAS shipped/received | `fn_resolve` fait des ajustements stock uniquement |
| FLOW-04 | Inventaire ne masque PAS bugs stock | Snapshot = rebase total |
| FLOW-05 | Void ne modifie PAS commande_lines | Outil stock, pas outil commande |
| FLOW-06 | Aucune opération exécutable 2 fois | `idempotency_key` UNIQUE |

---

## 7. PLAN D'IMPLÉMENTATION PAR ÉTAPES

### Vue d'ensemble : 8 étapes séquentielles

```
Étape 0 — Nettoyage données corrompues (AVANT tout code)
Étape 1 — Modifications schema non-breaking
Étape 2 — Nouvelle fonction fn_convert_b2b_quantity_reverse
Étape 3 — Réécriture fn_ship_commande
Étape 4 — Mise à jour fn_resolve_litige
Étape 5 — Mise à jour fn_generate_app_invoice
Étape 6 — Ajout flow cancel_shipment
Étape 7 — Validation complète + monitoring
```

**Chaque étape est une migration SQL rollbackable indépendamment.**

---

### Étape 0 — Nettoyage données corrompues

**Objectif** : Assainir la base AVANT de déployer le nouveau code.  
**Risque** : FAIBLE (corrections de données, pas de changement de logique)  
**Rollback** : Backup avant exécution

#### 0.a Nettoyer doublons BIP
```sql
-- Supprimer les doublons (garder le plus ancien)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY local_product_id, establishment_id, source_establishment_id 
    ORDER BY imported_at ASC
  ) as rn FROM b2b_imported_products
)
DELETE FROM b2b_imported_products WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

#### 0.b Corriger shipped_quantity corrompues (commandes actives)
- Identifier les commandes en `expediee` ou `litige` avec `shipped_quantity` en unité fournisseur
- Pour chaque : lire le `stock_event` associé → back-convertir → réécrire en unité CLIENT
- **Script manuel, cas par cas, validé avant exécution**

#### 0.c Corriger ruptures fantômes
- Identifier les lignes `rupture` avec un stock_event négatif existant
- Recalculer `shipped_quantity` et `line_status` via back-conversion

#### 0.d Corriger divergences doc_lines vs events
```sql
UPDATE stock_document_lines sdl
SET delta_quantity_canonical = se.delta_quantity_canonical
FROM stock_events se
WHERE se.document_id = sdl.document_id
  AND se.product_id = sdl.product_id
  AND sdl.document_id IN (/* liste des documents divergents */);
```

---

### Étape 1 — Modifications schema (non-breaking)

**Objectif** : Préparer les tables pour le nouveau code.  
**Risque** : TRÈS FAIBLE (ajouts, pas de suppression)  
**Rollback** : `DROP COLUMN` / `DROP CONSTRAINT`

1. **Ajouter `source_line_id`** sur `stock_document_lines` (nullable, FK → commande_lines)
2. **Ajouter `ship_stock_event_id`** sur `litige_lines` (nullable)
3. **Ajouter contrainte UNIQUE** sur BIP : `UNIQUE(local_product_id, establishment_id, source_establishment_id)`

---

### Étape 2 — Nouvelle fonction `fn_convert_b2b_quantity_reverse`

**Objectif** : Permettre la back-conversion FOURNISSEUR → CLIENT.  
**Risque** : FAIBLE (nouvelle fonction, n'impacte rien d'existant)  
**Rollback** : `DROP FUNCTION`

```sql
CREATE OR REPLACE FUNCTION fn_convert_b2b_quantity_reverse(
  p_supplier_product_id UUID,
  p_supplier_establishment_id UUID,
  p_client_establishment_id UUID,
  p_supplier_quantity NUMERIC,    -- NUMERIC, pas FLOAT
  p_commande_line_id UUID
) RETURNS NUMERIC
```

**Règles** :
- Utilise le MÊME `unit_mapping` que `fn_convert_b2b_quantity` (sens inverse)
- Types NUMERIC partout (pas de FLOAT)
- `DISTINCT ON` + `ORDER BY imported_at` sur lookup BIP

---

### Étape 3 — Réécriture `fn_ship_commande` (BREAKING)

**Objectif** : Cœur de la refonte. Élimine BUG-01 à BUG-04.  
**Risque** : ÉLEVÉ (changement critique du flow principal)  
**Rollback** : `CREATE OR REPLACE` avec l'ancien code (gardé dans migrations)

**Changements majeurs** :
1. Suppression totale de step 5f (sync)
2. Suppression de l'écriture inline dans stock_events (bypass)
3. Suppression de l'écriture inline dans stock_document_lines
4. Suppression du bootstrap snapshot inline
5. Remplacement par UN SEUL appel à `fn_post_stock_document`
6. Ajout de la back-conversion (étape 7-8)
7. Écriture UNIQUE de `shipped_quantity` (étape 9)
8. Ajout lock `FOR UPDATE` (concurrence)
9. Ajout idempotency check
10. Tous les JOINs BIP avec `DISTINCT ON`

**Lignes de code impactées** : ~130 lignes de bypass (étapes 5a-5e actuelles) → ~15 lignes (1 appel fn_post)

---

### Étape 4 — Mise à jour `fn_resolve_litige`

**Objectif** : Aligner le litige sur le nouveau design.  
**Risque** : MOYEN  
**Rollback** : `CREATE OR REPLACE` avec ancien code

1. `DISTINCT ON` sur JOIN BIP
2. Ajout idempotency via `idempotency_key = 'litige_adj:{litige_id}'`
3. Vérification que delta est en CLIENT (garanti par étape 3)

---

### Étape 5 — Mise à jour `fn_generate_app_invoice`

**Objectif** : Facturer ce qui est reçu, pas ce qui est marqué "non-rupture".  
**Risque** : FAIBLE  
**Rollback** : Rétablir le WHERE clause

```sql
-- Remplacement unique :
WHERE cl.line_status != 'rupture'
→
WHERE COALESCE(cl.received_quantity, 0) > 0
```

---

### Étape 6 — Ajout flow `cancel_shipment`

**Objectif** : Permettre l'annulation propre d'une expédition.  
**Risque** : FAIBLE (nouveau flow, n'impacte pas l'existant)  
**Rollback** : `DROP FUNCTION`

Nouvelle RPC qui :
1. Lock commande (FOR UPDATE, status = expediee)
2. Void le stock_document via `fn_void_stock_document`
3. Reset `shipped_quantity = 0`, `line_status = 'ouverte'`
4. Transition `status = 'ouverte'`

---

### Étape 7 — Validation complète

**Objectif** : Vérifier que TOUS les invariants tiennent.  
**Durée estimée** : 1-2 semaines

1. Exécuter les 11 diagnostics SQL (INV-01 à INV-11) → tous doivent retourner 0 lignes
2. Tester tous les scénarios (section 8)
3. Monitoring production : 1 semaine minimum
4. Vérifier absence de stocks négatifs
5. Vérifier cohérence doc_lines vs events

---

## 8. PLAN DE TEST

### 8.1 Scénarios normaux

| # | Scénario | Résultat attendu |
|---|----------|------------------|
| T-01 | Expédition complète | shipped_qty = canonical_qty (CLIENT), 1 stock_event (FOUR) |
| T-02 | Expédition partielle (clamp) | shipped_qty < canonical_qty, line_status = modifie |
| T-03 | Rupture réelle (stock = 0) | shipped_qty = 0, PAS de stock_event, line_status = rupture |
| T-04 | Réception conforme | Pas de litige, status = recue |
| T-05 | Réception avec manque | Litige créé, delta > 0 |
| T-06 | Réception avec surplus | Litige créé, delta < 0 |

### 8.2 Scénarios de conversion B2B

| # | Input (CLIENT) | Conversion | Stock (FOUR) | stock_event | shipped_qty (CLIENT) |
|---|---------------|------------|:------------:|:-----------:|:--------------------:|
| T-10 | 800 Pièces | ÷800 = 1 Paquet | 5 Paquets | -1 | 800 Pièces |
| T-11 | 800 Pièces | ÷800 = 1 Paquet | 0.5 Paquet | -0.5 | 400 Pièces |
| T-12 | 800 Pièces | ÷800 = 1 Paquet | 0 | ∅ (aucun) | 0 (rupture) |
| T-13 | 2 Cartons | ×10 = 20 Boîtes | 15 Boîtes | -15 | 1.5 Cartons |

### 8.3 Scénarios clamp strict (V3)

| # | Stock | Demande | stock_event | Stock final |
|---|:-----:|:-------:|:-----------:|:-----------:|
| T-20 | 10 | 5 | -5 | 5 |
| T-21 | 3 | 5 | -3 | 0 |
| T-22 | 0 | 5 | ∅ (aucun) | 0 |
| T-23 | 0 | 0 | ∅ (aucun) | 0 |
| T-24 | 0.001 | 5 | -0.001 | 0 |

### 8.4 Scénarios idempotence & concurrence

| # | Scénario | Résultat attendu |
|---|----------|------------------|
| T-30 | Double clic "Expédier" | 2e appel → `{ ok: true, idempotent: true }` |
| T-31 | 2 users simultanés | 2e user → `invalid_status` (lock) |
| T-32 | Retry réseau (même payload) | Idempotent, 0 double mouvement |
| T-33 | Annulation puis re-expédition | OK (VOIDED libère l'idempotency) |

### 8.5 Scénarios de non-régression

| # | Ce qui NE DOIT PLUS arriver |
|---|---------------------------|
| T-40 | `shipped_qty` en unité fournisseur |
| T-41 | `stock_document_lines ≠ stock_events` |
| T-42 | Rupture fantôme (stock débité mais status = rupture) |
| T-43 | Double mouvement stock pour une même commande |
| T-44 | Litige basé sur shipped_qty corrompue |
| T-45 | Stock négatif (en base ou temporaire) |
| T-46 | Facture qui exclut un produit réellement reçu |

### 8.6 Requêtes diagnostiques automatisables

```sql
-- DIAG-01: doc_lines = events
SELECT sd.id FROM stock_documents sd
WHERE sd.status = 'POSTED'
  AND ABS(
    (SELECT COALESCE(SUM(delta_quantity_canonical),0) FROM stock_document_lines WHERE document_id = sd.id)
    - (SELECT COALESCE(SUM(delta_quantity_canonical),0) FROM stock_events WHERE document_id = sd.id)
  ) > 0.001;
-- ATTENDU: 0 lignes

-- DIAG-02: pas de stock négatif
SELECT establishment_id, product_id, SUM(delta_quantity_canonical) as total
FROM stock_events
GROUP BY establishment_id, product_id
HAVING SUM(delta_quantity_canonical) < -0.001;
-- ATTENDU: 0 lignes

-- DIAG-03: pas de doublon BIP
SELECT local_product_id, establishment_id, source_establishment_id, count(*)
FROM b2b_imported_products
GROUP BY 1, 2, 3 HAVING count(*) > 1;
-- ATTENDU: 0 lignes

-- DIAG-04: shipped_qty en unité client
SELECT cl.id FROM commande_lines cl
JOIN commandes c ON c.id = cl.commande_id
JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
WHERE c.status IN ('expediee','recue','cloturee')
  AND mu.establishment_id != c.client_establishment_id;
-- ATTENDU: 0 lignes

-- DIAG-05: pas de rupture fantôme
SELECT cl.id FROM commande_lines cl
JOIN commandes c ON c.id = cl.commande_id
JOIN stock_documents sd ON sd.source_order_id = c.id AND sd.type = 'WITHDRAWAL'
JOIN stock_events se ON se.document_id = sd.id
WHERE cl.line_status = 'rupture' AND cl.shipped_quantity = 0
  AND se.delta_quantity_canonical < 0;
-- ATTENDU: 0 lignes (post-migration)
```

---

## 9. VERDICT FINAL ET RISQUES RÉSIDUELS

### Verdict

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   COHÉRENCE GLOBALE :  ✅ OK                                     ║
║                                                                   ║
║   NIVEAU DE CONFIANCE : ÉLEVÉ                                    ║
║                                                                   ║
║   RECOMMANDATION : GO — SAFE TO BUILD                            ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### Réponses aux questions critiques

| Question | Réponse |
|----------|---------|
| Peut-il encore exister un stock négatif ? | **NON** — Clamp centralisé dans fn_post_stock_document. Si effective = 0 → pas d'event |
| Peut-il exister une dette stock cachée ? | **NON** — Stock = réalité physique. Pas de backlog, pas de compensation |
| Peut-on avoir une divergence stock réel vs système ? | **NON** — Pipeline unique, doc_lines = events garanti |
| Peut-on casser le système avec une mauvaise saisie ? | **NON** — Clamp protège contre toute saisie impossible |
| Une réception peut-elle être faussée par une expédition ? | **NON** — shipped_qty en CLIENT, received_qty en CLIENT, même référentiel |
| Un litige peut-il détruire le stock ? | **NON** — Ajustement stock clampé, basé sur snapshots fiables |
| Le système est-il 100% déterministe ? | **OUI** — DISTINCT ON, pas de LIMIT 1, pas de sync, pas de double écriture |
| Traçabilité 1 ligne → 1 mouvement ? | **OUI** — `source_line_id` sur stock_document_lines |
| Retry réseau sûr ? | **OUI** — idempotency_key UNIQUE |
| Clamp centralisé ? | **OUI** — fn_post_stock_document uniquement |
| Mélange d'unités possible ? | **NON** — Back-conversion explicite, frontières claires |

### Risques résiduels

| # | Risque | Sévérité | Mitigation |
|---|--------|----------|------------|
| R-01 | Précision arithmétique aller-retour | FAIBLE | Utiliser NUMERIC (pas FLOAT) partout |
| R-02 | Données historiques (commandes clôturées) corrompues | INFO | Non corrigées, impact reporting uniquement |
| R-03 | `commande_plats` hors périmètre (pas de stock) | INFO | Appliquer même pattern si intégration future |
| R-04 | Migration étape 0 (nettoyage données) | MOYEN | Scripts manuels, validation cas par cas, backup |

### Ce qui disparaît

| # | Élément supprimé | Remplacé par |
|---|-----------------|--------------|
| D1 | Step 5f (sync corrective) | Back-conversion explicite (étapes 7-8-9) |
| D2 | Écriture inline stock_events | fn_post_stock_document |
| D3 | Écriture inline stock_document_lines | fn_post_stock_document |
| D4 | Bootstrap snapshot inline | fn_post_stock_document (le fait déjà) |
| D5 | Double écriture shipped_qty | Écriture unique étape 9 |
| D6 | JOINs non-protégés sur BIP | DISTINCT ON + ORDER BY imported_at |
| D7 | Clamp inline (GREATEST dans INSERT) | Clamp centralisé dans moteur |
| D8 | `WHERE line_status != 'rupture'` (facturation) | `WHERE received_quantity > 0` |
| D9 | Agrégation multi-zone | Supprimée (1 produit = 1 zone) |

---

*Ce document est le récapitulatif final de la stratégie B2B V3. Aucun code n'a été modifié.*  
*Prochaine étape : implémentation séquentielle des étapes 0 à 7.*
