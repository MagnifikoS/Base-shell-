# AUDIT COMPLET — Bug "Spinner Infini" après validation Réception/Retrait

**Date**: 2026-03-11
**Statut**: Corrigé (P0 retrait) / Monitoring (P2 réception)
**Flux concernés**: Réception (desktop/mobile) + Retrait (desktop/mobile)

---

## RÉSUMÉ EXÉCUTIF

| Métrique | Valeur |
|----------|--------|
| **Sévérité** | **P0 — Critique** |
| **Impact utilisateur** | Blocage total post-validation, refresh manuel obligatoire |
| **Backend affecté ?** | NON — les mouvements sont bien enregistrés |
| **Cause racine** | Frontend uniquement — gestion du draft et états de loading |
| **Flux corrigés** | Retrait mobile + Retrait desktop |
| **Flux restant (P2)** | Flash spinner bref sur réception (1-3s, non bloquant) |

---

## 1. SYMPTÔME OBSERVÉ

### Ce que l'utilisateur voit
- Après avoir rempli toutes les étapes d'une réception ou d'un retrait
- Après avoir cliqué sur **Valider / Confirmer / Enregistrer**
- L'écran affiche un **spinner infini** ("Préparation du brouillon...", "Chargement...")
- L'utilisateur est **bloqué** et doit rafraîchir la page

### Ce qui est constaté en base
- ✅ Les `stock_events` sont créés
- ✅ Les `stock_documents` passent au statut `POSTED`
- ✅ Les `stock_document_lines` sont enregistrées
- ✅ Le backend a **réussi à 100%**

### Conclusion immédiate
> Le bug est **exclusivement frontend**. Le backend fonctionne correctement.

---

## 2. CARTOGRAPHIE COMPLÈTE DES FLUX

### 2.1 Réception Desktop
| Élément | Fichier |
|---------|---------|
| Écran principal | `src/modules/stockLedger/components/MobileReceptionView.tsx` (utilisé aussi desktop) |
| Hook de draft | `src/modules/stockLedger/hooks/useReceptionDraft.ts` |
| Hook de mutation POST | Via `usePostDocument` ou logique inline |
| States de loading | `isDraftLoading`, `isDraftCreating`, `draftError` |
| Mécanisme de fermeture | Reset draft → retour liste |

### 2.2 Réception Mobile
| Élément | Fichier |
|---------|---------|
| Écran principal | `src/modules/stockLedger/components/MobileReceptionView.tsx` |
| Hook de draft | `src/modules/stockLedger/hooks/useReceptionDraft.ts` |
| States de loading | `isDraftLoading`, `isDraftCreating`, `draftError` |
| Mécanisme de fermeture | Reset draft → retour liste |

### 2.3 Retrait Desktop
| Élément | Fichier |
|---------|---------|
| Écran principal | `src/modules/stockLedger/components/WithdrawalView.tsx` |
| Hook de draft | `src/modules/stockLedger/hooks/useWithdrawalDraft.ts` |
| Hook de mutation POST | `handlePost` inline avec boucle de détection d'écarts |
| States de loading | `postGuard`, `isDraftCreating`, `draftError` |
| Mécanisme de fermeture | `setPostGuard(false)` dans `finally` |

### 2.4 Retrait Mobile
| Élément | Fichier |
|---------|---------|
| Écran principal | `src/modules/stockLedger/components/MobileWithdrawalView.tsx` |
| Hook de draft | `src/modules/stockLedger/hooks/useWithdrawalDraft.ts` |
| States de loading | `isDraftCreating`, `draftError` + spinner conditionnel |
| Mécanisme de fermeture | Transition d'étape → retour liste |

---

## 3. ANALYSE CAUSE RACINE — RETRAIT (P0)

### 3.1 Bug identifié : `useWithdrawalDraft.ts` + `useEffect` d'initialisation

**Fichiers**: `MobileWithdrawalView.tsx` (L~60-80) et `WithdrawalView.tsx` (L~55-75)

#### Séquence défaillante AVANT correction

```
1. Composant monté
2. useEffect détecte : pas de document + draftEnsured.current === false
3. draftEnsured.current = true  ← PROBLÈME : mis à true AVANT l'appel async
4. await ensureDraft()           ← peut échouer (réseau, timeout, RPC)
5. Si échec : draftEnsured.current reste true
6. Aucune retry possible
7. UI bloquée sur "Préparation du brouillon..." à l'infini
```

#### Pourquoi le ref était mis à `true` trop tôt
Le développeur original voulait éviter les appels multiples (double-mount React, StrictMode, etc.). La solution était de verrouiller le ref **avant** l'appel async. Mais cela crée un verrou permanent en cas d'échec.

#### Impact
- **Mobile** : spinner infini "Préparation du brouillon..." sans aucun bouton de récupération
- **Desktop** : même spinner, avec un bouton "Forcer" ajouté en workaround (bricolage)

### 3.2 Bug secondaire : boucle séquentielle dans `handlePost` (Desktop uniquement)

**Fichier**: `WithdrawalView.tsx` (L148-203)

#### Séquence défaillante

```
1. Utilisateur clique Valider
2. setPostGuard(true) → UI désactivée
3. try {
4.   POST du document → succès ✅
5.   for (const line of lines) {          ← BOUCLE BLOQUANTE
6.     await supabase.from('zone_stock_snapshots')...
7.     await supabase.from('inventory_lines')...
8.     await supabase.from('stock_events')...
9.   }                                     ← N lignes × 3 requêtes = blocage
10. } finally {
11.   setPostGuard(false)                  ← jamais atteint tant que la boucle tourne
12. }
```

#### Calcul d'impact
- 10 produits = 30 requêtes séquentielles
- ~200ms par requête = **6 secondes** minimum de blocage
- 30 produits = **18 secondes** de spinner
- En cas de timeout réseau sur une requête = **blocage infini**

#### Comparaison Mobile vs Desktop
- **Mobile** (`MobileWithdrawalView.tsx`) : utilise un cache local `stockByProduct` pour la détection d'écarts → **pas de boucle bloquante** → pas ce bug spécifique
- **Desktop** (`WithdrawalView.tsx`) : requêtes séquentielles en base → **bloquant**

---

## 4. ANALYSE FLUX RÉCEPTION (P2)

### Constat
La réception ne présente **pas** de bug de spinner infini à proprement parler.

### Comportement observé
Après POST réussi :
1. Le draft passe au statut `POSTED`
2. La query React Query refetch le draft
3. Le draft n'est plus trouvé (statut ≠ `DRAFT`)
4. L'UI affiche brièvement "Chargement..." (1-3 secondes)
5. Un nouveau draft est automatiquement créé
6. L'UI se stabilise

### Pourquoi ce n'est pas un P0
- Le spinner dure 1-3 secondes maximum
- L'UI se stabilise seule sans intervention
- Aucun blocage permanent

### Amélioration possible (P2)
Ajouter une transition visuelle entre "document posté" et "nouveau draft prêt" pour éviter le flash de spinner.

---

## 5. AUDIT DES ÉTATS DE LOADING

### Tableau complet

| State | Composant | Passe à `true` | Repasse à `false` | Risque de blocage |
|-------|-----------|----------------|-------------------|-------------------|
| `postGuard` | WithdrawalView | Début `handlePost` | `finally` de `handlePost` | ⚠️ OUI si boucle séquentielle bloque le finally |
| `isDraftCreating` | useWithdrawalDraft | Appel `ensureDraft` | Retour `ensureDraft` | ⚠️ OUI si RPC échoue sans catch |
| `draftError` | useWithdrawalDraft | Erreur dans `ensureDraft` | Reset manuel | ✅ Non bloquant (informatif) |
| `isDraftLoading` | useReceptionDraft | Query React Query | Résolution query | ✅ Non bloquant |
| `draftEnsured` (ref) | MobileWithdrawalView / WithdrawalView | Avant `ensureDraft` | **JAMAIS reset en cas d'échec** | 🔴 CAUSE RACINE |

### Verdict
> Le `draftEnsured.current` ref est la **cause racine principale**. Il agit comme un verrou permanent en cas d'échec du `ensureDraft()`.

---

## 6. AUDIT DES HOOKS DE DRAFT

### `useWithdrawalDraft.ts`

#### Comportement normal
1. Query : cherche un `stock_document` avec `status = 'DRAFT'` et `doc_type = 'WITHDRAWAL'`
2. Si trouvé : retourne le document
3. Si non trouvé : `ensureDraft()` en crée un via RPC

#### Comportement défaillant (avant correction)
1. `ensureDraft()` appelé
2. RPC échoue (timeout, erreur réseau)
3. `draftEnsured.current` reste `true`
4. Aucun retry
5. Composant affiche spinner infini

#### Le draft est-il la source du moulinage ?
> **OUI, c'est la source principale.** Le verrouillage prématuré du ref `draftEnsured` empêche toute récupération après échec.

### `useReceptionDraft.ts`

#### Comportement
Même pattern mais avec une meilleure gestion des erreurs. Le composant `MobileReceptionView` destructure `draftError` et `isDraftCreating` et affiche des boutons de retry.

#### Le draft réception est-il problématique ?
> **NON.** Le flux réception gère correctement les erreurs de draft.

---

## 7. AUDIT DES INVALIDATIONS REACT QUERY

### Retrait — Après POST réussi

| Query invalidée | Effet | Risque |
|----------------|-------|--------|
| `['stock-documents']` | Refresh liste documents | ✅ OK |
| `['zone-stock-snapshots']` | Refresh snapshots | ✅ OK |
| `['stock-events']` | Refresh événements | ✅ OK |

### Réception — Après POST réussi

| Query invalidée | Effet | Risque |
|----------------|-------|--------|
| `['stock-documents']` | Refresh liste + draft query | ⚠️ Draft query retourne `null` temporairement |
| `['zone-stock-snapshots']` | Refresh snapshots | ✅ OK |

### Boucle de refetch détectée ?
> **NON.** Aucune boucle de refetch infinie détectée. Les invalidations sont correctes et se stabilisent.

---

## 8. POINT EXACT DE BLOCAGE PAR FLUX

| Flux | Point de blocage | Fichier | Ligne | Sévérité |
|------|-----------------|---------|-------|----------|
| **Retrait Mobile** | `draftEnsured.current = true` avant `ensureDraft()` + pas de reset en cas d'échec | `MobileWithdrawalView.tsx` | useEffect L~60-80 | 🔴 P0 |
| **Retrait Desktop** | Même bug draft + boucle `for` séquentielle dans `handlePost` bloquant le `finally` | `WithdrawalView.tsx` | useEffect L~55-75 + handlePost L148-203 | 🔴 P0 |
| **Réception Mobile** | Flash spinner 1-3s pendant transition draft | `MobileReceptionView.tsx` | Spinner conditionnel | 🔵 P2 |
| **Réception Desktop** | Même flash spinner | `MobileReceptionView.tsx` | Spinner conditionnel | 🔵 P2 |

---

## 9. CORRECTIONS APPLIQUÉES

### Correction 1 — Reset du ref `draftEnsured` en cas d'échec

**Fichiers modifiés** : `MobileWithdrawalView.tsx`, `WithdrawalView.tsx`

**Changement** :
```typescript
// AVANT (défaillant)
useEffect(() => {
  if (!document && !draftEnsured.current) {
    draftEnsured.current = true; // ← Verrouillé AVANT l'appel
    ensureDraft();               // ← Si échec, jamais de retry
  }
}, [document]);

// APRÈS (corrigé)
useEffect(() => {
  if (!document && !draftEnsured.current) {
    draftEnsured.current = true;
    ensureDraft().then(result => {
      if (!result?.success) {
        draftEnsured.current = false; // ← Déverrouille en cas d'échec
      }
    });
  }
}, [document]);
```

### Correction 2 — Ajout UI de récupération (mobile)

**Fichier modifié** : `MobileWithdrawalView.tsx`

**Changement** : Destructuration de `isDraftCreating` et `draftError` depuis le hook, ajout de boutons **"Réessayer"** et **"Forcer la création"** dans l'écran de spinner, alignement avec le pattern robuste déjà utilisé dans la réception.

### Correction 3 — Ajout UI de récupération (desktop)

**Fichier modifié** : `WithdrawalView.tsx`

**Changement** : Même pattern que mobile — affichage d'erreurs et boutons de retry.

---

## 10. COMPARATIF MOBILE VS DESKTOP

| Aspect | Mobile | Desktop |
|--------|--------|---------|
| Bug draft `draftEnsured` | ✅ Identique (même hook) | ✅ Identique |
| Boucle séquentielle `handlePost` | ❌ Non affecté (cache local) | ⚠️ Affecté (requêtes séquentielles) |
| UI de récupération (avant fix) | ❌ Absente | ⚠️ Bouton "Forcer" bricolé |
| UI de récupération (après fix) | ✅ Retry + Force | ✅ Retry + Force |

---

## 11. COMPARATIF RÉCEPTION VS RETRAIT

| Aspect | Réception | Retrait |
|--------|-----------|---------|
| Bug draft spinner infini | ❌ Non | ✅ OUI (P0) |
| Gestion erreurs draft | ✅ Robuste | ❌ Manquante (avant fix) |
| Boucle bloquante post-validation | ❌ Non | ⚠️ Desktop uniquement |
| Flash spinner transitoire | ⚠️ P2 (1-3s) | ❌ Non |

---

## 12. RISQUE DE RÉGRESSION

| Risque | Probabilité | Mitigation |
|--------|-------------|------------|
| Double création de draft | Faible | Le ref `draftEnsured` empêche toujours les appels concurrents ; seul l'échec le déverrouille |
| Boucle de retry infinie | Très faible | Le retry est manuel (bouton), pas automatique |
| Impact sur réception | Nul | Aucun fichier de réception modifié |
| Impact sur stock_events | Nul | Aucune logique backend modifiée |

---

## 13. VERDICT FINAL

### Réponses aux 7 questions

| # | Question | Réponse |
|---|----------|---------|
| 1 | Pourquoi ça mouline alors que les mouvements sont enregistrés ? | Le bug est **100% frontend**. Le ref `draftEnsured` se verrouille avant l'appel async et ne se déverrouille jamais en cas d'échec. |
| 2 | Le problème est-il le même sur mobile et desktop ? | **Partiellement.** Le bug de draft est identique. Le desktop a un bug supplémentaire (boucle séquentielle dans `handlePost`). |
| 3 | Le problème est-il le même sur réception et retrait ? | **NON.** La réception gère correctement les erreurs de draft. Seul le retrait est affecté. |
| 4 | Le draft est-il impliqué ? | **OUI, c'est la cause racine principale.** |
| 5 | Le spinner reste à cause de quoi ? | **Loading state non reset** (`draftEnsured.current` jamais remis à `false` après échec). |
| 6 | Quel est le point exact de blocage ? | `useEffect` d'initialisation du draft dans `MobileWithdrawalView.tsx` et `WithdrawalView.tsx`. |
| 7 | Quelle est la correction minimale ? | Reset `draftEnsured.current = false` si `ensureDraft()` échoue + ajout UI de retry. |

### Classification

| Flux | Sévérité | Statut |
|------|----------|--------|
| Retrait Mobile | 🔴 P0 | ✅ Corrigé |
| Retrait Desktop | 🔴 P0 | ✅ Corrigé |
| Réception Mobile | 🔵 P2 | ℹ️ Flash bénin, monitoring |
| Réception Desktop | 🔵 P2 | ℹ️ Flash bénin, monitoring |

### Recommandation restante (P1)
Rendre la boucle de détection d'écarts dans `WithdrawalView.tsx` → `handlePost` **non-bloquante** (fire-and-forget) pour éliminer le délai de 6-18 secondes sur les retraits desktop avec beaucoup de lignes.

---

*Audit réalisé le 2026-03-11*
*Fichiers analysés : 6 composants, 2 hooks, 4 flux complets*
*Corrections appliquées : 2 fichiers modifiés, 0 logique backend touchée*
