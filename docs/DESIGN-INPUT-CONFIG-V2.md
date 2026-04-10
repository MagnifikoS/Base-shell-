# MODULE — Paramètres avancés de saisie produit (V2 CORRIGÉE)

> **Statut** : Design doc — aucun code, aucun branchement
> **Date** : 2026-03-26
> **Auteur** : Système + validation métier

---

## 1. REFORMULATION DU BESOIN

On veut un module **isolé** qui permet de configurer, pour chaque produit, **comment l'opérateur doit saisir les quantités**.

Deux contextes seulement :
- **Réception fournisseur** (entrée de stock)
- **Usage interne** (retrait, inventaire, correction, expédition, transfert…)

Le module ne se branche à **aucun modal existant**.
Il stocke des règles que le futur modal unifié lira.

---

## 2. DONNÉES RÉELLES DE LA BASE (audit)

### Distribution des unités finales (664 produits actifs avec config)

| Unité finale | Nb produits | Famille DB | Nature |
|---|---:|---|---|
| Pièce | 232 | count/kitchen | **Discrète** |
| Kilogramme | 111 | weight | **Continue** |
| Bouteille | 98 | count/stock | **Discrète** |
| Pot | 54 | count/stock | **Discrète** |
| Boîte | 41 | count/stock | **Discrète** |
| Bidon | 34 | count/stock | **Discrète** |
| Sachet | 32 | count/stock | **Discrète** |
| Paquet | 23 | count/stock | **Discrète** |
| Sac | 15 | count/stock | **Discrète** |
| Seau | 7 | count/stock | **Discrète** |
| Carton | 5 | count/stock | **Discrète** |
| Litre | 1 | volume | **Continue** |
| Rouleau | 3 | count/stock | **Discrète** |
| Canette | 2 | count/stock | **Discrète** |
| Tranche | 2 | count/stock | **Discrète** |

### Distribution des niveaux de conditionnement

| Niveaux | Nb produits |
|---:|---:|
| 0 | 310 |
| 1 | 294 |
| 2 | 60 |

### Familles d'unités en DB

| Famille | Nature | Exemples | Nb unités |
|---|---|---|---:|
| `weight` | Continue | kg, g | 14 |
| `volume` | Continue | L, ml, cl | 21 |
| `count` | Discrète | Pièce, Carton, Boîte, Pot… | 210 |

---

## 3. CLASSIFICATION NATURE — RÈGLE D'OR

La nature de saisie est **déterminée automatiquement** par la famille de l'unité finale du produit.

```
SI family = 'weight' OU family = 'volume'
  → nature = CONTINUE

SI family = 'count'
  → nature = DISCRÈTE
```

**Aucun choix utilisateur sur la nature.** C'est un fait physique.

### Conséquence directe sur les modes de saisie autorisés

| Nature de l'unité finale | Nb niveaux | Modes autorisés |
|---|---:|---|
| **Continue** (kg, L…) | 0 | `continuous` uniquement |
| **Continue** (kg, L…) | 1+ | `continuous` ou `multi_level` |
| **Discrète** (Pièce, Boîte…) | 0 | `integer` ou `fraction` |
| **Discrète** (Pièce, Boîte…) | 1+ | `integer`, `fraction` ou `multi_level` |

**⚠️ INTERDIT :**
- `continuous` sur une unité discrète (pas 1.37 Boîte)
- `fraction` sur une unité continue (inutile, `continuous` suffit)

**ℹ️ NOTE :** `continuous` accepte naturellement les entiers (`3 kg` est un cas valide de `2.350 kg`). Pas besoin d'un mode `integer` séparé pour les unités continues — `continuous` couvre déjà ce cas.

---

## 4. LES 4 MODES DE SAISIE

### 4.1 `continuous` — Saisie numérique libre

- **Pour** : kg, g, L, ml, cl
- **Input** : champ numérique libre, 0-3 décimales (les entiers type `3 kg` sont naturellement acceptés)
- **Exemples** : `2.350 kg`, `0.750 L`, `3 kg`
- **Contrainte** : quantité > 0

### 4.2 `integer` — Entier uniquement

- **Pour** : Pièce, Boîte, Carton, Pot, Sachet…
- **Input** : stepper +/- ou saisie numérique filtrée (pas de `.` ni `,`)
- **Exemples** : `3 Boîtes`, `12 Pièces`
- **Contrainte** : quantité > 0, entier strict

### 4.3 `fraction` — Entier + fractions contrôlées

- **Pour** : Pièce, Boîte, Carton, Pot… quand le métier le justifie
- **Input** : stepper entier + chips fraction
- **Fractions disponibles** : `1/4`, `1/2`, `3/4` (fixe, pas configurable par produit)
- **Exemples** : `2 + 1/2 Carton` = 2.5, `1 + 3/4 Boîte` = 1.75
- **Contrainte** : partie entière ≥ 0, total > 0

### 4.4 `multi_level` — Saisie par niveaux

- **Pour** : tout produit ayant ≥ 1 niveau de conditionnement
- **Input** : un champ entier par niveau activé
- **Exemples** : `2 Cartons + 3 Boîtes`, `1 Carton + 0 Sac + 5 Kg`
- **Niveaux visibles** : pilotés par la config (voir §5)
- **Conversion** : le système calcule le total en unité finale automatiquement

---

## 5. STRUCTURE D'UNE RÈGLE DE CONFIGURATION

Pour chaque produit × chaque groupe (réception / interne), une règle contient :

```typescript
interface InputRule {
  /** Mode de saisie */
  mode: 'continuous' | 'integer' | 'fraction' | 'multi_level';

  /** UUID de l'unité affichée par défaut (measurement_units.id) */
  default_unit_id: string;

  /** Niveaux à afficher (uniquement si mode = multi_level) */
  visible_levels?: {
    /** Montrer le niveau 1 (ex: Carton) */
    level_1: boolean;
    /** Montrer le niveau 2 (ex: Boîte) */
    level_2: boolean;
    /** Montrer l'unité finale (ex: Pièce) */
    final_unit: boolean;
  };
}
```

**Pas de champ `fractions`** : les fractions autorisées sont toujours `[1/4, 1/2, 3/4]` — fixe pour tous. Ça évite la complexité de config et les incohérences.

---

## 6. MATRICE COMPLÈTE DES CAS MÉTIER

### 6.1 Produit kg, 0 niveau (ex: Beurre en vrac)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `continuous` | kg | — |
| Interne | `continuous` | kg | — |

→ **Aucun choix à faire.** Configuration automatique.

### 6.2 Produit kg, 1 niveau (ex: Fior di Latte — Sac de 2kg)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `multi_level` | Sac | `continuous` (kg seul) |
| Interne | `continuous` | kg | `multi_level` (Sac + kg) |

### 6.3 Produit kg, 2 niveaux (ex: Mozzarella — Carton → Sac → kg)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `multi_level` | Carton | `continuous` (kg seul) |
| Interne | `continuous` | kg | `multi_level` (niveaux au choix) |

### 6.4 Produit Pièce, 0 niveau (ex: Citron)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `integer` | Pièce | `fraction` |
| Interne | `integer` | Pièce | `fraction` |

### 6.5 Produit Pièce, 1 niveau (ex: Œufs — Boîte de 30 pièces)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `multi_level` | Boîte | `integer` (Pièce) |
| Interne | `integer` | Pièce | `multi_level`, `fraction` |

### 6.6 Produit Pièce, 2 niveaux (ex: Serviettes — Carton → Paquet → Pièce)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `multi_level` | Carton | — |
| Interne | `multi_level` | Paquet + Pièce | `integer` (Pièce seule) |

### 6.7 Produit Boîte/Pot/Sachet, 0 niveau

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `integer` | Boîte | `fraction` |
| Interne | `integer` | Boîte | `fraction` |

### 6.8 Produit Bouteille, 1 niveau (ex: Vin — Carton de 6 bouteilles)

| Contexte | Mode proposé | Unité par défaut | Alternatives |
|---|---|---|---|
| Réception | `multi_level` | Carton | `integer` (Bouteille) |
| Interne | `integer` | Bouteille | `multi_level`, `fraction` |

### 6.9 Cas spécial — Aubergine

**Phase 1** : produit en kg uniquement
- Réception : `continuous` (kg)
- Interne : `continuous` (kg)

**Phase 2** : ajout équivalence 1 Pièce = 200g
- Réception : `continuous` (kg) — inchangé
- Interne : `integer` (Pièce) ← l'utilisateur choisit de switcher

→ Le changement de conditionnement déclenche le statut **"⚠️ à revoir"** (voir §8).

---

## 7. COMPORTEMENT DU FORMULAIRE DE CONFIGURATION

### Principe : le formulaire ne propose QUE les modes valides

```
Utilisateur sélectionne un produit
  → système lit : family, nb_levels, unités disponibles
  → système calcule : modes_autorisés[]
  → formulaire affiche SEULEMENT ces modes
```

### Arbre de décision du formulaire

```
SI family = weight|volume
  ├── 0 niveau  → mode fixe : continuous (pas de choix)
  └── 1+ niveau → choix : continuous OU multi_level
       └── SI multi_level → afficher config niveaux

SI family = count
  ├── 0 niveau  → choix : integer OU fraction
  └── 1+ niveau → choix : integer, fraction OU multi_level
       └── SI multi_level → afficher config niveaux
```

### Contrôle : aucune erreur possible

| Situation | Le formulaire... |
|---|---|
| Produit kg, 0 niveau | N'affiche AUCUN choix, mode auto = `continuous` |
| Produit Pièce, 0 niveau | Affiche 2 choix : `integer` / `fraction` |
| Produit 2 niveaux | Affiche le toggle niveaux visibles |
| Bulk : 10 produits kg | Applique `continuous` directement |
| Bulk : mix kg + pièce | **Refuse** ou propose uniquement les modes communs |

---

## 8. GESTION DU CHANGEMENT DE CONDITIONNEMENT

### Quand un produit change de conditionnement

Événements déclencheurs :
1. Ajout d'un niveau de packaging
2. Suppression d'un niveau
3. Changement d'unité finale
4. Changement de famille d'unité (weight → count ou inverse)

### Détection d'incohérence

Le système compare la config sauvegardée vs l'état actuel du produit :

```
SI config.mode = 'multi_level' ET nb_niveaux_actuels = 0
  → INCOHÉRENT (il n'y a plus de niveaux)

SI config.mode = 'continuous' ET family_actuelle = 'count'
  → INCOHÉRENT (décimales sur unité discrète)

SI config.mode = 'integer' ET family_actuelle = 'weight'
  → INCOHÉRENT (entier sur unité continue)

SI config.default_unit_id ne correspond plus à aucun niveau du produit
  → INCOHÉRENT (unité par défaut disparue)
```

### Statuts résultants

| Statut | Icône | Signification |
|---|---|---|
| **Non configuré** | ⚪ | Aucune règle définie |
| **Configuré** | 🟢 | Règles définies ET cohérentes |
| **⚠️ À revoir** | 🟡 | Règles définies MAIS incohérentes avec le conditionnement actuel |

### Quand recalculer le statut ?

- **À l'affichage** du module (comparaison en mémoire, pas de trigger DB)
- **Pas de trigger automatique** sur le changement de conditionnement (trop complexe)
- Le module lit le `conditionnement_config` du produit et compare avec la config saisie

---

## 9. STRUCTURE DE DONNÉES

### Nouvelle table : `product_input_config`

```sql
CREATE TABLE product_input_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products_v2(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,

  -- Règle Réception fournisseur
  reception_mode TEXT NOT NULL DEFAULT 'integer',
    -- 'continuous' | 'integer' | 'fraction' | 'multi_level'
  reception_default_unit_id UUID REFERENCES measurement_units(id),
  reception_level_1 BOOLEAN NOT NULL DEFAULT true,
  reception_level_2 BOOLEAN NOT NULL DEFAULT false,
  reception_final_unit BOOLEAN NOT NULL DEFAULT true,

  -- Règle Usage interne
  internal_mode TEXT NOT NULL DEFAULT 'integer',
  internal_default_unit_id UUID REFERENCES measurement_units(id),
  internal_level_1 BOOLEAN NOT NULL DEFAULT true,
  internal_level_2 BOOLEAN NOT NULL DEFAULT false,
  internal_final_unit BOOLEAN NOT NULL DEFAULT true,

  -- Métadonnées
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,

  UNIQUE(product_id, establishment_id)
);

ALTER TABLE product_input_config ENABLE ROW LEVEL SECURITY;
```

### Pourquoi pas de JSONB ?

- Requêtes filtrées par mode facile en SQL
- Validation contrainte côté DB possible
- Pas de risque de shape inconsistante

### Pourquoi pas de champ `fractions` ?

Les fractions autorisées sont **universelles** : `[1/4, 1/2, 3/4]`.
Aucun produit n'a besoin de `1/3` ou `1/5` en restauration.
Ça supprime un champ, un formulaire, et une source de bugs.

### Pourquoi pas de champ `status` en DB ?

Le statut (non configuré / configuré / à revoir) est **calculé à la volée** :
- Pas de config → non configuré
- Config existe → on compare mode vs famille + niveaux actuels → configuré ou à revoir

Stocker le statut créerait une source de désynchronisation.

---

## 10. UX — ÉCRAN DE CONFIGURATION

### Layout principal

```
┌─────────────────────────────────────────────────────────┐
│ Paramètres de saisie                                    │
├─────────────────────────────────────────────────────────┤
│ [🔍 Recherche...] [Unité ▼] [Niveaux ▼] [Statut ▼]    │
├────┬──────────────┬────────┬────────┬──────────┬────────┤
│ ☐  │ Produit      │ Unité  │ Niv.   │ Récept.  │ Inter. │
├────┼──────────────┼────────┼────────┼──────────┼────────┤
│ ☐  │ Beurre       │ kg     │ 0      │ 🟢 cont. │ 🟢 cont│
│ ☐  │ Citron       │ Pièce  │ 0      │ ⚪ —     │ ⚪ —   │
│ ☐  │ Mozzarella   │ kg     │ 2      │ 🟢 multi │ 🟢 cont│
│ ☐  │ Serviettes   │ Pièce  │ 2      │ 🟡 ⚠️   │ 🟡 ⚠️  │
│ ☐  │ Œufs         │ Pièce  │ 1      │ 🟢 multi │ 🟢 int │
└────┴──────────────┴────────┴────────┴──────────┴────────┘
│ [3 sélectionnés]  [Tout désélect.] │ [Configurer ▶]    │
└─────────────────────────────────────────────────────────┘
```

### Colonnes

| Colonne | Contenu |
|---|---|
| ☐ | Checkbox sélection |
| Produit | `nom_produit` |
| Unité | Unité finale (`finalUnit` du conditionnement_config) |
| Niv. | Nombre de niveaux de conditionnement (0, 1, 2) |
| Récept. | Statut + mode résumé pour Réception fournisseur |
| Inter. | Statut + mode résumé pour Usage interne |

### Filtres

| Filtre | Options |
|---|---|
| Recherche | Texte libre sur `nom_produit` |
| Unité principale | kg, Pièce, Bouteille, Pot, Boîte, Bidon, Sachet, Paquet, Sac, Autre |
| Niveaux | 0, 1, 2+ |
| Statut | Non configuré, Configuré, À revoir |

### Bulk action : "Configurer"

Le clic sur "Configurer" avec N produits sélectionnés ouvre un **dialog compact** :

```
┌─────────────────────────────────────────────┐
│ Configurer 12 produits                      │
│                                             │
│ Ces produits sont : Pièce, 0 niveau         │
│                                             │
│ ── Réception fournisseur ──                 │
│ Mode : (•) Entier  ( ) Fraction             │
│                                             │
│ ── Usage interne ──                         │
│ Mode : (•) Entier  ( ) Fraction             │
│                                             │
│         [Annuler]  [Appliquer à 12 prod.]   │
└─────────────────────────────────────────────┘
```

**Règle clé pour les sélections hétérogènes** : si les produits sélectionnés ont des structures différentes (mix de familles ou niveaux), le système **ne bloque pas** mais applique intelligemment :

1. Affiche un avertissement : *"Sélection mixte : 5 en kg, 7 en Pièce"*
2. Propose les modes applicables
3. **Applique uniquement aux produits compatibles**, ignore les autres
4. Résumé post-action : *"Configuration appliquée à 5/12 produits (les 7 produits Pièce ne sont pas compatibles avec le mode continu)"*

→ L'utilisateur n'est jamais bloqué, mais il est toujours informé.

### Config individuelle (clic sur une ligne)

Même dialog, mais pré-rempli avec les valeurs actuelles du produit.
Le formulaire s'adapte automatiquement aux modes autorisés (cf §7).

---

## 11. RECOMMANDATIONS PERSONNELLES

### 11.1 — Fractions fixes, pas configurables

**Ne pas** permettre de choisir les fractions par produit. `[1/4, 1/2, 3/4]` couvrent 100% des cas restauration. Un produit "1/3 de Boîte" n'a pas de sens opérationnel. Ça supprime un formulaire entier et évite les configurations aberrantes.

### 11.2 — Auto-configuration SYSTÉMATIQUE (obligatoire)

⚠️ **Ce n'est pas optionnel.** À la création d'un produit OU au changement de conditionnement, le système **génère automatiquement** la config par défaut :

| Situation | Réception par défaut | Interne par défaut |
|---|---|---|
| kg, 0 niveaux | `continuous` / kg | `continuous` / kg |
| Pièce, 0 niveaux | `integer` / Pièce | `integer` / Pièce |
| Pièce, 1+ niveaux | `multi_level` / niveau supérieur | `integer` / Pièce |
| kg, 1+ niveaux | `multi_level` / niveau supérieur | `continuous` / kg |

→ L'utilisateur ne part **jamais de zéro**. Il valide ou ajuste, c'est tout.
→ Si le conditionnement change, la config est régénérée ET marquée **"⚠️ à revoir"** pour que l'utilisateur confirme.

### 11.3 — "Configuration express" par groupe

Proposer des boutons rapides en haut du module :

- **"Configurer tous les kg"** → applique `continuous` partout
- **"Configurer toutes les Pièces sans niveau"** → applique `integer` partout
- **"Configurer toutes les Pièces multi-niveaux"** → applique `multi_level`

→ Un opérateur pourrait configurer 400 produits en **3 clics**.

### 11.4 — Ne pas sur-ingéniérer `multi_level`

Pour la V1 du module, le mode `multi_level` active simplement **tous les niveaux disponibles**. Pas besoin de toggle par niveau pour l'instant.

Justification : sur 60 produits avec 2 niveaux, 100% ont une chaîne logique (Carton → Boîte → Pièce). L'opérateur veut toujours voir tous les niveaux quand il choisit multi_level.

Si le besoin émerge plus tard (masquer un niveau intermédiaire), on ajoutera le toggle. Pas avant.

### 11.5 — Pas de mode `fraction` en réception fournisseur

En réception, on reçoit des unités complètes (Cartons, Sacs…).
Le mode `fraction` n'a de sens qu'en **usage interne** (retrait d'1/2 Boîte).

→ En réception, proposer uniquement : `integer`, `continuous`, ou `multi_level`.

---

## 12. CE QUI N'EST PAS DANS LE SCOPE

| Hors scope | Raison |
|---|---|
| Branchement aux modals existants | Module isolé, phase 1 |
| Trigger DB sur changement de conditionnement | Complexité inutile, statut calculé à la volée |
| Fractions configurables par produit | Sur-ingénierie, 1/4, 1/2, 3/4 suffisent |
| Mode `manual` | Remplacé par `continuous` (plus précis sémantiquement) |
| Config par fournisseur | Un produit = une config, quel que soit le fournisseur |
| Validation en temps réel des saisies | C'est le job du futur modal unifié, pas de ce module |

---

## 13. RISQUES À ÉVITER

| Risque | Mitigation |
|---|---|
| Utilisateur configure `continuous` sur une Boîte | **Impossible** : le formulaire ne propose pas ce mode pour les unités discrètes |
| Configuration en masse sur mix hétérogène | **Bloqué** : le bulk n'autorise que des groupes homogènes |
| Changement de conditionnement rend la config obsolète | **Détecté** : statut "⚠️ à revoir" calculé à la volée |
| Table `product_input_config` désynchronisée | **Impossible** : pas de statut stocké, tout est recalculé |
| Complexité du formulaire pour l'utilisateur | **Minimisée** : le formulaire ne montre que les choix valides, jamais tous les modes |
| 400 produits à configurer = fastidieux | **Résolu** : config express + bulk homogène + auto-defaults |

---

## 14. VERDICT FINAL

### Ce qui change vs V1 du design

| Aspect | V1 (ancien) | V2 (corrigé) |
|---|---|---|
| Modes de saisie | `manual` fourre-tout | 4 modes clairs liés à la physique |
| Modes autorisés | Tous pour tous | Filtrés par famille + niveaux |
| Fractions | Configurables par produit | Fixes : 1/4, 1/2, 3/4 |
| Statuts | non configuré / partiel / complet | non configuré / configuré / ⚠️ à revoir |
| Détection changement | Aucune | Comparaison à la volée |
| Bulk hétérogène | Autorisé | Bloqué (sécurité métier) |
| fraction en réception | Autorisé | Interdit (pas de sens métier) |

### Pourquoi c'est simple

1. **Pas de choix absurde** — le formulaire est contraint par la physique du produit
2. **Pas de configuration inutile** — les fractions sont fixes, les produits simples sont auto-configurés
3. **Pas de désynchronisation** — le statut est calculé, jamais stocké
4. **Pas de sur-ingénierie** — toggle par niveau reporté à une V2
5. **Configuration rapide** — 3 clics pour 400 produits via config express

### Prêt pour implémentation

Le module peut être construit dans `src/modules/inputConfig/` sans toucher à aucun fichier existant.

---

## 15. STOP — LE MODAL UNIFIÉ (aperçu)

Ce module de configuration est la **brique 1** de la stratégie d'unification.

La **brique 2** sera le modal unifié qui :
- Lit la config depuis `product_input_config`
- Affiche l'interface de saisie correspondante au mode
- Remplace tous les modals actuels (SimpleQuantityPopup, UniversalQuantityModal, etc.)

**Mais ce n'est PAS dans ce chantier.**

Le modal unifié ne sera construit qu'une fois :
1. Ce module de config est validé et rempli
2. Les règles sont testées sur données réelles
3. L'équipe valide l'UX de chaque mode de saisie

Pas avant.
