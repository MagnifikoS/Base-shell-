# AUDIT COMPLET — MODULE PLANNING

> **Date :** 2026-03-07  
> **Statut :** Analyse uniquement — aucune modification de code  
> **Méthode :** Lecture exhaustive du code source (frontend + edge functions + schéma DB)

---

## SECTION 1 — CARTOGRAPHIE FONCTIONNELLE

### Fonctionnalités cœur (OBSERVÉ)

| Fonctionnalité | Backend | Frontend | Statut |
|---|---|---|---|
| Créer un shift (horaire planifié) | `createShift.ts` → RPC `planning_create_shift_atomic` | `useCreateShift.ts` + optimistic update | ✅ Prod |
| Modifier un shift (heures) | `updateShift.ts` → UPDATE direct | `useUpdateShift.ts` + optimistic update | ✅ Prod |
| Supprimer un shift | `deleteShift.ts` → DELETE + badge cleanup | `useDeleteShift.ts` + optimistic update | ✅ Prod |
| Voir le planning de la semaine | `getWeek.ts` → payload complet | `usePlanningWeek.ts` → React Query | ✅ Prod |
| Valider un jour | `validatePlanning.ts` → upsert `planning_weeks.validated_days` | `useValidateDay` + optimistic | ✅ Prod |
| Valider/invalider une semaine | `validatePlanning.ts` → update `week_validated` | `useValidateWeek` + optimistic | ✅ Prod |
| Marquer CP/Absence/Repos/AM | `markLeave.ts` → upsert `personnel_leaves` + delete shifts + delete badges | `LeaveMarkModal.tsx` | ✅ Prod |
| Annuler un congé | `cancelLeave.ts` | `LeaveCancelModal.tsx` | ✅ Prod |
| Modifier un congé (type) | `updateLeave.ts` | via UI | ✅ Prod |
| Copier semaine précédente (par employé) | `bulkActions.ts` → `copy_previous_week` | `useCopyPreviousWeek` | ✅ Prod |
| Supprimer shifts de la semaine (bulk) | `bulkActions.ts` → `delete_week_shifts` | `useDeleteWeekShifts` | ✅ Prod |
| Supprimer shifts d'un employé (semaine) | `bulkActions.ts` → `delete_employee_week_shifts` | `useDeleteEmployeeWeekShifts` | ✅ Prod |
| Drag & drop (copie de shift) | API directe (bypass mutation hooks) | `usePlanningDragDrop.ts` | ✅ Prod |
| Favoris nommés (2 max/employé) | ❌ localStorage uniquement | `usePlanningFavorites.ts` | ✅ Prod |
| Auto-publication | Calculé dans `getWeek.ts` via `isAutoPublishActive()` | Affichage dans `PlanningTopBar` | ✅ Prod |
| R-Extra (repos compensateur) | `rextraBalance.ts` → calcul on-the-fly | Affichage dans grille + dialog | ✅ Prod |
| Filtrage par département/équipe | Filtrage UI (memoized) + optionnel `team_ids` server-side | `PlanningPage.tsx` | ✅ Prod |
| Préchargement semaines adjacentes | — | `usePrefetchAdjacentWeeks` | ✅ Prod |

### Fonctionnalités transverses (OBSERVÉ)

| Fonctionnalité | Impact |
|---|---|
| RBAC scope (self/team/establishment/org) | Filtrage server-side + client-side |
| Break policy (calcul automatique coupure) | Appliqué à la création et modification de shift |
| Opening hours / exceptions | Validation à la création/modification |
| Service day (cutoff) | Détermination du "aujourd'hui" |
| Employé scope restriction (read-only) | Week navigation bloquée, affichage semaine courante/prochaine seulement |

### Fonctionnalités ABSENTES (INFÉRÉ)

| Fonctionnalité | Statut |
|---|---|
| Templates de planning (modèles hebdo réutilisables, serveur) | ❌ Absent — favoris localStorage seulement |
| Copie bulk multi-employés en 1 action | ❌ Absent — copie 1 employé à la fois |
| Export planning (PDF, Excel) | ❌ Absent (seul PrintButton existe) |
| Notification push de publication | ❌ Absent |
| Contraintes légales (repos 11h, max 10h/jour, max 48h/sem) | ❌ Aucune vérification |
| Détection de conflits d'horaires inter-établissements | ❌ Absent |
| Planning par service (matin/soir) avec vue dédiée | ❌ Absent — filtrage team seulement |
| Historique de modifications (audit trail) | ❌ Absent |

---

## SECTION 2 — INVENTAIRE ÉCRANS ET PARCOURS

### Pages et composants

| Composant | Rôle | Lignes |
|---|---|---|
| `PlanningPage.tsx` | Orchestrateur principal (entry → grid) | 438 |
| `PlanningEntryPage.tsx` | Page d'accueil : choix département ou général | 129 |
| `PlanningTopBar.tsx` | Navigation semaine + validation semaine + copie + favoris | 255 |
| `PlanningWeekGrid.tsx` | Grille planning avec colonnes jours | 538 |
| `PlanningWeekHeader.tsx` | En-tête colonnes (jours) | — |
| `PlanningWeekRow.tsx` | Ligne employé | — |
| `PlanningWeekCell.tsx` | Cellule jour/employé (shifts + leaves) | — |
| `ShiftManagementDialog.tsx` | Modale création/édition/suppression shifts | 143 (wrapper) |
| `ShiftManagementCore.tsx` | Cœur de la modale shift | — |
| `LeaveMarkModal.tsx` | Modale marquage CP/Abs/Repos/AM | — |
| `LeaveCancelModal.tsx` | Modale annulation congé | — |
| `CopyWeekBulkModal.tsx` | Modale copie semaine précédente | — |
| `FavoriteSaveDialog.tsx` | Sauvegarde favori nommé | — |
| `FavoriteApplyDialog.tsx` | Application d'un favori | — |
| `BulkActionModals.tsx` | Confirmation suppression bulk | — |
| `ReplaceLeaveOnDropModal.tsx` | Confirmation drop sur cellule avec congé | — |

### Parcours utilisateur principal (OBSERVÉ)

```
1. Ouverture page Planning
   → PlanningEntryPage (choix département ou général)
   → ⚠️ FRICTION: Clic obligatoire même si 1 seul département
   
2. Sélection département
   → PlanningPage charge les données via usePlanningWeek (edge function)
   → Affiche la grille avec skeleton pendant chargement
   → ⚠️ LATENCE: ~500ms minimum (edge function cold start possible)
   
3. Clic sur une cellule vide
   → ShiftManagementDialog (mode création)
   → Saisie start_time / end_time
   → Soumission → optimistic update + API call
   → ⚠️ FRICTION: Pas de raccourci clavier, pas de saisie rapide
   
4. Clic sur un shift existant
   → ShiftManagementDialog (mode édition)
   → Modification horaires → optimistic update
   
5. Drag & drop shift
   → Copie uniquement (pas de déplacement)
   → Optimistic add + API create
   → ⚠️ PAS DE MOVE: Le drag supprime-t-il la source ? → NON, isMove = false hardcodé
   
6. Validation jour/semaine
   → Toggle dans PlanningTopBar
   → Optimistic update
   → ⚠️ UX: Pas de confirmation avant validation semaine complète
   
7. Copie semaine précédente
   → Modale CopyWeekBulkModal
   → Choix merge/replace par employé
   → ⚠️ LATENCE: Séquentiel par employé, pas de batch server-side
```

### Points de friction UX identifiés (OBSERVÉ)

| # | Problème | Gravité |
|---|---|---|
| UX-1 | Page d'entrée obligatoire même avec 1 département | Moyenne |
| UX-2 | Pas de raccourci clavier pour créer un shift | Haute |
| UX-3 | Drag & drop = copie seulement, pas de déplacement | Moyenne |
| UX-4 | Copie semaine = 1 employé à la fois (pas de bulk all) | Haute |
| UX-5 | Favoris en localStorage (perdus si autre navigateur/device) | Haute |
| UX-6 | Pas de vue "journée" ni vue "mois" | Basse |
| UX-7 | Pas d'indicateur visuel du temps total par jour/colonne | Moyenne |
| UX-8 | Pas de feedback si shift chevauche temps déjà travaillé (le backend bloque, mais l'UI ne prévient pas avant soumission) | Moyenne |

---

## SECTION 3 — MODÈLE DE DONNÉES

### Entités principales

#### `planning_shifts`
| Colonne | Type | Rôle |
|---|---|---|
| id | uuid PK | Identifiant unique |
| organization_id | uuid FK | Multi-tenant |
| establishment_id | uuid FK | Établissement |
| user_id | uuid | Employé assigné |
| shift_date | date | Date du shift |
| start_time | time | Heure début |
| end_time | time | Heure fin |
| net_minutes | integer | Minutes nettes (après déduction pause) |
| break_minutes | integer | Minutes de pause (calculé par break policy) |
| created_at | timestamptz | — |
| updated_at | timestamptz | — |

**Cycle de vie :** CREATE → UPDATE (heures) → DELETE. Pas de soft delete.

#### `planning_weeks`
| Colonne | Type | Rôle |
|---|---|---|
| id | uuid PK | — |
| organization_id | uuid FK | Multi-tenant |
| establishment_id | uuid FK | — |
| week_start | date | Lundi de la semaine |
| week_validated | boolean | Semaine publiée/validée |
| validated_days | jsonb | Map `{date: boolean}` par jour |
| week_invalidated_at | timestamptz | Override manager (force HIDE) |
| created_at / updated_at | timestamptz | — |

**Cycle de vie :** Auto-créé au premier GET si absent. Upsert ensuite.

#### `personnel_leaves`
| Colonne | Type | Rôle |
|---|---|---|
| id | uuid PK | — |
| establishment_id | uuid FK | — |
| user_id | uuid | Employé |
| leave_date | date | Date du congé |
| leave_type | text | `cp`, `absence`, `rest`, `am` |
| status | text | `approved`, `cancelled` |
| reason | text | Motif optionnel |
| created_by | uuid | Qui a marqué |
| justificatif_document_id | uuid | Lien document |

**Cycle de vie :** INSERT (approved) → UPDATE (type change) → UPDATE (cancelled). Pas de DELETE dans le flow normal (sauf bulk copy/delete).

### Entités secondaires (OBSERVÉ)

| Table | Rôle dans le planning |
|---|---|
| `profiles` | Nom employé, statut actif/disabled |
| `user_establishments` | Affectation employé ↔ établissement |
| `user_teams` | Affectation employé ↔ équipe |
| `teams` | Nom d'équipe |
| `establishment_day_parts` | Morning/Midday/Evening (horaires + couleurs) |
| `establishment_opening_hours` | Horaires hebdo par jour |
| `establishment_opening_exceptions` | Exceptions ponctuelles |
| `establishment_break_policies` | Règles de pause automatique |
| `badge_events` | Pointages (clock_in/clock_out) |
| `planning_rextra_events` | Repos compensateurs par jour |
| `establishments` | Auto-publish config, service_day_cutoff |

---

## SECTION 4 — SOURCES DE VÉRITÉ

| Concept | Source de vérité | Qui écrit | Qui lit | Données dérivées | Risque divergence |
|---|---|---|---|---|---|
| **Horaire prévu** | `planning_shifts` | Edge function `planning-week` | Planning UI, Paie (`usePayrollMonthData`), Dashboard | `net_minutes`, `totalsByEmployee` (calculés en mémoire) | ⚠️ `net_minutes` calculé côté serveur MAIS aussi recalculé dans `getWeek.ts` lignes 284-296 |
| **Horaire réalisé** | `badge_events.effective_at` | Edge function `badge-events` | Présence, Paie | `late_minutes`, `early_departure_minutes` | ✅ SSOT clair |
| **Pointage badgeuse** | `badge_events.occurred_at` | Edge function `badge-events` | Présence | `effective_at` = normalisé | ✅ SSOT clair |
| **Absence/CP/Repos** | `personnel_leaves` | Edge function `planning-week` (mark/cancel) + `absence-declaration` | Planning, Paie, Congés | — | ⚠️ **Dual writer** : planning-week ET absence-declaration peuvent écrire dans `personnel_leaves` |
| **Disponibilité employé** | Pas de table dédiée | — | — | — | ❌ **ABSENT** |
| **Affectation shift** | `planning_shifts.user_id` | Edge function | Planning | — | ✅ |
| **Poste/Rôle** | `user_teams` + `teams` | Admin | Planning, RBAC | `team_name` dans le payload | ✅ |
| **Heures contractuelles** | `employee_details.contract_hours` | Edge function `employees` | Paie | `monthlyHours` calculé | ✅ SSOT dans `employee_details` |
| **Heures supplémentaires** | ❌ Pas de table dédiée | — | Calculé on-the-fly dans payroll.compute | — | ⚠️ Calcul frontend uniquement, pas de stockage |
| **État publié/brouillon** | `planning_weeks.week_validated` + `validated_days` + `week_invalidated_at` + auto-publish | Edge function | Planning UI, employee read | `autoPublishActive` calculé | ⚠️ Logique complexe (3 facteurs) |
| **Base calcul paie** | `planning_shifts.net_minutes` + `badge_events` | Multiples sources | `payroll.compute.ts` | Agrégation hebdo/mensuel | ⚠️ **À CONFIRMER** : la paie utilise-t-elle `net_minutes` du planning ou recalcule ? |
| **Semaine copiée** | Pas de marqueur | — | — | — | ✅ Pas de risque (copie = shifts normaux) |
| **Favoris** | `localStorage` | Frontend direct | Frontend | — | ⚠️ **Non partagé** entre devices/navigateurs |

### ⚠️ ALERTES SOURCE DE VÉRITÉ

1. **`net_minutes` double calcul** : Le champ est stocké dans `planning_shifts` (calculé à la création via break policy) MAIS `getWeek.ts` le recalcule en ligne 284-296 avec `calculateDurationMinutes - break_minutes`. Si le break_minutes change entre création et lecture, divergence possible. **À CONFIRMER.**

2. **`personnel_leaves` dual writer** : Le module planning ET le module absences/congés peuvent tous deux écrire dans cette table. Pas de verrouillage croisé observé. **RISQUE DE CONFLIT.**

3. **Heures supp calculées frontend** : Aucun stockage serveur des extras hebdomadaires. `payroll.compute.ts` recalcule tout à chaque affichage. Performant mais fragile si la logique diverge.

---

## SECTION 5 — RÈGLES MÉTIER ET INVARIANTS

### Règles bloquantes (OBSERVÉ dans le code)

| Règle | Vérifié dans | Type |
|---|---|---|
| Shift ne peut pas chevaucher un shift existant (même employé, même jour) | `createShift.ts`, `updateShift.ts` | BLOQUANT |
| Shift ne peut pas chevaucher du temps déjà travaillé (badge events) | `createShift.ts`, `updateShift.ts` | BLOQUANT |
| Shift doit être dans les horaires d'ouverture | `createShift.ts`, `updateShift.ts` via `openingHours.ts` | BLOQUANT |
| End_time > start_time (sauf overnight) | `createShift.ts`, `updateShift.ts` | BLOQUANT |
| Max 2 shifts par jour par employé | `updateShift.ts` (ligne 295) | BLOQUANT |
| Employé doit être actif (status=active) | `createShift.ts`, `updateShift.ts` | BLOQUANT |
| Employé doit être affecté à l'établissement | `createShift.ts` | BLOQUANT |
| Day parts doivent être configurés | `getWeek.ts`, `createShift.ts` | BLOQUANT |
| Semaine validée → suppression/copie interdite | `bulkActions.ts` | BLOQUANT |
| Jour validé → suppression bulk interdite (skip) | `bulkActions.ts` | BLOQUANT |
| Copie semaine si ≥1 jour validé → refusée | `bulkActions.ts` (ligne 412-418) | BLOQUANT |
| Start_time locked si clock_in existe (pas de clock_out) | `updateShift.ts` | BLOQUANT |

### Règles d'avertissement (OBSERVÉ)

| Règle | Vérifié dans |
|---|---|
| Aucune | — |

**⚠️ ABSENCE TOTALE de règles d'avertissement.** Pas de warning pour :
- Repos insuffisant entre shifts (<11h)
- Dépassement durée quotidienne (>10h)
- Dépassement durée hebdomadaire (>48h ou >44h en moyenne)
- Shift sur jour fermé (bloqué mais pas prévenu avant soumission)

### Invariants à ne jamais casser

1. **`planning_shifts` est la SSOT des heures prévues** — jamais de cache, jamais de projection
2. **`planning_weeks.validated_days` est la SSOT de la publication par jour**
3. **`personnel_leaves` est partagé avec le module absences** — toute modification doit être compatible
4. **`badge_events` est en lecture seule depuis le planning** — seul `markLeave` et `deleteShift` peuvent les supprimer
5. **Break policy s'applique automatiquement** — l'utilisateur ne saisit jamais la pause manuellement

---

## SECTION 6 — DÉPENDANCES INTER-MODULES

| Module | Direction | Type | Synchronicité | Fragilité |
|---|---|---|---|---|
| **Badgeuse** | Planning → Badgeuse (lecture) | Lecture `badge_events` pour overlap check | Synchrone (dans create/update shift) | ⚠️ **Haute** : chaque création de shift fait 1 requête badge_events |
| **Badgeuse** | Planning → Badgeuse (écriture) | DELETE `badge_events` quand shift supprimé ou leave marqué | Synchrone | ⚠️⚠️ **CRITIQUE** : supprimer un shift SUPPRIME les pointages associés |
| **Personnel** | Planning → Personnel (lecture) | Lecture `profiles`, `user_establishments`, `user_teams` | Synchrone (getWeek) | ✅ Lecture seule, faible risque |
| **Absences/Congés** | Planning ↔ Absences (écriture/lecture) | Écriture dans `personnel_leaves` via mark/cancel | Synchrone | ⚠️ **Dual writer** |
| **Paie** | Paie → Planning (lecture) | Lecture `planning_shifts.net_minutes` | Async (React Query) | ✅ Lecture seule |
| **Paie (extras)** | Paie → Planning (lecture) | Lecture `planning_shifts` pour calcul hebdo extras | Async (fenêtre élargie lun→dim) | ⚠️ Fenêtre de lecture large, dépendance au format |
| **Break Policy** | Planning → Settings (lecture) | Lecture `establishment_break_policies` | Synchrone (create/update shift) | ✅ Faible |
| **Opening Hours** | Planning → Settings (lecture) | Lecture `establishment_opening_hours` + exceptions | Synchrone | ✅ Faible |
| **R-Extra** | Planning ↔ R-Extra | Lecture/écriture `planning_rextra_events`, calcul balance | Synchrone | ⚠️ Calcul balance on-the-fly (N requêtes) |

### ⚠️⚠️ COUPLAGE CRITIQUE : Suppression shift → Suppression badge_events

**`deleteShift.ts` lignes 127-143** et **`markLeave.ts` lignes 209-224** :  
Quand un shift est supprimé ou un congé est marqué, **TOUS les badge_events du jour sont supprimés**.  
C'est une décision métier lourde : si un manager supprime un shift après que l'employé ait badgé, les pointages sont **perdus définitivement**.

**Risque :** Perte de données de pointage irréversible.  
**Recommandation :** Archive (soft delete) plutôt que DELETE physique des badge_events.

---

## SECTION 7 — ARCHITECTURE TECHNIQUE

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────┐
│ FRONTEND (React)                                     │
│                                                      │
│  PlanningPage.tsx                                    │
│    ├── usePlanningWeek ──→ supabase.functions.invoke │
│    ├── useCreateShift ──→    "planning-week"         │
│    ├── useUpdateShift ──→    edge function           │
│    ├── useDeleteShift ──→    (single endpoint)       │
│    ├── usePlanningDragDrop ──→                       │
│    ├── usePlanningBulkActions ──→                    │
│    └── usePlanningFavorites ──→ localStorage         │
│                                                      │
│  Optimistic updates via React Query cache            │
│  Scope filtering: server-side + client-side (useMemo)│
└──────────────────────┬──────────────────────────────┘
                       │ POST /planning-week
                       ▼
┌─────────────────────────────────────────────────────┐
│ EDGE FUNCTION: planning-week/index.ts               │
│                                                      │
│  Router: action-based (get_week, create_shift, etc.) │
│  Auth: getUser() in code (verify_jwt=false)          │
│  RBAC: has_module_access + get_my_permissions_v2     │
│                                                      │
│  Shared modules:                                     │
│    ├── getWeek.ts (470 lines)                       │
│    ├── createShift.ts (299 lines)                   │
│    ├── updateShift.ts (403 lines)                   │
│    ├── deleteShift.ts (146 lines)                   │
│    ├── bulkActions.ts (681 lines)                   │
│    ├── validatePlanning.ts (278 lines)              │
│    ├── markLeave.ts (233 lines)                     │
│    ├── cancelLeave.ts                                │
│    ├── updateLeave.ts                                │
│    ├── breakPolicy.ts                                │
│    ├── openingHours.ts                               │
│    ├── parisTime.ts                                  │
│    ├── time.ts                                       │
│    ├── profiler.ts                                   │
│    ├── requestContext.ts                              │
│    └── rextraBalance.ts                              │
│                                                      │
│  Clients: userClient (JWT) + adminClient (service)   │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ DATABASE (PostgreSQL)                                │
│                                                      │
│  planning_shifts (SSOT heures prévues)              │
│  planning_weeks (validation/publication)             │
│  personnel_leaves (congés — partagé)                │
│  planning_rextra_events (repos compensateurs)       │
│  badge_events (READ + DELETE)                        │
│  + tables de config (day_parts, opening_hours, etc.) │
└─────────────────────────────────────────────────────┘
```

### Signalements architecturaux

| # | Problème | Gravité |
|---|---|---|
| ARCH-1 | **Logique métier dans le frontend** : `usePlanningFavorites` gère tout le cycle de vie des favoris en localStorage, sans aucun backend. Perte de données garantie au changement de device. | Moyenne |
| ARCH-2 | **Single edge function pour tout** : `planning-week` est un monolithe (14 actions, ~3000 lignes de code partagé). Pas de séparation lecture/écriture. Un déploiement impacte tout. | Haute |
| ARCH-3 | **RBAC dupliqué** : Chaque handler (create, update, delete, mark_leave, etc.) fait ses propres appels RBAC (`has_module_access` + `get_my_permissions_v2`). Pas de middleware partagé. `createShift.ts` utilise `RequestContext`, les autres font des appels directs. | Moyenne |
| ARCH-4 | **Optimistic updates dupliqués** : `useCreateShift`, `usePlanningDragDrop` et `useUpdateShift` ont chacun leur propre logique d'optimistic update avec des patterns légèrement différents. | Moyenne |
| ARCH-5 | **`net_minutes` recalculé à la lecture** : `getWeek.ts` ligne 284-296 recalcule `net_minutes` à partir de `calculateDurationMinutes - break_minutes` au lieu d'utiliser la valeur stockée. Inutile et source potentielle de divergence. | Basse |
| ARCH-6 | **Pas de cache server-side** : Chaque `get_week` refait toutes les requêtes (profils, teams, shifts, badges, rextra, permissions). Le profiler montre ~500-650ms. | Haute |

---

## SECTION 8 — AUDIT PERFORMANCE ET LATENCE

### Mesures observées (profiler edge function logs)

| Métrique | Valeur typique | Source |
|---|---|---|
| get_week total | **400-650ms** | Profiler logs |
| DB time (somme) | 978-1445ms | Profiler (parallel queries) |
| Nombre de requêtes DB | **18 steps** | Profiler |
| Phases parallèles | 3 (A, B, C) | Code |
| Cold start edge function | ~30-45ms | Boot logs |

### Décomposition get_week (typique)

| Phase | Requêtes | Temps typique |
|---|---|---|
| Phase A : org_id + establishment | 2 parallel | ~60-100ms |
| Permission check | 1 | ~50ms |
| Phase B : teams + users + day_parts + openings + planning_weeks | 6 parallel | ~100-120ms |
| Scope filter | 1 (si team) | ~0.1ms |
| Phase C : profiles + user_teams + shifts + rextra + rextra_balances | 5 parallel | **240-350ms** |
| CPU (build response) | — | <5ms |

### Goulots d'étranglement

| # | Problème | Cause | Impact user | Criticité |
|---|---|---|---|---|
| PERF-1 | **rextra_balances : 240-350ms** | `computeRextraBalanceForUsers` fait un calcul historique global (toutes les dates) | Ralentit chaque chargement de page | **Haute** |
| PERF-2 | **18 requêtes DB par get_week** | Architecture "fetch everything" même si rien n'a changé | Latence incompressible ~400ms | Haute |
| PERF-3 | **Copie semaine = 1 employé × N requêtes** | `copy_previous_week` est séquentiel : fetch source, fetch target, delete (replace), insert. Pas de batch multi-employé. | UX lente pour 10+ employés | **Haute** |
| PERF-4 | **RBAC redondant** : chaque mutation refait `has_module_access` + `get_my_permissions_v2` + `get_user_organization_id` | 3 RPC par action | ~150ms de overhead par mutation | Moyenne |
| PERF-5 | **Refetch interval 8min** | Warm-up pour éviter cold starts, mais refetch complet | Trafic réseau inutile si rien ne change | Basse |
| PERF-6 | **Pas de delta/incremental** | Navigation semaine = full reload (pas de cache server-side partagé) | ~500ms à chaque changement de semaine | Haute |

---

## SECTION 9 — AUDIT "COPIE SEMAINE PRÉCÉDENTE"

### Flux exact (OBSERVÉ dans `bulkActions.ts` lignes 367-681)

```
1. validatePlanningWriteAccess (RBAC)           → 3 requêtes DB
2. getAllowedUserIds (scope)                     → 0-1 requête
3. Check planning_weeks.week_validated           → 1 requête
4. Check validated_days (aucun jour validé)     → CPU
5. Get previous week dates                       → CPU
6. Fetch source shifts (previous week, 1 user)  → 1 requête
7. Fetch source leaves (previous week, 1 user)  → 1 requête
8. Fetch target shifts (existing)               → 1 requête
9. Fetch target leaves (existing)               → 1 requête
10. If replace mode: DELETE target shifts        → 1 requête
11. If replace mode: DELETE target leaves        → 1 requête
12. Build shifts to insert (CPU)                 → CPU
13. Build leaves to insert (CPU)                 → CPU
14. INSERT shifts batch                          → 1 requête
15. INSERT leaves batch                          → 1 requête
```

**Total : 10-13 requêtes DB par employé copié.**

### Ce qui est copié (OBSERVÉ)

- ✅ `start_time`, `end_time`, `break_minutes`, `net_minutes` (copie directe)
- ✅ `personnel_leaves` avec `leave_type`, `reason`, `status` (forcé à "approved")
- ❌ `organization_id` est récupéré du contexte (pas copié)
- ❌ Badge events ne sont PAS copiés (correct)
- ❌ R-Extra events ne sont PAS copiés (correct)

### Ce qui ne devrait PAS être copié mais l'est (OBSERVÉ)

- ⚠️ `break_minutes` et `net_minutes` sont copiés directement de la source. Si la break policy a changé entre la semaine source et la cible, les valeurs seront **obsolètes**.

### Pourquoi c'est lent

1. **Pas de bulk multi-employé** : L'UI copie employé par employé via des mutations séquentielles.
2. **RBAC refait à chaque appel** : 3 RPC × N employés = N×150ms de overhead.
3. **Pas de recalcul break** : Les breaks sont copiés "as is" au lieu d'être recalculés. C'est rapide mais potentiellement incorrect.
4. **Pas de transaction atomique** : Les INSERT/DELETE ne sont pas dans une transaction. En cas d'erreur partielle, état incohérent possible.

### Risques métier

1. **Break policy obsolète** : Si la politique de pause change entre semaine N-1 et N, la copie insère des `net_minutes` incorrects.
2. **Pas de validation opening hours** : La copie ne vérifie pas si les horaires copiés sont dans les fenêtres d'ouverture de la semaine cible (ex: exception fermeture).
3. **Pas de vérification overlap badge** : La copie ne vérifie pas si un badge_event existe déjà sur la semaine cible.

### Recommandation

Pour rendre la copie quasi-instantanée :
1. Créer une action `copy_previous_week_bulk` qui copie TOUS les employés en 1 appel
2. Utiliser une RPC transactionnelle unique (INSERT... SELECT offset)
3. Recalculer `break_minutes` et `net_minutes` via la break policy courante
4. Valider les opening hours de la semaine cible
5. Objectif : < 200ms pour 20 employés

---

## SECTION 10 — DETTES

### A. Dette UX

| # | Description | Impact | Gravité | Recommandation |
|---|---|---|---|---|
| DUX-1 | Page d'entrée obligatoire (choix département) | 1 clic supplémentaire systématique | Moyenne | Bypass si 1 seul département, ou mémoriser le dernier choix |
| DUX-2 | Pas de saisie rapide (raccourcis clavier) | Lent pour créer 20+ shifts | Haute | Clic cellule → saisie directe "9h-17h" sans modale |
| DUX-3 | Copie semaine = 1 employé à la fois | Très lent pour 10+ employés | Haute | Bouton "Copier tout" en bulk |
| DUX-4 | Drag & drop = copie seulement, pas de move | Contre-intuitif | Moyenne | Ajouter le mode move (suppr source) |
| DUX-5 | Favoris perdus hors navigateur | Perte de productivité | Haute | Persister en DB |
| DUX-6 | Pas de preview des heures totales par colonne/jour | Difficile de voir la charge globale | Moyenne | Ajouter total jour en en-tête |
| DUX-7 | Pas de warnings préventifs (repos, durée max) | Non-conformité potentielle | Haute | Avertissements visuels temps réel |

### B. Dette architecturale

| # | Description | Impact | Gravité | Recommandation |
|---|---|---|---|---|
| DARCH-1 | Edge function monolithique (14 actions) | Tout déploiement impacte tout | Haute | Séparer read (get_week) et write (mutations) |
| DARCH-2 | RBAC dupliqué dans chaque handler | 150ms overhead × action, maintenance | Haute | Middleware RBAC partagé (`RequestContext` étendu) |
| DARCH-3 | Optimistic updates dupliqués (3 implémentations) | Bug risk, maintenance | Moyenne | Factoriser en 1 helper partagé |
| DARCH-4 | `net_minutes` recalculé à la lecture | Divergence potentielle | Basse | Utiliser la valeur stockée |
| DARCH-5 | Pas de transaction pour bulk copy | Incohérence partielle possible | Haute | RPC transactionnelle |

### C. Dette métier

| # | Description | Impact | Gravité | Recommandation |
|---|---|---|---|---|
| DMET-1 | **Suppression badge_events sur delete shift** | Perte irréversible de pointages | **CRITIQUE** | Soft delete ou archive `badge_events_archive` |
| DMET-2 | **Aucune contrainte légale** (repos 11h, max 10h/j, max 48h/s) | Non-conformité code du travail | Haute | Avertissements puis blocage configurable |
| DMET-3 | **Break policy non recalculée à la copie** | `net_minutes` potentiellement faux | Haute | Recalculer à la copie |
| DMET-4 | **Dual writer `personnel_leaves`** | Conflit possible planning ↔ absences | Haute | Centraliser l'écriture ou ajouter verrouillage |
| DMET-5 | **Pas de disponibilités employé** | Planning sans connaissance des contraintes | Moyenne | Table `employee_availabilities` |

---

## SECTION 11 — PLAN D'ÉVOLUTION "PLANNING PRO"

### Phase 0 — Observation et instrumentation (1-2 jours)

**Objectif :** Mesurer avant d'optimiser.

- [ ] Ajouter des métriques de latence côté client (temps entre clic et affichage)
- [ ] Logger le nombre d'employés/shifts par `get_week` pour dimensionner
- [ ] Mesurer le taux d'utilisation de la copie semaine
- [ ] Identifier les parcours utilisateur les plus fréquents

**Risques :** Aucun. Lecture seule.  
**Garde-fou :** Feature flag pour les logs.

### Phase 1 — Sécurisation métier (3-5 jours)

**Objectif :** Corriger les risques métier critiques sans changer l'UX.

- [ ] **DMET-1** : Archiver `badge_events` au lieu de DELETE (table `badge_events_archive` existante)
- [ ] **DMET-3** : Recalculer `break_minutes` et `net_minutes` à la copie
- [ ] **DMET-4** : Ajouter un index unique `(establishment_id, user_id, leave_date)` sur `personnel_leaves` pour empêcher les doublons

**Prérequis :** Aucun.  
**Risques :** Migration DB (index unique).  
**Garde-fous :** Tests unitaires break policy + copie.  
**Impact utilisateur :** Invisible.

### Phase 2 — Stabilisation architecture (3-5 jours)

**Objectif :** Réduire la dette technique sans changer le comportement.

- [ ] **DARCH-2** : Factoriser RBAC dans un middleware partagé (`RequestContext.requirePlanningWrite()`)
- [ ] **DARCH-3** : Factoriser les optimistic updates en 1 helper
- [ ] **DARCH-4** : Utiliser `net_minutes` stocké dans `getWeek.ts` au lieu de recalculer
- [ ] **DARCH-5** : RPC `planning_copy_week_bulk` pour copie atomique multi-employé

**Prérequis :** Phase 1 complète.  
**Risques :** Régression si le middleware RBAC est mal implémenté.  
**Garde-fous :** Tests de régression RBAC (red/blue team).  
**Impact utilisateur :** Copie plus rapide.

### Phase 3 — Accélération lecture (3-5 jours)

**Objectif :** Réduire la latence `get_week` de ~500ms à ~200ms.

- [ ] Optimiser `rextraBalance` : calcul incrémental ou cache
- [ ] Réduire le nombre de requêtes DB (merge `profiles` + `user_teams` + `user_establishments` en 1 vue)
- [ ] Cache server-side `planning_weeks` (rarement modifié)
- [ ] ETag / 304 pour éviter les payloads identiques

**Prérequis :** Phase 2 (middleware RBAC).  
**Risques :** Invalidation de cache.  
**Garde-fous :** Profiler avant/après.  
**Impact utilisateur :** Navigation ~2x plus rapide.

### Phase 4 — Refonte UX ciblée (5-8 jours)

**Objectif :** Rendre le planning intuitif et fluide.

- [ ] **DUX-2** : Saisie rapide inline (clic cellule → input "9-17" → Entrée)
- [ ] **DUX-3** : Bouton "Copier tout" bulk (utilise la RPC Phase 2)
- [ ] **DUX-1** : Mémoriser le dernier département, bypass si 1 seul
- [ ] **DUX-6** : Total heures par colonne (jour)
- [ ] **DUX-7** : Warnings visuels (repos, durée max) — non bloquants d'abord

**Prérequis :** Phase 3 (performance acceptable).  
**Risques :** Régression UX sur mobile.  
**Garde-fous :** Feature flag par établissement, A/B test.  
**Impact utilisateur :** Fort — perçu comme "nouveau planning".

### Phase 5 — Optimisation actions critiques (3-5 jours)

**Objectif :** Chaque action < 200ms perçu.

- [ ] **DUX-5** : Favoris en DB (table `planning_favorites`)
- [ ] **DUX-4** : Drag & drop avec mode move (option)
- [ ] Copie bulk instantanée (<200ms pour 20 employés)
- [ ] Publication semaine avec notification push

**Prérequis :** Phases 1-4.  
**Impact utilisateur :** Feeling "premium".

### Phase 6 — Déploiement progressif (continu)

- [ ] Feature flags par établissement
- [ ] Rollout 10% → 50% → 100%
- [ ] Monitoring performance et erreurs
- [ ] Collecte feedback utilisateur

---

## SECTION 12 — REGISTRE DES RISQUES

### Zones les plus dangereuses à toucher

| Zone | Pourquoi | Risque |
|---|---|---|
| `deleteShift.ts` / `markLeave.ts` (badge_events delete) | Suppression irréversible de pointages | Perte de données |
| `bulkActions.ts` (copy_previous_week) | Pas de transaction, break policy non recalculée | Données corrompues |
| `getWeek.ts` (net_minutes recalcul) | Double source de vérité | Divergence paie |
| `personnel_leaves` (dual writer) | Planning et absences écrivent tous deux | Conflit de données |
| `planning_weeks` (validation/invalidation/auto-publish) | 3 facteurs combinés = logique complexe | Bug de visibilité |
| RBAC (scope self/team) | Si mal implémenté, fuite de données | Sécurité |

### Tests indispensables avant toute modification

1. Créer un shift → vérifier `net_minutes` et `break_minutes` en DB
2. Supprimer un shift avec badge existant → vérifier que les badges sont archivés (post-fix)
3. Copier semaine avec break policy modifiée → vérifier `net_minutes` cible
4. Valider/invalider semaine → vérifier visibilité employé (scope self)
5. Copier semaine avec jour fermé (exception) → vérifier que les shifts sur ce jour sont exclus
6. Marquer CP sur un jour avec badge → vérifier que les badges sont archivés
7. Test RBAC : scope self ne doit pas voir les shifts d'autrui
8. Test concurrence : 2 managers modifient le même shift simultanément

### Feature flags recommandés

| Flag | Utilité |
|---|---|
| `planning_bulk_copy_v2` | Copie multi-employé atomique |
| `planning_inline_edit` | Saisie rapide sans modale |
| `planning_legal_warnings` | Warnings repos/durée max |
| `planning_favorites_db` | Favoris en base de données |
| `planning_archive_badges` | Archive au lieu de DELETE badge_events |

### Métriques à suivre

| Métrique | Seuil d'alerte |
|---|---|
| `get_week` latence P95 | > 800ms |
| `create_shift` latence P95 | > 600ms |
| `copy_previous_week` latence P95 | > 2000ms |
| Erreurs RBAC (403) | > 5/jour (potentiel bug de scope) |
| `badge_events` supprimés par planning | Toute suppression (tant que l'archive n'est pas en place) |

---

## TOP 10 DES ACTIONS PRIORITAIRES

| # | Action | Type | Impact | Effort |
|---|---|---|---|---|
| **1** | Archiver badge_events au lieu de DELETE | Métier/Sécurité | Évite perte de données irréversible | 1 jour |
| **2** | Copie bulk multi-employé (RPC transactionnelle) | Performance/UX | Copie 10× plus rapide | 2-3 jours |
| **3** | Recalculer break à la copie | Métier | Évite net_minutes incorrects | 0.5 jour |
| **4** | Factoriser RBAC en middleware | Architecture | -150ms par mutation, maintenance | 2 jours |
| **5** | Optimiser rextra_balance (cache/incrémental) | Performance | -200ms sur get_week | 1-2 jours |
| **6** | Saisie rapide inline (sans modale) | UX | Productivité ×3 pour la planification | 3 jours |
| **7** | Warnings légaux (repos 11h, max 10h/j) | Métier/Conformité | Conformité code du travail | 2 jours |
| **8** | Favoris en DB (remplacer localStorage) | Architecture/UX | Multi-device, fiabilité | 1.5 jour |
| **9** | Index unique personnel_leaves | Métier/Sécurité | Empêche doublons congés | 0.5 jour |
| **10** | Bypass page d'entrée si 1 département | UX | -1 clic systématique | 0.5 jour |

---

> **Légende :** ✅ OBSERVÉ dans le code | ⚠️ INFÉRÉ du comportement | ❌ ABSENT | **À CONFIRMER** nécessite vérification terrain

---
---

# ANNEXES — LIVRABLES COMPLÉMENTAIRES

---

## ANNEXE A — MATRICE DES SOURCES DE VÉRITÉ

| Concept métier | Source de vérité | Données dérivées autorisées | Lecteurs | Écrivains | Risque actuel | Recommandation |
|---|---|---|---|---|---|---|
| **Horaire prévu (shift)** | `planning_shifts` (colonnes `start_time`, `end_time`, `break_minutes`, `net_minutes`) | `totalsByEmployee` (agrégé en mémoire dans `getWeek.ts`) | Planning UI, Paie (`payroll.compute.ts`), Dashboard, Badgeuse (overlap check) | Edge function `planning-week` (create/update/delete/copy) | ⚠️ `net_minutes` est **recalculé** dans `getWeek.ts` L284-296 au lieu d'utiliser la valeur stockée → risque de divergence si la formule évolue | Utiliser `net_minutes` stocké comme SSOT ; ne recalculer que lors de la mutation (create/update/copy) |
| **Horaire réalisé** | `badge_events.effective_at` + `sequence_index` | `late_minutes`, `early_departure_minutes` (calculés dans `badge-events` edge function) | Présence UI, Paie, Rapports | Edge function `badge-events` uniquement | ✅ SSOT clair, un seul écrivain | Aucun changement |
| **Pointage brut** | `badge_events.occurred_at` | `effective_at` = version normalisée (arrondie selon tolérance) | Présence, Audit | Edge function `badge-events` | ✅ Mais DELETE physique par `planning-week` (deleteShift, markLeave) | **CRITIQUE** : archiver au lieu de supprimer |
| **Absence / CP / Repos / AM** | `personnel_leaves` (colonnes `leave_type`, `leave_date`, `status`) | Aucune dérivée stockée ; filtrée en mémoire dans `getWeek.ts` et `payroll.compute.ts` | Planning, Paie, Module Congés/Absences, Dashboard | **Dual writer** : `planning-week` (markLeave, cancelLeave) ET `absence-declaration` edge function | ⚠️⚠️ **RISQUE ÉLEVÉ** : deux modules écrivent sans verrouillage croisé ; pas d'index unique `(establishment_id, user_id, leave_date)` → doublons possibles | 1) Ajouter index unique composite 2) À terme, centraliser l'écriture dans un service dédié `leave-service` |
| **Disponibilité employé** | ❌ **ABSENTE** — aucune table, aucune API | — | — | — | ❌ Planning aveugle aux contraintes de disponibilité | Créer `employee_availabilities` (phase future) |
| **Validation / Publication** | `planning_weeks` (colonnes `week_validated`, `validated_days` JSONB, `week_invalidated_at`) | `autoPublishActive` (calculé dans `getWeek.ts` via `isAutoPublishActive()`) | Planning UI (TopBar, VisibilityPanel), Employé (read-only) | Edge function `planning-week` (validatePlanning) | ⚠️ Logique complexe à 3 facteurs (week_validated + week_invalidated_at + auto-publish). Priorité correcte mais fragile. | Documenter la table de vérité des 3 facteurs ; ajouter tests exhaustifs |
| **Heures contractuelles** | `employee_details.contract_hours` | `monthlyHours` (calculé dans `payroll.compute.ts` via `WEEKS_PER_MONTH`) | Paie, Rapports | Edge function `employees` (admin only) | ✅ SSOT clair | Aucun changement |
| **Heures supplémentaires** | ❌ **Pas de table** — calculées on-the-fly dans `payroll.compute.ts` | Résultat = donnée volatile, jamais persistée | Paie UI uniquement | Personne (calcul pur) | ⚠️ Si la logique de calcul change, les valeurs historiques changent rétroactivement | **À CONFIRMER** : faut-il snapshot les extras mensuels ? |
| **R-Extra (repos compensateur)** | `planning_rextra_events` (événements) | `rextraBalanceByEmployee` (agrégé dans `rextraBalance.ts` — calcul complet historique) | Planning UI (badge + dialog) | Edge function `planning-week` (create/cancel rextra) | ⚠️ Calcul N×historique à chaque `get_week` (~200-350ms) | Cache incrémental ou table de balance dénormalisée (projection, pas SSOT) |
| **Poste / Équipe** | `user_teams` + `teams` | `team_name` injecté dans le payload `getWeek` | Planning, RBAC scope | Admin (module personnel) | ✅ SSOT clair | Aucun changement |
| **Break policy** | `establishment_break_policies` (JSON rules) | `break_minutes` calculé et stocké dans `planning_shifts` à la création | Planning (create/update shift) | Admin (settings) | ⚠️ Copie de semaine ne recalcule PAS → `break_minutes` obsolète possible | Forcer recalcul à la copie |
| **Horaires d'ouverture** | `establishment_opening_hours` + `establishment_opening_exceptions` | `openingByDate` (construit dans `getWeek.ts`) | Planning (validation shift), UI (coloration fermé) | Admin (settings) | ⚠️ Copie ne vérifie pas opening hours cible | Ajouter validation opening à la copie |
| **Favoris planning** | ❌ `localStorage` (frontend) | — | Frontend uniquement | Frontend direct | ⚠️⚠️ **Non SSOT** : perdu au changement de navigateur/device | Persister en DB (`planning_favorites`) |
| **Service day (cutoff)** | `establishments.service_day_cutoff` + RPC `get_service_day_now()` | Date du jour de service (calculée) | Badgeuse, Planning (employé week start), Présence | Admin (settings) | ✅ SSOT via RPC backend | Aucun changement |

---

## ANNEXE B — MATRICE DE DÉCOUPLAGE INTER-MODULES

| Module A | Module B | Nature du lien | Sens du flux | Sync / Async | Risque | Recommandation |
|---|---|---|---|---|---|---|
| **Planning** | **Badgeuse** | Lecture overlap check : `create/updateShift` lit `badge_events` pour vérifier chevauchement | Planning → Badgeuse | **Synchrone** (dans la mutation) | ⚠️ Moyen : ajoute ~50ms par mutation ; si `badge_events` est indisponible, la mutation échoue | Acceptable — garde la cohérence |
| **Planning** | **Badgeuse** | Suppression physique : `deleteShift` et `markLeave` font `DELETE FROM badge_events` | Planning → Badgeuse | **Synchrone** | ⚠️⚠️ **CRITIQUE** : perte irréversible de pointages ; couplage écriture dangereux | **Archiver** au lieu de DELETE ; ne jamais supprimer un `badge_event` depuis le planning |
| **Planning** | **Absences/Congés** | Écriture partagée dans `personnel_leaves` | Planning ↔ Absences | **Synchrone** (chacun écrit directement) | ⚠️⚠️ **ÉLEVÉ** : dual writer sans verrouillage = risque de doublon, conflit, incohérence | 1) Index unique immédiat 2) À terme, service `leave-service` centralisé |
| **Planning** | **Absences/Congés** | Lecture dans `getWeek` pour afficher les jours de congé | Planning ← Absences | **Synchrone** (dans get_week) | ✅ Faible — lecture seule | Aucun changement |
| **Planning** | **Paie** | Lecture des shifts pour calcul salaire : `payroll.compute.ts` lit `planning_shifts.net_minutes` | Paie ← Planning | **Async** (React Query, frontend) | ⚠️ Moyen : la paie fait confiance au `net_minutes` stocké ; si celui-ci diverge du recalcul `getWeek`, les montants diffèrent | Aligner : SSOT = `net_minutes` stocké, stop recalcul dans `getWeek` |
| **Planning** | **Paie** | Fenêtre de lecture élargie : extras hebdo calculent lundi→dimanche, potentiellement à cheval sur 2 mois | Paie ← Planning | **Async** | ⚠️ Moyen : la logique de rattachement au mois (dimanche) est dans `payroll.compute.ts` (frontend) | Acceptable si documenté ; risque si la logique est dupliquée |
| **Planning** | **Personnel** | Lecture des profils, équipes, user_establishments dans `getWeek` | Planning ← Personnel | **Synchrone** (parallel queries dans get_week) | ✅ Faible — lecture seule, données stables | Potentiellement cache 5min côté edge function |
| **Planning** | **Settings (Break Policy)** | Lecture dans `createShift`/`updateShift` pour calculer la pause automatique | Planning ← Settings | **Synchrone** | ✅ Faible | ⚠️ Mais PAS lu à la copie → `break_minutes` obsolète |
| **Planning** | **Settings (Opening Hours)** | Lecture + exceptions dans `getWeek`, validation dans `createShift`/`updateShift` | Planning ← Settings | **Synchrone** | ✅ Faible | ⚠️ Mais PAS validé à la copie |
| **Planning** | **R-Extra** | Lecture/écriture `planning_rextra_events` ; calcul balance historique | Planning ↔ R-Extra | **Synchrone** (dans get_week) | ⚠️ Moyen : calcul N×historique ajoute ~200-350ms | Cache incrémental ou projection dénormalisée |
| **Planning** | **Realtime** | Écoute `planning_shifts` et `planning_weeks` via Supabase Realtime → invalidation React Query | Realtime → Planning | **Async** (websocket) | ✅ Bien isolé via `usePlanningChannels.ts` | Aucun changement |
| **Planning** | **Contrats** | Lecture implicite : `employee_details.contract_hours` n'est PAS lu par le planning directement | Aucun flux direct | — | ✅ Pas de couplage direct | Le planning ne connait pas les heures contractuelles — c'est la paie qui fait le lien |
| **Planning** | **Notifications** | Publication semaine → pas de notification push observée | — | — | ❌ **ABSENT** : publier un planning ne notifie pas les employés | Ajouter notification push/in-app à la validation de semaine |

---

## ANNEXE C — FEUILLE DE ROUTE TECHNIQUE (8 SEMAINES)

### Semaine 1-2 : MUST HAVE — Sécurisation métier

| # | Item | Valeur utilisateur | Risque métier | Risque technique | Dépendances | Test de validation | Priorité |
|---|---|---|---|---|---|---|---|
| C1 | **Archiver `badge_events` au lieu de DELETE** dans `deleteShift.ts` et `markLeave.ts` | Invisible | ⚠️⚠️ CRITIQUE : perte de données irréversible | Faible : table archive existe déjà | Aucune | Supprimer un shift avec badges → vérifier badges dans archive, pas supprimés | **MUST** |
| C2 | **Index unique `personnel_leaves(establishment_id, user_id, leave_date)`** | Invisible | ⚠️⚠️ Empêche doublons congés | Faible : migration SQL simple | Aucune | Tenter d'insérer 2 congés même jour → erreur unique constraint | **MUST** |
| C3 | **Recalculer `break_minutes`/`net_minutes` à la copie de semaine** | Heures correctes après changement de break policy | ⚠️ `net_minutes` faux si break policy a changé | Faible : appeler `computeBreak()` existant | `breakPolicy.ts` déjà disponible | Changer break policy → copier → vérifier `net_minutes` recalculé | **MUST** |
| C4 | **Valider opening hours à la copie de semaine** | Shifts copiés respectent fermetures exceptionnelles | ⚠️ Shifts sur jours fermés | Faible : réutiliser `openingHours.ts` | `openingHours.ts` déjà disponible | Ajouter exception fermé → copier → shift exclu | **MUST** |

### Semaine 3-4 : MUST HAVE — Architecture & Performance

| # | Item | Valeur utilisateur | Risque métier | Risque technique | Dépendances | Test de validation | Priorité |
|---|---|---|---|---|---|---|---|
| C5 | **Factoriser RBAC en middleware partagé** (`RequestContext` étendu à tous les handlers) | -150ms par mutation | Nul si bien implémenté | ⚠️ Moyen : régression RBAC possible | Aucune | Tests red/blue team RBAC existants (55 tests) | **MUST** |
| C6 | **RPC `planning_copy_week_bulk`** — copie multi-employé atomique en 1 transaction | Copie 10× plus rapide | Nul | ⚠️ Moyen : nouvelle RPC SQL | C3 (break recalcul) + C4 (opening validation) | Copier 15 employés → < 500ms, résultat identique à copie unitaire | **MUST** |
| C7 | **Arrêter le recalcul `net_minutes` dans `getWeek.ts`** — utiliser la valeur stockée | -10ms get_week, cohérence paie | Nul | Faible | Aucune | Créer shift → lire via get_week → `net_minutes` identique en DB et payload | **MUST** |
| C8 | **Optimiser `rextraBalance`** — calcul incrémental ou cache server-side | -200ms sur get_week | Nul | ⚠️ Moyen : invalidation cache | Aucune | Profiler before/after : P95 get_week < 400ms | **SHOULD** |

### Semaine 5-6 : SHOULD HAVE — UX critique

| # | Item | Valeur utilisateur | Risque métier | Risque technique | Dépendances | Test de validation | Priorité |
|---|---|---|---|---|---|---|---|
| C9 | **Saisie rapide inline** : clic cellule → input "9h-17h" → Entrée (sans modale) | Productivité ×3 | Nul | ⚠️ Moyen : UX complexe, mobile | C5 (RBAC middleware) | Créer shift inline → vérifier DB, break appliqué | **SHOULD** |
| C10 | **Bouton "Copier toute la semaine"** (bulk multi-employé) | 1 clic au lieu de N | Nul | Faible | C6 (RPC bulk) | Clic → tous les employés copiés en < 500ms | **SHOULD** |
| C11 | **Bypass page d'entrée si 1 seul département** | -1 clic systématique | Nul | Faible | Aucune | Établissement avec 1 équipe → accès direct grille | **SHOULD** |
| C12 | **Total heures par colonne/jour** en en-tête de grille | Visibilité charge globale | Nul | Faible | Aucune | Vérifier somme = total des shifts du jour | **SHOULD** |
| C13 | **Warnings visuels** : repos <11h, shift >10h, semaine >48h (non bloquants) | Conformité code du travail | ⚠️ Conformité légale | ⚠️ Moyen : calcul inter-jour | Aucune | Shift de 11h → warning affiché ; deux shifts avec 9h gap → warning repos | **SHOULD** |

### Semaine 7-8 : LATER — Polish & Premium

| # | Item | Valeur utilisateur | Risque métier | Risque technique | Dépendances | Test de validation | Priorité |
|---|---|---|---|---|---|---|---|
| C14 | **Favoris en DB** (`planning_favorites`) | Multi-device, fiabilité | Nul | Faible | Migration DB | Enregistrer favori → vérifier en DB, retrouver sur autre device | **LATER** |
| C15 | **Drag & drop mode "move"** (supprime la source) | UX plus intuitive | Nul | ⚠️ Moyen : gestion état optimiste | Aucune | Drag shift jour A → jour B : shift supprimé de A, créé en B | **LATER** |
| C16 | **Notification push à la publication** | Employés informés immédiatement | Nul | ⚠️ Moyen : infra push | Module notifications | Publier semaine → notification reçue par employés concernés | **LATER** |
| C17 | **Templates de planning serveur** (modèles hebdo réutilisables) | Création rapide semaine type | Nul | ⚠️ Moyen : nouveau modèle de données | C6 (bulk copy), C14 (favoris DB) | Sauver template → appliquer → planning identique au modèle | **LATER** |
| C18 | **Export planning PDF/Excel** | Impression, archivage légal | Nul | Faible | Aucune | Export → fichier contient tous les shifts de la semaine | **LATER** |

---

## ANNEXE D — ARCHITECTURE CIBLE DU MODULE PLANNING

### Principes directeurs

1. **Une seule source de vérité par concept** — jamais de duplication de données métier
2. **Projections de lecture autorisées** — mais toujours dérivées de la SSOT, invalidables
3. **Mutations côté backend uniquement** — le frontend ne calcule jamais de données métier à persister
4. **UI optimiste autorisée** — mais rollback automatique si le backend refuse

### Ce qui RESTE source de vérité (ne pas toucher)

| Entité | Table | Rôle | Aucune projection |
|---|---|---|---|
| Shifts planifiés | `planning_shifts` | SSOT horaires prévus | Le frontend lit, ne calcule jamais `net_minutes` à la place du serveur |
| Validation/publication | `planning_weeks` | SSOT état publié/brouillon | La logique à 3 facteurs reste côté serveur (`getWeek.ts`) |
| Congés/Absences | `personnel_leaves` | SSOT partagée | À terme, écrite par un service unique `leave-service` |
| Pointages | `badge_events` | SSOT horaires réalisés | **En lecture seule** depuis le planning (plus jamais DELETE) |
| Break policy | `establishment_break_policies` | SSOT règles de pause | Appliquée côté serveur uniquement |
| Opening hours | `establishment_opening_hours` + `_exceptions` | SSOT horaires d'ouverture | Validée côté serveur uniquement |

### Ce qui PEUT devenir projection de lecture (cache invalidable)

| Donnée | SSOT source | Projection proposée | Mécanisme d'invalidation | Gain estimé |
|---|---|---|---|---|
| `rextraBalanceByEmployee` | `planning_rextra_events` | Table `planning_rextra_balances` (dénormalisée) OU cache mémoire edge function | Trigger DB sur INSERT/DELETE `planning_rextra_events` recalcule le solde | -200ms sur `get_week` |
| `totalsByEmployee` (heures hebdo) | `planning_shifts.net_minutes` | Champ `total_minutes` dans `planning_weeks` (par semaine par employé) | Trigger ou recalcul à chaque mutation shift | -20ms (faible gain, optionnel) |
| `openingByDate` (horaires d'ouverture de la semaine) | `establishment_opening_hours` + exceptions | Cache edge function (TTL 5min) | TTL expiration — ces données changent rarement | -30ms |
| Profils + équipes employés | `profiles` + `user_teams` | Vue matérialisée ou cache edge function (TTL 5min) | TTL — ces données changent rarement | -40ms |

> **RÈGLE** : Toute projection de lecture DOIT être dérivable à 100% de sa SSOT. Si la projection diverge, le système doit pouvoir la reconstruire intégralement à partir de la SSOT sans perte.

### Ce qui DOIT rester dans le domaine backend

| Responsabilité | Pourquoi | Actuellement |
|---|---|---|
| Calcul `break_minutes` et `net_minutes` | Règle métier (break policy) | ✅ Backend — **ne pas déplacer** |
| Validation overlap (shifts + badges) | Intégrité données, atomicité | ✅ Backend |
| Validation opening hours | Règle métier | ✅ Backend |
| RBAC scope filtering | Sécurité | ✅ Backend — factoriser en middleware |
| Calcul auto-publish | Logique temporelle complexe | ✅ Backend |
| Copie de semaine (bulk) | Transaction atomique, recalcul break | ⚠️ Backend mais pas transactionnel → à corriger |
| Suppression/archivage badge_events | Intégrité données | ⚠️ Backend mais DELETE → à changer en archive |
| Warnings légaux (repos 11h, max 10h/j) | Conformité code du travail | ❌ **ABSENT** → à ajouter côté backend, retourné dans le payload `get_week` |

### Ce qui PEUT être optimisé dans l'UI (sans logique métier)

| Optimisation UI | Description | Pré-requis backend |
|---|---|---|
| **Saisie rapide inline** | Parser "9-17" ou "9h-17h" côté UI, envoyer `start_time`/`end_time` au backend qui calcule le reste | Backend calcule `break_minutes`, `net_minutes`, vérifie overlap et opening |
| **Optimistic update unifié** | 1 helper partagé pour create/update/delete/drag : met à jour le cache React Query immédiatement, rollback sur erreur | Backend retourne la donnée finale (shift complet) pour reconciliation |
| **Prefetch adjacent weeks** | Déjà en place (`usePrefetchAdjacentWeeks`) — garder | Backend doit rester rapide (<300ms) |
| **Mémorisation dernier département** | `localStorage` ou `sessionStorage` (pas de données métier) | Aucun |
| **Filtrage client-side par équipe** | Déjà en place (useMemo) — garder en complément du filtrage server-side | Aucun |
| **Affichage warnings** | Le backend retourne les warnings dans le payload → le frontend les affiche | Backend doit calculer et retourner les warnings |

### Ce qui DOIT être instrumenté

| Métrique / Instrumentation | Pourquoi | Comment |
|---|---|---|
| **Latence `get_week` P50/P95** | Objectif < 300ms P95 | Profiler edge function (déjà en place via `profiler.ts`) — ajouter export vers analytics |
| **Latence mutations P95** | Objectif < 500ms P95 | Logger dans chaque handler |
| **Taux d'erreur RBAC (403)** | Détection de bugs de scope | Logger + alerter si > 5/jour |
| **Nombre de `badge_events` supprimés** | Suivi tant que l'archive n'est pas en place | Logger chaque DELETE avec user_id, shift_id, count |
| **Taux d'utilisation copie semaine** | Dimensionner l'optimisation bulk | Compter les appels `copy_previous_week` |
| **Temps perçu côté client** | UX réelle | `performance.mark()` entre clic et rendu final |
| **Erreurs de parsing saisie rapide** | Qualité de la saisie inline (quand implémentée) | Logger les inputs non parsés |

### Diagramme d'architecture cible

```
┌──────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                             │
│                                                               │
│  PlanningGrid                                                 │
│  ├── InlineShiftInput (parse "9-17" → {start, end})          │
│  ├── OptimisticCacheHelper (shared create/update/delete)     │
│  ├── WarningBadges (affiche warnings du payload)             │
│  ├── DayTotalHeader (somme net_minutes par colonne)          │
│  └── usePlanningWeek (React Query, staleTime 30s)            │
│                                                               │
│  Aucune logique métier :                                      │
│  - pas de calcul break                                        │
│  - pas de calcul net_minutes                                  │
│  - pas de validation overlap                                  │
│  - pas de calcul extras                                       │
│  Tout vient du payload serveur.                               │
└─────────────────────────┬────────────────────────────────────┘
                          │ POST /planning-week
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ EDGE FUNCTION: planning-week                                  │
│                                                               │
│  ┌─────────────────────────────────┐                         │
│  │ Middleware (shared)             │                         │
│  │ ├── Auth (getUser)              │                         │
│  │ ├── RBAC (RequestContext)       │  ← factorisé           │
│  │ └── Profiler                    │                         │
│  └─────────────┬───────────────────┘                         │
│                │                                              │
│  ┌─────────────┴───────────────────┐                         │
│  │ READ path (get_week)           │                         │
│  │ ├── Parallel DB queries         │                         │
│  │ ├── rextra balance (cached)     │  ← projection          │
│  │ ├── Legal warnings (computed)   │  ← NOUVEAU             │
│  │ └── Response build              │                         │
│  └─────────────────────────────────┘                         │
│                                                               │
│  ┌─────────────────────────────────┐                         │
│  │ WRITE path (mutations)         │                         │
│  │ ├── create_shift (+ break calc) │                         │
│  │ ├── update_shift (+ break calc) │                         │
│  │ ├── delete_shift (+ archive)    │  ← archive, pas delete │
│  │ ├── copy_week_bulk (RPC tx)     │  ← NOUVEAU             │
│  │ ├── mark_leave (+ archive)      │  ← archive, pas delete │
│  │ └── validate_week (+notif)      │  ← NOUVEAU             │
│  └─────────────────────────────────┘                         │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ DATABASE (PostgreSQL)                                         │
│                                                               │
│  SSOT Tables (jamais de projection ici) :                    │
│  ├── planning_shifts           ← shifts prévus               │
│  ├── planning_weeks            ← validation/publication      │
│  ├── personnel_leaves          ← congés (writer unique term) │
│  ├── badge_events              ← pointages (READ ONLY)       │
│  ├── planning_rextra_events    ← événements R-Extra          │
│  └── establishment_* (config)  ← break, opening, day_parts  │
│                                                               │
│  Projections (dérivées, invalidables) :                      │
│  ├── planning_rextra_balances  ← cache solde R-Extra         │
│  └── (optionnel) vue employees_with_teams                    │
│                                                               │
│  Archive :                                                    │
│  └── badge_events_duplicates_archive ← badges archivés      │
└──────────────────────────────────────────────────────────────┘
```

### Résumé des changements architecturaux vs. état actuel

| Aspect | Aujourd'hui | Cible | Type de changement |
|---|---|---|---|
| `net_minutes` | Recalculé dans `getWeek` + stocké en DB | Stocké en DB = SSOT, lu tel quel | Suppression de code |
| RBAC | Dupliqué dans chaque handler | Middleware `RequestContext` partagé | Refactoring |
| `badge_events` suppression | DELETE physique | Archive (soft delete) | Changement comportement |
| Copie semaine | 1 employé × N requêtes | RPC transactionnelle bulk | Nouvelle RPC |
| `rextra` balance | Calcul complet historique à chaque get_week | Projection incrémentale (cache ou table) | Optimisation |
| Warnings légaux | Absents | Calculés serveur, retournés dans payload | Ajout fonctionnel |
| Favoris | `localStorage` | Table `planning_favorites` en DB | Migration |
| Notifications publication | Absentes | Push/in-app à la validation semaine | Ajout fonctionnel |
| Saisie shifts | Modale systématique | Inline rapide + modale en fallback | Refonte UX ciblée |

> **Principe fondamental** : L'architecture cible ne crée **aucune nouvelle source de vérité**. Les seules nouvelles tables sont des **projections de lecture** (dérivées et reconstructibles) ou des tables d'**archive** (append-only, non lues en temps réel).
