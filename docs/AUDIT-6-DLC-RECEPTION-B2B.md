# Audit DLC réception B2B

**Date** : 2026-03-10  
**Périmètre** : Flux DLC en réception de commande B2B — saisie, stockage, refus, impact  
**Méthode** : Analyse code + données de production  

---

## SECTION 1 — Cartographie DLC B2B

### Architecture

```
Réception commande (flux produit)
  ↓ Dialog de réception affiche un champ DLC par ligne
  ↓ L'utilisateur saisit une date DLC pour chaque produit
  ↓ Après validation de la réception (fn_receive_commande) :
  ↓ Appel SÉPARÉ à dlcService.batchUpsertDlc()
  ↓ INSERT/UPSERT INTO reception_lot_dlc (onConflict: commande_line_id)
  ↓ Données stockées indépendamment du flux de réception
```

### Isolation complète

Le module DLC est **totalement découplé** du flux de réception :
- `dlcService.ts` : aucune dépendance sur `commandes`, `litiges`, `stock`
- L'échec de l'upsert DLC **ne revert PAS** la réception
- Pas de trigger, pas de contrainte FK bloquante avec les commandes

### Table `reception_lot_dlc`

| Champ | Usage |
|-------|-------|
| `commande_line_id` | FK vers commande_lines (UNIQUE — 1 DLC par ligne) |
| `establishment_id` | Établissement client |
| `product_id` | FK vers products_v2 |
| `dlc_date` | Date saisie (YYYY-MM-DD) |
| `quantity_received` | Quantité reçue snapshot |
| `canonical_unit_id` | Unité |
| `dismissed_at` | Neutralisation (retrait du suivi DLC) |
| `dismissed_reason` | Motif de neutralisation |

### Dashboard DLC Critique (`/dlc-critique`)

- Lit `reception_lot_dlc` + seuils (produit > catégorie > établissement > fallback 3j)
- Calcule le statut : OK / Warning / Expired
- Actions : Modifier la DLC, Retirer du stock (dismiss)
- Le dismiss met `dismissed_at` sans toucher au stock physique

---

## SECTION 2 — Cas testés

### T1 — Données de production

**9 enregistrements** dans `reception_lot_dlc`, tous pour l'établissement CL (beff6f4a-...) :

| commande_line_id | product | dlc_date | quantity | dismissed |
|-----------------|---------|----------|----------|-----------|
| d74f81de-... | TEST 1 (20290fe7) | 2026-03-08 | 3 | ❌ |
| 3a121630-... | TEST 3 (356ad148) | 2026-03-27 | 40 | ❌ |
| fab4310f-... | TEST 1 | 2026-03-07 | 1 | ❌ |
| 5cb3504c-... | TEST 1 | 2026-03-07 | 2 | ❌ |
| e553edde-... | TEST 3 | 2026-03-20 | 40 | ❌ |
| 67ead956-... | TEST 1 | 2026-03-11 | 0.3 | ❌ |
| b8082ac2-... | TEST 1 | 2026-03-05 | 6 | ❌ |
| 8cc823f5-... | TEST 1 | 2026-03-06 | 1 | ❌ |
| 00a51b35-... | TEST 3 | 2026-03-04 | 4 | ❌ |

**Observations** :
- Les données DLC sont correctement peuplées
- Plusieurs réceptions différentes sur le même produit → lignes distinctes (OK car clé = commande_line_id)
- Certaines dates sont dans le passé (2026-03-04, 2026-03-05) → devraient apparaître comme "expirées" sur le dashboard
- Aucun enregistrement n'a été "dismissed" → fonctionnalité de retrait non exercée

### T2 — Flux de saisie

Le service `upsertDlc` / `batchUpsertDlc` utilise `ON CONFLICT (commande_line_id)` → idempotent. Une re-réception ne crée pas de doublon, elle met à jour.

### T3 — DLC sur commandes B2B récentes (Magnifiko/NONNA SECRET)

**Aucun enregistrement** dans `reception_lot_dlc` pour l'établissement Magnifiko (e9c3dccf-...). Cela signifie que les réceptions B2B récentes (CMD-000021, CMD-000022) n'ont **pas** utilisé la saisie DLC.

**Cause probable** : Le dialog de réception B2B n'intègre peut-être pas le composant DLC, ou l'utilisateur n'a pas saisi de DLC.

### T4 — Refus DLC

Le module DLC prévoit un `DlcReceptionSummaryDialog` qui permet d'accepter ou refuser les produits proches/expirés. Les refus sont routés vers `product_returns` avec des motifs `dlc_depassee` ou `dlc_trop_proche`.

**Données** : 2 retours avec type `dlc_depassee` et `dlc_trop_proche` existent en production → le flux de refus a été exercé au moins partiellement.

### T5 — Impact sur le stock

**Aucun**. Le module DLC est strictement passif :
- Le dismiss (`dismissed_at`) est une neutralisation locale
- Il ne touche pas au Stock Ledger
- Il ne déclenche pas de mouvement de stock

---

## SECTION 3 — Résultats

### ✅ Validé

| Point | Statut |
|-------|--------|
| Stockage DLC en base | ✅ 9 enregistrements corrects |
| Idempotence (upsert on conflict) | ✅ Pas de doublons |
| Isolation du module | ✅ Aucune dépendance stock/litige |
| Seuils de criticité | ✅ Architecture OK (produit > catégorie > fallback) |
| Retour DLC (via product_returns) | ✅ 2 retours DLC en base |

### ⚠️ Non validé ou incertain

| Point | Statut |
|-------|--------|
| Saisie DLC en réception B2B (partenariat) | ❌ Aucune donnée pour Magnifiko |
| Dashboard DLC Critique | ⚠️ Non vérifié visuellement |
| Dismiss (neutralisation) | ❌ Jamais exercé (aucun dismissed_at) |
| Notifications DLC | ❌ Module strictement passif, pas de notifications |
| DLC sur commandes plats | ❌ Non applicable (plats n'ont pas de DLC) |

---

## SECTION 4 — Risques

### P2 — DLC non intégrée au flux B2B partenaire

Les réceptions B2B récentes (Magnifiko ↔ NONNA SECRET) n'ont généré aucune donnée DLC. Si la saisie DLC n'est pas intégrée au dialogue de réception B2B, c'est une lacune fonctionnelle importante pour les restaurants qui doivent tracer les DLC de leurs fournisseurs.

### P3 — Données DLC passées non nettoyées

6 enregistrements sur 9 ont des `dlc_date` dans le passé. Ils apparaîtront comme "Expiré" sur le dashboard mais n'ont jamais été dismissés ni traités. Ce n'est pas un bug (données de test) mais il faudra un nettoyage avant le go-live.

### P3 — Dismiss non testé

La fonctionnalité de neutralisation (`dismissed_at`) n'a jamais été exercée. Le code semble correct (`useDlcCritiqueActions.ts` met à jour `dismissed_at` et `dismissed_reason`) mais aucune validation terrain.

---

## SECTION 5 — Recommandation

### R1 — Vérifier l'intégration DLC dans le dialog de réception B2B (Priorité haute)

Confirmer que le composant de saisie DLC est bien affiché lors de la réception d'une commande B2B (pas seulement les commandes internes). Si absent, l'ajouter.

### R2 — Test terrain du dismiss (Priorité moyenne)

Exercer la fonctionnalité de neutralisation sur le dashboard DLC Critique pour valider le flux complet.

### R3 — Nettoyage données DLC de test (Priorité basse)

Purger les 9 enregistrements de l'établissement CL (données de test, pas de production réelle).

---

## SECTION 6 — Verdict

### 🟢 MODULE FONCTIONNEL mais sous-exercé

Le module DLC est architecturalement solide, bien isolé, et fonctionne correctement sur les données existantes. Les mécanismes d'upsert, de calcul de criticité et de refus sont en place.

**Lacune principale** : absence de données DLC pour les réceptions B2B partenaires (Magnifiko ↔ NONNA SECRET), ce qui suggère que l'intégration au dialog de réception B2B n'est pas active ou pas utilisée.

**Risque si déployé** : Faible. Le module est passif et n'impacte aucun autre flux. Le pire cas est l'absence de suivi DLC, pas une corruption de données.
