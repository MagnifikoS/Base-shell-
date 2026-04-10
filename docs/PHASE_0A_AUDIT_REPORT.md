# PHASE 0A — RAPPORT D'AUDIT BIP & DONNÉES RÉELLES

**Date :** 2026-03-27  
**Statut :** ✅ AUDIT TERMINÉ — EN ATTENTE DE VALIDATION  
**Aucune modification n'a été effectuée.**

---

## 1. AUDIT BIP (b2b_imported_products)

### 1.1 Doublons

| Métrique | Valeur |
|----------|--------|
| Total BIP | 400 |
| Paires uniques (source_product_id, establishment_id) | 400 |
| Surplus (doublons) | **0** |

**→ AUCUN doublon détecté.**

### 1.2 Contrainte UNIQUE

```
b2b_imported_products_establishment_id_source_product_id_so_key
UNIQUE (establishment_id, source_product_id, source_establishment_id)
```

**→ Contrainte UNIQUE DÉJÀ EN PLACE.** Aucune migration nécessaire.

### 1.3 FK entrantes vers BIP

| Tables référençant BIP | Résultat |
|------------------------|----------|
| commande_lines | ❌ Aucune FK directe |
| stock_documents | ❌ Aucune FK directe |
| litiges | ❌ Aucune FK directe |
| app_invoices | ❌ Aucune FK directe |

**→ BIP est utilisé uniquement en JOIN dynamique (pas de FK).** Nettoyage safe par nature.

### 1.4 Couverture unit_mapping

400/400 BIP ont un `unit_mapping` → **couverture 100%** (confirmé par le monitoring B2B).

---

## 2. DIAGNOSTIC STOCK

### 2.1 Stocks négatifs

| Métrique | Valeur |
|----------|--------|
| Produits avec solde négatif | **55** |

**→ 55 produits en stock négatif.** Cause probable : bypass du moteur stock central dans `fn_ship_commande` (step 5e écrit directement dans `stock_events` avec clamp inline au lieu de passer par `fn_post_stock_document`).

### 2.2 Divergence stock_document_lines vs stock_events

| Type document | Status | Nb docs | SDL count | SE count | Delta |
|---------------|--------|---------|-----------|----------|-------|
| RECEIPT | POSTED | 199 | 764 | 818 | **+54** |
| WITHDRAWAL | POSTED | 670 | 1212 | 1205 | **-7** |
| ADJUSTMENT | POSTED | 258 | 247 | 538 | **+291** |
| RECEIPT_CORRECTION | POSTED | 4 | 6 | 7 | **+1** |
| INITIAL_STOCK | POSTED | 23 | 0 | 23 | **+23** |

**→ Divergences significatives :**
- **ADJUSTMENT** : 247 SDL vs 538 SE — ratio 2.18x. Probablement des quick adjustments qui créent des SE sans SDL correspondant.
- **RECEIPT** : +54 SE de plus que SDL — possible duplication d'événements.
- **INITIAL_STOCK** : 23 SE sans SDL — par design (pas de ligne de document pour les stocks initiaux).

### 2.3 shipped_quantity suspectes

| Ligne | Produit | Commandé (client) | Expédié | Diagnostic |
|-------|---------|-------------------|---------|------------|
| abe56e87... | SERVIETTE TABLE | 800 | 1.0000 | 🔴 **SUSPECT : unité fournisseur écrite en champ client** |

**→ 1 ligne confirmée corrompue** — 800 serviettes commandées (pièces client), 1.0000 expédié (probablement 1 carton fournisseur écrit sans back-conversion).

### 2.4 Ruptures sans trace stock_event

| Métrique | Valeur |
|----------|--------|
| Total ruptures (commandes expédiées+) | 200 |
| Ruptures SANS stock_event correspondant | **196** |
| Ruptures AVEC stock_event | 4 |

**→ 98% des ruptures n'ont AUCUNE trace dans le ledger.** C'est le symptôme principal du design actuel : quand `shipped_quantity = 0`, aucun `stock_event` n'est créé, rendant impossible l'audit de la décision de rupture.

### 2.5 Idempotency keys

| Doublons idempotency_key | **0** |
|--------------------------|-------|

**→ Aucun double mouvement de stock détecté.** Le système actuel est safe de ce côté.

---

## 3. DIAGNOSTIC FACTURATION

### fn_generate_app_invoice — Analyse du filtre

```sql
-- Total HT
WHERE cl.commande_id = p_commande_id
  AND COALESCE(cl.received_quantity, 0) > 0

-- Lignes facturées  
WHERE cl.commande_id = p_commande_id
  AND COALESCE(cl.received_quantity, 0) > 0
```

**→ La facturation utilise DÉJÀ `received_quantity > 0`.** Elle ne dépend PAS de `line_status`.

**⚠️ Conséquence pour le plan : la Phase 5 du prompt est INUTILE.** La facturation est déjà conforme au design V3.

---

## 4. DIAGNOSTIC fn_ship_commande (pré-Phase 3)

### Bugs confirmés dans le code actuel

| # | Bug | Impact | Sévérité |
|---|-----|--------|----------|
| 1 | **Step 1** : `line_status` pris du frontend (`v_line_input->>'line_status'`) | Le frontend décide du statut → pas de dérivation serveur | 🔴 CRITIQUE |
| 2 | **Step 1** : `shipped_quantity` écrite AVANT le mouvement de stock | Si le stock est insuffisant, la qty est déjà persistée avec une valeur fausse | 🔴 CRITIQUE |
| 3 | **Step 5e** : INSERT direct dans `stock_events` (bypass `fn_post_stock_document`) | Divergence SDL/SE, pas de gardes centraux | 🔴 CRITIQUE |
| 4 | **Step 5e** : Clamp inline (`GREATEST(-qty, -stock)`) | Logique dupliquée vs moteur central | 🟡 MOYEN |
| 5 | **Step 5f** (si existe) : Sync correctif qui écrase shipped_quantity | Corruption du référentiel d'unité (fournisseur écrit en champ client) | 🔴 CRITIQUE |
| 6 | Pas de `source_line_id` dans SDL | Traçabilité impossible ligne par ligne | 🟡 MOYEN |
| 7 | Conversion non figée | Modification future du mapping BIP = corruption historique | 🟡 MOYEN |

### Dépendances de fn_post_stock_document (Phase 2)

6 fonctions appellent `fn_post_stock_document` :
1. `fn_post_b2b_reception`
2. `fn_resolve_litige`
3. `fn_quick_adjustment`
4. `fn_correct_bl_withdrawal`
5. `fn_receive_commande`
6. `fn_transfer_product_zone`

**→ Toute modification de `fn_post_stock_document` impacte TOUS ces modules.**

---

## 5. ANALYSE DES RISQUES PAR PHASE

### Phase 0 — ✅ RIEN À FAIRE

- 0 doublons BIP
- Contrainte UNIQUE déjà en place
- **Cette phase peut être sautée.**

### Phase 1 (Schema additions) — ✅ SAFE

Ajouter des colonnes nullable (`source_line_id`, `conversion_factor`, `client_unit_id`, `supplier_unit_id`) est non-breaking. Aucun risque.

**Rollback :** `ALTER TABLE ... DROP COLUMN IF EXISTS ...`

### Phase 5 (Facturation) — ⚠️ DÉJÀ FAIT

La facturation filtre déjà sur `received_quantity > 0`. **Aucune modification nécessaire.**

### Phase 3A (fn_ship_commande SQL) — 🔴 RISQUE ÉLEVÉ

| Risque | Description | Mitigation |
|--------|-------------|------------|
| Signature RPC | Si la signature change, l'edge function `commandes-api` crashe | Garder la même signature OU déployer 3A+3B ensemble |
| Double écriture transitoire | Pendant le déploiement, l'ancienne edge function peut envoyer `line_status` que la nouvelle RPC ignore | Rendre la RPC tolérante aux champs ignorés |
| Données corrompues existantes | 1 ligne SERVIETTE TABLE + 196 ruptures sans trace | Ne PAS tenter de corriger rétroactivement |
| fn_post_stock_document pas prêt | Phase 2 pas encore faite → la nouvelle fn_ship doit continuer à bypass | Option: fn_ship_commande_v3 en parallèle |

**Recommandation :** Créer `fn_ship_commande_v3` plutôt que remplacer. Switcher l'edge function une fois les tests validés.

### Phase 3B (Edge function) — 🟡 RISQUE MOYEN

| Risque | Description |
|--------|-------------|
| Notifications | L'edge function utilise `line_status` du payload pour les notifications partielles |
| Payload format | Le frontend envoie `line_status` — l'edge function doit l'ignorer sans crasher |

### Phase 3C (Frontend) — 🟡 RISQUE MOYEN

| Risque | Description |
|--------|-------------|
| UX temporaire | Si le backend dérive `line_status`, le frontend doit afficher le résultat serveur, pas l'état local |
| `updateLinePreparation()` | Doit être neutralisée mais vérifier qu'aucun autre flow ne l'utilise |

### Phase 4 (Réception + Litiges) — 🟡 RISQUE MOYEN

Fonctions déjà isolées. Risque principal : cohérence avec la nouvelle fn_ship_commande_v3.

### Phase 2 (fn_post_stock_document) — 🔴 RISQUE MAXIMAL

| Risque | Description |
|--------|-------------|
| 6 fonctions impactées | Tout changement affecte inventaire, BL, retraits, ajustements |
| CLAMP_ZERO | Ajouter des events delta=0 peut surprendre les lecteurs de stock |
| source_line_id | Les 6 fonctions doivent le passer — ou il doit être nullable |

---

## 6. FAILLES IDENTIFIÉES DANS LE PLAN D'IMPLÉMENTATION

### Faille 1 : Phase 0 est vide
Le plan prévoit un nettoyage BIP qui n'est pas nécessaire (0 doublons, contrainte déjà en place). **On peut passer directement à Phase 1.**

### Faille 2 : Phase 5 est déjà conforme
La facturation utilise déjà `received_quantity > 0`. **Aucune modification requise.**

### Faille 3 : Phase 3A sans fn_post_stock_document
Le plan dit "utiliser fn_post_stock_document" en Phase 3A, mais Phase 2 (modification de fn_post_stock_document) est prévue EN DERNIER. **Contradiction :**
- Si fn_ship utilise fn_post_stock_document actuel → pas de CLAMP_ZERO, pas de source_line_id
- Si fn_ship garde le bypass → on ne résout pas le bug de divergence SDL/SE

**Solution proposée :** Phase 3A utilise `fn_post_stock_document` tel quel (il fonctionne pour WITHDRAWAL). Le CLAMP_ZERO et source_line_id seront ajoutés en Phase 2. La fn_ship_v3 les remplira quand disponibles.

### Faille 4 : Pas de stratégie pour les données corrompues existantes
- 55 stocks négatifs
- 1 shipped_quantity en mauvaise unité
- 196 ruptures sans trace

**Recommandation :** NE PAS corriger rétroactivement. Documenter comme "dette historique pré-V3" et s'assurer que la V3 empêche de nouveaux cas.

### Faille 5 : Risque de déploiement atomique Phase 3
Si 3A (SQL) est déployé avant 3B (edge function), l'edge function envoie encore `line_status` mais la nouvelle RPC l'ignore → les notifications de statut partiel ne fonctionnent plus. **Il faut déployer 3A+3B ensemble ou rendre la transition gracieuse.**

---

## 7. ORDRE D'IMPLÉMENTATION RÉVISÉ

```
Phase 0  → SKIP (déjà clean)
Phase 1  → Schema additions (safe, nullable columns)
Phase 5  → SKIP (déjà conforme)
Phase 3A → fn_ship_commande_v3 (nouvelle fonction, bypass stock maintenu temporairement)
Phase 3B → Edge function (switcher vers v3)
Phase 3C → Frontend (supprimer line_status envoi)
Phase 4  → Réception + Litiges + Cancel
Phase 2  → fn_post_stock_document (CLAMP_ZERO + source_line_id)
Phase 2b → Migrer fn_ship_commande_v3 vers fn_post_stock_document
```

---

## 8. EN ATTENTE DE VALIDATION

**Questions pour décision :**

1. **Phase 0 & 5 :** Confirmer qu'on les skip (données déjà clean, facturation déjà conforme) ?
2. **Phase 3A :** Préférez-vous `fn_ship_commande_v3` (nouvelle fonction) ou remplacement direct ?
3. **Données corrompues :** Acceptez-vous de ne PAS les corriger rétroactivement ?
4. **Phase 3A+3B :** Déploiement synchrone ou gracieux (backward-compatible) ?

**⚠️ AUCUNE IMPLÉMENTATION NE SERA LANCÉE SANS VALIDATION EXPLICITE.**
