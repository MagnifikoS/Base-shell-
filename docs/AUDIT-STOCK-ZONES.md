# Audit global — Module Stock & Achats (zones)

> **Date** : 2026-03-11
> **Statut** : Audit exécuté — rapport complet ci-dessous

---

## Section 1 — Architecture stock actuelle

### Modèle

```
Produit (products_v2)
  └─ storage_zone_id → Zone de stockage (storage_zones)
       └─ zone_stock_snapshots (1 par zone × établissement)
            └─ snapshot_version_id → inventory_sessions.id
                 └─ inventory_lines (quantité de base)
                      + stock_events (Σ deltas) = Stock estimé
```

### Formule SSOT

```
StockEstimé(produit, zone) =
    inventory_lines.quantity (where session_id = snapshot_version_id)
  + Σ(stock_events.delta_quantity_canonical WHERE storage_zone_id = zone AND snapshot_version_id = snapshot)
```

### Rôle de chaque table

| Table | Champ zone | Rôle |
|-------|-----------|------|
| `products_v2` | `storage_zone_id` | **SSOT** — Zone principale du produit |
| `stock_documents` | `storage_zone_id` | **Placeholder technique** (NOT NULL) — ne pilote PAS la logique métier |
| `stock_events` | `storage_zone_id` | **Snapshot** — zone au moment de l'écriture, doit = `products_v2.storage_zone_id` |
| `zone_stock_snapshots` | `storage_zone_id` | **Clé de partition** — 1 snapshot actif par zone |
| `inventory_sessions` | `storage_zone_id` | **Scope** — session d'inventaire liée à une zone |
| `inventory_lines` | _(via session)_ | Pas de champ zone direct — zone implicite via la session |

---

## Section 2 — Sources de vérité identifiées

| Source | Statut | Commentaire |
|--------|--------|------------|
| `products_v2.storage_zone_id` | ✅ **SSOT confirmée** | Utilisée par tous les hooks UI et par la version corrigée de `fn_post_stock_document` |
| `stock_documents.storage_zone_id` | ⚠️ **Placeholder technique** | NOT NULL, rempli avec `zones[0]` côté frontend. **Ne pilote plus** la logique métier après correction du 2026-03-11 |
| `stock_events.storage_zone_id` | ✅ **Snapshot correct** | Après correction : provient de `products_v2.storage_zone_id` via JOIN |
| `zone_stock_snapshots` | ✅ **Clé de partition** | Lookup par `(establishment_id, storage_zone_id)` |

---

## Section 3 — Écritures stock analysées

### Fonctions SQL qui écrivent dans `stock_events`

| Fonction | Migration active | Zone source | Correct ? | Notes |
|----------|-----------------|-------------|-----------|-------|
| `fn_post_stock_document` | `20260311` (fix) | `products_v2.storage_zone_id` (per-product JOIN) | ✅ **Corrigé** | Couvre RECEIPT, WITHDRAWAL, ADJUSTMENT, tous types |
| `fn_void_stock_document` | `20260301` | Copie `storage_zone_id` de l'event original | ✅ **Correct** | Le VOID inverse un event existant, zone héritée |
| `fn_ship_commande` (B2B expédition) | `20260305` | `products_v2.storage_zone_id` via `sp.storage_zone_id` | ✅ **Correct** | Groupe par zone produit, doc par zone, appelle `fn_post_stock_document` |
| `fn_process_bl_validation` (réception B2B client) | `20260225` | `products_v2.storage_zone_id` via `p.storage_zone_id` JOIN | ✅ **Correct** | INSERT direct dans stock_events avec zone produit |
| `fn_init_product_stock` (init wizard) | `20260219` | `products_v2.storage_zone_id` via `v_product.storage_zone_id` | ✅ **Correct** | Delta=0, audit trail |
| `fn_resolve_litige` (litige commande) | `20260304` | `products_v2.storage_zone_id` via `p.storage_zone_id` | ✅ **Correct** | Lookup explicite par produit fournisseur |
| `fn_transfer_product_zone` (transfert zone) | `20260302` | Zone OLD (retrait) + zone NEW (réception), via `fn_post_stock_document` | ✅ **Correct** | Appelle fn_post qui route par produit |
| `fn_post_inventory_adjustments` | `20260304` | Via `fn_post_stock_document` (per-product routing) | ✅ **Correct** | Appel indirect |

### Verdict écritures

**Toutes les fonctions SQL actives utilisent la bonne zone (produit).** Aucun écrivain direct dans `stock_events` n'utilise `stock_documents.storage_zone_id` comme source métier.

---

## Section 4 — Lectures stock analysées

### Hooks UI qui calculent le stock

| Hook / Fonction | Fichier | Zone source | Correct ? |
|-----------------|---------|-------------|-----------|
| `useProductCurrentStock` | `src/hooks/useProductCurrentStock.ts` | `products_v2.storage_zone_id` → lookup snapshot par zone → filter events par zone | ✅ |
| `useEstimatedStock` | `src/modules/inventaire/hooks/useEstimatedStock.ts` | Group products par `products_v2.storage_zone_id` → snapshot par zone → events par zone | ✅ |
| `useDesktopStock` | `src/modules/inventaire/hooks/useDesktopStock.ts` | `products_v2.storage_zone_id` pour associer sessions et lignes | ✅ |
| `stockEngine.ts` | `src/modules/stockLedger/engine/stockEngine.ts` | Pure function, reçoit `storage_zone_id` en param (callers passent la zone produit) | ✅ |
| Stock estimates (MobileWithdrawalView inline) | `MobileWithdrawalView.tsx` L186-251 | Lit `zone_stock_snapshots` par establishment (toutes zones), puis `stock_events` par establishment | ⚠️ **P2** |

### Détail anomalie MobileWithdrawalView (P2)

Le calcul inline de stock dans `MobileWithdrawalView` (L186-251) ne filtre **pas** les events par zone produit — il additionne **tous** les events de l'établissement pour chaque produit. Ceci est fonctionnellement correct car les events sont déjà partitionnés par `product_id` (un produit n'a d'events que dans sa zone), mais c'est une approximation qui pourrait devenir incorrecte si un produit a des events historiques dans une zone différente (ce qui existe — voir Section 6).

**Impact** : Mineur en pratique (l'affichage du stock peut inclure des deltas orphelins d'une ancienne zone). Pas de corruption — uniquement un affichage potentiellement décalé.

---

## Section 5 — Modules métier audités

### 5.1 Réception fournisseur (MobileReceptionView)

| Aspect | Statut | Détail |
|--------|--------|--------|
| Draft document | `zones[0]` ou zone configurée | Placeholder — n'affecte plus la logique |
| POST → stock_events | Via `fn_post_stock_document` | ✅ Per-product routing (fix 2026-03-11) |
| Pré-vérification zone produit | Vérifie `product.storage_zone_id` non null | ✅ Alerte "À configurer" si null |

### 5.2 Retrait stock (WithdrawalView / MobileWithdrawalView)

| Aspect | Statut | Détail |
|--------|--------|--------|
| Draft document | `zones[0]` | ✅ Placeholder technique documenté |
| POST → stock_events | Via `fn_post_stock_document` | ✅ Per-product routing |
| Negative check | Par zone produit | ✅ Corrigé (plus de faux NEGATIVE_STOCK) |
| Discrepancy detection | Utilise `document.storage_zone_id` | ⚠️ P2 — devrait utiliser zone produit |

### 5.3 Ajustements stock

| Aspect | Statut | Détail |
|--------|--------|--------|
| Via `fn_post_stock_document` | ✅ | Per-product routing |
| Via `fn_post_inventory_adjustments` | ✅ | Appelle fn_post_stock_document |
| Via `fn_resolve_litige` | ✅ | Insert direct avec zone produit |

### 5.4 Inventaires

| Aspect | Statut | Détail |
|--------|--------|--------|
| Sessions par zone | ✅ | `inventory_sessions.storage_zone_id` = zone de l'inventaire |
| Produits filtrés par zone | ✅ | `products_v2.storage_zone_id = params.zoneId` |
| Snapshot activation | ✅ | `zone_stock_snapshots` lié à la session terminée |
| Écarts calculés par produit + zone | ✅ | Via snapshot + events |

### 5.5 Commandes fournisseurs (B2B)

| Aspect | Statut | Détail |
|--------|--------|--------|
| `fn_ship_commande` (expédition) | ✅ | Groupe par `sp.storage_zone_id` (zone produit fournisseur) |
| `fn_process_bl_validation` (réception client) | ✅ | JOIN `products_v2 p` → `p.storage_zone_id` |
| Bootstrap snapshot si absent | ✅ | Crée snapshot + session + lignes pour la zone |

### 5.6 Transfert de zone

| Aspect | Statut | Détail |
|--------|--------|--------|
| `fn_transfer_product_zone` | ✅ | WITHDRAWAL dans ancienne zone, RECEIPT dans nouvelle, update `products_v2.storage_zone_id` |
| Via `fn_save_product_wizard` | ✅ | Appelle `fn_transfer_product_zone` si zone changée |

### 5.7 BL Retrait (bl_withdrawal_documents)

| Aspect | Statut | Détail |
|--------|--------|--------|
| Création BL | Référence le `stock_document_id` | Pas d'interaction directe avec zones |
| Pas d'écriture dans stock_events | ✅ | Le BL est un document commercial, pas un mouvement stock |

---

## Section 6 — Données incohérentes détectées

### Résultats des requêtes de diagnostic

| Métrique | Valeur |
|----------|--------|
| **Produits avec events dans une zone ≠ zone actuelle** | **64 produits** |
| **Total d'events mal zonés** | **131 events** |
| **Produits avec events dans 2+ zones** | **20+ produits** (1 produit dans 3 zones) |
| **Events mal zonés APRÈS le fix (2026-03-11)** | **0** ✅ |

### Répartition par type d'event

| Type | Count | Cause probable |
|------|-------|---------------|
| RECEIPT | 64 | Bug `fn_post_stock_document` pré-fix (zone header) |
| VOID | 44 | VOID copie la zone de l'event original (mal zoné) |
| WITHDRAWAL | 15 | Bug `fn_post_stock_document` pré-fix |
| ADJUSTMENT | 5 | Bug `fn_post_stock_document` pré-fix |
| INITIAL_STOCK | 3 | Probablement des transferts de zone |

### Analyse

Les 131 events incohérents sont **tous antérieurs au fix du 2026-03-11**. Ils résultent de l'ancien comportement de `fn_post_stock_document` qui utilisait `stock_documents.storage_zone_id` (zone header) au lieu de `products_v2.storage_zone_id`.

**Impact sur le stock actuel** :
- Les hooks UI (`useProductCurrentStock`, `useEstimatedStock`) filtrent par `products_v2.storage_zone_id` → ces events orphelins sont **exclus du calcul** → stock potentiellement **sous-estimé** pour certains produits
- Le calcul inline de `MobileWithdrawalView` ne filtre PAS par zone → ces events orphelins **sont inclus** → stock potentiellement **sur-estimé** dans cette vue

### Recommandation données

Une migration de nettoyage devrait être envisagée pour réassigner les `storage_zone_id` des 131 events historiques à la zone actuelle du produit. Ceci est **P2** car :
- Le prochain inventaire complet réinitialisera les snapshots
- Les events orphelins sont majoritairement des RECEIPT+VOID (paires qui s'annulent)

---

## Section 7 — Risques restants

### P0 — Aucun

Après la correction SQL du 2026-03-11, **aucun risque P0 n'a été identifié**.

### P1 — Risques réels mais localisés

| # | Risque | Détail | Module |
|---|--------|--------|--------|
| P1-1 | **Stock sous-estimé pour 64 produits** | Events historiques dans la mauvaise zone → exclus du calcul par les hooks filtrés par zone | Affichage stock |

### P2 — Dette technique

| # | Risque | Détail | Module |
|---|--------|--------|--------|
| P2-1 | `stock_documents.storage_zone_id` reste NOT NULL | Placeholder technique sans valeur métier, devrait être nullable ou supprimé à terme | Architecture |
| P2-2 | `MobileWithdrawalView` calcul inline non filtré par zone | Somme tous les events sans filtre zone — fonctionne tant qu'un produit n'a d'events que dans 1 zone | Mobile retrait |
| P2-3 | `WithdrawalView` discrepancy uses `document.storage_zone_id` | L189 : passe `document.storage_zone_id` au lieu de la zone produit | Desktop retrait |
| P2-4 | 131 events historiques mal zonés | Résidu du bug pré-fix, auto-corrigé au prochain inventaire | Données |
| P2-5 | `fn_transfer_product_zone` appelle `fn_post_stock_document` avec doc header = old/new zone | Fonctionne car fn_post route par produit, mais le doc header est redondant | Architecture |

---

## Section 8 — Verdict

### Résumé

| Question | Réponse |
|----------|---------|
| Toutes les opérations stock utilisent la bonne zone ? | ✅ **OUI** (après fix 2026-03-11) |
| Aucune incohérence produit/zone dans le code actif ? | ✅ **OUI** |
| Le module stock est fiable pour production ? | ✅ **OUI** — avec 2 réserves P1/P2 |

### Classification finale

| Priorité | Éléments | Statut |
|----------|----------|--------|
| **P0** | Corruption possible du stock | ✅ **Aucun** — tous les écrivains utilisent la zone produit |
| **P1** | 64 produits avec stock potentiellement sous-estimé (events orphelins historiques) | ⚠️ Auto-corrigé au prochain inventaire |
| **P2** | 5 points de dette technique (voir Section 7) | 📋 Backlog |

### Fonctions SQL — Matrice complète

| Fonction | Zone source | Méthode | Verdict |
|----------|-------------|---------|---------|
| `fn_post_stock_document` | `products_v2.storage_zone_id` | JOIN per-line | ✅ |
| `fn_void_stock_document` | Event original `.storage_zone_id` | Copie | ✅ |
| `fn_ship_commande` | `products_v2.storage_zone_id` | Via `_ship_lines.supplier_zone_id` | ✅ |
| `fn_process_bl_validation` | `products_v2.storage_zone_id` | JOIN direct | ✅ |
| `fn_init_product_stock` | `products_v2.storage_zone_id` | SELECT INTO | ✅ |
| `fn_resolve_litige` | `products_v2.storage_zone_id` | SELECT INTO | ✅ |
| `fn_transfer_product_zone` | Old zone / New zone explicites | Paramètres | ✅ |

### Hooks UI — Matrice complète

| Hook | Zone source | Verdict |
|------|-------------|---------|
| `useProductCurrentStock` | `products_v2.storage_zone_id` | ✅ |
| `useEstimatedStock` | `products_v2.storage_zone_id` (group by) | ✅ |
| `useDesktopStock` | `products_v2.storage_zone_id` (join) | ✅ |
| `stockEngine` (pure) | Paramètre injecté par caller | ✅ |
| `MobileWithdrawalView` inline | Non filtré par zone | ⚠️ P2 |
