# Audit de non-régression — Module Commande Plats

> **Date :** 2026-03-09
> **Objectif :** Vérifier avec précision si tout ce qui a été ajouté autour du module Commande Plats présente un risque, direct ou indirect, pour le module Commandes produit existant.
> **Approche :** Audit parano, strict, exhaustif, défendable.

---

## Prompt d'audit de référence

Tu es un architecte logiciel senior ERP SaaS B2B restauration.

Je veux un audit complet de non-régression, pas de code pour l'instant.

**Objectif :**
Vérifier avec précision si tout ce qui a déjà été ajouté autour du module Commande Plats présente un risque, direct ou indirect, pour le module Commandes produit existant.

Je veux un audit parano, strict, exhaustif, défendable.

---

### CONTEXTE

Nous avons déjà ajouté / préparé :

**Domaine plats :**
- `commande_plats`
- `commande_plat_lines`
- `litige_plats`
- `litige_plat_lines`
- `order_groups`
- RPC plats dédiées
- edge function `commandes-plats-api`
- hooks/services/composants dans `src/modules/commandesPlats/`

**Intégration visuelle déjà amorcée :**
- modification de `src/pages/Commandes.tsx`
- création de composants plats pour :
  - liste
  - détail
  - préparation
  - réception
  - tentative d'unification visuelle

**Contrainte absolue :**
Le module Commandes produit existant doit rester :
- intact
- non régressé
- non pollué
- non ralenti
- non ambigu pour l'utilisateur

---

### CE QUE TU DOIS AUDITER

Je veux que tu examines tout le code déjà touché et toutes les interactions possibles avec le module commandes existant.

---

## SECTION 1 — Audit des fichiers touchés

Je veux la liste précise de :
- tous les fichiers créés pour commande plats
- tous les fichiers existants modifiés
- et parmi eux, lesquels sont partagés avec le module commandes existant

Je veux un tableau clair :
fichier | créé/modifié | domaine | niveau de risque

Je veux particulièrement vérifier :
- `src/pages/Commandes.tsx`
- routes
- nav
- éventuels points de composition avec Commandes existantes

---

## SECTION 2 — Audit du risque sur le moteur Commandes existant

Je veux une réponse noire sur blanc :

**Est-ce que le moteur commandes produit existant a été touché ?**

Je veux vérifier explicitement :
- `commandes`
- `commande_lines`
- `litiges`
- `litige_lines`
- `commande_status`
- `commandeService.ts`
- `useCommandes.ts`
- `PreparationDialog.tsx`
- `ReceptionDialog.tsx`
- `CommandeDetailDialog.tsx`
- `CommandesList.tsx`
- `commandes-api`
- RPC existantes produit
- notifications produit
- facture produit
- stock / inventaire / DLC

Je veux savoir pour chacun :
- touché ou non
- impact réel ou nul
- risque latent ou non

---

## SECTION 3 — Audit du point de risque principal : `src/pages/Commandes.tsx`

Je veux que tu analyses en profondeur ce fichier modifié.

**Question centrale :**
Le changement fait sur la page `/commandes` peut-il créer une régression utilisateur ou technique pour les commandes produits ?

Je veux analyser :
- duplication de titre
- bascule Produits / Plats
- cohérence navigation
- impact mobile
- confusion de lecture
- état local parasite
- re-render inutile
- bug de montage/démontage
- perte d'état
- risque de dette future

Je veux une conclusion claire :
- safe
- acceptable mais fragile
- à corriger avant de continuer

---

## SECTION 4 — Audit des risques de collision UI

Je veux que tu examines s'il existe un risque de collision ou de confusion entre :
- Commandes produits
- Commandes plats

dans :
- la liste
- le détail
- la préparation
- la réception
- les badges statuts
- les filtres
- les tabs
- les routes
- les hooks React Query
- les query keys
- les dialogs
- les toasts
- les titres
- les états vides

Je veux savoir si l'utilisateur peut :
- se tromper
- perdre du contexte
- croire que le module produit a changé
- croire que des plats sont des produits

---

## SECTION 5 — Audit technique React / Query / cache

Je veux un audit précis sur :
- query keys
- invalidations
- collisions de cache
- imports croisés
- dépendances involontaires
- recomposition des pages

Je veux notamment savoir :
- si commandes-plats peut invalider ou perturber commandes
- si des hooks partagés ou pages partagées peuvent introduire un bug caché
- si le toggle ou la future vue fusionnée peut provoquer du remount problématique

---

## SECTION 6 — Audit notifications / temps réel

Je veux vérifier s'il existe déjà un risque de conflit entre :
- notifications commandes produit
- futures notifications commande plats
- realtime produit
- futur realtime plats

Je veux savoir :
- ce qui est complètement séparé
- ce qui pourrait se percuter plus tard
- ce qu'il faut verrouiller avant de continuer

---

## SECTION 7 — Audit facture / documents

Même si la facture composite n'est pas encore faite, je veux savoir :
- si ce qui a été préparé pourrait compliquer ou polluer la facture produit existante
- si des choix pris maintenant risquent de forcer un mauvais couplage plus tard

---

## SECTION 8 — Audit de supprimabilité

Je veux une vraie réponse :

**Si on supprime maintenant tout le module Commande Plats,**
est-ce qu'on revient proprement au système Commandes produit initial ?

Je veux savoir exactement :
- quels fichiers supprimer
- quelles routes retirer
- quelles tables drop
- quels points d'intégration annuler
- et s'il reste une trace risquée dans l'existant

---

## SECTION 9 — Verdict final

Je veux une conclusion très claire, sans langue de bois :

1. **Le module Commandes existant est-il encore intact ?**

2. **Quel est aujourd'hui le niveau de risque réel ?**
   - nul / faible / modéré / élevé

3. **Peut-on continuer ?**
   - oui sans réserve / oui mais après correction / non, il faut d'abord nettoyer

4. **Quelles corrections doivent être faites maintenant avant d'aller plus loin ?**

---

### CONTRAINTES DE L'AUDIT

Tu dois être :
- strict
- précis
- concret
- fondé sur le code réellement présent
- pas spéculatif sans le dire

Je ne veux pas de réponse vague du style :
- "ça semble bon"
- "globalement propre"

Je veux un vrai audit de non-régression.

---

### IMPORTANT

Je ne veux aucun nouveau code tant que cet audit n'est pas fait.
Le but est de vérifier si on a déjà commencé à créer :
- une dette
- une confusion
- ou un risque de régression

avant de continuer le module Commande Plats.

---
---

## AVIS ARCHITECTE — État des modules (audit fondé sur le code présent)

> *Ce qui suit est un audit réel, pas le résultat du prompt ci-dessus (qui servira de guide pour un audit futur plus approfondi). C'est l'état des lieux factuel au 2026-03-09, fondé sur l'inspection directe du code.*

---

### S1 — Fichiers touchés

| Fichier | Créé/Modifié | Domaine | Risque |
|---------|-------------|---------|--------|
| `src/modules/commandesPlats/types.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/index.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/services/commandePlatService.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/services/commandePlatLifecycle.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/hooks/useCommandesPlats.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/hooks/useCommandePlatLifecycle.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/hooks/useOrderGroup.ts` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/CommandePlatDetailDialog.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/CommandePlatStatusBadge.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/CommandesPlatsList.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/DishCartPanel.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/DishLinesSection.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/DishPreparationDialog.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/DishPreparationSection.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/DishReceptionDialog.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/components/DishReceptionSection.tsx` | Créé | Plats | Nul |
| `src/modules/commandesPlats/pages/CommandesPlatsPage.tsx` | Créé | Plats | Nul |
| `src/pages/commandes/useUnifiedCommandes.ts` | Créé | Orchestration | **Faible** |
| `src/pages/commandes/UnifiedCommandesList.tsx` | Créé | Orchestration | **Faible** |
| `src/pages/Commandes.tsx` | **Modifié** | **Partagé** | **Modéré** |

**Synthèse :** 18 fichiers créés dans le périmètre plats ou orchestration. **1 seul fichier existant modifié** : `Commandes.tsx`.

---

### S2 — Moteur Commandes produit existant

| Élément | Touché ? | Impact | Risque latent |
|---------|----------|--------|---------------|
| `src/modules/commandes/services/commandeService.ts` | **Non** | Nul | Non |
| `src/modules/commandes/hooks/useCommandes.ts` | **Non** | Nul | Non |
| `src/modules/commandes/components/PreparationDialog.tsx` | **Non** | Nul | Non |
| `src/modules/commandes/components/ReceptionDialog.tsx` | **Non** | Nul | Non |
| `src/modules/commandes/components/CommandeDetailDialog.tsx` | **Non** | Nul | Non |
| `src/modules/commandes/components/CommandesList.tsx` | **Non** | Nul | Non |
| `src/modules/commandes/components/CommandeStatusBadge.tsx` | **Non** | Nul | Non |
| `src/modules/commandes/types.ts` | **Non** | Nul | Non |
| `src/modules/commandes/index.ts` | **Non** | Nul | Non |
| `commandes-api` (edge function) | **Non** | Nul | Non |
| RPC produit (`fn_send_commande`, etc.) | **Non** | Nul | Non |
| Tables `commandes`, `commande_lines` | **Non** | Nul | Non |
| Tables `litiges`, `litige_lines` | **Non** | Nul | Non |
| Notifications produit | **Non** | Nul | Non |
| Facture produit (`app_invoices`) | **Non** | Nul | Non |
| Stock / Inventaire / DLC | **Non** | Nul | Non |

**Verdict S2 : Le moteur produit est 100% intact. Aucun fichier, aucune table, aucune RPC, aucune edge function du domaine produit n'a été modifié.**

---

### S3 — Point critique : `src/pages/Commandes.tsx`

**Ce qui a changé :** Le fichier est passé d'un simple wrapper autour de `CommandesPage` (le composant interne du module produit) à un **orchestrateur unifié** qui :
1. Requête les deux domaines via `useUnifiedCommandes` (page-level)
2. Gère l'état local pour les dialogs produit ET plat (12 useState)
3. Monte les dialogs produit et plat en lazy via `Suspense`

**Risques identifiés :**

| Risque | Sévérité | Détail |
|--------|----------|--------|
| 12 useState dans un seul composant | Faible | Lisible mais fragile si ça grossit. Pas de remount parasite car chaque dialog est gardé par `{condition && <Dialog>}`. |
| `as any` sur les props des dialogs produit (lignes 172, 178, 184, 190, 199) | **Modéré** | Contourne le typage. Si le type `ProductCommande` diverge du type attendu par les dialogs produit, erreur runtime silencieuse. |
| Duplication du type `ProductCommande` | **Modéré** | Le type est redéfini dans `useUnifiedCommandes.ts` au lieu d'être importé depuis `src/modules/commandes/types.ts`. Risque de dérive. |
| Query key `["commandes", estId]` dans `useUnifiedCommandes` | **Modéré** | Même clé que `useCommandes()` dans le module produit. Pas de collision directe car React Query distingue par référence de `queryFn`, mais une invalidation globale par `queryKey: ["commandes"]` toucherait les deux. |
| Re-render de la liste complète à chaque changement d'état dialog | Faible | Les `useMemo` protègent la liste. Acceptable en V1. |

**Verdict S3 : Acceptable mais fragile. Trois points à corriger :**
1. Éliminer les `as any` en important/réutilisant le vrai type du module commandes
2. Différencier les query keys (`["commandes-product", estId]` vs `["commandes", estId]`)
3. Considérer l'extraction de l'état dialog dans un reducer ou hook dédié

---

### S4 — Risques de collision UI/UX

| Zone | Risque | Détail |
|------|--------|--------|
| Liste unifiée | Faible | Les icônes 📦/🍽 discriminent bien visuellement. |
| Badges statut | Nul | `CommandeStatusBadge` vs `CommandePlatStatusBadge` — composants séparés. |
| Dialogs | Nul | Totalement séparés, lazy-loaded, jamais montés simultanément. |
| Tabs/Filtres | Faible | Les tabs "En cours / Litige / Terminée" filtrent les deux types ensemble. Si un utilisateur n'a que des plats, la vue fonctionne mais le bouton "Nouvelle commande" ne fait que du produit. |
| États vides | **À vérifier** | Le message vide ne distingue pas "pas de commandes produit" de "pas de commandes plat". |
| Confusion utilisateur | Faible | L'icône et le type affiché dans la carte sont clairs. Risque faible si le design est bien exécuté. |

---

### S5 — React Query / cache

| Point | Statut | Risque |
|-------|--------|--------|
| Query keys produit | `["commandes", estId]` dans `useCommandes()` ET dans `useUnifiedCommandes` | **Modéré** — duplication de query avec même clé mais queryFn différente (le module utilise `getCommandes()`, la page utilise un select direct). React Query va merger/confliter ces caches si les deux sont montés. **Actuellement le module `CommandesList` n'est plus monté** (remplacé par `UnifiedCommandesList`), donc pas de conflit actif. Mais si quelqu'un importe `useCommandes()` ailleurs, collision. |
| Query keys plat | `["commandes-plats", estId]` | Nul — isolé |
| Invalidations croisées | Pas de croisement | Nul |
| Imports croisés | `useUnifiedCommandes` importe `useCommandesPlats` depuis `commandesPlats/index.ts` | Correct, via barrel export |

---

### S6 — Notifications / Realtime

| Point | Statut |
|-------|--------|
| Realtime produit | Aucun realtime configuré pour commandes produit |
| Realtime plat | Aucun configuré non plus |
| Notifications produit | Existantes, non touchées |
| Notifications plat | Pas encore implémentées |
| **Risque de collision** | **Nul actuellement** |

---

### S7 — Facture / Documents

| Point | Risque |
|-------|--------|
| `app_invoices` | Non touché. FK vers `commandes` uniquement. |
| Facture composite future | Les tables plats (`commande_plat_lines`) n'ont aucun lien FK vers `app_invoices`. La future facture composite devra créer un nouveau lien, mais **aucun choix actuel ne bloque ni ne pollue**. |
| `order_groups` | Table de liaison future. Pas encore utilisée en prod. Risque nul. |

---

### S8 — Supprimabilité

**Pour revenir au module Commandes produit seul :**

1. **Supprimer le dossier** `src/modules/commandesPlats/` (18 fichiers)
2. **Supprimer** `src/pages/commandes/UnifiedCommandesList.tsx` et `useUnifiedCommandes.ts`
3. **Restaurer** `src/pages/Commandes.tsx` à son état pré-unification (wrapper simple de `CommandesPage`)
4. **Drop tables** (optionnel, pas de FK vers le domaine produit) :
   - `commande_plats`, `commande_plat_lines`
   - `litige_plats`, `litige_plat_lines`
   - `order_groups`
5. **Drop RPC plats** et edge function `commandes-plats-api`
6. **Retirer** l'entrée nav si ajoutée (non ajoutée actuellement — même route `/commandes`)

**Reste-t-il une trace dans le module produit ?** → **Non.** Aucun fichier du module `commandes` n'a été modifié. La suppression est propre.

**Verdict S8 : Supprimabilité = 9/10.** Le seul fichier partagé touché est `Commandes.tsx`, qui devrait être restauré. Le reste est entièrement isolé.

---

### S9 — Verdict final

#### 1. Le module Commandes existant est-il encore intact ?

**OUI.** Aucun fichier dans `src/modules/commandes/` n'a été modifié. Aucune table, RPC, edge function ou hook du domaine produit n'a été touché.

#### 2. Niveau de risque réel ?

**FAIBLE — avec 3 points modérés à traiter.**

Les 3 points modérés :
- **Query key collision** : `["commandes", estId]` utilisée par `useCommandes()` (module) ET `useProductCommandes()` (page unifiée) avec des `queryFn` différentes. Pas de conflit actif car `useCommandes()` n'est plus monté, mais fragile.
- **Type dupliqué** : `ProductCommande` redéfini manuellement dans `useUnifiedCommandes.ts` au lieu d'être importé.
- **`as any` × 5** dans `Commandes.tsx` pour passer les données aux dialogs produit.

#### 3. Peut-on continuer ?

**Oui, mais après correction des 3 points modérés.**

#### 4. Corrections à faire maintenant

| # | Action | Priorité |
|---|--------|----------|
| 1 | Différencier la query key dans `useUnifiedCommandes.ts` (ex: `["unified-commandes-product", estId]`) pour éliminer toute collision avec `useCommandes()` | **Haute** |
| 2 | Importer `ProductCommande` depuis `src/modules/commandes/types.ts` ou `index.ts` au lieu de le redéfinir | **Haute** |
| 3 | Remplacer les `as any` dans `Commandes.tsx` par un cast typé ou un adapter | **Moyenne** |
| 4 | Vérifier l'état vide unifié (message quand aucune commande ni produit ni plat) | **Basse** |

---

## Corrections appliquées — 2026-03-09

Les 4 points modérés identifiés par l'audit ont été corrigés :

### Correction 1 — Query key isolée
- **Avant :** `["commandes", estId]` → collision avec le module produit (`useCommandes()` utilise aussi `"commandes"`)
- **Après :** `["unified-commandes-products", estId]` — clé dédiée, aucune collision possible
- **Preuve :** `grep -r 'queryKey.*"unified-commandes-products"'` → uniquement dans `useUnifiedCommandes.ts`

### Correction 2 — Type dupliqué supprimé
- **Avant :** `ProductCommande` redéfini manuellement (19 champs copiés) dans `useUnifiedCommandes.ts`
- **Après :** Import de `Commande` depuis `src/modules/commandes/types.ts` (SSOT). Extension propre via `ProductCommandeResolved extends Commande` pour les champs résolus page-level
- **Preuve :** Plus aucune interface `ProductCommande` locale — le module produit est la source de vérité

### Correction 3 — `as any` éliminés
- **Avant :** 5× `as any` dans `Commandes.tsx` pour passer des données aux dialogs produit, + 6× `as any` dans `UnifiedCommandesList.tsx`
- **Après :** 0× `as any` dans `Commandes.tsx`. Fonction adapter `toCommande()` pour le narrowing typé. Dans `UnifiedCommandesList.tsx`, casts remplacés par `as ProductCommandeResolved` (type explicite) et `as CommandeStatus`/`as CommandePlatStatus` pour les badges
- **Preuve :** `grep "as any" src/pages/Commandes.tsx` → 0 résultats

### Correction 4 — États vides contextuels
- **Avant :** Message générique "Créez votre première commande" quel que soit l'onglet
- **Après :** Messages contextuels par onglet :
  - En cours : "Aucune commande en cours — produits ou plats"
  - Litige : "Aucun litige en cours"
  - Terminée : "Aucune commande terminée"

### Fichiers modifiés (3 fichiers, 0 dans les modules)
| Fichier | Action |
|---------|--------|
| `src/pages/commandes/useUnifiedCommandes.ts` | Query key renommée + import `Commande` depuis module |
| `src/pages/Commandes.tsx` | `as any` → `toCommande()` adapter typé |
| `src/pages/commandes/UnifiedCommandesList.tsx` | `as any` → casts explicites + états vides contextuels |

### Verdict post-correction
- ✅ **0 collision de query keys**
- ✅ **0 type dupliqué** — SSOT module respecté
- ✅ **0 `as any`** dans la couche d'orchestration
- ✅ **États vides contextuels** par onglet
- ✅ **Module commandes produit intact** — aucun fichier touché dans `src/modules/commandes/`

**La base est propre et sûre pour continuer.**

---

*Fin de l'audit — Document de référence pour le suivi du module Commande Plats.*
