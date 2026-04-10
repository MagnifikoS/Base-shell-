# ÉVALUATION DE RISQUES — V0 OPTIMISATION MODULE PLANNING

> **Date** : 2026-03-08  
> **Statut** : Analyse de risques uniquement — AUCUNE modification de code  
> **Base** : Audit ÉTAPE 0 (2026-03-07) + Audit complet Planning  
> **Méthode** : Analyse croisée code source × mesures réseau × architecture × dépendances inter-modules

---

## SECTION 1 — RÉSUMÉ EXÉCUTIF RISQUES V0

### Niveau de risque global : 🟠 MODÉRÉ À ÉLEVÉ

La V0 est **faisable** mais contient **3 chantiers à haut risque** qui nécessitent des garde-fous stricts avant exécution.

### Niveau de confiance : 🟡 75%
- Haute confiance sur les risques architecturaux (code lu en détail)
- Moyenne confiance sur les impacts inter-modules (certains flux testés, d'autres inférés)
- Faible confiance sur les scénarios de charge (pas de test de volumétrie)

### Principaux bénéfices potentiels

| # | Bénéfice | Gain estimé |
|---|----------|-------------|
| 1 | `get_week` plus rapide (différer rextraBalance) | -500 à -1500ms |
| 2 | Mutations ressenties comme instantanées (optimistic UI) | Perception immédiate |
| 3 | Copie semaine en 1 appel bulk | De N×1.5s à ~500ms |
| 4 | RBAC factorisé | -300ms par mutation |
| 5 | Moins de refetch globaux | -3s post-mutation |

### Principaux dangers potentiels

| # | Danger | Gravité |
|---|--------|---------|
| 1 | Optimistic UI affiche un état que le backend refuse → confusion utilisateur | 🔴 Critique |
| 2 | Invalidation trop ciblée → données périmées affichées sans que l'utilisateur le sache | 🔴 Critique |
| 3 | Refactoring RBAC middleware → régression de sécurité (accès non autorisé) | 🔴 Critique |
| 4 | Copie bulk sans transaction → état incohérent partiel (déjà existant, amplifié) | 🟠 Fort |
| 5 | Différé rextraBalance → balance R-Extra temporairement absente, confusion manager | 🟡 Moyen |

### Top 10 des points à sécuriser AVANT toute modification

| # | Point | Type |
|---|-------|------|
| 1 | Tests de non-régression RBAC exhaustifs (55 tests red/blue existants à vérifier) | Sécurité |
| 2 | Confirmer que rextraBalance peut être lazy (pas nécessaire pour la grille initiale) | Métier |
| 3 | Définir le comportement exact du rollback optimistic en cas d'erreur | UX |
| 4 | Valider que la suppression physique des `badge_events` est un bug (pas un choix métier) | Métier |
| 5 | Inventorier TOUS les consommateurs de `invalidatePlanning()` avant de le modifier | Architecture |
| 6 | Confirmer que la paie utilise `net_minutes` stocké en DB (pas le recalcul de `getWeek`) | Métier |
| 7 | Tester la copie bulk sur 15+ employés avec données réelles avant déploiement | Performance |
| 8 | Feature flag pour chaque chantier V0 (rollback individuel) | Opérations |
| 9 | Métriques de latence avant/après (baseline mesurable) | Observabilité |
| 10 | Plan de rollback documenté pour chaque chantier | Opérations |

---

## SECTION 2 — RAPPEL DU PÉRIMÈTRE V0 ANALYSÉ

### Ce qui fait partie de la V0

| # | Chantier | Objectif |
|---|----------|----------|
| V0-1 | Alléger le chemin critique d'ouverture | Différer rextraBalance, réduire le payload `get_week` |
| V0-2 | Différer calculs/chargements secondaires | Lazy load rextra, leaves, prefetch |
| V0-3 | Réduire rechargements complets après mutation | Invalidation ciblée au lieu de `invalidatePlanning()` global |
| V0-4 | Améliorer réaction locale create/update/delete | Optimistic updates cohérents |
| V0-5 | Restructurer la copie de semaine | Bulk RPC atomique |
| V0-6 | Réduire invalidations trop larges | Scopage fin des query keys |
| V0-7 | Corriger anomalies bloquantes (étape 0) | Employés sans équipe, etc. |

### Ce qui NE DOIT SURTOUT PAS être touché

| Élément | Raison |
|---------|--------|
| Logique de calcul `break_minutes` / `net_minutes` | Règle métier — SSOT backend |
| Logique de validation overlap (shifts + badges) | Règle métier — intégrité données |
| Logique auto-publish (3 facteurs) | Logique temporelle complexe, fragile |
| Table `badge_events` (structure) | Partagée avec badgeuse/présence |
| Table `personnel_leaves` (structure) | Partagée avec absences/congés |
| Sécurité RBAC (résultat) | Les contrôles doivent donner le même résultat |
| `planning_shifts` comme SSOT | Jamais de cache/projection qui remplace la DB |

### Ce qui est à la FRONTIÈRE — validation explicite requise

| Élément | Question à trancher |
|---------|---------------------|
| `invalidatePlanning()` → cascade `payroll` | Peut-on retirer l'invalidation payroll du chemin planning sans casser la paie ? |
| `rextraBalance` dans `get_week` | Les managers utilisent-ils le solde R-Extra dans la grille pour prendre des décisions de planning ? |
| `personnel_leaves` query séparée | Peut-on la différer après le premier rendu de la grille ? |
| `net_minutes` recalcul dans `getWeek.ts` | Qui consomme cette valeur ? Le frontend uniquement ou aussi la paie ? |
| Prefetch ±1 semaine | Le gain de navigation justifie-t-il 3× la charge serveur ? |

---

## SECTION 3 — MATRICE DES CHANGEMENTS ENVISAGÉS

| Changement envisagé | Objectif | Gain attendu | Zone touchée | Type de risque | Niveau risque | Dépendances | Confiance | Commentaire |
|---------------------|----------|-------------|-------------|---------------|--------------|-------------|-----------|-------------|
| Différer `rextraBalance` hors `get_week` | Réduire latence ouverture | -500 à -1500ms | `getWeek.ts`, `rextraBalance.ts` | Cohérence | 🟡 Moyen | Aucune | ✅ Haute | Solde R-Extra absent temporairement ; UX à gérer |
| Réduire prefetch de ±1 à +1 seul | Réduire charge serveur | -1 appel/navigation | `usePrefetchAdjacentWeeks` | Performance | 🟢 Faible | Aucune | ✅ Haute | Navigation arrière légèrement plus lente |
| Optimistic update create/update/delete | Perception instantanée | -3s perçu | `useCreateShift`, `useUpdateShift`, `useDeleteShift` | Cohérence, UX | 🟠 Fort | Gestion rollback | 🟡 Moyenne | Risque d'état trompeur si le backend refuse |
| Invalidation ciblée (remplacer `invalidatePlanning` global) | Éviter refetch complet | -3s post-mutation | `invalidators.ts`, hooks mutations | Cohérence, inter-modules | 🔴 Critique | Identifier TOUS les consommateurs | 🟡 Moyenne | Risque de données périmées non détectées |
| RBAC middleware partagé | -300ms/mutation | -300ms | `requestContext.ts`, tous les handlers | Sécurité | 🔴 Critique | Tests red/blue team | 🟡 Moyenne | Régression RBAC = fuite de données |
| Bulk RPC copie semaine | Copie 10× plus rapide | N×1.5s → 500ms | `bulkActions.ts`, nouvelle RPC | Métier, cohérence | 🟠 Fort | Break recalcul, opening validation | 🟡 Moyenne | Nouveau code SQL critique |
| Corriger employés sans équipe | UX fondamentale | Déblocage fonctionnel | `getWeek.ts` (filtre scope) | UX, métier | 🟡 Moyen | Décision métier (afficher ou forcer) | ✅ Haute | Décision métier préalable requise |

---

## SECTION 4 — RISQUES PAR CHANTIER V0

### 4.1 — Allègement du chargement initial (V0-1)

**Objectif** : Retirer `rextraBalance` du chemin critique de `get_week`

**Hypothèse sous-jacente** : Le solde R-Extra n'est pas nécessaire pour le rendu initial de la grille planning.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🟡 Moyen | Si un manager utilise le solde R-Extra pour décider des affectations, l'absence temporaire le prive d'information critique |
| **Cohérence** | 🟢 Faible | Le solde R-Extra est une donnée dérivée (projection), pas une SSOT — son absence temporaire ne corrompt rien |
| **Inter-modules** | 🟢 Faible | R-Extra est lu uniquement par le planning UI, pas par d'autres modules |
| **UX** | 🟡 Moyen | L'apparition décalée du badge R-Extra (ex: 500ms après la grille) peut créer un "pop-in" visuellement désagréable |
| **Technique** | 🟢 Faible | Modification isolée dans `getWeek.ts` — retirer l'appel `computeRextraBalanceForUsers` du flux principal et le déplacer dans un endpoint séparé ou un appel lazy côté frontend |
| **Sécurité** | 🟢 Faible | Pas de changement de permissions |

**Cas limites** :
- Semaine avec beaucoup de R-Extra consommés : le badge apparaît en retard mais la donnée est correcte
- Employé avec solde R-Extra = 0 : aucun impact visuel

**Gravité** : 🟡 Moyenne | **Probabilité** : 🟢 Faible | **Détectabilité** : ✅ Facile (badge R-Extra visible/absent)

**Garde-fous** :
- Skeleton/spinner dédié pour la zone R-Extra pendant le chargement lazy
- Feature flag `planning_lazy_rextra` pour rollback immédiat
- Confirmer avec l'équipe métier que le solde R-Extra n'est PAS utilisé pour les décisions d'affectation initiales

**Validations préalables** :
- [ ] Confirmer auprès des managers : "Avez-vous besoin du solde R-Extra DÈS l'ouverture du planning, ou après avoir vu la grille ?"
- [ ] Vérifier qu'aucun autre élément de la grille ne dépend du résultat de `rextraBalance`

---

### 4.2 — Différé de calculs / chargements secondaires (V0-2)

**Objectif** : Différer le prefetch ±1 semaine, le chargement des `personnel_leaves`, et l'invalidation payroll

**Hypothèse** : Ces données ne sont pas nécessaires pour le premier rendu visuel de la grille.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🟠 Fort pour `personnel_leaves` | Les congés/absences sont affichés dans la grille. Les différer = afficher une grille **partiellement fausse** (jour de congé affiché comme vide). **INACCEPTABLE.** |
| **Cohérence** | 🟡 Moyen | Si `personnel_leaves` est différé, un manager pourrait créer un shift sur un jour de CP avant que l'info arrive |
| **Inter-modules** | 🟢 Faible pour prefetch ±1 | Seule la navigation est impactée |
| **UX** | 🟡 Moyen | Prefetch ±1 accélère la navigation. Le supprimer dégrade la perception de fluidité lors du changement de semaine |
| **Technique** | 🟢 Faible | Modifications isolées dans les hooks frontend |
| **Sécurité** | 🟢 Faible | Pas de changement de permissions |

**⚠️ ALERTE CRITIQUE** : `personnel_leaves` ne peut PAS être différé. Les congés font partie intégrante de la grille planning. Un manager qui voit une cellule "vide" alors qu'il y a un CP approuvé prendrait des décisions erronées.

**Cas limites** :
- Semaine avec 5+ congés : grille fausse pendant le différé
- Manager qui crée un shift immédiatement après ouverture sur un jour de CP non encore chargé : le backend bloquera (overlap avec leave), mais le message d'erreur sera confus

**Gravité** : 🔴 Critique (pour leaves) / 🟢 Faible (pour prefetch) | **Probabilité** : 🟠 Moyenne | **Détectabilité** : 🟡 Moyenne (la grille semble normale mais est incomplète)

**Garde-fous** :
- **NE PAS différer `personnel_leaves`** — c'est une donnée essentielle de la grille
- Réduire prefetch de ±1 à +1 seul (garder la semaine suivante, pas la précédente)
- Différer uniquement `invalidatePayroll` après mutation planning (la paie n'est pas ouverte)

**Validations préalables** :
- [ ] Confirmer que `personnel_leaves` est bien dans `get_week` (OBSERVÉ : oui, dans `getWeek.ts`)
- [ ] Confirmer que le frontend consomme les leaves de `get_week`, pas d'une query séparée (OBSERVÉ : query séparée `personnel_leaves` AUSSI utilisée — à clarifier)
- [ ] Tester la suppression du prefetch -1 sur la navigation arrière (mesurer dégradation)

---

### 4.3 — Réduction des rechargements complets après mutation (V0-3)

**Objectif** : Après un create/update/delete shift, ne pas refetch toute la semaine mais patcher le cache localement.

**Hypothèse** : Une mutation d'un seul shift ne nécessite pas de recharger TOUS les shifts de TOUS les employés de la semaine.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🔴 Critique | `totalsByEmployee` doit être recalculé après mutation — si le patch local oublie le total, la grille est incohérente |
| **Cohérence** | 🔴 Critique | Si une mutation côté serveur modifie des données collatérales (ex: `planning_weeks.validated_days` updated par trigger, `rextraBalance` modifié), le patch local ne le saura pas |
| **Inter-modules** | 🟠 Fort | `invalidatePlanning` invalide aussi `["payroll", "month", ...]`. Si on ne l'appelle plus, la paie peut afficher des données périmées si le manager bascule vers la page paie |
| **UX** | 🟡 Moyen | Mutation concurrente : si un autre manager modifie la même semaine, le premier ne verra pas la modification tant que le refetch n'a pas lieu |
| **Technique** | 🟠 Fort | Le format du cache React Query pour `planning-week` est un objet complexe (`PlanningWeekData` avec `shiftsByEmployee`, `totalsByEmployee`, `rextraByEmployeeByDate`). Le patcher correctement est non trivial et source de bugs subtils. |
| **Sécurité** | 🟢 Faible | Pas de changement de permissions |

**⚠️ ALERTE** : La suppression du refetch complet est le chantier le plus **trompeur** de la V0. Il semble simple ("patcher le cache") mais la structure `PlanningWeekData` contient des données dérivées (`totalsByEmployee`, `rextraBalanceByEmployee`) qui doivent être recalculées en cohérence avec le serveur. Un patch partiel qui oublie un champ = **donnée affichée fausse sans signal d'erreur**.

**Cas limites** :
- Création de shift qui déclenche un dépassement des heures hebdo (extras) → `rextraBalance` change mais le patch local ne le sait pas
- Suppression de shift qui supprime aussi les `badge_events` (DELETE physique actuel) → le patch local ne reflète pas la suppression des badges
- Modification concurrente par 2 managers → cache local diverge du serveur

**Gravité** : 🔴 Critique | **Probabilité** : 🟠 Moyenne | **Détectabilité** : 🔴 Difficile (la donnée affichée semble correcte mais est périmée)

**Garde-fous** :
- **Approche hybride recommandée** : optimistic update immédiat PUIS refetch complet silencieux (background) pour corriger les dérivées
- Timer de réconciliation : si le refetch background n'a pas eu lieu dans les 5s, forcer
- Log en dev si le résultat du refetch diverge du patch optimistic (alerte divergence)
- Ne JAMAIS supprimer le refetch complet — seulement le rendre non-bloquant (background)

**Validations préalables** :
- [ ] Lister TOUS les champs de `PlanningWeekData` qui sont dérivés (calculés côté serveur, pas stockés en DB)
- [ ] Confirmer que `planning_shifts` est la seule table modifiée par create/update (pas de trigger caché)
- [ ] Vérifier si des triggers DB existent sur `planning_shifts` qui modifient d'autres tables

---

### 4.4 — Amélioration de la réaction locale create/update/delete (V0-4)

**Objectif** : Optimistic UI — afficher immédiatement le résultat attendu avant confirmation serveur.

**Hypothèse** : Le résultat d'une mutation simple (create/update/delete shift) est prévisible côté frontend.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🔴 Critique | **Le frontend ne connaît pas la break policy en détail.** Il ne peut pas prédire correctement `break_minutes` et `net_minutes`. L'affichage optimistic montrera des heures fausses (ex: shift 9h-17h affiché à 8h alors que la break policy donne 7h30). |
| **Cohérence** | 🟠 Fort | Le backend peut REJETER la mutation (overlap, jour fermé, badge conflict, max 2 shifts/jour). L'optimistic update doit rollback proprement — sinon le shift "fantôme" reste visible. |
| **Inter-modules** | 🟡 Moyen | La badgeuse vérifie l'overlap avec les shifts existants. Un optimistic shift non confirmé pourrait fausser la vérification (mais c'est côté serveur, pas côté client — risque faible). |
| **UX** | 🟠 Fort | **Rollback visible** : si le backend refuse, le shift disparaît après 1-2s. L'utilisateur a l'impression que "ça a marché puis ça a disparu" → confusion forte. Message d'erreur critique. |
| **Technique** | 🟡 Moyen | Les hooks `useCreateShift`, `useUpdateShift`, `useDeleteShift` existent déjà. L'audit principal note qu'ils ont déjà un pattern optimistic MAIS avec des implémentations légèrement différentes (ARCH-4). |
| **Sécurité** | 🟢 Faible | L'optimistic update est local au cache React Query — pas de donnée envoyée |

**Cas limites** :
- **Création rejetée** (overlap avec badge) → shift fantôme visible 1-2s puis disparaît
- **Modification rejetée** (hors horaires d'ouverture) → ancien horaire restauré avec un flash visuel
- **Suppression rejetée** (semaine validée entre-temps) → shift réapparaît
- **Erreur réseau** → shift fantôme permanent si pas de timeout de réconciliation
- **`break_minutes` imprédictible** → le total heures affiché est faux pendant 1-2s

**Gravité** : 🟠 Fort | **Probabilité** : 🟡 Moyenne | **Détectabilité** : 🟡 Moyenne (rollback visible = signal clair, mais confus)

**Garde-fous** :
- **Ne JAMAIS afficher `net_minutes` ou `break_minutes` optimistic** — laisser "..." ou un spinner sur le total jusqu'à confirmation serveur
- Toast d'erreur explicite en cas de rollback ("Le shift n'a pas pu être créé : chevauchement horaire")
- Timeout de réconciliation (5s) : si pas de réponse serveur, forcer refetch + alerter l'utilisateur
- Factoriser la logique optimistic en 1 seul helper (corriger ARCH-4) pour garantir un comportement uniforme

**Validations préalables** :
- [ ] Auditer les 3 hooks optimistic existants pour comprendre leur comportement de rollback actuel
- [ ] Lister TOUTES les raisons de rejet côté serveur (overlap, badge, opening hours, validation, max shifts, statut employé)
- [ ] Définir les messages d'erreur utilisateur pour chaque cas de rejet
- [ ] Décider : affiche-t-on `net_minutes` en optimistic (risque d'erreur) ou en "pending" (moins fluide) ?

---

### 4.5 — Restructuration de la copie de semaine (V0-5)

**Objectif** : Remplacer N appels `copy_previous_week` par 1 appel bulk atomique.

**Hypothèse** : Un seul appel transactionnel multi-employé donne le même résultat que N appels individuels.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🟠 Fort | La copie actuelle skip les employés qui échouent (partial success). Un bulk transactionnel = tout ou rien. Si 1 employé a un conflit (ex: shift sur jour fermé), AUCUN employé n'est copié. Comportement différent. |
| **Cohérence** | 🟡 Moyen | Le bulk doit recalculer `break_minutes` via la break policy courante (corrige un bug existant). Si le recalcul est mal fait, `net_minutes` faux pour TOUS les shifts copiés. |
| **Inter-modules** | 🟠 Fort | La copie actuelle copie aussi les `personnel_leaves`. Le bulk doit gérer les leaves correctement — risque de conflit avec le module absences si un congé a été ajouté/annulé entre-temps. |
| **UX** | 🟡 Moyen | Le passage de "partial success" à "all or nothing" peut frustrer si 1 employé bloque toute la copie. Un mode "best effort" (skip les erreurs) est plus user-friendly mais moins atomique. |
| **Technique** | 🟠 Fort | Nouvelle RPC SQL complexe avec INSERT...SELECT + gestion breaks + gestion leaves + gestion opening hours + validation. Beaucoup de logique à re-implémenter en SQL pur. |
| **Sécurité** | 🟡 Moyen | Le RBAC doit être vérifié 1 seule fois pour l'ensemble — s'assurer que le scope couvre TOUS les employés demandés |

**Cas limites** :
- Employé avec congé approuvé le mercredi de la semaine cible : la copie doit-elle skip ce jour ou écraser le congé ?
- Semaine cible partiellement validée (lundi validé, mardi non) : la copie doit-elle échouer entièrement ou copier seulement les jours non validés ?
- Break policy modifiée entre les 2 semaines : les `break_minutes` doivent être recalculés (nouveau comportement)
- 20+ employés avec 7 shifts chacun = 140+ INSERT : performance de la RPC ?
- Copie mode "merge" vs "replace" : le bulk doit supporter les deux

**Gravité** : 🟠 Fort | **Probabilité** : 🟡 Moyenne | **Détectabilité** : 🟡 Moyenne (résultat visible dans la grille)

**Garde-fous** :
- Implémenter le bulk en RPC PostgreSQL (pas en edge function JavaScript) pour la transaction atomique
- Supporter un mode "skip errors" en plus du mode "all or nothing" → retourner un rapport { copié: N, skippé: M, raisons: [...] }
- Tests unitaires : copie avec congés, copie avec jours fermés, copie avec break policy modifiée
- Feature flag `planning_bulk_copy_v2` pour rollback vers l'ancienne copie per-employee
- Comparer le résultat du bulk avec N copies individuelles sur les mêmes données

**Validations préalables** :
- [ ] Documenter le comportement actuel pour CHAQUE cas limite (congé existant, jour validé, break policy changée)
- [ ] Décider : "tout ou rien" vs "best effort avec rapport" ?
- [ ] Valider que la break policy peut être appelée depuis une RPC SQL (ou que le calcul peut être porté en SQL)
- [ ] Tester avec 20 employés × 7 jours × 2 shifts = 280 shifts pour la performance

---

### 4.6 — Réduction des invalidations trop larges (V0-6)

**Objectif** : Remplacer `invalidatePlanning()` (qui invalide TOUS les query keys planning + payroll) par des invalidations ciblées.

**Hypothèse** : Après une mutation sur un shift, seule la semaine en cours a besoin d'être invalidée, pas toutes les semaines en cache ni la paie.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🟡 Moyen | Les shifts chevauchant la frontière de semaine (overnight dimanche→lundi) pourraient nécessiter l'invalidation de 2 semaines |
| **Cohérence** | 🔴 Critique | `invalidatePlanning` cascade vers `["payroll", "month", ...]`. Si on ne l'appelle plus, le manager qui bascule vers la paie après avoir modifié le planning verra des données **périmées** sans le savoir. |
| **Inter-modules** | 🔴 Critique | La cascade payroll existe POUR UNE RAISON : un shift modifié change les heures travaillées → change le calcul de paie. Supprimer cette cascade = **paie fausse**. |
| **UX** | 🟢 Faible | Moins de loading spinners |
| **Technique** | 🟡 Moyen | Le realtime channel `planning_shifts` déclenche `invalidatePlanning()` à chaque mutation. Modifier ce comportement impacte aussi les mises à jour concurrentes (2 managers sur le même planning). |
| **Sécurité** | 🟢 Faible | Pas de changement de permissions |

**⚠️ ALERTE** : La cascade `invalidatePlanning → invalidatePayroll` est un **couplage nécessaire**, pas un bug. La supprimer = créer un état où la paie ne reflète pas le planning actuel. C'est **inacceptable** si le manager bascule entre les deux pages.

**Cas limites** :
- Manager modifie 5 shifts → ouvre la page paie → paie toujours sur les anciennes données
- 2 managers sur le même planning → l'un modifie, l'autre ne voit pas la modification si le refetch est trop ciblé
- Shift overnight (23h→06h) → impacte 2 jours, potentiellement 2 semaines

**Gravité** : 🔴 Critique | **Probabilité** : 🟠 Moyenne | **Détectabilité** : 🔴 Difficile (la paie semble correcte mais est périmée)

**Garde-fous** :
- **NE PAS supprimer la cascade payroll** — la rendre asynchrone (délai de 5s ou sur navigation vers la page paie)
- Invalidation ciblée par weekStart : `queryKey: ["planning-week", establishmentId, weekStart]` (exact: true) au lieu de prefix match
- GARDER l'invalidation globale via realtime (pour les mutations concurrentes) — seulement optimiser l'invalidation locale (post-mutation du même utilisateur)
- Mécanisme de stale indicator : si les données payroll ont potentiellement changé, afficher un badge "données en cours de mise à jour" sur la page paie

**Validations préalables** :
- [ ] Lister TOUS les effets de `invalidatePlanning()` (actuellement : planning-week + payroll month)
- [ ] Vérifier si d'autres modules appellent `invalidatePlanning()` en dehors du realtime
- [ ] Confirmer que le realtime channel `planning_shifts` reste actif pour les mutations concurrentes
- [ ] Tester : modifier shift → aller page paie → la paie doit être à jour

---

### 4.7 — Traitement des anomalies bloquantes (V0-7)

**Objectif** : Corriger le bug "employés sans équipe invisibles dans le planning"

**Hypothèse** : Les employés actifs sans `team_id` doivent apparaître dans la grille planning.

| Catégorie | Risque | Détail |
|-----------|--------|--------|
| **Métier** | 🟡 Moyen | Décision métier requise : afficher les sans-équipe dans une section "Sans équipe" OU forcer l'affectation à une équipe OU les afficher dans toutes les vues |
| **Cohérence** | 🟢 Faible | Pas de changement de SSOT — les employés existent déjà, on modifie juste le filtre d'affichage |
| **Inter-modules** | 🟢 Faible | Le filtre est dans `getWeek.ts` (scope filtering) — pas d'impact sur les autres modules |
| **UX** | 🟡 Moyen | Si on ajoute une section "Sans équipe", l'UI doit la gérer proprement (pas de section vide si tous les employés ont une équipe) |
| **Technique** | 🟢 Faible | Modification du filtre dans `getWeek.ts` |
| **Sécurité** | 🟡 Moyen | Le RBAC scope `team` ne doit pas montrer les employés sans équipe à un manager de scope `team` — seuls les scopes `establishment` et `org` doivent voir les sans-équipe |

**Cas limites** :
- Manager avec scope `team` → ne doit PAS voir les sans-équipe (sauf s'il est aussi affecté à la pseudo-équipe "Sans équipe")
- Employé qui passe d'une équipe à "sans équipe" → doit rester visible dans le planning
- Filtrage par département (PlanningEntryPage) → où afficher les sans-équipe ?

**Gravité** : 🟡 Moyenne | **Probabilité** : 🟢 Faible | **Détectabilité** : ✅ Facile (visible dans la grille)

**Garde-fous** :
- Décision métier formalisée AVANT implémentation
- Test RBAC : manager scope `team` ne voit pas les sans-équipe
- Test : employé avec `team_id = null` apparaît dans la vue "Planning général"

**Validations préalables** :
- [ ] Décider : afficher dans "Sans équipe" ou forcer l'affectation ?
- [ ] Si "Sans équipe" : dans quelle vue de PlanningEntryPage les montrer ?
- [ ] Vérifier le comportement RBAC avec les scopes self/team/establishment/org

---

## SECTION 5 — MATRICE DES RISQUES INTER-MODULES

| Module | Lien avec le planning | Impact V0 possible | Scénario de régression | Gravité | Probabilité | Visibilité régression | Détection | Garde-fou |
|--------|----------------------|--------------------|-----------------------|---------|-------------|----------------------|-----------|-----------|
| **Badgeuse** | Lecture overlap dans create/update shift ; DELETE badge_events dans delete shift | Si optimistic update crée un shift avant confirmation → le badge overlap check côté serveur pourrait le manquer (mais le check est serveur, donc non impacté) | L'optimistic delete ne supprime pas les badges localement → refetch complet corrige | 🟡 Moyen | 🟢 Faible | ✅ Facile | Vérifier badge_events après delete shift | Le refetch background corrige toujours |
| **Absences/Congés** | Écriture partagée `personnel_leaves` ; lecture dans grille | Si `personnel_leaves` est différé au chargement, les congés n'apparaissent pas → manager crée shift sur jour de congé | Manager crée shift sur un CP → backend rejette → rollback optimistic → confusion | 🔴 Critique | 🟡 Moyenne | 🟡 Moyenne | NE PAS différer leaves | Garder leaves dans le chemin critique |
| **Paie** | Lecture `planning_shifts.net_minutes` ; cascade `invalidatePayroll` | Si cascade payroll supprimée → paie affiche données périmées | Manager modifie 5 shifts → ouvre paie → montants anciens affichés | 🔴 Critique | 🟠 Moyenne | 🔴 Difficile (données semblent correctes) | Garder cascade, la rendre async | Stale indicator sur page paie |
| **Personnel** | Lecture profils/équipes dans `getWeek` | Pas d'écriture — impact nul sauf si le cache profils devient stale (employé change d'équipe) | Employé change d'équipe → planning affiche l'ancienne équipe pendant 30s (staleTime) | 🟡 Moyen | 🟢 Faible | 🟡 Moyenne | Le refetch corrige au prochain chargement | Acceptable — staleTime 30s suffit |
| **R-Extra** | Calcul `rextraBalance` dans `getWeek` | Si différé → badge R-Extra absent au chargement initial | Manager ne voit pas le solde R-Extra → prend une décision sans cette info | 🟡 Moyen | 🟡 Moyenne | ✅ Facile (badge absent) | Skeleton/loading pour R-Extra | Feature flag rollback |
| **Validation/Publication** | `planning_weeks` lu dans `getWeek` | Pas de changement prévu sur la validation dans la V0 | Aucun | 🟢 Faible | 🟢 Faible | ✅ Facile | — | — |
| **Contrats** | Pas de lien direct | Pas d'impact | Aucun | 🟢 Faible | 🟢 Faible | — | — | — |
| **Realtime** | Channels `planning_shifts` et `planning_weeks` | Si invalidation ciblée mais realtime reste global → conflit entre patch local et refetch global | Double refetch ou flash visuel (optimistic rollback puis refetch avec même données) | 🟡 Moyen | 🟡 Moyenne | ✅ Facile (flash visuel) | Coordonner optimistic + realtime | Debounce les invalidations realtime |

---

## SECTION 6 — RISQUES LIÉS À LA SOURCE DE VÉRITÉ

| # | Risque | Où il apparaît | Gravité | Probabilité | Conditions | Garde-fou |
|---|--------|---------------|---------|-------------|------------|-----------|
| SSOT-1 | **Vérité d'affichage ≠ vérité métier** : optimistic update affiche un shift que le serveur a rejeté | Toute mutation avec optimistic UI (V0-4) | 🔴 Critique | 🟡 Moyenne | Backend rejette pour overlap, badge conflict, max 2 shifts, jour fermé | Rollback systématique + toast d'erreur ; timer de réconciliation 5s |
| SSOT-2 | **État temporaire trompeur** : pendant 1-3s après mutation, le cache local est "correct" mais `totalsByEmployee` n'est pas recalculé | Mutations avec patch local (V0-3) | 🟠 Fort | 🟠 Moyenne | Toute création/modification qui change le total hebdo | NE PAS patcher `totalsByEmployee` en optimistic — laisser "..." ou spinner ; le refetch background corrige |
| SSOT-3 | **Donnée non stabilisée affichée** : `net_minutes` optimistic calculé côté frontend diffère de la break policy serveur | Création optimistic (V0-4) | 🟠 Fort | 🟠 Haute (à chaque création) | Toute break policy non-triviale (ex: 30min au-delà de 6h) | NE PAS calculer `net_minutes` côté client — afficher uniquement `start_time`-`end_time` en optimistic |
| SSOT-4 | **Conflit réel masqué** : 2 managers créent un shift en même temps pour le même employé/jour. L'optimistic affiche les 2, mais le serveur rejette le second (overlap). | Mutations concurrentes (V0-4) | 🟠 Fort | 🟢 Faible (rare en pratique) | 2+ managers simultanés sur le même planning | Le refetch background corrige ; le realtime invalide pour les 2 clients |
| SSOT-5 | **Sensation de succès fausse** : l'optimistic update supprime le shift visuellement, mais le DELETE serveur est lent ou échoue → le shift réapparaît | Suppression optimistic (V0-4) | 🟠 Fort | 🟢 Faible | Erreur réseau ou erreur serveur (semaine validée entre-temps) | Rollback + toast "La suppression a échoué — la semaine a été validée" |
| SSOT-6 | **Désynchronisation UI/backend prolongée** : si le refetch background est trop différé (ex: 10s), le manager fait plusieurs actions sur des données locales non confirmées | Accumulation de mutations sans refetch (V0-3) | 🔴 Critique | 🟡 Moyenne | Plusieurs actions rapides (ex: créer 3 shifts en 10s) | Forcer un refetch après CHAQUE mutation (background, non-bloquant) — pas de "batch" les refetch |
| SSOT-7 | **Copie bulk + optimistic** : la copie affiche 20 shifts copiés, mais le bulk RPC échoue au milieu (même avec transaction, le tout-ou-rien peut surprendre) | Copie semaine (V0-5) | 🟡 Moyen | 🟢 Faible | Conflit sur 1 employé bloque tout | Pas d'optimistic pour la copie bulk — attendre la confirmation serveur (l'opération est rare et l'utilisateur accepte l'attente si elle est < 1s) |

---

## SECTION 7 — RISQUES SPÉCIFIQUES AUX MUTATIONS

### 7.1 — Création de shift

| Aspect | Analyse |
|--------|---------|
| **Ce qui pourrait mal se passer avec optimistic** | Shift affiché avec `break_minutes` = 0 (le frontend ne connaît pas la break policy), puis corrigé après refetch → total heures fluctue |
| **États intermédiaires dangereux** | Shift visible sans `net_minutes` correct ; `totalsByEmployee` faux |
| **Modules qui pourraient ne pas suivre** | R-Extra balance (le nouveau shift peut créer des extras non comptés localement) |
| **Validations non négociables** | Overlap check (serveur) ; Opening hours (serveur) ; Max 2 shifts/jour (serveur) |
| **Ce qui peut être affiché immédiatement** | Le bloc shift avec `start_time`-`end_time` et un indicator "en cours de sauvegarde" |
| **Ce qui ne doit JAMAIS être simulé** | `net_minutes`, `break_minutes`, `totalsByEmployee` → toujours depuis le serveur |

### 7.2 — Modification de shift

| Aspect | Analyse |
|--------|---------|
| **Ce qui pourrait mal se passer** | Ancien horaire remplacé optimistiquement mais le backend rejette (badge overlap) → flash visuel (ancien → nouveau → ancien) |
| **États intermédiaires dangereux** | Shift avec le nouvel horaire mais `net_minutes` de l'ancien → total faux |
| **Modules qui pourraient ne pas suivre** | Paie (si le manager est aussi sur la page paie dans un autre onglet) |
| **Validations non négociables** | Overlap check ; Badge overlap ; Opening hours ; Start_time locked si clock_in existe |
| **Ce qui peut être affiché immédiatement** | Nouveau `start_time`/`end_time` avec indicator pending |
| **Ce qui ne doit JAMAIS être simulé** | `net_minutes`, `break_minutes` |

### 7.3 — Suppression de shift

| Aspect | Analyse |
|--------|---------|
| **Ce qui pourrait mal se passer** | Shift supprimé visuellement mais le backend refuse (semaine validée entre-temps) → shift réapparaît |
| **États intermédiaires dangereux** | Shift absent de l'UI mais `badge_events` pas encore supprimés → module présence montre toujours le pointage |
| **Modules qui pourraient ne pas suivre** | Badgeuse (DELETE physique des badges — CRITIQUE, déjà identifié) |
| **Validations non négociables** | Semaine non validée ; Jour non validé |
| **Ce qui peut être affiché immédiatement** | Disparition du shift avec fade-out |
| **Ce qui ne doit JAMAIS être simulé** | La suppression des `badge_events` — c'est un effet de bord serveur que le frontend ne doit pas anticiper |

### 7.4 — Drag & drop (copie de shift)

| Aspect | Analyse |
|--------|---------|
| **Ce qui pourrait mal se passer** | Drop sur un jour fermé (exception) → optimistic affiche le shift puis rollback |
| **États intermédiaires dangereux** | Shift copié visible sur le jour cible sans vérification overlap |
| **Validations non négociables** | Overlap, opening hours, max 2 shifts/jour |
| **Ce qui peut être affiché immédiatement** | Bloc shift avec indicator pending |
| **Ce qui ne doit JAMAIS être simulé** | `break_minutes` sur le nouveau jour (la policy pourrait varier par jour) |

### 7.5 — Copie de semaine

| Aspect | Analyse |
|--------|---------|
| **Ce qui pourrait mal se passer** | Bulk transaction échoue à cause d'1 conflit → RIEN n'est copié → utilisateur surpris |
| **États intermédiaires dangereux** | AUCUN (pas d'optimistic recommandé pour cette action) |
| **Validations non négociables** | Semaine cible non validée ; Break policy recalculée ; Opening hours respectées |
| **Ce qui peut être affiché immédiatement** | Barre de progression "Copie en cours..." (attendue pour une action lourde) |
| **Ce qui ne doit JAMAIS être simulé** | Le résultat de la copie avant confirmation serveur |

---

## SECTION 8 — RISQUES SPÉCIFIQUES À L'OUVERTURE ET À LA NAVIGATION

| # | Risque | Description | Gravité | Probabilité | Garde-fou |
|---|--------|-------------|---------|-------------|-----------|
| NAV-1 | **Affichage initial partiel** | Si `rextraBalance` est différé, la grille s'affiche sans les badges R-Extra. Le manager pense "pas de R-Extra" alors qu'il y en a. | 🟡 Moyen | 🟡 Moyenne | Skeleton spécifique pour la zone R-Extra ; ne jamais afficher "0" par défaut |
| NAV-2 | **Placeholder = données anciennes** | `placeholderData: (prev) => prev` dans `usePlanningWeek` montre l'ancienne semaine pendant le chargement de la nouvelle. Le manager pourrait confondre les données. | 🟡 Moyen | 🟡 Moyenne | Griser/opacifier la grille pendant le chargement avec indicator "Chargement semaine du XX" |
| NAV-3 | **Conservation cache inter-semaine** | Si staleTime = 30s, naviguer S1 → S2 → S1 en moins de 30s affiche le cache S1 sans refetch. Si un autre manager a modifié S1 entre-temps, données périmées. | 🟡 Moyen | 🟢 Faible | Acceptable — le realtime corrige ; pas de changement nécessaire |
| NAV-4 | **Confusion données anciennes/nouvelles** | Le `placeholderData` montre S1 pendant le chargement de S2. Si le chargement prend 3s, le manager peut commencer à agir sur les données de S1 (mauvaise semaine). | 🟠 Fort | 🟡 Moyenne | Désactiver les interactions (création de shift) tant que le chargement n'est pas terminé. OU ajouter un overlay "Chargement..." bloquant. |
| NAV-5 | **Affichage partiel interprété comme final** | Si `personnel_leaves` est chargé après la grille, les cases de congé apparaissent APRÈS l'affichage initial. Le manager qui agit immédiatement ne les voit pas. | 🔴 Critique | 🟠 Haute (si leaves différé) | **NE PAS différer `personnel_leaves`** |
| NAV-6 | **Prefetch réduit → navigation arrière dégradée** | Si on passe de prefetch ±1 à +1 seul, le clic "←" charge la semaine précédente from scratch (~3s). | 🟡 Moyen | ✅ Haute (à chaque navigation arrière) | Acceptable si la navigation avant est prioritaire (95% du temps on avance, pas en arrière) ; confirmer avec l'usage réel |

---

## SECTION 9 — REGISTRE DES CAS LIMITES

| # | Cas limite | Pourquoi c'est dangereux | Chantier V0 | Tests à prévoir |
|---|-----------|------------------------|-------------|-----------------|
| CL-1 | **Salarié sans équipe** | Invisible dans la grille → aucune action possible | V0-7 | Affecter karim sans équipe → vérifier qu'il apparaît |
| CL-2 | **Salarié sans contrat complet** | `contract_hours = null` → `rextraBalance` divise par 0 ou calcule avec 35h par défaut | V0-1 (rextra lazy) | Créer employé sans `contract_hours` → vérifier R-Extra |
| CL-3 | **Absence approuvée pendant copie** | La copie source a un CP ; la cible a aussi un CP (approuvé par le module absences) → doublon `personnel_leaves` | V0-5 (bulk copy) | Copier semaine avec CP existant en cible → index unique bloque ou skip |
| CL-4 | **Semaine validée / verrouillée** | Mutations (create, delete, copy) doivent être refusées ; l'optimistic pourrait les afficher brièvement | V0-4, V0-5 | Valider semaine → tenter create shift → vérifier rejet + rollback |
| CL-5 | **Conflit badgeuse** | Clock_in existe sans clock_out → `start_time` est locked → update shift limité | V0-4 | Employé avec clock_in en cours → modifier shift → vérifier que `start_time` est locked |
| CL-6 | **Changement de break policy** | Break policy modifiée entre semaine source et cible → copie avec anciennes pauses | V0-5 | Modifier break policy → copier semaine → vérifier `break_minutes` recalculé |
| CL-7 | **Permission partielle (scope team)** | Manager scope team voit N employés ; copie bulk ne doit copier que ceux dans son scope | V0-5 | Manager scope team → copie → vérifier que seuls ses employés sont copiés |
| CL-8 | **Semaine vide (0 shifts)** | Copie d'une semaine vide → résultat = supprimer les shifts cible (mode replace) sans rien ajouter | V0-5 | Copier semaine vide en mode replace → vérifier suppression sans erreur |
| CL-9 | **Grand volume d'employés (20+)** | Copie bulk de 20 employés × 7 jours × 2 shifts = 280 INSERT → performance RPC | V0-5 | Test de charge : copie 20 employés → < 1s |
| CL-10 | **Données partielles (réseau instable)** | Optimistic update créé localement, mais le réseau coupe avant la réponse serveur | V0-4 | Simuler timeout réseau → vérifier que l'optimistic rollback se déclenche |
| CL-11 | **Échec réseau en milieu de copie (ancien)** | Copie per-employee : 5/10 réussis, réseau coupe → 5 employés copiés, 5 non → état incohérent | V0-5 (corrigé par bulk) | Le bulk transactionnel élimine ce cas — mais tester le rollback total |
| CL-12 | **Mise à jour concurrente** | 2 managers modifient le même shift → le dernier écrase l'autre sans warning | V0-4 | 2 sessions simultanées → modifier même shift → vérifier résultat final cohérent |
| CL-13 | **Shift overnight (23h→06h)** | Impacte 2 jours → patch optimistic doit mettre à jour 2 cellules | V0-4 | Créer shift overnight → vérifier affichage sur 2 jours |
| CL-14 | **Jour fermé (exception)** | Copie inclut un jour fermé → les shifts de ce jour doivent être exclus | V0-5 | Ajouter exception fermé → copier → vérifier exclusion |

---

## SECTION 10 — MATRICE GRAVITÉ / PROBABILITÉ / DÉTECTABILITÉ

| # | Risque | Gravité | Probabilité | Détectabilité | Criticité | Priorité sécurisation |
|---|--------|---------|-------------|--------------|-----------|----------------------|
| R1 | Paie périmée si cascade payroll supprimée | 🔴 5 | 🟠 3 | 🔴 1 (invisible) | **15** | **P0 — BLOQUANT** |
| R2 | RBAC régression (middleware mal implémenté) | 🔴 5 | 🟡 2 | 🔴 1 (invisible) | **10** | **P0 — BLOQUANT** |
| R3 | `net_minutes` optimistic faux (break policy ignorée) | 🟠 4 | 🟠 4 | 🟡 2 | **8** | **P1 — CRITIQUE** |
| R4 | Leaves différés → grille partiellement fausse | 🔴 5 | 🟠 3 (si différé) | 🟡 2 | **7.5** | **P1 — Ne pas faire** |
| R5 | Optimistic non rollbacké (erreur réseau) | 🟠 4 | 🟡 2 | 🟡 2 | **4** | **P2 — À gérer** |
| R6 | Copie bulk tout-ou-rien frustrant | 🟡 3 | 🟡 2 | ✅ 4 | **1.5** | **P3 — UX** |
| R7 | R-Extra badge absent au chargement | 🟡 2 | ✅ 4 | ✅ 5 | **1.6** | **P3 — Acceptable** |
| R8 | Placeholder semaine précédente confondu | 🟡 3 | 🟡 2 | ✅ 4 | **1.5** | **P3 — UX** |
| R9 | Concurrence 2 managers même shift | 🟠 4 | 🟢 1 | 🟡 2 | **2** | **P3 — Rare** |
| R10 | Copie 280 shifts performance RPC | 🟡 2 | 🟡 2 | ✅ 5 | **0.8** | **P4 — Test** |

> **Criticité** = Gravité × Probabilité × (1/Détectabilité). Échelle 1-5 pour chaque. Plus le score est élevé, plus le risque est dangereux.

---

## SECTION 11 — GARDE-FOUS OBLIGATOIRES AVANT EXÉCUTION

| # | Garde-fou | But | Risque couvert | Coût | Priorité | Obligatoire ? |
|---|-----------|-----|---------------|------|----------|--------------|
| GF-1 | **Feature flag par chantier** (`planning_v0_lazy_rextra`, `planning_v0_optimistic`, `planning_v0_bulk_copy`, `planning_v0_targeted_invalidation`) | Rollback individuel sans redéploiement | Tous | Faible (1h) | P0 | ✅ OBLIGATOIRE |
| GF-2 | **Tests red/blue RBAC** avant déploiement du middleware refactorisé | Empêcher toute régression de sécurité | R2 | Moyen (4h) | P0 | ✅ OBLIGATOIRE |
| GF-3 | **Métriques de latence baseline** : capturer P50/P95 de `get_week`, `create_shift`, `copy_week` AVANT la V0 | Comparaison avant/après | Performance | Faible (2h) | P0 | ✅ OBLIGATOIRE |
| GF-4 | **Log d'alerte divergence optimistic** : en mode dev, comparer le résultat du refetch background avec le patch optimistic local. Si ≠, log un warning. | Détecter les cas où l'optimistic est faux | R3, R5, SSOT-2 | Moyen (3h) | P1 | ✅ OBLIGATOIRE |
| GF-5 | **Timer de réconciliation** : forcer un refetch complet 5s après chaque mutation si le refetch background n'a pas terminé | Empêcher la désynchronisation prolongée | SSOT-6 | Faible (1h) | P1 | ✅ OBLIGATOIRE |
| GF-6 | **Journalisation mutations planning** : logger chaque create/update/delete avec l'identifiant de session, pour identifier les conflits concurrents | Diagnostic post-incident | R9 | Faible (1h) | P2 | 🟡 Recommandé |
| GF-7 | **Validation manuelle sur 1 établissement pilote** : déployer la V0 uniquement sur NONNA SECRET pendant 48h avant rollout général | Limiter l'impact en cas de bug | Tous | Moyen (organisation) | P1 | ✅ OBLIGATOIRE |
| GF-8 | **Scénario de rollback documenté** : pour chaque feature flag, documenter la procédure de retour arrière (désactiver le flag + ce qu'il faut vérifier) | Réaction rapide en cas de problème | Tous | Faible (2h) | P1 | ✅ OBLIGATOIRE |
| GF-9 | **Comparaison copie bulk vs copie unitaire** : sur des données de test, comparer le résultat de la copie bulk avec N copies individuelles. Résultat doit être identique bit à bit. | Valider l'équivalence fonctionnelle | V0-5 | Moyen (4h) | P1 | ✅ OBLIGATOIRE |
| GF-10 | **Monitoring Sentry** : configurer des alertes sur les erreurs 4xx/5xx du endpoint `planning-week` avec augmentation soudaine | Détection rapide des régressions prod | Tous | Faible (1h) | P2 | 🟡 Recommandé |

---

## SECTION 12 — CHECKLIST DE VALIDATION AVANT GO V0

### Avec l'équipe métier / produit

- [ ] **Confirmer** : le solde R-Extra est-il nécessaire DÈS l'ouverture du planning, ou peut-il arriver 1-2s après ?
- [ ] **Confirmer** : la suppression physique des `badge_events` lors d'un delete shift est-elle un choix métier volontaire ou un bug ?
- [ ] **Confirmer** : les employés sans équipe doivent-ils apparaître dans le planning ? Si oui, dans quelle section ?
- [ ] **Confirmer** : la copie de semaine doit-elle être "tout ou rien" ou "best effort avec rapport" ?
- [ ] **Confirmer** : un optimistic rollback (shift créé puis supprimé 1-2s après) est-il acceptable UX ?

### Avec les responsables paie / RH / badgeuse

- [ ] **Confirmer** : la paie utilise-t-elle `net_minutes` de la DB ou le recalcul de `getWeek.ts` ?
- [ ] **Confirmer** : si la cascade `invalidatePayroll` est décalée de 5s, est-ce acceptable ?
- [ ] **Confirmer** : l'archivage des `badge_events` (au lieu de DELETE) ne casse pas les requêtes de présence ?

### Tests obligatoires en preview

- [ ] Créer un shift → vérifier que `break_minutes` et `net_minutes` sont corrects en DB
- [ ] Modifier un shift → vérifier overlap check fonctionne (rejet si overlap)
- [ ] Supprimer un shift avec badge → vérifier que les badges sont gérés correctement
- [ ] Copier une semaine avec 5+ employés → vérifier résultat identique à la copie unitaire
- [ ] Navigation ×5 semaines → vérifier que le staleTime ne montre pas de données périmées
- [ ] Test RBAC : manager scope team ne voit pas les employés hors scope

### Tests sur données réelles

- [ ] Copie bulk sur l'établissement avec le plus d'employés (10+)
- [ ] Mesure latence `get_week` avant/après chaque chantier V0
- [ ] Vérifier que la paie affiche les bons montants après modifications planning

### Ce qui BLOQUE le GO

- [ ] Feature flags en place pour CHAQUE chantier V0
- [ ] Tests RBAC red/blue passent à 100%
- [ ] Baseline latence mesurée et documentée
- [ ] Procédure de rollback documentée
- [ ] Établissement pilote défini

### Points de vigilance (non bloquants)

- [ ] Le prefetch ±1 est réduit à +1 seul → navigation arrière légèrement plus lente
- [ ] L'optimistic ne montre pas `net_minutes` → indicator "..." pendant 1-2s
- [ ] La copie bulk "tout ou rien" peut frustrer si 1 employé bloque

---

## SECTION 13 — ORDRE DE MISE EN ŒUVRE LE MOINS RISQUÉ

### Phase 1 : Fondations (risque minimal, gains rapides)

| Ordre | Chantier | Pourquoi en premier | Parallélisable |
|-------|----------|--------------------|----|
| **1A** | Feature flags + métriques baseline (GF-1, GF-3) | Prérequis à tout le reste — aucun risque | ✅ Oui |
| **1B** | Corriger employés sans équipe (V0-7) | Débloque les tests fonctionnels — risque faible | ✅ Oui (avec 1A) |

### Phase 2 : Performance lecture (risque faible)

| Ordre | Chantier | Pourquoi maintenant | Prérequis | Parallélisable |
|-------|----------|--------------------|----|---|
| **2A** | Différer `rextraBalance` (V0-1) | Gain majeur (-500 à -1500ms), risque faible, isolé | Phase 1 (feature flag) | ✅ Oui |
| **2B** | Réduire prefetch ±1 → +1 (V0-2 partiel) | Gain serveur -33% charge, risque quasi nul | Aucun | ✅ Oui (avec 2A) |

### Phase 3 : Architecture mutations (risque modéré)

| Ordre | Chantier | Pourquoi après Phase 2 | Prérequis | Parallélisable |
|-------|----------|--------------------|----|---|
| **3A** | RBAC middleware partagé (V0-3 prérequis) | Prérequis au bulk copy ; risque de sécurité → nécessite tests RBAC d'abord | Phase 1 + tests RBAC (GF-2) | ❌ Non (doit précéder 3B) |
| **3B** | Bulk RPC copie semaine (V0-5) | Gain majeur sur la copie ; dépend du middleware RBAC | Phase 3A | ❌ Non (après 3A) |

### Phase 4 : Fluidité UI (risque élevé)

| Ordre | Chantier | Pourquoi en dernier | Prérequis | Parallélisable |
|-------|----------|--------------------|----|---|
| **4A** | Optimistic updates (V0-4) | Risque le plus élevé (SSOT) — nécessite le garde-fou GF-4 et GF-5 | Phases 1-3 (l'architecture doit être stable) | ❌ Non |
| **4B** | Invalidation ciblée (V0-6) | Le plus dangereux — cascade payroll à préserver. À ne faire qu'après validation de l'optimistic. | Phase 4A stable | ❌ Non (après 4A) |

### Ce qui NE DOIT PAS être lancé tant que...

| Chantier | Ne pas lancer tant que... |
|----------|--------------------------|
| V0-4 (optimistic updates) | Le middleware RBAC n'est pas validé ET les feature flags ne sont pas en place |
| V0-5 (bulk copy) | Le middleware RBAC n'est pas factorisé |
| V0-6 (invalidation ciblée) | L'optimistic update n'est pas stable ET la cascade payroll n'est pas documentée |

---

## SECTION 14 — CONCLUSION DÉCISIONNELLE

### 1. La V0 est-elle raisonnablement faisable sans risque majeur incontrôlé ?

**OUI**, à condition de :
- Respecter l'ordre Phase 1 → 2 → 3 → 4
- Poser TOUS les garde-fous GF-1 à GF-9 avant la Phase 3
- Ne JAMAIS supprimer la cascade `invalidatePayroll` sans la remplacer par un mécanisme équivalent
- Ne JAMAIS différer `personnel_leaves` du chargement initial

### 2. Quels sont les 3 plus gros dangers si on va trop vite ?

| # | Danger | Conséquence |
|---|--------|-------------|
| 1 | **Régression RBAC** en refactorisant le middleware | Fuite de données — un manager voit/modifie des shifts hors de son scope |
| 2 | **Paie périmée** si la cascade payroll est supprimée | Montants de paie faux affichés sans signal d'alerte |
| 3 | **Optimistic trompeur** sans timer de réconciliation | Shift "fantôme" visible indéfiniment si erreur réseau |

### 3. Quels sont les 3 prérequis absolus avant de démarrer ?

| # | Prérequis | Statut |
|---|-----------|--------|
| 1 | Feature flags en place pour chaque chantier | 🔴 À faire |
| 2 | Baseline latence mesurée (P50/P95 de `get_week`, `create_shift`, `copy_week`) | 🔴 À faire |
| 3 | Tests RBAC red/blue team vérifiés et passants | 🟡 55 tests existants — à confirmer qu'ils couvrent le scope planning |

### 4. Quel est le meilleur ordre pour exécuter la V0 sans casser la prod ?

```
Phase 1 (1-2j) : Feature flags + métriques + fix employés sans équipe
     ↓
Phase 2 (2-3j) : Lazy rextraBalance + réduction prefetch
     ↓
Phase 3 (3-5j) : RBAC middleware + bulk copy RPC
     ↓
Phase 4 (3-5j) : Optimistic updates + invalidation ciblée
```

**Durée totale estimée : 9-15 jours**

### 5. Quels chantiers V0 sont à faible risque / fort gain ?

| Chantier | Risque | Gain | Verdict |
|----------|--------|------|---------|
| Lazy rextraBalance (V0-1) | 🟢 Faible | 🔴 Fort (-500 à -1500ms) | ✅ **FAIRE EN PREMIER** |
| Réduction prefetch (V0-2 partiel) | 🟢 Très faible | 🟡 Moyen (-33% charge serveur) | ✅ **FAIRE** |
| Fix employés sans équipe (V0-7) | 🟢 Faible | 🟠 Fort (débloque fonctionnel) | ✅ **FAIRE** |

### 6. Quels chantiers paraissent tentants mais sont en réalité dangereux ?

| Chantier | Pourquoi tentant | Pourquoi dangereux |
|----------|-----------------|-------------------|
| **Invalidation ciblée (V0-6)** | "Moins de refetch = plus rapide" | Supprimer la cascade payroll = paie fausse invisible. Le risque est **inversement proportionnel à la détectabilité** : le bug est silencieux. |
| **Optimistic UI complet (V0-4)** | "Tout semble instantané" | `net_minutes` et `break_minutes` imprédictibles côté client. L'optimistic donne une **illusion de précision** que le serveur ne confirme pas toujours. |
| **Différer `personnel_leaves` (V0-2)** | "Moins de données au chargement = plus rapide" | Les congés font partie de la grille. Une grille sans congés est une **grille fausse**. Le manager qui crée un shift sur un CP invisible commet une erreur métier. |

---

> **Légende** : ✅ OBSERVÉ dans le code | 🟡 INFÉRÉ du comportement | ❓ À CONFIRMER avec l'équipe
