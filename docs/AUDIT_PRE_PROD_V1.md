# AUDIT GLOBAL PRE-PRODUCTION V1 — RAPPORT FINAL COMPLET

> **Date :** 2026-03-31  
> **Objectif :** Répondre à la question : *"Peut-on lancer la V1 stock/réception/retrait/inventaire/commandes/factures en confiance totale ?"*

---

## 1. RÉSUMÉ EXÉCUTIF

L'architecture cœur (Stock Engine, BFS, pipeline ledger, sécurité Edge Function) est **solide et production-ready**. Le stock ne peut pas devenir négatif (clamp universel SQL). Aucune double source de vérité n'existe sur les données critiques. Le resolver de saisie (UQM) est unique et unifié sur tous les flows.

**Cependant**, la V1 est **opérationnellement bloquée** par un déficit de configuration :
- **425/433 produits** (98%) n'ont pas de `product_input_config` → le modal de saisie (UQM) refuse de s'ouvrir
- **1 seul produit** sans zone de stockage (`CAS-A EAU PLATE TEST` dans FO) — produit test
- **10 produits** ont des événements de stock avec family mismatch → stock estimé faussé
- **4 imports B2B** ont un `unit_mapping` null → risque de crash commandes B2B
- **4 produits** sans `supplier_billing_unit_id`

| Axe | Score | Détail |
|-----|-------|--------|
| **Architecture** | 9/10 | SSOT respectées, pipeline unique, clamp universel |
| **Opérationnel** | 3/10 | 98% des produits non exploitables en saisie |
| **Risque de reset** | FAIBLE | Si corrections de masse appliquées |

---

## 2. SOURCES DE VÉRITÉ

| Sujet | Source de vérité | Double source ? | Verdict |
|-------|-----------------|-----------------|---------|
| Structure produit | `products_v2` | ❌ Non | ✅ OK |
| Unité canonique stock | `products_v2.stock_handling_unit_id` | ❌ Non | ✅ OK |
| Conversions BFS | `conditionnement_config` JSONB + `measurement_units` | ❌ Non | ✅ OK |
| Config saisie | `product_input_config` | ❌ Non | ✅ OK |
| Stock courant | `zone_stock_snapshots` + `Σ stock_events` (filtrés par family) | ❌ Non | ✅ OK |
| Prix | `products_v2.final_unit_price` + `price_display_unit_id` | ❌ Non | ✅ OK |
| Fournisseurs | `invoice_suppliers` (UUID FK) | ❌ Non | ✅ OK |
| Import B2B | `b2b_imported_products` + `unit_mapping` JSONB | ❌ Non | ✅ OK |
| Zone stockage | `products_v2.storage_zone_id` (SSOT) / `inventory_zone_products` (assignment inventaire) | ⚠️ Dualité | Voir §7 |
| Mutualisation | `inventory_mutualisation_groups` + `_members` | ❌ Non | ✅ OK |

---

## 3. AUDIT B2B / MUTUALISATION / IMPORT

### 3.1 État des imports

| Métrique | Valeur | Verdict |
|----------|--------|---------|
| Total imports actifs | 163 | — |
| Orphelins (local supprimé) | 0 | ✅ OK |
| Orphelins (local archivé) | 1 (LIMONADE MELOGRANO) | ⚠️ WARNING |
| Imports sans `unit_mapping` | 4 | 🔴 À CORRIGER |
| Tous les locaux ont canonical | 163/163 | ✅ OK |
| Tous les locaux ont zone | 163/163 | ✅ OK |
| Cohérence `b2b_imported_products` ↔ `products_v2` | 100% | ✅ OK |
| Création produit local bien initialisé (stock/zone) | Oui (`b2bImportPipeline.ts` exige `storageZoneId`) | ✅ OK |
| Divergence mutualisé vs non mutualisé | Aucune | ✅ OK |

### 3.2 Imports sans unit_mapping (À CORRIGER)

| Produit local | Source |
|---------------|--------|
| MASCARPONE GRANAROLO | Nonna Secret |
| HUILE D'OLIVE 5L | Nonna Secret |
| PRODUIT Y - HUILE AMPHORE | Piccolo Magnifiko |
| Burrata 125G | Nonna Secret |

**Impact :** `fn_convert_b2b_quantity` échouera lors de la création/envoi de commandes B2B pour ces produits.

### 3.3 Mutualisation

| Vérification | Résultat | Verdict |
|-------------|----------|---------|
| Groupes actifs | 12 | ✅ OK |
| Membres totaux | 29 | ✅ OK |
| Tous les carriers existent et actifs | Oui | ✅ OK |
| Redirection import → carrier | Implémentée | ✅ OK |
| Coherence Gate (famille unique par groupe) | Implémentée | ✅ OK |
| État partiel (import incomplet) | Non détecté | ✅ OK |
| Résidus orphelins | 0 | ✅ OK |

---

## 4. CARTOGRAPHIE RUNTIME COMPLÈTE DES FLOWS MÉTIER

### Légende
- **Resolver** = `resolveInputUnitForContext` (SSOT unique)
- **UQM** = `UniversalQuantityModal`
- **QMWR** = `QuantityModalWithResolver` (wrapper UQM + resolver)
- **EF** = Edge Function `stock-ledger`
- **BFS** = `buildCanonicalLine` (conversion → canonical)

| Flow | Composant | Modal/Saisie | Resolver | Context | Unité affichée | Unité écrite | Conversion | Fallback ? | Statut |
|------|-----------|-------------|----------|---------|---------------|-------------|------------|-----------|--------|
| **Réception desktop** | `ReceptionView.tsx` | UQM directe | `resolveInputUnitForContext` | `reception` | config `reception_*` | canonical via BFS | `convertToCanonical` | ❌ | ✅ OK |
| **Réception mobile** | `MobileReceptionView.tsx` | UQM directe | `resolveInputUnitForContext` | `reception` | config `reception_*` | canonical via BFS | `convertToCanonical` | ❌ | ✅ OK |
| **Retrait desktop** | `WithdrawalView.tsx` | QMWR | `resolveInputUnitForContext` | `internal` | config `internal_*` | canonical via BFS | BFS dans QMWR | ❌ | ✅ OK |
| **Retrait mobile** | `MobileWithdrawalView.tsx` | UQM directe | `resolveInputUnitForContext` | `internal` | config `internal_*` | canonical via BFS | `convertToCanonical` | ❌ | ✅ OK |
| **Inventaire comptage** | `useCountingModal.ts` → `CountingModal.tsx` | UQM embedded | `resolveInputUnitForContext` | `internal` | config `internal_*` | canonical via BFS | BFS dans useCountingModal | ❌ | ✅ OK |
| **Inventaire correction** | `InventoryProductDrawer` | QMWR | `resolveInputUnitForContext` | `adjustment` → `internal` | config `internal_*` | canonical via EF | BFS dans QMWR | ❌ | ✅ OK |
| **Inventaire clôture** | `inventorySessionService` | N/A (backend) | N/A | N/A | N/A | snapshot `zone_stock_snapshots` | RPC `fn_complete_inventory` | N/A | ✅ OK |
| **Commande nouvelle** | `NouvelleCommandeDialog` | QMWR | `resolveInputUnitForContext` | `order` → `internal` | config `internal_*` | canonical via BFS | BFS dans QMWR | ❌ | ✅ OK |
| **Commande détail** | `CommandeDetailDialog` | QMWR | `resolveInputUnitForContext` | `order` → `internal` | config `internal_*` | canonical via BFS | BFS dans QMWR | ❌ | ✅ OK |
| **Préparation** | `PreparationDialog` | QMWR | `resolveInputUnitForContext` | `order` → `internal` | config `internal_*` | canonical via BFS | BFS + B2B translation | ❌ | ✅ OK |
| **BL App correction** | `BlAppCorrectionDialog` | QMWR | `resolveInputUnitForContext` | `correction` → `internal` | config `internal_*` | canonical via EF | BFS dans QMWR | ❌ | ✅ OK |
| **BL Retrait correction** | `BlRetraitCorrectionDialog` | QMWR | `resolveInputUnitForContext` | `correction` → `internal` | config `internal_*` | canonical via EF | BFS dans QMWR | ❌ | ✅ OK |
| **Achats / OCR review** | `ProductLineDrawer` (Vision AI) | Wizard produit | `resolveProductUnitContext` (affichage) | N/A | display context | N/A (pas d'écriture stock) | N/A | Non | ✅ OK |

### Verdicts cartographie

- ✅ **Saisie DÉJÀ UNIFIÉE** — Tous les flows de mutation passent par `resolveInputUnitForContext` via QMWR ou UQM directe
- ✅ **Aucun flow n'utilise de fallback local** — config manquante = modal bloqué
- ✅ **Aucune divergence mobile/desktop** — mêmes resolvers, même pipeline
- ✅ **Affichage et écriture utilisent la même conversion** (BFS)
- ✅ **Les commandes utilisent `contextType="order"` → mappé à `internal`** — conforme à la cible

### Cas particulier des commandes

| Question | Réponse |
|----------|---------|
| Les commandes utilisent-elles `product_input_config.internal_*` ? | ✅ OUI — via `contextType="order"` → `toInputContext()` → `"internal"` |
| Contournent-elles la logique unifiée ? | ❌ NON — les 3 composants (Nouvelle, Détail, Préparation) utilisent `QuantityModalWithResolver` |
| `resolveProductUnitContext` encore utilisé ? | Oui, dans `PreparationDialog` et `useErpQuantityLabels` pour l'**affichage** prix/unité B2B (pas la saisie) |
| Migration nécessaire ? | ❌ NON — la saisie est déjà sur le resolver SSOT. L'affichage utilise correctement `resolveProductUnitContext` pour le contexte B2B fournisseur |
| Risque | Aucun — display-only, n'écrit rien |

---

## 5. AUDIT STOCK NÉGATIF

### 5.1 Mécanisme de protection

| Couche | Mécanisme | Détail |
|--------|-----------|--------|
| **SQL (fn_post_stock_document)** | Clamp universel INSERT (step 10) | `GREATEST(raw_delta, -GREATEST(current_stock, 0))` |
| **SQL (trigger)** | `trg_guard_stock_event_unit_ownership` | Empêche insertion cross-tenant |
| **SQL** | Family validation | `canonical_family` obligatoire, filtrage par famille |
| **Frontend** | `postGuards.ts` | Validation pré-POST (DRAFT, snapshot, lock_version) |
| **Frontend** | Pas d'UI optimiste | Stock jamais modifié avant confirmation serveur |
| **Edge Function** | `stock-ledger` | Seul point d'entrée (RPC révoquée pour `authenticated`) |

### 5.2 État DB actuel

```
Produits avec stock négatif : 0
```

### 5.3 Uniformité du clamp par flow

| Flow | Passe par fn_post_stock_document ? | Clamp ? |
|------|-----------------------------------|---------|
| Réception | ✅ Oui (EF stock-ledger) | ✅ (delta positif) |
| Retrait | ✅ Oui (EF stock-ledger) | ✅ Clamp universel |
| Correction BL App | ✅ Oui (EF stock-ledger) | ✅ Clamp universel |
| Correction BL Retrait | ✅ Oui (EF stock-ledger) | ✅ Clamp universel |
| Ajustement rapide | ✅ Oui (EF stock-ledger) | ✅ Clamp universel |
| Expédition B2B | ✅ Oui (fn_ship_commande → fn_post) | ✅ Clamp universel |
| Inventaire clôture | ❌ Non (écrit zone_stock_snapshots) | N/A (reset snapshot) |

### 5.4 Le clamp masque-t-il des erreurs ?

**Oui, partiellement.** Si un retrait de 10kg est demandé avec 3kg en stock, le système écrit -3kg sans alerter l'utilisateur. Le champ `was_clamped` + `clamped_count` existent mais **l'UI ne les affiche pas systématiquement**.

**Risque réel :** Faible. Le clamp protège le ledger. L'utilisateur voit le stock avant saisie.

### 5.5 Contournements possibles

| Vecteur | Possible ? | Détail |
|---------|-----------|--------|
| Appel direct RPC fn_post_stock_document | ❌ Non | REVOKE pour `authenticated` |
| Modification directe stock_events | ❌ Non | RLS + pas de INSERT pour authenticated |
| Inventaire aberrant | ⚠️ Théorique | Fausse le snapshot (responsabilité terrain) |
| Concurrence (2 retraits simultanés) | ❌ Non | `FOR UPDATE` dans fn_post |

### 5.6 Code mort / deprecated autour du stock négatif

| Élément | Statut | Danger |
|---------|--------|--------|
| `checkNegativeStock` (postGuards.ts) | Exporté, utilisé dans tests uniquement | ❌ Aucun — le vrai garde-fou est SQL |
| `override_flag` (DB + voidEngine) | Existe, toujours `false` | ❌ Aucun — cosmétique |

### 5.7 Verdict stock négatif

**✅ Stock négatif IMPOSSIBLE sur tous les flows de mutation standard.**  
**⚠️ Un comptage inventaire aberrant peut fausser le snapshot (responsabilité terrain, pas un bug).**

---

## 6. DEAD CODE / DANGEROUS CODE AUDIT

### 6.1 Code mort sans danger

| Élément | Type | Atteignable ? | Danger ? | Action |
|---------|------|--------------|----------|--------|
| `SimpleQuantityPopup.tsx` (331 lignes) | Composant | ❌ 0 imports | ❌ Non | Supprimer |
| `useEstablishmentNavConfig.ts` | Hook | ❌ 0 imports | ❌ Non | Supprimer |
| `useMultiSelect.ts` | Hook | ❌ 0 imports | ❌ Non | Supprimer |
| `backfill-b2b-unit-mapping` | Edge Function | ❌ Maintenance | ❌ Non | Conserver |
| `backfill-invoice-snapshots` | Edge Function | ❌ Maintenance | ❌ Non | Conserver |
| `backfill-product-codes` | Edge Function | ❌ Maintenance | ❌ Non | Conserver |
| `backfill-products-ssot` | Edge Function | ❌ Maintenance | ❌ Non | Conserver |

### 6.2 Code deprecated ENCORE ATTEIGNABLE

| Élément | Type | Danger ? | Détail | Action |
|---------|------|----------|--------|--------|
| `resolveProductUnitContext` | Fonction core | ⚠️ Moyen | Utilisé dans ~35 fichiers pour **affichage** (pas saisie). Correct pour commandes/inventaire display. | Audit + migration progressive |
| `inventory_display_unit_id` | Colonne DB + 3 composants | ⚠️ Moyen | Utilisé dans `EstimatedStockCell`, `StockBreakdownCell`, `useDesktopStock` | Migrer vers resolver |
| `checkNegativeStock` | Fonction postGuards | ⚠️ Faible | Exporté index.ts, logique réelle = clamp SQL | Supprimer export |
| `usePreferredUnits` | Hook | ⚠️ Faible | Résidu dans CountingModal | Vérifier et supprimer si mort |
| `resolveFullModeConfig` | Fonction UQM | ⚠️ Faible | Helper interne, pas un resolver alternatif | Vérifier |
| `withdrawal_unit` / `withdrawal_mode` refs | Commentaires | ⚠️ Faible | Dans resolver = commentaire/mapping vers `internal_*` | Nettoyer |
| `override_flag` | Champ DB + types | ❌ Non | Toujours `false` | Cosmétique |

### 6.3 Verdict dead code

**Aucun code mort ne peut fausser le stock ou corrompre les données.** Les résidus dangereux sont des fonctions d'**affichage** (`resolveProductUnitContext`, `inventory_display_unit_id`) qui n'écrivent rien. **Non bloquant pour le lancement V1.**

---

## 7. UNIFICATION DE LA ZONE DE STOCKAGE

### 7.1 Cartographie des sources

| Table/Champ | Rôle | Source de vérité ? | Qui lit ? | Qui écrit ? |
|-------------|------|-------------------|-----------|-------------|
| `products_v2.storage_zone_id` | Zone par défaut du produit | ✅ SSOT | `fn_post_stock_document`, `fn_initialize_product_stock`, `b2bImportPipeline`, wizard | Wizard produit, import B2B, édition produit |
| `inventory_zone_products` | Assignation produit↔zone pour l'inventaire | ⚠️ Secondaire (inventaire) | Module inventaire (comptage par zone, sélection zone) | Inventaire setup, `ZoneActionDialog` |
| `zone_stock_snapshots` | Snapshot de stock par zone | Cache (résultat) | StockEngine, lectures stock | `fn_post_stock_document` (auto), `fn_complete_inventory` |
| `stock_events` | Événements de mouvement | Résultat (FK zone) | StockEngine | `fn_post_stock_document` |

### 7.2 Cohérence actuelle (requête DB)

| Métrique | Valeur | Verdict |
|----------|--------|---------|
| Produits actifs total | 433 | — |
| Produits sans `products_v2.storage_zone_id` | **1** (`CAS-A EAU PLATE TEST` — FO) | ✅ Quasi-parfait |
| Entrées `inventory_zone_products` | 175 | — |
| Mismatch `izp.storage_zone_id` ≠ `products_v2.storage_zone_id` | **0** | ✅ OK |
| Produits dans `izp` mais sans zone dans `products_v2` | **0** | ✅ OK |

### 7.3 L'invariant "impossible de créer un produit sans zone"

| Chemin de création | Zone obligatoire ? | Mécanisme | Verdict |
|-------------------|-------------------|-----------|---------|
| Wizard produit fournisseur (`ProductFormV3Modal`) | ⚠️ NON imposé en DB | Le wizard passe `storageZoneId \|\| null` — pas de validation bloquante côté DB (`storage_zone_id IS NULL` est autorisé) | ⚠️ FUITE POSSIBLE |
| Import produit client B2B (`b2bImportPipeline`) | ✅ OUI en code | `storageZoneId: string` est requis dans le type — le popup `B2BZoneSelectDialog` impose la sélection | ✅ OK |
| Mise à jour produit | ⚠️ NON protégé | `updateProduct` accepte `storage_zone_id: null` | ⚠️ FUITE POSSIBLE |
| Duplication / scripts | ⚠️ NON protégé | Pas de contrainte DB NOT NULL | ⚠️ FUITE POSSIBLE |

**Conclusion zone :** La contrainte `storage_zone_id NOT NULL` n'existe pas en DB. L'invariant est maintenu uniquement par le code UI (wizard + import). **Risque faible** en pratique (1 seul produit test sans zone), mais une contrainte DB serait la vraie garantie.

### 7.4 Verdict zones

**Dualité SANS RISQUE actuel.** `products_v2.storage_zone_id` est la SSOT lue par le pipeline stock. `inventory_zone_products` est un système d'assignation parallèle pour l'inventaire. Les deux sont cohérents à 100% aujourd'hui. Pas de divergence détectée.

---

## 8. FACTURES / OCR / ACHATS

### 8.1 Flow OCR (Vision AI)

| Étape | Source de vérité | Unité | Impact stock ? | Verdict |
|-------|-----------------|-------|---------------|---------|
| Upload facture PDF | `invoices` table | N/A | ❌ Non | ✅ OK |
| Extraction AI | EF `vision-ai-extract` | Texte brut extrait | ❌ Non | ✅ OK |
| Matching produit | `matchProductV2` (nom normalisé) | N/A | ❌ Non | ✅ OK |
| Création/édition produit | `ProductFormV3Modal` (Wizard) | UUID via `stock_handling_unit_id` | ❌ Non | ✅ OK |
| Review lignes | `ProductLineDrawer` | `resolveProductUnitContext` (affichage) | ❌ Non | ✅ OK |
| Validation | `createInvoice` | Snapshot immuable | ❌ Non | ✅ OK |

### 8.2 Achats

| Étape | Source | Écriture | Impact stock ? | Verdict |
|-------|--------|----------|---------------|---------|
| Création lignes achat | `purchaseService` | `purchase_line_items` | ❌ Non | ✅ OK |
| Récap mensuel | `fetchMonthlyPurchaseSummary` | Lecture join `products_v2` | ❌ Non | ✅ OK |
| Affichage unité | `billing_unit_label` snapshot | N/A | N/A | ✅ OK |

### 8.3 Risques

| Risque | Possible ? | Impact | Verdict |
|--------|-----------|--------|---------|
| Afficher mauvaise unité dans review | ⚠️ Faible — `resolveProductUnitContext` correct pour display | Cosmétique | ✅ OK |
| Matcher sur logique legacy | ❌ Non — `matchProductV2` = `name_normalized` | N/A | ✅ OK |
| Impact stock depuis OCR | ❌ Impossible — jamais d'écriture `stock_events` | N/A | ✅ OK |
| Incohérence silencieuse | ❌ Non — snapshots immuables | N/A | ✅ OK |

**Verdict : Les flows OCR/Achats sont sûrs et isolés du ledger.**

---

## 9. PRODUCT HEALTH — 2 AXES SÉPARÉS

### 9.A Santé STRUCTURELLE (données produit)

| Critère | OK | WARNING | ERROR | Détail |
|---------|---:|--------:|------:|--------|
| Canonical unit définie | 433 | 0 | 0 | 100% ✅ |
| BFS valide (conditionnement_config) | ~430 | ~3 | 0 | Rares configs vides |
| Fournisseur défini (supplier_id) | 433 | 0 | 0 | 100% ✅ |
| Billing unit définie | 429 | 0 | **4** | 4 produits sans `supplier_billing_unit_id` |
| Zone de stockage assignée | **432** | 0 | **1** | 1 produit test FO |
| Family mismatch dans ledger | 423 | 0 | **10** | 10 produits avec événements incohérents |

**Score structurel : 418/433 (96.5%) pleinement sains | 15 avec anomalies mineures**

### 9.B Santé OPÉRATIONNELLE (exploitabilité en saisie)

| Critère | OK | WARNING | ERROR | Détail |
|---------|---:|--------:|------:|--------|
| `product_input_config` présente | **8** | 0 | **425** | 98% non configurés |
| UQM exploitable (config OK) | **~5** | **~3** | **425** | Quasi-totalité bloquée |

**Score opérationnel : 8/433 (1.8%) exploitables en saisie | 425 (98.2%) bloqués**

### 9.C Synthèse croisée

| Catégorie | Count | % | Description |
|-----------|------:|--:|-------------|
| ✅ Pleinement opérationnel | ~5 | 1% | Config + zone + canonical + BFS OK |
| ⚠️ Structure OK, config manquante | ~413 | 95% | Zone OK, canonical OK, mais pas de `product_input_config` |
| 🔴 Structure incomplète + config manquante | ~15 | 4% | Family mismatch, billing unit manquant, ou zone manquante |

**⚠️ Un produit structurellement sain mais sans `product_input_config` est INUTILISABLE pour le lancement.**

---

## 10. TABLEAU DES RISQUES

| # | Risque | Gravité | Module | Impact métier | Verdict |
|---|--------|---------|--------|--------------|---------|
| 1 | **425 produits sans input_config** | 🔴 CRITIQUE | Saisie | UQM bloqué → impossible réception/retrait/comptage | **BLOQUANT** |
| 2 | **10 produits family mismatch** | 🟠 ÉLEVÉ | Stock | Stock estimé faux pour ces 10 produits | **À CORRIGER** |
| 3 | **4 imports B2B sans unit_mapping** | 🟠 ÉLEVÉ | Commandes | Crash conversion B2B | **À CORRIGER** |
| 4 | **4 produits sans billing unit** | 🟡 MOYEN | Factures | Prix non résolvable | **À CORRIGER** |
| 5 | **1 produit test sans zone** | 🟢 FAIBLE | Stock | fn_post rejettera les mouvements | Nettoyage |
| 6 | **1 import B2B sur produit archivé** | 🟢 FAIBLE | B2B | Résidu cosmétique | Nettoyage |
| 7 | **DB: storage_zone_id nullable** | 🟡 MOYEN | Intégrité | Fuite possible si contournement UI | Contrainte DB |
| 8 | **Clamp silencieux sans feedback UI** | 🟡 MOYEN | Retrait | Utilisateur pas informé | V1.1 |

---

## 11. STRATÉGIE DE CORRECTION

### A. Saisie — Déjà unifiée ✅

| Vérification | Résultat |
|-------------|----------|
| Une seule logique de saisie partout | ✅ OUI — `resolveInputUnitForContext` via QMWR/UQM |
| `reception_*` pour réception | ✅ OUI |
| `internal_*` pour tout le reste | ✅ OUI (retrait, inventaire, commandes, corrections, ajustements) |
| Plus aucun flow qui déduit depuis la structure produit | ✅ OUI — config manquante = modal bloqué |

**Verdict saisie : DÉJÀ UNIFIÉE** — Aucune correction de code nécessaire. Seule la génération de masse des configs est requise.

### B. Zones — Dualité sans risque actuel ✅

| Vérification | Résultat |
|-------------|----------|
| Une seule SSOT zone pour le stock | ✅ `products_v2.storage_zone_id` |
| `inventory_zone_products` = assignation secondaire | ✅ Cohérent à 100% avec la SSOT |
| Fuite possible (zone nullable en DB) | ⚠️ OUI théorique, 1 seul cas réel |

**Verdict zones : DUALITÉ SANS RISQUE** — Recommandation : ajouter `NOT NULL` + `DEFAULT` sur `storage_zone_id` après nettoyage du produit test.

---

## 12. CORRECTIONS OBLIGATOIRES AVANT LANCEMENT

| # | Correction | Pourquoi | Risque si non fait | Bloquant ? |
|---|-----------|----------|-------------------|-----------|
| **1** | Générer `product_input_config` pour 425 produits | UQM bloqué sur 98% des produits | Aucune saisie possible | 🔴 OUI |
| **2** | Corriger 10 produits family mismatch | Stock estimé faux | Écarts stock visibles | 🟠 OUI |
| **3** | Réparer 4 imports B2B `unit_mapping` null | Crash commandes B2B | Commandes B2B cassées | 🟠 OUI |
| **4** | Ajouter `supplier_billing_unit_id` à 4 produits | Prix non résolvable | Facturation incomplète | 🟡 OUI |
| **5** | Assigner zone au produit test FO | fn_post rejettera | 1 produit inutilisable | 🟢 NON (produit test) |
| **6** | Nettoyer lien B2B archivé | Résidu | Aucun impact | 🟢 NON |

---

## 13. VERDICT V1 FINAL

### ⚠️ V1 LANÇABLE APRÈS 4 CORRECTIONS OBLIGATOIRES

**La V1 est structurellement prête.** L'architecture est solide (9/10), le pipeline stock est sécurisé, la saisie est unifiée. Les corrections requises sont **100% des données à configurer** — aucun code à réécrire.

**Après les corrections #1 à #4 :**

> ✅ La V1 aura une logique de saisie unique et une source de vérité zone unifiée.
> Aucun reset ne sera nécessaire. Le stock sera protégé. La saisie sera exploitable sur 100% des produits.

**Estimation effort total : ~4h de scripts de masse + corrections manuelles.**

---

*Fin de l'audit pré-production V1 — 2026-03-31*
