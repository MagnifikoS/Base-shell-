# AUDIT & IMPLÉMENTATION — Restructuration du flow DLC à la réception

> Date : 2026-03-12  
> Statut : **IMPLÉMENTÉ** — 4 étapes complétées
> Objectif : Déplacer le point de saisie DLC du popup d'action vers la validation de ligne, avec paramétrage par produit

---

## SECTION 1 — Cartographie du flow actuel

### 1.1 Flow de réception client

```
CommandesPage
  └─ ReceptionDialog (standalone ou embedded dans CompositeReceptionDialog)
       ├─ Chargement des lignes via useCommandeDetail(commande.id)
       ├─ Initialisation: receivedQtys + validatedLines (état local)
       ├─ Pour chaque ligne: SwipeableReceptionLine
       │    ├─ Swipe → conforme / manquant (mobile)
       │    ├─ Boutons ✓ / ✗ (desktop)
       │    └─ Tap → popup d'action (mobile: selectedLineId / desktop: BFS direct)
       ├─ Bouton "Valider réception" (désactivé tant que lignes pending)
       │    └─ handleValidateClick()
       │         ├─ SI dlcIssues.length > 0 → DlcReceptionSummaryDialog
       │         └─ SINON → confirmReceive dialog
       └─ handleReceive()
            ├─ RPC receiveMutation (commande → recue)
            ├─ DLC batch upsert (non-bloquant)
            ├─ DLC refusals → retours
            └─ Retours manuels locaux → commit
```

### 1.2 Popup d'action au clic produit (mobile)

**Fichier** : `src/modules/commandes/components/ReceptionDialog.tsx` L616-664

Quand l'utilisateur tape une ligne (mobile), un `AlertDialog` s'ouvre avec 3 options :

| Action | Composant ouvert | Résultat |
|--------|-----------------|----------|
| **Saisir quantité** | `UniversalQuantityModal` (BFS) | Met à jour `receivedQtys[lineId]` |
| **Saisir DLC** | `DlcLineDetailSheet` (isReceptionFlow=true) | Met à jour `dlcDates[lineId]` (état local) |
| **Signaler un problème** | `SignalerRetourDialog` | Met à jour `pendingReturns[lineId]` |

### 1.3 Chemin actuel de saisie DLC

1. Utilisateur tape une ligne → popup d'action
2. Clique "Saisir DLC" → `DlcLineDetailSheet` s'ouvre (mode `isReceptionFlow=true`)
3. Sélectionne une date via calendrier
4. Clique "Confirmer la DLC" → callback `onDlcSelected(date)`
5. La date est stockée dans `dlcDates[lineId]` (état local du `ReceptionDialog`)
6. **Aucune écriture DB** à ce stade — tout est en brouillon local

### 1.4 Chemin d'enregistrement DLC (à la validation)

1. `handleValidateClick()` → vérifie `dlcIssues` (dates proches/expirées)
2. Si issues → `DlcReceptionSummaryDialog` → accepter/refuser chaque ligne
3. `handleReceive()` → après succès de la RPC de réception :
   - Construit `dlcInputs[]` à partir de `dlcDates`
   - Appelle `dlcBatchUpsert.mutateAsync(dlcInputs)` → écriture dans `reception_lot_dlc`
   - Gère les refus DLC → création de retours via `handleDlcRefusals()`

### 1.5 Lecture DLC (post-réception)

- **CommandeDetailDialog** : affiche `DlcBadge` par ligne, permet édition via `DlcLineDetailSheet` (mode post-reception)
- **DlcCritiquePage** : vue surveillance, requête directe sur `reception_lot_dlc`
- **Alertes** : basées sur `computeDlcStatus()` + seuils résolus

---

## SECTION 2 — Source de vérité DLC

### 2.1 Table SSOT

**Table** : `reception_lot_dlc`

| Colonne | Rôle |
|---------|------|
| `id` | PK |
| `commande_line_id` | FK → commande_lines (UNIQUE) |
| `establishment_id` | FK → establishments |
| `product_id` | FK → products_v2 |
| `dlc_date` | DATE — la DLC saisie |
| `quantity_received` | Quantité reçue |
| `canonical_unit_id` | Unité |
| `created_by` | Utilisateur |
| `dismissed_at` | NULL si actif, timestamp si retiré |
| `dismissed_reason` | Motif de retrait |

### 2.2 Écritures

| Point d'écriture | Fichier | Mécanisme |
|-------------------|---------|-----------|
| Réception (batch) | `ReceptionDialog.tsx` L367-385 | `dlcBatchUpsert.mutateAsync()` via `useDlcBatchUpsert` |
| Post-réception (unitaire) | `CommandeDetailDialog.tsx` via `DlcLineDetailSheet` | `useDlcUpsert` → `upsertDlc()` |
| Dismiss (retrait) | `DlcCritiquePage` | `useDismissDlcAlert` |

**Service** : `src/modules/dlc/services/dlcService.ts` — `upsertDlc()` et `batchUpsertDlc()`

### 2.3 Lectures

| Consommateur | Hook | Usage |
|--------------|------|-------|
| ReceptionDialog (pré-validation) | `useDlcIssuesDetection` | Détecte issues depuis `dlcDates` locales |
| CommandeDetailDialog | `useDlcForCommande` | Affiche DLC par ligne post-réception |
| DlcCritiquePage | `useDlcCritique` | Vue surveillance globale |
| DlcAlertSettingsPanel | `useDlcAlertSettings` | Config seuils |

### 2.4 Garanties actuelles

- **Unicité** : contrainte UNIQUE sur `commande_line_id` → une seule DLC par ligne
- **Non-bloquant** : l'échec d'écriture DLC ne revert PAS la réception
- **Brouillon local** : aucune DLC n'est écrite en DB avant validation finale
- **Module isolé** : le module DLC n'a aucune dépendance sur le module stock/litiges

---

## SECTION 3 — Options de paramétrage "DLC obligatoire à la réception"

### Option A — Colonne `dlc_required_at_reception` sur `products_v2`

| Pour | Contre |
|------|--------|
| Même table que `dlc_warning_days` → cohérence | Ajoute une colonne à une table large (40+ colonnes) |
| Requête déjà faite dans `useDlcIssuesDetection` | Nécessite migration + maj RPC `insert_or_update_product` |
| Lecture simple et performante | |
| Un seul fetch pour warning_days + required | |

### Option B — Extension de `dlc_alert_settings` avec un champ `required_product_ids`

| Pour | Contre |
|------|--------|
| Tout le DLC config dans une seule table | Champ JSONB array → pas de FK, pas de validation DB |
| Pas de modification de products_v2 | Requête séparée nécessaire |
| | Limite de taille JSONB si beaucoup de produits |
| | Pas de contrainte d'intégrité |

### Option C — Nouvelle table `dlc_reception_rules` (product_id, establishment_id, required)

| Pour | Contre |
|------|--------|
| Isolée et extensible | Nouvelle table = migration + RLS + hook |
| FK propres | Plus complexe pour la V1 |
| Permet d'autres règles futures | Requête supplémentaire à la réception |

### ✅ Recommandation : Option A

**Justification** :

1. `products_v2` a déjà `dlc_warning_days` — le champ `dlc_required_at_reception` est la suite logique
2. Le hook `useDlcIssuesDetection` requête déjà `products_v2` pour `dlc_warning_days` et `category_id` → ajouter `dlc_required_at_reception` au même SELECT est gratuit
3. La RPC `insert_or_update_product` gère déjà `p_dlc_warning_days` → ajouter le nouveau param est trivial
4. Pas de nouvelle table, pas de nouveau hook, pas de nouvelle requête
5. Le paramétrage dans DLC Critique > Paramètres fera un SELECT + UPDATE bulk simple sur products_v2

**Valeur par défaut** : `false` (aucun changement de comportement pour les produits existants)

---

## SECTION 4 — Stratégie cible recommandée

### 4.1 Paramétrage (DLC Critique > Paramètres)

Ajouter un onglet/section dans `DlcAlertSettingsPanel` :

- **Titre** : "Saisie DLC obligatoire à la réception"
- **Contenu** : Liste des produits de l'établissement avec switch ON/OFF
- **Filtrage** : par catégorie, par nom
- **Comportement** : toggle → UPDATE `products_v2 SET dlc_required_at_reception = true/false`

### 4.2 Réception — Nouveau flow

```
Utilisateur tape une ligne → popup d'action
  ├─ Saisir quantité (INCHANGÉ)
  ├─ Signaler un problème (INCHANGÉ)
  └─ [SUPPRIMÉ] Saisir DLC   ← retiré du popup

Utilisateur valide une ligne (swipe conforme / bouton ✓) :
  ├─ SI produit.dlc_required_at_reception === true
  │    └─ DlcLineDetailSheet s'ouvre automatiquement
  │         ├─ L'utilisateur saisit la DLC
  │         └─ Validation → DLC stockée dans dlcDates[lineId]
  │              puis la ligne passe en "conforme"
  │
  └─ SI produit.dlc_required_at_reception === false
       └─ La ligne passe en "conforme" directement (INCHANGÉ)
```

### 4.3 Chemin d'enregistrement DLC

**AUCUN CHANGEMENT.** Le chemin reste :
1. DLC stockée en local dans `dlcDates[lineId]` pendant la réception
2. Écrite dans `reception_lot_dlc` via `dlcBatchUpsert` après validation finale
3. Issues détectées par `useDlcIssuesDetection` → `DlcReceptionSummaryDialog` si problème

### 4.4 Points d'intégration

| Composant | Modification |
|-----------|-------------|
| `ReceptionDialog.tsx` | Popup action : retirer "Saisir DLC". Validation conforme : intercepter si DLC required |
| `useDlcIssuesDetection.ts` | Ajouter `dlc_required_at_reception` au SELECT products_v2 + exposer dans le retour |
| `DlcAlertSettingsPanel.tsx` | Ajouter section de gestion par produit |
| `products_v2` (migration) | Ajouter colonne `dlc_required_at_reception BOOLEAN DEFAULT false` |

---

## SECTION 5 — Risques / Points sensibles

### 5.1 Ce qui peut casser

| Risque | Probabilité | Mitigation |
|--------|-------------|------------|
| Produit marqué obligatoire mais DLC non saisie → ligne bloquée | Faible | UX claire : le popup s'ouvre, l'utilisateur peut annuler mais la ligne reste "pending" |
| Performance : fetch supplémentaire au rendu | Nulle | Le champ est ajouté à un SELECT existant |
| Régression popup action | Faible | Retirer un bouton = changement minimal |
| Conflits avec CompositeReceptionDialog | Faible | Le flux est identique, seul le trigger de DlcLineDetailSheet change |

### 5.2 Ce qui doit être protégé

- **Brouillon local** : la DLC saisie via le gate de validation NE DOIT PAS écrire en DB avant la validation finale
- **DlcReceptionSummaryDialog** : continue de fonctionner normalement pour les DLC problématiques
- **Retours DLC** : `handleDlcRefusals` ne change pas
- **Post-réception** : `CommandeDetailDialog` → `DlcLineDetailSheet` en mode DB direct ne change pas
- **DlcCritiquePage** : aucun impact (lit `reception_lot_dlc`)

### 5.3 Ce qu'il faut tester

1. Produit avec `dlc_required_at_reception = true` : swipe conforme → popup DLC s'ouvre
2. Produit avec `dlc_required_at_reception = false` : swipe conforme → validation directe
3. Popup d'action mobile : DLC n'apparaît plus
4. DLC saisie via gate → apparaît dans `dlcDates` → écrite en DB après validation
5. DLC problématique saisie via gate → `DlcReceptionSummaryDialog` fonctionne
6. CompositeReceptionDialog (produits + plats) → même comportement
7. Desktop : même logique sans swipe
8. Paramètres DLC : toggle par produit fonctionne
9. Produit jamais paramétré → comportement par défaut (pas de popup)
10. Réception de commandes existantes non impactée

---

## SECTION 6 — Plan d'implémentation

### Étape 1 — Migration DB (5 min)

```sql
ALTER TABLE products_v2 
ADD COLUMN dlc_required_at_reception BOOLEAN NOT NULL DEFAULT false;
```

- Aucun impact sur les produits existants (default = false)
- Pas de RLS spécifique (hérite de products_v2)
- MAJ de la RPC `insert_or_update_product` pour accepter le nouveau param

**Validation** : colonne existe, default false, RPC fonctionne

### Étape 2 — Hook DLC : exposer le flag (10 min)

Modifier `useDlcIssuesDetection` :
- Ajouter `dlc_required_at_reception` au SELECT sur products_v2
- Exposer `requiredProductIds: Set<string>` dans le retour du hook

**Validation** : le hook retourne les bons product_ids marqués obligatoire

### Étape 3 — ReceptionDialog : gate de validation DLC (30 min)

1. Retirer "Saisir DLC" du popup d'action (L639-644 embedded + L927-932 standalone)
2. Intercepter la validation conforme :
   - Si `requiredProductIds.has(line.product_id)` → ouvrir `DlcLineDetailSheet`
   - Si DLC saisie → marquer la ligne conforme
   - Si annulé → la ligne reste pending
3. Garder `DlcLineDetailSheet` en mode `isReceptionFlow` avec callback `onDlcSelected`

**Validation** : 
- Produit obligatoire → popup DLC avant validation
- Produit non obligatoire → validation directe
- DLC saisie → stockée dans dlcDates

### Étape 4 — Paramétrage dans DlcAlertSettingsPanel (30 min)

Ajouter une section dans `DlcAlertSettingsPanel` ou un nouvel onglet dans la page DLC Critique :
- Liste des produits de l'établissement
- Switch par produit
- Filtre par catégorie / recherche texte
- Sauvegarde : UPDATE bulk `products_v2 SET dlc_required_at_reception = ...`

**Validation** : toggle produit → valeur en DB → reflétée à la réception

### Étape 5 — Tests et validation (15 min)

- Test unitaire : `useDlcIssuesDetection` avec le nouveau flag
- Test manuel complet du flow de réception
- Vérifier non-régression sur tous les points de la section 5.3

---

## SECTION 7 — Verdict

### Faisabilité

✅ **Oui, cette restructuration est faisable proprement.**

### Risque

✅ **Risque minimal.** Aucune modification de :
- Source de vérité DLC (`reception_lot_dlc`)
- Moteur de calcul DLC (`dlcCompute.ts`)
- Alertes DLC (`useDlcCritique`)
- Retours DLC (`useDlcRefusalToReturn`)
- Flow de validation finale (`handleReceive`)

### Stratégie recommandée

La plus sûre est **Option A** (colonne sur `products_v2`) avec les 5 étapes ci-dessus.

**Pourquoi c'est safe** :
1. On déplace un point de déclenchement UX, pas la logique métier
2. Le chemin d'écriture DLC ne change pas (brouillon local → batch upsert à la fin)
3. Le paramétrage est un simple booléen avec default `false` → zero impact sur l'existant
4. Le module DLC reste isolé
5. Aucune FK/contrainte historique modifiée

### Faille résiduelle

Aucune faille identifiée. Le seul point d'attention est l'UX du gate DLC : l'utilisateur doit comprendre pourquoi un popup s'ouvre quand il valide un produit. Un label clair ("DLC obligatoire pour ce produit") résout cela.

---

## Annexe — Fichiers impliqués

| Fichier | Type de modification |
|---------|---------------------|
| `products_v2` (migration) | Ajout colonne |
| `src/modules/dlc/hooks/useDlcIssuesDetection.ts` | Ajout champ au SELECT + expose flag |
| `src/modules/commandes/components/ReceptionDialog.tsx` | Retrait DLC du popup, gate validation |
| `src/modules/dlc/components/DlcAlertSettingsPanel.tsx` | Section paramétrage par produit |
| `src/modules/dlc/index.ts` | Export éventuel du nouveau type |
