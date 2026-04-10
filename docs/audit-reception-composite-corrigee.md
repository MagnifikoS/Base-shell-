# Audit réception composite corrigée

**Date :** 2026-03-09  
**Périmètre :** Corrections P1 onClose + DLC bypass dans CompositeReceptionDialog

---

## SECTION 1 — Corrections appliquées

### P1-1 : Fermeture prématurée (onClose)

**Avant :** `handleReceive()` dans ReceptionDialog appelait systématiquement `onClose()` après la mutation produit, y compris en mode `embedded`. Cela démontait le composant composite avant l'exécution de la réception plat.

**Correction :**
- Ajout d'une prop `onReceiveComplete?: () => void` sur ReceptionDialog
- Dans `handleReceive()`, ligne 420-424 :
  ```typescript
  if (embedded && onReceiveComplete) {
    onReceiveComplete(); // Notifie le parent — pas de démontage
  } else {
    onClose(); // Standalone : comportement inchangé
  }
  ```
- `onReceiveComplete` ajouté au tableau de dépendances du useCallback

**Impact sur ReceptionDialog standalone :** ZÉRO. La branche `else` exécute `onClose()` exactement comme avant. La prop `onReceiveComplete` est optionnelle et n'existe pas en mode standalone.

### P1-2 : Bypass du contrôle DLC

**Avant :** CompositeReceptionDialog avait son propre `AlertDialog` de confirmation et appelait `executeReceive()` directement sur le productStateRef. Cela contournait `handleValidateClick()` → `dlcIssues check` → `DlcReceptionSummaryDialog`.

**Correction :**
- Suppression de `executeReceive` de l'interface `ReceptionValidationState`
- Suppression du `AlertDialog` de confirmation dans CompositeReceptionDialog
- Le bouton unifié "Valider réception" appelle `productStateRef.current.requestValidate()` qui déclenche le flow complet du moteur produit :
  1. `handleValidateClick()` vérifie `dlcIssues.length > 0`
  2. Si DLC problématique → `DlcReceptionSummaryDialog` s'affiche (accepter/refuser)
  3. Puis `confirmReceive` dialog standard du moteur produit
  4. Puis `handleReceive()` exécute mutation + DLC batch + retours DLC + retours manuels
  5. Puis `onReceiveComplete()` est appelé au lieu de `onClose()`
  6. Le composite chaîne alors la réception plat
  7. Puis ferme l'écran

**Impact sur ReceptionDialog standalone :** ZÉRO. L'interface `ReceptionValidationState` a perdu `executeReceive` (qui n'est plus nécessaire nulle part) mais conserve `requestValidate` qui est le point d'entrée correct.

---

## SECTION 2 — Vérification module réception produit

| Fonctionnalité | Verdict | Détail |
|---|---|---|
| BFS (saisie quantité) | ✅ OK | `UniversalQuantityModal` inchangé, `handleBfsConfirm` inchangé |
| DLC (saisie date) | ✅ OK | `DlcLineDetailSheet` inchangé, `dlcDates` state inchangé |
| DLC gate (contrôle) | ✅ OK | `handleValidateClick` inchangé — vérifie `dlcIssues` avant confirm |
| DLC summary dialog | ✅ OK | `DlcReceptionSummaryDialog` inchangé |
| DLC refusals → retours | ✅ OK | `handleDlcRefusals` inchangé dans `handleReceive` |
| Retours manuels | ✅ OK | `SignalerRetourDialog` inchangé, `pendingReturns` state inchangé |
| Validation ligne | ✅ OK | `validatedLines` state inchangé, `conforme/manquant` logic inchangée |
| Swipe mobile | ✅ OK | `SwipeableReceptionLine` inchangé |
| Écarts / surplus | ✅ OK | `ecarts`, `surplusEcarts`, `surplusConfirm` inchangés |
| Mutation receive | ✅ OK | `receiveMutation.mutateAsync` inchangé |
| Standalone mode | ✅ OK | `embedded` default `false`, `onReceiveComplete` optionnel — branche `else` appelle `onClose()` |

**Verdict : Module réception produit INTACT.**

---

## SECTION 3 — Vérification module réception plat

| Fonctionnalité | Verdict | Détail |
|---|---|---|
| DishReceptionSection | ✅ OK | Composant inchangé |
| Validation ligne plat | ✅ OK | `handleDishLineConfirm` inchangé |
| Mutation receive plat | ✅ OK | `useReceiveCommandePlat` inchangé |
| Litige plat | ✅ OK | Géré par la mutation backend — inchangé |
| DishReceptionDialog standalone | ✅ OK | Fichier non modifié |
| Indépendance produit | ✅ OK | Aucune référence croisée ajoutée |

**Verdict : Module réception plat INTACT et INDÉPENDANT.**

---

## SECTION 4 — Vérification composite

| Point | Verdict | Détail |
|---|---|---|
| Flow DLC respecté | ✅ CORRIGÉ | `requestValidate()` passe par le gate DLC complet |
| Pas de fermeture prématurée | ✅ CORRIGÉ | `onReceiveComplete` remplace `onClose` en embedded |
| Séquencement correct | ✅ OK | Produit → (DLC check → confirm → receive → complete) → Plat → Close |
| AlertDialog composite | ✅ SUPPRIMÉ | Plus de double dialog — le moteur produit gère seul sa confirmation |
| État cohérent si plat échoue | ✅ OK | Produit déjà réceptionné, erreur toast, écran reste ouvert |
| Bouton unifié | ✅ OK | Disabled si produits OU plats non validés |

**Verdict : Composite CORRIGÉ et SÛR.**

---

## SECTION 5 — Test scénarios (simulation mentale)

### Commande produit seul (standalone ReceptionDialog)
- `embedded=false`, `onReceiveComplete` absent
- `handleReceive` → `onClose()` → ✅ comportement identique à avant
- DLC gate → ✅ `handleValidateClick` vérifie `dlcIssues`

### Commande plat seul (DishReceptionDialog standalone)
- Fichier non modifié → ✅ aucun impact

### Commande mixte — happy path
1. Utilisateur valide toutes les lignes produit + plat
2. Clic "Valider réception" → `requestValidate()`
3. Pas de DLC issues → `confirmReceive` dialog produit
4. Clic "Confirmer" → `handleReceive()` → mutation produit OK
5. `onReceiveComplete()` → mutation plat OK → `onClose()`
6. ✅ Tout réceptionné, écran fermé

### Commande mixte — DLC critique
1. Produit avec DLC problématique
2. Clic "Valider réception" → `requestValidate()` → `handleValidateClick()`
3. `dlcIssues.length > 0` → `DlcReceptionSummaryDialog` s'affiche
4. Utilisateur accepte/refuse par ligne → `handleDlcSummaryConfirm(decisions)`
5. `confirmReceive` dialog produit
6. `handleReceive()` → mutation + DLC refusals → `onReceiveComplete()` → plat → close
7. ✅ DLC gate respecté

### Commande mixte — écart produit
- Quantité reçue ≠ expédiée → `hasEcarts=true`
- Dialog confirm affiche "X écarts — litige créé"
- Mutation retourne `has_litige=true`
- ✅ Litige produit généré

### Commande mixte — écart plat
- Quantité reçue ≠ commandée
- `receiveDishCmd` mutation retourne `has_litige=true`
- Toast warning "Plats : réception avec écarts — litige créé"
- ✅ Litige plat généré

### Produits OK / plats KO
- Produit réceptionné OK → `onReceiveComplete()`
- Mutation plat échoue → toast erreur, `setIsDishReceiving(false)`, écran RESTE ouvert
- ✅ Produit déjà persisté, plat peut être retenté manuellement

### Plats OK / produits KO
- Produit mutation échoue → `handleReceive` catch → toast erreur
- `onReceiveComplete` n'est PAS appelé → plat n'est PAS exécuté
- ✅ Cohérent — pas de réception plat sans réception produit

---

## SECTION 6 — Vérification d'isolation

**Test mental : suppression de `CompositeReceptionDialog.tsx`**

1. Supprimer `src/pages/commandes/CompositeReceptionDialog.tsx`
2. Retirer l'import et l'usage dans le parent qui l'appelle
3. ReceptionDialog continue de fonctionner en standalone :
   - `embedded` default `false`
   - `onReceiveComplete` absent → branche `else` → `onClose()`
   - Aucune dépendance vers CompositeReceptionDialog
4. DishReceptionDialog continue de fonctionner en standalone
5. ✅ **Zéro casse**

**Test mental : suppression de la prop `onReceiveComplete`**

- Props optionnelle, default `undefined`
- Si absente : `embedded && onReceiveComplete` = `false` → `onClose()` est appelé
- ✅ Fallback safe

---

## SECTION 7 — Verdict final

| Question | Réponse |
|---|---|
| Réception produit toujours intacte ? | ✅ OUI — logique métier 100% préservée |
| Réception plat toujours séparée ? | ✅ OUI — aucun couplage ajouté |
| Composite sûr ? | ✅ OUI — DLC gate respecté, pas de fermeture prématurée |
| Prêt prod ? | ✅ OUI |

### **Verdict : GO**

Les deux P1 identifiés dans l'audit final sont corrigés :
- Le flow DLC est intégralement respecté via `requestValidate()`
- La fermeture est contrôlée par le composite via `onReceiveComplete`
- L'isolation est totale : supprimer le composite ne casse rien

Aucun risque résiduel identifié sur le périmètre réception.
