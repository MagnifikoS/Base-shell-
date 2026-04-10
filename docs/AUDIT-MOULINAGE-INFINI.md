# AUDIT — Moulinage infini après validation (Réception & Retrait)

> **Date :** 2026-03-11  
> **Scope :** Inventaire → Réception (mobile + desktop) + Retrait (mobile + desktop)  
> **Reproduit en live :** OUI (réception mobile, spinner "Chargement..." + bouton "Forcer la création")

---

## Résumé exécutif

Après validation réussie d'une réception ou d'un retrait, le backend réussit (mouvements de stock créés, document posté) **mais l'interface reste bloquée sur un spinner infini**. Le bouton "Forcer la création" est un contournement, pas une correction.

**Cause commune :** Après POST, le document passe de `DRAFT` à `POSTED`. La query React Query qui filtre par `status = 'DRAFT'` retourne alors `null`. L'UI détecte `!document` et affiche un spinner en attendant un brouillon qui ne sera jamais recréé automatiquement car le flag de garde (`draftEnsured.current` ou `hasEnsuredDraft.current`) n'est pas réinitialisé.

---

## Tableau de synthèse

| Flux | Fichier | Bug ? | Cause exacte | Ligne(s) |
|------|---------|-------|--------------|----------|
| **Réception Mobile** | `MobileReceptionView.tsx` | ✅ OUI | Après POST réussi (L438-439), `hasCompletedRef = true`. Le popup BL se ferme (L943-948) mais reste sur l'écran fournisseur. La query `document` retourne `null` → L780 affiche spinner. **Personne ne recrée le draft ni ne redirige.** | L438, L780, L943 |
| **Réception Desktop** | `ReceptionView.tsx` | ⚠️ PARTIEL | Après POST (L284-297), `hasEnsuredDraft.current = false` est bien réinitialisé (L297). **Mais** : après fermeture du popup BL (L666-669), le document query retourne `null`, et le composant ne montre un spinner que si un fournisseur est sélectionné. L'utilisateur doit re-sélectionner un fournisseur pour relancer `ensureDraft()`. Pas de spinner infini mais UX confuse (liste vide). | L297, L666 |
| **Retrait Mobile** | `MobileWithdrawalView.tsx` | ✅ OUI | `useEffect` L149-162 auto-crée le draft quand `!document && !draftEnsured.current`. Après POST réussi (L372-412), `draftEnsured.current` reste `true` → le `useEffect` ne peut pas recréer le draft → spinner infini L535-539. | L146, L150-151, L383, L535 |
| **Retrait Desktop** | `WithdrawalView.tsx` | ✅ OUI | Même mécanisme que retrait mobile. `useEffect` L97-110 bloqué par `draftEnsured.current = true` qui n'est jamais réinitialisé après POST réussi (L137-207). **Bonus :** la boucle de détection d'écarts (L152-206) fait des `await` séquentiels par ligne, bloquant le `finally` et gelant l'UI pendant plusieurs secondes sur gros retraits. | L77, L98-99, L148, L152-206 |

---

## Analyse détaillée par flux

### 1. Réception Mobile (`MobileReceptionView.tsx` — 1093 lignes)

#### Flux normal
1. Utilisateur sélectionne fournisseur → `handleSupplierSelect()` L249
2. `ensureDraft()` appelé (L254) → crée un `stock_document` DRAFT
3. Utilisateur ajoute produits + quantités
4. Clic "Valider réception" → ouvre popup BL (`BlAppPostPopup`)
5. Popup BL appelle `handlePostForPopup()` L425
6. POST réussi → `hasCompletedRef.current = true` (L439)
7. Popup retourne `{ ok: true }` → se ferme

#### Point de blocage
- **L943-948 :** Quand le popup BL se ferme (`onClose`), il nettoie les states BL mais **reste sur l'écran fournisseur** (commentaire L948 : `// Stay on supplier product list — do NOT reset selectedSupplierId`)
- **L780 :** L'UI vérifie `{!document ?` → `document` est maintenant `null` (query filtre par `status = 'DRAFT'`, le doc est `POSTED`)
- **L800-806 :** Affiche `Chargement... + Forcer la création`
- **Pas de `useEffect` auto-create** dans MobileReceptionView (contrairement au retrait)
- **`ensureDraft()` n'est jamais rappelé** car il n'y a ni ref guard ni auto-create

#### Preuve en live
Console logs après validation :
```
[usePostDocument] posting document: caddb1f7... lockVersion: 1
[AppRealtimeSync] stock_events INSERT -> invalidating stock queries
```
→ Aucun log de recréation de draft. Spinner infini confirmé.

---

### 2. Réception Desktop (`ReceptionView.tsx` — 722 lignes)

#### Flux normal
1. Sélection fournisseur → `handleSupplierChange()` L182
2. `ensureDraft()` L193 si `!hasEnsuredDraft.current`
3. POST via `handlePost()` L267
4. POST réussi → `hasEnsuredDraft.current = false` (L297) ✅
5. Ouverture popup BL (L299-304)
6. Fermeture popup BL (L666-669)

#### Analyse
- **L297 :** `hasEnsuredDraft.current = false` — **correctement réinitialisé** ✅
- **Mais :** après fermeture popup BL, `document = null` et aucun fournisseur n'est auto-sélectionné
- L'UI ne montre pas de spinner infini car le guard `!document` est géré en amont du supplier selector
- **Verdict :** Pas de spinner infini, mais UX confuse (le fournisseur est toujours sélectionné, la liste produits vide)

---

### 3. Retrait Mobile (`MobileWithdrawalView.tsx` — 798 lignes)

#### Flux normal
1. Page chargée → `useEffect` L149-162 détecte `!document && defaultZoneId && !draftEnsured.current`
2. `draftEnsured.current = true` (L151) → `ensureDraft()` (L152)
3. Utilisateur ajoute produits + quantités
4. Clic "Valider retrait" → `handlePost()` L358
5. POST réussi (L372)

#### Point de blocage
- **L146 :** `draftEnsured = useRef(false)` — initialisé à `false`
- **L151 :** Mis à `true` avant `ensureDraft()`
- **L372-412 :** Après POST réussi, toast succès, nettoyage states — **mais `draftEnsured.current` n'est JAMAIS remis à `false`**
- **L149-162 :** Le `useEffect` qui auto-crée le draft vérifie `!draftEnsured.current` — condition bloquée
- **L535-539 :** UI affiche `Préparation… + Forcer la création`

#### Code responsable
```typescript
// L146 — Jamais réinitialisé après POST
const draftEnsured = useRef(false);

// L149-162 — Bloqué car draftEnsured.current reste true
useEffect(() => {
  if (!isLoading && !document && defaultZoneId && !draftEnsured.current) {
    draftEnsured.current = true;  // ← Set to true, never reset after POST
    ensureDraft().then((result) => {
      if (!result.ok) {
        draftEnsured.current = false;  // ← Only reset on FAILURE
      }
    });
  }
}, [isLoading, document, defaultZoneId, ensureDraft]);
```

**Le `draftEnsured.current = false` n'est fait que si `result.ok === false`, jamais après un POST réussi.**

---

### 4. Retrait Desktop (`WithdrawalView.tsx` — 450 lignes)

#### Même bug que retrait mobile
- **L77 :** `draftEnsured = useRef(false)`
- **L97-110 :** `useEffect` auto-create avec même guard `!draftEnsured.current`
- **L137-207 :** POST réussi — `draftEnsured.current` jamais réinitialisé

#### Bug supplémentaire : boucle séquentielle bloquante
```typescript
// L152-206 — AWAIT SÉQUENTIEL PAR LIGNE (bloque le finally)
if (!result.idempotent) {
  for (const line of lines) {
    const { data: snapshots } = await supabase...  // ← await #1
    const { data: invLines } = await supabase...   // ← await #2
    const { data: events } = await supabase...     // ← await #3
    // ...
  }
}
```
Pour N lignes : **3×N requêtes séquentielles** avant d'atteindre le `finally { setPostGuard(false) }` (L224-226). Sur un retrait de 10 produits = 30 requêtes DB séquentielles.

**Note :** Le retrait mobile (MobileWithdrawalView L388-410) utilise `stockByProduct` en mémoire et `detectDiscrepancy().catch(() => {})` fire-and-forget — **pas de blocage séquentiel**. C'est le bon pattern.

---

## Hooks de draft

### `useReceiptDraft` (`useReceiptDraft.ts`)
- **Query :** filtre `status = 'DRAFT'` (L70) → retourne `null` après POST
- **`ensureDraft()` :** abandonne les stale drafts (>15 min), puis find-or-create
- **Pas de recréation automatique** — l'appel doit être explicite

### `useWithdrawalDraft` (`useWithdrawalDraft.ts`)
- **Même pattern** que receipt
- **Pas de recréation automatique** — dépend du `useEffect` dans les composants

### Verdict hooks
Les hooks sont **corrects et fonctionnels**. Le problème est dans les composants qui ne réinitialisent pas le flag guard après POST.

---

## États de loading

| Composant | State | Mis à `true` | Remis à `false` | Peut rester bloqué ? |
|-----------|-------|-------------|-----------------|---------------------|
| MobileReceptionView | `postGuard` | L428 | L456-458 (finally) | ❌ Non |
| MobileReceptionView | `!document` | Query invalide post-POST | Jamais (pas de recréation) | **✅ OUI — CAUSE RACINE** |
| MobileWithdrawalView | `postGuard` | L361 | L429-431 (finally) | ❌ Non |
| MobileWithdrawalView | `draftEnsured` | L151 | Uniquement si `!result.ok` | **✅ OUI — CAUSE RACINE** |
| WithdrawalView | `postGuard` | L124 | L224-226 (finally) | ⚠️ Retardé par boucle séquentielle |
| WithdrawalView | `draftEnsured` | L99 | Uniquement si `!result.ok` | **✅ OUI — CAUSE RACINE** |
| ReceptionView | `postGuard` | L271 | L331-333 (finally) | ❌ Non |
| ReceptionView | `hasEnsuredDraft` | L192 | L197 + **L297** ✅ | ❌ Non |

---

## Invalidations React Query

| Flux | Query invalidée | Conséquence |
|------|----------------|-------------|
| Tous | `stock_events` via realtime | Rafraîchit les stocks → OK |
| Tous | `stock-document-draft` | Refetch → doc DRAFT introuvable → retourne `null` → **spinner** |
| Tous | `stock-document-lines` | Dépend du doc → `enabled: !!document.id` → pas de fetch |

**Le spinner n'est PAS causé par une query qui boucle.** C'est l'absence de document DRAFT qui déclenche l'affichage du fallback spinner.

---

## Scénario "draft déjà existant"

**Non applicable ici.** Le bug se produit dans l'autre sens : le draft n'existe PLUS (il est passé en `POSTED`), et aucun nouveau draft n'est créé.

---

## Erreurs silencieuses

| Fichier | Ligne | Problème |
|---------|-------|----------|
| WithdrawalView.tsx | L152-206 | Les `await supabase...` dans la boucle de détection d'écarts peuvent throw, mais sont dans le `try` principal du `handlePost`. Un échec ici empêcherait le `finally` de s'exécuter immédiatement → `postGuard` reste `true`. **CEPENDANT** l'exception finirait par atteindre le catch/finally — le vrai problème est la latence, pas une erreur silencieuse. |
| MobileWithdrawalView.tsx | L407 | `.catch(() => {})` — silencieux mais intentionnel (fire-and-forget). OK. |

---

## Comparatif Mobile vs Desktop

### Réception
| Aspect | Mobile | Desktop |
|--------|--------|---------|
| Guard ref | `hasCompletedRef` (empêche double-POST) | `hasEnsuredDraft` (empêche double-create) |
| Reset après POST | ❌ **NON** | ✅ L297 `hasEnsuredDraft.current = false` |
| Auto-create draft | ❌ NON | ❌ NON (déclenché par sélection fournisseur) |
| Spinner infini | **✅ OUI** | ❌ Non (mais UX confuse) |
| Même source ? | **NON** — le mobile n'a pas de reset du tout |

### Retrait
| Aspect | Mobile | Desktop |
|--------|--------|---------|
| Guard ref | `draftEnsured` | `draftEnsured` |
| Reset après POST | ❌ **NON** | ❌ **NON** |
| Auto-create draft | ✅ `useEffect` L149-162 | ✅ `useEffect` L97-110 |
| Spinner infini | **✅ OUI** | **✅ OUI** |
| Même source ? | **OUI — même bug, même cause** |
| Bug bonus | — | Boucle séquentielle L152-206 |

---

## Causes racines exactes

### Bug #1 — Réception Mobile (P0)
- **Fichier :** `src/modules/stockLedger/components/MobileReceptionView.tsx`
- **Cause :** Après POST réussi + fermeture popup BL, le composant reste sur l'écran fournisseur avec `document = null`. Aucun mécanisme ne recrée le draft ni ne redirige vers la liste fournisseurs.
- **Lignes responsables :** L438-439 (POST OK, `hasCompletedRef = true`), L943-948 (onClose popup ne fait rien), L780 (guard `!document` déclenche spinner)

### Bug #2 — Retrait Mobile + Desktop (P0)
- **Fichier :** `MobileWithdrawalView.tsx` L146-162 + `WithdrawalView.tsx` L77-110
- **Cause :** `draftEnsured.current` est mis à `true` avant `ensureDraft()` et n'est réinitialisé que si la création échoue (`!result.ok`). Après un POST réussi, le document passe en `POSTED`, la query retourne `null`, mais le `useEffect` ne peut pas auto-créer un nouveau draft car `draftEnsured.current === true`.
- **Ligne responsable :** L151/L99 (`draftEnsured.current = true` — jamais reset après POST)

### Bug #3 — Retrait Desktop : boucle bloquante (P1)
- **Fichier :** `WithdrawalView.tsx` L152-206
- **Cause :** Boucle `for...of` avec 3 `await` par ligne (snapshots + inventory_lines + stock_events). Bloque le `finally { setPostGuard(false) }` pendant la durée de toutes les requêtes.

---

## Correction minimale recommandée

### Bug #1 — Réception Mobile
```typescript
// Dans handlePostForPopup, après result.ok (L439) :
hasCompletedRef.current = true;
// AJOUTER : Rediriger vers la liste fournisseurs après fermeture du popup BL
// OU : Recréer automatiquement un draft via ensureDraft()
```

**Option A (recommandée) :** Dans le `onClose` du popup BL (L943-948), ajouter `setSelectedSupplierId(null)` pour revenir à la liste fournisseurs.

**Option B :** Appeler `ensureDraft()` après fermeture du popup BL pour recréer un nouveau draft.

### Bug #2 — Retrait Mobile + Desktop
```typescript
// Dans handlePost, dans le bloc result.ok, AJOUTER :
draftEnsured.current = false;
```
Cela permet au `useEffect` de détecter `!document && !draftEnsured.current` et de recréer automatiquement un nouveau draft.

### Bug #3 — Retrait Desktop boucle bloquante
Remplacer la boucle séquentielle par le pattern fire-and-forget utilisé dans le mobile (utiliser `stockByProduct` en mémoire + `detectDiscrepancy().catch(() => {})`).

---

## Risque de régression

| Correction | Risque |
|-----------|--------|
| Reset `draftEnsured.current = false` après POST | **Faible.** Le `useEffect` vérifie aussi `!document` — il ne se déclenche que quand la query retourne `null`, ce qui est le comportement attendu après POST. |
| Redirect vers liste fournisseurs | **Faible.** Le composant supporte déjà ce flux (`setSelectedSupplierId(null)` est utilisé par `confirmBackToSuppliers`). |
| Fire-and-forget pour écarts desktop | **Faible.** Le mobile utilise déjà ce pattern sans problème. |

---

## Questions obligatoires — Réponses

| Question | Réponse |
|----------|---------|
| Pourquoi l'UI mouline alors que le backend a réussi ? | Le document passe de DRAFT à POSTED. La query filtre par `status = 'DRAFT'` → retourne `null`. L'UI affiche un spinner car `!document`. Aucun mécanisme ne recrée le draft. |
| Est-ce le même bug sur réception et retrait ? | **Non.** Réception mobile : pas de recréation du tout. Retrait : le `useEffect` auto-create existe mais est bloqué par `draftEnsured.current = true`. |
| Est-ce le même bug sur mobile et desktop ? | **Retrait : OUI** (même cause). **Réception : NON** (desktop gère correctement avec `hasEnsuredDraft.current = false`). |
| `ensureDraft()` est-il responsable ? | **Non.** `ensureDraft()` fonctionne correctement. C'est le flag de garde qui empêche son appel. |
| Un state de loading reste-t-il coincé ? | `postGuard` est correctement géré (finally). C'est `!document` (absence de draft) qui affiche le spinner. |
| Une query draft boucle-t-elle ? | **Non.** La query ne boucle pas — elle retourne simplement `null` de façon stable. |
| Le bouton "Forcer la création" contourne-t-il un vrai bug ? | **OUI.** Il fait exactement la correction : appeler `ensureDraft()` (et dans le retrait, reset `draftEnsured.current = false` avant). |
| Quelle est la vraie correction minimale ? | (1) Réception mobile : `setSelectedSupplierId(null)` dans onClose du popup BL. (2) Retrait mobile+desktop : `draftEnsured.current = false` après POST réussi. (3) Retrait desktop : rendre la détection d'écarts non-bloquante. |

---

## BUG P0 — Faux "Stock négatif détecté" (PostConfirmDialog)

> **Date découverte :** 2026-03-11  
> **Symptôme :** L'utilisateur retire un produit **qui a du stock**, mais le popup affiche "Stock négatif détecté" après validation.

### Cause racine

La RPC PostgreSQL `fn_post_stock_document` (migration `20260311060941`) calcule le stock estimé **incorrectement** dans le step 9 (negative stock check).

**Formule SSOT (correcte) :**
```
stock_estimé = snapshot_qty + Σ(stock_events WHERE snapshot_version_id = snapshot_courant)
```

**Formule backend (BUGGÉE) :**
```
stock_estimé = snapshot_qty + Σ(TOUS les stock_events historiques, sans filtre snapshot)
```

### Code fautif — `fn_post_stock_document`, step 9, lignes 183-189

```sql
-- ❌ PAS DE FILTRE sur snapshot_version_id !
LEFT JOIN (
    SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
    FROM stock_events se
    WHERE se.establishment_id = v_doc.establishment_id
    GROUP BY se.product_id, se.storage_zone_id
) ev_sum ON ev_sum.product_id = lws.product_id 
         AND ev_sum.storage_zone_id = lws.product_zone_id
```

### Conséquence

Après chaque cycle d'inventaire (nouveau snapshot), les anciens `stock_events` (retraits, réceptions) continuent d'être sommés. Un produit avec un stock réel de 5 kg peut avoir -30 kg d'événements historiques pré-snapshot. Le backend calcule `snapshot_qty(5) + events_total(-30) = -25` → déclenche `NEGATIVE_STOCK` alors que le stock réel est `5 + 0 = 5`.

### Comparaison client vs backend

| Composant | Filtre `snapshot_version_id` | Résultat |
|-----------|------------------------------|----------|
| `useCheckStockAvailability.ts` (L104) | ✅ OUI (`ev.snapshot_version_id !== snapId → skip`) | Stock correct |
| `useProductHasStock.ts` (L62) | ✅ OUI (`.eq("snapshot_version_id", ...)`) | Stock correct |
| `fn_post_stock_document` step 9 (L183-189) | ❌ NON (somme globale sans filtre) | **Stock faux → faux négatif** |
| `fn_post_stock_document` step 10 (L230) | ✅ OUI (insertion avec `zss.snapshot_version_id`) | Événement correct |

### Correction requise

```sql
-- ✅ CORRECTION: Ajouter filtre snapshot_version_id
LEFT JOIN (
    SELECT se.product_id, se.storage_zone_id, SUM(se.delta_quantity_canonical) AS total_delta
    FROM stock_events se
    WHERE se.establishment_id = v_doc.establishment_id
      AND se.snapshot_version_id = lws.snapshot_version_id  -- ← AJOUT CRITIQUE
    GROUP BY se.product_id, se.storage_zone_id
) ev_sum ON ev_sum.product_id = lws.product_id 
         AND ev_sum.storage_zone_id = lws.product_zone_id
```

> **Note :** La sous-requête corrélée nécessite une réécriture en `LATERAL JOIN` car `lws.snapshot_version_id` n'est pas accessible dans la sous-requête non-corrélée actuelle.

### Risque

- **P0 CRITIQUE** — Tout retrait peut échouer à tort si l'établissement a eu au moins un cycle d'inventaire avec des mouvements historiques.
- **Impact :** Empêche les retraits légitimes, force les utilisateurs à "Forcer le post" (override), polluant l'historique avec des justifications inutiles.
