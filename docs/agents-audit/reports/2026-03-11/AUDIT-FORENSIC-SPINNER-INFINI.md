# AUDIT FORENSIC — Spinner infini après validation (Réception / Retrait)

**Date :** 2026-03-11  
**Statut :** Diagnostic complet — aucune modification de code  
**Scope :** 4 flux (Réception Mobile, Réception Desktop, Retrait Mobile, Retrait Desktop)

---

## Résumé exécutif

Le spinner infini après validation est un **bug réel** présent sur le **retrait uniquement** (mobile ET desktop). La réception n'est **pas affectée**.

**Cause racine unique :** Après POST, le document passe de `DRAFT` → `POSTED`. La query React Query refetche et retourne `null`. Le composant affiche le spinner car `document === null`. Mais le verrou `draftEnsured.current` reste à `true`, **bloquant la recréation automatique d'un nouveau draft**. Le spinner reste affiché indéfiniment.

Le bouton "Forcer la création" **contourne ce bug** en réinitialisant manuellement `draftEnsured.current = false`.

---

## Section 1 — Réception Mobile

### Composants impliqués
- `MobileReceptionView.tsx` — écran principal
- `useReceiptDraft` — hook de draft
- `usePostDocument` — mutation POST
- `BlAppPostPopup` — popup BL post-réception

### Flux après validation
1. `handlePostForPopup()` L425 → `post()` → backend OK
2. `hasCompletedRef.current = true` L439
3. `postGuard = false` L457 (finally)
4. `usePostDocument.onSuccess` invalide `["stock-document-draft"]`
5. `useReceiptDraft.docQuery` refetche → `null` (document est POSTED)
6. L'écran revient à la **liste des fournisseurs** (L532: `if (!selectedSupplierId)`)
7. Le draft sera recréé au prochain `handleSupplierSelect()` L249

### Verdict : ✅ PAS DE SPINNER INFINI
La réception mobile retourne au choix du fournisseur, pas à un spinner. Le draft est recréé au prochain choix.

---

## Section 2 — Réception Desktop

### Composants impliqués
- `ReceptionView.tsx` — écran principal
- `useReceiptDraft` — hook de draft
- `usePostDocument` — mutation POST
- `BlAppPostPopup` — popup BL

### Flux après validation
1. `handlePost()` L269 → `post()` → backend OK
2. **L297 : `hasEnsuredDraft.current = false`** ← RESET EXPLICITE
3. `postGuard = false` L332 (finally)
4. Query draft invalide → `document = null`
5. `useEffect` détecte `!document && !hasEnsuredDraft.current` → recréation auto du draft
6. Popup BL s'ouvre (L304)

### Verdict : ✅ PAS DE SPINNER INFINI
Grâce au reset explicite `hasEnsuredDraft.current = false` à L297.

---

## Section 3 — Retrait Mobile

### Composants impliqués
- `MobileWithdrawalView.tsx` — écran principal
- `useWithdrawalDraft` — hook de draft
- `usePostDocument` — mutation POST
- `BlRetraitPostPopup` — popup BL retrait

### Flux après validation — TRACE COMPLÈTE
1. Clic "Valider retrait" → `onValidate` dans `MobileCartDrawer` L764
2. Si `isInternalOnly` → `handlePost(false)` directement L767
3. Sinon → `setShowBlRetraitPopup(true)` L778 → popup → `onPostInternal` → `handlePost(false)` L793
4. `handlePost()` L358 :
   - `setPostGuard(true)` L361
   - `post()` L364 → backend OK
   - `toast.success()` L373
   - `setLastPostedDocumentId(capturedDocId)` L383
   - `setShowPostConfirm(false)` L384
   - Discrepancy detection fire-and-forget L388-410
   - `return true` L412
5. `finally` L429 : `setPostGuard(false)`
6. **`usePostDocument.onSuccess`** L172-181 invalide :
   - `["stock-document-draft"]` ← CRITIQUE
   - `["stock-document-lines"]`
   - `["stock-documents-posted"]`
   - `["desktop-stock"]`, `["estimated-stock"]`, `["stock-alerts"]`

7. **`useWithdrawalDraft.docQuery`** refetche :
   - Query : `status = "DRAFT"` → le document est maintenant `POSTED` → **retourne `null`**

8. **`document` devient `null` dans le composant**

9. **Rendu L518 : `isLoading || !document`** → entre dans la branche spinner

10. **`useEffect` L149-162** vérifie :
    ```
    !isLoading && !document && defaultZoneId && !draftEnsured.current
    ```
    - `!isLoading` = true ✅
    - `!document` = true ✅
    - `defaultZoneId` = true ✅
    - `!draftEnsured.current` = **FALSE** ❌ ← BLOQUÉ ICI

11. **`draftEnsured.current` a été mis à `true` au montage initial (L151) et JAMAIS RESET après POST**

12. **RÉSULTAT : Spinner permanent. Le composant attend un document qui ne viendra jamais.**

### Ligne responsable
**`MobileWithdrawalView.tsx` L151** : `draftEnsured.current = true` — mis une seule fois, jamais reset après POST succès.

**Comparaison avec la réception desktop** : `ReceptionView.tsx` L297 fait `hasEnsuredDraft.current = false` après POST — **ce reset manque dans le retrait**.

### Verdict : ❌ SPINNER INFINI CONFIRMÉ

---

## Section 4 — Retrait Desktop

### Composants impliqués
- `WithdrawalView.tsx` — écran principal
- `useWithdrawalDraft` — hook de draft (partagé avec mobile)
- `usePostDocument` — mutation POST

### Flux après validation
Identique au mobile sauf :
1. **PROBLÈME ADDITIONNEL L152-206** : Boucle de détection d'écarts avec `await` séquentiel :
   - 3 requêtes Supabase par ligne (snapshots, inventory_lines, stock_events)
   - Exécutée DANS le `try` → BLOQUE le `finally` tant que les queries tournent
   - Sur 5 produits = ~15 queries séquentielles = 6-18 secondes de gel
   - MAIS ce n'est PAS la cause du spinner infini, juste un gel temporaire

2. **Même bug que mobile** : `draftEnsured.current` jamais reset après POST
3. L'useEffect L97-110 a la même condition bloquée

### Lignes responsables
- **L99** : `draftEnsured.current = true` — jamais reset après POST
- **L152-206** : Boucle séquentielle bloquante (aggravant, pas cause racine)

### Verdict : ❌ SPINNER INFINI CONFIRMÉ (+ gel temporaire par discrepancy loop)

---

## Section 5 — Hooks de draft

### useWithdrawalDraft (`useWithdrawalDraft.ts`)
- `ensureDraft()` : fonctionne correctement (find-or-create, abandon stale, finally)
- `isDraftCreating` : correctement géré (set true L81, set false L165 finally)
- `draftError` : correctement géré
- **Aucun bug dans le hook lui-même**
- Le bug est dans les **composants consommateurs** qui ne reset pas `draftEnsured.current`

### useReceiptDraft (`useReceiptDraft.ts`)
- Même structure que useWithdrawalDraft
- **Aucun bug**

### Verdict
Les hooks de draft sont **innocents**. Le bug est dans la gestion du ref `draftEnsured` dans les composants.

---

## Section 6 — États de loading

| State | Composant | Mis à `true` | Remis à `false` | Peut rester bloqué ? |
|-------|-----------|-------------|-----------------|---------------------|
| `postGuard` | MobileWithdrawalView | L361 handlePost | L430 finally | ❌ Non (finally garanti) |
| `postGuard` | WithdrawalView | L124 handlePost | L225 finally | ❌ Non (finally garanti) |
| `isPosting` | usePostDocument | useMutation auto | useMutation auto | ❌ Non |
| `isLoading` | useWithdrawalDraft | React Query auto | React Query auto | ❌ Non |
| `isDraftCreating` | useWithdrawalDraft | L81 ensureDraft | L165 finally | ❌ Non |
| `draftEnsured.current` | MobileWithdrawalView | L151 useEffect | **JAMAIS après POST** | ✅ **OUI — CAUSE RACINE** |
| `draftEnsured.current` | WithdrawalView | L99 useEffect | **JAMAIS après POST** | ✅ **OUI — CAUSE RACINE** |
| `hasEnsuredDraft.current` | ReceptionView | L144 | L297 après POST ✅ | ❌ Non |

---

## Section 7 — Invalidations React Query

### Après POST succès (`usePostDocument.onSuccess` L172-181)

| Query Key invalidée | Effet | Problème ? |
|---------------------|-------|-----------|
| `["stock-document-draft"]` | docQuery refetche → null (document POSTED) | ✅ **Déclenche le bug** (document=null → spinner) |
| `["stock-document-lines"]` | lines refetche → [] (document plus en DRAFT) | Non |
| `["stock-documents-posted"]` | Liste des docs postés se met à jour | Non |
| `["desktop-stock"]` | Stock desktop refresh | Non |
| `["estimated-stock"]` | Stock estimé refresh | Non |
| `["stock-alerts"]` | Alertes refresh | Non |

### Boucle de refetch ?
Non. L'invalidation de `["stock-document-draft"]` fait UN seul refetch qui retourne `null`. Pas de boucle.
Le spinner vient du fait que `null` est l'état stable final (pas de recréation car draftEnsured bloqué).

---

## Section 8 — Erreurs silencieuses

| Localisation | Type | Impact |
|-------------|------|--------|
| WithdrawalView L204 | `.catch(() => {})` sur detectDiscrepancy | Aucun (fire-and-forget intentionnel) |
| MobileWithdrawalView L407 | `.catch(() => {})` sur detectDiscrepancy | Aucun (fire-and-forget intentionnel) |

**Aucune erreur silencieuse ne contribue au spinner infini.** Le problème est purement un ref non-reset.

---

## Section 9 — Comparatif Mobile / Desktop

| Flux | Spinner infini ? | Cause | Commune ? |
|------|-----------------|-------|-----------|
| Réception mobile | ❌ Non | Retour au choix fournisseur | — |
| Réception desktop | ❌ Non | Reset explicite `hasEnsuredDraft.current = false` L297 | — |
| **Retrait mobile** | **✅ OUI** | `draftEnsured.current` jamais reset après POST | **OUI — même cause** |
| **Retrait desktop** | **✅ OUI** | `draftEnsured.current` jamais reset après POST + boucle await bloquante | **OUI — même cause** + aggravant |

---

## Section 10 — Cause(s) racine(s) exacte(s)

### Cause racine unique (P0)

**Fichiers :**
- `src/modules/stockLedger/components/MobileWithdrawalView.tsx`
- `src/modules/stockLedger/components/WithdrawalView.tsx`

**Mécanisme :**
1. `draftEnsured.current = true` est posé au montage initial
2. Après POST succès, `usePostDocument` invalide la query draft
3. La query retourne `null` (le document n'est plus en DRAFT)
4. Le composant affiche le spinner (`!document`)
5. Le `useEffect` de recréation auto ne se déclenche PAS car `draftEnsured.current === true`
6. Aucun code dans `handlePost()` ne reset ce ref à `false`
7. **Spinner permanent.**

**Preuve par comparaison :** `ReceptionView.tsx` fait exactement le même flux MAIS ajoute `hasEnsuredDraft.current = false` à L297. C'est cette unique ligne qui empêche le bug en réception desktop.

### Aggravant (P1) — Retrait Desktop uniquement

**Fichier :** `WithdrawalView.tsx` L152-206

La boucle de détection d'écarts utilise `await` séquentiellement dans le `try` block, ce qui retarde le `finally` de 6-18 secondes selon le nombre de lignes. Ce n'est pas la cause du spinner infini mais ajoute un gel visible avant même le problème principal.

---

## Section 11 — Ligne(s) responsable(s)

| Fichier | Ligne | Code | Problème |
|---------|-------|------|----------|
| `MobileWithdrawalView.tsx` | **151** | `draftEnsured.current = true;` | Jamais reset à false après POST |
| `WithdrawalView.tsx` | **99** | `draftEnsured.current = true;` | Jamais reset à false après POST |
| `ReceptionView.tsx` | **297** | `hasEnsuredDraft.current = false;` | ✅ Le fix qui manque dans les 2 fichiers retrait |

---

## Section 12 — Correction minimale recommandée

### Fix P0 (1 ligne par fichier, 2 fichiers)

**MobileWithdrawalView.tsx** — dans `handlePost()`, après `result.ok` et avant `return true` (vers L385) :
```typescript
draftEnsured.current = false;
```

**WithdrawalView.tsx** — dans `handlePost()`, après `result.ok` (vers L148) :
```typescript
draftEnsured.current = false;
```

C'est exactement ce que fait `ReceptionView.tsx` L297.

### Fix P1 (optionnel mais recommandé)

**WithdrawalView.tsx** L152-206 — rendre la boucle de détection d'écarts non-bloquante :
```typescript
// Avant (bloquant) :
for (const line of lines) {
  const { data: snapshots } = await supabase...
  // ...
}

// Après (fire-and-forget) :
(async () => {
  for (const line of lines) { ... }
})().catch(() => {});
```

---

## Section 13 — Risque de régression

| Action | Risque |
|--------|--------|
| Ajouter `draftEnsured.current = false` après POST | **Aucun** — même pattern que la réception. La recréation auto du draft se déclenchera normalement via useEffect. |
| Rendre la boucle discrepancy non-bloquante | **Très faible** — les détections sont déjà fire-and-forget (.catch(() => {})). Les rendre async ne change pas le résultat. |

---

## Réponses aux questions obligatoires

| Question | Réponse |
|----------|---------|
| Pourquoi l'UI mouline alors que le backend a réussi ? | Parce que le document passe de DRAFT→POSTED, la query retourne null, mais le ref `draftEnsured` bloque la recréation du prochain draft. |
| Est-ce le même bug sur réception et retrait ? | **Non.** La réception reset le ref après POST. Le retrait ne le fait pas. |
| Est-ce le même bug sur mobile et desktop ? | **Oui**, exactement la même cause pour les deux retraits. |
| `ensureDraft()` est-il responsable ? | **Non.** ensureDraft fonctionne parfaitement. C'est le ref qui l'empêche d'être appelé. |
| Un state de loading reste-t-il coincé ? | **Non** — postGuard, isPosting, isDraftCreating sont tous correctement reset. Le "spinner" vient de `!document` (rendu conditionnel), pas d'un state loading. |
| Une query draft boucle-t-elle ? | **Non.** La query retourne `null` une seule fois et se stabilise. C'est l'absence de recréation qui bloque. |
| Le bouton "Forcer la création" contourne-t-il un vrai bug ? | **Oui.** Il fait `draftEnsured.current = false; ensureDraft()` — exactement le fix manquant. |
| Quelle est la vraie correction ? | Ajouter `draftEnsured.current = false` dans handlePost() après `result.ok`, dans MobileWithdrawalView.tsx et WithdrawalView.tsx. |
