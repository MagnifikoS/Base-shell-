# Stratégie Stock Zéro V1 — Document Complet

> **Document d'audit parano + stratégie d'implémentation**
> Règle métier cible : **Le stock ne doit jamais être négatif. Aucun blocage terrain. Clamp à 0.**
> **Règle absolue : si le delta clampé = 0, aucun event n'est créé.**

---

## 1. Résumé Exécutif

### Ce que la nouvelle règle change
La règle V1 supprime **toute notion de blocage** lié au stock négatif. Aujourd'hui, le système bloque les opérations (popup NEGATIVE_STOCK, override nécessaire) quand le résultat passe sous zéro. Demain : **aucun blocage, aucun popup, aucun override** — le delta sortant est simplement clampé pour que le stock résultant soit ≥ 0.

### Niveau de risque global : **MODÉRÉ**
- 8 points de modification backend (RPC + edge function)
- 6 points de nettoyage frontend (composants + hooks)
- 1 module entier devenu caduc (`ecartsInventaire` — logique de discrepancy automatique post-retrait)
- 1 migration data pour remise à zéro des stocks négatifs existants
- Aucun changement de schéma DB requis (les colonnes `override_flag`/`override_reason` restent pour audit trail)

### Verdict
La règle est implémentable proprement en 5 phases ordonnées (Phase 0 à Phase 4). Le risque principal est la propagation de la quantité effective dans les flux composés (`fn_transfer_product_zone`, `fn_ship_commande`).

---

## 2. Cartographie complète de la logique existante liée au stock négatif

### 2.1 Backend — RPC SQL

| RPC | Comportement actuel | Fichier migration (latest) |
|-----|---------------------|---------------------------|
| **`fn_post_stock_document`** | Step 9 : calcule `resulting_stock`, si < 0 ET `override_flag=false` → `RAISE EXCEPTION 'NEGATIVE_STOCK:...'` | `20260213052422` |
| **`fn_void_stock_document`** | Step 6 : calcule stock résultant après inversion, si < 0 → `RAISE EXCEPTION 'NEGATIVE_STOCK_ON_VOID:...'` — **AUCUN override possible** | `20260217130002` |
| **`fn_quick_adjustment`** | Appelle `fn_post_stock_document` avec `p_override_flag := true` → bypasse le guard | `20260317144338` |
| **`fn_transfer_product_zone`** | Appelle `fn_post_stock_document` **sans override** pour le WITHDRAWAL → peut être bloqué par NEGATIVE_STOCK si stock < qty transférée | `20260302191507` |
| **`fn_ship_commande`** | Bypass complet : insère directement dans `stock_events` avec `override_flag=true` — aucun check négatif | `20260311144047` |
| **`fn_post_b2b_reception`** | Insère directement dans `stock_events` avec `override_flag=false` — aucun check négatif (bypass `fn_post_stock_document`) | `20260228081149` |
| **`fn_post_b2b_auto_correction`** | Appelle `fn_post_stock_document` avec `p_override_flag := true` | `20260304212829` |

### 2.2 Backend — Edge Function

| Edge Function | Comportement |
|---------------|-------------|
| **`stock-ledger`** (action=post) | Parse `NEGATIVE_STOCK:` de l'exception SQL, retourne HTTP 409 avec la liste des produits négatifs | `supabase/functions/stock-ledger/index.ts` |

### 2.3 Frontend — Composants

| Composant | Logique liée au négatif |
|-----------|------------------------|
| **`PostConfirmDialog.tsx`** | Détecte `error === "NEGATIVE_STOCK"`, affiche un récapitulatif des produits + bouton "Confirmer" (auto-override) |
| **`WithdrawalView.tsx`** | Détecte `NEGATIVE_STOCK`, affiche badge "Stock négatif détecté", délègue à PostConfirmDialog |
| **`MobileWithdrawalView.tsx`** | Détecte `NEGATIVE_STOCK`, stocke `pendingPostProduct`, réaffiche via PostConfirmDialog, puis retry avec `overrideFlag=true` |
| **`BlRetraitPostPopup.tsx`** | Pre-check via `checkStockAvailability()` — affiche dialog "Stock insuffisant" avec actions reduce/remove **AVANT** le POST |
| **`BlAppCorrectionDialog.tsx`** | Message d'avertissement "Si le stock est insuffisant, la correction sera refusée" |
| **`EstimatedStockCell.tsx`** | `Math.max(0, rawQty)` — clamp d'affichage UI (déjà aligné V1) |

### 2.4 Frontend — Hooks

| Hook | Logique liée au négatif |
|------|------------------------|
| **`usePostDocument.ts`** | Parse `NEGATIVE_STOCK` de la réponse edge fn, retourne `PostResult` avec `error: "NEGATIVE_STOCK"` |
| **`useCheckStockAvailability.ts`** | Calcule stock estimé, retourne `action: "remove" \| "reduce" \| "ok"` — logique de pre-check pour BL Retrait |
| **`useCreateDiscrepancy.ts`** | Crée un `inventory_discrepancies` quand `withdrawalQuantity > estimatedStockBefore` (écart auto post-retrait) |

### 2.5 Frontend — Engine (pur)

| Fichier | Logique |
|---------|---------|
| **`postGuards.ts`** | `checkNegativeStock()` — pure function, retourne les produits dont `resulting < 0` |

### 2.6 Module Écarts (`ecartsInventaire`)

| Composant | Impact |
|-----------|--------|
| **`useCreateDiscrepancy`** | Crée un écart si retrait > stock estimé. Avec la V1, cette logique **n'a plus de sens** car le retrait sera clampé et le stock restera ≥ 0 — il n'y aura jamais d'écart "stock négatif" |
| **`discrepancyService.ts`** | CRUD sur `inventory_discrepancies` — table reste, mais les créations automatiques post-retrait deviennent caduques |

---

## 3. Liste des comportements actuels contradictoires avec la nouvelle règle

### 3.1 Ce qui doit DISPARAÎTRE

| Élément | Raison |
|---------|--------|
| Guard `NEGATIVE_STOCK` dans `fn_post_stock_document` (Step 9) | Remplacé par clamp backend |
| Guard `NEGATIVE_STOCK_ON_VOID` dans `fn_void_stock_document` (Step 6) | Remplacé par clamp backend |
| `PostError = "NEGATIVE_STOCK"` dans `usePostDocument.ts` | Plus jamais retourné |
| Parse `NEGATIVE_STOCK:` dans edge function `stock-ledger` | Plus jamais levé |
| Logique NEGATIVE_STOCK dans `PostConfirmDialog.tsx` | Plus de dialog d'override |
| `handleOverridePost` dans `MobileWithdrawalView.tsx` | Plus d'override UI |
| `handleOverridePost` / `onForceOverride` dans `WithdrawalView.tsx` | Plus d'override UI |
| `postError.error === "NEGATIVE_STOCK"` UI badge dans `WithdrawalView.tsx` | Plus d'erreur à afficher |
| `OVERRIDE_REASON_REQUIRED` error dans `PostConfirmDialog` | Plus de raison requise |
| Appel auto à `useCreateDiscrepancy` dans les retraits (fire-and-forget post-retrait) | Plus d'écart automatique sur stock négatif |

### 3.2 Ce qui doit être NEUTRALISÉ (pas supprimé)

| Élément | Raison |
|---------|--------|
| `override_flag` / `override_reason` paramètres sur `fn_post_stock_document` | Garder la signature pour compatibilité, mais le guard ne bloque plus — override toujours implicite |
| `override_flag` / `override_reason` colonnes sur `stock_events` | Garder pour audit trail historique |
| `fn_stock_events_validate_override()` trigger | Neutraliser ou supprimer — plus de validation `override_reason required when override_flag=true` |
| `checkNegativeStock()` dans `postGuards.ts` | Supprimer ou marquer deprecated — plus utilisé |

### 3.3 Ce qui doit être ADAPTÉ

| Élément | Adaptation |
|---------|-----------|
| `fn_post_stock_document` Step 9 | **Remplacer le guard par un CLAMP** : si `resulting_stock < 0`, ajuster `delta_quantity_canonical` pour que `resulting = 0` |
| `fn_void_stock_document` Step 6 | **Remplacer le guard par un CLAMP** : si l'inversion crée du négatif, clamper le void_delta |
| `fn_transfer_product_zone` | Plus de risque de blocage (fn_post hérite du clamp) — **mais le RECEIPT doit recevoir la quantité effective** |
| `fn_ship_commande` | Clamp inline + propagation quantité effective aux `commande_lines` |
| `BlRetraitPostPopup.tsx` pre-check | Simplifier : ne plus afficher "Stock insuffisant" — le retrait passe toujours, le backend clampe |
| `BlAppCorrectionDialog.tsx` warning | Supprimer le message "la correction sera refusée" |
| `EstimatedStockCell.tsx` | Déjà clampé UI → inchangé ✓ |

### 3.4 Ce qui reste INCHANGÉ

| Élément | Raison |
|---------|--------|
| `fn_quick_adjustment` | Passait déjà `override_flag=true`, et avec le clamp, il fonctionnera nativement |
| `fn_post_b2b_reception` | Flux entrant (RECEIPT), jamais bloqué, inchangé |
| Formule SSOT `Stock = Snapshot + Σ(events)` | Inchangée — le clamp agit sur le delta **avant** écriture |
| Realtime `useStockEventsChannel` | Inchangé — invalidation après INSERT |
| Analytics / marchandise / variance | Inchangés — ils lisent les events tels quels |

---

## 4. Règle générale cible

### Formulation
> **Tout mouvement de stock sortant (delta < 0) est autorisé sans blocage. Si le delta résultant rendrait le stock négatif, le delta est clampé pour que le stock résultant soit exactement 0. Les mouvements entrants (delta ≥ 0) passent toujours normalement. Aucun popup, aucun override, aucune erreur.**

### Règle absolue : delta clampé à 0 = pas d'event
> **Si après clamp le delta effectif est 0, AUCUN `stock_event` n'est créé.** Un event à delta = 0 pollue le ledger sans valeur ajoutée. Le filtre `WHERE delta_effectif != 0` est appliqué dans tout INSERT INTO `stock_events`.

### Comment "clamp à 0" fonctionne techniquement

```
stock_actuel = snapshot_qty + Σ(events_delta)

SI delta < 0 (sortie) :
  resulting = stock_actuel + delta
  SI resulting < 0 :
    delta_effectif = -stock_actuel  (clamp : on retire tout ce qui reste)
    SI stock_actuel ≤ 0 :
      delta_effectif = 0 → AUCUN EVENT CRÉÉ
  SINON :
    delta_effectif = delta  (inchangé)

SI delta ≥ 0 (entrée) :
  delta_effectif = delta  (toujours inchangé)
```

### Opérations concernées par le clamp

| Type | Clamp ? |
|------|---------|
| WITHDRAWAL (retrait manuel) | ✅ Oui |
| WITHDRAWAL via `fn_ship_commande` (expédition B2B) | ✅ Oui |
| WITHDRAWAL via `fn_transfer_product_zone` | ✅ Oui |
| ADJUSTMENT négatif (correction vers le bas) | ✅ Oui |
| VOID (inversion d'un RECEIPT → delta négatif) | ✅ Oui |
| RECEIPT (réception) | ❌ Non (delta ≥ 0, passe toujours) |
| ADJUSTMENT positif | ❌ Non |

---

## 5. Propagation de la quantité effective dans les flux composés

### Principe fondamental
> Tout flux composé (multi-étapes) qui commence par un retrait clampé **DOIT propager la quantité effectivement retirée** aux étapes suivantes. Utiliser la quantité originale demandée créerait du stock ex nihilo.

### 5.1 `fn_transfer_product_zone` — CRITIQUE P0

**Flux actuel :**
1. WITHDRAWAL de `p_estimated_qty` dans l'ancienne zone
2. RECEIPT de `p_estimated_qty` dans la nouvelle zone
3. Baseline 0 dans la nouvelle zone
4. Mise à jour `products_v2.storage_zone_id`

**Problème avec le clamp :**
Si stock = 3 et `p_estimated_qty` = 5 :
- WITHDRAWAL clampé à -3 (stock ancienne zone → 0)
- RECEIPT insère +5 → **2 unités créées ex nihilo** ❌

**Solution :**
```
v_effective_qty := ABS(résultat_clamp_du_withdrawal)
-- Utiliser v_effective_qty pour le RECEIPT (pas p_estimated_qty)
```

**Comportement attendu :**
- Stock ancienne zone : 3 → 0 (delta = -3)
- Stock nouvelle zone : 0 → 3 (delta = +3)
- Aucune création ex nihilo

### 5.2 `fn_ship_commande` — CRITIQUE P0

**Flux actuel :**
1. Update `commande_lines.shipped_quantity` avec la quantité saisie
2. INSERT `stock_events` avec `-shipped_quantity` (bypass `fn_post_stock_document`)
3. INSERT `stock_document_lines` avec `-shipped_quantity`

**Problème avec le clamp :**
Si stock = 3 et shipped = 5 :
- `commande_lines.shipped_quantity` = 5
- `stock_events.delta` = -3 (clampé)
- **Incohérence** : la commande dit "5 expédiés" mais seuls 3 sortent du stock
- Impact aval : le client reçoit une notification "5 expédiés", facture sur 5, mais le stock fournisseur n'a diminué que de 3

**Solution :**
```sql
-- Pour chaque produit :
v_stock_actuel := snapshot_qty + Σ(events)
v_effective_shipped := LEAST(shipped_quantity, GREATEST(v_stock_actuel, 0))
-- SI v_effective_shipped = 0 → pas d'event stock (mais la ligne commande reste avec shipped=0 + line_status='rupture')
-- Mettre à jour commande_lines.shipped_quantity avec v_effective_shipped
-- Mettre à jour stock_document_lines avec -v_effective_shipped
-- Insérer stock_event avec -v_effective_shipped (sauf si = 0)
```

**Comportement attendu :**
- `shipped_quantity` = 3 (effectif)
- `stock_events.delta` = -3
- La commande reflète la réalité terrain
- Le client reçoit la quantité réelle

### 5.3 `fn_void_stock_document` — Modéré

**Flux :** Inversion des events originaux (delta inversé).

**Problème avec le clamp :**
Si un RECEIPT de +5 est annulé et que le stock actuel = 2 :
- Void delta = -5
- Clampé à -2 (stock → 0)
- L'annulation est **partielle** — 3 unités de l'ancien RECEIPT ne sont pas compensées

**Solution :**
Le clamp dans `fn_void_stock_document` produit un void partiel. C'est acceptable car :
- Le stock ne passe jamais en négatif ✓
- L'audit trail montre le void_delta effectif ✓
- L'opérateur peut corriger via Quick Adjustment si nécessaire

### 5.4 `fn_post_b2b_auto_correction` — Faible risque

Appelle `fn_post_stock_document` avec override. Avec le clamp intégré à `fn_post_stock_document`, le comportement est automatiquement correct.

### 5.5 `fn_quick_adjustment` — Faible risque

Calcule `delta = target - estimated`. Si le delta est négatif et > stock, le clamp dans `fn_post_stock_document` le limitera. Le target affiché dans l'UI pourrait différer du résultat — **acceptable car l'UI affiche déjà le stock clampé ≥ 0**.

### 5.6 Résumé des flux composés

| Flux | Quantité effective à propager | Risque si non propagé | Action |
|------|------------------------------|----------------------|--------|
| `fn_transfer_product_zone` | WITHDRAWAL.effective_delta → RECEIPT | **Stock créé ex nihilo** | Obligatoire |
| `fn_ship_commande` | effective_shipped → `commande_lines` + BL + events | **Incohérence commande/facturation** | Obligatoire |
| `fn_void_stock_document` | Void partiel acceptable | État partiellement compensé | Acceptable (void partiel documenté) |
| `fn_quick_adjustment` | Hérité via `fn_post_stock_document` | Aucun | Automatique |
| `fn_post_b2b_auto_correction` | Hérité via `fn_post_stock_document` | Aucun | Automatique |

---

## 6. Stratégie d'implémentation

### Phase 0 — Remise à zéro des stocks déjà négatifs

**Objectif :** Avant de déployer le clamp, nettoyer les stocks historiquement négatifs en prod.

**Méthode :**
1. Identifier tous les produits à stock estimé < 0 (15 produits identifiés dans l'audit précédent)
2. Pour chaque produit : appeler `fn_quick_adjustment` avec `target_qty = 0`
3. `fn_quick_adjustment` passe déjà `override_flag=true` → pas de blocage
4. Le delta sera `0 - estimated_qty` (positif, car estimated < 0) → ADJUSTMENT positif
5. Chaque correction est tracée avec `event_reason = 'Correction manuelle (Centre de contrôle)'`

**Risques :**
- **Commandes en cours** : si un produit à stock -16 a une réception B2B en cours (+10), la remise à 0 puis la réception donneront stock = 10 au lieu du -6 attendu. **C'est le comportement souhaité** — on part d'un état propre.
- **Retraits en cours** : si un DRAFT de retrait existe pour un produit remis à 0, le retrait sera clampé lors du POST (Phase 1). Pas de conflit.

**Exécution :**
```sql
-- Pour chaque produit négatif identifié :
SELECT fn_quick_adjustment(
  p_establishment_id := '<est_id>',
  p_organization_id := '<org_id>',
  p_user_id := '<admin_user_id>',
  p_product_id := '<product_id>',
  p_storage_zone_id := '<zone_id>',
  p_estimated_qty := <stock_actuel_negatif>,  -- ex: -16
  p_target_qty := 0,
  p_canonical_unit_id := '<unit_id>',
  p_canonical_family := '<family>'
);
```

**Pré-requis :** Phase 0 doit être exécutée **AVANT** la Phase 1 (clamp backend). Sinon, des stocks négatifs survivraient et seuls les flux entrants pourraient les corriger.

**Impact sur les commandes en cours :**
- Les commandes B2B `expediee` (en attente de réception client) ne sont pas affectées — la réception client ajoute du stock normalement
- Les commandes `ouverte` (en attente d'expédition fournisseur) : si le fournisseur a un produit à stock négatif remis à 0, l'expédition sera clampée à 0 (pas de stock à retirer). Le produit sera marqué `rupture` dans la commande. **C'est le comportement correct.**

### Phase 1 — Backend central : Clamp dans `fn_post_stock_document`

**Cible :** Remplacer le guard `NEGATIVE_STOCK` (Step 9) par une logique de clamp inline.

**Changement SQL :**
- Supprimer tout le bloc `IF p_override_flag = false THEN ... RAISE EXCEPTION 'NEGATIVE_STOCK'`
- Avant l'INSERT des events, ajouter un UPDATE des lignes du document :
```sql
-- Clamp: ajuster les deltas négatifs pour que resulting >= 0
UPDATE stock_document_lines dl SET
  delta_quantity_canonical = CASE
    WHEN dl.delta_quantity_canonical < 0 THEN
      GREATEST(dl.delta_quantity_canonical, -(stock_actuel))
    ELSE dl.delta_quantity_canonical
  END
FROM (
  -- CTE calculant stock_actuel par produit
) AS stock
WHERE dl.document_id = p_document_id
  AND stock.product_id = dl.product_id;

-- Supprimer les lignes dont le delta est devenu 0
DELETE FROM stock_document_lines
WHERE document_id = p_document_id
  AND delta_quantity_canonical = 0;
```
- L'INSERT dans `stock_events` hérite automatiquement des deltas corrigés
- **Règle : si toutes les lignes sont supprimées (tout clampé à 0), le document passe en POSTED avec 0 events** — pas d'erreur
- Garder `p_override_flag` dans la signature (compat), mais l'ignorer
- Retourner `clamped_count` dans le résultat JSON pour traçabilité

**Modules impactés :** Tous les flux qui passent par `fn_post_stock_document` (retrait, réception, correction, transfert)

### Phase 2 — Backend périphérique : Flux composés + void

#### 2a. `fn_transfer_product_zone` — Propagation quantité effective

**Changement :**
```sql
-- Après le WITHDRAWAL via fn_post_stock_document :
v_effective_qty := ABS(
  -- Lire le delta réel écrit dans stock_document_lines (post-clamp)
  SELECT COALESCE(SUM(ABS(delta_quantity_canonical)), 0)
  FROM stock_document_lines WHERE document_id = v_withdrawal_doc_id
);
-- Utiliser v_effective_qty pour le RECEIPT (pas p_estimated_qty)
```

#### 2b. `fn_ship_commande` — Clamp inline + propagation

**Changement :**
- Avant l'INSERT dans `stock_events`, calculer le stock actuel par produit
- Clamper : `v_effective_shipped = LEAST(shipped_quantity, GREATEST(stock_actuel, 0))`
- Si `v_effective_shipped = 0` → pas d'event stock, la ligne reste avec `line_status='rupture'`
- Mettre à jour `commande_lines.shipped_quantity` avec la quantité effective
- Mettre à jour `stock_document_lines` avec le delta effectif

#### 2c. `fn_void_stock_document` — Clamp sur void

**Changement :** Remplacer le guard `NEGATIVE_STOCK_ON_VOID` par un clamp identique.
- Pour chaque event inversé, clamper le void_delta
- Si void_delta clampé = 0 → pas d'event VOID pour ce produit

#### 2d. Neutraliser `fn_stock_events_validate_override` trigger

Supprimer le trigger — l'audit trail est suffisant via `event_reason`.

### Phase 3 — Edge Function + Frontend

#### 3a. Edge Function `stock-ledger`
- Supprimer le parsing `NEGATIVE_STOCK:` de la réponse SQL
- Supprimer la section HTTP 409 pour NEGATIVE_STOCK

#### 3b. Frontend — Supprimer la logique NEGATIVE_STOCK

| Fichier | Action |
|---------|--------|
| `usePostDocument.ts` | Supprimer `PostError = "NEGATIVE_STOCK"`, supprimer le bloc de parsing NEGATIVE_STOCK |
| `PostConfirmDialog.tsx` | Supprimer toute la branche `isNegativeStock` / `isNegativeStockOverridable`, supprimer `onForceOverride`, simplifier en simple confirmation |
| `WithdrawalView.tsx` | Supprimer `postError.error === "NEGATIVE_STOCK"` badge, supprimer `onForceOverride` |
| `MobileWithdrawalView.tsx` | Supprimer `handleOverridePost`, supprimer `pendingPostProduct`, supprimer PostConfirmDialog pour NEGATIVE_STOCK |
| `BlRetraitPostPopup.tsx` | Supprimer le dialog "Stock insuffisant" (reduce/remove). Le POST passe toujours, le backend clampe |
| `BlAppCorrectionDialog.tsx` | Supprimer le warning "Si le stock est insuffisant, la correction sera refusée" |
| `postGuards.ts` | Supprimer `checkNegativeStock()` et `NegativeStockCheck` interface |

### Phase 4 — Nettoyage

#### 4a. Neutraliser la logique de discrepancy automatique

| Fichier | Action |
|---------|--------|
| `MobileWithdrawalView.tsx` | Supprimer l'appel `detectDiscrepancy()` post-retrait |
| `WithdrawalView.tsx` | Supprimer l'appel `detectDiscrepancy()` post-retrait |
| Module `ecartsInventaire` | **Ne PAS supprimer** — la table et l'UI restent (écarts historiques). Supprimer uniquement la **création automatique** post-retrait |

#### 4b. Supprimer `checkStockAvailability` pre-check

Supprimer le pre-check dans `BlRetraitPostPopup` — le backend gère tout.

---

## 7. Analyse des risques — Impact sur l'app en fonctionnement

### 7.1 Impact sur les commandes B2B en cours

| État commande | Impact Phase 0 (remise à 0) | Impact Phase 1-2 (clamp) | Risque |
|---------------|------------------------------|--------------------------|--------|
| `brouillon` (pas encore envoyée) | Aucun | Aucun | Nul |
| `envoyee` (en attente d'ouverture fournisseur) | Aucun | Aucun | Nul |
| `ouverte` (fournisseur prépare) | Si le stock fournisseur d'un produit est remis à 0, l'expédition sera clampée → `rupture` pour ce produit | Le clamp s'appliquera naturellement à l'expédition | **Faible** — comportement correct : pas de stock = rupture |
| `expediee` (en attente de réception client) | Stock fournisseur déjà déduit (lors de l'expédition). La réception client ajoute du stock normalement (RECEIPT, pas de clamp) | Aucun impact sur la réception | **Nul** |
| `recue` / `terminee` | Commande close. Aucun impact | Aucun | Nul |

**Scénario critique :** Un fournisseur a un produit à stock = -5. Phase 0 le remet à 0. Il a une commande `ouverte` avec 10 unités de ce produit. Lors de l'expédition (Phase 2), le clamp retire LEAST(10, 0) = 0 → le produit est en rupture. **C'est correct** — il n'avait physiquement pas de stock.

### 7.2 Impact sur le stock en cours (DRAFT documents)

| Type de DRAFT | Impact | Risque |
|---------------|--------|--------|
| WITHDRAWAL DRAFT (retrait en préparation) | Le POST sera clampé silencieusement. Si stock = 0, delta → 0, pas d'event | **Nul** — l'utilisateur ne voit pas de différence (pas de blocage) |
| RECEIPT DRAFT (réception en préparation) | Aucun impact — RECEIPT n'est jamais clampé | **Nul** |
| ADJUSTMENT DRAFT | Si négatif, sera clampé. Si positif, inchangé | **Nul** |

### 7.3 Impact sur le fonctionnement quotidien de l'app

| Fonctionnalité | Avant | Après | Ressenti utilisateur |
|----------------|-------|-------|---------------------|
| **Retrait mobile** | Popup "Stock négatif" + bouton override | **Le retrait passe directement** — aucun popup | ✅ Plus fluide |
| **Retrait desktop** | Badge "Stock négatif détecté" + dialog override | **Simple confirmation** | ✅ Plus simple |
| **BL Retrait transfert** | Dialog "Stock insuffisant" avec reduce/remove | **Le BL passe directement** | ✅ Plus fluide |
| **Réception** | Pouvait être bloquée si stock déjà négatif | **Passe toujours** (déjà le cas après fix récent, maintenant systématique) | ✅ Bug résolu |
| **Expédition B2B** | Pas de blocage (bypass) mais stock potentiellement négatif | **Pas de blocage + stock jamais négatif** | ✅ Plus cohérent |
| **Quick Adjustment** | Fonctionnait déjà (override=true) | **Inchangé** | = Identique |
| **Annulation (void)** | Bloquée si résultat négatif | **Passe toujours** (void partiel si nécessaire) | ✅ Déblocage |
| **Transfert zone** | Bloqué si stock < qty | **Passe toujours** (qty effective propagée) | ✅ Déblocage |
| **Affichage stock** | Déjà clampé UI (Math.max(0, qty)) | **Inchangé** | = Identique |
| **Correction BL** | "La correction sera refusée" si stock insuffisant | **Passe toujours** | ✅ Plus fluide |

### 7.4 Impact sur les analytics et rapports

| Module | Impact |
|--------|--------|
| Marchandise (achats) | Lit les `stock_events` de type RECEIPT → **inchangé** |
| Variance inventaire | Compare snapshot N vs snapshot N-1 + events → **inchangé** (les events clampés reflètent la réalité) |
| Stock alerts | Lit le stock estimé → **inchangé** (plus de stock négatif = moins de fausses alertes) |
| Factures B2B | Basées sur `shipped_quantity` → **maintenant cohérent avec le stock réel** (si clamp ship) |

---

## 8. Plan de validation

### 8.1 Scénarios de tests métier obligatoires

| # | Scénario | Stock avant | Action | Stock attendu | Events attendus |
|---|----------|-------------|--------|---------------|-----------------|
| 1 | Retrait normal | 10 | Retrait 3 | 7 | 1 event, delta = -3 |
| 2 | Retrait > stock | 3 | Retrait 5 | **0** | 1 event, delta = **-3** (clampé) |
| 3 | Retrait sur stock 0 | 0 | Retrait 2 | **0** | **0 event** (delta clampé à 0 → rien écrit) |
| 4 | Stock négatif historique remis à 0 | -16 | Phase 0 adjustment | **0** | 1 event ADJUSTMENT, delta = +16 |
| 5 | Réception après remise à 0 | 0 | Réception +10 | 10 | 1 event RECEIPT, delta = +10 |
| 6 | Quick adjustment vers 0 | 10 | Target = 0 | 0 | 1 event, delta = -10 |
| 7 | Quick adjustment vers 5 depuis 0 | 0 | Target = 5 | 5 | 1 event, delta = +5 |
| 8 | Expédition B2B > stock | 3 | Ship 5 | **0** | 1 event, delta = **-3**, `shipped_quantity` = **3** |
| 9 | Expédition B2B stock = 0 | 0 | Ship 5 | **0** | **0 event**, produit marqué `rupture` |
| 10 | Transfert zone > stock | 3 | Transfert 5 | **0 ancien, 3 nouveau** | W delta=-3, R delta=+3 |
| 11 | Transfert zone stock = 0 | 0 | Transfert 5 | **0 ancien, 0 nouveau** | **0 event** (rien à transférer) |
| 12 | Void d'un RECEIPT | Stock actuel = 2 | Void receipt de +5 | **0** | 1 event VOID, delta = -2 (clampé) |
| 13 | Void d'un WITHDRAWAL | Stock actuel = 10 | Void withdrawal de -3 | 13 | 1 event VOID, delta = +3 (entrée, pas de clamp) |
| 14 | Correction BL (réduction) | 8 | Correction -3 | 5 | 1 event, delta = -3 |
| 15 | Réception B2B client | 0 | Réception +10 | 10 | Normal, pas de clamp |
| 16 | Inventaire | N/A | Nouveau snapshot | Stock recalculé | Inchangé |

### 8.2 Points de contrôle post-déploiement

1. **Aucun log `NEGATIVE_STOCK` dans edge function logs** (plus jamais levé)
2. **Aucun produit à stock < 0** (requête de vérification)
3. **Vérifier les `stock_events` créés** — aucun event avec delta = 0
4. **Vérifier `commande_lines.shipped_quantity`** — cohérent avec les events stock
5. **Vérifier `bl_withdrawal_lines.quantity_canonical`** — cohérent
6. **Monitorer les produits à stock 0** — augmentation attendue et normale
7. **Vérifier que les factures B2B** reflètent les quantités effectives (post-clamp)
8. **Aucun popup "Stock négatif" ou "Stock insuffisant"** ne doit apparaître dans l'UI

---

## 9. Verdict final

### Comment implémenter la règle V1 "stock toujours ≥ 0, aucune erreur bloquante, clamp à 0" ?

**En 5 phases ordonnées :**

1. **Phase 0 (P0) — Remise à zéro** : Via `fn_quick_adjustment`, remettre à 0 les ~15 produits à stock négatif en prod. Pré-requis obligatoire avant Phase 1.

2. **Phase 1 (P0) — Backend central** : Modifier `fn_post_stock_document` pour clamper au lieu de bloquer. Supprimer le trigger `fn_stock_events_validate_override`. Appliquer la règle "delta=0 → pas d'event".

3. **Phase 2 (P0) — Backend périphérique** : Adapter `fn_void_stock_document` (clamp), `fn_ship_commande` (clamp inline + propagation `shipped_quantity`), `fn_transfer_product_zone` (receipt reçoit qty post-clamp).

4. **Phase 3 (P1) — Edge function + Frontend** : Nettoyer `stock-ledger` edge fn. Supprimer toute la logique NEGATIVE_STOCK des composants React. Simplifier `PostConfirmDialog`.

5. **Phase 4 (P2) — Nettoyage** : Supprimer les appels `detectDiscrepancy` post-retrait. Supprimer `checkStockAvailability` pre-check dans `BlRetraitPostPopup`. Nettoyer `postGuards.ts`.

### Risque P0 identifié
Le risque critique est dans les **flux composés** : `fn_transfer_product_zone` et `fn_ship_commande` doivent impérativement propager la quantité effective (post-clamp) aux étapes suivantes. Sans cette propagation, le système crée du stock ex nihilo ou génère des incohérences de facturation.

### Estimation
- Phase 0 : 1 migration data (~15 appels RPC)
- Phase 1-2 : ~4 migrations SQL
- Phase 3 : 1 edge function + ~6 fichiers frontend
- Phase 4 : ~4 fichiers frontend
- Tests : ~2h manuels + tests unitaires existants à adapter
- Déploiement : Phase 0 d'abord (data), puis Phase 1-2 (SQL), puis Phase 3-4 (frontend) dans le même build
