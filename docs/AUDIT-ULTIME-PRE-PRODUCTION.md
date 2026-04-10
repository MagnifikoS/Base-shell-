# Audit Ultime Pré-Production SaaS

> **Date :** 2026-03-10  
> **Périmètre :** Module Commandes B2B (produit + plat), Facturation, Litiges, Retours, Stock, Notifications, Realtime, Sécurité multi-org  
> **Objectif :** Détecter les bugs invisibles avant montée en charge  
> **Approche :** Audit uniquement — aucune modification de code

---

## SECTION 1 — Architecture Overview

| Composant | Technologie | Rôle |
|-----------|------------|------|
| DB | PostgreSQL (Supabase) | 84 tables, 339 RLS, 229 migrations |
| RPC critiques | 8 SECURITY DEFINER | Mutations atomiques (send, open, ship, receive, resolve, invoice) |
| Edge Functions | commandes-api, commandes-plats-api, push | Orchestration + push WebPush |
| Realtime | 21 channels | Sync cross-device instantanée |
| Frontend | React 18 + TanStack Query | SPA, staleTime 60s par défaut |

**Volumes actuels (beta) :**
| Table | Lignes | Taille |
|-------|--------|--------|
| badge_events | 2054 | 1136 kB |
| audit_logs | 1481 | 856 kB |
| stock_events | 1305 | 800 kB |
| notification_events | 1044 | 1264 kB |
| commande_lines | 28 | 112 kB |
| commandes | 13 | 96 kB |

---

## SECTION 2 — Risques Concurrence

### Analyse des protections transactionnelles

| Flux | SELECT FOR UPDATE | Atomicité RPC | Anti-doublon DB | Risque |
|------|:-:|:-:|:-:|--------|
| Envoyer commande (`fn_send_commande`) | ✅ | ✅ | Séquence `commande_order_seq` | 🟢 Aucun |
| Ouvrir commande (`fn_open_commande`) | ✅ | ✅ idempotent | N/A | 🟢 Aucun |
| Expédier commande (`fn_ship_commande`) | ✅ | ✅ + idempotency_key | `ON CONFLICT DO NOTHING` | 🟢 Aucun |
| Réceptionner commande (`fn_receive_commande`) | ✅ | ✅ + idempotency_key | `ON CONFLICT` | 🟢 Aucun |
| Réceptionner plat (`fn_receive_commande_plat`) | ✅ | ✅ | `ON CONFLICT DO NOTHING` (litige) | 🟢 Aucun |
| **Générer facture** (`fn_generate_app_invoice`) | ✅ | ✅ atomique | `UNIQUE(commande_id)` sur `app_invoices` | 🟢 Aucun |
| Résoudre litige produit (`fn_resolve_litige`) | ✅ | ✅ + access check | `ON CONFLICT` stock docs | 🟢 Aucun |
| Résoudre litige plat (`fn_resolve_litige_plat`) | ✅ | ✅ | `UNIQUE(commande_plat_id)` | 🟢 Aucun |
| **Créer retour** (service frontend) | ❌ | ❌ pas de RPC | ❌ aucune contrainte UNIQUE | 🔴 **P1** |
| **Notification facture** (frontend fire-and-forget) | ❌ | ❌ insert direct | ❌ pas d'idempotency | 🟡 **P2** |

### Problèmes identifiés

**🔴 P1 — Retours : Aucune protection DB anti-doublon**
- Table `product_returns` : **pas de contrainte UNIQUE** sur `(commande_line_id, return_type)`.
- Le guard frontend ajouté récemment (check avant INSERT) est insuffisant en concurrence : deux onglets peuvent passer le check simultanément.
- **Impact à l'échelle :** Doublons de retours → comptabilité faussée, litiges fantômes.
- **Recommandation :** Ajouter `UNIQUE(commande_line_id, return_type) WHERE status != 'refused'` ou migrer vers une RPC avec `FOR UPDATE`.

**🟡 P2 — Notification facture : pas d'idempotency**
- `emitInvoiceNotification()` dans `GenerateInvoiceButton.tsx` fait un INSERT direct sans `alert_key` unique.
- Si l'utilisateur rafraîchit et la mutation React Query replay, double notification.
- **Impact :** Bruit notification, pas de corruption data.
- **Recommandation :** Utiliser un `alert_key` unique comme `commande_facturee:{commandeId}:{userId}`.

---

## SECTION 3 — Risques Données (Intégrité)

### Contraintes et FK

| Relation | FK | UNIQUE | CASCADE | Verdict |
|----------|:--:|:------:|:-------:|---------|
| litiges → commandes | ✅ | ✅ `commande_id` | CASCADE DELETE | 🟢 |
| litige_plats → commande_plats | ✅ | ✅ `commande_plat_id` | pas de CASCADE | 🟢 (voulu) |
| app_invoices → commandes | ✅ | ✅ `commande_id` (1:1) | pas de CASCADE | 🟢 (voulu — facture pérenne) |
| product_returns → commande_lines | ✅ | ❌ **AUCUNE** | SET NULL | 🔴 **P1** |
| product_returns → commandes | ✅ | ❌ | CASCADE DELETE | 🟡 risque si commande supprimée |
| order_groups → commandes | ✅ | N/A | N/A | 🟢 |
| commande_lines → commandes | ✅ | ✅ `(commande_id, product_id)` | N/A | 🟢 |
| commande_plat_lines → commande_plats | ✅ | ✅ `(commande_plat_id, listing_id)` | N/A | 🟢 |

### Problèmes identifiés

**🔴 P1 — product_returns : pas de UNIQUE constraint**
- Voir section 2. Doublon possible sur `(commande_line_id, return_type)`.

**🟡 P2 — litiges : CASCADE DELETE depuis commandes**
- Si une commande est supprimée (seuls les brouillons le permettent via RLS), ses litiges partent en cascade.
- En pratique : non dangereux car la RLS ne permet DELETE que sur `status = 'brouillon'`, et un brouillon n'a jamais de litige.
- **Recommandation :** Ajouter un trigger BEFORE DELETE validant qu'il n'y a pas de litige associé (defence in depth).

**🟢 — commande_lines : immutabilité prix**
- Le trigger `trg_immutable_price_snapshot` protège `unit_price_snapshot` après `fn_send_commande`. Excellent.

---

## SECTION 4 — Risques Scalabilité

### Projection à 12 mois (100 restaurants, 3000 commandes/jour)

| Table | Croissance estimée | Lignes/an | Taille estimée | Index critiques | Risque |
|-------|-------------------|-----------|----------------|-----------------|--------|
| **stock_events** | ~50 events/commande × 3000/j | ~55M | ~30 GB | ✅ `(product_id, zone, posted_at)` | 🟡 **P1** |
| **notification_events** | ~5 notifs/commande × 3000/j | ~5.5M | ~6 GB | ✅ idempotent, alert_key | 🟡 **P2** |
| **commande_lines** | ~8 lignes/commande × 3000/j | ~8.7M | ~4 GB | ✅ `(commande_id)`, `(commande_id, product_id)` | 🟢 |
| **badge_events** | ~4 events/employé/j × 500 emp | ~730K | ~400 MB | ✅ multi-index | 🟢 |
| **audit_logs** | ~10/j × 100 restaurants | ~365K | ~200 MB | ❌ seulement PK | 🟡 **P2** |

### Problèmes identifiés

**🟡 P1 — stock_events : croissance la plus rapide**
- Table append-only, jamais purgée.
- Requêtes de stock courant = `SUM(delta) GROUP BY product_id, zone_id` sur toute la table.
- Le `zone_stock_snapshots` atténue (point de départ pour le calcul), mais le volume entre snapshots croît.
- **Recommandation :** Partitionnement par `posted_at` (mensuel) ou archivage des events > 6 mois.

**🟡 P2 — notification_events : pas d'index sur `recipient_user_id`**
- Les queries utilisateur font `WHERE recipient_user_id = auth.uid()` — seul index = PK + `(establishment_id, alert_key, recipient_user_id)`.
- L'index composite couvre ce filtre si `establishment_id` est aussi filtré, mais la query directe par `recipient_user_id` seul n'est pas indexée.
- **Recommandation :** `CREATE INDEX idx_notif_recipient ON notification_events(recipient_user_id, sent_at DESC)`.

**🟡 P2 — notification_events : pas de purge**
- Table append-only sans politique de rétention.
- **Recommandation :** Job CRON supprimant les notifications lues > 90 jours.

**🟡 P2 — audit_logs : aucun index métier**
- Seul PK. Pas d'index sur `(organization_id, created_at)` ou `(target_type, target_id)`.
- **Recommandation :** Ajouter index composite pour les requêtes de recherche d'audit.

---

## SECTION 5 — Risques Realtime

### Canaux actifs

21 channels montés dans `useAppRealtimeSync`. Tous sur des tables spécifiques avec filtrage `establishment_id` ou `organization_id`.

| Canal | Table | Filtre | Volume événements | Risque |
|-------|-------|--------|-------------------|--------|
| badge_events | badge_events | establishment_id | ~4/emp/jour | 🟢 |
| stock_events | stock_events | establishment_id | ⚠️ burst en réception | 🟡 **P2** |
| notification_events | notification_events | establishment_id | ~5/commande | 🟡 **P2** |
| commandes | commandes | client OR supplier est | modéré | 🟢 |
| commande_plats | commande_plats | client OR supplier est | modéré | 🟢 |
| inventory_lines | inventory_lines | session-based | burst pendant inventaire | 🟢 |
| Autres (12) | Divers | establishment/org | faible | 🟢 |

### Problèmes identifiés

**🟡 P2 — stock_events : realtime flood en réception**
- `fn_receive_commande` insère potentiellement 8+ stock_events atomiquement.
- Chaque INSERT déclenche un event realtime → burst de 8+ invalidations React Query simultanées.
- **Impact :** Multiple refetch `estimated-stock`, `stock-alerts`, `desktop-stock` en cascade.
- **Recommandation :** Debounce l'invalidation dans `useStockEventsChannel` (batch 500ms).

**🟡 P2 — Fuite inter-org via realtime**
- Les canaux `commandes` et `commande_plats` utilisent un filtre par `establishment_id` côté client.
- Supabase Realtime respecte la RLS pour les événements postgres_changes → pas de fuite réelle.
- **Verdict :** Pas de fuite, mais vérifier que RLS est activé sur toutes les tables du realtime publication.

**🟢 — Pas de canal sans filtre**
- Tous les canaux passent un `filter` ou sont montés conditionnellement (`enabled: !!establishmentId`).

---

## SECTION 6 — Risques Sécurité Multi-Organisation

### Analyse RLS

| Table | Isolation | Mécanisme | Risque |
|-------|-----------|-----------|--------|
| commandes | ✅ | `get_user_establishment_ids()` | 🟢 |
| commandes (brouillons) | ✅ | Fournisseur ne voit pas `status = 'brouillon'` | 🟢 Excellent |
| commande_plats | ✅ | `profiles.organization_id → establishments` | 🟢 |
| litiges | ✅ | Via `commandes` JOIN `user_establishments` | 🟢 |
| litige_plats | ✅ | Via `commande_plats` JOIN | 🟢 |
| app_invoices | ✅ | `supplier_establishment_id` ou `client_establishment_id` | 🟢 |
| product_returns | ✅ | `client_establishment_id` ou `supplier_establishment_id` | 🟢 |
| stock_events | ✅ | `establishment_id IN get_user_establishment_ids()` | 🟢 |
| notification_events | ✅ | `recipient_user_id = auth.uid()` | 🟢 |
| **commande_lines** | ⚠️ | Via `commande_id` → `commandes` RLS | 🟡 **P2** |
| **order_groups** | ⚠️ | Via `commande_id` → `commandes` RLS | 🟢 |

### Problèmes identifiés

**🟡 P2 — commandes : UPDATE policy trop restrictive**
- `commandes_update` autorise UPDATE uniquement pour `client_establishment_id IN get_user_establishment_ids() AND status IN ('brouillon', 'envoyee')`.
- Les RPCs SECURITY DEFINER contournent cette restriction pour les transitions serveur.
- **Risque :** Un client côté frontend ne peut pas directement modifier une commande `ouverte` ou `expediee` — c'est voulu et correct.
- **Mais :** Le fournisseur n'a aucune policy UPDATE directe. Toutes ses actions passent par RPC SECURITY DEFINER. ✅ C'est le bon pattern.

**🟡 P2 — commande_plats : RLS organisation-wide**
- La policy `commande_plats_select` utilise `profiles.organization_id = establishments.organization_id`.
- **Conséquence :** Un établissement dans la même org peut voir les commandes plats d'un autre établissement de la même org, même sans partenariat.
- **Impact réel :** Fuite de visibilité intra-org (faible risque si org = même entreprise), mais pas inter-org.
- **Recommandation :** Remplacer par `user_establishments` pour un filtrage strict par établissement (comme `commandes`).

---

## SECTION 7 — Risques UX (Erreurs Utilisateur)

| Scénario | Protection actuelle | Risque |
|----------|-------------------|--------|
| Double clic envoi commande | ✅ `isSending` state + RPC idempotente | 🟢 |
| Double clic expédition | ✅ RPC `FOR UPDATE` + `status != 'ouverte'` guard | 🟢 |
| Double clic réception | ✅ RPC `FOR UPDATE` + `status != 'expediee'` guard | 🟢 |
| Double clic facture | ✅ `isGenerating` state + UNIQUE DB + RPC guard | 🟢 |
| Double clic retour | 🟡 `isPending` guard front + check service | 🟡 **P2** (pas de UNIQUE DB) |
| Connexion perdue pendant envoi | ✅ RPC atomique — soit tout passe, soit rien | 🟢 |
| Refresh pendant mutation | ✅ React Query retry + RPC idempotentes | 🟢 |
| Formulaire retour soumis 2x | 🟡 Guard front seulement | 🟡 **P2** |
| Fermeture onglet pendant expédition stock | ✅ Transaction DB — rollback automatique | 🟢 |

---

## SECTION 8 — Risques Monitoring / Observabilité

| Zone | Monitoring actuel | Verdict |
|------|------------------|---------|
| Commandes bloquées | ✅ `useStaleCommandesPlats` (> 48h) | 🟢 |
| Litiges ouverts trop longtemps | ❌ Aucun monitoring | 🔴 **P1** |
| Factures non générées (commandes `recue` > 7j) | ❌ Aucun monitoring | 🟡 **P2** |
| Plats jamais expédiés | ✅ couvert par stale commandes plats | 🟢 |
| Stock négatif | ❌ Hors scope — mais aucun alerting | 🟡 **P2** |
| Notifications non délivrées (push fail) | ✅ Edge function log `Push delivered` | 🟢 |
| Edge function errors | 🟡 Logs seulement — pas d'alerting | 🟡 **P2** |
| DB connection pool exhaustion | ❌ Aucun monitoring | 🟡 **P2** |
| Realtime channel drops | ❌ Aucun monitoring | 🟡 **P2** |

### Recommandations prioritaires

1. **P1** — Hook `useStaleLitiges()` : litiges `status = 'open'` créés > 72h.
2. **P2** — Hook `useUnbilledCommandes()` : commandes `status = 'recue'` sans facture > 7j.
3. **P2** — Alerting Sentry/edge function errors en production.

---

## SECTION 9 — Risques Long Terme

### 9.1 — Croissance notification_events (P2)
- Pas de purge → table illimitée.
- Chaque commande génère ~5 notifications × N membres établissement.
- À 100 restaurants : ~5.5M rows/an.
- **Solution :** CRON de purge `read_at IS NOT NULL AND sent_at < now() - interval '90 days'`.

### 9.2 — stock_events non partitionnée (P1)
- Table critique pour performance stock.
- Volume projeté : 55M rows/an.
- PostgreSQL sans partitionnement = dégradation progressive des SUM().
- **Solution :** Partitionnement par range sur `posted_at` (mensuel).

### 9.3 — Realtime à 21+ channels par client (P2)
- Supabase limite les connexions simultanées par projet.
- 500 utilisateurs × 21 channels = 10,500 canaux simultanés.
- **Solution :** Consolider les channels liés (ex: `commandes` + `commande_plats` + `litiges` → 1 channel `orders`).

### 9.4 — Edge Functions sans retry (P2)
- `commandes-api` et `commandes-plats-api` : push WebPush sans retry si échec réseau.
- En pratique : fire-and-forget acceptable pour push, mais log silencieux si Supabase est down.
- **Solution :** Queue de retry pour push critiques (ex: pg_cron + table `push_queue`).

### 9.5 — RPC SECURITY DEFINER sans rate limiting (P2)
- Toutes les RPCs critiques sont `SECURITY DEFINER` — pas de rate limit.
- Un utilisateur malveillant pourrait appeler `fn_generate_app_invoice` en boucle (rejeté par les guards, mais charge DB).
- **Solution :** Rate limiting au niveau Edge Function (pas critique car RPCs sont gardées).

---

## SECTION 10 — Recommandations Priorisées

### 🔴 P0 — Critique (0 trouvé)
Aucun bug critique bloquant identifié. Les flux critiques sont tous protégés par des RPCs atomiques avec `FOR UPDATE`.

### 🔴 P1 — Important (3 trouvés)

| # | Problème | Impact | Solution |
|---|----------|--------|----------|
| 1 | **product_returns : pas de UNIQUE DB** | Doublons possibles en concurrence | `ALTER TABLE product_returns ADD CONSTRAINT uq_return_line_type UNIQUE(commande_line_id, return_type) WHERE status != 'refused'` |
| 2 | **Litiges ouverts : pas de monitoring** | Litiges oubliés bloquent les commandes | Hook `useStaleLitiges()` avec alerte > 72h |
| 3 | **stock_events : croissance sans partitionnement** | Dégradation perf à 6-12 mois | Planifier partitionnement par `posted_at` |

### 🟡 P2 — Dette (8 trouvés)

| # | Problème | Solution |
|---|----------|----------|
| 1 | notification_events : pas d'index `recipient_user_id` | Index composite |
| 2 | notification_events : pas de purge | CRON 90 jours |
| 3 | audit_logs : pas d'index métier | Index `(organization_id, created_at)` |
| 4 | commande_plats RLS : trop large (org-wide) | Migrer vers `user_establishments` |
| 5 | Realtime stock_events : burst invalidation | Debounce 500ms |
| 6 | Factures non générées : pas de monitoring | Hook monitoring |
| 7 | 21 realtime channels par client | Consolidation à 12-15 |
| 8 | emitInvoiceNotification : pas d'idempotency | Ajouter alert_key unique |

### 🟢 P3 — Amélioration (3 trouvés)

| # | Amélioration |
|---|-------------|
| 1 | Rate limiting Edge Functions |
| 2 | Retry queue pour push WebPush |
| 3 | Channel realtime consolidation |

---

## Verdict Final

| Catégorie | Score | Commentaire |
|-----------|:-----:|-------------|
| Concurrence & Transactions | **9/10** | Toutes les RPCs critiques utilisent `FOR UPDATE`. Seul `product_returns` n'a pas de protection DB. |
| Intégrité Données | **9/10** | FK complètes, UNIQUE sur les relations 1:1, triggers immutabilité. Retours = point faible. |
| Scalabilité | **7/10** | stock_events et notification_events vont poser problème à 6-12 mois sans partitionnement/purge. |
| Realtime | **8/10** | Architecture propre, 21 channels filtrés, pas de fuite. Burst stock à optimiser. |
| Sécurité Multi-Org | **9/10** | RLS correcte partout. commande_plats légèrement trop permissive intra-org. |
| Résilience UX | **9/10** | Guards front + RPCs idempotentes. Retours = seul flux non protégé niveau DB. |
| Monitoring | **6/10** | Commandes plats bloquées = OK. Litiges, factures, stock négatif = aucun monitoring. |
| Architecture globale | **8.5/10** | Solide pour un pré-lancement. 3 actions P1 avant scale réel. |

### 🟢 **GO pour lancement avec les 3 corrections P1 avant montée en charge.**
