# Stratégie Refonte Module Caisse

---

## 1 — Analyse de l'existant

### 1.1 Fichiers du module

| Fichier | Rôle |
|---------|------|
| `src/modules/cash/CashPage.tsx` | Page principale, routing permission (admin/month vs day) |
| `src/modules/cash/feature.ts` | Feature flag (re-export CASH_ENABLED) |
| `src/modules/cash/index.ts` | Barrel export public |
| `src/modules/cash/components/CashDayForm.tsx` | Formulaire complet 6 champs + note + CA + solde |
| `src/modules/cash/components/CashMonthAdmin.tsx` | Vue mois admin : navigation jour, calendrier, stats, formulaire |
| `src/modules/cash/components/CashDayOnlyView.tsx` | Vue jour seul (permission caisse_day) |
| `src/modules/cash/hooks/useCashDay.ts` | Fetch + upsert un jour (query + mutation) |
| `src/modules/cash/hooks/useCashMonth.ts` | Fetch tous les rapports d'un mois + totaux |
| `src/modules/cash/hooks/useCashPermissions.ts` | Niveau permission (none/caisse_day/caisse_month/admin) |
| `src/modules/cash/hooks/useBusinessDayToday.ts` | Re-export de useServiceDayToday |
| `src/modules/cash/utils/types.ts` | Types CashDayReport, CashDayFormValues, DEFAULT_FORM_VALUES |
| `src/modules/cash/utils/money.ts` | calculateCA, calculateBalance, formatEur, parseEurInput |
| `src/modules/cash/utils/businessDay.ts` | toSafeMiddayUTC, addDaysSafe, formatBusinessDay |
| `src/hooks/realtime/channels/useCashChannel.ts` | Realtime sync (centralisé) |

### 1.2 Sources de données

- **Table DB** : `cash_day_reports`
- **Colonnes** : `id`, `establishment_id`, `day_date`, `cb_eur`, `cash_eur`, `delivery_eur`, `courses_eur`, `maintenance_eur`, `shortage_eur`, `total_eur`, `note`, `created_by`, `updated_by`, `created_at`, `updated_at`
- **Contrainte unique** : `(establishment_id, day_date)` (upsert via onConflict)
- **total_eur** = CA brut (CB + Espèces + Livraison), calculé côté client avant upsert
- **Realtime** : activé via `useCashReportsChannel`

### 1.3 Hooks externes consommés

- `usePermissions` → RBAC V2
- `useServiceDayToday` → jour de service courant (RPC backend)
- `useDailyPayrollCost` → indicateur masse salariale (lecture seule, black-box Paie)
- `useEstablishment` → établissement actif
- `useAuth` → utilisateur courant
- `useIsMobile` → détection mobile

### 1.4 Calculs existants (money.ts)

- `calculateCA(v)` = `cb_eur + cash_eur + delivery_eur`
- `calculateBalance(v)` = `CA - courses_eur - maintenance_eur - shortage_eur`
- `formatEur(n)` = format fr-FR avec € et 2 décimales

---

## 2 — Architecture cible

### 2.1 Organisation dossier

```
src/modules/cash/
├── CashPage.tsx                         # Inchangé (routing permission)
├── feature.ts                           # Inchangé
├── index.ts                             # Inchangé
├── hooks/
│   ├── useCashDay.ts                    # Inchangé
│   ├── useCashMonth.ts                  # Inchangé (+ ajout averagePerDay dans le hook)
│   ├── useCashPermissions.ts            # Inchangé
│   ├── useBusinessDayToday.ts           # Inchangé
│   ├── useAmountVisibility.ts           # NOUVEAU — état masquage montants
│   └── useCashWizard.ts                 # NOUVEAU — état du flow guidé (étapes)
├── components/
│   ├── CashMainView.tsx                 # NOUVEAU — remplace CashMonthAdmin + CashDayOnlyView
│   ├── CashMonthHeader.tsx              # NOUVEAU — indicateurs + navigation mois
│   ├── CashDayList.tsx                  # NOUVEAU — liste jours du mois
│   ├── CashDayRow.tsx                   # NOUVEAU — ligne compacte jour
│   ├── CashDayDrawer.tsx                # NOUVEAU — drawer détail jour (CB, Espèces, etc.)
│   ├── CashDetailDrawer.tsx             # NOUVEAU — drawer stats détaillées
│   ├── CashWizardModal.tsx              # NOUVEAU — modal guidé saisie (orchestrateur)
│   ├── wizard/
│   │   ├── WizardStepCB.tsx             # Étape 1 — CB
│   │   ├── WizardStepCash.tsx           # Étape 2 — Espèces
│   │   ├── WizardStepExpenses.tsx       # Étape 3 — Courses + Maintenance
│   │   ├── WizardStepAdvance.tsx        # Étape 4 — Acompte salarié (Oui/Non + sélection)
│   │   └── WizardStepSummary.tsx        # Étape finale — Résumé + validation
│   ├── AmountCell.tsx                   # NOUVEAU — affiche montant ou *** selon visibilité
│   ├── VisibilityToggle.tsx             # NOUVEAU — bouton œil
│   ├── CashDayForm.tsx                  # CONSERVÉ (mode édition admin pour corriger un jour passé)
│   ├── CashMonthAdmin.tsx               # SUPPRIMÉ (remplacé par CashMainView)
│   └── CashDayOnlyView.tsx              # SUPPRIMÉ (remplacé par CashMainView)
├── utils/
│   ├── types.ts                         # Étendu (WizardStep enum, etc.)
│   ├── money.ts                         # Inchangé
│   └── businessDay.ts                   # Inchangé
```

### 2.2 Composants — résumé des changements

| Composant | Action | Justification |
|-----------|--------|---------------|
| `CashMainView` | **Créer** | Point d'entrée unifié, remplace les 2 vues actuelles |
| `CashMonthHeader` | **Créer** | Indicateurs (Total mois, Moyenne/jour) + nav < mois > |
| `CashDayList` | **Créer** | Liste verticale des jours du mois |
| `CashDayRow` | **Créer** | Ligne compacte : date, montant (ou ***), % vs moyenne, couleur |
| `CashDayDrawer` | **Créer** | Drawer bottom-sheet : détail d'un jour |
| `CashDetailDrawer` | **Créer** | Drawer secondaire : stats agrégées détaillées |
| `CashWizardModal` | **Créer** | Orchestrateur du flow guidé étape par étape |
| `WizardStep*` | **Créer** | 5 étapes de saisie isolées |
| `AmountCell` | **Créer** | Composant réutilisable montant/masqué |
| `VisibilityToggle` | **Créer** | Bouton œil toggle |
| `useAmountVisibility` | **Créer** | Hook masquage auto-reset |
| `useCashWizard` | **Créer** | Hook état wizard (step courant, valeurs accumulées) |
| `CashMonthAdmin` | **Supprimer** | Remplacé par CashMainView |
| `CashDayOnlyView` | **Supprimer** | Remplacé par CashMainView |
| `CashDayForm` | **Conserver** | Réutilisé en mode admin pour éditer un jour passé |

---

## 3 — Flow utilisateur — Saisie guidée

```
[Page Caisse]
    │
    ├── Bouton "Saisir la caisse du jour" (FAB ou bouton principal)
    │
    └── CashWizardModal s'ouvre
         │
         ├── Étape 1 — CB
         │   └── Champ montant + [Valider]
         │
         ├── Étape 2 — Espèces
         │   └── Champ montant + [Valider]
         │
         ├── Étape 3 — Courses & Maintenance
         │   └── 2 champs (défaut 0) + [Valider]
         │
         ├── Étape 4 — Acompte salarié
         │   ├── [Oui] → liste salariés → sélection → montant → [Valider]
         │   └── [Non] → passe directement à l'étape suivante
         │
         └── Étape 5 — Résumé
             ├── Affiche CA brut, déductions, solde net
             └── [Confirmer] → upsert via useCashDay → ferme modal
```

### Contraintes du wizard

- **Retour arrière** : l'utilisateur peut revenir aux étapes précédentes (bouton ← )
- **Pré-remplissage** : si un rapport existe déjà pour le jour courant, les valeurs sont pré-remplies
- **Validation Zod** : chaque étape valide individuellement avant de passer à la suivante
- **Persistence** : l'upsert ne se fait qu'à la confirmation finale (pas d'écriture intermédiaire)

---

## 4 — Structure UI

### 4.1 Page principale (CashMainView)

```
┌─────────────────────────────────────┐
│  Caisse          [👁]  [Établ.]    │  ← Header
├─────────────────────────────────────┤
│  Total mars        Moyenne / jour   │  ← CashMonthHeader
│  *** €             *** €            │
│                                     │
│  ◀   Mars 2026   ▶                 │  ← Navigation mois
├─────────────────────────────────────┤
│  Lun 14 mars          *** €  +12%  │  ← CashDayList
│  Dim 13 mars          *** €   -8%  │
│  Sam 12 mars          *** €   +3%  │
│  Ven 11 mars          —            │  ← Pas de données
│  ...                                │
├─────────────────────────────────────┤
│        [＋ Saisir la caisse]        │  ← Bouton principal (si canWrite)
└─────────────────────────────────────┘
```

### 4.2 Drawer jour (CashDayDrawer)

```
┌─────────────────────────────────────┐
│  ═══ (poignée drawer)              │
│                                     │
│  Lundi 14 mars 2026                │
│                                     │
│  CB            ............  *** €  │
│  Espèces       ............  *** €  │
│  Livraison     ............  *** €  │
│  ────────────────────────────────   │
│  Courses       ............  *** €  │
│  Maintenance   ............  *** €  │
│  Manque        ............  *** €  │
│  ════════════════════════════════   │
│  CA brut                     *** €  │
│  Solde net                   *** €  │
│                                     │
│  [Détails]           [Modifier ✏️]  │
└─────────────────────────────────────┘
```

### 4.3 Drawer détails (CashDetailDrawer)

```
┌─────────────────────────────────────┐
│  ═══ (poignée drawer)              │
│                                     │
│  Détails — Mars 2026               │
│                                     │
│  Total brut             12 450 €    │
│  Moyenne / jour          1 780 €    │
│  ────────────────────────────────   │
│  Σ CB                    7 200 €    │
│  Σ Espèces               4 050 €    │
│  Σ Livraison             1 200 €    │
│  ────────────────────────────────   │
│  Σ Courses                 580 €    │
│  Σ Maintenance             320 €    │
│  Σ Manque                  150 €    │
└─────────────────────────────────────┘
```

### 4.4 Modal saisie (CashWizardModal)

- Utilise le composant `Drawer` (vaul) sur mobile
- Plein écran avec progress bar en haut (étape X/5)
- Un seul champ visible par étape
- Clavier numérique natif (`inputMode="decimal"`)
- Bouton Valider large, zone tactile ≥ 48px

---

## 5 — Gestion du masquage montants

### 5.1 Hook `useAmountVisibility`

```typescript
// État local React (pas de localStorage = non persistant)
const [visible, setVisible] = useState(false);

// Toggle
const toggle = () => setVisible(v => !v);

// Auto-reset sur changement de page / perte de focus
useEffect(() => {
  const handleVisibility = () => {
    if (document.hidden) setVisible(false);
  };
  document.addEventListener("visibilitychange", handleVisibility);
  return () => document.removeEventListener("visibilitychange", handleVisibility);
}, []);
```

### 5.2 Où stocker l'état

- **State React local** dans `CashMainView`, passé en props/context aux enfants
- **Pas de localStorage** : le masquage se reset à chaque visite
- **Pas de contexte global** : limité au module caisse

### 5.3 Auto-reset

Le masquage se réinitialise automatiquement quand :

| Événement | Mécanisme |
|-----------|-----------|
| Changement d'onglet navigateur | `document.visibilitychange` → `hidden` → reset |
| Quitter l'app (mobile) | Même événement `visibilitychange` |
| Revenir sur la page | Le state React est frais (false par défaut) |
| Navigation vers autre page | Composant démonte → state perdu |

### 5.4 Composant `AmountCell`

```tsx
// Pseudo-code
function AmountCell({ value, visible }: { value: number; visible: boolean }) {
  if (!visible) return <span className="text-muted-foreground">•••• €</span>;
  return <span>{formatEur(value)}</span>;
}
```

---

## 6 — Calculs

### 6.1 CA brut (existant, inchangé)

```
CA brut = cb_eur + cash_eur + delivery_eur
```

Stocké dans `total_eur` dans la DB. Calculé par `calculateCA()`.

### 6.2 Moyenne journalière

```
moyenne = monthTotal / nombre_jours_avec_données
```

Déjà calculée dans `useCashMonth` → `averagePerDay`. Sera exposée proprement dans le hook.

### 6.3 Pourcentage vs moyenne (nouveau)

Pour chaque jour :

```
delta_pct = ((total_eur_jour - averagePerDay) / averagePerDay) * 100
```

- Si `averagePerDay === 0` → afficher `—`
- Si `delta_pct > 0` → afficher `+X%` en vert (text-emerald-600)
- Si `delta_pct < 0` → afficher `-X%` en rouge (text-destructive)
- Seuil de neutralité : `|delta_pct| < 2%` → couleur neutre (text-muted-foreground)

### 6.4 Acompte salarié (nouveau concept)

L'acompte n'est actuellement **pas modélisé** dans `cash_day_reports`. Deux options :

**Option A — Colonne supplémentaire (recommandée)**
- Ajouter `advance_eur numeric default 0` à `cash_day_reports`
- Intégré dans le solde net : `balance = CA - courses - maintenance - shortage - advance`
- Simple, cohérent avec le modèle existant

**Option B — Table séparée**
- Créer `cash_advances(id, cash_day_report_id, employee_user_id, amount_eur, ...)`
- Plus riche (traçabilité par salarié) mais plus complexe
- Nécessite une migration DB + nouveaux hooks

**Recommandation** : implémenter **Option A** en V1 (colonne simple). Si le besoin de traçabilité par salarié est confirmé, migrer vers Option B en V2.

---

## 7 — Mobile UX

### 7.1 Principes DA

Conformément à la DA "Épurée et Chic" :
- `rounded-xl` sur les cartes
- Fond `bg-muted/20` pour les surfaces secondaires
- Espacement généreux (`tracking-wide`, `gap-4`)
- Pas de bordures lourdes — ombres subtiles (`shadow-sm`)
- Typographie : titres `font-semibold`, montants `font-bold tabular-nums`

### 7.2 Taille des lignes jour (CashDayRow)

- Hauteur : `min-h-[56px]` (zone tactile confortable)
- Padding : `px-4 py-3`
- Layout : flexbox `justify-between items-center`
- Date à gauche (2 lignes : jour de la semaine en petit, date en principal)
- Montant + % à droite

### 7.3 Interactions

| Action | Résultat |
|--------|----------|
| Tap sur une ligne jour | Ouvre `CashDayDrawer` |
| Tap bouton œil | Toggle visibilité montants |
| Tap "Saisir la caisse" | Ouvre `CashWizardModal` |
| Tap "Détails" dans drawer jour | Ouvre `CashDetailDrawer` |
| Tap "Modifier" dans drawer jour | Ouvre `CashDayForm` en édition (admin) |
| Swipe left/right sur mois | Non implémenté (boutons ◀ ▶) |

### 7.4 Navigation mois

- Boutons `◀` et `▶` pour naviguer entre mois
- Label central : `Mars 2026` (format `MMMM yyyy`, locale fr)
- Le mois courant est le défaut à l'ouverture
- Pas de limite de navigation (historique libre)

### 7.5 Drawer comportement

- Utilise le composant `Drawer` (vaul) existant dans `src/components/ui/drawer.tsx`
- Snap points : 60% écran pour `CashDayDrawer`, 80% pour `CashDetailDrawer`
- Fermeture par swipe down ou tap overlay
- Poignée visible (`h-2 w-[100px] bg-muted`)

---

## 8 — Plan d'implémentation

### Ordre recommandé

| Phase | Tâche | Dépendances |
|:-----:|-------|-------------|
| 1 | **Créer `useAmountVisibility`** — hook masquage | Aucune |
| 2 | **Créer `AmountCell` + `VisibilityToggle`** | Phase 1 |
| 3 | **Créer `CashMonthHeader`** — indicateurs + nav mois | useCashMonth existant |
| 4 | **Créer `CashDayRow` + `CashDayList`** — liste jours | Phase 2, useCashMonth |
| 5 | **Créer `CashMainView`** — assemblage page | Phases 2-4 |
| 6 | **Créer `CashDayDrawer`** — détail jour au tap | Phase 5 |
| 7 | **Créer `CashDetailDrawer`** — stats mois détaillées | Phase 6 |
| 8 | **Migration DB** — ajouter `advance_eur` (si validé) | Aucune (parallélisable) |
| 9 | **Créer `useCashWizard` + `CashWizardModal` + WizardSteps** | Phase 8, useCashDay |
| 10 | **Brancher `CashMainView` dans `CashPage.tsx`** | Phase 9 |
| 11 | **Supprimer `CashMonthAdmin` + `CashDayOnlyView`** | Phase 10 |
| 12 | **Polish UI** — animations, transitions, responsive desktop | Phase 11 |

### Estimation par phase

| Phase | Effort |
|:-----:|--------|
| 1-2 | Faible (30 min) |
| 3-5 | Moyenne (1h30) |
| 6-7 | Faible (45 min) |
| 8 | Faible (15 min migration SQL) |
| 9 | Élevée (2h — wizard multi-étape + acompte) |
| 10-11 | Faible (15 min) |
| 12 | Moyenne (1h) |

---

## 9 — Risques

### 9.1 Régressions possibles

| Risque | Probabilité | Mitigation |
|--------|:-----------:|------------|
| Perte de la vue admin (édition jour passé) | Moyenne | Conserver `CashDayForm` comme composant d'édition accessible depuis le drawer |
| Rupture permissions caisse_day vs caisse_month | Faible | `useCashPermissions` est inchangé, le routing dans `CashPage.tsx` reste identique |
| Rupture realtime | Faible | `useCashReportsChannel` est externe au module, non impacté |

### 9.2 Conflits données

| Risque | Probabilité | Mitigation |
|--------|:-----------:|------------|
| Ajout colonne `advance_eur` sans défaut | Faible | Migration avec `DEFAULT 0 NOT NULL` — aucun impact sur les données existantes |
| `total_eur` ne reflète pas l'acompte | Faible | Ne pas modifier `total_eur` (il reste = CA brut). L'acompte est une déduction séparée, comme courses/maintenance |

### 9.3 Latence

| Risque | Probabilité | Mitigation |
|--------|:-----------:|------------|
| Chargement lent de la liste jours | Faible | `useCashMonth` charge déjà tout le mois en une requête. Aucune requête supplémentaire nécessaire |
| Wizard multi-étape perçu comme lent | Faible | Animations fluides framer-motion entre étapes, pas de fetch intermédiaire |

### 9.4 Acompte salarié

| Risque | Probabilité | Mitigation |
|--------|:-----------:|------------|
| Liste salariés non disponible dans le module caisse | Moyenne | Nécessite un hook pour lister les employés de l'établissement. Vérifier si un hook existe déjà dans le module employees |
| Traçabilité insuffisante (Option A) | Moyenne | Documenter la limitation. Prévoir migration vers Option B si besoin confirmé |

---

## 10 — Estimation complexité globale

**Moyenne**

- Aucune modification architecturale profonde
- Aucun nouveau modèle DB complexe (1 colonne ajoutée)
- Hooks existants réutilisés à 100%
- Le wizard est le composant le plus complexe (multi-étape + acompte)
- Le masquage est trivial (state React + visibilitychange)
- La liste jours est un simple map sur des données déjà chargées

---

## 11 — Décisions validées

| # | Question | Décision |
|:-:|----------|----------|
| 1 | **Acompte salarié** | **Option B — Table dédiée** `cash_advances(id, cash_day_report_id, employee_user_id, amount_eur, ...)` avec traçabilité par salarié |
| 2 | **Champ Livraison** | **Oui, étape dédiée** dans le wizard (étape 3, après Espèces) |
| 3 | **Champ Manque + Note** | **Les deux dans le wizard** — Manque groupé à l'étape Courses/Maintenance (3 champs), Note à l'étape résumé |
| 4 | **Vue desktop** | **Liste unifiée** — même interface liste sur mobile et desktop |
| 5 | **Permission caisse_day** | **Mois visible en lecture seule** — l'utilisateur caisse_day voit la liste du mois mais ne peut saisir que le jour courant |

### Impact sur l'architecture

- **Migration DB** : créer table `cash_advances` (id, cash_day_report_id FK, employee_user_id, amount_eur, created_by, created_at) + RLS policies
- **Wizard révisé** : 6 étapes au lieu de 5 :
  1. CB
  2. Espèces
  3. Livraison
  4. Courses + Maintenance + Manque
  5. Acompte salarié (Oui/Non → sélection employé → montant)
  6. Résumé + Note + Confirmer
- **Hook supplémentaire** : `useCashAdvances` pour CRUD sur la table dédiée
- **calculateBalance** mis à jour : `CA - courses - maintenance - shortage - Σ advances`
