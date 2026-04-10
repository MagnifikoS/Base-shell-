# Audit litige plat réel

**Date** : 2026-03-10  
**Périmètre** : Flux litige plat complet — expédition → réception → écart → litige → résolution  
**Méthode** : Analyse code + données de production  

---

## SECTION 1 — Cartographie litige plat

### Chaîne complète

```
commande_plat (expediee)
  ↓ client réceptionne via commandes-plats-api?action=receive
  ↓ fn_receive_commande_plat(p_commande_plat_id, p_user_id, p_lines)
  ↓ Compare shipped_quantity vs received_quantity pour chaque ligne
  ↓ Si écart détecté :
    → INSERT INTO litige_plats (commande_plat_id, created_by, status='open')
    → INSERT INTO litige_plat_lines (shipped_quantity_snapshot, received_quantity_snapshot, delta)
    → commande_plat.status = 'litige'
    → Retour { ok: true, has_litige: true }
  ↓ Si pas d'écart :
    → commande_plat.status = 'recue'
    → Retour { ok: true, has_litige: false }
```

### Résolution

```
commandes-plats-api?action=resolve_litige
  ↓ fn_resolve_litige_plat(p_litige_plat_id, p_user_id)
  ↓ litige_plats.status = 'resolved'
  ↓ litige_plats.resolved_at = now()
  ↓ commande_plat.status = 'cloturee'
```

### Sources de vérité

| Donnée | Table | Champs |
|--------|-------|--------|
| Litige | `litige_plats` | commande_plat_id, status, note |
| Lignes écart | `litige_plat_lines` | shipped_quantity_snapshot, received_quantity_snapshot, delta |
| Statut commande | `commande_plats` | status = 'litige' ou 'recue' |

### Services impliqués

| Composant | Fichier | Rôle |
|-----------|---------|------|
| Edge Function | `commandes-plats-api/index.ts` | Orchestration receive + resolve |
| RPC receive | `fn_receive_commande_plat` | Détection écart atomique |
| RPC resolve | `fn_resolve_litige_plat` | Résolution → cloturee |
| Service client | `litigePlatService.ts` | Lecture litige_plats / litige_plat_lines |
| Hook | `useLitigePlat.ts` | Query React pour afficher le litige |

### Notifications

| Événement | alert_type | Destinataire |
|-----------|-----------|--------------|
| Litige créé | `commande_plat_litige` | Fournisseur (tous membres) + Client (créateur) |
| Litige résolu | `commande_plat_litige_resolu` | Client (créateur) |

---

## SECTION 2 — Tests exécutés

### Test T1 — Données de production

**Query** : `SELECT * FROM litige_plats`  
**Résultat** : **TABLE VIDE** — aucun litige plat n'a jamais été créé en production.

### Test T2 — Analyse du code de détection

Le RPC `fn_receive_commande_plat` est défini en migration mais ne peut être lu directement. L'Edge Function transmet les lignes telles quelles :

```typescript
const { data: result } = await admin.rpc("fn_receive_commande_plat", {
  p_commande_plat_id: commande_plat_id,
  p_user_id: user.id,
  p_lines: lines,  // [{line_id, received_quantity}]
});
```

Si `result.has_litige === true`, les notifications de litige sont émises.

### Test T3 — Analyse du flux de résolution

L'Edge Function `resolve_litige` :
1. Récupère le `commande_plat_id` depuis `litige_plats`
2. Appelle `fn_resolve_litige_plat`
3. Émet une notification `commande_plat_litige_resolu` au client

### Test T4 — Cohérence avec le service client

`litigePlatService.ts` :
- `getLitigePlatByCommande` : récupère le litige + lignes pour une commande_plat donnée
- Le composant `useLitigePlat` expose le hook React Query

### Test T5 — Commande plat reçue sans écart

**CP-20260310-9460** (status: `recue`) : réception validée sans litige. Confirme que le chemin "pas d'écart → recue" fonctionne.

---

## SECTION 3 — Résultats

### ✅ Ce qui est validé

| Point | Statut |
|-------|--------|
| Architecture du flux (RPC + Edge + notifications) | ✅ Cohérent |
| Séparation avec litiges produit | ✅ Totale (tables séparées, RPC séparées, Edge séparé) |
| Notifications litige plat | ✅ Définies et codées (7 types de règles) |
| Service client de lecture | ✅ Opérationnel |
| Chemin sans écart (réception normale) | ✅ Validé par données réelles |

### ⚠️ Ce qui n'est PAS validé

| Point | Statut |
|-------|--------|
| Création réelle d'un litige plat | ❌ **Jamais exercé** — table vide |
| Résolution réelle d'un litige plat | ❌ **Jamais exercé** |
| Impact sur statut commande_plat (litige → cloturee) | ❌ **Jamais exercé** |
| Impact sur groupe mixte si litige plat | ❌ **Non testé** |
| Écart quantité reçue > expédiée | ❌ **Comportement inconnu** |

---

## SECTION 4 — Risques

### P1 — Flux non validé en conditions réelles

Le litige plat est un flux **entièrement théorique** à ce stade. Le code semble correct à la lecture, mais aucune exécution réelle n'a validé :
- La détection d'écart dans le RPC PostgreSQL
- L'insertion atomique du litige + lignes
- Le passage de status à 'litige'
- Le retour `has_litige: true` vers l'Edge Function
- L'émission des notifications
- La résolution et le passage à 'cloturee'

### P2 — Pas de lien avec la facturation

La RPC `fn_generate_app_invoice` ne traite que les commandes produit (`commandes`). Si une commande plat passe en litige puis est résolue → `cloturee`, il n'y a **aucun flux de facturation** pour les plats. C'est peut-être voulu (V1), mais c'est une lacune fonctionnelle.

### P2 — Comportement en cas de surplus (reçu > expédié)

Le code ne valide pas si `received_quantity > shipped_quantity`. Si le RPC traite cela comme un écart, il créera un litige. Si non, le surplus sera silencieusement accepté. Comportement inconnu sans test.

### P3 — Pas d'UI de résolution identifiée

Le hook `useResolveLitigePlat` existe côté frontend, mais le composant UI qui le déclenche n'a pas été audité. Si aucun bouton de résolution n'est affiché, le flux est complet côté backend mais mort côté UX.

---

## SECTION 5 — Recommandation

### R1 — Test terrain obligatoire avant prod (Critique)

Exécuter le scénario complet sur un environnement de test :
1. Créer une commande plat
2. L'envoyer, l'ouvrir, l'expédier
3. Réceptionner avec une quantité différente
4. Vérifier la création du litige en base
5. Résoudre le litige
6. Vérifier le passage à `cloturee`

### R2 — Vérifier l'UI de résolution

S'assurer qu'un composant affiche le bouton de résolution quand `commande_plat.status === 'litige'` et que le hook `useResolveLitigePlat` est bien connecté.

### R3 — Documenter le comportement surplus

Décider et documenter : un surplus (reçu > expédié) doit-il déclencher un litige ou être silencieusement accepté ?

---

## SECTION 6 — Verdict

### 🟡 GO CONDITIONNEL — Flux théoriquement complet mais jamais exercé

Le code est architecturalement cohérent et bien isolé. Toutes les briques existent (RPC, Edge, notifications, hooks). Cependant, **aucune exécution réelle** n'a jamais validé le flux de bout en bout.

**Niveau de maturité** : Le litige plat est **1 cran en dessous** du litige produit (qui a été exercé en conditions réelles et possède des données en base).

**Condition de go** : Exécuter au minimum un test terrain complet (R1) avant la montée en production pour valider que la chaîne fonctionne réellement.
