# 🔴 STRATÉGIE B2B V3 — DOCUMENT FINAL COMPLET

> **Date** : 2026-03-26
> **Statut** : VALIDÉ — PRÊT À IMPLÉMENTER
> **Scope** : Expédition, Réception, Litiges, Annulation, Facturation, Stock

---

## TABLE DES MATIÈRES

1. [Contexte & Problème](#1-contexte--problème)
2. [Catalogue complet des bugs](#2-catalogue-complet-des-bugs)
3. [Incohérences structurelles](#3-incohérences-structurelles)
4. [Architecture cible V3](#4-architecture-cible-v3)
5. [Invariants non négociables](#5-invariants-non-négociables)
6. [Flows détaillés](#6-flows-détaillés)
7. [Plan d'implémentation (étapes)](#7-plan-dimplémentation)
8. [Résultat final attendu](#8-résultat-final-attendu)

---

## 1. CONTEXTE & PROBLÈME

Le système B2B actuel (commandes inter-établissements) souffre de **failles structurelles critiques** qui corrompent silencieusement les données en production :

- Stocks négatifs (60 soldes négatifs confirmés)
- Ruptures fantômes sur des produits réellement expédiés
- Factures fausses (lignes exclues à tort)
- Double débit stock fournisseur via litiges corrompus
- Divergence entre le ledger stock et les documents

**Impact terrain** : perte de revenus fournisseur, inventaires faux, confiance utilisateur dégradée.

---

## 2. CATALOGUE COMPLET DES BUGS

### BUG-01 — Double écriture / corruption de `shipped_quantity`
- **Cause** : `fn_ship_commande` étape 5f écrase `shipped_quantity` (référentiel CLIENT) par `effective_qty` (référentiel FOURNISSEUR)
- **Impact** : Réception faussée, litiges corrompus, factures incorrectes
- **Gravité** : 🔴 CRITIQUE

### BUG-02 — Produit cartésien BIP (jointures sans DISTINCT ON)
- **Cause** : Absence de contrainte UNIQUE sur `b2b_imported_products` + pas de `DISTINCT ON` dans les JOINs SQL
- **Impact** : 1 ligne commande → N lignes résultat → ruptures fantômes
- **Gravité** : 🔴 CRITIQUE

### BUG-03 — Bypass du moteur stock central
- **Cause** : `fn_ship_commande` fait du clampage inline au lieu de passer par `fn_post_stock_document`
- **Impact** : `stock_document_lines` ≠ `stock_events` (20 documents divergents identifiés)
- **Gravité** : 🔴 CRITIQUE

### BUG-04 — Double débit fournisseur via litiges
- **Cause** : Le litige utilise `shipped_quantity` corrompue (BUG-01) pour calculer le delta → restitution erronée
- **Impact** : Stock fournisseur débité 2 fois
- **Gravité** : 🔴 CRITIQUE

### BUG-05 — Stocks négatifs
- **Cause** : Bypass du clamp central (BUG-03)
- **Impact** : 60 soldes négatifs en production
- **Gravité** : 🔴 CRITIQUE

### BUG-06 — Factures excluant les lignes en "rupture"
- **Cause** : `fn_generate_app_invoice` filtre sur `line_status` au lieu de `received_quantity > 0`
- **Impact** : Perte de revenus fournisseur (20-63% de ruptures indues sur certaines commandes)
- **Gravité** : 🟠 MAJEUR

### BUG-07 — Sync destructive (step 5f)
- **Cause** : Boucle de "synchronisation" qui réécrit `shipped_quantity` après le mouvement stock
- **Impact** : Écrasement de la valeur initiale correcte
- **Gravité** : 🔴 CRITIQUE

### BUG-08 — Pas d'idempotence
- **Cause** : Aucune clé d'idempotence sur les opérations stock
- **Impact** : Double mouvement stock en cas de retry réseau
- **Gravité** : 🟠 MAJEUR

### BUG-09 — Pas de verrouillage concurrence
- **Cause** : Pas de `SELECT ... FOR UPDATE` sur les commandes
- **Impact** : Race condition si 2 utilisateurs expédient simultanément
- **Gravité** : 🟠 MAJEUR

### BUG-10 — Conversion non figée
- **Cause** : La back-conversion utilise le mapping BIP actuel, pas celui du moment de l'expédition
- **Impact** : Si le mapping change après expédition → valeurs historiques corrompues
- **Gravité** : 🟡 IMPORTANT

### BUG-11 — Trous dans le ledger
- **Cause** : Si stock = 0, aucun `stock_event` n'est créé → pas de trace de la tentative
- **Impact** : Impossible d'auditer, de comprendre pourquoi une ligne est en rupture
- **Gravité** : 🟡 IMPORTANT

---

## 3. INCOHÉRENCES STRUCTURELLES

| Incohérence | Description |
|-------------|-------------|
| Mélange de référentiels | `shipped_quantity` parfois en CLIENT, parfois en FOURNISSEUR |
| Double source de vérité | `stock_document_lines` vs `stock_events` divergent |
| line_status mutable | Écrit depuis le frontend ET le backend |
| Facturation sur statut | Au lieu de `received_quantity > 0` |
| Sync corrective | Réécriture post-facto au lieu d'écriture unique |
| Conversion volatile | Mapping BIP peut changer, corrompant l'historique |

---

## 4. ARCHITECTURE CIBLE V3

### 4.1 Philosophie

| Principe | Règle |
|----------|-------|
| **ZERO SYNC** | Aucune réécriture corrective. Écriture unique, finale. |
| **SSOT** | `stock_events` = seule réalité physique |
| **INTENTION ≠ RÉALITÉ** | L'input fournisseur est une intention. La réalité = post-clamp. |
| **STOCK ≥ 0** | JAMAIS négatif. Clamp strict. Pas de dette invisible. |
| **1 PRODUIT = 1 ZONE** | Simplification V1. Pas de multi-zone. |
| **DÉTERMINISME** | Conversion figée au moment de l'opération. |
| **TRAÇABILITÉ** | TOUJOURS 1 stock_event par ligne, même delta=0. |
| **ATOMICITÉ** | Toute opération = 1 transaction. Pas d'état intermédiaire. |

### 4.2 Moment de vérité

> Le seul moment de vérité = **`fn_post_stock_document` avec statut POSTED**

Pas la saisie fournisseur. Pas le frontend. Pas un sync.

### 4.3 Règles terrain (V3)

1. **Stock jamais négatif** — `effective_qty = MIN(requested, available)`. Si stock=0 → delta=0, event créé quand même avec `reason=CLAMP_ZERO`
2. **1 produit = 1 zone** — Pas d'agrégation cross-zone. 1 `commande_line` → 1 `stock_event` max
3. **Réalité physique uniquement** — Pas de backlog négatif, pas de compensation automatique

### 4.4 Modifications critiques V3

#### M1 — Toujours 1 stock_event par ligne
- **Avant** : si stock=0 → pas d'event
- **Après** : TOUJOURS créer un event (delta=0, reason=CLAMP_ZERO si nécessaire)
- **But** : traçabilité totale, 1 ligne = 1 mouvement, pas de trous dans le ledger

#### M2 — Figer la conversion au moment de l'expédition
- **Avant** : back-conversion utilise le mapping BIP actuel
- **Après** : persister `conversion_factor`, `client_unit_id`, `supplier_unit_id` dans `stock_document_lines`
- **But** : déterminisme historique, immunité aux changements de mapping

#### M3 — Idempotence forte (payload-aware)
- **Avant** : `idempotency_key = ship:{commande_id}`
- **Après** : `idempotency_key = ship:{commande_id}:{payload_hash}`
- **But** : retry safe + pas de blocage si le payload change légitimement

---

## 5. INVARIANTS NON NÉGOCIABLES

| # | Invariant | Vérification |
|---|-----------|-------------|
| 1 | Aucune double écriture de `shipped_quantity` | 1 seul UPDATE par ligne par expédition |
| 2 | Aucune valeur FOURNISSEUR dans `commande_lines` | Tout en référentiel CLIENT |
| 3 | Aucun accès direct à `stock_events` hors moteur central | Tout passe par `fn_post_stock_document` |
| 4 | `stock_document_lines` = `stock_events` (post-clamp) | Vérifiable par DIAG-01 |
| 5 | Aucun JOIN BIP sans `DISTINCT ON` | Code review obligatoire |
| 6 | Idempotence respectée sur tous les flows | Clé unique par opération |
| 7 | Stock JAMAIS négatif | Clamp centralisé |
| 8 | 1 ligne = 1 stock_event (toujours) | Même si delta=0 |
| 9 | Conversion figée dans `stock_document_lines` | Pas de dépendance au mapping futur |
| 10 | `line_status` dérivé uniquement | Jamais écrit depuis le frontend |
| 11 | Atomicité totale | BEGIN...COMMIT, pas d'état intermédiaire |

---

## 6. FLOWS DÉTAILLÉS

### 6.1 EXPÉDITION (`fn_ship_commande`)

```
TRANSACTION ATOMIQUE:
1. Lock commande (SELECT ... FOR UPDATE)
2. Calcul payload_hash = SHA256(commande_id + lignes triées)
3. Check idempotence: ship:{commande_id}:{payload_hash}
   - Même payload → SKIP (retourner résultat existant)
   - Payload différent → ERREUR 409
   - Nouveau → continuer
4. Résolution BIP: DISTINCT ON (cl.id) ORDER BY bip.imported_at
5. Pour chaque ligne:
   a. Conversion CLIENT → FOURNISSEUR (client_qty / conversion_factor)
   b. FIGER: persister conversion_factor, client_unit_id, supplier_unit_id
      dans stock_document_lines
   c. fn_post_stock_document (WITHDRAWAL, unité FOURNISSEUR)
   d. CLAMP: effective_qty = MIN(requested, stock_available)
   e. Créer stock_event:
      - Si stock > 0: delta = -effective_qty
      - Si stock = 0: delta = 0, reason = CLAMP_ZERO
      - source_line_id = cl.id (TOUJOURS)
   f. Back-conversion FOURNISSEUR → CLIENT
      (effective_supplier_qty × conversion_factor FIGÉ)
   g. Écriture UNIQUE commande_lines:
      - shipped_quantity = back_converted_qty (CLIENT)
      - line_status DÉRIVÉ:
        * shipped = 0 → 'rupture'
        * shipped < ordered → 'modifie'
        * shipped = ordered → 'ok'
6. COMMIT
```

### 6.2 RÉCEPTION (`fn_receive_commande`)

```
TRANSACTION ATOMIQUE:
1. Lock commande (SELECT ... FOR UPDATE)
2. Check idempotence: recv:{commande_id}:{payload_hash}
3. fn_post_stock_document (RECEIPT, unité CLIENT, stock du CLIENT)
4. Créer stock_event: delta = +received_qty, source_line_id = cl.id
5. Écriture UNIQUE commande_lines: received_quantity = input (CLIENT)
6. Détection écart: shipped_qty ≠ received_qty ?
   → OUI: créer litige_lines avec snapshots figés (CLIENT)
   → NON: pas de litige
7. COMMIT
```

### 6.3 LITIGE (`fn_resolve_litige`)

```
TRANSACTION ATOMIQUE:
1. Lock litige (SELECT ... FOR UPDATE)
2. Check idempotence: litige:{litige_id}:{payload_hash}
3. Delta depuis snapshots CLIENT figés (litige_lines)
4. Conversion CLIENT → FOURNISSEUR (conversion_factor FIGÉ original)
5. fn_post_stock_document (ADJUSTMENT, unité FOURNISSEUR)
   → Restitution stock fournisseur
6. CLAMP: effective = MIN(delta, max_restituable)
7. Créer stock_event:
   - delta = +effective_qty (restitution)
   - source_line_id = litige_line.id
   - ship_stock_event_id = référence expédition originale
8. Marquer litige résolu (resolved_at = now())
9. COMMIT
```

### 6.4 ANNULATION (`cancel_shipment`)

```
TRANSACTION ATOMIQUE:
1. Lock commande (SELECT ... FOR UPDATE)
2. Vérifier: commande non reçue ET pas de litige en cours
   → Sinon ERREUR
3. Check idempotence: cancel:{commande_id}
4. fn_void_stock_document (void le WITHDRAWAL original)
5. CLAMP: restitution = MIN(original_delta, max_restituable)
6. Créer stock_event:
   - delta = +effective_qty (restitution)
   - reason = VOID_SHIPMENT
   - source_line_id = cl.id
7. Reset commande_lines:
   - shipped_quantity = 0
   - line_status = 'ouverte'
8. Update commande status
9. COMMIT
```

### 6.5 FACTURATION

```
Basée UNIQUEMENT sur: received_quantity > 0
PAS basée sur line_status
→ Élimine le problème des ruptures fantômes
```

---

## 7. PLAN D'IMPLÉMENTATION

### Phase 0 — Nettoyage données (PRÉREQUIS)
> **Étapes : 2** | **Risque : FAIBLE** | **Casse : AUCUNE**

| Étape | Action | Détail |
|-------|--------|--------|
| 0.1 | Nettoyer doublons BIP | Dédupliquer `b2b_imported_products` + ajouter contrainte UNIQUE |
| 0.2 | Diagnostiquer commandes actives | Identifier les commandes avec `shipped_quantity` corrompue (référentiel fournisseur au lieu de client) |

### Phase 1 — Schema updates
> **Étapes : 3** | **Risque : FAIBLE** | **Casse : AUCUNE** (ajouts uniquement)

| Étape | Action | Détail |
|-------|--------|--------|
| 1.1 | Ajouter `source_line_id` à `stock_document_lines` | FK nullable vers `commande_lines.id` |
| 1.2 | Ajouter colonnes conversion à `stock_document_lines` | `conversion_factor`, `client_unit_id`, `supplier_unit_id` |
| 1.3 | Ajouter `idempotency_key` à `stock_documents` | UNIQUE, nullable, index |

### Phase 2 — Moteur stock (fn_post_stock_document)
> **Étapes : 2** | **Risque : MOYEN** | **Casse : POSSIBLE si mal testé**

| Étape | Action | Détail |
|-------|--------|--------|
| 2.1 | Intégrer clamp strict | `effective_qty = MIN(requested, available)`. Si 0 → event avec delta=0, reason=CLAMP_ZERO |
| 2.2 | Toujours créer stock_event | Même si delta=0, avec `source_line_id` |

### Phase 3 — fn_ship_commande V2
> **Étapes : 4** | **Risque : ÉLEVÉ** | **Casse : OUI si non testé**

| Étape | Action | Détail |
|-------|--------|--------|
| 3.1 | Ajouter lock + idempotence | `FOR UPDATE` + `ship:{id}:{hash}` |
| 3.2 | Fixer résolution BIP | `DISTINCT ON (cl.id) ORDER BY bip.imported_at` |
| 3.3 | Figer conversion dans doc_lines | Persister factor + unit_ids |
| 3.4 | Supprimer step 5f + écriture unique | `shipped_quantity` en CLIENT, `line_status` dérivé, UNE SEULE écriture |

### Phase 4 — Réception + Litiges + Annulation
> **Étapes : 3** | **Risque : MOYEN** | **Casse : LIMITÉ**

| Étape | Action | Détail |
|-------|--------|--------|
| 4.1 | Refaire `fn_receive_commande` | Lock + idempotence + détection écart |
| 4.2 | Refaire `fn_resolve_litige` | Basé sur snapshots figés + conversion figée |
| 4.3 | Créer `cancel_shipment` | Nouveau flow atomique |

### Phase 5 — Facturation
> **Étapes : 1** | **Risque : FAIBLE** | **Casse : AUCUNE**

| Étape | Action | Détail |
|-------|--------|--------|
| 5.1 | Modifier `fn_generate_app_invoice` | Filtrer sur `received_quantity > 0` au lieu de `line_status` |

### Phase 6 — Validation
> **Étapes : 3** | **Risque : AUCUN**

| Étape | Action | Détail |
|-------|--------|--------|
| 6.1 | Tests unitaires | Chaque flow, chaque cas limite |
| 6.2 | Tests d'intégration | Scénarios end-to-end complets |
| 6.3 | Diagnostics SQL | Vérifier invariants en production |

### TOTAL : 18 étapes sur 7 phases

```
Phase 0: [0.1] [0.2]                          → Nettoyage
Phase 1: [1.1] [1.2] [1.3]                    → Schema
Phase 2: [2.1] [2.2]                          → Moteur stock
Phase 3: [3.1] [3.2] [3.3] [3.4]              → Expédition
Phase 4: [4.1] [4.2] [4.3]                    → Réception/Litiges
Phase 5: [5.1]                                → Facturation
Phase 6: [6.1] [6.2] [6.3]                    → Validation
```

---

## 8. RÉSULTAT FINAL ATTENDU

### Avant (V1 actuelle)

| Métrique | État |
|----------|------|
| Stocks négatifs | 60 soldes |
| Ruptures fantômes | 20-63% sur certaines commandes |
| Double débit fournisseur | Oui (via litiges corrompus) |
| Divergence ledger | 20 documents |
| Factures incorrectes | Oui (lignes exclues à tort) |
| Idempotence | Aucune |
| Concurrence | Non gérée |
| Traçabilité | Partielle (trous dans le ledger) |
| Déterminisme | Non (conversion volatile) |

### Après (V3 cible)

| Métrique | État |
|----------|------|
| Stocks négatifs | **0** (clamp strict + event CLAMP_ZERO) |
| Ruptures fantômes | **0** (DISTINCT ON + écriture unique) |
| Double débit fournisseur | **0** (snapshots figés dans litiges) |
| Divergence ledger | **0** (pipeline unique fn_post_stock_document) |
| Factures incorrectes | **0** (basées sur received_quantity > 0) |
| Idempotence | **Totale** (payload-aware hash) |
| Concurrence | **Gérée** (FOR UPDATE) |
| Traçabilité | **100%** (1 ligne = 1 event, source_line_id) |
| Déterminisme | **Total** (conversion figée, factor persisté) |
| Atomicité | **Totale** (BEGIN...COMMIT, pas d'état intermédiaire) |

### Vérifications post-déploiement (queries SQL)

```sql
-- DIAG-01: stock_document_lines = stock_events
SELECT sdl.id FROM stock_document_lines sdl
LEFT JOIN stock_events se ON se.stock_document_line_id = sdl.id
WHERE se.id IS NULL AND sdl.stock_document_id IN (
  SELECT id FROM stock_documents WHERE status = 'POSTED'
);
-- Attendu: 0 lignes

-- DIAG-02: Aucun stock négatif
SELECT product_id, storage_zone_id, SUM(delta) as balance
FROM stock_events
GROUP BY product_id, storage_zone_id
HAVING SUM(delta) < 0;
-- Attendu: 0 lignes

-- DIAG-03: shipped_quantity toujours en référentiel CLIENT
-- (vérification manuelle sur échantillon)

-- DIAG-04: Aucun doublon BIP
SELECT source_product_id, establishment_id, COUNT(*)
FROM b2b_imported_products
GROUP BY source_product_id, establishment_id
HAVING COUNT(*) > 1;
-- Attendu: 0 lignes

-- DIAG-05: Idempotence respectée
SELECT idempotency_key, COUNT(*)
FROM stock_documents
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
-- Attendu: 0 lignes
```

---

## VERDICT FINAL

| Critère | Statut |
|---------|--------|
| Cohérence globale | ✅ OK |
| SSOT complet | ✅ OK |
| Déterminisme | ✅ OK |
| Stock jamais négatif | ✅ OK |
| Traçabilité totale | ✅ OK |
| Idempotence | ✅ OK |
| Atomicité | ✅ OK |
| Prêt production | ✅ **SAFE TO BUILD** |

**Niveau de confiance : ÉLEVÉ**

**Recommandation : GO — Implémenter séquentiellement Phase 0 → Phase 6**
