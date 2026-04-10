# AUDIT PLANNING — ÉTAPE 0 : Simulation & Diagnostic de Latence

> **Date** : 2026-03-07  
> **Environnement** : Preview Lovable (https://id-preview--5decb376-...)  
> **Compte** : hicham@labaja.fr (admin)  
> **Établissement** : NONNA SECRET  
> **Employés testés** : karim A, Salim A  
> **Méthode** : Navigation réelle + capture réseau + lecture de code  
> **Statut** : AUCUNE MODIFICATION DE CODE

---

## SECTION 1 — RÉSUMÉ EXÉCUTIF

### État global de fluidité : 🔴 INSUFFISANT

| Critère | Note | Commentaire |
|---------|------|-------------|
| Ouverture planning | 🔴 3-4s | Edge function `planning-week` = 3.5-3.8s (cold start + rextra all-time) |
| Navigation semaine | 🟠 2.3-3.3s | Prefetch aide mais chaque call reste >2s |
| Création shift | 🟠 ~1.5-2s estimé | RBAC séquentiel + validations multiples |
| Modification shift | 🟠 ~1.5-2s estimé | Idem + badge overlap check |
| Suppression shift | 🟡 ~1s estimé | Plus léger mais supprime badge_events physiquement |
| Copie semaine | 🔴 3-5s estimé | RBAC redondant + per-employee séquentiel côté UI |
| Sensation premium | 🔴 Non atteinte | Trop de latence perçue sur chaque action |

### Top 5 des problèmes qui cassent l'effet premium

1. **`rextraBalance` : 4 requêtes ALL-TIME sans filtre de date** → cause principale du 3-4s par `get_week`
2. **3 appels `planning-week` simultanés** (current + prefetch ±1) → 3× la charge serveur à chaque navigation
3. **RBAC dupliqué** : chaque mutation re-exécute `has_module_access` + `get_my_permissions_v2` + `get_user_organization_id` (3 RPC séquentiels ~150ms chacun)
4. **Employés sans équipe invisibles** : karim A et Salim A sont actifs mais n'apparaissent dans aucune vue planning (team_id = null)
5. **Copie semaine per-employee** : le frontend appelle N fois `copy_previous_week` au lieu d'un bulk atomique

---

## SECTION 2 — MÉTHODE DE SIMULATION

| Paramètre | Valeur |
|-----------|--------|
| Environnement | Preview Lovable (sandbox browser) |
| Navigateur | Chromium headless (automation) |
| Réseau | Serveur Lovable → Edge Functions Supabase |
| Données | Production réelle (NONNA SECRET, 2 employés actifs) |
| Limites | Pas de drag & drop testable (automation limitation) ; pas de création de shift testable car 0 employés visibles dans la grille |
| Répétitions | Navigation semaine testée 2×, ouverture testée 2× (dashboard → planning, retour → planning) |
| Mesures | Durées réseau exactes (browser DevTools), ressenti estimé |

### Niveau de confiance par scénario

| Scénario | Confiance | Raison |
|----------|-----------|--------|
| Ouverture | ✅ Haute | Mesuré 2× avec network requests |
| Navigation semaine | ✅ Haute | Mesuré 2× |
| Création shift | 🟡 Moyenne | Analysé via code, pas simulé (0 employés visibles) |
| Modification shift | 🟡 Moyenne | Analysé via code |
| Drag & drop | 🟡 Moyenne | Analysé via code (update_shift avec new_shift_date) |
| Suppression shift | 🟡 Moyenne | Analysé via code |
| Copie semaine | 🟠 Inférée | Code analysé en profondeur, pas de simulation live |
| Rafraîchissements | ✅ Haute | Observé via realtime channels + invalidation code |

---

## SECTION 3 — PARCOURS OBSERVÉS

### Parcours 1 : Login → Dashboard → Planning
1. Login (hicham@labaja.fr) → Dashboard en ~4s
2. Clic "RH" sidebar → submenu apparaît
3. Clic "Planning" → Page d'entrée (sélection département)
4. Clic "Planning général" ou "Cuisine" → Grille planning

### Parcours 2 : Navigation semaine
1. Clic ">" (semaine suivante) → rechargement complet
2. Clic "<" (semaine précédente) → rechargement complet

### Observation critique
- **karim A** et **Salim A** sont actifs (statut "Actif" dans Salariés) mais ont Équipe = "---"
- Le planning affiche "Aucun salarié actif dans cet établissement" dans TOUTES les vues
- **Aucun scénario de création/édition de shift n'est possible** sans affecter un employé à une équipe

---

## SECTION 4 — MESURES GLOBALES

| Action | Premier affichage utile | Interaction possible | Stabilisation totale | Fluidité perçue | Gravité |
|--------|------------------------|---------------------|---------------------|-----------------|---------|
| Login → Dashboard | ~3.8s | ~4s | ~4.5s | 🟠 Acceptable | Moyenne |
| Dashboard → Planning (entry page) | <100ms | <100ms | ~3.7s (background) | ✅ Bon | Faible |
| Planning entry → Grille (1er chargement) | ~3.5s | ~3.5s | ~3.5s + prefetch 2×3s | 🔴 Lent | **Critique** |
| Navigation semaine (→) | ~2.3-3.3s | ~3.3s | ~3.3s + prefetch | 🔴 Lent | **Critique** |
| Création shift | ~1.5-2s (estimé) | ~2s | ~2s + refetch ~3s | 🟠 Moyen | Haute |
| Modification shift | ~1.5-2s (estimé) | ~2s | ~2s + refetch ~3s | 🟠 Moyen | Haute |
| Suppression shift | ~1s (estimé) | ~1s | ~1s + refetch ~3s | 🟡 Acceptable | Moyenne |
| Copie semaine (N employés) | N × ~2s (estimé) | N × 2s | + refetch ~3s | 🔴 Très lent | **Critique** |

---

## SECTION 5 — ANALYSE DÉTAILLÉE PAR ACTION

### 5.1 — OUVERTURE DU PLANNING

#### Niveau A — Ressenti utilisateur
- La page d'entrée (tuiles Cuisine/Salle/Plonge/Pizza) s'affiche **instantanément** ✅
- Mais en arrière-plan, 3 appels `planning-week` sont déjà lancés (~3.5-3.8s chacun)
- Après clic sur un département → la grille met **3-4s** à apparaître
- L'utilisateur voit un skeleton pendant 3-4s → sensation de lenteur

#### Niveau B — Enchaînement réel (OBSERVÉ)

| Étape | Durée | Type |
|-------|-------|------|
| 1. Navigation vers /planning | <50ms | Client |
| 2. Rendu page d'entrée (tuiles) | <50ms | Client |
| 3. `usePlanningWeek` → appel `planning-week` (current week) | 3846ms | Réseau |
| 4. `usePrefetchAdjacentWeeks` → appel `planning-week` (week -1) | 3724ms | Réseau parallèle |
| 5. `usePrefetchAdjacentWeeks` → appel `planning-week` (week +1) | 3497ms | Réseau parallèle |
| 6. `personnel_leaves` query | 247ms | Réseau parallèle |
| 7. `get_service_day_now` RPC | 286ms | Réseau |
| 8. `platform_impersonations` check | 304ms | Réseau |
| 9. `establishments` service_day query | 222ms | Réseau |
| 10. `planning_shifts` direct query | 225ms | Réseau |

#### Niveau C — Mesures temps
- **Temps total avant grille visible** : 3846ms (bloqué par planning-week)
- **Part bloquante** : `planning-week` edge function = 100% du chemin critique
- **Part non-bloquante** : prefetch ±1 semaine (parallèle, pas d'impact UI)

#### Niveau D — Tri nécessaire / non nécessaire

| Sous-tâche | Verdict | Justification |
|-----------|---------|---------------|
| `get_week` current | ✅ Indispensable | Données de la grille |
| Prefetch week -1 | 🟡 Utile mais différable | Anticipation navigation |
| Prefetch week +1 | 🟡 Utile mais différable | Anticipation navigation |
| `rextraBalance` (ALL-TIME) | 🔴 Différable | Pas nécessaire pour afficher la grille |
| `personnel_leaves` | 🟡 Utile mais différable | Affiché dans la grille mais pas critique |
| RBAC checks (3 RPC) | ✅ Indispensable | Sécurité |
| Day parts | ✅ Indispensable | Structure grille |
| Opening hours | ✅ Indispensable | Validation horaires |
| `planning_weeks` (validation state) | ✅ Indispensable | UI validé/non validé |

#### Niveau E — Impact fluidité : 🔴 CRITIQUE
- La cause #1 est `rextraBalance` → 4 requêtes ALL-TIME sans filtre date dans `get_week`

---

### 5.2 — NAVIGATION SEMAINE (← →)

#### Niveau A — Ressenti utilisateur
- Clic ">" → **2.3-3.3s** avant mise à jour de la grille
- Grâce au `placeholderData: (prev) => prev`, la grille précédente reste visible pendant le chargement ✅
- Mais l'indicateur `isFetching` montre un spinner/loading state

#### Niveau B — Enchaînement réel (OBSERVÉ)

| Étape | Durée | Remarque |
|-------|-------|----------|
| 1. `setWeekStart(newWeek)` | <1ms | State local |
| 2. `usePlanningWeek` query key change | <1ms | React Query |
| 3. `planning-week` edge function (new week) | 2310-3266ms | Réseau |
| 4. Prefetch week -1 | 2677ms | Parallèle |
| 5. Prefetch week +1 | 2981ms | Parallèle |
| 6. `personnel_leaves` refresh | 227ms | Parallèle |
| 7. UI re-render | <50ms | Client |

#### Niveau C — Mesures
- Navigation aller (→) : **3266ms** mesuré
- Navigation retour (←) : **2310ms** (plus rapide car edge function warm)
- Prefetch semaine N-1 lors du premier affichage accélère le retour à ~200ms si cache encore frais (staleTime 30s)

#### Niveau D — Tri

| Sous-tâche | Verdict |
|-----------|---------|
| `planning-week` new week | ✅ Indispensable |
| Prefetch ±1 | 🟡 Utile mais ajoute 2× la charge serveur |
| `rextraBalance` dans chaque call | 🔴 Différable |
| `personnel_leaves` refetch | 🟡 Pourrait être lazy |

#### Niveau E — Impact : 🔴 CRITIQUE

---

### 5.3 — CRÉATION DE SHIFT

#### Niveau A — Ressenti estimé
- Ouverture modale/formulaire : instantané
- Validation + sauvegarde : ~1.5-2s estimé
- Après sauvegarde : refetch complet de la semaine (~3s)

#### Niveau B — Enchaînement (ANALYSÉ VIA CODE)

| Étape | Durée estimée | Source |
|-------|--------------|--------|
| 1. RBAC `has_module_access` | ~150ms | `createShift.ts` L112 |
| 2. `get_planning_permission` (scope) | ~100ms | L121 (cached via ctx) |
| 3. Team scope check (si team) | ~100ms | L138 |
| 4. Parallel: orgId + establishment + userEst + profile + dayParts + breakPolicy | ~200ms | L152 (6 queries parallel) |
| 5. Opening window + existing shifts overlap | ~150ms | L203 (2 queries parallel) |
| 6. Badge overlap check | ~100ms | L244 |
| 7. Break calculation (CPU) | <1ms | L258 |
| 8. Atomic insert RPC | ~100ms | L261 |
| 9. **Total edge function** | **~800-1200ms** | Somme séquentielle |
| 10. Realtime → `invalidatePlanning` | ~100ms | Realtime channel |
| 11. Refetch `planning-week` | ~2500-3500ms | Rechargement complet |

#### Niveau D — Tri

| Sous-tâche | Verdict |
|-----------|---------|
| RBAC check | ✅ Indispensable mais dupliqué à chaque mutation |
| Scope check | ✅ Indispensable mais redondant avec RBAC |
| Overlap check (shifts) | ✅ Indispensable |
| Badge overlap check | ✅ Indispensable |
| Break calculation | ✅ Indispensable |
| Full week refetch after create | 🔴 Excessif — un optimistic update + patch suffirait |

#### Niveau E — Impact : 🟠 FORT

---

### 5.4 — MODIFICATION DE SHIFT

Même structure que création. Différences notables :
- `updateShift.ts` : RBAC séquentiel (3 RPC) au lieu du `RequestContext` parallelisé de `createShift`
- **OBSERVÉ** : `has_module_access` + `get_my_permissions_v2` + `get_user_organization_id` sont appelés **séquentiellement** (L170-197) → ~450ms de latence RBAC
- Overlap check supplémentaire avec `otherShifts` (max 2 shifts/jour)
- Break policy re-fetched à chaque update (pas cached)

#### Niveau E — Impact : 🟠 FORT

---

### 5.5 — DRAG & DROP

#### Analyse via code (INFÉRÉ)
- `updateShift` supporte `new_shift_date` (L28, L361) → drag to another day
- Même pipeline que modification classique
- **Pas d'optimistic UI** observé → le shift disparaît/réapparaît après le round-trip

#### Niveau E — Impact : 🟠 FORT (si implémenté)

---

### 5.6 — SUPPRESSION DE SHIFT

#### Analyse via code (OBSERVÉ dans `deleteShift.ts`)

| Étape | Durée estimée |
|-------|--------------|
| 1. RBAC (3 RPC séquentiels) | ~450ms |
| 2. Load shift | ~100ms |
| 3. Scope check | ~100ms |
| 4. DELETE shift | ~50ms |
| 5. **DELETE badge_events** (physique!) | ~50ms |
| 6. Realtime → refetch | ~3000ms |

**⚠️ RISQUE CRITIQUE** : `deleteShift.ts` L131-136 supprime physiquement TOUS les `badge_events` pour ce user+date. Perte de données irréversible. Confirmé par l'audit principal.

#### Niveau E — Impact : 🟡 MOYEN (temps) / 🔴 CRITIQUE (données)

---

### 5.7 — COPIE DE LA SEMAINE PRÉCÉDENTE

#### Analyse via code (OBSERVÉ dans `bulkActions.ts` + `CopyWeekBulkModal`)

**Architecture actuelle** :
- Le frontend (`CopyWeekBulkModal`) appelle `copy_previous_week` **par employé** (N appels séquentiels ou parallèles)
- Chaque appel exécute le pipeline complet :

| Étape par employé | Durée estimée |
|-------------------|--------------|
| 1. `validatePlanningWriteAccess` (3 RPC) | ~450ms |
| 2. `getAllowedUserIds` | ~100ms |
| 3. Check planning_weeks validation | ~100ms |
| 4. Fetch source shifts (prev week) | ~100ms |
| 5. Fetch source leaves | ~100ms |
| 6. Fetch target shifts | ~100ms |
| 7. Fetch target leaves | ~100ms |
| 8. Delete existing (if replace) | ~50ms |
| 9. Insert copied shifts | ~50ms |
| 10. Insert copied leaves | ~50ms |
| **Total par employé** | **~1200-1500ms** |

**Pour 2 employés** : ~2.4-3s
**Pour 10 employés** : ~12-15s (série) ou ~3s (parallèle max, mais 10× la charge serveur)

**Après copie** : refetch complet `planning-week` → +3s

#### Problèmes identifiés (OBSERVÉ)

1. **RBAC redondant N fois** : même vérification pour chaque employé
2. **Pas de transaction** : si l'appel échoue au milieu, état incohérent
3. **`break_minutes` et `net_minutes` copiés verbatim** (L596-604) : si la politique de pause a changé, les valeurs sont incorrectes
4. **Pas d'optimistic UI** : l'utilisateur attend la fin de tous les appels

#### Niveau E — Impact : 🔴 CRITIQUE

---

### 5.8 — RAFRAÎCHISSEMENTS APRÈS ACTION

#### Mécanisme (OBSERVÉ dans code)

| Trigger | Ce qui se passe | Impact |
|---------|----------------|--------|
| Mutation `planning_shifts` (insert/update/delete) | Realtime channel `planning_shifts` → `invalidatePlanning()` | Invalide TOUS les query keys `["planning-week", establishmentId, ...]` → refetch |
| Mutation `planning_weeks` (validate) | Realtime channel `planning_weeks` → `invalidatePlanning()` | Idem |
| `invalidatePlanning()` | Invalide aussi `["payroll", "month", ...]` | Refetch payroll en cascade |

**Problème** : chaque mutation unique déclenche un refetch COMPLET de `get_week` (3-4s) au lieu d'un patch local.

---

## SECTION 6 — INVENTAIRE DES TÂCHES DÉCLENCHÉES

| Tâche | Déclencheur | Fréquence | Coût | Indispensable ? | Impact fluidité |
|-------|------------|-----------|------|-----------------|-----------------|
| `planning-week` get_week | Ouverture, navigation, refetch | Très haute | 2.5-4s | ✅ Oui | 🔴 Critique |
| `rextraBalance` (ALL-TIME) | Dans chaque `get_week` | Très haute | ~500-1500ms (estimé) | 🔴 Différable | 🔴 Critique |
| Prefetch week ±1 | Après chaque get_week | Haute | 2× get_week | 🟡 Utile | 🟠 Fort |
| RBAC 3-RPC (`has_module_access` + `get_my_permissions_v2` + `get_user_organization_id`) | Chaque mutation | Haute | ~450ms | ✅ Oui mais factorizable | 🟠 Fort |
| Badge overlap check | create_shift, update_shift | Moyenne | ~100ms | ✅ Oui | 🟡 Faible |
| Break policy fetch | create_shift, update_shift | Moyenne | ~100ms | ✅ Oui mais cacheable | 🟡 Faible |
| `invalidatePlanning` (cascade) | Chaque mutation via realtime | Haute | Déclenche refetch 3-4s | 🔴 Excessif | 🔴 Critique |
| `invalidatePayroll` (cascade) | Chaque mutation planning | Haute | Refetch payroll | 🟠 Différable | 🟡 Faible |
| `personnel_leaves` query | Ouverture + navigation | Haute | ~230ms | ✅ Oui | 🟡 Faible |

---

## SECTION 7 — MATRICE DES CHARGEMENTS ET RECALCULS

| Action utilisateur | Données chargées | Calculs déclenchés | Local/Global | Dépendances | Surcharge ? |
|-------------------|-----------------|-------------------|-------------|-------------|-------------|
| Ouverture planning | teams, user_establishments, day_parts, opening_hours, opening_exceptions, planning_weeks, profiles, user_teams, planning_shifts, rextra_events, **ALL planning_shifts (rextra)**, **ALL extra_events**, **ALL payroll_validations**, **ALL rextra_events** | rextraBalance all-time, net_minutes recalcul, auto-publish check | **Global** | Employee contracts, payroll | 🔴 OUI |
| Navigation semaine | Même que ouverture (tout rechargé) | Idem | **Global** | — | 🔴 OUI |
| Création shift | RBAC ×3, establishment, profile, day_parts, break_policy, opening_window, existing_shifts, badge_events | Break minutes, net minutes, overlap check | Local (1 shift) puis Global (refetch) | Badgeuse | 🟠 Partiel |
| Modification shift | RBAC ×3, shift existant, profile, opening_window, other_shifts, badge_events, break_policy | Idem | Local puis Global | Badgeuse | 🟠 Partiel |
| Suppression shift | RBAC ×3, shift existant | — | Local puis **Global + DELETE badge_events** | Badgeuse ⚠️ | 🔴 OUI |
| Copie semaine | N × (RBAC ×3 + source shifts + target shifts + source leaves + target leaves) | — | N × Local puis Global | — | 🔴 OUI |

---

## SECTION 8 — ANALYSE DES BLOQUANTS

### Ce qui empêche l'affichage initial rapide
1. **`rextraBalance`** : 4 requêtes ALL-TIME (planning_shifts sans filtre date, extra_events, payroll_validations, rextra_events) → ~500-1500ms dans le chemin critique de `get_week`
2. **Edge function cold start** : ~150-460ms (observé dans les logs) avant le premier code
3. **Auth getUser()** : ~100-200ms (in-code auth car `verify_jwt = false`)

### Ce qui empêche une modification instantanée
1. **RBAC séquentiel** : 3 RPC en série (~450ms) avant toute opération
2. **Pas d'optimistic update** : le frontend attend le round-trip complet
3. **Refetch complet** après mutation : `invalidatePlanning()` → nouveau `get_week` (~3s)

### Ce qui empêche une navigation instantanée
1. **`get_week` monolithique** : toujours ~3s même quand le cache est chaud (staleTime 30s)
2. **Prefetch ±1** aide mais les 2 calls supplémentaires surchargent le serveur

### Ce qui empêche une copie fluide
1. **Per-employee sequential** : N appels au lieu d'un bulk
2. **RBAC redondant** : même vérification N fois
3. **Pas de transaction** : risque d'état incohérent

---

## SECTION 9 — ÉLÉMENTS DIFFÉRABLES

| Élément | Exécuté aujourd'hui | Pourquoi pas nécessaire immédiatement | Bénéfice à décaler |
|---------|-------------------|--------------------------------------|-------------------|
| `rextraBalance` (4 queries ALL-TIME) | Dans `get_week`, bloquant | Pas affiché dans la grille principale, info secondaire | **-500 à -1500ms** sur `get_week` |
| Prefetch week ±1 | Immédiatement après `get_week` | Navigation pas encore demandée | Réduit charge serveur ×3 → ×1 |
| `invalidatePayroll` après mutation planning | Immédiatement | L'utilisateur n'est pas sur la page paie | Évite refetch inutile |
| Auto-publish check | Dans `get_week` | Calcul léger mais pourrait être lazy | Marginal |
| `next_week_check` (pour employee scope) | Dans `get_week` L430 | Seulement pour scope self/team read-only | ~100ms pour admin |

---

## SECTION 10 — ANALYSE SPÉCIFIQUE "COPIE DE SEMAINE"

### Enchaînement détaillé (OBSERVÉ via `bulkActions.ts` + `CopyWeekBulkModal`)

```
Pour chaque employé visible :
  1. POST planning-week { action: "copy_previous_week", user_id, mode }
     ├── validatePlanningWriteAccess()
     │   ├── RPC get_user_organization_id        (~150ms)
     │   ├── SELECT establishments                (~100ms)
     │   ├── RPC has_module_access               (~150ms)
     │   └── RPC get_my_permissions_v2           (~150ms)
     ├── getAllowedUserIds()                      (~100ms si team)
     ├── SELECT planning_weeks (validation)       (~100ms)
     ├── SELECT planning_shifts (source, prev week) (~100ms)
     ├── SELECT personnel_leaves (source)         (~100ms)
     ├── SELECT planning_shifts (target, current)  (~100ms)
     ├── SELECT personnel_leaves (target)          (~100ms)
     ├── [mode=replace] DELETE existing shifts     (~50ms)
     ├── [mode=replace] DELETE existing leaves     (~50ms)
     ├── INSERT copied shifts (bulk)              (~50ms)
     └── INSERT copied leaves (bulk)              (~50ms)
  
  Total par employé : ~1200-1500ms
  
Après tous les appels :
  Realtime invalidation → refetch get_week     (~3000ms)
```

### Étapes les plus coûteuses
1. **RBAC** (~450ms) — identique pour chaque employé, complètement redondant
2. **Fetch source + target** (~400ms) — les sources sont les mêmes pour tous les employés

### Raisons de la lenteur perçue
- **RBAC ×N** : le même admin est vérifié N fois
- **Source shifts identiques** : la semaine source est re-fetched N fois
- **Pas de transaction atomique** : si 1 fail sur 10, état partiel

### Conclusion
La copie de semaine devrait être **un seul appel bulk** avec :
- 1 seul RBAC check
- 1 seul fetch des shifts source
- 1 INSERT bulk multi-employés
- Le tout dans une transaction

---

## SECTION 11 — TOP 20 DES SOURCES DE LOURDEUR

| # | Source de lourdeur | Action | Coût | Gravité | Certitude |
|---|-------------------|--------|------|---------|-----------|
| 1 | `rextraBalance` : 4 queries ALL-TIME sans filtre date | get_week | 500-1500ms | 🔴 Critique | **Observé** (code L93-134 rextraBalance.ts) |
| 2 | 3× `planning-week` simultanés (current + prefetch ±1) | Ouverture + navigation | ×3 charge | 🔴 Critique | **Observé** (network traces) |
| 3 | RBAC 3-RPC séquentiel par mutation | Toute mutation | ~450ms | 🔴 Critique | **Observé** (updateShift.ts L170-197) |
| 4 | Copie semaine per-employee (N appels) | copy_previous_week | N × 1.2s | 🔴 Critique | **Observé** (bulkActions.ts) |
| 5 | Refetch complet après chaque mutation | Toute mutation | ~3s | 🟠 Fort | **Observé** (invalidatePlanning) |
| 6 | Pas d'optimistic update | Toute mutation | +3s perçu | 🟠 Fort | **Observé** (hooks mutations) |
| 7 | Edge function cold start | Premier appel | 150-460ms | 🟠 Fort | **Observé** (edge function logs) |
| 8 | Employés sans équipe invisibles | Ouverture planning | Bloquant UX | 🟠 Fort | **Observé** (simulation) |
| 9 | DELETE physique badge_events | delete_shift | Perte données | 🔴 Critique | **Observé** (deleteShift.ts L131) |
| 10 | `net_minutes` recalculé dans getWeek vs stocké en DB | get_week | Divergence | 🟠 Fort | **Observé** (getWeek.ts L284-286) |
| 11 | break_minutes copiés verbatim (pas recalculés) | copy_previous_week | Erreur métier | 🟠 Fort | **Observé** (bulkActions.ts L603) |
| 12 | RBAC dupliqué dans createShift vs updateShift vs deleteShift | Toute mutation | Code smell | 🟡 Moyen | **Observé** |
| 13 | `personnel_leaves` query séparé du planning-week | Ouverture | +230ms | 🟡 Moyen | **Observé** |
| 14 | Cascade `invalidatePayroll` après mutation planning | Mutation | Refetch inutile | 🟡 Moyen | **Observé** (invalidators.ts L74-78) |
| 15 | Prefetch ±1 avec staleTime 60s (> main staleTime 30s) | Navigation | Cache mismatch | 🟡 Moyen | **Observé** |
| 16 | `opening_exceptions` + `opening_hours` fetch séparé | get_week | +2 queries | 🟡 Faible | **Observé** |
| 17 | `RequestContext` pas utilisé dans updateShift/deleteShift | Mutation | RBAC non-optimisé | 🟡 Moyen | **Observé** |
| 18 | Département hardcodé (Cuisine/Salle/Plonge/Pizza) | Entry page | Non extensible | 🟡 Faible | **Observé** (PlanningEntryPage.tsx L11-37) |
| 19 | `planning_weeks` INSERT if missing dans get_week | Ouverture | Write dans un read | 🟡 Faible | **Observé** (getWeek.ts L307-318) |
| 20 | `refetchInterval: 8min` keep-alive | Background | Charge inutile si pas sur planning | 🟡 Faible | **Observé** (usePlanningWeek.ts L16) |

---

## SECTION 12 — ORDRE DES CHANTIERS DE CORRECTION

### Chantier 1 : Différer `rextraBalance` hors du chemin critique de `get_week`
- **Pourquoi en premier** : cause #1 de latence (4 queries ALL-TIME), gain estimé 500-1500ms soit 30-40% du temps de réponse
- **Ce qu'il devrait améliorer** : `get_week` passe de 3-4s à ~2-2.5s
- **Dépendances** : aucune
- **Risque** : faible (rextraBalance est un affichage secondaire)

### Chantier 2 : Archiver `badge_events` au lieu de DELETE physique
- **Pourquoi** : perte de données irréversible en production
- **Amélioration** : intégrité des données de pointage
- **Dépendances** : table d'archive à créer
- **Risque** : moyen (modifier deleteShift + markLeave)

### Chantier 3 : Factoriser RBAC en middleware partagé
- **Pourquoi** : 450ms de latence redondante par mutation
- **Amélioration** : -300ms par mutation
- **Dépendances** : refactor RequestContext pour updateShift/deleteShift
- **Risque** : moyen (touche toutes les mutations)

### Chantier 4 : Bulk RPC pour copie de semaine
- **Pourquoi** : transformation N appels → 1 appel atomique transactionnel
- **Amélioration** : copie de semaine de N×1.5s à ~500ms
- **Dépendances** : chantier 3 (RBAC middleware)
- **Risque** : moyen (nouveau RPC, tests nécessaires)

### Chantier 5 : Optimistic updates pour mutations simples
- **Pourquoi** : éviter 3s de refetch après chaque create/update/delete
- **Amélioration** : perception instantanée des modifications
- **Dépendances** : structure stable du cache React Query
- **Risque** : moyen (cohérence cache en cas d'erreur)

### Chantier 6 : Résoudre le bug "employés sans équipe invisibles"
- **Pourquoi** : bloquant fonctionnel — les employés actifs doivent apparaître
- **Amélioration** : UX fondamentale
- **Dépendances** : décision métier (afficher dans "Sans équipe" ou forcer l'affectation)
- **Risque** : faible

### Chantier 7 : Recalculer `break_minutes` lors de la copie de semaine
- **Pourquoi** : correction métier — les politiques de pause peuvent changer entre semaines
- **Amélioration** : exactitude des heures planifiées
- **Dépendances** : chantier 4 (bulk RPC)
- **Risque** : faible

### Chantier 8 : Limiter le prefetch à 1 semaine (pas ±1)
- **Pourquoi** : réduire la charge serveur ×3 → ×2
- **Amélioration** : moins de concurrence sur le serveur
- **Dépendances** : aucune
- **Risque** : très faible

---

## SECTION 13 — CHECKLIST AVANT PASSAGE EN PHASE DE CORRECTION

### Points à confirmer
- [ ] Confirmer que `rextraBalance` peut être chargé en lazy (pas nécessaire pour la grille)
- [ ] Confirmer avec l'équipe la politique pour les employés sans équipe (afficher ou forcer affectation)
- [ ] Valider que les `break_minutes` doivent être recalculés lors de la copie
- [ ] Confirmer que le DELETE physique des `badge_events` est bien un bug et non un choix métier

### Zones sensibles
- `deleteShift.ts` : touche aux badge_events (données de pointage)
- `bulkActions.ts` : copie de semaine (intégrité des données)
- `rextraBalance.ts` : calcul R-Extra (impact paie)
- `invalidatePlanning()` : cascade vers payroll

### Impacts potentiels inter-modules
- **Badgeuse** : archivage au lieu de DELETE impacte les queries badge_events
- **Paie** : `net_minutes` recalculé dans get_week vs stocké → vérifier cohérence avec payroll engine
- **Absences** : `personnel_leaves` partagé avec module Congés & Absences

### Métriques à suivre pendant la correction
- Temps de réponse `planning-week` (P50, P95, P99)
- Nombre d'appels `planning-week` par session
- Taux d'erreur des mutations planning
- Nombre de `badge_events` (avant/après archivage)

### Scénarios à rejouer pour valider les gains
1. Ouverture planning depuis le dashboard → mesurer temps avant grille visible
2. Navigation ×5 semaines consécutives → mesurer fluidité
3. Création + modification + suppression de shift → mesurer round-trip
4. Copie de semaine avec 5+ employés → mesurer temps total
5. Vérifier que les badge_events ne sont pas perdus après suppression de shift

---

## ANNEXE — Traces réseau brutes

### Ouverture Dashboard (login)
```
planning-week     : 3846ms (200)
absence-declaration: 3798ms (200)
get_service_day_now: 219ms, 543ms
cash_day_reports   : 537ms, 585ms
invoices           : 574ms
products_v2        : 593ms
planning_shifts    : 195ms, 203ms
badge_events       : 216ms
```

### Navigation Dashboard → Planning (entry page)
```
planning-week (×3) : 3724ms, 3497ms, 2981ms  ← prefetch ±1
personnel_leaves   : 247ms
get_service_day_now: 286ms
establishments     : 222ms
planning_shifts    : 225ms
```

### Navigation semaine (→)
```
planning-week (×3) : 3266ms, 2677ms, 2310ms
personnel_leaves   : 227ms
```

### Edge Function Logs (notif-check-badgeuse, sample)
```
Boot times: 132ms, 136ms, 155ms, 156ms, 227ms, 240ms, 288ms, 460ms
→ Cold start P50 ≈ 155ms, P95 ≈ 400ms
```
