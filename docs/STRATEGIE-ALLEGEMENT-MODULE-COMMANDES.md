# Stratégie d'allègement du module Commandes

> **Document de planification — Aucun code ne doit être modifié avant validation complète.**
> Date : 2026-03-11 | Auteur : Audit interne

---

## 0. Inventaire actuel (taille des fichiers)

| Fichier | Lignes | Responsabilités actuelles | Criticité |
|---------|-------:|--------------------------|-----------|
| `ReceptionDialog.tsx` | **1 509** | Réception client, BFS, DLC, retours, reorder, validation ligne par ligne, swipe mobile | 🔴 Critique |
| `NouvelleCommandeDialog.tsx` | **933** | Sélection fournisseur, panier, recherche produit, stock partagé, notes, envoi | 🟠 Haute |
| `CommandeDetailDialog.tsx` | **806** | Détail commande, actions contextuelles, DLC, retours, facture, édition note | 🟠 Haute |
| `PreparationDialog.tsx` | **710** | Préparation fournisseur, swipe, BFS, rupture, expédition | 🟡 Moyenne |
| `CommandesList.tsx` | **335** | Liste onglets, filtrage, badges litiges | 🟢 Faible |
| `commandeService.ts` | ~300 | CRUD lignes, brouillon, mutations | 🟢 Faible |
| `useCommandes.ts` | ~250 | Hooks React Query | 🟢 Faible |

**Total module Commandes ≈ 5 000 lignes de composants.**

---

## 1. Principe fondamental

```
ON NE TOUCHE PAS :                    ON TOUCHE :
─────────────────                     ──────────
✗ Tables SQL                          ✓ Découpage des composants TSX
✗ RPC (fn_send, fn_ship, fn_receive)  ✓ Extraction de hooks dédiés
✗ Transitions de statuts              ✓ Organisation des imports
✗ Calculs métier (écarts, qtés)       ✓ Séparation lecture / écriture / UI
✗ Services / mutations                ✓ Réduction de la surface par fichier
✗ Types                               ✓ Props drilling → composition
```

**Règle d'or : Chaque extraction est un déplacement de code existant, jamais une réécriture.**

---

## 2. Stratégie en 3 phases

### Phase 1 — ReceptionDialog (priorité absolue)

**Objectif :** Passer de 1 509 lignes à ~300 lignes d'orchestration + 5 sous-modules.

#### Découpage prévu

```
ReceptionDialog.tsx (orchestrateur ~300 lignes)
├── hooks/
│   ├── useReceptionState.ts        — État local (receivedQtys, validatedLines, initialized)
│   ├── useReceptionActions.ts      — handleReceive, handleValidateLine, handleBfsConfirm
│   └── useReceptionInit.ts         — Effet d'initialisation + auto-validation ruptures
├── components/
│   ├── ReceptionHeader.tsx         — Barre supérieure (nom fournisseur, statut, timestamps)
│   ├── ReceptionLineCard.tsx       — Rendu d'une ligne (badge, quantités, swipe)
│   ├── ReceptionLineActions.tsx    — Popup d'actions par ligne (BFS, DLC, signaler)
│   ├── ReceptionFooter.tsx         — Bouton valider + compteur
│   ├── ReceptionConfirmDialog.tsx  — AlertDialog de confirmation finale
│   ├── ReceptionDlcGate.tsx        — Orchestration du flow DLC pré-réception
│   ├── ReceptionRetourManager.tsx  — Gestion des retours signalés par ligne
│   └── ReceptionReorderPrompt.tsx  — Suggestion de commande complémentaire
```

#### Étapes détaillées

| # | Opération | Risque | Temps estimé | Validation |
|---|-----------|--------|:------------:|------------|
| 1.1 | Extraire `ReceptionHeader` (lignes 350-420) — pur visuel | 🟢 Nul | 15 min | Visuel identique |
| 1.2 | Extraire `ReceptionFooter` + `ReceptionConfirmDialog` — pur visuel | 🟢 Nul | 15 min | Visuel identique |
| 1.3 | Extraire `ReceptionLineCard` — rendu d'une ligne (le plus gros morceau visuel, ~200 lignes) | 🟡 Faible | 30 min | Visuel + swipe fonctionnel |
| 1.4 | Extraire `ReceptionLineActions` — popup signaler/BFS/DLC | 🟡 Faible | 20 min | Tap sur ligne → popup intact |
| 1.5 | Extraire `useReceptionState` — déplacer les 15+ useState + le useMemo de tri | 🟠 Modéré | 30 min | Même comportement d'état |
| 1.6 | Extraire `useReceptionInit` — useEffect d'initialisation + auto-validation ruptures | 🟠 Modéré | 20 min | Lignes rupture auto-validées |
| 1.7 | Extraire `useReceptionActions` — handleReceive, confirm, BFS callbacks | 🟠 Modéré | 30 min | Flow complet de réception |
| 1.8 | Extraire `ReceptionDlcGate` — flow DLC pré-réception (issues detection, summary dialog) | 🟡 Faible | 20 min | DLC bloquant toujours actif |
| 1.9 | Extraire `ReceptionRetourManager` — SignalerRetourDialog + ProduitNonCommande | 🟡 Faible | 15 min | Retours fonctionnels |
| 1.10 | Extraire `ReceptionReorderPrompt` — AlertDialog reorder | 🟢 Nul | 10 min | Prompt reorder identique |
| 1.11 | Nettoyer l'orchestrateur — ne garder que la composition | 🟡 Faible | 20 min | Tout fonctionne end-to-end |

#### Analyse des risques — Phase 1

| Risque | Probabilité | Impact | Mitigation |
|--------|:-----------:|:------:|------------|
| **Casser le mode `embedded`** (CompositeReceptionDialog) | 🟠 Moyenne | 🔴 Critique | Tester le flow composite après chaque étape. Le contrat `onValidationStateChange` + `requestValidate` doit rester identique. |
| **Perdre la réactivité du swipe mobile** | 🟡 Faible | 🟠 Haute | Le swipe est dans le rendu de ligne — tant que `ReceptionLineCard` reçoit les mêmes callbacks, aucun risque. |
| **Désynchroniser les états croisés** (ex: receivedQtys ↔ validatedLines ↔ dlcDates) | 🟠 Moyenne | 🟠 Haute | Le hook `useReceptionState` doit gérer TOUS les états liés. Ne jamais splitter les états interdépendants entre deux hooks différents. |
| **Régression DLC gate** | 🟡 Faible | 🟠 Haute | Le flow DLC est déjà semi-isolé via `useDlcIssuesDetection`. L'extraction est un déplacement, pas une modification. |
| **Perte de l'auto-validation des ruptures** | 🟡 Faible | 🟡 Moyenne | Test : ouvrir une réception avec une ligne shipped=0 → doit être auto-validée "manquant". |

**Critère de succès Phase 1 :** Le flow complet (ouvrir réception → valider chaque ligne → DLC check → confirmer → recevoir → reorder prompt) fonctionne identiquement en standalone ET en mode embedded.

---

### Phase 2 — CommandeDetailDialog

**Objectif :** Passer de 806 lignes à ~250 lignes d'orchestration.

#### Découpage prévu

```
CommandeDetailDialog.tsx (orchestrateur ~250 lignes)
├── components/
│   ├── DetailHeader.tsx            — Infos commande (statut, n°, dates, acteurs)
│   ├── DetailLinesList.tsx         — Liste des lignes avec badges DLC et écarts
│   ├── DetailActions.tsx           — Boutons contextuels (préparer, expédier, recevoir, etc.)
│   ├── DetailNoteEditor.tsx        — Zone de note éditable
│   ├── DetailRelatedModules.tsx    — DLC notice, retours, facture
│   └── DetailBrouillonEditor.tsx   — Mode édition brouillon (ajout/suppression lignes)
```

#### Étapes détaillées

| # | Opération | Risque | Temps estimé | Validation |
|---|-----------|--------|:------------:|------------|
| 2.1 | Extraire `DetailHeader` — infos statiques, badges, timestamps | 🟢 Nul | 15 min | Visuel identique |
| 2.2 | Extraire `DetailLinesList` — rendu des lignes avec DLC + écarts | 🟡 Faible | 25 min | Lignes affichées correctement |
| 2.3 | Extraire `DetailActions` — logique de boutons contextuels par statut | 🟡 Faible | 20 min | Bonnes actions selon statut |
| 2.4 | Extraire `DetailNoteEditor` — Sheet de note | 🟢 Nul | 10 min | Note sauvegardée |
| 2.5 | Extraire `DetailRelatedModules` — DLC notice, GenerateInvoiceButton, retours | 🟡 Faible | 15 min | Modules liés fonctionnels |
| 2.6 | Extraire `DetailBrouillonEditor` — mode édition brouillon | 🟠 Modéré | 25 min | Ajout/suppression de lignes OK |
| 2.7 | Nettoyer l'orchestrateur | 🟡 Faible | 15 min | Dialog complet fonctionnel |

#### Analyse des risques — Phase 2

| Risque | Probabilité | Impact | Mitigation |
|--------|:-----------:|:------:|------------|
| **Casser les actions contextuelles** (le bon bouton au bon statut) | 🟡 Faible | 🟠 Haute | Les conditions `status === "..."` sont explicites. Les extraire telles quelles dans `DetailActions`. |
| **Perdre le lien DLC → commande** | 🟢 Très faible | 🟡 Moyenne | `useDlcForCommande` est déjà un hook isolé, il suffit de le passer en prop. |
| **Régression mode édition brouillon** | 🟠 Moyenne | 🟠 Haute | Ce mode mélange lecture et écriture. Tester : ajouter une ligne, supprimer une ligne, modifier la note. |

**Critère de succès Phase 2 :** Ouvrir le détail de commandes à chaque statut (brouillon → facturée) montre les bonnes infos et les bons boutons d'action.

---

### Phase 3 — NouvelleCommandeDialog

**Objectif :** Passer de 933 lignes à ~250 lignes d'orchestration.

#### Découpage prévu

```
NouvelleCommandeDialog.tsx (orchestrateur ~250 lignes)
├── components/
│   ├── SupplierSelector.tsx        — Sélection du fournisseur (partenariats)
│   ├── ProductSearchList.tsx       — Recherche et affichage produits disponibles
│   ├── CartPanel.tsx               — Panier avec quantités + prix
│   ├── CartSummary.tsx             — Total, compteur articles
│   ├── StockAvailabilityHint.tsx   — Indicateur stock partagé (si share_stock ON)
│   ├── SendCommandeConfirm.tsx     — Confirmation d'envoi
│   └── CommandeNoteInput.tsx       — Saisie de note
├── hooks/
│   ├── useCartState.ts             — Gestion du panier (ajout, suppression, quantités)
│   └── useDraftPersistence.ts      — Persistence brouillon en DB
```

#### Étapes détaillées

| # | Opération | Risque | Temps estimé | Validation |
|---|-----------|--------|:------------:|------------|
| 3.1 | Extraire `SupplierSelector` — logique de sélection fournisseur | 🟡 Faible | 20 min | Sélection fournisseur OK |
| 3.2 | Extraire `ProductSearchList` — recherche + filtrage | 🟡 Faible | 25 min | Recherche fonctionne |
| 3.3 | Extraire `CartPanel` + `CartSummary` — affichage panier | 🟡 Faible | 20 min | Panier correct |
| 3.4 | Extraire `useCartState` — logique ajout/suppression/quantité | 🟠 Modéré | 30 min | Ajout/suppression/modification OK |
| 3.5 | Extraire `useDraftPersistence` — sync DB des lignes brouillon | 🟠 Modéré | 25 min | Lignes persistées en temps réel |
| 3.6 | Extraire `StockAvailabilityHint` — indicateurs share_stock | 🟢 Nul | 10 min | Indicateurs visibles |
| 3.7 | Extraire `SendCommandeConfirm` + `CommandeNoteInput` | 🟢 Nul | 10 min | Envoi fonctionne |
| 3.8 | Nettoyer l'orchestrateur | 🟡 Faible | 15 min | Flow complet fonctionnel |

#### Analyse des risques — Phase 3

| Risque | Probabilité | Impact | Mitigation |
|--------|:-----------:|:------:|------------|
| **Casser la persistence du brouillon** | 🟠 Moyenne | 🔴 Critique | Le brouillon est créé dès la sélection fournisseur et les lignes sont persistées en temps réel. Le hook `useDraftPersistence` doit reproduire exactement les mêmes appels service. |
| **Désynchroniser panier UI ↔ DB** | 🟠 Moyenne | 🟠 Haute | L'état du panier est la source de vérité locale, synchronisée vers la DB. Ne pas créer deux états parallèles. |
| **Casser le flow composite (split-on-send)** | 🟡 Faible | 🟠 Haute | Le split-on-send se fait en amont dans `CommandesPage`. Vérifier que les props passées restent identiques. |
| **Régression ResumeOrNewDraftDialog** | 🟡 Faible | 🟡 Moyenne | Ce dialog est externe, il passe `resumeDraft` en prop. Tant que la prop est acceptée, aucun risque. |

**Critère de succès Phase 3 :** Créer un brouillon, ajouter des produits, fermer, rouvrir (reprise du brouillon), envoyer.

---

## 3. Matrice de risques globale

| Risque transversal | Sévérité | Mitigation |
|--------------------|:--------:|------------|
| **Régression du mode embedded** (CompositeReceptionDialog) | 🔴 Critique | Tester le flow composite après CHAQUE étape de la Phase 1. C'est le point de fragilité #1. |
| **Perte d'atomicité des mutations** | 🟠 Haute | Ne JAMAIS splitter une mutation entre deux hooks. Une mutation = un hook = un fichier. |
| **Création involontaire de double source de vérité** | 🟠 Haute | Chaque donnée a UN seul hook propriétaire. Les sous-composants reçoivent par props, jamais par query directe. |
| **Dégradation performance mobile** | 🟡 Moyenne | L'extraction de composants peut augmenter les re-renders si les props ne sont pas memoizées. Utiliser `React.memo` sur les composants de ligne. |
| **Incohérence des imports inter-modules** | 🟡 Moyenne | Maintenir les imports DLC, Retours, Litiges via leurs `index.ts` respectifs. Ne jamais deep-import. |
| **Perte de fonctionnalité non documentée** | 🟠 Haute | Avant chaque extraction, lire le fichier complet pour identifier les effets de bord cachés (ex: auto-scroll, focus management). |

---

## 4. Ordre d'exécution recommandé

```
Semaine 1 : Phase 1 (ReceptionDialog)
  Jour 1 : Étapes 1.1 → 1.4 (extraction visuelle pure)
  Jour 2 : Étapes 1.5 → 1.7 (extraction hooks d'état et actions)
  Jour 3 : Étapes 1.8 → 1.11 (modules DLC/retours + nettoyage)
  → Test complet end-to-end standalone + embedded

Semaine 2 : Phase 2 (CommandeDetailDialog)
  Jour 1 : Étapes 2.1 → 2.4 (extraction visuelle)
  Jour 2 : Étapes 2.5 → 2.7 (modules liés + nettoyage)
  → Test complet à chaque statut

Semaine 3 : Phase 3 (NouvelleCommandeDialog)
  Jour 1 : Étapes 3.1 → 3.3 (extraction visuelle)
  Jour 2 : Étapes 3.4 → 3.5 (extraction hooks)
  Jour 3 : Étapes 3.6 → 3.8 (nettoyage)
  → Test complet brouillon + envoi + reprise
```

---

## 5. Ce qu'on NE fait PAS

| Action interdite | Raison |
|-----------------|--------|
| Modifier les RPC SQL | Elles sont atomiques et testées |
| Changer les transitions de statuts | Elles sont la colonne vertébrale du module |
| Créer de nouveaux hooks React Query | On réutilise `useCommandes.ts` existant |
| Modifier `commandeService.ts` | C'est la couche d'accès, elle est stable |
| Toucher aux types (`types.ts`) | Ils sont le contrat du module |
| Modifier le flow composite (`CompositeReceptionDialog`) | On adapte seulement ce qu'il consomme |
| Faire les 3 phases en même temps | Risque de régression croisée |

---

## 6. Checklist de validation par phase

### Après chaque étape unitaire
- [ ] Build passe (`npm run build`)
- [ ] Aucune erreur TypeScript
- [ ] Le composant parent rend le même résultat visuel

### Après chaque phase complète
- [ ] Build passe
- [ ] Flow complet testé manuellement sur mobile (430px)
- [ ] Flow complet testé sur desktop
- [ ] Mode embedded testé (Phase 1 uniquement)
- [ ] Aucune console.error
- [ ] Aucune régression sur les onglets (en cours / litige / retours / terminée)

---

## 7. Résultat attendu

| Métrique | Avant | Après |
|----------|------:|------:|
| `ReceptionDialog.tsx` | 1 509 lignes | ~300 lignes |
| `NouvelleCommandeDialog.tsx` | 933 lignes | ~250 lignes |
| `CommandeDetailDialog.tsx` | 806 lignes | ~250 lignes |
| `PreparationDialog.tsx` | 710 lignes | inchangé (Phase 4 optionnelle) |
| Nombre de fichiers module | 8 composants | ~25 composants |
| Logique métier modifiée | — | **0 ligne** |
| RPC modifiées | — | **0** |
| Tables modifiées | — | **0** |

**Le module fait exactement la même chose, mais chaque fichier a une responsabilité unique.**
