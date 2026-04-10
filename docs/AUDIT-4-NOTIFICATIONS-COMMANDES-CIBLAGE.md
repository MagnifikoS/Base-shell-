# Audit notifications commandes ciblage

**Date** : 2026-03-10  
**Périmètre** : Routage des notifications commandes — pourquoi Labaja reçoit des notifications parasites  
**Méthode** : Analyse code Edge Functions + données notification_events + notification_rules  

---

## SECTION 1 — Cartographie du routage

### Commandes produit (`commandes-api/index.ts`)

Le routage est basé sur :
1. **Destinataire** : déterminé par `user_establishments` (tous les membres d'un établissement)
2. **Établissement** : directement depuis `commandes.client_establishment_id` ou `supplier_establishment_id`
3. **Rule** : recherchée par `alert_type` dans `notification_rules`

**Mécanisme de recherche de rule** :
```typescript
const { data: expedieeRule } = await admin
  .from("notification_rules")
  .select("id")
  .eq("alert_type", alertType)
  .single();
```

⚠️ **Problème** : `.single()` sans filtre `establishment_id` → prend LA PREMIÈRE rule trouvée pour ce type, **quelle que soit** l'établissement associé.

### Commandes plat (`commandes-plats-api/index.ts`)

Le routage utilise `emitNotif()` qui :
1. Cherche d'abord une rule par `alert_type` + `establishment_id`
2. Si pas trouvée → cherche une rule globale sans filtre establishment
3. Insère les notifications avec le bon `establishment_id` du destinataire

### Notification rules en base

| alert_type | establishment_id | Portée |
|-----------|-----------------|--------|
| `commande_envoyee` | NULL | ⚠️ GLOBALE |
| `commande_expediee_complete` | NULL | ⚠️ GLOBALE |
| `commande_expediee_partielle` | NULL | ⚠️ GLOBALE |
| `commande_ouverte` | NULL | ⚠️ GLOBALE |
| `commande_plat_envoyee` | par établissement | ✅ 8 règles |
| `commande_plat_expediee` | par établissement | ✅ 8 règles |
| `commande_plat_litige` | par établissement | ✅ 8 règles |
| `commande_plat_litige_resolu` | par établissement | ✅ 8 règles |
| `commande_plat_reception_validee` | par établissement | ✅ 8 règles |
| `commande_plat_recue` | par établissement | ✅ 8 règles |
| `commande_plat_ouverte` | par établissement | ✅ 7 règles |

---

## SECTION 2 — Cas observés

### Notifications Labaja (30 notifications parasites)

| Données observées |
|-------------------|
| **Établissement** : Labaja (9ac57795-...) |
| **Organisation** : f056aae1-... (même org que Magnifiko) |
| **Types** : commande_expediee_complete |
| **Payload** : `commande_id: NULL` (!) |
| **Dates** : à partir du 2026-02-25 |

Les notifications Labaja ont un `commande_id` NULL dans le payload. Cela signifie qu'elles n'ont **pas** été générées par le code actuel de `commandes-api/index.ts` (qui peuple toujours `commande_id`).

### Source : RPC dépréciée `fn_send_commande_notification`

Ces 30 notifications datent du 25 février et proviennent de l'ancienne RPC `fn_send_commande_notification` qui :
- Routait au niveau **organisation** au lieu du partenariat
- N'incluait pas le `commande_id` dans le payload
- A été remplacée par le système actuel basé sur `notification_events` + Edge Functions

---

## SECTION 3 — Cause exacte

### Cause primaire : Données héritées de la RPC dépréciée

Les 30 notifications Labaja sont des **reliquats** de l'ancienne logique `fn_send_commande_notification` qui diffusait les notifications à tous les établissements de la même organisation.

### Cause secondaire : Rules globales pour les commandes produit

Les notification_rules pour `commande_envoyee`, `commande_expediee_*`, `commande_ouverte` n'ont **pas** de `establishment_id`. Cela ne pose pas de problème fonctionnel direct car :
- L'Edge Function `commandes-api` insère les notifications avec le bon `establishment_id` directement
- Le `rule_id` est juste une FK référentielle, pas un filtre de ciblage
- Le ciblage réel est fait par `user_establishments` + `client/supplier_establishment_id`

### Pourquoi ça ne fuira plus (code actuel)

Le code actuel de `commandes-api` fait :
```typescript
establishment_id: ctx.commande.client_establishment_id, // ciblé
recipient_user_id: m.user_id,  // membre de cet établissement
```

Le routage est correct **par design** : seuls les membres de l'établissement client ou fournisseur reçoivent les notifications.

---

## SECTION 4 — Risque réel

### Risque actuel : 🟢 FAIBLE (code actuel propre)

Le code actuel des deux Edge Functions (`commandes-api` et `commandes-plats-api`) cible correctement :
- **Client** : notifications envoyées à `client_establishment_id` avec les `user_id` de cet établissement
- **Fournisseur** : notifications envoyées à `supplier_establishment_id` avec les `user_id` de cet établissement
- **Pas de logique "même org"** dans le code actuel

### Risque résiduel : 🟡 MOYEN (données polluées)

- 30 notifications héritées dans Labaja (payload `commande_id: null`)
- Ces notifications apparaissent dans le centre de notifications
- Elles sont impossibles à ouvrir (deep link cassé car pas de commande_id)
- **Pas de fuite de données sensibles** — juste du bruit UX

### Risque structurel : 🟡 MOYEN (rules globales)

Les 4 notification_rules produit sont globales. Si un autre mécanisme les utilise un jour pour filtrer, il pourrait y avoir un problème. Mais actuellement, c'est inoffensif.

---

## SECTION 5 — Recommandation

### R1 — Purger les notifications héritées (Priorité haute)

```sql
DELETE FROM notification_events
WHERE establishment_id = '9ac57795-0724-42a1-a555-f4b3bcbb2f22'
  AND alert_type LIKE 'commande%'
  AND payload->>'commande_id' IS NULL;
```

### R2 — Supprimer ou désactiver l'ancienne RPC (Priorité haute)

Confirmer que `fn_send_commande_notification` n'est plus appelée nulle part et la dropper si possible.

### R3 — Migrer les rules globales vers per-establishment (Priorité basse)

Créer des rules par établissement pour `commande_envoyee`, `commande_expediee_*`, `commande_ouverte` — comme c'est déjà fait pour les commandes plat.

---

## SECTION 6 — Verdict

### 🟢 Code actuel PROPRE — Données héritées POLLUÉES

Le système de notifications actuel cible correctement les destinataires par établissement via `user_establishments`. Il n'y a **aucune fuite inter-établissement dans le code actuel**.

La pollution observée chez Labaja est un reliquat de l'ancienne RPC dépréciée `fn_send_commande_notification`. La purge des 30 notifications parasites et la suppression de l'ancienne RPC suffisent à résoudre le problème.

**Séparation client/fournisseur** : ✅ Garantie par le code actuel.
