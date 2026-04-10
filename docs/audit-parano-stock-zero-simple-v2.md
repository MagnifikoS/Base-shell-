# AUDIT PARANO — STOCK ZÉRO SIMPLE V2

> Date: 2026-03-20
> Statut: AUDIT UNIQUEMENT — Aucune modification

---

## 1. Résumé exécutif

### La nouvelle règle est-elle faisable partout ?

**OUI.** La nouvelle règle "toute sortie passe, stock minimum = 0" peut être appliquée à tous les flux sans exception. C'est d'ailleurs **déjà partiellement le cas** pour 3 flux sur 7.

### Niveau de risque global

**FAIBLE.** Le changement est une **simplification** — on retire de la complexité (exceptions, overrides, cas spéciaux) au profit d'une règle unique.

### Verdict simple

Le système actuel est un patchwork de 3 stratégies différentes selon les flux :
1. **Clamp silencieux** (fn_ship_commande, fn_void_stock_document, fn_transfer_product_zone)
2. **Override ciblé avec raison** (fn_resolve_litige surplus, fn_quick_adjustment)
3. **Blocage dur NEGATIVE_STOCK** (fn_post_stock_document avec override=false)

La nouvelle règle remplace tout ça par : **clamp universel à 0, toujours, partout.**

---

## 2. Cartographie complète des flux stock

### 2.1 Tous les chemins d'écriture dans stock_events

| # | Flux | Fonction SQL | Passe par fn_post_stock_document ? | Stratégie actuelle | Peut créer du négatif ? |
|---|------|-------------|-----------------------------------|-------------------|----------------------|
| 1 | **Retrait standard** | `fn_post_stock_document` | ✅ Direct (via edge fn stock-ledger) | BLOCAGE si override=false | ❌ Non (bloqué) |
| 2 | **Réception standard** | `fn_post_stock_document` | ✅ Direct | Pas de risque (delta positif) | ❌ Non |
| 3 | **Correction réception** | `fn_post_stock_document` | ✅ Direct (type RECEIPT_CORRECTION) | BLOCAGE si override=false | ❌ Non (bloqué) |
| 4 | **Expédition B2B** | `fn_ship_commande` | ❌ Bypass — INSERT direct dans stock_events | CLAMP silencieux (GREATEST) | ❌ Non (clampé) |
| 5 | **Réception B2B** | `fn_post_b2b_reception` | ✅ Appelle fn_post_stock_document | override=false (delta positif) | ❌ Non |
| 6 | **Litige manquant** | `fn_resolve_litige` | ✅ Appelle fn_post_stock_document | override=false (delta positif → retour stock) | ❌ Non |
| 7 | **Litige surplus** | `fn_resolve_litige` | ✅ Appelle fn_post_stock_document | override=true conditionnel | ⚠️ OUI (volontairement) |
| 8 | **Quick adjustment** | `fn_quick_adjustment` | ✅ Appelle fn_post_stock_document | override=true toujours | ⚠️ OUI (volontairement) |
| 9 | **Void** | `fn_void_stock_document` | ❌ Bypass — INSERT direct dans stock_events | CLAMP silencieux (GREATEST) | ❌ Non (clampé) |
| 10 | **Transfert zone** | `fn_transfer_product_zone` | ✅ Appelle fn_post_stock_document | override=false + propagation effective_qty | ❌ Non (clampé) |

### 2.2 Résumé

- **3 flux** font du clamp silencieux (ship, void, transfer) → ✅ déjà alignés avec la nouvelle règle
- **2 flux** utilisent override=true (quick_adjustment, litige surplus) → ils autorisent le négatif
- **3 flux** sortants passent par fn_post_stock_document avec override=false → BLOCAGE dur possible
- **2 flux** sont toujours positifs (réception, litige manquant) → pas concernés

---

## 3. Audit de l'ancienne stratégie — Ce qui reste encore actif

### 3.1 Dans le SQL

| Élément | Fichier/Fonction | Statut | Doit disparaître ? |
|---------|-----------------|--------|-------------------|
| `RAISE EXCEPTION 'NEGATIVE_STOCK:%'` | `fn_post_stock_document` (step 9) | ✅ ACTIF — bloque si override=false | **OUI** → remplacer par clamp |
| `p_override_flag` paramètre | `fn_post_stock_document` | ✅ ACTIF — contrôle le bypass | **OUI** → supprimer le paramètre ou l'ignorer |
| `p_override_reason` paramètre | `fn_post_stock_document` | ✅ ACTIF — requis si override=true | **OUI** → plus nécessaire |
| `OVERRIDE_REASON_REQUIRED` check | `fn_post_stock_document` (step 7) | ✅ ACTIF | **OUI** → supprimer |
| `GREATEST(delta, -current_stock)` | `fn_ship_commande` (step 5e) | ✅ ACTIF — clamp B2B | ✅ GARDER tel quel |
| `GREATEST(delta, -current_stock)` | `fn_void_stock_document` (step 9) | ✅ ACTIF — clamp void | ✅ GARDER tel quel |
| `v_zone_has_surplus` logique | `fn_resolve_litige` | ✅ ACTIF — override conditionnel | **OUI** → simplifier (toujours passer) |
| `override=true` dans `fn_quick_adjustment` | `fn_quick_adjustment` | ✅ ACTIF | **OUI** → plus nécessaire |
| `override=true` dans `fn_ship_commande` | `fn_ship_commande` | ✅ ACTIF — cosmétique | **OUI** → mettre false ou supprimer |
| `fn_health_check_stock_integrity` override audit | Health check | ✅ ACTIF | Adapter pour ne plus signaler les overrides |

### 3.2 Dans les Edge Functions

| Élément | Fichier | Statut | Doit disparaître ? |
|---------|--------|--------|-------------------|
| `override_flag` dans PostBody | `supabase/functions/stock-ledger/index.ts` L180 | ✅ ACTIF | **OUI** — supprimer du body |
| `override_reason` dans PostBody | `supabase/functions/stock-ledger/index.ts` L181 | ✅ ACTIF | **OUI** — supprimer du body |
| Commentaire "NEGATIVE_STOCK no longer raised" | L229-230 | Dead code comment | **OUI** — nettoyer |
| `OVERRIDE_REASON_REQUIRED` dans statusMap | L247 | ✅ ACTIF | **OUI** — supprimer |

### 3.3 Dans le Frontend

| Élément | Fichier | Statut | Doit disparaître ? |
|---------|--------|--------|-------------------|
| `overrideFlag` param dans `usePostDocument` | `src/modules/stockLedger/hooks/usePostDocument.ts` L76 | ✅ ACTIF | **OUI** |
| `overrideReason` param dans `usePostDocument` | L77 | ✅ ACTIF | **OUI** |
| `override_flag` dans fetch body | L118 | ✅ ACTIF | **OUI** |
| `override_reason` dans fetch body | L119 | ✅ ACTIF | **OUI** |
| `OVERRIDE_REASON_REQUIRED` dans PostError type | L27 | ✅ ACTIF | **OUI** |
| `OVERRIDE_REASON_REQUIRED` dans KNOWN_GUARDS | L51 | ✅ ACTIF | **OUI** |
| `handlePost(overrideFlag, overrideReason)` | `WithdrawalView.tsx` L117 | ✅ ACTIF | **OUI** — simplifier signature |
| `handlePost(overrideFlag, overrideReason)` | `ReceptionView.tsx` L269 | ✅ ACTIF | **OUI** — simplifier signature |
| `override_flag: false` | `MobileReceptionView.tsx` L451 | ✅ ACTIF | **OUI** — supprimer param |
| `p_override_flag: false` | `useCreateCorrection.ts` L146 | ✅ ACTIF | **OUI** — supprimer param |
| `checkNegativeStock()` pure function | `postGuards.ts` L123-143 | ✅ ACTIF (exporté) | **OUI** — dead code pour la nouvelle règle |
| `NegativeStockCheck` interface | `postGuards.ts` L112-117 | ✅ ACTIF (exporté) | **OUI** — dead code |
| Commentaire "Negative stock requires override_flag" | `postGuards.ts` L12 | Documentation | **OUI** — mettre à jour |
| `PostConfirmDialog` commentaire STOCK ZERO V1 | L12 | Documentation | Mettre à jour |
| `override_flag` dans `types.ts` (StockEvent) | `stockLedger/types.ts` L103 | ✅ ACTIF (type) | GARDER — colonne DB existe toujours |
| `override_reason` dans `types.ts` (StockEvent) | L104 | ✅ ACTIF (type) | GARDER — colonne DB existe toujours |

### 3.4 Dans les Tests

| Élément | Fichier | Statut |
|---------|--------|--------|
| `checkNegativeStock` tests | `postGuardsExtended.test.ts` | Tests du frontend pure function — à supprimer si fn supprimée |
| `should raise exception NEGATIVE_STOCK` | `negative-stock-guard.test.ts` L83-89 | ❌ CASSERA après le changement — doit être mis à jour |
| `override_flag can bypass negative stock` | `negative-stock-guard.test.ts` L105-111 | ❌ CASSERA — le concept d'override n'existera plus |
| `should raise NEGATIVE_STOCK_ON_VOID` | `negative-stock-guard.test.ts` L143-152 | ❌ CASSERA — void utilise déjà le clamp |
| `override_flag bypass has no admin check` | `negative-stock-race.test.ts` L166 | ❌ CASSERA — plus pertinent |

---

## 4. Cas de figure critiques

### Cas 1 : Retrait > stock (ex: stock=2, retrait=8)
- **Actuel :** BLOCAGE — `fn_post_stock_document` raise NEGATIVE_STOCK (override=false)
- **Nouveau :** le retrait passe, stock → 0 (delta clampé de -8 à -2)

### Cas 2 : Expédition B2B > stock (ex: stock=3, expédition=5)
- **Actuel :** ✅ déjà clampé via GREATEST dans fn_ship_commande → stock → 0
- **Nouveau :** identique, aucun changement

### Cas 3 : Litige surplus avec stock insuffisant (ex: stock=0, retrait litige=15)
- **Actuel :** override=true conditionnel → laisse passer → stock peut devenir négatif
- **Nouveau :** clamp → stock → 0 (au lieu de -15)
- **⚠️ Impact métier :** le fournisseur ne verra pas -15 dans son stock. Il verra 0. La "dette" comptable n'est plus visible dans le stock. C'est **acceptable** si on considère que le stock est physique, pas comptable.

### Cas 4 : Quick adjustment vers 0 (stock=5, cible=0)
- **Actuel :** override=true → delta -5, stock → 0 ✅
- **Nouveau :** clamp ou pas, même résultat (delta=-5, -5 >= -5, pas de clamp)

### Cas 5 : Quick adjustment créant un négatif théorique (stock=5, estimé_système=10, cible=0)
- **Actuel :** override=true → delta=-10, stock → -5 (négatif possible !)
- **Nouveau :** clamp → delta ajusté pour que stock → 0
- **⚠️ Impact :** le quick adjustment ne pourra plus "forcer" un négatif. Il corrigera au maximum vers 0.

### Cas 6 : Void d'une réception (annuler +10 quand stock actuel = 3)
- **Actuel :** ✅ déjà clampé → delta void = -3 au lieu de -10, stock → 0
- **Nouveau :** identique

### Cas 7 : Transfert de zone (stock source = 2, transfert = 8)
- **Actuel :** ✅ déjà clampé → retire 2 de l'ancienne zone, reçoit 2 dans la nouvelle
- **Nouveau :** identique

### Cas 8 : Réception après sortie excessive
- Ex: stock=0 (après clamp), puis réception de 5 → stock=5
- **Actuel :** ✅ fonctionne
- **Nouveau :** identique

---

## 5. Risques de remplacement

### 5.1 Ce qui peut casser

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|-----------|
| Tests blue/red team qui vérifient NEGATIVE_STOCK | **Certaine** | Bas (tests, pas prod) | Mettre à jour les tests |
| Quick adjustment avec p_estimated_qty fausse | Faible | Le stock sera à 0 au lieu du négatif attendu | Acceptable — c'est la nouvelle règle |
| Litige surplus avec perte de visibilité comptable | Faible | Métier uniquement | Le stock = physique, pas comptable |
| Frontend qui passe encore override_flag | Nulle si on nettoie | - | Nettoyer |

### 5.2 Ce qui NE peut PAS casser

- Les réceptions (delta positif → jamais de clamp)
- Les flux déjà clampés (ship, void, transfer) → identiques
- Le calcul SSOT du stock estimé → inchangé
- La formule snapshot + events → inchangée
- Le multi-tenant → inchangé
- Les guards cross-tenant → inchangés
- Le verrouillage FOR UPDATE → inchangé

### 5.3 Risque de doublons de logique

Actuellement le clamp est implémenté **à 3 endroits différents** avec 3 patterns différents :
1. `fn_ship_commande` : clamp inline dans l'INSERT INTO stock_events (GREATEST)
2. `fn_void_stock_document` : clamp dans un CTE (GREATEST)
3. `fn_post_stock_document` : PAS de clamp — RAISE EXCEPTION

→ La nouvelle règle doit centraliser le clamp dans `fn_post_stock_document` (step 9), ce qui éliminera la duplication pour les flux qui passent par lui.

→ Les flux bypass (ship, void) garderont leur clamp propre car ils n'utilisent pas fn_post_stock_document.

---

## 6. Stratégie propre de remplacement — Phase par phase

### Phase 1 : Modifier fn_post_stock_document (1 migration SQL)

**Quoi :** Remplacer le bloc NEGATIVE_STOCK (step 9) par un clamp silencieux.

**Avant :**
```sql
-- Step 9: si override=false → check négatif → RAISE EXCEPTION
IF p_override_flag = false THEN
  ... calcul negatives ...
  IF v_negative_products != '[]' THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK:%', ...
  END IF;
END IF;
-- Step 10: INSERT stock_events (avec delta brut)
```

**Après :**
```sql
-- Step 9: SUPPRIMÉ (plus de check négatif ni d'exception)
-- Step 7: SUPPRIMÉ (plus de validation override_reason)

-- Step 10: INSERT stock_events AVEC CLAMP
INSERT INTO stock_events (...)
SELECT
  ...
  CASE
    WHEN dl.delta_quantity_canonical >= 0 THEN dl.delta_quantity_canonical  -- Ajout: pas de clamp
    ELSE GREATEST(
      dl.delta_quantity_canonical,
      -GREATEST(
        ROUND((COALESCE(il.quantity, 0) + COALESCE(ev_sum.total_delta, 0))::numeric, 4),
        0
      )
    )
  END AS effective_delta,
  ...
WHERE effective_delta != 0;  -- Skip zero-delta events
```

**Ce qui est supprimé :**
- Bloc `IF p_override_flag = false THEN ... RAISE EXCEPTION` (step 9)
- Bloc `IF p_override_flag = true AND override_reason IS NULL` (step 7)
- Le rollback `UPDATE stock_documents SET status = 'DRAFT'` (dans step 9)

**Ce qui est gardé :**
- Les paramètres `p_override_flag` et `p_override_reason` dans la signature (pour compatibilité descendante) → ils sont simplement ignorés
- La colonne `override_flag` dans stock_events → toujours peuplée (false par défaut)

**Résultat de retour enrichi :**
```sql
RETURN jsonb_build_object(
  'ok', true,
  'events_created', v_event_count,
  'clamped_count', v_clamped_count  -- NOUVEAU: nombre de lignes clampées
);
```

### Phase 2 : Simplifier fn_resolve_litige (1 migration SQL)

**Quoi :** Supprimer la logique conditionnelle `v_zone_has_surplus`.

**Avant :**
```sql
SELECT EXISTS (...surplus...) INTO v_zone_has_surplus;
p_override_flag := v_zone_has_surplus,
p_override_reason := CASE WHEN v_zone_has_surplus THEN '...' ELSE NULL END
```

**Après :**
```sql
-- Plus de détection surplus — fn_post_stock_document clampe automatiquement
p_override_flag := false  -- ou simplement ne pas passer le param
```

### Phase 3 : Simplifier fn_quick_adjustment (1 migration SQL)

**Quoi :** Retirer `override=true`.

**Avant :**
```sql
p_override_flag := true,
p_override_reason := 'Quick adjustment — vérité terrain'
```

**Après :**
```sql
-- fn_post_stock_document clampe automatiquement
-- Si target_qty < stock actuel, le delta sera clampé à -stock_actuel
```

**⚠️ Impact comportemental :** Un quick adjustment qui fixe une cible à 0 alors que le stock estimé est faux (ex: système dit 10, réalité dit 5) → le delta sera -10 mais clampé à -current_stock. Si current_stock est 10, pas de problème. Si current_stock est divergent... le clamp s'applique quand même. **C'est correct** — on va à 0 maximum.

### Phase 4 : Nettoyage Edge Function (1 fichier)

- Retirer `override_flag` et `override_reason` du body de la requête POST
- Retirer la validation `OVERRIDE_REASON_REQUIRED` du statusMap
- Mettre à jour les commentaires

### Phase 5 : Nettoyage Frontend (5-7 fichiers)

- `usePostDocument.ts` : retirer `overrideFlag`, `overrideReason` des params
- `WithdrawalView.tsx` : simplifier `handlePost()` (plus de params override)
- `ReceptionView.tsx` : idem
- `MobileReceptionView.tsx` : retirer `overrideFlag: false`
- `useCreateCorrection.ts` : retirer `p_override_flag: false`
- `postGuards.ts` : retirer `checkNegativeStock()`, `NegativeStockCheck`, mettre à jour le header
- `PostConfirmDialog.tsx` : mettre à jour commentaires

### Phase 6 : Mise à jour des tests (3-4 fichiers)

- `negative-stock-guard.test.ts` : réécrire pour vérifier le clamp au lieu du RAISE
- `negative-stock-race.test.ts` : supprimer les tests d'override bypass
- `snapshot-consistency.test.ts` : adapter la vérification NEGATIVE_STOCK
- `postGuardsExtended.test.ts` : supprimer les tests checkNegativeStock

### Phase 7 (optionnel) : Cleanup des colonnes override

- **NE PAS** supprimer les colonnes `override_flag` / `override_reason` de `stock_events` — elles servent de trace d'audit pour l'historique
- Simplement peupler `override_flag = false` par défaut pour tous les nouveaux events

---

## 7. Nettoyage des résidus

### SQL
| À nettoyer | Action |
|-----------|--------|
| `RAISE EXCEPTION 'NEGATIVE_STOCK'` dans fn_post_stock_document | Remplacer par clamp |
| Step 7 override validation | Supprimer |
| Step 9 negative check block | Remplacer par clamp dans step 10 |
| `v_zone_has_surplus` dans fn_resolve_litige | Supprimer |
| `p_override_flag := true` dans fn_quick_adjustment | Mettre false |
| `p_override_flag := true` dans fn_ship_commande | Mettre false (cosmétique) |

### Edge Functions
| À nettoyer | Action |
|-----------|--------|
| `override_flag` dans PostBody interface | Supprimer |
| `override_reason` dans PostBody interface | Supprimer |
| Validation override_reason | Supprimer |
| `OVERRIDE_REASON_REQUIRED` dans statusMap | Supprimer |
| Commentaire NEGATIVE_STOCK dead-code | Supprimer |

### Frontend
| À nettoyer | Action |
|-----------|--------|
| `overrideFlag` / `overrideReason` params dans 4+ composants | Supprimer |
| `checkNegativeStock` export | Supprimer ou déprécier |
| `NegativeStockCheck` interface | Supprimer |
| `OVERRIDE_REASON_REQUIRED` dans PostError type | Supprimer |
| Commentaires "STOCK ZERO V1" divers | Mettre à jour → "STOCK ZERO V2" |

### Code mort confirmé
| Fichier | Élément | Statut |
|---------|---------|--------|
| `postGuards.ts` | `checkNegativeStock()` | Utilisé uniquement dans les tests — dead code pour la prod |
| `postGuards.ts` | `NegativeStockCheck` interface | Dead code |

---

## 8. Stratégie de remise à zéro des stocks négatifs historiques

### État actuel : **AUCUN** stock négatif en prod

La requête de vérification retourne **0 produit** en stock négatif.

Les nettoyages précédents (PHASE0_STOCK_ZERO_V1 et PHASE0_STOCK_ZERO_V2) ont déjà remis à zéro les 16 + 258 produits historiquement négatifs.

→ **Aucune action nécessaire.** La base est déjà saine.

### Si des négatifs réapparaissent (protection future)

Avec la nouvelle règle, c'est **mathématiquement impossible** qu'un stock devienne négatif, car :
1. Tous les deltas sortants sont clampés à `max(delta, -current_stock)`
2. `current_stock` est toujours `>= 0` (car `GREATEST(current_stock, 0)`)
3. Le résultat est toujours `current_stock + effective_delta >= 0`

---

## 9. Verdict final

### Peut-on remplacer proprement toute l'ancienne stratégie par cette nouvelle règle simple ?

**OUI.** C'est non seulement faisable, mais c'est une **simplification majeure** :
- 1 règle au lieu de 3 stratégies différentes
- 0 override nécessaire
- 0 blocage terrain
- 0 stock négatif mathématiquement possible
- Moins de code à maintenir

### Reste-t-il des cas non couverts ?

**NON.** Tous les flux sortants (retrait, expédition, litige, void, transfert, correction, quick adjustment) suivent la même mécanique : `effective_delta = GREATEST(requested_delta, -current_stock)`.

Les flux entrants (réception) ne sont pas concernés (delta positif).

### Ordre d'implémentation recommandé

1. **Phase 1** (CRITIQUE) : Modifier `fn_post_stock_document` — c'est le cœur
2. **Phase 2** : Simplifier `fn_resolve_litige` — supprimer la logique surplus
3. **Phase 3** : Simplifier `fn_quick_adjustment` — retirer override
4. **Phase 4** : Nettoyage edge function
5. **Phase 5** : Nettoyage frontend
6. **Phase 6** : Mise à jour tests
7. **Phase 7** : Nettoyage colonnes (optionnel, cosmétique)

### Estimation de la charge

- **3 migrations SQL** (Phases 1-3)
- **1 fichier edge function** (Phase 4)
- **5-7 fichiers frontend** (Phase 5)
- **3-4 fichiers de tests** (Phase 6)
- **Total : ~12-15 fichiers modifiés**

---

**⛔ STOP — En attente de validation avant implémentation.**
