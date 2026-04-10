# Stratégie Finale Module Caisse V2

---

## 1 — Résumé exécutif

Cette stratégie corrige et simplifie la version précédente pour produire un MVP Caisse :

- **Plus simple** : wizard 5 étapes (CB → Espèces → Courses/Maintenance → Acompte → Résumé), sans Livraison, sans Note, sans Manque dans le flow rapide.
- **Plus sûr** : aucune nouvelle table DB. Deux colonnes ajoutées à `cash_day_reports` (`advance_eur`, `advance_employee_id`). Anciens composants dépréciés progressivement, jamais supprimés brutalement.
- **Plus fluide** : un seul drawer avec section détails extensible (pas de double drawer). Montants masqués par défaut, reset automatique.
- **Plus isolé** : aucun impact hors module caisse. Hooks existants réutilisés à 100%.

**Pourquoi c'est mieux pour le MVP** : moins de surface de code, moins de migration DB, moins de risque de régression, saisie quotidienne en ~15 secondes.

---

## 2 — Décisions figées

Ces décisions sont **définitives** et ne doivent plus être rediscutées.

| Sujet | Décision |
|-------|----------|
| **Acompte salarié** | Deux colonnes dans `cash_day_reports` : `advance_eur` (numeric, default 0) + `advance_employee_id` (uuid, nullable, FK profiles) |
| **Note** | Hors wizard principal. Accessible uniquement en édition admin / drawer détail |
| **Manque (shortage_eur)** | Hors wizard principal. Accessible uniquement en édition admin / drawer détail |
| **Livraison (delivery_eur)** | Hors wizard principal. Accessible uniquement en édition admin / drawer détail |
| **Drawer** | Un seul drawer principal avec section détails extensible (Collapsible). Pas de `CashDetailDrawer` séparé |
| **Anciens composants** | Remplacement fonctionnel → dépréciation → suppression après validation. Jamais de suppression immédiate |

---

## 3 — Architecture cible corrigée

### 3.1 Structure dossier

```
src/modules/cash/
├── CashPage.tsx                         # Inchangé (routing permission)
├── feature.ts                           # Inchangé
├── index.ts                             # Inchangé
├── hooks/
│   ├── useCashDay.ts                    # Inchangé
│   ├── useCashMonth.ts                  # Inchangé (exposer averagePerDay)
│   ├── useCashPermissions.ts            # Inchangé
│   ├── useBusinessDayToday.ts           # Inchangé
│   ├── useAmountVisibility.ts           # NOUVEAU — état masquage + auto-reset
│   └── useCashWizard.ts                 # NOUVEAU — état wizard (step + valeurs)
├── components/
│   ├── CashMainView.tsx                 # NOUVEAU — vue unifiée (remplace les 2 vues)
│   ├── CashMonthHeader.tsx              # NOUVEAU — indicateurs + nav mois
│   ├── CashDayList.tsx                  # NOUVEAU — liste jours du mois
│   ├── CashDayRow.tsx                   # NOUVEAU — ligne compacte jour
│   ├── CashDayDrawer.tsx                # NOUVEAU — drawer unique avec section détails extensible
│   ├── CashWizardModal.tsx              # NOUVEAU — orchestrateur wizard
│   ├── wizard/
│   │   ├── WizardStepCB.tsx             # Étape 1 — CB
│   │   ├── WizardStepCash.tsx           # Étape 2 — Espèces
│   │   ├── WizardStepExpenses.tsx       # Étape 3 — Courses + Maintenance
│   │   ├── WizardStepAdvance.tsx        # Étape 4 — Acompte oui/non + salarié + montant
│   │   └── WizardStepSummary.tsx        # Étape 5 — Résumé + confirmation
│   ├── AmountCell.tsx                   # NOUVEAU — montant ou •••• €
│   ├── VisibilityToggle.tsx             # NOUVEAU — bouton œil
│   ├── CashDayForm.tsx                  # CONSERVÉ — édition admin (jour passé / champs complets)
│   ├── CashMonthAdmin.tsx               # DÉPRÉCIÉ — remplacé par CashMainView
│   └── CashDayOnlyView.tsx              # DÉPRÉCIÉ — remplacé par CashMainView
├── utils/
│   ├── types.ts                         # ÉTENDU (WizardStep enum, WizardFormValues)
│   ├── money.ts                         # ÉTENDU (calculateBalanceWithAdvance)
│   └── businessDay.ts                   # Inchangé
```

### 3.2 Résumé des actions par composant

| Composant | Action | Note |
|-----------|--------|------|
| `CashMainView` | **Créer** | Point d'entrée unifié, consomme tous les sous-composants |
| `CashMonthHeader` | **Créer** | Total mois + moyenne/jour + nav ◀ mois ▶ |
| `CashDayList` | **Créer** | Map sur les jours du mois |
| `CashDayRow` | **Créer** | Date + montant (ou ••••) + delta % coloré |
| `CashDayDrawer` | **Créer** | Drawer unique : résumé + section détails extensible (Collapsible) |
| `CashWizardModal` | **Créer** | Orchestrateur 5 étapes |
| `WizardStep*` (×5) | **Créer** | Étapes isolées du wizard |
| `AmountCell` | **Créer** | Affiche montant ou masqué selon visibilité |
| `VisibilityToggle` | **Créer** | Bouton œil toggle |
| `useAmountVisibility` | **Créer** | Hook masquage + auto-reset visibilitychange |
| `useCashWizard` | **Créer** | Hook état wizard (step courant, valeurs accumulées) |
| `CashDayForm` | **Conserver** | Utilisé en mode édition admin (tous les champs : CB, Espèces, Livraison, Courses, Maintenance, Manque, Note, Acompte) |
| `CashMonthAdmin` | **Déprécier** | Remplacé fonctionnellement par CashMainView. Suppression après validation |
| `CashDayOnlyView` | **Déprécier** | Remplacé fonctionnellement par CashMainView. Suppression après validation |

---

## 4 — Flow utilisateur final

```
[Page Caisse]
    │
    ├── Liste mensuelle (tous les jours du mois)
    │
    ├── Bouton "Saisir la caisse" (visible si canWrite + jour courant)
    │
    └── CashWizardModal
         │
         ├── Étape 1 — CB
         │   └── Champ montant (inputMode="decimal") + [Valider]
         │
         ├── Étape 2 — Espèces
         │   └── Champ montant + [Valider]
         │
         ├── Étape 3 — Courses + Maintenance
         │   └── 2 champs (défaut 0) + [Valider]
         │
         ├── Étape 4 — Acompte salarié
         │   ├── Question : "Un acompte a-t-il été versé ?"
         │   ├── [Non] → passe à étape 5
         │   └── [Oui] → liste salariés → sélection → montant → [Valider]
         │
         └── Étape 5 — Résumé
             ├── Affiche : CA brut, courses, maintenance, acompte, solde net
             └── [Confirmer] → upsert via useCashDay → ferme modal → toast

Contraintes :
- Retour arrière possible (bouton ←)
- Pré-remplissage si rapport existant pour le jour
- Upsert uniquement à la confirmation finale
- Validation par étape (montants ≥ 0)
```

---

## 5 — Structure UI finale

### 5.1 Page principale (CashMainView)

```
┌─────────────────────────────────────┐
│  Caisse          [👁]  [Établ.]    │  ← Header avec VisibilityToggle
├─────────────────────────────────────┤
│  Total mars        Moyenne / jour   │  ← CashMonthHeader
│  •••• €            •••• €           │
│                                     │
│  ◀   Mars 2026   ▶                 │  ← Navigation mois
├─────────────────────────────────────┤
│  Lun 14 mars          •••• €  +12% │  ← CashDayList > CashDayRow
│  Dim 13 mars          •••• €   -8% │
│  Sam 12 mars          •••• €   +3% │
│  Ven 11 mars          —            │  ← Pas de données
│  ...                                │
├─────────────────────────────────────┤
│        [＋ Saisir la caisse]        │  ← Bouton principal (si canWrite)
└─────────────────────────────────────┘
```

### 5.2 Drawer principal (CashDayDrawer)

Un seul drawer. Section "Détails" extensible via `Collapsible`.

```
┌─────────────────────────────────────┐
│  ═══ (poignée)                     │
│                                     │
│  Lundi 14 mars 2026                │
│                                     │
│  CA brut                   •••• €   │
│  Solde net                 •••• €   │
│                                     │
│  ▶ Détails                         │  ← Collapsible trigger
│  ┌─────────────────────────────────┐│
│  │ CB            ........  •••• € ││  ← CollapsibleContent
│  │ Espèces       ........  •••• € ││
│  │ Livraison     ........  •••• € ││
│  │ ──────────────────────────────  ││
│  │ Courses       ........  •••• € ││
│  │ Maintenance   ........  •••• € ││
│  │ Manque        ........  •••• € ││
│  │ Acompte       ........  •••• € ││
│  │ (Nom salarié)                   ││
│  └─────────────────────────────────┘│
│                                     │
│  [Modifier ✏️]                     │  ← Si canWrite (ouvre CashDayForm)
└─────────────────────────────────────┘
```

### 5.3 Wizard (CashWizardModal)

- Drawer (vaul) sur mobile, Dialog sur desktop
- Progress bar en haut (étape X/5)
- Un champ principal par étape
- Clavier numérique natif (`inputMode="decimal"`)
- Boutons : zone tactile ≥ 48px
- Animation framer-motion entre étapes (slide horizontal)

---

## 6 — Sources de vérité et calculs

### 6.1 Source principale

`cash_day_reports` reste la **seule** table du module caisse. Aucune nouvelle table.

### 6.2 Colonnes ajoutées (migration DB)

| Colonne | Type | Défaut | Nullable | Description |
|---------|------|--------|----------|-------------|
| `advance_eur` | numeric | 0 | NOT NULL | Montant acompte salarié |
| `advance_employee_id` | uuid | null | YES | FK vers `profiles.id` (le salarié ayant reçu l'acompte) |

### 6.3 Calculs

| Calcul | Formule |
|--------|---------|
| **CA brut** (`total_eur`) | `cb_eur + cash_eur + delivery_eur` (inchangé) |
| **Solde net** | `total_eur - courses_eur - maintenance_eur - shortage_eur - advance_eur` |
| **Moyenne/jour** | `Σ total_eur / nombre_jours_avec_données` (existant dans `useCashMonth`) |
| **Delta %** | `((total_eur_jour - moyenne) / moyenne) * 100` |

Règles delta :
- `> 0` → vert (`text-emerald-600`)
- `< 0` → rouge (`text-destructive`)
- `|delta| < 2%` → neutre (`text-muted-foreground`)
- `moyenne === 0` → afficher `—`

### 6.4 Ce qui ne change pas

- `calculateCA()` dans `money.ts` reste identique
- `total_eur` en DB reste = CA brut (CB + Espèces + Livraison)
- `useCashDay` et `useCashMonth` restent les hooks principaux
- Le realtime reste centralisé dans `useCashReportsChannel`

---

## 7 — Masquage montants

### 7.1 Où vit l'état

State React local (`useState(false)`) dans `CashMainView`, distribué en props aux enfants. **Pas de localStorage, pas de contexte global.**

### 7.2 Hook `useAmountVisibility`

```typescript
const [visible, setVisible] = useState(false);
const toggle = () => setVisible(v => !v);

useEffect(() => {
  const reset = () => { if (document.hidden) setVisible(false); };
  document.addEventListener("visibilitychange", reset);
  return () => document.removeEventListener("visibilitychange", reset);
}, []);
```

### 7.3 Quand ça reset

| Événement | Mécanisme |
|-----------|-----------|
| Changement d'onglet | `visibilitychange` → `hidden` → `setVisible(false)` |
| Quitter l'app mobile | Même événement |
| Navigation vers autre page | Composant démonte → state perdu (false par défaut) |
| Retour sur la page | Composant remonte → `useState(false)` → masqué |

### 7.4 Pourquoi c'est safe

- Aucune persistance = aucun risque de fuite entre sessions
- Reset agressif = même un regard par-dessus l'épaule est limité
- State local = isolé au module caisse, pas de side-effect global

---

## 8 — UX mobile

### 8.1 Pourquoi le flow est plus léger

- Wizard 5 étapes vs formulaire 7 champs simultanés
- Un seul champ visible à la fois (sauf étape 3 : Courses + Maintenance)
- Pas de scroll, pas de surcharge cognitive

### 8.2 Pourquoi il est plus rapide

- Clavier numérique natif (`inputMode="decimal"`)
- Bouton Valider large, toujours visible
- Pré-remplissage si données existantes
- 0 fetch intermédiaire (upsert uniquement à la fin)

### 8.3 Comment la page reste épurée

- Montants masqués par défaut → visuellement calme
- Liste jours = une ligne par jour, hauteur fixe `min-h-[56px]`
- 2 indicateurs en haut (Total + Moyenne), pas plus
- Pas de tableau dense, pas de colonnes multiples

### 8.4 Comment le drawer reste simple

- Un seul drawer, pas de cascade
- CA brut + Solde net visibles immédiatement
- Section "Détails" repliée par défaut (Collapsible)
- Bouton Modifier visible uniquement si `canWrite`

### 8.5 Comment la navigation mois reste lisible

- Boutons ◀ ▶ larges (zone tactile 48px)
- Label central : `Mars 2026` (format `MMMM yyyy`)
- Mois courant par défaut à l'ouverture
- Pas de limite de navigation

---

## 9 — Plan d'implémentation final

| Phase | Tâche | Effort |
|:-----:|-------|:------:|
| 1 | **Migration DB** : `advance_eur` + `advance_employee_id` sur `cash_day_reports` | Faible |
| 2 | **Types** : étendre `types.ts` (WizardStep, WizardFormValues) + `money.ts` (calculateBalanceWithAdvance) | Faible |
| 3 | **`useAmountVisibility`** + **`AmountCell`** + **`VisibilityToggle`** | Faible |
| 4 | **`CashMonthHeader`** : indicateurs + navigation mois | Faible |
| 5 | **`CashDayRow`** + **`CashDayList`** : liste jours avec delta % | Moyenne |
| 6 | **`CashMainView`** : assemblage page (header + list + bouton saisie) | Moyenne |
| 7 | **`useCashWizard`** + **`CashWizardModal`** + 5 `WizardStep*` | Élevée |
| 8 | **`CashDayDrawer`** : drawer unique avec section Collapsible | Moyenne |
| 9 | **Branchement** : `CashPage.tsx` pointe vers `CashMainView` | Faible |
| 10 | **Dépréciation** : marquer `CashMonthAdmin` + `CashDayOnlyView` comme dépréciés | Faible |
| 11 | **Polish** : animations framer-motion, responsive, transitions | Moyenne |

---

## 10 — Risques résiduels

| Risque | Probabilité | Mitigation |
|--------|:-----------:|------------|
| Liste salariés non disponible dans le module caisse | Moyenne | Vérifier si un hook existe dans le module employees. Sinon, créer un hook léger `useEstablishmentEmployees` qui query `profiles` filtré par `establishment_members` |
| Perte édition admin (jours passés, champs complets) | Faible | `CashDayForm` est conservé et accessible depuis le bouton "Modifier" du drawer |
| `advance_employee_id` orphelin si salarié supprimé | Faible | FK vers `profiles` avec `ON DELETE SET NULL`. Le montant `advance_eur` reste intact |
| Régression permissions caisse_day vs caisse_month | Faible | `useCashPermissions` inchangé. `CashMainView` conditionne le bouton saisie sur `canWrite` + jour courant |
| Migration DB bloquante | Très faible | Ajout de colonnes avec défauts, 0 impact sur données existantes |

---

## 11 — Estimation complexité

**Moyenne**

Justification :
- Aucune nouvelle table DB (2 colonnes ajoutées)
- Hooks existants réutilisés à 100%
- Le wizard 5 étapes est le composant le plus complexe mais reste standard (state machine linéaire)
- Le masquage est trivial (state + visibilitychange)
- La liste jours est un simple `.map()` sur données déjà chargées
- Un seul drawer avec Collapsible = plus simple que le double drawer

---

## 12 — Verdict final

**Oui — cette stratégie est prête à être implémentée.**

Elle est :
- ✅ **Isolée** : aucun impact hors `src/modules/cash/`
- ✅ **Mobile-first** : wizard un champ par écran, drawer bottom-sheet, zones tactiles larges
- ✅ **MVP-safe** : aucune nouvelle table, colonnes avec défauts, anciens composants dépréciés progressivement
- ✅ **Sans surcharge** : 5 étapes wizard, 1 drawer, 0 double navigation
- ✅ **Privacy-first** : montants masqués par défaut, reset agressif, aucune persistance
- ✅ **Conforme aux arbitrages** : tous les points de la section 2 sont respectés sans exception
