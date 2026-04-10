# Audit Notifications Commandes

**Date** : 2026-03-10  
**Version** : 1.0  
**Scope** : Notifications commandes produit + plats — Centre, Mobile, Push  
**Méthodologie** : Analyse statique du code + requêtes DB live + cartographie des flux

---

## SECTION 1 — Executive Summary

### Verdict global : 🟡 GO CONDITIONNEL

Le système de notifications commandes est **fonctionnellement complet** avec une séparation client/fournisseur **correcte dans le code actuel**. Cependant, des problèmes significatifs existent :

| Gravité | Problème | Impact |
|---------|----------|--------|
| **P0** | Commandes Plats : **aucun push** envoyé (centre de notif uniquement) | Fournisseurs plats ne reçoivent pas de push sur mobile |
| **P0** | Deep link cassé : clé `commande_id` vs `order_id` incohérente dans le payload | Clic sur notification → "Commande introuvable" |
| **P1** | Données historiques polluées (Labaja reçoit des notifs Sapori MIEI) | Fuite de notification héritée de l'ancien système RPC |
| **P1** | Notifications commandes produit : règles globales (sans `establishment_id`) | Pas de granularité par établissement pour activer/désactiver |
| **P2** | Commande plats : notifications `commande_plat_litige` pas de règle pour `commande_litige` produit | Incohérence de nomenclature entre les deux modules |
| **P2** | Centre de notif filtré par service_day : notifications anciennes disparaissent | Pas d'historique au-delà du jour de service |

### Séparation client/fournisseur : ✅ **Fiable dans le code actuel**

Le code actuel (post-mars 2026) route correctement les notifications vers les bons `establishment_id`. Les fuites observées en DB sont des reliquats de l'ancien système `fn_send_commande_notification` (supprimé).

---

## SECTION 2 — Cartographie du Système de Notifications

### Architecture globale

```
┌──────────────────────┐     ┌──────────────────────┐
│  commandes-api       │     │  commandes-plats-api  │
│  (Edge Function)     │     │  (Edge Function)      │
│                      │     │                       │
│  ✅ notification_events    │  ✅ notification_events │
│  ✅ push (WebPush)   │     │  ❌ PAS DE PUSH       │
│  ✅ audit_logs       │     │  ❌ PAS D'AUDIT_LOGS  │
└──────────┬───────────┘     └──────────┬────────────┘
           │                            │
           ▼                            ▼
┌──────────────────────────────────────────────────┐
│  notification_events (table SSOT)                │
│  - establishment_id (vers quel établissement)    │
│  - recipient_user_id (vers quel utilisateur)     │
│  - alert_type (type d'événement)                 │
│  - payload (title, body, commande_id/order_id)   │
│  - read_at (lu/non lu)                           │
│  - sent_at (horodatage)                          │
└──────────────────────┬───────────────────────────┘
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
    ┌─────────┐  ┌──────────┐  ┌─────────┐
    │ Centre  │  │ Realtime │  │  Push   │
    │ Notif   │  │ Channel  │  │ WebPush │
    │ (page)  │  │ (toast)  │  │ (SW)   │
    └─────────┘  └──────────┘  └─────────┘
```

### Tables

| Table | Rôle |
|-------|------|
| `notification_events` | SSOT — stocke toutes les notifications envoyées |
| `notification_rules` | Règles : quel `alert_type` est activé, avec quel template |
| `push_subscriptions` | Tokens WebPush par utilisateur/appareil/établissement |
| `notification_delivery_logs` | Logs de livraison push (optionnel) |
| `notification_incidents` | Incidents badgeuse (pas utilisé pour commandes) |

### Services / Edge Functions

| Composant | Responsabilité |
|-----------|---------------|
| `commandes-api` | Orchestre les commandes produit + notifications + push |
| `commandes-plats-api` | Orchestre les commandes plats + notifications (PAS de push) |
| `notif-check-badgeuse` | Moteur CRON badgeuse (ne concerne PAS les commandes) |
| `push-send` | Test/debug uniquement — PAS le moteur de production |

### Hooks Frontend

| Hook | Rôle |
|------|------|
| `useNotificationEvents` | Fetch les events du jour de service pour l'utilisateur courant |
| `useUnreadAlertsCount` | Badge compteur non lu (mobile bottom nav) |
| `useNotificationEventsChannel` | Realtime : toast + invalidation cache |
| `useAppRealtimeSync` | Monte le channel realtime (une seule fois dans AppLayout) |

### Canaux de distribution

| Canal | Commandes Produit | Commandes Plats |
|-------|:-:|:-:|
| Centre de notifications (page) | ✅ | ✅ |
| Toast realtime | ✅ | ✅ |
| Badge non lu | ✅ | ✅ |
| Push WebPush | ✅ | ❌ **MANQUANT** |

---

## SECTION 3 — Audit Commandes Produit

### Événements couverts

| Événement métier | alert_type | Qui reçoit | establishment_id | Push |
|------------------|-----------|------------|-------------------|:----:|
| Envoi commande | `commande_envoyee` | Client (créateur) | `client_establishment_id` | ✅ |
| Réception par fournisseur | `commande_recue` | Tous membres fournisseur | `supplier_establishment_id` | ✅ |
| Ouverture par fournisseur | `commande_ouverte` | Client (créateur) | `client_establishment_id` | ✅ |
| Expédition complète | `commande_expediee_complete` | Tous membres client | `client_establishment_id` | ✅ |
| Expédition partielle | `commande_expediee_partielle` | Tous membres client | `client_establishment_id` | ✅ |
| Réception complète | `commande_reception_validee_complete` | Tous membres fournisseur | `supplier_establishment_id` | ✅ |
| Réception partielle | `commande_reception_validee_partielle` | Tous membres fournisseur | `supplier_establishment_id` | ✅ |
| Litige créé | `commande_litige` | Tous membres fournisseur | `supplier_establishment_id` | ✅ |
| Litige résolu | `commande_litige_resolue` | Tous membres client | `client_establishment_id` | ✅ |

### Analyse du routage

Le code `commandes-api` utilise directement les champs de la commande :
- `ctx.commande.client_establishment_id` → pour notifications côté client
- `ctx.commande.supplier_establishment_id` → pour notifications côté fournisseur
- `ctx.commande.created_by` → pour notifier le créateur spécifiquement

**Verdict routage produit : ✅ CORRECT** — Pas de lookup par organisation, pas de mélange possible.

### Problèmes identifiés

#### P0 — Incohérence de clé de payload : `commande_id` vs `order_id`

Le code actuel de `commandes-api` utilise `commande_id` dans le payload :
```typescript
payload: { title: "...", body: "...", commande_id: ctx.commande.id }
```

Mais le frontend (`Notifications.tsx` ligne 366) cherche `order_id` :
```typescript
const orderId = (event.payload as Record<string, unknown> | null)?.order_id;
```

**Données en base** (requête live) :
- `commande_envoyee` : 62 avec `commande_id`, 0 avec `order_id`
- `commande_expediee_complete` : 218 avec `commande_id`, 30 avec `order_id`
- `commande_recue` : 98 avec `commande_id`, 66 avec `order_id`
- `commande_reception_validee_partielle` : 0 avec `commande_id`, 6 avec `order_id`

**Impact** : Cliquer sur une notification `commande_envoyee` ou `commande_ouverte` → affiche "Commande introuvable ou accès non autorisé" car `order_id` est `undefined`.

Les 30 événements avec `order_id` viennent de l'ancien système `fn_send_commande_notification`. Les 218+ avec `commande_id` viennent du nouveau code. Le frontend ne gère que `order_id`.

#### P1 — Règles de notification globales (sans `establishment_id`)

Les 7 notification_rules pour les commandes produit ont `establishment_id = NULL` :

```
commande_envoyee      → establishment_id: NULL
commande_recue        → establishment_id: NULL
commande_ouverte      → establishment_id: NULL
...
```

Conséquence : un admin ne peut pas désactiver les notifications commande pour un établissement spécifique. Le `NotificationRulesCard` filtre par `establishment_id` → ces règles globales sont **invisibles** dans l'interface de configuration.

Le code de `commandes-api` fait :
```typescript
const { data: rules } = await admin.from("notification_rules")
  .select("id, alert_type").in("alert_type", ["commande_envoyee", "commande_recue"]);
```
→ Aucun filtre par `establishment_id`, ce qui fonctionne avec des règles globales mais empêche la granularité.

#### P1 — Notification `commande_litige` : pas de règle en DB

La requête pour trouver la règle fait `.eq("alert_type", "commande_litige").single()`. Si aucune règle n'existe avec ce type exact, la notification n'est pas insérée. Vérification : aucun événement `commande_litige` en base → le litige produit est potentiellement silencieux.

Cependant, la contrainte CHECK autorise `commande_litige` mais aucune règle n'a été insérée par les migrations pour ce type. **Les litiges produit ne génèrent aucune notification.**

### Verdict Commandes Produit : 🟡

- Routage client/fournisseur : ✅ correct
- Couverture événements : ⚠️ `commande_litige` non notifié
- Deep link : ❌ cassé (`commande_id` vs `order_id`)
- Push : ✅ fonctionnel
- Règles configurables : ⚠️ globales, pas par établissement

---

## SECTION 4 — Audit Commandes Plats

### Événements couverts

| Événement métier | alert_type | Qui reçoit | establishment_id | Push |
|------------------|-----------|------------|-------------------|:----:|
| Envoi | `commande_plat_envoyee` | Client (créateur) | `client_establishment_id` | ❌ |
| Réception fournisseur | `commande_plat_recue` | Tous membres fournisseur | `supplier_establishment_id` | ❌ |
| Ouverture | `commande_plat_ouverte` | Client (créateur) | `client_establishment_id` | ❌ |
| Expédition | `commande_plat_expediee` | Tous membres client | `client_establishment_id` | ❌ |
| Réception validée | `commande_plat_reception_validee` | Tous membres fournisseur | `supplier_establishment_id` | ❌ |
| Litige créé | `commande_plat_litige` | Fournisseur + Client (créateur) | Les deux `establishment_id` | ❌ |
| Litige résolu | `commande_plat_litige_resolu` | Client (créateur) | `client_establishment_id` | ❌ |

### Analyse du routage

Le code `commandes-plats-api` utilise `fetchCmdPlatCtx()` pour récupérer :
- `ctx.client_establishment_id`
- `ctx.supplier_establishment_id`
- `ctx.created_by`

Puis utilise `getEstablishmentMembers()` pour trouver les destinataires par `user_establishments`.

**Verdict routage plats : ✅ CORRECT** — Même logique saine que les produits.

### Problèmes identifiés

#### P0 — Aucun push WebPush pour les commandes plats

Le fichier `commandes-plats-api/index.ts` ne contient **aucun import** de `sendWebPush` ni appel à `deliverPushToUsers`. Comparaison :

| Capacité | `commandes-api` (produit) | `commandes-plats-api` (plat) |
|----------|:-:|:-:|
| Insert `notification_events` | ✅ | ✅ |
| `deliverPushToUsers` | ✅ | ❌ |
| `import sendWebPush` | ✅ | ❌ |
| `audit_logs` insert | ✅ | ❌ |

**Impact** : Un fournisseur qui reçoit une commande plat ne recevra **jamais** de push notification sur son mobile. Il ne sera alerté que s'il a l'app ouverte (via toast realtime) ou s'il consulte le centre de notifications.

#### P2 — Pas de distinction complète/partielle pour l'expédition plats

Contrairement aux commandes produit (`commande_expediee_complete` / `commande_expediee_partielle`), les commandes plats utilisent un seul type : `commande_plat_expediee`. L'information de partialité est perdue dans la notification.

#### P2 — Deep link incomplet pour les commandes plats

Le payload contient `commande_plat_id` mais le frontend cherche `order_id` :
```typescript
const orderId = (event.payload as Record<string, unknown> | null)?.order_id;
```
→ Cliquer sur une notification plat → "Commande introuvable" car `order_id` est `undefined` et `commande_plat_id` n'est pas utilisé.

De plus, il n'y a pas de route dédiée `/commandes-plats` — le navigate va vers `/commandes` qui ne gère pas les plats.

### Verdict Commandes Plats : 🔴

- Routage client/fournisseur : ✅ correct
- Couverture événements : ✅ complète (7 types)
- Push WebPush : ❌ **totalement absent**
- Deep link : ❌ cassé
- Audit logs : ❌ absents
- Distinction partielle : ⚠️ absente

---

## SECTION 5 — Audit Centre de Notifications

### Architecture

Le centre de notifications (`src/pages/Notifications.tsx`) est la SSOT de l'affichage :

1. **Source** : `notification_events` table via `useNotificationEvents` hook
2. **Filtrage** : 
   - Par `establishment_id` (établissement actif)
   - Par `recipient_user_id` (utilisateur courant)  
   - Par `sent_at` dans la fenêtre du service day (cutoff → cutoff+1)
3. **Tri** : `sent_at DESC`
4. **Lecture** : `read_at` colonne, marquage via UPDATE direct
5. **Rendu** : Icônes différenciées par `alert_type` (Package, Truck, etc.)

### Sécurité RLS

```
notification_events :
  SELECT → recipient_user_id = auth.uid()     ← ✅ Strict par utilisateur
  SELECT → has_module_access('alertes', 'read')  ← Pour admins
  UPDATE → auth.uid() = recipient_user_id     ← Marquage lu
  ALL    → service_role                        ← Edge functions
```

**Verdict RLS : ✅ SOLIDE**
- Un utilisateur ne peut voir que ses propres notifications
- Un admin avec accès "alertes" peut voir toutes les notifications de l'établissement
- Impossible de lire les notifications d'un autre utilisateur sans le bon rôle

### Problèmes identifiés

#### P0 — Deep link cassé pour toutes les notifications récentes

Le code frontend (ligne 366) :
```typescript
const orderId = (event.payload as Record<string, unknown> | null)?.order_id;
if (orderId && typeof orderId === "string") {
  navigate(`/commandes?order=${orderId}`);
} else {
  navigate("/commandes");
  toast.error("Commande introuvable ou accès non autorisé");
}
```

Le code backend (commandes-api) écrit `commande_id`, pas `order_id`. Résultat :
- **62 notifs** `commande_envoyee` → deep link cassé (100%)
- **56 notifs** `commande_ouverte` → deep link cassé (100%)
- **218 notifs** `commande_expediee_complete` → deep link cassé (88%)
- Toutes les notifs `commande_plat_*` → deep link cassé (100%)

#### P2 — Filtrage par service_day

Les notifications ne sont affichées que pour le jour de service courant. Les notifications d'hier disparaissent du centre. Il n'y a pas d'historique ni de pagination. C'est un choix de design acceptable mais à documenter.

#### P2 — Notifications plats : icône par défaut

Les notifications `commande_plat_*` commencent par `commande_` donc le `isCommande` check passe. Mais les icônes spécifiques (`isCommandeRecue`, `isCommandeExpediee`, etc.) ne matchent pas les `commande_plat_*` types → elles tombent dans le fallback `AlertTriangle` au lieu d'avoir une icône dédiée.

### Verdict Centre de Notifications : 🟡

- Structure : ✅ propre, SSOT
- Filtrage utilisateur : ✅ correct par RLS + query
- Deep link : ❌ cassé
- Séparation client/fournisseur : ✅ via `establishment_id`
- Icônes plats : ⚠️ fallback générique
- Historique : ⚠️ jour de service uniquement

---

## SECTION 6 — Audit Mobile / Push

### Pipeline Push

```
Edge Function → deliverPushToUsers() → push_subscriptions lookup
    → sendWebPush() (Web Push Protocol via VAPID)
        → Device Service Worker (sw-push.js)
            → showNotification()
            → notificationclick → navigate(url)
```

### Tokens et abonnement

| Aspect | État |
|--------|------|
| Enregistrement | `pushNotifApi.ts` → upsert dans `push_subscriptions` par `endpoint` |
| Scope | Par utilisateur + optionnel par `establishment_id` |
| Nettoyage | 404/410 → suppression automatique du token expiré |
| RLS | Insert: own user only, Select: own user only |
| Retry | 1 retry max (`MAX_PUSH_RETRIES = 1`) |

### Ciblage push par action

| Action | Destinataires push | Source des user_ids |
|--------|-------------------|---------------------|
| send (produit) | Membres fournisseur + créateur | `user_establishments` |
| open (produit) | Créateur | `commande.created_by` |
| ship (produit) | Tous membres client | `user_establishments` |
| receive (produit) | Tous membres fournisseur | `user_establishments` |
| resolve_litige (produit) | Tous membres client | `user_establishments` |
| send (plat) | ❌ Aucun push | — |
| open (plat) | ❌ Aucun push | — |
| ship (plat) | ❌ Aucun push | — |
| receive (plat) | ❌ Aucun push | — |
| resolve_litige (plat) | ❌ Aucun push | — |

### Problèmes identifiés

#### P0 — Commandes plats : AUCUN push

Comme documenté en Section 4, `commandes-plats-api` n'importe pas `sendWebPush` et ne contient aucun appel push. Les commandes plats sont des "notifications silencieuses" — elles n'existent que dans le centre de notifications.

#### P2 — Push URL toujours `/commandes`

Toutes les push notifications produit redirigent vers `/commandes` (hardcodé). Il n'y a pas de deep link vers la commande spécifique dans le payload push :
```typescript
url: "/commandes"
```

vs le payload notification_events qui contient `commande_id`. Le service worker ne peut pas naviguer vers une commande spécifique.

#### P2 — Pas de fallback de push pour les commandes plats

Le `notif-check-badgeuse` a un système de fallback sophistiqué (scoped subs → any subs) pour les notifications badgeuse. Les commandes produit ont une version simplifiée. Les commandes plats n'ont rien.

### Verdict Mobile / Push : 🔴

- Push commandes produit : ✅ fonctionnel
- Push commandes plats : ❌ totalement absent
- Deep link push : ⚠️ générique (`/commandes`)
- Nettoyage tokens : ✅ automatique
- Séparation client/fournisseur push : ✅ correct (quand le push existe)

---

## SECTION 7 — Audit Séparation Client / Fournisseur

### Mécanisme de séparation

Le système repose sur un mécanisme clair et auditable :

1. **Chaque commande** a un `client_establishment_id` et un `supplier_establishment_id`
2. **Chaque notification** est insérée avec le bon `establishment_id` selon le rôle :
   - Notification pour le client → `establishment_id = client_establishment_id`
   - Notification pour le fournisseur → `establishment_id = supplier_establishment_id`
3. **Le centre de notifications** filtre par `establishment_id` de l'établissement actif
4. **RLS** : `recipient_user_id = auth.uid()` empêche la lecture cross-user

### Preuves de bonne séparation (code actuel)

**commandes-api (send)** :
```typescript
// Client reçoit "commande_envoyee" → establishment_id = client_establishment_id ✅
// Fournisseur reçoit "commande_recue" → establishment_id = supplier_establishment_id ✅
```

**commandes-api (ship)** :
```typescript
// Client reçoit "commande_expediee_*" → establishment_id = client_establishment_id ✅
```

**commandes-api (receive)** :
```typescript
// Fournisseur reçoit "commande_reception_validee_*" → establishment_id = supplier_establishment_id ✅
```

**commandes-plats-api** : Même logique correcte pour les 7 types.

### Fissures identifiées

#### Fissure 1 — Données historiques polluées (P1)

L'ancien système `fn_send_commande_notification` (supprimé en mars 2026) avait un bug de routage qui envoyait des notifications `commande_expediee_complete` à Labaja (établissement non impliqué dans la commande Magnifiko→Sapori MIEI).

**30 notifications parasites** existent en base pour Labaja, provenant de commandes Sapori MIEI. Labaja et Magnifiko partagent la même organisation (`f056aae1`), ce qui explique le bug de l'ancien système (routage par org au lieu de par partnership).

**Risque actuel** : Ces notifications sont visibles si un utilisateur Labaja consulte le centre de notifications pour un jour de service passé. Pas de risque de récurrence avec le code actuel.

#### Fissure 2 — Membres multi-établissements (P2)

Les utilisateurs `Fanoui Rida` et `ajaja` sont membres à la fois de Magnifiko et Labaja. Quand ils reçoivent une notification pour Magnifiko (leur rôle client), elle n'apparaît que sous l'établissement Magnifiko. S'ils switchent vers Labaja, ils ne voient PAS ces notifications. C'est le **comportement correct**.

Cependant, les anciennes notifications parasites (fissure 1) apparaissent sous Labaja → confusion.

#### Fissure 3 — Realtime channel non filtré par recipient_user_id (P2)

Le channel realtime (`useNotificationEventsChannel`) filtre par `establishment_id` mais PAS par `recipient_user_id` :

```typescript
filter: `establishment_id=eq.${establishmentId}`
```

Cela signifie que le toast apparaît chez TOUS les utilisateurs de l'établissement quand une notification est insérée, même si elle est destinée à un seul utilisateur. Le code vérifie ensuite `event.recipient_user_id !== userId` pour filtrer, mais le payload de l'événement realtime inclut les données complètes.

**Impact** : Fuite d'information mineure — un utilisateur peut voir via les logs réseau le contenu d'une notification destinée à un collègue. Pas d'impact UI car le `if` filtre correctement, mais les données transitent.

### Verdict Séparation : ✅ (code actuel) / ⚠️ (données historiques)

La séparation est **architecturalement saine** dans le code actuel. Le risque principal est la pollution historique.

---

## SECTION 8 — Matrice des Risques

### P0 — Bloquant

| # | Risque | Composant | Impact |
|---|--------|-----------|--------|
| P0-1 | **Commandes plats sans push** | `commandes-plats-api` | Fournisseurs ne reçoivent jamais de push pour les commandes plats. L'alerte arrive uniquement si l'app est ouverte. |
| P0-2 | **Deep link cassé** (`commande_id` vs `order_id`) | `commandes-api` + `Notifications.tsx` | 100% des notifications `commande_envoyee`, `commande_ouverte` + toutes les `commande_plat_*` → "Commande introuvable" au clic |

### P1 — Important

| # | Risque | Composant | Impact |
|---|--------|-----------|--------|
| P1-1 | **Notifications `commande_litige` non émises** | `commandes-api` (receive) | Pas de règle en DB pour `commande_litige` → le fournisseur n'est pas notifié d'un litige |
| P1-2 | **Règles produit globales** (establishment_id NULL) | `notification_rules` | Impossible de configurer les notifications commande par établissement |
| P1-3 | **Données historiques polluées** | `notification_events` | 30 notifications parasites pour Labaja (commandes Sapori MIEI) |
| P1-4 | **Pas d'audit_logs pour commandes plats** | `commandes-plats-api` | Aucune traçabilité des actions plats dans l'audit trail |

### P2 — Dette acceptable

| # | Risque | Composant | Impact |
|---|--------|-----------|--------|
| P2-1 | **Realtime non filtré par recipient** | `useNotificationEventsChannel` | Fuite d'info réseau (pas d'impact UI) |
| P2-2 | **Icônes fallback pour plats** | `Notifications.tsx` | Icône ⚠️ au lieu d'une icône spécifique |
| P2-3 | **Push URL générique** | `commandes-api` | Deep link push vers `/commandes` au lieu de la commande spécifique |
| P2-4 | **Pas de distinction partielle plats** | `commandes-plats-api` | Un seul type `commande_plat_expediee` vs deux types produit |
| P2-5 | **Centre filtré par service_day** | `useNotificationEvents` | Pas d'historique notifications |

---

## SECTION 9 — Réponses Nettes

### Les notifications produit sont-elles propres ?

**🟡 Partiellement.** Le routage est correct. Le push fonctionne. Mais :
- Le deep link est cassé (P0)
- Le litige n'est pas notifié (P1)
- Les règles sont globales et non configurables par établissement (P1)

### Les notifications plats sont-elles propres ?

**🔴 Non.** Le routage est correct MAIS :
- Aucun push WebPush (P0)
- Deep link cassé (P0)
- Pas d'audit logs (P1)

### Le centre de notif est-il fiable ?

**🟡 Partiellement.** La structure SSOT est saine, le RLS est correct, le filtrage par utilisateur fonctionne. Mais le deep link cassé dégrade l'UX (le clic ne mène pas à la commande).

### Le push est-il fiable ?

**🟡 Pour les produits, oui.** Le pipeline WebPush fonctionne, les tokens sont nettoyés, le retry existe. **Pour les plats, le push n'existe tout simplement pas.**

### Le client peut-il recevoir des notifs fournisseur par erreur ?

**Non.** ✅ Le code actuel est correct. Les notifs sont insérées avec le bon `establishment_id` selon le rôle. Le RLS filtre par `recipient_user_id`. Un client ne verra jamais une notification destinée au fournisseur (et vice versa).

Exception historique : les 30 notifications Labaja/Sapori MIEI de l'ancien système.

### Le fournisseur peut-il recevoir des notifs client par erreur ?

**Non.** ✅ Même mécanisme de protection.

### Y a-t-il un risque de confusion ou de mauvais routage ?

**Oui, marginal** :
1. Les notifications plats ont des icônes génériques → confusion visuelle possible entre plat et produit
2. Le deep link cassé peut induire en erreur ("commande introuvable" alors qu'elle existe)
3. Les données historiques polluées peuvent créer de la confusion chez les utilisateurs Labaja

---

## SECTION 10 — Verdict Final

### Peut-on partir en prod ?

**🟡 GO CONDITIONNEL** — Le système est utilisable mais présente deux P0 qui dégradent significativement l'UX :

### Corrections obligatoires avant prod

| Priorité | Action | Effort estimé |
|----------|--------|:------------:|
| **P0** | Harmoniser le payload : frontend doit lire `commande_id` OU backend doit écrire `order_id` | 15 min |
| **P0** | Ajouter le push WebPush dans `commandes-plats-api` (copier le pattern de `commandes-api`) | 30 min |
| **P1** | Créer la règle `commande_litige` en DB ou faire fallback sur `commande_litige_resolue` | 10 min |
| **P1** | Nettoyer les 30 notifications parasites Labaja en DB | 5 min |

### Corrections recommandées (post-prod acceptable)

| Priorité | Action |
|----------|--------|
| **P1** | Migrer les règles commande vers des règles par établissement |
| **P1** | Ajouter audit_logs dans `commandes-plats-api` |
| **P2** | Ajouter des icônes spécifiques pour `commande_plat_*` |
| **P2** | Deep link push avec `commande_id` spécifique |
| **P2** | Filtrer le realtime channel par `recipient_user_id` |
| **P2** | Ajouter historique/pagination au centre de notifications |

### Conclusion

Le système de notifications commandes a une **architecture fondamentalement saine** :
- La séparation client/fournisseur est correcte et protégée par RLS
- Le SSOT (`notification_events`) est cohérent
- Le routage par `establishment_id` est fiable

Les deux P0 identifiés (deep link + push plats) sont des **lacunes d'implémentation**, pas des failles architecturales. Ils sont corrigeables rapidement sans refonte.
