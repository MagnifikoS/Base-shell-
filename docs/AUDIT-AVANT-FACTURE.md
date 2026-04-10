# AUDIT AVANT FACTURE — Restaurant OS

**Date** : 2026-03-06  
**Périmètre** : Super module "Stock & Achat" — Commandes, Stock/Ledger, Produits V2, B2B, Prix, Retours, Litiges, DLC  
**Objectif** : Évaluer si la base est suffisamment propre pour démarrer le module Facture

---

## SECTION A — Executive Summary

### Verdict : **GO CONDITIONNEL** ✅🟡

La base est **solide sur le plan architectural** : atomicité des RPCs, idempotence, isolation multi-tenant, ledger append-only, snapshots immutables. Le système est conçu pour la traçabilité et la cohérence transactionnelle.

**Cependant**, 3 risques critiques doivent être adressés avant de facturer :

### 🔴 3 Risques Critiques

| # | Risque | Impact Facture |
|---|--------|----------------|
| 1 | **Aucun prix figé au moment de la commande** — `commande_lines` ne stocke ni `unit_price` ni `line_total`. Le prix vit dans `products_v2.final_unit_price` qui peut changer à tout moment via OCR ou sync B2B. | La facture ne peut pas s'appuyer sur un prix historique fiable. Si le fournisseur change son prix entre l'envoi et la réception, la facture sera fausse. |
| 2 | **Pas de colonne `unit_price_snapshot` sur `commande_lines`** — Contrairement aux `bl_withdrawal_lines` qui snapshotent le prix, les lignes de commande sont financièrement "aveugles". | Impossible de calculer un total facturable sans re-requêter le prix actuel (qui a peut-être changé). |
| 3 | **Les retours n'ont aucun impact financier** — Le module Retours est purement déclaratif (V0). Un retour accepté avec résolution "avoir" ne génère aucune écriture comptable ni correction de valeur. | Si le module Facture doit intégrer les avoirs, il n'a aucune donnée structurée pour le faire. |

### 🟡 5 Points Moyens

1. **`as any` sur le client Supabase** — Tous les services (`commandeService`, `litigeService`, `retourService`, `dlcService`) castent `supabase as any`. Perte de type-safety, risque de régressions silencieuses.
2. **Pas de limite 1000 rows sur `getCommandes`** — Risque de troncature silencieuse pour les établissements à fort volume.
3. **`resolve_commande_actors` appelé systématiquement** — Cascade réseau identifiée comme goulot d'étranglement.
4. **DLC persistée après la réception (fire-and-forget)** — Échec possible sans impact sur la réception, mais données DLC manquantes pour audit.
5. **Pas de statut terminal "clôturée" automatique** — Le passage de `recue` à `cloturee` n'est pas implémenté.

### ✅ Éléments déjà solides

1. **Ledger append-only** avec clés d'idempotence, FOR UPDATE, et VOID/inverse events
2. **Snapshots produit** : `product_name_snapshot`, `unit_label_snapshot` figés à la création de la ligne
3. **`order_number` + `created_by_name_snapshot`** immutables (trigger `trg_commandes_immutable_fields`)
4. **Litige atomique** : créé dans `fn_receive_commande`, résolu dans `fn_resolve_litige` avec corrections stock
5. **Isolation B2B** : produits découplés, pas de FK cross-org, snapshot à l'import
6. **`computeEcart` centralisé** : SSOT pour manque/surplus
7. **DLC compute pur** : `dlcCompute.ts` sans effets de bord

---

## SECTION B — Cartographie des Sources de Vérité

| Domaine | SSOT | Qui écrit | Qui lit | Quand | Garde-fous | Risque double vérité |
|---------|------|-----------|---------|-------|------------|---------------------|
| **Identité commande** | `commandes.id` (UUID) | `createDraftCommande` | Tous les modules | Création | PK auto-gen | ❌ Aucun |
| **Numéro de commande** | `commandes.order_number` | `fn_send_commande` (séquence `CMD-XXXXXX`) | UI liste, détail | À l'envoi uniquement | Trigger `trg_commandes_immutable_fields` bloque modification | ❌ Aucun |
| **Acteur "passée par"** | `commandes.created_by_name_snapshot` | `fn_send_commande` (snapshot du profil) | UI liste, détail | À l'envoi uniquement | Trigger immutabilité | ❌ Aucun |
| **Quantité commandée** | `commande_lines.canonical_quantity` | `upsertCommandeLines` (upsert on conflict) | Préparation, réception, litige | Brouillon + envoyée | RLS + verrouillage ouverte | ❌ Aucun |
| **Quantité expédiée** | `commande_lines.shipped_quantity` | `fn_ship_commande` RPC | Réception, litige | Expédition | FOR UPDATE, validation null/négatif | ❌ Aucun |
| **Quantité reçue** | `commande_lines.received_quantity` | `fn_receive_commande` RPC | Litige, DLC | Réception | FOR UPDATE, validation null/négatif | ❌ Aucun |
| **Litige** | `litiges` + `litige_lines` | `fn_receive_commande` (création atomique) | UI litige, résolution | Réception avec écart | `commande_id` FK, calcul `computeEcart` | ❌ Aucun |
| **Retour** | `product_returns` | `createReturn` (client-side) | UI retours, fournisseur | Post-réception | Déclaratif, pas d'impact DB métier | ❌ Aucun |
| **DLC** | `reception_lot_dlc` | `upsertDlc` / `batchUpsertDlc` (fire-and-forget) | DLC critique, badges | Post-réception | Upsert on `commande_line_id` | ❌ Aucun |
| **Prix fournisseur** | `products_v2.final_unit_price` | OCR Vision AI, Wizard V3, import B2B | Inventaire, BL, Achat | À tout moment | Optimistic locking | ⚠️ **OUI** — pas de snapshot prix sur commande |
| **Prix client synchronisé** | `fn_sync_b2b_price` trigger → `products_v2.final_unit_price` (client) | Trigger auto sur UPDATE fournisseur | Client catalogue, alertes | À chaque modification fournisseur | Fail-open, anti-boucle `pg_trigger_depth()` | ⚠️ Prix client mutable |
| **Alertes prix** | `price_alerts` | `fn_sync_b2b_price` trigger | UI alertes, popup commande | Automatique | Reset daily `seen_at`/`acked_at`, idempotent | ❌ Aucun |
| **Future base facturation** | ⛔ **N'EXISTE PAS** | — | — | — | — | 🔴 **CRITIQUE** |
| **Produits / mapping B2B** | `b2b_imported_products` (bridge table) | Import pipeline | Commandes, préparation | Import | UUID local découplé, snapshot | ❌ Aucun |
| **Stock / ledger** | `stock_events` (append-only) + `inventory_zone_snapshots` | RPCs atomiques (`fn_post_stock_document`) | StockEngine, UI | Chaque mouvement | Idempotency keys, FOR UPDATE, VOID | ❌ Aucun |

---

## SECTION C — Audit de Cohérence Métier Commandes

### Cycle de vie vérifié

| Transition | RPC/Service | Atomicité | Verrouillage | Notifications | Audit Log | Verdict |
|------------|-------------|-----------|--------------|---------------|-----------|---------|
| Brouillon → Envoyée | `fn_send_commande` | ✅ RPC atomique | ✅ `order_number` + `created_by_name_snapshot` figés | ✅ Push + in-app | ✅ `commande_sent` | ✅ Solide |
| Envoyée → Ouverte | `fn_open_commande` | ✅ RPC atomique | ✅ `already_opened` idempotent | ✅ Notif "verrouillée" | ✅ `commande_opened` | ✅ Solide |
| Ouverte → Expédiée | `fn_ship_commande` | ✅ FOR UPDATE + idempotency key `ship:{id}:{zone}` | ✅ Immutable après | ✅ Partielle/Complète | ✅ `commande_shipped` | ✅ Solide |
| Expédiée → Reçue/Litige | `fn_receive_commande` | ✅ FOR UPDATE + idempotency key `receive:{id}:{zone}` | ✅ | ✅ Litige ou réception | ✅ `commande_received` / `commande_litige_created` | ✅ Solide |
| Litige → Résolue/Recue | `fn_resolve_litige` | ✅ Corrections stock atomiques | ✅ | ✅ `commande_litige_resolue` | ✅ `litige_resolved` | ✅ Solide |
| Recue → Clôturée | ⛔ **Non implémenté** | — | — | — | — | 🟡 Manque |

### Points atomiques ✅

- Toutes les transitions passent par des RPCs avec `FOR UPDATE`
- Clés d'idempotence empêchent les doubles mouvements stock
- `updateCommandeNote` vérifie `status = brouillon` (verrouillage client)
- `updateLinePreparation` persiste immédiatement (design décision documentée)
- Réception en mode "brouillon local" — rien n'est persisté avant validation finale

### Points encore fragiles 🟡

1. **Pas de prix sur les lignes** — `commande_lines` ne contient que `canonical_quantity`, `canonical_unit_id`, `product_name_snapshot`, `unit_label_snapshot`. Aucune donnée financière.
2. **Suppression hard du brouillon** — `deleteDraftCommande` fait un DELETE physique (pas de VOID). Acceptable pour un brouillon, mais à surveiller si on veut un audit complet du cycle de vie.
3. **`getCommandes` sans limite** — Risque de troncature à 1000 rows pour les établissements à volume élevé.
4. **`commandeService.ts` utilise `supabase as any`** — Perte de type-safety pour les lignes 10-11.

### 🔴 Question critique pour la facture

> **Sur quelle donnée exacte la facture devra-t-elle s'appuyer ?**

La facture B2B devra se baser sur :

| Donnée | Source actuelle | Suffisant ? |
|--------|----------------|-------------|
| Quantité facturée | `commande_lines.received_quantity` (corrigée par litige si applicable) | ✅ Oui — après résolution litige |
| Prix unitaire | ⛔ **Aucune source figée** | 🔴 NON — `products_v2.final_unit_price` est mutable |
| Produit | `commande_lines.product_name_snapshot` | ✅ Oui — figé |
| Unité | `commande_lines.unit_label_snapshot` + `canonical_unit_id` | ✅ Oui — figé |
| Acteur | `commandes.created_by_name_snapshot` | ✅ Oui — figé |
| N° commande | `commandes.order_number` | ✅ Oui — immutable |
| Date | `commandes.received_at` | ✅ Oui |
| Retours | `product_returns` (déclaratif) | 🟡 Partiel — pas de valeur financière |
| Avoir | ⛔ **N'existe pas** | 🔴 NON |

**Recommandation P0** : Ajouter `unit_price_snapshot` et `line_total_snapshot` sur `commande_lines`, figés au moment de l'envoi (`fn_send_commande`) depuis `products_v2.final_unit_price`, convertis via le graphe BFS si nécessaire.

---

## SECTION D — Audit Stock / Ledger

### Architecture vérifiée

| Composant | État | Commentaire |
|-----------|------|-------------|
| `stock_documents` (DRAFT → POSTED → VOID) | ✅ Solide | Cycle de vie strict |
| `stock_events` (append-only) | ✅ Solide | Jamais de UPDATE/DELETE |
| `fn_post_stock_document` | ✅ Atomique | FOR UPDATE, lock_version, idempotency_key |
| `fn_void_stock_document` | ✅ Atomique | Événements inverses, VOID_BALANCE_ERROR check |
| Expédition → retrait stock fournisseur | ✅ | `fn_ship_commande` avec `override_flag := true` |
| Réception → ajout stock client | ✅ | `fn_receive_commande` avec idempotency key |
| Litige résolu → correction stock fournisseur | ✅ | `fn_resolve_litige` avec delta signé |
| Auto-bootstrap snapshot | ✅ | Session d'inventaire fictive `termine` si nécessaire |
| Context hash (FNV-1a) | ✅ | Piste d'audit complète |
| Negative stock guard | ✅ | 409 + override avec justification |
| Edge function `stock-ledger` | ✅ | Rate limit, RBAC, pas de fuite SQL |

### Ce qui est déjà propre ✅

- Idempotence totale sur ship/receive/resolve
- Aucun mouvement de stock sans document traçable
- VOID crée des événements inverses sans modifier l'historique
- Override avec raison obligatoire pour stock négatif

### Ce qui pourrait créer un conflit avec la facture 🟡

1. **Les documents stock n'ont pas de lien direct avec la commande** — Le `idempotency_key` contient `ship:{commande_id}:{zone}` mais il n'y a pas de FK `commande_id` sur `stock_documents`. Pour la facture, il faudra soit tracer via l'idempotency key (fragile), soit ajouter un champ `source_commande_id`.

2. **Le retour marchandise (V0) n'impacte pas le stock** — Si un produit cassé est retourné physiquement, le stock client ne diminue pas et le stock fournisseur n'augmente pas. Pour V0 Facture c'est acceptable (les retours sont hors périmètre financier), mais à planifier pour V1.

3. **Les corrections de litige sont purement quantitatives** — `fn_resolve_litige` ajuste le stock du delta (manque/surplus) mais ne génère aucune trace financière. La facture devra lire `litige_lines.shipped_quantity` vs `litige_lines.received_quantity` pour calculer l'impact financier.

---

## SECTION E — Audit B2B

### Architecture vérifiée

| Composant | État | Commentaire |
|-----------|------|-------------|
| `b2b_partnerships` (active/archived) | ✅ | CHECK anti-auto, RLS strict, archivage atomique |
| `b2b_invitation_codes` | ✅ | Usage unique, expiration 48h, FOR UPDATE |
| `b2b_imported_products` (bridge table) | ✅ | UUID local découplé, pas de FK cross-org |
| Import pipeline (6 phases) | ✅ | Unit mapping, category mapping, atomic commit |
| RPC `fn_import_b2b_product_atomic` | ✅ | Cleanup préventif, stock initialisé à 0 |
| Partage de stock `fn_get_b2b_supplier_stock` | ✅ | Read-only, non-bloquant, Security Definer |
| Sync prix `fn_sync_b2b_price` | ✅ | Trigger fail-open, anti-boucle |
| Isolation produits | ✅ | Snapshots à l'import, pas de sync prix/nom rétroactive |
| Isolation unités | ✅ | Triggers `trg_products_v2_unit_isolation_*` |

### Question centrale : Le B2B permet-il de facturer sans ambiguïté ?

**Réponse : OUI, à condition de figer le prix.**

Le mapping `b2b_imported_products` (source_product_id → local_product_id) permet de tracer l'origine. Chaque établissement a ses propres UUID, prix et config. La facture doit s'appuyer sur le `local_product_id` côté client et le prix figé au moment de la commande (qui n'existe pas encore — cf. Section C).

### Risque spécifique B2B

- **Produits non mappés côté fournisseur** : le système les détecte (badge "Non lié") et `fn_resolve_litige` les ignore silencieusement. Pour la facture, ces produits devront être traités comme "hors catalogue" avec un fallback explicite.

---

## SECTION F — Audit Prix / Synchronisation Prix

### Architecture actuelle

```
[Fournisseur modifie products_v2.final_unit_price]
    ↓ trigger trg_sync_b2b_price
    ↓ fn_sync_b2b_price (SECURITY DEFINER, fail-open)
        → UPDATE products_v2 client (final_unit_price)
        → UPSERT price_alerts (avec reset seen_at/acked_at)
    ↓
[Client voit alerte dans NouvelleCommandeDialog]
    → popup PriceChangePopup (une seule fois par changement)
    → acked_at marqué atomiquement
```

### Réponses aux 4 questions critiques

#### 1. Le prix peut-il changer après qu'une commande a été passée ?

**OUI.** `products_v2.final_unit_price` est mutable à tout moment :
- Par OCR (Vision AI) après scan d'une facture fournisseur
- Par le trigger `fn_sync_b2b_price` si le fournisseur met à jour son catalogue
- Par le Wizard V3 manuellement

Il n'existe **aucun mécanisme de gel** du prix au moment de l'envoi de la commande.

#### 2. Est-ce un risque pour la future facture ?

**OUI, C'EST LE RISQUE #1.** 

Scénario problématique :
1. Client commande 10 kg à 5€/kg (prix actuel)
2. Fournisseur modifie son prix à 6€/kg (OCR d'une nouvelle facture)
3. `fn_sync_b2b_price` propage le changement côté client
4. Fournisseur expédie
5. Client reçoit
6. → À quel prix facturer ? 5€ (au moment de la commande) ou 6€ (prix actuel) ?

Sans snapshot, la facture utilisera le prix actuel (6€), ce qui est **potentiellement incorrect**.

#### 3. Que faut-il figer et à quel moment ?

| Donnée à figer | Moment du gel | Mécanisme recommandé |
|----------------|---------------|---------------------|
| `unit_price_snapshot` | À l'envoi (`fn_send_commande`) | Lecture `products_v2.final_unit_price` + conversion BFS |
| `line_total_snapshot` | À l'envoi | `canonical_quantity * unit_price_snapshot` |
| Prix définitif facture | À la réception | `received_quantity * unit_price_snapshot` (corrigé par litige si applicable) |

#### 4. Quelle doit être la source de vérité du prix de facture ?

**`commande_lines.unit_price_snapshot`** (à créer) — figé à l'envoi, jamais modifié ensuite. Le trigger `trg_commandes_immutable_fields` devra être étendu pour protéger ce champ.

### Compatibilité du système d'alertes prix

Le système d'alertes (`price_alerts`, `PriceChangePopup`) est **compatible** avec la facture :
- Il informe le client qu'un prix a changé AVANT qu'il ne commande
- L'acquittement (`acked_at`) trace que le client a pris connaissance du changement
- Cela ne remplace PAS le besoin d'un snapshot prix, mais l'enrichit (audit trail)

---

## SECTION G — Audit Retours / Litiges / DLC

### Litiges

| Aspect | État | Verdict |
|--------|------|---------|
| Rôle métier | Correction quantitative (manque/surplus) | ✅ Clair |
| SSOT | `litiges` + `litige_lines` (shipped vs received) | ✅ Solide |
| Effet sur quantités | ✅ Correction stock fournisseur via `fn_resolve_litige` | ✅ |
| Effet sur valeur | ⛔ Aucun | 🟡 La facture devra calculer l'impact financier |
| Effet futur facture | Delta quantitatif → avoir ou complément | 🟡 À intégrer |
| Risque de conflit | Faible — le calcul `computeEcart` est centralisé | ✅ |

**Recommandation** : La facture doit utiliser la quantité **post-litige** (soit `received_quantity` finale) pour le calcul. Le litige doit générer une ligne d'avoir/complément si le prix est figé à l'envoi.

### Retours

| Aspect | État | Verdict |
|--------|------|---------|
| Rôle métier | Signalement qualitatif (V0 déclaratif) | ✅ Isolé |
| SSOT | `product_returns` | ✅ |
| Effet sur quantités | ❌ Aucun | ✅ Correct pour V0 |
| Effet sur valeur | ❌ Aucun | 🟡 V1 devra traiter avoirs |
| Effet futur facture | Résolution "avoir" → doit se traduire en ligne financière | 🟡 V1 |
| Risque de conflit | **Faible** — module totalement isolé, rm -rf safe | ✅ |

**Recommandation V0 Facture** : Les retours restent **hors périmètre facture**. Ils apparaîtront comme annotation/commentaire. V1 : le retour accepté avec résolution "avoir" devra générer un avoir automatique.

### DLC

| Aspect | État | Verdict |
|--------|------|---------|
| Rôle métier | Traçabilité dates de péremption | ✅ Clair |
| SSOT | `reception_lot_dlc` (upsert on `commande_line_id`) | ✅ |
| Effet sur quantités | ❌ Aucun (refus DLC → retour, pas litige) | ✅ Correct |
| Effet sur valeur | ❌ Aucun | ✅ Correct |
| Effet futur facture | **Aucun impact direct** — la DLC est une donnée de conformité, pas financière | ✅ |
| Risque de conflit | **Nul** — module totalement isolé | ✅ |

**Recommandation** : DLC est compatible avec la facture tel quel. Aucune modification nécessaire.

---

## SECTION H — Audit Technique / Taille / Complexité

### Fichiers critiques

| Fichier | Rôle | Lignes | Criticité | Risque | Recommandation |
|---------|------|--------|-----------|--------|----------------|
| `supabase/functions/commandes-api/index.ts` | Orchestrateur edge function commandes | 632 | 🔴 Haute | Logique monolithique, 4 actions dans 1 fichier | **Split** en handlers séparés |
| `src/modules/commandes/services/commandeService.ts` | Tous les appels DB commandes | 442 | 🟡 Moyenne | `as any`, pas de types retour stricts | **Refactor** type-safety |
| `src/modules/commandes/hooks/useCommandes.ts` | 12 hooks React Query | 221 | 🟡 Moyenne | Fichier dense, déjà flaggé | **Split** queries vs mutations |
| `src/modules/commandes/components/CommandesList.tsx` | Liste des commandes | ~500+ | 🟡 Moyenne | UI complexe multi-tab | **Document** |
| `src/modules/commandes/components/ReceptionDialog.tsx` | Dialog réception client | ~400+ | 🟡 Moyenne | Local draft + DLC + retours | **Document** |
| `src/modules/commandes/components/PreparationDialog.tsx` | Dialog préparation fournisseur | ~400+ | 🟡 Moyenne | Swipe + persistance immédiate | **Document** |
| `supabase/functions/stock-ledger/index.ts` | Edge function stock | 336 | ✅ Faible | Clean, bien structuré | **Keep** |
| `src/modules/litiges/services/litigeService.ts` | Service litiges | 84 | ✅ Faible | Petit, focalisé | **Keep** |
| `src/modules/retours/services/retourService.ts` | Service retours | 125 | ✅ Faible | Isolé | **Keep** |
| `src/modules/dlc/services/dlcService.ts` | Service DLC | 83 | ✅ Faible | Isolé | **Keep** |
| `src/modules/dlc/lib/dlcCompute.ts` | Logique pure DLC | 116 | ✅ Faible | SSOT, pas d'effets de bord | **Keep** |
| `src/modules/litiges/utils/ecart.ts` | Calcul écart | 27 | ✅ Faible | SSOT | **Keep** |
| `src/modules/priceAlerts/services/priceAlertService.ts` | Service alertes prix | 101 | ✅ Faible | Clean | **Keep** |
| `src/modules/clientsB2B/services/b2bImportPipeline.ts` | Pipeline import B2B | 209 | ✅ Faible | Bien structuré, 6 phases | **Keep** |
| `src/modules/clientsB2B/services/shareStockService.ts` | Partage stock B2B | 56 | ✅ Faible | Read-only, non-bloquant | **Keep** |

---

## SECTION I — Code Mort / Incohérences / Dette Résiduelle

### `as any` systématique

| Fichier | Ligne | Impact |
|---------|-------|--------|
| `commandeService.ts` | L11 | Toutes les requêtes commandes non typées |
| `litigeService.ts` | L9 | Requêtes litiges non typées |
| `retourService.ts` | L9 | Requêtes retours non typées |
| `dlcService.ts` | L16, 60, 76 | Requêtes DLC non typées |

**Impact facture** : Si le module Facture utilise le même pattern, les erreurs de typage seront silencieuses. **Recommandation P2** : migrer vers des types générés ou des wrappers typés.

### Incohérences identifiées

1. **`getPartnerSuppliers` fait 3 requêtes séquentielles** (partnerships → establishments → share_stock) alors qu'un seul SELECT avec join suffirait. Pas de risque facture, mais dette perf.

2. **`deleteDraftCommande` fait un DELETE sans vérifier le statut** — Si une race condition change le statut juste avant, on pourrait supprimer une commande envoyée. Risque faible (RLS protège), mais à vérifier.

3. **`updateCommandeNote` vérifie `status = brouillon`** mais le client peut aussi modifier les notes en statut `envoyee` (cf. memory `sent-order-modification-policy`). Le code et la policy sont en contradiction.

4. **`resolve_commande_actors`** est appelé à chaque `getCommandes` ET `getCommandeWithLines`. Double appel réseau pour la même commande si on affiche la liste puis le détail.

### Code mort potentiel

- **`commande_lines.line_status`** : le type `LineStatus` (`ok | modifie | rupture`) est défini côté TypeScript mais la colonne DB est `text | null`. Pas de contrainte DB.
- **`commande_lines.unit_label_snapshot`** : nullable, parfois null en pratique. La facture devra gérer ce cas.

---

## SECTION J — Pré-requis Exacts Avant Module Facture

### P0 — Bloquants Avant Facture 🔴

| # | Problème | Impact | Preuve | Recommandation | Risque si non corrigé |
|---|----------|--------|--------|----------------|----------------------|
| P0-1 | **Pas de snapshot prix sur `commande_lines`** | La facture n'a aucune donnée de prix historique fiable | `commande_lines` n'a ni `unit_price` ni `line_total` (cf. types.ts L38-50) | Ajouter `unit_price_snapshot NUMERIC`, `line_total_snapshot NUMERIC` sur `commande_lines`. Figer dans `fn_send_commande` depuis `products_v2.final_unit_price` + conversion BFS. | **Facture fausse** si le prix change entre commande et réception |
| P0-2 | **Immutabilité du prix snapshot** | Le prix figé pourrait être écrasé | Aucun trigger de protection actuellement | Étendre `trg_commandes_immutable_fields` pour bloquer UPDATE sur `unit_price_snapshot` et `line_total_snapshot` une fois renseignés. | **Corruption des données financières** |
| P0-3 | **Définir la "quantité facturable"** | Ambiguïté entre commandé/expédié/reçu/corrigé | 4 colonnes de quantité sur `commande_lines` | Documenter et implémenter : **quantité facturable = `received_quantity` post-litige**. Si litige ouvert → facture bloquée. Si litige résolu → utiliser `received_quantity` finale. | **Facture incohérente** avec les flux métier |

### P1 — À Corriger Rapidement 🟡

| # | Problème | Impact | Recommandation | Risque si non corrigé |
|---|----------|--------|----------------|----------------------|
| P1-1 | **Pas de statut `cloturee`** | La facture ne sait pas quand une commande est "terminée" | Implémenter la transition `recue` → `cloturee` (automatique après X jours ou manuelle). La facture ne devrait être émise que sur commandes clôturées. | Factures prématurées sur commandes encore en cours |
| P1-2 | **`updateCommandeNote` contradictoire** | Le code vérifie `brouillon` mais la policy dit que `envoyee` est aussi modifiable | Aligner le code avec la policy : `status IN ('brouillon', 'envoyee')` | Bug silencieux si un client essaie de modifier une note en `envoyee` |
| P1-3 | **Pas de FK `commande_id` sur `stock_documents`** | Traçabilité stock ↔ commande uniquement via `idempotency_key` (string) | Ajouter `source_commande_id UUID NULL REFERENCES commandes(id)` sur `stock_documents`. Facilite l'audit facture. | Difficulté de réconciliation facture ↔ stock |
| P1-4 | **Pas de limite rows sur `getCommandes`** | Troncature silencieuse à 1000 pour volumes élevés | Ajouter pagination ou `.limit(500)` explicite avec indicateur "plus de résultats" | Commandes manquantes dans la liste facture |

### P2 — Acceptable pour V0 🔵

| # | Problème | Impact | Recommandation | Risque si non corrigé |
|---|----------|--------|----------------|----------------------|
| P2-1 | `as any` sur le client Supabase dans 4 services | Pas de type-safety | Créer des wrappers typés pour les tables `commandes`, `litiges`, etc. | Régressions silencieuses à moyen terme |
| P2-2 | Retours sans impact financier | V0 déclaratif, pas d'avoir | Planifier pour V1 Facture : retour accepté + résolution "avoir" → ligne d'avoir | Avoirs manuels hors système |
| P2-3 | `resolve_commande_actors` double appel | Performance | Cache côté service ou déduplique dans le hook | Latence UI sur la page commandes |
| P2-4 | `getPartnerSuppliers` 3 requêtes séquentielles | Performance | Remplacer par un seul SELECT avec join | Latence tunnel de commande |
| P2-5 | `commandes-api/index.ts` monolithique (632 lignes) | Maintenabilité | Split en `handlers/send.ts`, `handlers/ship.ts`, etc. | Risque de régression lors de modifications |
| P2-6 | `line_status` non contraint en DB | Valeurs invalides possibles | Ajouter CHECK ou ENUM | Données incohérentes dans des cas edge |

---

## VERDICT FINAL

### GO CONDITIONNEL ✅🟡

La base technique est **architecturalement solide** :
- Atomicité transactionnelle (RPCs, FOR UPDATE, idempotency keys)
- Isolation multi-tenant stricte (RLS, triggers, UUID découplés)
- Ledger append-only avec piste d'audit complète
- Snapshots immutables pour identité produit et acteurs
- Modules isolés et supprimables indépendamment

**Le seul blocage critique est l'absence de prix figé sur les lignes de commande (P0-1 + P0-2 + P0-3).**

### Plan d'action recommandé

```
Semaine 1 :  P0-1 → Migration DB (unit_price_snapshot, line_total_snapshot)
             P0-2 → Trigger d'immutabilité
             P0-3 → Documenter la règle "quantité facturable"
             
Semaine 2 :  P1-1 → Implémenter statut clôturée
             P1-2 → Fix updateCommandeNote
             Démarrer module Facture V0

Parallèle :  P1-3, P1-4, P2-* selon priorité
```

### Réponses aux 7 questions

| Question | Réponse |
|----------|---------|
| La base est-elle suffisamment propre ? | **OUI**, à condition de corriger P0-1/P0-2/P0-3 |
| Source de vérité facture ? | `commande_lines.unit_price_snapshot × received_quantity` (post-litige) |
| Quand figer la valeur facturable ? | **À l'envoi** (`fn_send_commande`) pour le prix ; **à la réception** pour la quantité |
| Quels modules risquent un conflit ? | **Aucun**, si le prix est figé. Les retours sont hors périmètre V0. |
| Le changement de prix est-il compatible ? | **NON sans snapshot prix**. OUI avec P0-1 implémenté. |
| Retours/litiges/DLC doivent-ils corriger la facture ? | **Litiges** : OUI (correction quantitative). **Retours** : NON en V0 (V1 pour avoirs). **DLC** : NON (conformité, pas financier). |
| Le B2B est-il propre pour facturer ? | **OUI** — isolation complète, mapping traçable, prix snapshotable. |

---

*Audit réalisé le 2026-03-06 — Basé sur l'analyse complète du code source, des services, des RPCs, des edge functions, des types, et de la documentation architecture.*
