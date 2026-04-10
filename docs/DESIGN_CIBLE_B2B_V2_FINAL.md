# 🎯 DESIGN CIBLE V2 — Architecture Finale B2B / Stock / Commandes

**Date** : 2026-03-26  
**Statut** : Architecture de production — version FINALE  
**Supersede** : DESIGN_CIBLE_B2B_STOCK_V1.md  
**Objectif** : Système cohérent, déterministe, auditable, sans bug caché, sans sync

---

## TABLE DES MATIÈRES

1. [Philosophie fondamentale](#1-philosophie-fondamentale)
2. [Moment de vérité — Le concept clé](#2-moment-de-vérité)
3. [Intention vs Réalité — Séparation stricte](#3-intention-vs-réalité)
4. [Flows détaillés](#4-flows-détaillés)
5. [Traçabilité complète](#5-traçabilité-complète)
6. [Idempotence & Concurrence](#6-idempotence--concurrence)
7. [Litige — Basé sur le Ledger](#7-litige-basé-sur-le-ledger)
8. [Modèle de données cible](#8-modèle-de-données-cible)
9. [Ce qui doit disparaître](#9-ce-qui-doit-disparaître)
10. [Invariants système](#10-invariants-système)
11. [Stratégie de migration](#11-stratégie-de-migration)
12. [Plan de test](#12-plan-de-test)
13. [Zones d'incertitude](#13-zones-dincertitude)

---

## 1. PHILOSOPHIE FONDAMENTALE

### 1.1 Trois règles absolues

| # | Règle | Conséquence |
|---|-------|-------------|
| R1 | **ZÉRO SYNC** | Aucune réécriture corrective. Chaque champ est écrit UNE FOIS, définitivement |
| R2 | **STOCK = VÉRITÉ** | Le stock ledger (`stock_events`) est la seule source de vérité pour les quantités physiques |
| R3 | **INTENTION ≠ RÉALITÉ** | Ce que le fournisseur veut expédier ≠ ce qui sort réellement du stock |

### 1.2 Référentiels d'unité — Règle de fer

```
┌─────────────────────────────────────────────────────────┐
│ commande_lines      → TOUJOURS en unité CLIENT          │
│ stock_events        → TOUJOURS en unité PROPRIÉTAIRE    │
│ litige_lines        → TOUJOURS en unité CLIENT          │
│ app_invoice_lines   → TOUJOURS en unité CLIENT          │
│                                                         │
│ ❌ JAMAIS de valeur fournisseur dans commande_lines     │
│ ❌ JAMAIS de valeur client dans stock_events fournisseur│
└─────────────────────────────────────────────────────────┘
```

---

## 2. MOMENT DE VÉRITÉ

### 2.1 Définition

Le **moment de vérité** de l'expédition est :

> **Le stock_document POSTED par `fn_post_stock_document`**

Pas la saisie fournisseur. Pas l'écriture dans commande_lines.

**Le stock réellement sorti** est la seule réalité.

### 2.2 Conséquence directe

```
SAISIE FOURNISSEUR (intention)
    │
    ▼  fn_convert_b2b_quantity (client → fournisseur)
QUANTITÉ DEMANDÉE (unité fournisseur)
    │
    ▼  fn_post_stock_document (WITHDRAWAL)
QUANTITÉ EFFECTIVE post-clamp (unité fournisseur)     ← MOMENT DE VÉRITÉ
    │
    ▼  fn_convert_b2b_quantity_reverse (fournisseur → client)
SHIPPED_QUANTITY FINALE (unité client)                 ← ÉCRITURE UNIQUE
```

### 2.3 Pourquoi pas la saisie fournisseur ?

Parce que le fournisseur peut demander d'expédier 100 unités mais n'en avoir que 60 en stock.
La saisie est une **intention**. Le stock débité est la **réalité**.

---

## 3. INTENTION vs RÉALITÉ — Séparation stricte

### 3.1 Le problème actuel

Aujourd'hui, `fn_ship_commande` :
1. Écrit `shipped_quantity = input` dans commande_lines (INTENTION)
2. Fait un clamp stock (RÉALITÉ ≠ INTENTION)
3. ❌ Ne met PAS à jour `shipped_quantity` avec la RÉALITÉ → **INCOHÉRENCE**

### 3.2 Le design cible

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   INTENTION       │     │   MOTEUR STOCK    │     │   RÉALITÉ         │
│                   │     │                   │     │                   │
│ input fournisseur │────▶│ fn_post_stock_doc │────▶│ stock_events      │
│ (unité client)    │     │ (unité fournisseur)│    │ (unité fournisseur)│
│                   │     │                   │     │                   │
│ PAS persisté      │     │ clamp + write     │     │ PERSISTÉ          │
│ dans commande_    │     │ atomique          │     │ append-only       │
│ lines             │     │                   │     │                   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                                          │
                                                          ▼ back-conversion
                                                   ┌──────────────────┐
                                                   │ PROJECTION MÉTIER │
                                                   │                   │
                                                   │ shipped_quantity  │
                                                   │ (unité client)    │
                                                   │ ÉCRITURE UNIQUE   │
                                                   └──────────────────┘
```

### 3.3 Règle absolue

> `shipped_quantity` dans `commande_lines` n'est JAMAIS l'intention du fournisseur.
> C'est TOUJOURS la projection de la réalité stock, en unité client.

---

## 4. FLOWS DÉTAILLÉS

### 4.a EXPÉDITION — `fn_ship_commande` (cible V2)

#### Frontend → Backend

Le frontend (`PreparationDialog.tsx`) envoie :
```json
{
  "commande_id": "uuid",
  "lines": [
    { "line_id": "uuid", "shipped_quantity": 10, "line_status": "ok" },
    { "line_id": "uuid", "shipped_quantity": 0, "line_status": "rupture" }
  ]
}
```

⚠️ **Les `shipped_quantity` du frontend sont en unité CLIENT** (vues du PreparationDialog qui travaille sur `canonical_quantity` qui est en CLIENT).

#### Étapes — Transaction unique, séquentielle

| # | Action | Table | Unité | Détail |
|---|--------|-------|-------|--------|
| **1** | **Lock commande** | `commandes` | — | `SELECT ... FOR UPDATE`, vérifie `status = 'ouverte'` |
| **2** | **Idempotence check** | `stock_documents` | — | Si `idempotency_key = 'ship:{commande_id}'` existe déjà → RETURN result idempotent |
| **3** | **Valider inputs** | `commande_lines` | CLIENT | `0 <= shipped_qty <= canonical_quantity`. `rupture` ⟹ `shipped_qty = 0` |
| **4** | **Résoudre BIP** | `b2b_imported_products` | — | **`DISTINCT ON (cl.id)`** + `ORDER BY bip.imported_at ASC`. Temp table `_ship_lines` avec `supplier_product_id`, `supplier_zone_id` |
| **5** | **Convertir → fournisseur** | `_ship_lines` | **FOURNISSEUR** | `supplier_qty = fn_convert_b2b_quantity(shipped_qty_client, unit_mapping)`. Si conversion impossible → ligne traitée comme `rupture` + `conversion_error` loggé |
| **6** | **Appeler `fn_post_stock_document`** | `stock_documents`, `stock_document_lines`, `stock_events` | **FOURNISSEUR** | Type=WITHDRAWAL, `source_order_id=commande_id`, `source_line_id=line_id`. Le moteur central gère : snapshot bootstrap, clamp V2, écriture atomique doc_lines=events |
| **7** | **Lire quantités effectives** | `stock_events` | **FOURNISSEUR** | Pour chaque ligne : `effective_supplier_qty = ABS(delta_quantity_canonical)` du stock_event correspondant. Si pas d'event (clampé à 0) → `effective_supplier_qty = 0` |
| **8** | **Back-convertir → client** | calcul pur | **CLIENT** | `effective_client_qty = fn_convert_b2b_quantity_reverse(effective_supplier_qty)` |
| **9** | **Écriture UNIQUE shipped_quantity** | `commande_lines` | **CLIENT** | `shipped_quantity = effective_client_qty`. `line_status` dérivé : `= 0` → `'rupture'`, `< canonical_quantity` → `'modifie'`, `= canonical_quantity` → `'ok'` |
| **10** | **Transition commande** | `commandes` | — | `status='expediee'`, `shipped_by`, `shipped_at` |

#### Ce qui est INTERDIT dans ce flow

- ❌ Écrire `shipped_quantity` avant l'étape 9
- ❌ Écrire directement dans `stock_events` (tout passe par `fn_post_stock_document`)
- ❌ JOIN sur BIP sans `DISTINCT ON`
- ❌ Écrire une valeur en unité fournisseur dans `commande_lines`
- ❌ Sync/correction après coup
- ❌ Utiliser `LIMIT 1` sans `ORDER BY`

#### Garanties

| Garantie | Comment |
|----------|---------|
| `shipped_quantity` = unité CLIENT | Back-conversion explicite (étape 8) |
| `shipped_quantity` écrite 1 seule fois | Étape 9 est la seule UPDATE |
| `stock_document_lines` = `stock_events` | Moteur central (`fn_post_stock_document`) |
| Pas de rupture fantôme | `line_status` dérivé de la quantité EFFECTIVE |
| Déterministe | `DISTINCT ON` + `ORDER BY imported_at ASC` |
| Idempotent | `idempotency_key` check à l'étape 2 |

---

### 4.b RÉCEPTION — `fn_receive_commande` (cible V2)

#### Frontend → Backend

```json
{
  "commande_id": "uuid",
  "lines": [
    { "line_id": "uuid", "received_quantity": 8 }
  ]
}
```

`received_quantity` est en unité CLIENT (le client saisit dans ses propres unités).

#### Étapes

| # | Action | Table | Unité | Détail |
|---|--------|-------|-------|--------|
| **1** | Lock commande | `commandes` | — | `FOR UPDATE`, `status = 'expediee'` |
| **2** | Idempotence check | `stock_documents` | — | `idempotency_key = 'recv:{commande_id}'` |
| **3** | Valider | `commande_lines` | CLIENT | `received_quantity >= 0` |
| **4** | Écrire `received_quantity` | `commande_lines` | **CLIENT** | ÉCRITURE UNIQUE |
| **5** | `fn_post_stock_document` | stock_* | **CLIENT** | Type=RECEIPT, `source_order_id`, `source_line_id`. Stock client augmente |
| **6** | Détecter écarts | logique | CLIENT | `∀ line: received_qty ≠ shipped_qty` → écart |
| **7** | Créer litige atomique | `litiges`, `litige_lines` | CLIENT | Snapshots des quantités CLIENT + `stock_event_ids` |
| **8** | Transition | `commandes` | — | `recue` ou `litige` |

#### Garanties

- ✅ `received_quantity` en CLIENT, écriture unique
- ✅ Stock client via moteur central
- ✅ Comparaison `received` vs `shipped` = même référentiel (CLIENT)
- ✅ Idempotent

---

### 4.c LITIGE — Basé sur le ledger (voir section 7)

---

### 4.d INVENTAIRE — Inchangé (déjà correct)

Le module inventaire est **isolé et PASS** :
- Sessions de comptage immutables
- `inventory_lines` append-only
- `zone_stock_snapshots` créent un nouveau `snapshot_version_id`
- Stock = snapshot + Σ(events filtrés par `snapshot_version_id` ET `canonical_family`)

**Aucun changement requis.**

---

### 4.e FACTURATION — `fn_generate_app_invoice`

#### Changement unique

```sql
-- AVANT (BUGGY) :
WHERE cl.line_status != 'rupture'

-- APRÈS (CORRECT) :
WHERE COALESCE(cl.received_quantity, 0) > 0
```

**Pourquoi** : Le `line_status` peut être historiquement corrompu (ruptures fantômes). La `received_quantity` est la vérité : si le client a reçu, c'est facturable.

#### Montant

```
line_total = received_quantity × unit_price_snapshot
```

Les deux sont en unité CLIENT → mathématiquement cohérent.

---

### 4.f VOID — `fn_void_stock_document`

Inchangé. Le void :
- Inverse les `stock_events` (clampé à 0 minimum)
- Traçabilité via `voids_event_id` et `voids_document_id`
- **NE modifie PAS** `commande_lines` (design choice accepté)

⚠️ **Conséquence** : Un void après expédition annule le stock mais laisse `shipped_quantity` dans commande_lines. C'est voulu : le void est un outil de correction stock, pas un outil commande. Si on veut "annuler une expédition", c'est un flow métier séparé à construire.

---

## 5. TRAÇABILITÉ COMPLÈTE

### 5.1 Chaîne de traçabilité

```
commande_lines.id ←──── stock_document_lines.source_line_id
        │                       │
        │                       ▼
        │               stock_events.document_id ──→ stock_documents.id
        │                       │
        │                       ▼
        │               stock_documents.source_order_id ──→ commandes.id
        │
        ▼
  litige_lines.commande_line_id
        │
        ▼
  litiges.commande_id ──→ commandes.id
```

### 5.2 Nouvelle colonne requise : `source_line_id`

```sql
ALTER TABLE stock_document_lines 
  ADD COLUMN source_line_id UUID REFERENCES commande_lines(id);
```

**Effet** : Chaque mouvement stock peut être relié à UNE ligne de commande spécifique, pas seulement à la commande globale.

### 5.3 Auditabilité

Pour n'importe quelle ligne de commande, on peut reconstruire :

```sql
-- Quel stock a été réellement débité pour cette ligne ?
SELECT se.delta_quantity_canonical, se.canonical_unit_id, mu.name
FROM stock_events se
JOIN stock_documents sd ON sd.id = se.document_id
JOIN stock_document_lines sdl ON sdl.document_id = sd.id AND sdl.product_id = se.product_id
JOIN measurement_units mu ON mu.id = se.canonical_unit_id
WHERE sdl.source_line_id = '{commande_line_id}';
```

---

## 6. IDEMPOTENCE & CONCURRENCE

### 6.1 Idempotence

#### Mécanisme

Chaque opération a une `idempotency_key` unique sur `stock_documents` :

| Opération | Clé | Garantie |
|-----------|-----|----------|
| Expédition | `ship:{commande_id}` | 1 expédition par commande |
| Réception | `recv:{commande_id}` | 1 réception par commande |
| Litige | `litige_adj:{litige_id}` | 1 ajustement par litige |

#### Comportement en cas de doublon

```sql
-- Dans fn_ship_commande, étape 2 :
IF EXISTS (
  SELECT 1 FROM stock_documents 
  WHERE idempotency_key LIKE 'ship:' || p_commande_id::text || '%'
    AND status = 'POSTED'
) THEN
  -- Retourner le résultat existant, pas d'erreur
  RETURN jsonb_build_object(
    'ok', true, 
    'idempotent', true,
    'message', 'already_shipped'
  );
END IF;
```

**Effet** : Un retry réseau ne crée JAMAIS de double mouvement stock.

### 6.2 Concurrence

#### Problème

2 utilisateurs cliquent "Expédier" en même temps.

#### Solution : Lock pessimiste sur commande

```sql
-- Étape 1 : SELECT ... FOR UPDATE
SELECT * INTO v_commande FROM commandes WHERE id = p_commande_id FOR UPDATE;
```

**Effet** : Le deuxième utilisateur est bloqué jusqu'à la fin de la transaction du premier. Quand il passe, le status est déjà `expediee` → il reçoit `invalid_status`.

#### Pas de version optimiste

On utilise le lock pessimiste (`FOR UPDATE`) plutôt que le versioning optimiste (`lock_version`) parce que :
- Les transitions de status sont unidirectionnelles (`ouverte → expediee`)
- Le check de status après lock est suffisant
- Plus simple, pas de retry loop côté client

### 6.3 Rollback métier

#### Scénario : Stock partiellement disponible

**Décision** : PARTIEL (pas FAIL total, pas SPLIT)

Quand le stock est insuffisant pour une ligne :
- Le moteur central CLAMPE à la quantité disponible (≥ 0)
- La back-conversion donne la quantité effective en CLIENT
- `shipped_quantity` reflète ce qui a RÉELLEMENT été sorti

**Il n'y a pas de "partial success"** : la transaction est atomique. TOUTES les lignes sont traitées, certaines avec clamp. L'expédition est TOUJOURS complète au sens métier (toutes les lignes ont un `line_status`).

---

## 7. LITIGE — BASÉ SUR LE LEDGER

### 7.1 Le problème de V1

Dans V1 :
```
litige_delta = shipped_quantity - received_quantity  (commande_lines)
```

**Pourquoi c'est dangereux** : Si `shipped_quantity` est corrompu (bug step 5f), le delta est faux, et l'ajustement stock détruit le stock fournisseur.

### 7.2 Le design V2

Le litige est TOUJOURS calculé à partir de données fiables :

```
litige_delta = shipped_quantity - received_quantity  (litige_lines, snapshots CLIENT)
```

**Mais** la fiabilité est garantie par le design V2 de `fn_ship_commande` :
- `shipped_quantity` est dérivé du stock réel (post-clamp, back-converti)
- `received_quantity` est l'input direct du client

**Les deux sont en unité CLIENT** → la soustraction est mathématiquement valide.

### 7.3 Stockage des preuves dans litige_lines

```sql
CREATE TABLE litige_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  litige_id UUID REFERENCES litiges(id) NOT NULL,
  commande_line_id UUID REFERENCES commande_lines(id) NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  -- Snapshots CLIENT (copie au moment de la création du litige)
  shipped_quantity NUMERIC NOT NULL,      -- copie de commande_lines.shipped_quantity (CLIENT)
  received_quantity NUMERIC NOT NULL,     -- copie de commande_lines.received_quantity (CLIENT)
  -- Référence au stock réel
  ship_stock_event_id UUID,              -- NOUVEAU : lien vers le stock_event de l'expédition
  -- Résolution
  resolution_type TEXT,                   -- 'adjusted' | 'accepted' | null
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 7.4 `fn_resolve_litige` — Flow V2

| # | Action | Table | Unité |
|---|--------|-------|-------|
| **1** | Lock litige + commande | `FOR UPDATE` | — |
| **2** | Idempotence check | `stock_documents` | `idempotency_key = 'litige_adj:{litige_id}'` |
| **3** | Calculer deltas | `litige_lines` | **CLIENT** |
| **4** | Résoudre BIP | `DISTINCT ON` | — |
| **5** | Convertir deltas → fournisseur | `fn_convert_b2b_quantity` | **FOURNISSEUR** |
| **6** | `fn_post_stock_document` | stock_* | **FOURNISSEUR** |
| **7** | Update statuts | `litiges`, `commandes` | — |

**Delta** :
- `delta > 0` (shipped > received) = MANQUE → le fournisseur RÉCUPÈRE du stock (+RECEIPT fournisseur)
- `delta < 0` (received > shipped) = SURPLUS → le fournisseur PERD du stock (-WITHDRAWAL fournisseur, clampé)

### 7.5 Pourquoi ce design est safe

1. `shipped_quantity` dans `litige_lines` est un **snapshot figé** au moment de la création du litige
2. Ce snapshot vient de `commande_lines.shipped_quantity` qui est elle-même dérivée du **stock réel** (V2)
3. Le delta est calculé en **unité CLIENT** → pas de mélange de référentiels
4. La conversion vers fournisseur pour l'ajustement stock est **explicite et traçable**
5. Le moteur central CLAMPE → pas de stock négatif

---

## 8. MODÈLE DE DONNÉES CIBLE

### 8.1 `commande_lines` — Champs et vérité

| Colonne | Référentiel | Écrite par | Nb écritures | Moment |
|---------|-------------|------------|:------------:|--------|
| `canonical_quantity` | CLIENT | `fn_send_commande` | **1** | Envoi |
| `canonical_unit_id` | CLIENT | `fn_send_commande` | **1** | Envoi |
| `unit_price_snapshot` | CLIENT | `fn_send_commande` | **1** | Envoi |
| `line_total_snapshot` | CLIENT | `fn_send_commande` | **1** | Envoi |
| `shipped_quantity` | **CLIENT** | `fn_ship_commande` (étape 9) | **1** | Expédition |
| `line_status` | — | `fn_ship_commande` (étape 9) | **1** | Expédition |
| `received_quantity` | CLIENT | `fn_receive_commande` | **1** | Réception |

**INVARIANT** : Aucun champ ne contient jamais une valeur en unité fournisseur.

### 8.2 `stock_documents` — Changements

| Colonne | Existant | Nouveau |
|---------|----------|---------|
| `source_order_id` | ✅ Existe | Inchangé |
| `idempotency_key` | ✅ Existe | Utilisé pour idempotence |

### 8.3 `stock_document_lines` — Changements

| Colonne | Existant | Nouveau |
|---------|----------|---------|
| `source_line_id` | ❌ N'existe pas | **AJOUT** — FK vers `commande_lines.id` |
| `delta_quantity_canonical` | Pre-clamp (buggy) | **POST-CLAMP** (= `stock_events`) |

### 8.4 `litige_lines` — Changements

| Colonne | Existant | Nouveau |
|---------|----------|---------|
| `ship_stock_event_id` | ❌ N'existe pas | **AJOUT** — lien vers le stock_event d'expédition |

### 8.5 `b2b_imported_products` — Contrainte

```sql
ALTER TABLE b2b_imported_products
ADD CONSTRAINT uq_bip_local_est_source
UNIQUE (local_product_id, establishment_id, source_establishment_id);
```

### 8.6 `fn_post_stock_document` — Extension

Le moteur central doit accepter un nouveau paramètre optionnel :

```sql
p_source_line_ids UUID[]  -- Optionnel, pour écrire source_line_id dans stock_document_lines
```

Cela permet de maintenir la traçabilité ligne par ligne sans casser les autres appelants.

---

## 9. CE QUI DOIT DISPARAÎTRE

### 9.1 Liste exhaustive

| # | Élément à supprimer | Pourquoi | Remplacement |
|---|---------------------|----------|--------------|
| D1 | Step 5f sync | Réécrit shipped_qty en unité fournisseur | Back-conversion explicite (étape 8-9) |
| D2 | Écriture inline de stock_events (étape 5e actuelle) | Bypass du moteur central | `fn_post_stock_document` |
| D3 | Écriture inline de stock_document_lines (étape 5d) | Divergence doc_lines vs events | `fn_post_stock_document` |
| D4 | Bootstrap snapshot inline (étape 5a) | Logique dupliquée | `fn_post_stock_document` (qui le fait déjà) |
| D5 | Double écriture shipped_qty (provisoire puis finale) | Source de confusion | Écriture unique étape 9 |
| D6 | JOINs non-protégés sur BIP | Produit cartésien | `DISTINCT ON` + `ORDER BY imported_at` |
| D7 | Clamp inline (GREATEST dans INSERT) | Logique dupliquée, divergence | Clamp centralisé dans moteur |
| D8 | `WHERE line_status != 'rupture'` dans facturation | Ruptures fantômes | `WHERE received_quantity > 0` |

### 9.2 Code actuel à supprimer (`fn_ship_commande`)

Lignes 521-647 du SQL actuel (étapes 5a-5e) doivent être remplacées par UN SEUL appel à `fn_post_stock_document` :

```sql
-- AVANT : ~130 lignes de bypass (bootstrap, doc insert, doc_lines insert, events insert avec clamp inline)
-- APRÈS : ~15 lignes
PERFORM fn_post_stock_document(
  p_document_id := v_doc_id,
  p_establishment_id := v_commande.supplier_establishment_id,
  p_organization_id := v_org_id,
  p_storage_zone_id := v_zone_id,
  p_type := 'WITHDRAWAL',
  p_lines := v_stock_lines,  -- supplier_qty (post-conversion)
  p_source_order_id := p_commande_id,
  p_source_line_ids := v_source_line_ids,
  p_created_by := p_user_id,
  p_idempotency_key := v_idemp_key
);
```

---

## 10. INVARIANTS SYSTÈME

### 10.1 Invariants de données (assertions vérifiables par SQL)

| # | Invariant | Requête diagnostic |
|---|-----------|-------------------|
| **INV-01** | `shipped_quantity` est TOUJOURS en unité CLIENT | `JOIN measurement_units mu ON mu.id = cl.canonical_unit_id WHERE mu.establishment_id != c.client_establishment_id` → 0 rows |
| **INV-02** | `shipped_quantity` écrite UNE SEULE FOIS | Pas de double UPDATE dans le code |
| **INV-03** | `Σ(stock_document_lines.delta) = Σ(stock_events.delta)` par document POSTED | Requête CROSS JOIN LATERAL → 0 rows |
| **INV-04** | Aucun `stock_event` écrit hors `fn_post_stock_document` | Code review — GREP `INSERT INTO stock_events` → uniquement dans fn_post_stock_document |
| **INV-05** | Aucun stock négatif | `GROUP BY (product, establishment) HAVING SUM(delta) < -0.001` → 0 rows |
| **INV-06** | Aucun doublon BIP | `UNIQUE(local_product_id, establishment_id, source_establishment_id)` constraint |
| **INV-07** | Tout JOIN BIP utilise `DISTINCT ON` + `ORDER BY imported_at` | Code review |
| **INV-08** | Idempotence : 1 ship = 1 document | `COUNT(DISTINCT id) FROM stock_documents WHERE source_order_id = X AND type = 'WITHDRAWAL'` ≤ nombre de zones |
| **INV-09** | Traçabilité : chaque stock_event B2B a un source_line_id | `WHERE source_line_id IS NULL AND event_reason = 'B2B_SHIPMENT'` → 0 rows |
| **INV-10** | Facture = reçu × prix | `app_invoice_lines.quantity = commande_lines.received_quantity` ET `app_invoice_lines.unit_price = commande_lines.unit_price_snapshot` |

### 10.2 Invariants de flow

| # | Invariant | Mécanisme |
|---|-----------|-----------|
| **FLOW-01** | L'expédition ne corrompt PAS la réception | `fn_ship_commande` ne touche PAS `received_quantity` |
| **FLOW-02** | La réception ne touche PAS le stock fournisseur | `fn_receive_commande` écrit dans le stock CLIENT uniquement |
| **FLOW-03** | Le litige ne modifie PAS `shipped_quantity` ni `received_quantity` | `fn_resolve_litige` ne fait que des ajustements stock |
| **FLOW-04** | L'inventaire ne masque PAS un bug stock | Snapshot = rebase total, événements filtrés par version |
| **FLOW-05** | Le void ne modifie PAS `commande_lines` | `fn_void_stock_document` opère uniquement sur stock_events |
| **FLOW-06** | Aucune opération ne peut être exécutée 2 fois | `idempotency_key` UNIQUE sur stock_documents |

---

## 11. STRATÉGIE DE MIGRATION

### Phase 0 — Nettoyage (avant tout changement de code)

#### 0.a Nettoyer doublons BIP
```sql
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY local_product_id, establishment_id, source_establishment_id 
    ORDER BY imported_at ASC
  ) as rn FROM b2b_imported_products
)
DELETE FROM b2b_imported_products WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE b2b_imported_products
ADD CONSTRAINT uq_bip_local_est_source
UNIQUE (local_product_id, establishment_id, source_establishment_id);
```

#### 0.b Corriger shipped_quantity corrompues (commandes actives)

Script manuel, cas par cas, pour les commandes en statut `expediee` ou `litige` :
1. Lire le `stock_event` associé (via `stock_documents.source_order_id`)
2. Back-convertir la quantité effective (fournisseur → client) via le `unit_mapping`
3. Réécrire `shipped_quantity` en unité client
4. Corriger `line_status` si nécessaire

**Commandes `cloturee`** : Non corrigées (trace historique).

#### 0.c Corriger divergences stock_document_lines vs stock_events

```sql
UPDATE stock_document_lines sdl
SET delta_quantity_canonical = se.delta_quantity_canonical
FROM stock_events se
WHERE se.document_id = sdl.document_id
  AND se.product_id = sdl.product_id
  AND sdl.document_id IN (/* liste des documents divergents */);
```

### Phase 1 — Schema (non-breaking)

1. Ajouter `source_line_id` sur `stock_document_lines` (nullable)
2. Ajouter `ship_stock_event_id` sur `litige_lines` (nullable)
3. Contrainte UNIQUE sur BIP (fait en 0.a)

### Phase 2 — Réécriture `fn_ship_commande` (breaking)

1. Créer `fn_convert_b2b_quantity_reverse`
2. Réécrire `fn_ship_commande` selon le design V2 (section 4.a)
3. Adapter `fn_post_stock_document` pour accepter `source_line_ids`

### Phase 3 — Mise à jour `fn_resolve_litige`

1. `DISTINCT ON` sur JOIN BIP
2. Idempotence via `idempotency_key`
3. Vérifier que delta est en CLIENT (garanti par Phase 2)

### Phase 4 — Facturation

1. `WHERE COALESCE(received_quantity, 0) > 0` au lieu de `WHERE line_status != 'rupture'`

### Phase 5 — Validation

1. Exécuter TOUS les diagnostics INV-01 à INV-10 → 0 rows chacun
2. Tester TOUS les scénarios (section 12)
3. Monitoring 1 semaine

### Rollback

Chaque phase est une migration SQL séparée. L'ancienne version de chaque fonction est dans l'historique des migrations. Un `CREATE OR REPLACE` avec l'ancien code permet un rollback immédiat.

---

## 12. PLAN DE TEST

### 12.1 Scénarios normaux

| # | Scénario | Résultat attendu |
|---|----------|------------------|
| T-01 | Expédition complète | `shipped_qty = canonical_qty` (CLIENT), stock_event négatif (FOURNISSEUR) |
| T-02 | Expédition partielle | `shipped_qty < canonical_qty`, `line_status = 'modifie'` |
| T-03 | Rupture réelle | `shipped_qty = 0`, `line_status = 'rupture'`, PAS de stock_event |
| T-04 | Réception conforme | Pas de litige, `status = 'recue'` |
| T-05 | Réception avec manque | Litige créé, `delta > 0` |
| T-06 | Réception avec surplus | Litige créé, `delta < 0` |

### 12.2 Scénarios de conversion B2B

| # | Input (CLIENT) | Conversion | Stock dispo (FOURNISSEUR) | stock_event | shipped_qty FINALE (CLIENT) |
|---|---------------|------------|---------------------------|-------------|------------------------------|
| T-10 | 800 Pièces | ÷800 = 1 Paquet | 5 Paquets | -1 Paquet | 800 Pièces |
| T-11 | 800 Pièces | ÷800 = 1 Paquet | 0.5 Paquet | -0.5 Paquet | 400 Pièces (back-conv) |
| T-12 | 800 Pièces | ÷800 = 1 Paquet | 0 Paquet | ∅ (pas d'event) | 0 Pièces (rupture) |
| T-13 | 2 Cartons | ×10 = 20 Boîtes | 15 Boîtes | -15 Boîtes | 1.5 Cartons (back-conv) |

### 12.3 Scénarios extrêmes

| # | Scénario | Résultat attendu |
|---|----------|------------------|
| T-20 | Stock = 0 pour toutes les lignes | Toutes `rupture`, pas de stock_event, commande `expediee` |
| T-21 | Double clic "Expédier" | 2e appel retourne `{ ok: true, idempotent: true }` |
| T-22 | 2 users expédient simultanément | 2e user reçoit `invalid_status` |
| T-23 | Retry réseau (même payload) | Idempotent, pas de double mouvement |
| T-24 | Conversion impossible (pas de BFS path) | Ligne en `rupture` + log `conversion_error` |
| T-25 | Doublon BIP tenté | Rejeté par contrainte UNIQUE |
| T-26 | Void après expédition | Stock inversé, `commande_lines` inchangé |
| T-27 | Litige sur données V2 | Delta correct car shipped_qty = réalité stock |

### 12.4 Scénarios de non-régression

| # | Ce qui NE DOIT PAS arriver |
|---|---------------------------|
| T-30 | `shipped_qty` en unité fournisseur |
| T-31 | `stock_document_lines ≠ stock_events` |
| T-32 | Rupture fantôme (stock débité mais `line_status = 'rupture'`) |
| T-33 | Double mouvement stock pour une même commande |
| T-34 | Litige basé sur `shipped_qty` corrompue |

### 12.5 Test de rejouabilité

```
SI je supprime toutes les données et rejoue :
  commande_1 + même input fournisseur + même stock initial
→ J'obtiens EXACTEMENT le même stock final ?

RÉPONSE : OUI, car :
  1. Idempotency_key empêche les doublons
  2. DISTINCT ON + ORDER BY imported_at rend le BIP lookup déterministe
  3. Le clamp est une fonction pure du stock courant
  4. Pas de LIMIT 1 sans ORDER BY
```

---

## 13. ZONES D'INCERTITUDE

### Z-01 : Précision de la back-conversion

La back-conversion (fournisseur → client) avec `NUMERIC` est exacte pour les facteurs rationnels.
- 800 ÷ 800 × 800 = 800 ✅
- 5 ÷ 800 = 0.00625 → clamp → × 800 = 5 ✅

**Risque résiduel** : Facteurs irrationnels (1/3). Mitigation : stocker le factor comme `NUMERIC` exact, pas `FLOAT`.

### Z-02 : `fn_post_stock_document` — Extension

Le moteur central doit être modifié pour accepter `source_line_ids`. C'est un changement backward-compatible (paramètre optionnel, NULL par défaut).

**Impact** : Tous les appelants existants continuent de fonctionner.

### Z-03 : Commandes Plats

Le module `commande_plats` n'a AUCUNE intégration stock. Ce design ne le couvre pas. Si une intégration stock est requise, le même pattern (moteur central) devra être appliqué.

### Z-04 : Données historiques corrompues (statut `cloturee`)

Les commandes clôturées avec `shipped_quantity` en unité fournisseur ne seront PAS corrigées. Elles restent comme trace historique. Seuls les calculs futurs sont impactés positivement par le nouveau design.

---

*Ce document est l'architecture de production finale. Aucun code n'a été modifié.*
*Prochaine étape : implémentation selon les phases 0→5.*
