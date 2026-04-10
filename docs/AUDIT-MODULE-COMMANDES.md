# AUDIT MODULE COMMANDES — Pre-Freeze V1

> **Date** : 2026-03-11  
> **Auditeur** : Architecture ERP Senior  
> **Scope** : Module Commandes Produits + Commandes Plats + Litiges + intégrations Stock/Factures/Retours/DLC

---

## 1. Résumé exécutif

| Critère | Note |
|---------|------|
| **Cohérence métier** | 8/10 — Cycle de vie solide, bien structuré |
| **Robustesse transactionnelle** | 8/10 — RPCs atomiques avec FOR UPDATE, idempotency keys |
| **Isolation modulaire** | 9/10 — Séparation produits/plats exemplaire |
| **Sécurité** | 7/10 — Quelques faiblesses identifiées |
| **Qualité code** | 7/10 — Composants volumineux mais fonctionnels |
| **Prêt pour prod V1** | ✅ OUI — avec corrections mineures recommandées |

**Verdict** : Le module est solide pour une V1. L'architecture est saine, les opérations critiques sont atomiques, les snapshots sont corrects. Les risques identifiés sont modérés et gérables. Aucun bloquant critique pour le lancement.

---

## 2. Cartographie du module

### 2.1 Fichiers clés

| Fichier | Lignes | Rôle |
|---------|--------|------|
| `commandes/services/commandeService.ts` | 441 | Service d'accès Supabase — CRUD + appels edge functions |
| `commandes/hooks/useCommandes.ts` | 211 | Hooks React Query — mutations + queries |
| `commandes/components/CommandeDetailDialog.tsx` | 806 | Détail commande (brouillon → terminée) |
| `commandes/components/PreparationDialog.tsx` | 710 | Préparation fournisseur (swipe OK/Rupture/Modifier) |
| `commandes/components/ReceptionDialog.tsx` | 1509 | Réception client (validation, DLC, retours, reorder) |
| `commandes/components/NouvelleCommandeDialog.tsx` | 933 | Création + envoi de commande |
| `commandes/components/CommandesList.tsx` | 335 | Liste avec tabs (en_cours/litige/retours/terminée) |
| `litiges/services/litigeService.ts` | 84 | Accès litiges + résolution via edge function |
| `litiges/components/LitigeDetailDialog.tsx` | 410 | UI litige avec résolution fournisseur |
| `litiges/utils/ecart.ts` | 27 | SSOT calcul écart (delta = shipped - received) |
| `commandesPlats/services/commandePlatService.ts` | 196 | CRUD commandes plats |
| `commandesPlats/services/commandePlatLifecycle.ts` | 64 | Appels edge function commandes-plats-api |
| `commandesPlats/services/litigePlatService.ts` | 59 | Litiges plats |
| `supabase/functions/commandes-api/index.ts` | 725 | Edge function orchestrateur produits |
| `supabase/functions/commandes-plats-api/index.ts` | 471 | Edge function orchestrateur plats |

### 2.2 RPCs SQL clés

| RPC | Responsabilité |
|-----|---------------|
| `fn_send_commande` | brouillon → envoyee + snapshot nom + order_number |
| `fn_open_commande` | envoyee → ouverte (idempotent, verrouillage) |
| `fn_ship_commande` | ouverte → expediee + stock WITHDRAWAL supplier (atomique) |
| `fn_receive_commande` | expediee → recue/litige + stock RECEIPT client (atomique) |
| `fn_resolve_litige` | litige → recue + ADJUSTMENT stock supplier |
| `fn_send_commande_plat` | brouillon → envoyee (plats) |
| `fn_open_commande_plat` | envoyee → ouverte (plats) |
| `fn_ship_commande_plat` | ouverte → expediee (plats, sans stock) |
| `fn_receive_commande_plat` | expediee → recue/litige (plats, sans stock) |
| `fn_resolve_litige_plat` | litige → cloturee (plats) |
| `resolve_commande_actors` | Résolution des noms d'acteurs (créateur, expéditeur, récepteur) |

### 2.3 Tables clés

| Table | Rôle |
|-------|------|
| `commandes` | En-tête commande produits |
| `commande_lines` | Lignes commande produits (commandé/expédié/reçu) |
| `commande_plats` | En-tête commande plats |
| `commande_plat_lines` | Lignes commande plats |
| `litiges` | En-tête litige (lié à commande produit) |
| `litige_lines` | Lignes litige (shipped vs received snapshot) |
| `litige_plats` | Litige plats |
| `litige_plat_lines` | Lignes litige plats |
| `order_groups` | Table de liaison commande composite (produits + plats) |
| `b2b_partnerships` | Relation fournisseur-client |
| `b2b_imported_products` | Mapping produit client ↔ produit fournisseur |
| `app_invoices` | Factures générées post-réception |

### 2.4 Dépendances inter-modules

| Module | Direction | Nature |
|--------|-----------|--------|
| **Stock (Ledger)** | `commandes →` | `fn_ship_commande` crée WITHDRAWAL, `fn_receive_commande` crée RECEIPT |
| **Produits V2** | `commandes ←` | Catalogue produits pour cart + B2B mapping |
| **DLC** | `commandes ←` | `useDlcForCommande` à la réception |
| **Retours** | `commandes ←` | `SignalerRetourDialog` depuis détail/réception |
| **Factures App** | `commandes ←` | `GenerateInvoiceButton` depuis détail |
| **Unit Conversion** | `commandes ←` | BFS modal (UniversalQuantityModal) |
| **Order Groups** | `commandes ↔ commandesPlats` | Liaison composite via orchestration |

---

## 3. Sources de vérité

| Donnée critique | SSOT réelle | Où elle est lue | Où elle est écrite | Risques |
|----------------|-------------|-----------------|-------------------|---------|
| **Statut commande** | `commandes.status` (enum PostgreSQL) | Service, hooks, UI | RPCs atomiques exclusivement | ✅ Sain — transitions contrôlées côté SQL |
| **Quantité commandée** | `commande_lines.canonical_quantity` | Detail, Prep, Reception | `upsertCommandeLines` (brouillon only) | ✅ Immuable après envoi |
| **Quantité expédiée** | `commande_lines.shipped_quantity` | Prep, Reception, Litige | `fn_ship_commande` (atomique) | ✅ Clampé par Rule 0 (trigger + RPC) |
| **Quantité reçue** | `commande_lines.received_quantity` | Reception, Litige | `fn_receive_commande` (atomique) | ✅ Validations en RPC |
| **Prix snapshot** | `commande_lines.unit_price_snapshot` | Detail, Factures | `fn_send_commande` via snapshot à l'envoi | ⚠️ Voir faiblesse F-01 |
| **Nom créateur** | `commandes.created_by_name_snapshot` | Liste, Detail | `fn_send_commande` | ✅ SSOT snapshot |
| **Numéro commande** | `commandes.order_number` (UNIQUE) | Liste, Detail, Factures | `fn_send_commande` via sequence | ✅ Atomique + unique |
| **Écart (delta)** | `computeEcart()` dans `litiges/utils/ecart.ts` | CommandesList, LitigeDetail, Reception | Calcul pur (non stocké) | ✅ SSOT calcul unique |
| **Stock delta** | `stock_events` | Inventaire | `fn_ship_commande`, `fn_receive_commande`, `fn_resolve_litige` | ✅ Idempotency keys |
| **Noms acteurs (liste)** | `resolve_commande_actors` RPC | `getCommandes()`, `getCommandeWithLines()` | Non stocké (résolution à la volée) | ✅ Fallback sur snapshot |

---

## 4. Cartographie des flows

### 4.1 Création de brouillon

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `NouvelleCommandeDialog` → `useCreateDraftCommande` |
| **Lectures** | `getPartnerSuppliers`, `getProductsForSupplier`, `getActiveDraft` |
| **Écritures** | INSERT `commandes` (status=brouillon), INSERT/UPSERT `commande_lines` |
| **Statuts** | → `brouillon` |
| **Risques** | Pas de contrainte d'unicité draft par supplier — multiples brouillons possibles |
| **Verdict** | ✅ **Sain** — `getActiveDraft` limite visuellement mais pas en DB |

### 4.2 Modification de lignes (brouillon + envoyée)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `CommandeDetailDialog` → `upsertCommandeLines` / `removeCommandeLine` |
| **Règle** | Modifiable si `brouillon` OU `envoyee` (avant ouverture FO) |
| **Protection** | `updateCommandeNote` vérifie `status=brouillon` côté WHERE |
| **Risques** | `removeCommandeLine` n'a pas de garde statut côté service (voir F-02) |
| **Verdict** | ⚠️ **Correct fonctionnellement, mais removeCommandeLine manque de garde** |

### 4.3 Envoi (brouillon → envoyée)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `CommandeDetailDialog.handleSend` → `useSendCommande` → edge function → `fn_send_commande` |
| **Opérations atomiques** | Lock FOR UPDATE, vérif brouillon, count lignes > 0, snapshot nom, order_number |
| **Snapshots figés** | `created_by_name_snapshot`, `order_number` |
| **Notifications** | Push + in-app vers fournisseur |
| **Risques** | Aucun — RPC transactionnelle solide |
| **Verdict** | ✅ **Excellent** |

### 4.4 Ouverture (envoyée → ouverte)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `PreparationDialog` auto-trigger → `useOpenCommande` → edge → `fn_open_commande` |
| **Idempotence** | ✅ Retourne `already_opened: true` si déjà ouverte |
| **Effet** | Verrouille la commande pour le client (modifications impossibles) |
| **Notifications** | Push au créateur ("fournisseur a consulté") |
| **Verdict** | ✅ **Sain et idempotent** |

### 4.5 Préparation (fournisseur)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `PreparationDialog` — swipe ou BFS modal |
| **Persistance** | Chaque ligne sauvée individuellement via `updateLinePreparation` |
| **Rule 0 (clamp)** | Trigger DB `trg_clamp_shipped_quantity` + clamp inline dans `fn_ship_commande` |
| **BFS** | Résolution B2B mapping (`b2b_imported_products` → `source_product_id`) |
| **Risques** | Double persistance (par ligne + au ship) → pas de risque car ship re-écrit |
| **Verdict** | ✅ **Robuste — double sécurité clamp** |

### 4.6 Expédition (ouverte → expédiée)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `PreparationDialog.handleShip` → `useShipCommande` → edge → `fn_ship_commande` |
| **Atomicité** | ✅ RPC transactionnelle (FOR UPDATE + validation + transition + stock) |
| **Validations** | Toutes lignes traitées, qté ≥ 0, rupture → qté = 0 |
| **Stock** | WITHDRAWAL directement POSTED (bypass DRAFT — fix P0 du 2026-03-11) |
| **Idempotency** | `idempotency_key = 'ship:' + commande_id + ':' + zone_id` |
| **Risques** | Aucun bloquant identifié |
| **Verdict** | ✅ **Excellent — atomique, idempotent, bypass DRAFT prouvé** |

### 4.7 Réception client (expédiée → reçue/litige)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `ReceptionDialog.handleReceive` → `useReceiveCommande` → edge → `fn_receive_commande` |
| **Atomicité** | ✅ RPC transactionnelle (FOR UPDATE + lignes count match + validation + stock + litige auto) |
| **Validations** | `lines_count_mismatch`, `received_quantity_null`, `received_quantity_negative`, `missing_zone` |
| **Surplus** | ✅ Autorisé (V0+ fix) — crée litige automatiquement |
| **Litige auto** | Si `received ≠ shipped` → INSERT litiges + litige_lines + status → litige |
| **Stock** | RECEIPT via `fn_post_stock_document` (DRAFT → POSTED) |
| **DLC** | Traité côté frontend après réception (non-bloquant) |
| **Retours** | Staged localement, committé après réception réussie |
| **Reorder** | Proposition de commande complémentaire si écarts négatifs |
| **Risques** | RECEIPT utilise DRAFT → fn_post (vs ship qui bypass) — voir R-01 |
| **Verdict** | ✅ **Solide — litige atomique, validations complètes** |

### 4.8 Résolution litige (litige → recue)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `LitigeDetailDialog` → `useResolveLitige` → edge → `fn_resolve_litige` |
| **Atomicité** | ✅ RPC transactionnelle |
| **Autorisation** | Vérifie `user_establishments` côté FO |
| **Stock** | ADJUSTMENT (positif = retour stock, négatif = sortie surplus) |
| **Transition** | `litiges.status → resolved`, `commandes.status → recue` |
| **Risques** | Aucun bloquant |
| **Verdict** | ✅ **Sain** |

### 4.9 Facturation (recue → cloturee)

| Aspect | Détail |
|--------|--------|
| **Point d'entrée** | `GenerateInvoiceButton` → `fn_generate_app_invoice` |
| **Transition** | `commandes.status → cloturee` (atomique dans la RPC) |
| **Verdict** | ✅ **Correct — transition couplée à la facture** |

---

## 5. Invariants métier — Vérification

### 5.1 Invariants de structure

| Invariant | Vérifié | Détail |
|-----------|---------|--------|
| Ligne référence un produit valide | ✅ | FK `commande_lines.product_id → products_v2.id` |
| FKs critiques présentes | ✅ | `commande_id`, `product_id`, `canonical_unit_id`, `partnership_id` |
| Pas de texte libre pour données structurées | ✅ | Snapshots = copies, pas de remplacement de référence |

### 5.2 Invariants d'historique

| Invariant | Vérifié | Détail |
|-----------|---------|--------|
| Prix historique = snapshot | ⚠️ | `unit_price_snapshot` existe mais n'est **pas rempli** à l'envoi (voir F-01) |
| Commande passée garde son intégrité | ✅ | Snapshots `product_name_snapshot`, `unit_label_snapshot`, `created_by_name_snapshot` |
| Indépendance du catalogue courant | ✅ | Les données historiques ne dérivent pas du catalogue |

### 5.3 Invariants de quantités

| Invariant | Vérifié | Détail |
|-----------|---------|--------|
| Définitions claires | ✅ | `canonical_quantity` (commandé), `shipped_quantity` (expédié), `received_quantity` (reçu) |
| Pas de calcul contradictoire | ✅ | `computeEcart()` est le SSOT unique |
| Pas de qté négative | ✅ | Validé en RPC : `received_quantity_negative`, `invalid_shipped_quantity` |
| Rule 0 : shipped ≤ ordered | ✅ | Trigger `trg_clamp_shipped_quantity` + clamp inline dans `fn_ship_commande` |

### 5.4 Invariants de statuts

| Invariant | Vérifié | Détail |
|-----------|---------|--------|
| Statuts clairement définis | ✅ | Enum PostgreSQL `commande_status` |
| Transitions autorisées explicites | ✅ | Chaque RPC vérifie le statut source (FOR UPDATE) |
| Transitions interdites bloquées | ✅ | Retour d'erreur `invalid_status` avec `current` |
| Cohérence statut commande / statut lignes | ✅ | Ship exige `line_status IS NOT NULL` pour toutes les lignes |

**Matrice de transition :**

```
brouillon → envoyee        (fn_send_commande)
envoyee   → ouverte        (fn_open_commande)
ouverte   → expediee       (fn_ship_commande)
expediee  → recue          (fn_receive_commande, si pas d'écart)
expediee  → litige         (fn_receive_commande, si écart)
litige    → recue          (fn_resolve_litige)
recue     → cloturee       (fn_generate_app_invoice)

Transitions interdites : aucune régression possible (pas de retour arrière)
```

### 5.5 Invariants transactionnels

| Invariant | Vérifié | Détail |
|-----------|---------|--------|
| Opérations critiques atomiques | ✅ | Toutes les RPCs utilisent FOR UPDATE + transaction implicite PL/pgSQL |
| Pas d'état partiellement écrit | ✅ | Exception = rollback complet |
| Idempotency | ✅ | `idempotency_key` sur stock_documents (ship/receive/resolve) |
| Protection double soumission | ✅ | Vérification statut en entrée de chaque RPC |

### 5.6 Invariants de module

| Invariant | Vérifié | Détail |
|-----------|---------|--------|
| Pas de logique stock dans le module | ✅ | Stock = RPCs SQL, pas de logique frontend |
| Pas de double source de vérité | ✅ | `computeEcart()` SSOT, snapshots SSOT |
| Isolation produits / plats | ✅ | Aucune référence croisée entre les services |

---

## 6. Forces du module

### F+ 1. Architecture transactionnelle exemplaire (Critique)
Toutes les transitions de statut passent par des RPCs `SECURITY DEFINER` avec `FOR UPDATE` et vérification du statut courant. Aucune mutation de statut n'est possible depuis le frontend. C'est le standard ERP attendu.

### F+ 2. Isolation modulaire produits / plats (Importante)
La séparation en deux moteurs indépendants (`commandes` vs `commande_plats`) avec deux edge functions distinctes et zéro couplage est remarquable. Le module plats peut évoluer ou être retiré sans impact.

### F+ 3. Snapshots à l'envoi (Critique)
`created_by_name_snapshot`, `order_number`, `product_name_snapshot` sont figés au bon moment. L'historique est protégé contre les modifications ultérieures du catalogue.

### F+ 4. Rule 0 — Double clamp expédition (Important)
Le clamp `shipped ≤ ordered` est garanti à deux niveaux : trigger DB + validation inline dans la RPC. Ceinture et bretelles.

### F+ 5. Idempotency keys sur le stock (Critique)
Les `idempotency_key` sur les stock_documents empêchent les doubles écritures en cas de retry. Pattern standard pour les systèmes financiers.

### F+ 6. Litige atomique (Important)
La création du litige est intégrée dans `fn_receive_commande` — pas de fenêtre de timing où la commande serait "reçue" sans litige.

### F+ 7. Notification RBAC-filtrée (Important)
Les notifications sont filtrées par `filterUsersByCommandeAccess` — seuls les utilisateurs avec permission `commandes` reçoivent les push. Bon pattern sécurité.

### F+ 8. Bypass DRAFT pour shipment (Technique)
Le fix P0 du 2026-03-11 (INSERT directement en POSTED pour les WITHDRAWAL) élimine les conflits de contrainte d'unicité. Solution élégante et prouvée.

---

## 7. Faiblesses et risques

### 🔴 Critique

*Aucun bloquant critique identifié.*

### 🟠 Majeur

#### F-01. `unit_price_snapshot` et `line_total_snapshot` non remplis à l'envoi
**Constat** : `fn_send_commande` ne snapshot pas les prix. Les colonnes `unit_price_snapshot` et `line_total_snapshot` dans `commande_lines` restent NULL après envoi.  
**Impact** : La facturation (`fn_generate_app_invoice`) doit recalculer les prix au moment de la facture, pas au moment de la commande. Si le catalogue change entre commande et facture, le prix facturé ≠ prix commandé.  
**Recommandation** : Ajouter le snapshot des prix dans `fn_send_commande` (lecture du prix catalogue au moment de l'envoi).  
**Risque prod** : Modéré — tant que les factures sont générées rapidement après réception, l'écart est négligeable. Mais violation du principe SSOT.

#### F-02. `removeCommandeLine` sans garde de statut
**Constat** : Le service `removeCommandeLine(lineId)` fait un DELETE sans vérifier le statut de la commande parente. Si la commande est `envoyee`, la suppression est permise côté service.  
**Mitigation existante** : L'UI bloque la suppression de la dernière ligne en `envoyee`, et un trigger DB `LAST_LINE_ENVOYEE` existe. Mais le DELETE reste possible pour les lignes non-dernières en `envoyee`.  
**Impact** : Un client peut retirer des lignes d'une commande envoyée (avant ouverture FO). C'est peut-être voulu (modifiable tant que non ouverte) mais non explicitement documenté.  
**Recommandation** : Documenter l'intention métier. Si les lignes doivent être immuables après envoi, ajouter une RLS policy ou un trigger.

#### F-03. Suppression de brouillon sans soft-delete
**Constat** : `deleteDraftCommande` fait un DELETE physique. Pas de soft-delete, pas d'audit trail.  
**Impact** : Perte d'information. Un brouillon supprimé est irrécupérable.  
**Recommandation** : Acceptable pour V1 (brouillon = non engageant). Passer en soft-delete post-freeze si nécessaire.

### 🟡 Modéré

#### R-01. Asymétrie DRAFT/POSTED entre ship et receive
**Constat** : `fn_ship_commande` insère directement en POSTED (bypass DRAFT — fix P0). `fn_receive_commande` utilise DRAFT → `fn_post_stock_document`.  
**Impact** : Si le client a un brouillon RECEIPT manuel ouvert sur la même zone, la réception B2B échoue potentiellement (même contrainte d'unicité).  
**Probabilité** : Faible — le RECEIPT utilise `idempotency_key` mais le conflit est théoriquement possible.  
**Recommandation** : Appliquer le même pattern POSTED direct pour la réception, ou vérifier que la contrainte `uq_stock_documents_one_draft_per_zone_type` ne s'applique qu'au type WITHDRAWAL.

#### R-02. `supabase as any` pattern omniprésent
**Constat** : Tous les services utilisent `const db = supabase as any` pour contourner le typage strict.  
**Impact** : Perte de type-safety, risque d'erreur silencieuse sur les noms de colonnes/tables.  
**Recommandation** : Acceptable pour V1 (le schéma auto-généré ne couvre pas toutes les tables). Migrer vers les types générés post-freeze.

#### R-03. Pas de pagination sur `getCommandes`
**Constat** : `getCommandes` charge toutes les commandes sans limite (sauf le default Supabase de 1000).  
**Impact** : Pour un établissement avec > 1000 commandes, les anciennes commandes sont invisibles.  
**Recommandation** : Ajouter une pagination ou un filtre par date pour V1.1.

#### R-04. `updateLinePreparation` — échec silencieux
**Constat** : Dans `PreparationDialog.persistLine`, l'erreur est catchée silencieusement (`// silent — will be re-persisted on ship`).  
**Impact** : Si la persistance échoue, l'état local diverge de la DB. Le ship final re-soumet toutes les lignes, donc pas de perte de données.  
**Recommandation** : Acceptable — la sécurité est dans le ship final.

#### R-05. `ReceptionDialog` — 1509 lignes
**Constat** : Le composant le plus volumineux du module. Gère réception + DLC + retours + reorder + BFS + surplus + embedded mode.  
**Impact** : Difficulté de maintenance, risque de régression lors de modifications.  
**Recommandation** : Extraire les sous-systèmes (DLC, retours, reorder) en hooks/composants dédiés post-freeze.

### 🟢 Mineur

#### M-01. Duplication `filterUsersByCommandeAccess`
**Constat** : La fonction est dupliquée identiquement dans `commandes-api/index.ts` et `commandes-plats-api/index.ts`.  
**Recommandation** : Extraire dans `_shared/` post-freeze.

#### M-02. `getActiveDraft` ne filtre pas par fournisseur
**Constat** : La fonction retourne le dernier brouillon du client, quel que soit le fournisseur.  
**Impact** : Si deux brouillons existent pour deux fournisseurs différents, seul le plus récent est retourné.  
**Mitigation** : `ResumeOrNewDraftDialog` gère ce cas côté UI.

#### M-03. `fmtDateTime` dupliquée dans 4 fichiers
**Constat** : Fonction utilitaire de formatage date/heure dupliquée.  
**Recommandation** : Extraire dans un utilitaire partagé post-freeze.

#### M-04. Notifications — pas de fallback si `notification_rules` n'existe pas
**Constat** : Si le `alert_type` n'a pas de rule correspondante, la notification est silencieusement ignorée. Le edge function `commandes-plats-api` a un fallback (recherche sans `establishment_id`), mais `commandes-api` fait un `.single()` qui peut échouer.  
**Recommandation** : Harmoniser le pattern de fallback.

---

## 8. Dette technique réellement utile

| # | Dette | Impact | Effort |
|---|-------|--------|--------|
| D-01 | `ReceptionDialog.tsx` 1509 lignes | Maintenabilité | Moyen |
| D-02 | `NouvelleCommandeDialog.tsx` 933 lignes | Maintenabilité | Moyen |
| D-03 | `CommandeDetailDialog.tsx` 806 lignes | Maintenabilité | Léger |
| D-04 | `supabase as any` dans tous les services | Type-safety | Léger |
| D-05 | Duplication `filterUsersByCommandeAccess` | DRY | Trivial |
| D-06 | Duplication `fmtDateTime` | DRY | Trivial |

---

## 9. Recommandations

### À corriger avant prod

| # | Action | Justification |
|---|--------|---------------|
| **P-01** | Documenter explicitement que les lignes sont modifiables en statut `envoyee` | Éviter la confusion métier sur l'immutabilité des commandes envoyées |
| **P-02** | Vérifier le comportement de `fn_receive_commande` si un RECEIPT DRAFT existe déjà pour la même zone | Risque de crash en production (R-01) |

### À corriger juste après freeze V1

| # | Action |
|---|--------|
| **PF-01** | Ajouter le snapshot des prix (`unit_price_snapshot`, `line_total_snapshot`) dans `fn_send_commande` |
| **PF-02** | Extraire `filterUsersByCommandeAccess` dans `_shared/` |
| **PF-03** | Ajouter pagination/filtre date sur `getCommandes` |
| **PF-04** | Refactorer `ReceptionDialog` en composants + hooks dédiés |

### À surveiller mais non bloquant

| # | Point |
|---|-------|
| **S-01** | Performance de `resolve_commande_actors` avec beaucoup de commandes |
| **S-02** | Comportement avec > 1000 commandes (limite Supabase) |
| **S-03** | Cohérence temporelle DLC (écrite côté frontend, non-bloquante) |

---

## 10. Plan de sécurisation minimal

### Avant mise en prod

1. **Test de concurrence** : Vérifier manuellement que deux utilisateurs ne peuvent pas expédier/recevoir la même commande simultanément (le FOR UPDATE devrait garantir ça).

2. **Test litige surplus** : Vérifier le flow complet surplus → litige → résolution → ADJUSTMENT stock négatif.

3. **Test idempotency** : Double-cliquer sur "Expédier" et "Valider réception" — vérifier qu'aucun doublon de stock_document n'est créé.

4. **Vérification RLS** : S'assurer qu'un client ne peut pas voir les commandes d'un autre client, et qu'un fournisseur ne voit que ses propres commandes.

5. **Test `missing_zone`** : Créer une commande avec un produit sans `storage_zone_id` — vérifier que la réception retourne une erreur claire.

### Post-launch monitoring

- Surveiller les erreurs `fn_ship_commande` et `fn_receive_commande` dans les edge function logs
- Alerter si un litige reste `open` > 7 jours
- Alerter si une commande reste `expediee` > 14 jours sans réception

---

## 11. Questions ouvertes

| # | Question | Contexte |
|---|----------|----------|
| **Q-01** | Les lignes doivent-elles être modifiables en statut `envoyee` ? | Actuellement c'est le cas (add/edit/remove possible). Si non voulu, ajouter des gardes. |
| **Q-02** | Faut-il un soft-delete pour les brouillons ? | Actuellement DELETE physique. Un audit trail pourrait être utile pour le support. |
| **Q-03** | Le snapshot de prix est-il nécessaire dès V1 ? | Si les factures sont toujours générées immédiatement après réception, l'écart est négligeable. |
| **Q-04** | Que se passe-t-il si le mapping `b2b_imported_products` est supprimé entre commande et réception ? | Le stock RECEIPT côté client utilise `products_v2` directement. Le WITHDRAWAL côté FO utilise le mapping. Scénario edge-case à documenter. |
| **Q-05** | La résolution de litige devrait-elle vérifier le rôle (fournisseur uniquement) via RBAC plutôt que `user_establishments` ? | Actuellement, tout membre du supplier establishment peut résoudre. |

---

## Annexe A — Diagramme de transition des statuts

```
┌──────────┐     fn_send      ┌──────────┐    fn_open     ┌──────────┐
│ brouillon├────────────────►│ envoyee  ├──────────────►│ ouverte  │
└──────────┘                 └──────────┘               └────┬─────┘
                                                              │
                                                   fn_ship    │
                                                              ▼
                                                        ┌──────────┐
                                                        │ expediee │
                                                        └────┬─────┘
                                                              │
                                                   fn_receive │
                                              ┌───────────────┼───────────────┐
                                              ▼               ▼               │
                                        ┌──────────┐   ┌──────────┐          │
                                        │  recue   │   │  litige  │          │
                                        └────┬─────┘   └────┬─────┘          │
                                              │              │                │
                                   fn_invoice │   fn_resolve │                │
                                              ▼              ▼                │
                                        ┌──────────┐   ┌──────────┐          │
                                        │ cloturee │   │  recue   ├──────────┘
                                        └──────────┘   └──────────┘
```

## Annexe B — Opérations atomiques requises

| Opération | Atomicité | Mécanisme |
|-----------|-----------|-----------|
| Envoi commande | ✅ Atomique | RPC `fn_send_commande` (snapshot + transition) |
| Ouverture | ✅ Idempotente | RPC `fn_open_commande` (FOR UPDATE + idempotent) |
| Expédition + stock WITHDRAWAL | ✅ Atomique | RPC `fn_ship_commande` (lignes + transition + stock en une TX) |
| Réception + stock RECEIPT + litige | ✅ Atomique | RPC `fn_receive_commande` (lignes + transition + stock + litige en une TX) |
| Résolution litige + ADJUSTMENT | ✅ Atomique | RPC `fn_resolve_litige` (stock adjustment + transition en une TX) |
| Suppression brouillon | Non critique | DELETE direct (acceptable — brouillon non engageant) |

## Annexe C — Points de calcul critiques

| Calcul | Localisation | Type | Sûreté |
|--------|-------------|------|--------|
| Clamp shipped ≤ ordered | `fn_ship_commande` + trigger `trg_clamp_shipped_quantity` | Backend | ✅ Double sécurité |
| Écart shipped vs received | `litiges/utils/ecart.ts` | Frontend (SSOT unique) | ✅ |
| Litige auto (écart détecté) | `fn_receive_commande` | Backend | ✅ |
| Stock delta withdrawal | `fn_ship_commande` | Backend | ✅ |
| Stock delta receipt | `fn_receive_commande` | Backend | ✅ |
| Stock adjustment litige | `fn_resolve_litige` | Backend | ✅ |
| Total ligne (plats) | `upsertCommandePlatLines` | Frontend | ⚠️ Calcul côté frontend (`price × qty`) |

---

*Fin de l'audit. Document à archiver comme référence pré-freeze V1.*
