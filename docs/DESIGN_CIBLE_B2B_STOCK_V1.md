# 🎯 DESIGN CIBLE UNIFIÉ — B2B / STOCK / COMMANDES

**Date** : 2026-03-26  
**Statut** : Proposition d'architecture cible  
**Basé sur** : AUDIT_FINAL_VERDICT.md + AUDIT_DEEP_V2.md + AUDIT_VERIFICATION_v1.md  
**Objectif** : Système cohérent, déterministe, auditable, sans bug caché

---

## TABLE DES MATIÈRES

1. [Architecture globale](#1-architecture-globale)
2. [Flows détaillés](#2-flows-détaillés)
3. [Modèle de données cible](#3-modèle-de-données-cible)
4. [Ce qui doit disparaître](#4-ce-qui-doit-disparaître)
5. [Invariants système](#5-invariants-système)
6. [Stratégie de migration](#6-stratégie-de-migration)
7. [Plan de test](#7-plan-de-test)

---

## 1. ARCHITECTURE GLOBALE

### 1.1 Principes fondamentaux

| Principe | Règle |
|----------|-------|
| **SSOT** | Chaque donnée a UNE seule source, UNE seule écriture |
| **Référentiel unique** | `commande_lines` = toujours unité CLIENT. `stock_events` = toujours unité du PROPRIÉTAIRE du stock |
| **Pipeline unique** | TOUT mouvement de stock passe par `fn_post_stock_document` |
| **Déterminisme** | À input identique → résultat identique. Aucun JOIN sans DISTINCT ON / ORDER BY |
| **Traçabilité** | Chaque `stock_event` est relié à une action métier via `document_id` → `source_order_id` |
| **Isolation** | Aucun flow ne corrompt un autre flow. Pas de sync corrective inter-étapes |

### 1.2 Flux logique global

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
    ├── Écrire shipped_quantity UNE SEULE FOIS (unité client)
    ├── Convertir → unité fournisseur via fn_convert_b2b_quantity
    ├── Appeler fn_post_stock_document (WITHDRAWAL, unité fournisseur)
    │   └── stock_events clampés + stock_document_lines = post-clamp
    ├── SI clamp a réduit → back-convertir vers unité client
    └── Mettre à jour shipped_quantity FINALE = back-convertie (unité client)
    │
    ▼
fn_receive_commande (Client)
    ├── Écrire received_quantity (unité client, input direct)
    ├── Appeler fn_post_stock_document (RECEIPT, unité client)
    ├── Comparer received vs shipped → TOUT en unité client
    └── Si écart → créer litige
    │
    ▼
fn_resolve_litige
    ├── delta = litige_lines.shipped - litige_lines.received (unité client)
    ├── Convertir delta → unité fournisseur
    ├── Appeler fn_post_stock_document (ADJUSTMENT, unité fournisseur)
    └── Mettre à jour statuts
    │
    ▼
fn_generate_app_invoice
    ├── Source: received_quantity * unit_price_snapshot
    └── Exclut UNIQUEMENT les lignes avec received_quantity = 0
```

### 1.3 Séparation des responsabilités

| Composant | Responsabilité | NE FAIT PAS |
|-----------|---------------|-------------|
| `fn_ship_commande` | Écriture shipped_quantity (client), mouvement stock fournisseur | N'écrit PAS directement dans stock_events |
| `fn_post_stock_document` | Clamp, écriture stock_events + stock_document_lines | Ne connaît PAS les commandes |
| `fn_convert_b2b_quantity` | Conversion client ↔ fournisseur | Ne fait AUCUNE écriture |
| `fn_receive_commande` | Écriture received_quantity, stock client, création litige | Ne touche PAS au stock fournisseur |
| `fn_resolve_litige` | Ajustement stock fournisseur via delta | Ne réécrit PAS shipped_quantity |

---

## 2. FLOWS DÉTAILLÉS

### 2.a EXPÉDITION — `fn_ship_commande` (cible)

#### Inputs
```
p_commande_id   UUID
p_user_id       UUID
p_lines         JSONB[] → { line_id, shipped_quantity (CLIENT), line_status }
```

#### Étapes (séquentielles, dans une transaction)

| # | Action | Table | Unité | Détail |
|---|--------|-------|-------|--------|
| 1 | Lock commande | `commandes` | — | `FOR UPDATE`, status = 'ouverte' |
| 2 | Valider inputs | — | CLIENT | `shipped_quantity <= canonical_quantity`, status cohérent |
| 3 | **Écrire shipped_quantity PROVISOIRE** | `commande_lines` | **CLIENT** | `shipped_quantity = LEAST(input, canonical_quantity)`, `line_status = input` |
| 4 | Construire `_ship_lines` | temp table | — | **DISTINCT ON (cl.id)** sur JOIN `b2b_imported_products` + ORDER BY `bip.imported_at ASC` |
| 5 | Convertir quantités | `_ship_lines` | **FOURNISSEUR** | `fn_convert_b2b_quantity(shipped_qty_client)` → `supplier_qty` |
| 6 | **Appeler `fn_post_stock_document`** | `stock_documents`, `stock_document_lines`, `stock_events` | **FOURNISSEUR** | Type=WITHDRAWAL, source_order_id=commande_id. Le moteur central gère clamp + écriture atomique |
| 7 | **Récupérer les quantités effectives post-clamp** | `stock_events` | **FOURNISSEUR** | Pour chaque ligne, lire `ABS(delta_quantity_canonical)` = effective_supplier_qty |
| 8 | **Back-convertir si clamp** | calcul | **CLIENT** | `effective_client_qty = fn_convert_b2b_quantity_reverse(effective_supplier_qty)` |
| 9 | **Écriture FINALE shipped_quantity** | `commande_lines` | **CLIENT** | `shipped_quantity = effective_client_qty`. Si = 0 → `line_status = 'rupture'`. Si < ordered → `line_status = 'modifie'` |
| 10 | Update statut commande | `commandes` | — | `status = 'expediee'`, `shipped_at`, `shipped_by` |

#### Garanties

- ✅ `shipped_quantity` écrit UNE SEULE FOIS de manière définitive (étape 9), toujours en unité CLIENT
- ✅ `stock_document_lines` = `stock_events` (via moteur central, post-clamp)
- ✅ Pas de JOIN cartésien (DISTINCT ON + ORDER BY)
- ✅ Pas de bypass du moteur central
- ✅ Back-conversion explicite et traçable

#### Nouvelle fonction requise : `fn_convert_b2b_quantity_reverse`

```sql
-- Convertit une quantité FOURNISSEUR → CLIENT
-- Inverse exact de fn_convert_b2b_quantity
-- Utilise le MÊME unit_mapping mais en sens inverse
-- MULTIPLICATION au lieu de DIVISION (ou vice versa selon V4.2)
CREATE OR REPLACE FUNCTION fn_convert_b2b_quantity_reverse(
  p_supplier_product_id UUID,
  p_supplier_establishment_id UUID,
  p_client_establishment_id UUID,
  p_supplier_quantity NUMERIC,
  p_commande_line_id UUID  -- pour lookup unité client
) RETURNS NUMERIC
```

---

### 2.b RÉCEPTION — `fn_receive_commande` (cible)

#### Inputs
```
p_commande_id       UUID
p_user_id           UUID
p_establishment_id  UUID (client)
p_lines             JSONB[] → { line_id, received_quantity }
```

#### Étapes

| # | Action | Table | Unité | Détail |
|---|--------|-------|-------|--------|
| 1 | Lock commande | `commandes` | — | `FOR UPDATE`, status = 'expediee' |
| 2 | Valider inputs | — | CLIENT | `received_quantity >= 0` |
| 3 | Écrire received_quantity | `commande_lines` | **CLIENT** | UNE seule écriture |
| 4 | Construire `_recv_lines` | temp | CLIENT | Produits CLIENT, unités CLIENT, zones de stockage |
| 5 | **Appeler `fn_post_stock_document`** | stock_* | **CLIENT** | Type=RECEIPT, source_order_id=commande_id |
| 6 | Détecter écarts | logique | CLIENT | `received_quantity != shipped_quantity` → litige |
| 7 | Créer litige si écart | `litiges`, `litige_lines` | CLIENT | **Snapshotter** shipped_quantity et received_quantity (les deux en CLIENT) |
| 8 | Update statut | `commandes` | — | `recue` (si pas d'écart) ou `litige` |

#### Garanties

- ✅ Comparaison shipped vs received TOUJOURS en unité CLIENT (même référentiel)
- ✅ Stock client via moteur central
- ✅ Litige basé sur données fiables (shipped_quantity = unité CLIENT garanti par le nouveau fn_ship)

---

### 2.c LITIGE — `fn_resolve_litige` (cible)

#### Inputs
```
p_litige_id  UUID
p_user_id    UUID
```

#### Étapes

| # | Action | Table | Unité | Détail |
|---|--------|-------|-------|--------|
| 1 | Lock litige + commande | `litiges`, `commandes` | — | `FOR UPDATE` |
| 2 | Calculer deltas | `litige_lines` | **CLIENT** | `delta = shipped_quantity - received_quantity` (les deux en CLIENT) |
| 3 | Construire `_adj_lines` | temp | — | **DISTINCT ON (ll.id)** sur JOIN `b2b_imported_products` + ORDER BY `bip.imported_at ASC` |
| 4 | Convertir deltas | `_adj_lines` | **FOURNISSEUR** | `fn_convert_b2b_quantity(ABS(delta))` → supplier_delta |
| 5 | **Appeler `fn_post_stock_document`** | stock_* | **FOURNISSEUR** | Type=ADJUSTMENT, direction=signe du delta |
| 6 | Update statuts | `litiges`, `commandes` | — | `resolved`, `recue` |

#### Garanties

- ✅ Delta basé sur des données fiables (shipped et received toutes les deux en CLIENT)
- ✅ Pas de JOIN cartésien
- ✅ Stock via moteur central (clamp si nécessaire, pas de blocking)

#### Point de design : clamp vs blocking sur ADJUSTMENT

**Décision cible** : Le moteur central (`fn_post_stock_document`) doit utiliser le **clamp** (pas le blocking) pour les ADJUSTMENT négatifs (surplus). Raison : un litige surplus signifie que le fournisseur a expédié plus que prévu — on doit pouvoir ajuster le stock même s'il est à 0 (le produit a été physiquement consommé/vendu entre-temps).

→ Cela nécessite soit :
- Un paramètre `allow_clamp_to_zero: true` dans fn_post_stock_document
- Soit le comportement actuel "Stock Zéro Simple V2" qui clampe automatiquement

**Le comportement V2 actuel est CORRECT pour ce cas.** Pas de modification nécessaire.

---

### 2.d INVENTAIRE (inchangé — déjà correct)

| # | Action | Intégrité |
|---|--------|-----------|
| 1 | Session de comptage | Immutable ✅ |
| 2 | `inventory_lines` = snapshot | Append-only ✅ |
| 3 | `zone_stock_snapshots` | Nouveau `snapshot_version_id` ✅ |
| 4 | Stock = snapshot + Σ events | Formule SSOT ✅ |

**Aucun changement requis.**

---

### 2.e FACTURATION — `fn_generate_app_invoice` (cible)

#### Changement clé : ne plus exclure par `line_status`

**Règle actuelle (BUGGY)** :
```sql
WHERE line_status != 'rupture'
```
→ Exclut les ruptures fantômes = perte de revenu

**Règle cible** :
```sql
WHERE COALESCE(received_quantity, 0) > 0
```
→ Facture TOUT ce qui a été effectivement reçu, indépendamment du `line_status`

#### Garanties

- ✅ Le montant facturé = exactement ce qui a été reçu
- ✅ Pas de dépendance à `line_status` (potentiellement corrompu historiquement)
- ✅ Prix = `unit_price_snapshot` × `received_quantity` (les deux en unité CLIENT)

---

### 2.f VOID — `fn_void_stock_document` (inchangé — déjà correct)

Le void fonctionne correctement :
- Clamp inverse (pas de stock négatif après void)
- Traçabilité (`voids_event_id`, `voids_document_id`)
- **Limitation acceptée** : le void ne modifie pas `commande_lines` — c'est un choix de design (le void est un outil stock, pas un outil commande)

---

## 3. MODÈLE DE DONNÉES CIBLE

### 3.1 `commande_lines` — Référentiel CLIENT uniquement

| Colonne | Type | Référentiel | Écrite par | Nb écritures |
|---------|------|-------------|------------|:------------:|
| `canonical_quantity` | numeric | CLIENT | `fn_send_commande` | 1 |
| `canonical_unit_id` | uuid | CLIENT | `fn_send_commande` | 1 |
| `shipped_quantity` | numeric | **CLIENT** | `fn_ship_commande` (étape 9 FINALE) | **1** |
| `received_quantity` | numeric | CLIENT | `fn_receive_commande` | 1 |
| `line_status` | text | — | `fn_ship_commande` (étape 9 FINALE) | **1** |
| `unit_price_snapshot` | numeric | CLIENT | `fn_send_commande` | 1 |
| `line_total_snapshot` | numeric | CLIENT | `fn_send_commande` | 1 |

**INVARIANT** : Aucun champ de `commande_lines` ne contient jamais une valeur en unité fournisseur.

### 3.2 `stock_events` — Référentiel PROPRIÉTAIRE du stock

| Colonne | Type | Référentiel | Écrite par | Nb écritures |
|---------|------|-------------|------------|:------------:|
| `delta_quantity_canonical` | numeric | Propriétaire du stock | `fn_post_stock_document` | 1 |
| `canonical_unit_id` | uuid | Propriétaire du stock | `fn_post_stock_document` | 1 |
| `canonical_family` | text | Propriétaire du stock | `fn_post_stock_document` | 1 |
| `document_id` | uuid | — | `fn_post_stock_document` | 1 |

**INVARIANT** : `stock_events` est un ledger append-only. Aucune mise à jour.

### 3.3 `stock_document_lines` — POST-CLAMP

**Changement clé** : Dans le design cible, `stock_document_lines` reflète la quantité **effective** (post-clamp), pas la quantité demandée.

| Colonne | Actuel | Cible |
|---------|--------|-------|
| `delta_quantity_canonical` | Quantité demandée (pre-clamp) | **Quantité effective (post-clamp)** |

**INVARIANT** : `SUM(stock_document_lines.delta) = SUM(stock_events.delta)` pour tout document POSTED.

### 3.4 `litige_lines` — Snapshots CLIENT

| Colonne | Type | Référentiel | Source |
|---------|------|-------------|--------|
| `shipped_quantity` | numeric | **CLIENT** | Copié de `commande_lines.shipped_quantity` |
| `received_quantity` | numeric | CLIENT | Copié de `commande_lines.received_quantity` |

**INVARIANT** : Les deux sont en unité CLIENT (garanti par le nouveau design de `fn_ship_commande`).

### 3.5 `b2b_imported_products` — Contrainte UNIQUE

```sql
ALTER TABLE b2b_imported_products
ADD CONSTRAINT uq_bip_local_est_source
UNIQUE (local_product_id, establishment_id, source_establishment_id);
```

**Effet** : Impossible de créer des doublons BIP. Les 2 doublons existants doivent être nettoyés avant.

---

## 4. CE QUI DOIT DISPARAÎTRE

### 4.1 Step 5f — Sync corrective

**Suppression totale.** La boucle de synchronisation qui réécrit `shipped_quantity` et `line_status` après le clamp stock est le bug racine.

**Remplacement** : Back-conversion explicite (étape 8-9 du nouveau flow) qui convertit la quantité effective fournisseur VERS l'unité client avant écriture finale.

### 4.2 Écriture inline des stock_events

**Suppression totale.** `fn_ship_commande` ne doit plus écrire directement dans `stock_events` ni `stock_document_lines`.

**Remplacement** : Appel à `fn_post_stock_document` comme tous les autres flows.

### 4.3 Double écriture de `shipped_quantity`

**Suppression.** L'étape 1 actuelle (écriture provisoire) suivie de l'étape 5f (réécriture) est remplacée par :
- Étape 3 : écriture provisoire en CLIENT (identique)
- Étape 9 : écriture FINALE en CLIENT (post-back-conversion)
- **Aucune écriture intermédiaire en unité fournisseur**

### 4.4 JOIN sans DISTINCT ON sur `b2b_imported_products`

**Suppression de tous les JOINs non protégés.** Chaque JOIN sur BIP dans le système doit avoir :
```sql
DISTINCT ON (cl.id) ... ORDER BY cl.id, bip.imported_at ASC
```

**Fonctions impactées** :
- `fn_ship_commande` (temp `_ship_lines`)
- `fn_resolve_litige` (temp `_litige_adj_lines`)
- `fn_convert_b2b_quantity` (LIMIT 1 → ajout ORDER BY `imported_at ASC`)

### 4.5 Divergence document_lines vs events

**Suppression** via utilisation du moteur central. `fn_post_stock_document` écrit les deux tables de manière atomique avec les mêmes quantités post-clamp.

### 4.6 Doublons BIP

**Nettoyage** des 2 doublons existants + ajout contrainte UNIQUE.

---

## 5. INVARIANTS SYSTÈME

### 5.1 Invariants de données (TOUJOURS vrais)

| # | Invariant | Vérifiable par |
|---|-----------|----------------|
| INV-01 | `commande_lines.shipped_quantity` est TOUJOURS en unité CLIENT | Check: `canonical_unit_id` est une unité du `client_establishment_id` |
| INV-02 | `commande_lines.shipped_quantity` est écrite UNE SEULE FOIS de manière définitive | Code review + pas de double UPDATE |
| INV-03 | `SUM(stock_document_lines.delta) = SUM(stock_events.delta)` pour tout document POSTED | Requête SQL diagnostic |
| INV-04 | Aucun `stock_event` n'est écrit en dehors de `fn_post_stock_document` | Code review |
| INV-05 | Aucun stock négatif : `SUM(stock_events.delta) >= 0` par (product, establishment) | Requête SQL + clamp V2 |
| INV-06 | Aucun doublon BIP : `UNIQUE(local_product_id, establishment_id, source_establishment_id)` | Contrainte DB |
| INV-07 | Tout JOIN sur BIP utilise `DISTINCT ON` + `ORDER BY imported_at ASC` | Code review |
| INV-08 | `litige_lines.shipped_quantity` et `received_quantity` sont en unité CLIENT | Garanti par INV-01 |
| INV-09 | `received_quantity × unit_price_snapshot` = montant facturable | Garanti par INV-01 (même unité) |
| INV-10 | La facturation exclut par `received_quantity = 0`, PAS par `line_status` | Code review |

### 5.2 Invariants de flow (TOUJOURS respectés)

| # | Invariant |
|---|-----------|
| FLOW-01 | L'expédition ne peut PAS corrompre les données de réception |
| FLOW-02 | La réception ne peut PAS écrire dans le stock fournisseur |
| FLOW-03 | Le litige ne peut PAS modifier `shipped_quantity` ni `received_quantity` |
| FLOW-04 | L'inventaire ne peut PAS masquer un bug stock (snapshot = rebase total) |
| FLOW-05 | Le void ne modifie PAS les `commande_lines` |

### 5.3 Requêtes de diagnostic (à exécuter régulièrement)

```sql
-- DIAG-01: Vérifier INV-03 (doc_lines = events)
SELECT sd.id, doc_total, evt_total
FROM stock_documents sd
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(delta_quantity_canonical), 0) 
  FROM stock_document_lines WHERE document_id = sd.id
) dt(doc_total)
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(delta_quantity_canonical), 0) 
  FROM stock_events WHERE document_id = sd.id
) et(evt_total)
WHERE sd.status = 'POSTED' AND ABS(dt.doc_total - et.evt_total) > 0.001;
-- ATTENDU: 0 lignes

-- DIAG-02: Vérifier INV-05 (pas de stock négatif)
SELECT establishment_id, product_id, SUM(delta_quantity_canonical) as total
FROM stock_events
GROUP BY establishment_id, product_id
HAVING SUM(delta_quantity_canonical) < -0.001;
-- ATTENDU: 0 lignes

-- DIAG-03: Vérifier INV-06 (pas de doublon BIP)
SELECT local_product_id, establishment_id, source_establishment_id, count(*)
FROM b2b_imported_products
GROUP BY local_product_id, establishment_id, source_establishment_id
HAVING count(*) > 1;
-- ATTENDU: 0 lignes

-- DIAG-04: Ruptures fantômes (shipped=0 mais stock débité)
SELECT cl.id, cl.product_name_snapshot, cl.shipped_quantity, cl.line_status,
       SUM(se.delta_quantity_canonical) as stock_debited
FROM commande_lines cl
JOIN commandes c ON c.id = cl.commande_id
JOIN stock_documents sd ON sd.source_order_id = c.id AND sd.type = 'WITHDRAWAL'
JOIN stock_events se ON se.document_id = sd.id
  AND se.product_id IN (
    SELECT DISTINCT bip.source_product_id 
    FROM b2b_imported_products bip
    WHERE bip.local_product_id = cl.product_id
  )
WHERE cl.line_status = 'rupture' AND cl.shipped_quantity = 0
  AND se.delta_quantity_canonical < 0
GROUP BY cl.id, cl.product_name_snapshot, cl.shipped_quantity, cl.line_status;
-- ATTENDU: 0 lignes (post-migration)

-- DIAG-05: Vérifier que shipped_quantity est dans l'unité client
SELECT cl.id, cl.product_name_snapshot, 
       cl.shipped_quantity, cl.canonical_quantity,
       cl.canonical_unit_id,
       mu.establishment_id as unit_est_id,
       c.client_establishment_id
FROM commande_lines cl
JOIN commandes c ON c.id = cl.commande_id
JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
WHERE c.status IN ('expediee', 'recue', 'cloturee')
  AND mu.establishment_id != c.client_establishment_id;
-- ATTENDU: 0 lignes
```

---

## 6. STRATÉGIE DE MIGRATION

### 6.1 Phase 0 — Nettoyage des données corrompues (AVANT tout changement de code)

#### 6.1.a Nettoyer les doublons BIP

```sql
-- Identifier les doublons
WITH ranked AS (
  SELECT id, local_product_id, establishment_id, source_establishment_id,
         ROW_NUMBER() OVER (
           PARTITION BY local_product_id, establishment_id, source_establishment_id 
           ORDER BY imported_at ASC
         ) as rn
  FROM b2b_imported_products
)
DELETE FROM b2b_imported_products WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- Ajouter la contrainte UNIQUE
ALTER TABLE b2b_imported_products
ADD CONSTRAINT uq_bip_local_est_source
UNIQUE (local_product_id, establishment_id, source_establishment_id);
```

#### 6.1.b Corriger les shipped_quantity corrompues

```sql
-- Identifier les lignes corrompues (shipped_qty ne correspond pas à l'unité client)
-- Pour chaque ligne corrompue, recalculer à partir du stock_event via back-conversion
-- ⚠️ Script manuel à valider cas par cas
-- Principe: lire le stock_event associé, back-convertir, réécrire shipped_quantity

-- Exemple pour SERVIETTE TABLE:
-- stock_event = -1 Paquet (fournisseur)
-- Back-conversion: 1 Paquet = 800 Pièces (client)
-- → shipped_quantity = 800 (si stock non clampé) ou recalcul via le factor BFS
```

#### 6.1.c Corriger les ruptures fantômes

```sql
-- Identifier: lignes rupture avec stock_event négatif
-- Pour chaque: recalculer shipped_quantity via back-conversion
-- Changer line_status de 'rupture' à 'ok' ou 'modifie' selon le cas
```

#### 6.1.d Corriger stock_document_lines divergents

```sql
-- Pour les 15 documents divergents identifiés:
-- Mettre à jour stock_document_lines pour refléter la quantité effective (= stock_events)
UPDATE stock_document_lines sdl
SET delta_quantity_canonical = se.delta_quantity_canonical
FROM stock_events se
WHERE se.document_id = sdl.document_id
  AND se.product_id = sdl.product_id
  AND sdl.document_id IN (/* liste des 15 documents divergents */);
```

### 6.2 Phase 1 — Contraintes DB (non-breaking)

1. ✅ Contrainte UNIQUE sur BIP (déjà faite en 6.1.a)
2. Vérifier que tous les diagnostics DIAG-01 à DIAG-05 passent

### 6.3 Phase 2 — Nouvelle `fn_ship_commande` (breaking change)

1. Créer `fn_convert_b2b_quantity_reverse` (nouvelle fonction)
2. Réécrire `fn_ship_commande` selon le design cible (section 2.a)
3. Supprimer step 5f
4. Utiliser `fn_post_stock_document` au lieu du bypass inline
5. Ajouter DISTINCT ON sur tous les JOINs BIP

**Rollback** : L'ancienne version de `fn_ship_commande` reste dans les migrations historiques. En cas de problème, un `CREATE OR REPLACE` avec l'ancien code peut être exécuté.

### 6.4 Phase 3 — Mise à jour `fn_resolve_litige`

1. Ajouter DISTINCT ON sur JOIN BIP
2. Vérifier que le delta est calculé en unité CLIENT (garanti par Phase 2)

### 6.5 Phase 4 — Mise à jour `fn_generate_app_invoice`

1. Remplacer `WHERE line_status != 'rupture'` par `WHERE COALESCE(received_quantity, 0) > 0`

### 6.6 Phase 5 — Validation

1. Exécuter DIAG-01 à DIAG-05 → tous doivent retourner 0 lignes
2. Tester les scénarios du plan de test (section 7)
3. Monitorer pendant 1 semaine avant de considérer stable

---

## 7. PLAN DE TEST

### 7.1 Scénarios normaux

| # | Scénario | Input | Résultat attendu |
|---|----------|-------|------------------|
| T-01 | Expédition complète (qty = ordered) | shipped=10, stock=50 | shipped_qty=10 (CLIENT), stock_event=-10 (FOURNISSEUR), line_status=ok |
| T-02 | Expédition partielle | shipped=5, ordered=10, stock=50 | shipped_qty=5 (CLIENT), line_status=modifie |
| T-03 | Rupture réelle | shipped=0, line_status=rupture | shipped_qty=0, pas de stock_event |
| T-04 | Réception conforme | received=shipped | pas de litige, status=recue |
| T-05 | Réception avec écart | received=8, shipped=10 | litige créé, delta=2 |
| T-06 | Facturation | commande recue | total = Σ(received_qty × unit_price_snapshot) |

### 7.2 Scénarios de conversion B2B

| # | Scénario | Input (CLIENT) | Conversion | Stock (FOURNISSEUR) | shipped_qty FINALE (CLIENT) |
|---|----------|---------------|------------|--------------------|-----------------------------|
| T-10 | Pièce→Paquet (800:1) | 800 Pièces | /800 = 1 Paquet | -1 Paquet | 800 Pièces |
| T-11 | Pièce→Paquet avec clamp | 800 Pièces, stock=0.5 Paquet | clamp à 0.5 | -0.5 Paquet | 400 Pièces (back-conv) |
| T-12 | Carton→Boîte (1:10) | 2 Cartons | ×10 = 20 Boîtes | -20 Boîtes | 2 Cartons |
| T-13 | Carton→Boîte avec clamp | 2 Cartons, stock=15 Boîtes | clamp à 15 | -15 Boîtes | 1.5 Cartons (back-conv) |

### 7.3 Scénarios extrêmes

| # | Scénario | Résultat attendu |
|---|----------|------------------|
| T-20 | Stock = 0 | shipped_qty=0 (back-conv de 0), line_status=rupture, pas de stock_event |
| T-21 | Doublon BIP (post-migration) | Impossible (UNIQUE constraint) |
| T-22 | Conversion impossible (pas de BFS path) | Ligne en `rupture` + erreur tracée (conversion_error), pas de stock_event |
| T-23 | Litige surplus (received > shipped) | fn_resolve_litige retire du stock fournisseur (clampé à 0 minimum) |
| T-24 | Litige manque (received < shipped) | fn_resolve_litige crédite le stock fournisseur |
| T-25 | Void après expédition | stock_events inversés (clampés), commande_lines NON modifiées |
| T-26 | Réception après rupture réelle (received=5, shipped=0) | Stock client +5, litige créé (surplus), fournisseur ajusté |

### 7.4 Scénarios de corruption (non-régression)

| # | Scénario | Ce qui NE DOIT PAS arriver |
|---|----------|---------------------------|
| T-30 | Expédition avec conversion | shipped_qty ne doit PAS être en unité fournisseur |
| T-31 | Expédition avec clamp | stock_document_lines ne doit PAS diverger de stock_events |
| T-32 | Produit avec ancien doublon BIP | Pas de produit cartésien |
| T-33 | Litige sur données historiques corrompues | Delta ne doit PAS être basé sur shipped_qty corrompue (données corrigées en Phase 0) |

### 7.5 Tests SQL automatisables

Chaque diagnostic (DIAG-01 à DIAG-05) peut être exécuté comme test :
```sql
DO $$
BEGIN
  -- DIAG-01
  IF EXISTS (
    SELECT 1 FROM stock_documents sd ...
    WHERE ABS(doc_total - evt_total) > 0.001
  ) THEN
    RAISE EXCEPTION 'INV-03 VIOLATED: doc_lines != events';
  END IF;
  
  -- etc.
END $$;
```

---

## ZONES D'INCERTITUDE SIGNALÉES

### Z-01 : `fn_convert_b2b_quantity_reverse` — Précision de la back-conversion

La back-conversion (fournisseur → client) peut introduire des erreurs d'arrondi.  
**Exemple** : 800 Pièces → 1 Paquet → back = 800 Pièces ✅  
**Mais** : 5 Pièces → 0.00625 Paquet → clamp = 0.00625 → back = 5 Pièces ✅ (si factor exact)  
**Risque** : Si le factor est un rationnel non exact (ex: 1/3), la back-conversion ne donnera pas un entier.

**Mitigation** : Stocker le factor exact dans `unit_mapping` (JSONB) et utiliser `NUMERIC` (pas `FLOAT`).

### Z-02 : Commandes historiques corrompues

Les commandes déjà en statut `cloturee` avec des données corrompues (shipped_quantity en unité fournisseur) ne seront PAS corrigées automatiquement. Elles resteront comme trace historique.

Seules les commandes en statut `expediee` ou `litige` (actives) seront corrigées en Phase 0.

### Z-03 : `commande_plats` — Système parallèle non intégré au stock

Le module `commande_plats` n'a aucune intégration stock. Ce design cible ne le couvre pas car il n'y a pas de mouvement de stock à gérer. Si une intégration stock est requise à l'avenir, le même pattern (moteur central) devra être appliqué.

---

*Ce document est une proposition d'architecture. Aucun code n'a été modifié.*
