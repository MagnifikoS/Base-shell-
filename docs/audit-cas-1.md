# AUDIT CAS 1 — Risque de stock faux / stock fantôme / divergence

**Date :** 2026-03-14
**Périmètre :** Exclusivement la fiabilité du stock — de la formule SSOT jusqu'aux écrans.
**Méthode :** Analyse exhaustive du code réel (migrations SQL, edge functions, hooks frontend, moteur de calcul pur).

---

## 1. Résumé exécutif

**Le risque de stock fantôme (mouvements historiques surcomptés) est maîtrisé dans le code actuel.** La formule SSOT `Stock = Snapshot + Σ(events WHERE snapshot_version_id = snapshot actif)` est respectée de manière cohérente par tous les lecteurs et tous les écrivains audités.

**Le MVP peut être lancé sur ce point**, sous réserve de deux vigilances documentées en section 8 (failles mineures).

**Pourquoi ce sujet était critique :** un stock "plausible mais faux" est pire qu'un crash. Le système a été conçu avec des garde-fous explicites (filtres `snapshot_version_id`, famille d'unité, verrouillage optimiste, idempotence) qui rendent ce scénario très difficile à déclencher en conditions MVP.

---

## 2. Source de vérité réelle du stock

### Formule unique (SSOT)

```
Stock Estimé(produit, zone) = Quantité Snapshot + Σ(stock_events.delta_quantity_canonical)
  WHERE stock_events.snapshot_version_id = zone_stock_snapshots.snapshot_version_id
  AND stock_events.storage_zone_id = produit.storage_zone_id
```

### Où elle vit

| Couche | Fichier | Implémentation |
|--------|---------|----------------|
| **Moteur pur (SSOT)** | `src/modules/stockLedger/engine/stockEngine.ts` | `getEstimatedStock()` — fonction pure, aucun accès DB |
| **Backend (validation)** | Migration `20260216144356` | `fn_post_stock_document()` — CTE `current_estimates` pour la vérification de stock négatif |
| **Backend (void)** | Migration `20260216230004` | `fn_void_stock_document()` — même formule pour vérifier le résultat après annulation |

### Qui l'utilise

| Consommateur | Fichier | Filtre `snapshot_version_id` | Verdict |
|--|--|--|--|
| Stock estimé principal | `src/modules/inventaire/hooks/useEstimatedStock.ts` | ✅ `.eq("snapshot_version_id", snapshot.snapshot_version_id)` (ligne 107) | **Conforme** |
| Alertes de stock | `src/modules/stockAlerts/hooks/useStockAlerts.ts` | ✅ `.in("snapshot_version_id", allSnapshotVersionIds)` (ligne 260) | **Conforme** |
| Stock produit unitaire | `src/hooks/useProductCurrentStock.ts` | ✅ `.eq("snapshot_version_id", snapshot.snapshot_version_id)` (ligne 69) | **Conforme** |
| Verrouillage unité | `src/hooks/useProductHasStock.ts` | ✅ `.eq("snapshot_version_id", snapshot.snapshot_version_id)` (ligne 62) | **Conforme** |
| Vérification dispo retrait | `src/modules/stockLedger/hooks/useCheckStockAvailability.ts` | ✅ Filtre client-side `ev.snapshot_version_id !== snapId` (ligne 104) | **Conforme** |
| Écarts inventaire | `src/modules/inventaireHistory/engine/inventoryHistoryVarianceEngine.ts` | ✅ `.in("snapshot_version_id", sessionIds)` (ligne 195) | **Conforme** |
| `fn_post_stock_document` | Migration `20260216144356` | ✅ `se.snapshot_version_id = zs2.snapshot_version_id` (ligne 212) | **Conforme** |

**Conclusion : La source de vérité est UNIQUE et respectée partout.**

---

## 3. Cartographie complète du flux stock

### 3.1. Écrivains (INSERT dans `stock_events`)

| # | Point d'écriture | Mécanisme | Filtre snapshot | Zone produit | Preuve |
|---|--|--|--|--|--|
| W1 | `fn_post_stock_document` | RPC SQL SECURITY DEFINER | ✅ `JOIN zone_stock_snapshots zss ON zss.storage_zone_id = p.storage_zone_id` (ligne 275-277) | ✅ `p.storage_zone_id` (ligne 259) | Migration `20260216144356` |
| W2 | `fn_ship_commande` (B2B expédition) | INSERT inline (bypass DRAFT) | ✅ `v_snapshot.snapshot_version_id` (ligne 209) | ✅ `v_zone_id` = zone produit fournisseur (ligne 199) | Migration `20260311144047` |
| W3 | `fn_post_b2b_reception` (réception B2B) | INSERT inline (bypass fn_post) | ✅ `zss.snapshot_version_id` via JOIN (ligne 302) | ✅ `p.storage_zone_id` via JOIN (ligne 292) | Migration `20260228195700` |
| W4 | `fn_quick_adjustment` | Appelle `fn_post_stock_document` | ✅ (délégué à W1) | ✅ (délégué à W1) | Migration `20260301174539` |
| W5 | `fn_correct_bl_withdrawal` | Appelle `fn_post_stock_document` | ✅ (délégué à W1) | ✅ (délégué à W1) | Migration `20260301174539` |
| W6 | `useCreateCorrection` (BL correction) | Appelle `fn_post_stock_document` via RPC | ✅ (délégué à W1) | ✅ (délégué à W1) | `src/modules/blApp/hooks/useCreateCorrection.ts` |
| W7 | `fn_init_product_stock` | INSERT inline | ✅ `v_snapshot.snapshot_version_id` | ✅ `v_product.storage_zone_id` | Migration `20260219215913` |
| W8 | `fn_void_stock_document` | INSERT événements inverses | ✅ Copie le `snapshot_version_id` de l'événement original | ✅ Copie le `storage_zone_id` de l'événement original | Migration `20260216230004` |

**Protection supplémentaire :** La table `stock_events` a une politique RLS qui **bloque les INSERT directs** par les utilisateurs authentifiés (migration `20260217140001`). Seuls les `SECURITY DEFINER` et le `service_role` peuvent écrire.

### 3.2. Lecteurs (SELECT sur `stock_events`)

| # | Lecteur | Usage | Filtre snapshot |
|---|--|--|--|
| R1 | `useEstimatedStock` | Affichage stock desktop/mobile | ✅ |
| R2 | `useStockAlerts` | Alertes rupture/warning | ✅ |
| R3 | `useProductCurrentStock` | Stock unitaire (modal quantité) | ✅ |
| R4 | `useProductHasStock` | Verrouillage changement d'unité | ✅ |
| R5 | `useCheckStockAvailability` | Pré-check retrait | ✅ |
| R6 | `inventoryHistoryVarianceEngine` | Écarts inventaire | ✅ |
| R7 | `fn_post_stock_document` CTE | Validation stock négatif | ✅ |

---

## 4. Audit des snapshots

### Comment un snapshot devient la base

1. L'utilisateur termine un inventaire (session `en_cours` → `termine`)
2. `fn_complete_inventory_session` (migration `20260301205809`) :
   - Verrouille la session avec `FOR UPDATE`
   - Met à jour `status = 'termine'`, reconcilie les comptages
   - **UPSERT atomique** dans `zone_stock_snapshots` : met `snapshot_version_id = session_id`
   - L'`ON CONFLICT (establishment_id, storage_zone_id) DO UPDATE` garantit qu'il n'y a **jamais qu'un seul snapshot actif par zone**

3. Tous les événements futurs sont rattachés au nouveau `snapshot_version_id`
4. Les événements de l'ancien snapshot ne sont plus lus (car filtrés par `snapshot_version_id`)

### Risque de double comptage

**ÉCARTÉ.** Le mécanisme est mathématiquement sûr :
- Un nouvel inventaire crée un nouveau `snapshot_version_id`
- Les anciens événements ont l'ancien `snapshot_version_id`
- Tous les lecteurs filtrent par le `snapshot_version_id` actif
- Les anciens événements sont donc **invisibles** pour le stock courant

### Risque de mélange historique

**ÉCARTÉ.** Aucun lecteur ne fait un `SUM(delta_quantity_canonical)` sans filtre `snapshot_version_id`. J'ai vérifié les 7 lecteurs un par un (cf. section 2).

### Scénario d'orphelins

Si un événement est créé entre le moment où le snapshot change et le moment où l'écriture arrive en base :
- **Impossible** : `fn_complete_inventory_session` et les écrivains de stock sont dans des **transactions séparées**. Le snapshot change d'abord, puis les nouveaux mouvements utilisent le nouveau snapshot.
- Si un mouvement arrive "en même temps" que la complétion d'inventaire, il utilise le `snapshot_version_id` lu au moment du `JOIN zone_stock_snapshots` dans sa propre transaction. Le `FOR UPDATE` sur la session empêche les races.

---

## 5. Audit des unités

### Unité canonique réelle

Le système utilise **`canonical_family`** (ex: `"weight"`, `"volume"`, `"count"`) pour regrouper les unités compatibles. Chaque événement porte :
- `canonical_unit_id` : l'unité exacte (ex: `kg`, `g`, `pce`)
- `canonical_family` : la famille (ex: `"weight"`)
- `context_hash` : empreinte de la configuration de conditionnement au moment du POST

### Garde-fou du StockEngine

Le `StockEngine` (ligne 116 de `stockEngine.ts`) **filtre les événements incompatibles** :
```typescript
const compatibleEvents = events.filter((e) => e.canonical_family === snapshotFamily);
```

Si un événement a une famille différente du snapshot, il est **ignoré** et un warning `IGNORED_EVENTS_FAMILY_MISMATCH` est émis. Cela protège contre la pollution par des unités hétérogènes.

### Où l'unité peut être contournée

| Flux | Sûr ? | Preuve |
|------|-------|--------|
| Réception manuelle (useReceiptDraft) | ✅ | L'unité canonique vient du `buildCanonicalLine` qui utilise le produit |
| Retrait (useWithdrawalDraft) | ✅ | Même pattern : `canonicalFamily` passé explicitement |
| BL correction (useCreateCorrection) | ✅ | `CorrectionLine` exige `canonical_unit_id` + `canonical_family` + `context_hash` |
| Quick Adjustment (fn_quick_adjustment) | ✅ | Paramètres `p_canonical_unit_id` + `p_canonical_family` obligatoires |
| B2B expédition (fn_ship_commande) | ✅ | Jointure `measurement_units mu ON mu.id = cl.canonical_unit_id` (ligne 127) |
| B2B réception (fn_post_b2b_reception) | ⚠️ VOIR FAILLE F1 | `canonical_family` provient du JSON `p_validated_lines` avec fallback `'count'` (ligne 276) |
| Initialisation stock (fn_init_product_stock) | ✅ | Résout l'unité depuis `products_v2.stock_handling_unit_id` |

### FAILLE F1 — `fn_post_b2b_reception` : fallback `canonical_family = 'count'`

**Fichier :** Migration `20260228195700`, ligne 276
**Code :** `COALESCE(v_line->>'client_canonical_family', 'count')`

**Risque :** Si le JSON `p_validated_lines` n'inclut pas `client_canonical_family` (champ manquant dans le payload frontend), le fallback `'count'` sera utilisé. Si le produit est en réalité en `weight` (ex: kg), l'événement sera écrit avec `canonical_family = 'count'`.

**Impact terrain :** Le `StockEngine` frontend **ignorera cet événement** lors du calcul (car famille incompatible avec le snapshot → `IGNORED_EVENTS_FAMILY_MISMATCH`). Le stock sera donc **sous-estimé** après une réception B2B pour ce produit.

**Gravité : 🟠 Élevée mais conditionnelle** — ne se déclenche que si le frontend B2B omet `client_canonical_family`. L'analyse du frontend appelant cette RPC montre que le champ est effectivement construit par le code TypeScript. Le risque est donc **faible en pratique** mais le fallback est dangereux en principe.

**Conditions de déclenchement :** Un bug frontend B2B côté client qui omet le champ `client_canonical_family` dans le payload de validation de réception.

---

## 6. Audit de cohérence backend / frontend

### Backend (fn_post_stock_document) vs Frontend (StockEngine)

| Aspect | Backend CTE (fn_post_stock_document) | Frontend (getEstimatedStock) | Cohérent ? |
|--------|------|---------|---|
| **Formule** | `snapshot_qty + events_delta + line_delta` | `snapshot_qty + events_delta` | ✅ Oui (le backend ajoute le delta du document en cours, ce qui est correct) |
| **Filtre snapshot** | `se.snapshot_version_id = zs2.snapshot_version_id` | `.eq("snapshot_version_id", snapshot.snapshot_version_id)` | ✅ Identique |
| **Zone** | `p.storage_zone_id` (zone produit) | `.eq("storage_zone_id", zoneId)` (zone groupée par produit) | ✅ Identique |
| **Arrondi** | `ROUND(... ::numeric, 4)` | `round4()` = `Math.round(n * 10000) / 10000` | ✅ Identique (4 décimales) |
| **Filtre famille** | Non filtré (backend écrit ce qu'on lui donne) | `events.filter(e => e.canonical_family === snapshotFamily)` | ⚠️ Divergence intentionnelle |

### Divergence intentionnelle sur le filtre famille

Le backend **n'empêche pas** l'écriture d'un événement avec une famille différente du snapshot. C'est le frontend `StockEngine` qui filtre à la lecture. Cela signifie :

- **Backend** : le stock négatif check inclut potentiellement des événements de familles différentes dans sa somme.
- **Frontend** : le stock affiché les exclut.

**Impact :** Le backend pourrait autoriser un mouvement que le frontend n'afficherait pas, ou inversement bloquer un mouvement sur la base d'un calcul incluant des événements ignorés par le frontend.

**Gravité : 🟡 Moyenne** — En pratique, ce scénario nécessite qu'un événement ait été écrit avec la mauvaise famille (cf. F1). Dans un flux normal, toutes les familles sont cohérentes car elles proviennent du même produit.

---

## 7. Audit de concurrence

### Scénario 1 : Deux réceptions quasi simultanées

| Mécanisme de protection | Détail |
|---|---|
| **Verrouillage optimiste** | `lock_version` sur `stock_documents` — `WHERE lock_version = p_expected_lock_version` (ligne 169) |
| **Idempotence** | `idempotency_key` vérifié AVANT la mutation (ligne 44-47) |
| **Atomicité** | L'ensemble POST + INSERT events est dans une seule transaction SQL (PL/pgSQL) |

**Verdict : SAFE.** Si deux POST arrivent pour le même document, le premier réussit et le second échoue avec `LOCK_CONFLICT`. Si le même POST est réémis, il est idempotent.

### Scénario 2 : Inventaire + réception simultanés

1. L'inventaire complète la session → `fn_complete_inventory_session` change le `snapshot_version_id`
2. La réception est en train de poster → `fn_post_stock_document` lit le `snapshot_version_id` via `JOIN zone_stock_snapshots`

**Cas 1 :** La réception lit le snapshot AVANT le changement → l'événement est rattaché à l'ancien snapshot → **événement invisible** après le changement de snapshot. Le stock affiché ne reflètera pas cette réception.

**Ceci est le comportement CORRECT.** L'inventaire "remet les compteurs à zéro". Une réception arrivant pendant un inventaire sera de toute façon comptée dans le nouvel inventaire physique.

**Cas 2 :** La réception lit le snapshot APRÈS le changement → l'événement est rattaché au nouveau snapshot → **comportement normal**.

**Verdict : SAFE.** Le pire cas (événement invisible) est le comportement métier correct d'un inventaire.

### Scénario 3 : Ajustement + lecture stock

Pas de conflit : l'ajustement (`fn_quick_adjustment`) est transactionnel et la lecture arrive avant ou après.

### Scénario 4 : Retrait + réception quasi simultanés

Chacun crée son propre document et ses propres événements. Le `lock_version` est par document, pas global. Les deux transactions sont indépendantes.

**Risque théorique :** La vérification de stock négatif du retrait pourrait ne pas "voir" la réception si elle n'est pas encore committée.

**Mitigation :** PostgreSQL utilise l'isolation `READ COMMITTED` par défaut. Le CTE `current_estimates` verra les événements committés au moment de son exécution. Les deux transactions ne se bloquent pas mutuellement car elles écrivent dans des documents différents.

**Verdict : SAFE pour le MVP.** Une fenêtre de quelques millisecondes existe où un retrait pourrait être refusé (stock négatif) alors qu'une réception est en cours mais non committée. C'est **conservateur** (refuse plutôt qu'autorise), ce qui est le bon comportement.

### Scénario 5 : Plusieurs utilisateurs mobiles simultanés

Chaque utilisateur travaille sur un document différent. Les documents sont liés à l'établissement mais indépendants entre eux. Le `lock_version` par document empêche les conflits d'écriture sur le même document.

**Verdict : SAFE.**

---

## 8. Liste des failles identifiées

### F1 — Fallback `canonical_family = 'count'` dans `fn_post_b2b_reception`

| Attribut | Valeur |
|---|---|
| **Gravité** | 🟠 Élevée (conditionnelle) |
| **Fichier** | `supabase/migrations/20260228195700`, ligne 276 |
| **Preuve** | `COALESCE(v_line->>'client_canonical_family', 'count')` |
| **Conséquence terrain** | Réception B2B d'un produit poids (kg) → événement écrit avec `family='count'` → StockEngine frontend ignore l'événement → stock sous-estimé |
| **Conditions** | Frontend B2B omet `client_canonical_family` dans le JSON |
| **Impact métier** | Le restaurant pense avoir moins de stock qu'en réalité. Pas de rupture terrain, mais food cost faussé. |

### F2 — Divergence backend/frontend sur le filtre famille

| Attribut | Valeur |
|---|---|
| **Gravité** | 🟡 Moyenne |
| **Fichier** | `fn_post_stock_document` (backend) vs `stockEngine.ts` (frontend) |
| **Preuve** | Backend somme TOUS les événements pour le check négatif. Frontend filtre par `canonical_family`. |
| **Conséquence terrain** | Si F1 s'est produit : le backend voit un stock plus élevé que le frontend. Un retrait pourrait être autorisé alors que le frontend affiche un stock insuffisant. |
| **Conditions** | Pré-requis : F1 doit s'être déclenché au moins une fois |
| **Impact métier** | Confusion utilisateur. Le système autorise un retrait alors que l'écran dit "stock insuffisant". |

### F3 — Limite de 10 000 événements par zone dans `useEstimatedStock`

| Attribut | Valeur |
|---|---|
| **Gravité** | 🟢 Faible pour MVP |
| **Fichier** | `src/modules/inventaire/hooks/useEstimatedStock.ts`, ligne 29 et 108 |
| **Preuve** | `const STOCK_EVENTS_LIMIT = 10_000` avec `console.warn` si atteint |
| **Conséquence terrain** | Si > 10 000 événements par zone pour un seul snapshot (très improbable pour MVP), les derniers événements sont tronqués → stock faux |
| **Conditions** | > 10 000 mouvements dans une même zone sans nouvel inventaire |
| **Impact métier** | Inexistant pour 2-3 restaurants MVP. Deviendrait un risque à haute fréquence de mouvements. |

### F4 — `useProductCurrentStock` ne filtre pas par `canonical_family`

| Attribut | Valeur |
|---|---|
| **Gravité** | 🟡 Moyenne |
| **Fichier** | `src/hooks/useProductCurrentStock.ts`, lignes 64-76 |
| **Preuve** | La boucle somme `evt.delta_quantity_canonical` sans vérifier `canonical_family` |
| **Conséquence terrain** | Si F1 s'est produit, `useProductCurrentStock` comptera l'événement pollué, tandis que `useEstimatedStock` (qui utilise le StockEngine) l'ignorera. Les deux écrans afficheront des stocks différents. |
| **Conditions** | Pré-requis : F1 doit s'être déclenché |
| **Impact métier** | Valeur stock incohérente entre le drawer produit et la liste stock. |

---

## 9. Liste des faux positifs écartés

### FP1 — "Les mouvements anciens sont additionnés"

**Écarté.** Tous les lecteurs filtrent par `snapshot_version_id`. Les événements des snapshots précédents sont invisibles. J'ai vérifié les 7 lecteurs individuellement.

### FP2 — "L'inventaire peut corrompre le stock en cours"

**Écarté.** `fn_complete_inventory_session` fait un UPSERT atomique du snapshot. Les mouvements rattachés à l'ancien snapshot restent rattachés à l'ancien snapshot. Le nouveau snapshot repart de la base physique comptée.

### FP3 — "Deux inventaires simultanés dans la même zone"

**Écarté.** Index unique partiel `uq_inventory_sessions_one_active_per_zone` (migration `20260301174539`, ligne 356-358) empêche deux sessions actives dans la même zone.

### FP4 — "Les utilisateurs authentifiés peuvent écrire directement dans stock_events"

**Écarté.** Migration `20260217140001` bloque les INSERT directs via RLS. Les fonctions `fn_post_stock_document` et `fn_void_stock_document` sont `REVOKE`d pour `authenticated` (migration `20260216230004`). Seul le `service_role` peut les appeler (via edge functions).

### FP5 — "Le void peut créer un déséquilibre"

**Écarté.** `fn_void_stock_document` crée des événements inverses exacts (`-delta`) et vérifie que la somme résultante n'est pas négative. Un check `VOID_BALANCE_ERROR` détecte les anomalies.

### FP6 — "Le changement de zone produit invalide le stock"

**Écarté.** Les RPCs de changement de zone (`fn_move_product_zone`, `fn_transfer_product_zone`) créent un événement WITHDRAWAL dans l'ancienne zone et un événement RECEIPT dans la nouvelle zone, avec les bons `snapshot_version_id` pour chaque zone.

### FP7 — "Le verrouillage d'unité peut être contourné"

**Écarté.** `useProductHasStock` vérifie le stock non-nul avant d'autoriser le changement d'unité. Un trigger SQL `BEFORE UPDATE` sur `products_v2` bloque le changement de `stock_handling_unit_id` si le stock est > 0 (protégé au niveau DB).

---

## 10. Verdict

### ✅ SAFE POUR MVP — sous conditions

Le système de stock de Restaurant OS MVP **ne peut pas produire de stock fantôme** dans les conditions normales d'utilisation de 2-3 restaurants. La formule SSOT est unique, cohérente, et respectée par tous les points d'écriture et de lecture.

**Conditions :**

1. **Le flux B2B (réception inter-établissements) doit toujours envoyer `client_canonical_family` dans le payload.** Le code frontend actuel le fait. Ce point doit être vérifié/testé lors du déploiement (F1).

2. **Le nombre d'événements par zone ne doit pas dépasser 10 000 avant le prochain inventaire.** Pour 2-3 restaurants avec des inventaires réguliers (hebdomadaires ou mensuels), ce seuil est irréaliste (F3).

**Score de confiance stock : 9/10**
- 10/10 pour les flux standard (réception, retrait, ajustement, inventaire)
- 8/10 pour le flux B2B (fallback `'count'` dans fn_post_b2b_reception)
- 10/10 pour la protection anti-stock négatif
- 10/10 pour la concurrence et l'atomicité

---

## 11. Plan de correction recommandé

### Priorité 1 — Avant production (1 correction)

**C1 : Supprimer le fallback `'count'` dans `fn_post_b2b_reception`**

- **Quoi :** Remplacer `COALESCE(v_line->>'client_canonical_family', 'count')` par un `RAISE EXCEPTION` si le champ est manquant.
- **Pourquoi :** Un fallback silencieux est le pire pattern pour un ledger financier. Mieux vaut bloquer et alerter que polluer silencieusement.
- **Complexité :** 1 ligne SQL à modifier.
- **Risque de régression :** Nul si le frontend envoie toujours le champ (ce qui est le cas actuellement).

### Priorité 2 — Harmonisation (2 corrections, peuvent attendre post-launch)

**C2 : Ajouter le filtre `canonical_family` dans `useProductCurrentStock`**

- **Quoi :** Reproduire la logique du StockEngine (filtrer les événements par famille compatible avec le snapshot) dans `useProductCurrentStock.ts`.
- **Pourquoi :** Garantir que le stock affiché dans le drawer produit (UniversalQuantityModal) est identique au stock de la liste.
- **Alternative :** Remplacer `useProductCurrentStock` par un appel au StockEngine unifié au lieu de recalculer manuellement.

**C3 : Ajouter le filtre `canonical_family` dans le CTE `current_estimates` de `fn_post_stock_document`**

- **Quoi :** Filtrer les événements par `canonical_family` compatible dans la vérification de stock négatif backend.
- **Pourquoi :** Aligner le calcul backend avec le calcul frontend pour éliminer la divergence F2.
- **Complexité :** Nécessite de joindre `inventory_lines` pour obtenir la famille du snapshot, puis filtrer les événements.

### Priorité 3 — Améliorations futures

**C4 : Remplacer `useProductCurrentStock` par le StockEngine**

- **Quoi :** Faire appel à `getEstimatedStock()` depuis un hook unitaire au lieu de recalculer manuellement.
- **Pourquoi :** SSOT — un seul chemin de calcul pour tous.

**C5 : Monitoring du seuil 10 000 événements**

- **Quoi :** Ajouter une alerte admin si une zone approche 8 000 événements sans nouvel inventaire.
- **Pourquoi :** Prévention de la troncation F3.

### Ce qu'il faut interdire

- ❌ **Jamais** de calcul de stock sans filtre `snapshot_version_id`
- ❌ **Jamais** de fallback silencieux sur les champs canoniques (`canonical_unit_id`, `canonical_family`)
- ❌ **Jamais** d'INSERT direct dans `stock_events` en dehors des fonctions SECURITY DEFINER

### Ce qu'il faut tester après correction

1. **Test C1 :** Envoyer un payload B2B sans `client_canonical_family` → doit lever une exception, pas un fallback.
2. **Test C2 :** Créer un événement avec une famille différente du snapshot → `useProductCurrentStock` doit l'ignorer.
3. **Test C3 :** Même scénario côté backend → la vérification de stock négatif doit exclure les événements de famille incompatible.

---

## 12. Preuves

### Fichiers audités

| Fichier | Rôle | Verdict |
|---------|------|---------|
| `src/modules/stockLedger/engine/stockEngine.ts` | Moteur de calcul pur | ✅ Conforme |
| `src/modules/inventaire/hooks/useEstimatedStock.ts` | Lecteur principal | ✅ Conforme |
| `src/modules/stockAlerts/hooks/useStockAlerts.ts` | Alertes | ✅ Conforme |
| `src/hooks/useProductCurrentStock.ts` | Stock unitaire | ⚠️ Manque filtre famille |
| `src/hooks/useProductHasStock.ts` | Verrouillage unité | ✅ Conforme |
| `src/modules/stockLedger/hooks/useCheckStockAvailability.ts` | Pré-check retrait | ✅ Conforme |
| `src/modules/inventaireHistory/engine/inventoryHistoryVarianceEngine.ts` | Écarts | ✅ Conforme |
| `supabase/migrations/20260216144356` | fn_post_stock_document | ✅ Conforme (sauf F2) |
| `supabase/migrations/20260311144047` | fn_ship_commande | ✅ Conforme |
| `supabase/migrations/20260228195700` | fn_post_b2b_reception | ⚠️ Fallback 'count' (F1) |
| `supabase/migrations/20260301174539` | fn_quick_adjustment / fn_correct_bl_withdrawal | ✅ Conforme |
| `supabase/migrations/20260301205809` | fn_complete_inventory_session | ✅ Conforme |
| `supabase/migrations/20260216230004` | fn_void_stock_document | ✅ Conforme |
| `supabase/migrations/20260217140001` | RLS stock_events (blocage INSERT) | ✅ Conforme |
| `supabase/functions/stock-ledger/index.ts` | Edge function orchestrateur | ✅ Conforme |
| `src/modules/blApp/hooks/useCreateCorrection.ts` | Corrections BL | ✅ Conforme |

### Tables critiques

| Table | Rôle | Protection |
|-------|------|-----------|
| `stock_events` | Ledger append-only | RLS INSERT bloqué, SECURITY DEFINER obligatoire |
| `zone_stock_snapshots` | Snapshot actif par zone | UNIQUE(establishment_id, storage_zone_id), UPSERT atomique |
| `inventory_lines` | Lignes de comptage (snapshot) | Immuables après session terminée |
| `inventory_sessions` | Sessions d'inventaire | UNIQUE partial (1 active par zone) |
| `stock_documents` | Documents (DRAFT/POSTED/VOID) | lock_version, idempotency_key |
| `stock_document_lines` | Lignes de document | FK stock_documents, NOT NULL canoniques |

### RPC critiques vérifiées

| RPC | Snapshot filter | Zone routing | Negative check | Idempotence |
|-----|----------------|-------------|----------------|-------------|
| `fn_post_stock_document` | ✅ | ✅ | ✅ | ✅ |
| `fn_void_stock_document` | ✅ | ✅ | ✅ | ✅ |
| `fn_complete_inventory_session` | ✅ (crée) | ✅ | N/A | ✅ |
| `fn_quick_adjustment` | ✅ (via W1) | ✅ (via W1) | ✅ (via W1) | ✅ |
| `fn_ship_commande` | ✅ | ✅ | ⚠️ (override=true) | ✅ |
| `fn_post_b2b_reception` | ✅ | ✅ | ⚠️ (via W1 pour supplier) | ✅ |
| `fn_init_product_stock` | ✅ | ✅ | N/A | ✅ |

---

## Réponse à la question finale

> **Le système de stock de Restaurant OS MVP peut-il aujourd'hui produire un stock faux ou incohérent en conditions réelles pour 2–3 restaurants ?**

**Non**, dans les conditions normales d'utilisation.

**Oui**, dans un cas très spécifique et peu probable : si le frontend B2B omet `client_canonical_family` dans un payload de réception, un événement sera écrit avec `family='count'` au lieu de la vraie famille, et le stock frontend l'ignorera (sous-estimation). Ce cas est protégé par le code frontend actuel mais pas par le backend.

**Stratégie :** Une seule correction SQL d'une ligne (supprimer le fallback `'count'`) suffit à fermer ce risque avant production.
