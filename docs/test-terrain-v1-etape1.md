# Test Terrain V1 — Étape 1 : Cartographie & Plan de Test

**Date :** 2026-03-10  
**Objectif :** Cartographier l'intégralité du module Commandes (produit + plat + mixte) et établir le plan de test exhaustif avant l'exécution terrain.

---

## SECTION 1 — Environnement de test

### Comptes

| Rôle | Email | Mot de passe | Organisation |
|------|-------|-------------|-------------|
| **Client** | rida@magnifiko.fr | Rida2026@ | f056aae1 (Magnifiko org) |
| **Fournisseur** | hicham@labaja.fr | Blackmetal9- | 3e4bf632 (NONNA SECRET org) |

### Établissements accessibles

| Utilisateur | Établissement | Type | Org |
|-------------|--------------|------|-----|
| rida | **Magnifiko** (e9c3dccf) | restaurant | f056aae1 |
| rida | Piccolo Magnifiko (c0129f18) | restaurant | f056aae1 |
| rida | Labaja (9ac57795) | fournisseur | f056aae1 |
| hicham | **NONNA SECRET** (7775d89d) | fournisseur | 3e4bf632 |

### Partenariats actifs

| Client | Fournisseur | Partnership ID | Share Stock |
|--------|------------|----------------|-------------|
| Magnifiko | NONNA SECRET | 34e84daa | false |
| Piccolo Magnifiko | NONNA SECRET | c2cb4317 | false |

> **⚠️ IMPORTANT :** Il n'y a PAS de partenariat Magnifiko → Labaja. Les tests B2B se font sur l'axe **Magnifiko (client, rida) → NONNA SECRET (fournisseur, hicham)**.

### Données existantes

| Donnée | Quantité |
|--------|----------|
| Produits importés (Magnifiko ← NONNA SECRET) | 31 |
| Recettes publiées (NONNA SECRET) | 1 (TIRAMISU CLASSIC, 11€, 12 portions) |
| Recettes suivies (Magnifiko) | 1 (TIRAMISU CLASSIC) |
| Commandes existantes | 2 (CMD-000021 recue, CMD-000022 ouverte) |

### Exemples de produits disponibles pour commande

| Produit | ID (tronqué) |
|---------|-------------|
| ASIAGO | b5d05b6c |
| Beurre doux | 5e41b5bb |
| BRIE | 6d1398ad |
| BURRATA 125G | 1c0eb265 |
| BURRATA 50G | 0c47438c |
| Crème fraîche normande | fe78c643 |
| Crème liquide | a2c5ce3c |
| FIOR DI LATTE JULIENNE | 08571f98 |
| Calamar anneau | 1fba5770 |

---

## SECTION 2 — Cartographie du système

### 2.1 Architecture des tables

```
┌─────────────────────────────────────────────────────────────┐
│                    COMMANDES PRODUIT                         │
├─────────────────────────────────────────────────────────────┤
│ commandes              → Entête commande produit            │
│ commande_lines         → Lignes de commande (produits)      │
│ litiges                → Litiges produit (écart réception)  │
│ litige_lines           → Lignes de litige produit           │
│ product_returns        → Retours marchandise                │
│ stock_events           → Mouvements de stock (ledger)       │
│ reception_lot_dlc      → DLC par lot de réception           │
│ app_invoices           → Factures générées                  │
│ app_invoice_lines      → Lignes de facture produit          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    COMMANDES PLATS                           │
├─────────────────────────────────────────────────────────────┤
│ commande_plats         → Entête commande plat               │
│ commande_plat_lines    → Lignes de commande (plats)         │
│ litige_plats           → Litiges plat                       │
│ litige_plat_lines      → Lignes de litige plat              │
│ app_invoices           → Factures (via commande_plat_id)    │
│ app_invoice_dish_lines → Lignes de facture plat             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    LIAISON COMPOSITE                         │
├─────────────────────────────────────────────────────────────┤
│ order_groups           → Lie commande_id + commande_plat_id │
│   ├── commande_id      (FK → commandes)                    │
│   ├── commande_plat_id (FK → commande_plats)               │
│   ├── partnership_id                                        │
│   └── client/supplier_establishment_id                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Cycle de vie — Statuts

**Commande Produit** (`commande_status` enum) :
```
brouillon → envoyee → ouverte → expediee → recue → cloturee
                                              ↘ litige → recue
```

**Commande Plat** (`commande_plat_status` enum) :
```
brouillon → envoyee → ouverte → expediee → recue → cloturee
                                              ↘ litige → cloturee
```

### 2.3 RPC Functions (source de vérité)

| RPC | Action | Appelé par |
|-----|--------|-----------|
| `fn_send_commande` | Envoie commande produit | commandes-api ?action=send |
| `fn_open_commande` | Ouvre / verrouille commande | commandes-api ?action=open |
| `fn_ship_commande` | Expédition + stock_events WITHDRAWAL | commandes-api ?action=ship |
| `fn_receive_commande` | Réception + stock_events RECEIPT | commandes-api ?action=receive |
| `fn_generate_app_invoice` | Génère facture + passe à cloturee | Frontend (RPC directe) |
| `fn_send_commande_plat` | Envoie commande plat | commandes-plats-api ?action=send |
| `fn_open_commande_plat` | Ouvre commande plat | commandes-plats-api ?action=open |
| `fn_ship_commande_plat` | Expédition plat (sans stock) | commandes-plats-api ?action=ship |
| `fn_receive_commande_plat` | Réception plat + auto-litige | commandes-plats-api ?action=receive |
| `fn_resolve_litige_plat` | Résout litige plat → cloturee | commandes-plats-api ?action=resolve_litige |

### 2.4 Edge Functions

| Function | Rôle |
|----------|------|
| `commandes-api` | Orchestrateur produit (send/open/ship/receive) + notifications + push + audit |
| `commandes-plats-api` | Orchestrateur plat (send/open/ship/receive/resolve_litige) + notifications |

### 2.5 Frontend — Composants clés

**Module Produit** (`src/modules/commandes/`) :
| Composant | Rôle |
|-----------|------|
| `CommandesList.tsx` | Liste avec onglets (En cours / Terminée) |
| `NouvelleCommandeDialog.tsx` | Création de commande (sélection fournisseur + produits + panier) |
| `CommandeDetailDialog.tsx` | Détail commande + bouton facture (isReceiver) |
| `PreparationDialog.tsx` | Préparation fournisseur (swipe OK/rupture, qty) |
| `ReceptionDialog.tsx` | Réception client (qty, DLC, retours, signalements) |

**Module Plat** (`src/modules/commandesPlats/`) :
| Composant | Rôle |
|-----------|------|
| `CommandesPlatsList.tsx` | Liste commandes plats |
| `NouvelleCommandePlatDialog.tsx` | Création commande plat |
| `CommandePlatDetailDialog.tsx` | Détail commande plat |
| `DishPreparationDialog.tsx` | Préparation fournisseur (plats) |
| `DishReceptionDialog.tsx` | Réception client (plats) |
| `LitigePlatDetailDialog.tsx` | Visualisation / résolution litige plat |

**Modules transversaux :**
| Module | Rôle |
|--------|------|
| `factureApp` | Génération facture (produit + plat composite) |
| `retours` | Signalement retour produit |
| `dlc` | Gestion DLC réception (capture, refus, retrait) |

### 2.6 Realtime

| Canal | Table | Filtre | Query keys invalidées |
|-------|-------|--------|----------------------|
| commandes CL | commandes | client_establishment_id | commandes, unified-commandes-products |
| commandes FO | commandes | supplier_establishment_id | commandes, unified-commandes-products |
| commande_lines | commande_lines | (unfiltered, client-side) | commandes, unified-commandes-products |
| commande_plats CL | commande_plats | client_establishment_id | commandes-plats |
| commande_plats FO | commande_plats | supplier_establishment_id | commandes-plats |
| commande_plat_lines | commande_plat_lines | (unfiltered, client-side) | commandes-plats |
| litiges | litiges | establishment_id | litiges |

### 2.7 Notifications configurées

| Type d'alerte | Côté notifié |
|---------------|-------------|
| commande_envoyee | Client (confirmation envoi) |
| commande_recue | Fournisseur (nouvelle commande) |
| commande_ouverte | Client (commande consultée) |
| commande_expediee_complete | Client |
| commande_expediee_partielle | Client |
| commande_reception_validee_complete | Fournisseur |
| commande_reception_validee_partielle | Fournisseur |
| commande_plat_envoyee | Client |
| commande_plat_recue | Fournisseur |
| commande_plat_ouverte | Client |
| commande_plat_expediee | Client |
| commande_plat_reception_validee | Fournisseur |
| commande_plat_litige | Client + Fournisseur |
| commande_plat_litige_resolu | Client |

### 2.8 Stock — Types d'événements

| Event Type | Déclenché par |
|-----------|--------------|
| WITHDRAWAL | fn_ship_commande (fournisseur expédie) |
| RECEIPT | fn_receive_commande (client reçoit) |
| ADJUSTMENT | Corrections manuelles |
| VOID | Annulations |
| INITIAL_STOCK | Initialisation |

> **Note :** Les commandes plats ne génèrent AUCUN mouvement de stock.

---

## SECTION 3 — Plan de test exhaustif

### Prérequis validés

- [x] Partnership Magnifiko → NONNA SECRET active
- [x] 31 produits importés disponibles
- [x] 1 recette publiée (TIRAMISU CLASSIC)
- [x] 1 recette suivie par Magnifiko
- [x] 10 RPC functions présentes en DB
- [x] 2 Edge Functions déployées
- [x] Realtime configuré (produit + plat)
- [x] 14 types de notification configurés

### ⚠️ Limitations identifiées avant test

1. **1 seul plat disponible** (TIRAMISU CLASSIC) — limite les tests de variété plats
2. **Share stock = false** — pas de test de visibilité stock fournisseur
3. **Commandes existantes** — CMD-000021 (recue) et CMD-000022 (ouverte) déjà en cours

---

### PLAN DE TEST — 26 cas

#### A. Happy Path (3 cas)

| # | Cas | Acteur initial | Description |
|---|-----|---------------|-------------|
| A1 | Commande produit parfaite | Client (rida) | Créer brouillon → ajouter 3 produits → envoyer → fournisseur ouvre → prépare tout OK → expédie → client reçoit tout OK |
| A2 | Commande plat parfaite | Client (rida) | Créer brouillon plat → ajouter TIRAMISU x2 → envoyer → fournisseur ouvre → prépare → expédie → client reçoit OK |
| A3 | Commande mixte parfaite | Client (rida) | Créer via panier unifié → produits + TIRAMISU → envoyer → fournisseur traite les deux → client reçoit les deux |

#### B. Cas erreur expédition (6 cas)

| # | Cas | Description |
|---|-----|-------------|
| B1 | Produit manquant (rupture) | Fournisseur marque 1 produit en rupture totale |
| B2 | Produit partiellement livré | Fournisseur réduit la quantité expédiée |
| B3 | Produit modifié | Fournisseur change la quantité (augmentation) |
| B4 | Plat quantité réduite | Fournisseur expédie moins de plats que commandé |
| B5 | Plat rupture | Fournisseur marque plat en rupture |
| B6 | Mixte erreur un côté | Produit OK + plat en rupture |

#### C. Cas litiges (5 cas)

| # | Cas | Description |
|---|-----|-------------|
| C1 | Litige produit | Client reçoit quantité différente de l'expédié |
| C2 | Litige plat | Client reçoit quantité plat différente → auto-litige |
| C3 | Résolution litige plat | Fournisseur résout le litige → cloturee |
| C4 | Litige mixte | Écart produit + écart plat dans même groupe |
| C5 | Litige produit seul | Vérifier impact stock et notification |

#### D. Cas retours (3 cas)

| # | Cas | Description |
|---|-----|-------------|
| D1 | Retour produit post-réception | Signaler un retour après validation réception |
| D2 | Signaler produit non commandé | Utiliser le bouton "Produit non commandé" |
| D3 | Retour sur commande reçue | Vérifier si le retour est possible après statut recue |

#### E. Cas DLC (3 cas)

| # | Cas | Description |
|---|-----|-------------|
| E1 | DLC correcte | Saisir DLC normale à la réception |
| E2 | DLC proche | Saisir DLC dans la zone d'alerte |
| E3 | DLC expirée / refus | Refuser un produit pour DLC expirée → retour |

#### F. Cas unités/conversions (2 cas)

| # | Cas | Description |
|---|-----|-------------|
| F1 | Unité simple | Commander et réceptionner en unité canonique |
| F2 | Conditionnement | Commander en unité de livraison, vérifier conversion canonique |

#### G. Vérification stock (transversal)

| # | Cas | Description |
|---|-----|-------------|
| G1 | Stock pré/post commande | Vérifier WITHDRAWAL fournisseur + RECEIPT client |
| G2 | Stock après litige | Vérifier que le stock reste cohérent |

#### H. Notifications (transversal — vérifié à chaque étape)

Vérifié sur chaque cas A-F :
- Bon destinataire (client vs fournisseur)
- Pas de doublon
- Pas de fuite inter-org

#### I. Isolation inter-org (2 cas)

| # | Cas | Description |
|---|-----|-------------|
| I1 | Client ne voit pas données fournisseur | Vérifier que rida ne voit pas les commandes internes NONNA SECRET |
| I2 | Fournisseur ne voit pas données client | Vérifier que hicham ne voit pas les commandes Magnifiko avec d'autres fournisseurs |

---

### Ordre d'exécution recommandé

```
Phase 1 — Happy Path
  A1 → vérif stock + notif
  A2 → vérif notif
  A3 → vérif stock + notif + order_group

Phase 2 — Erreurs expédition
  B1 → B2 → B3 (produit)
  B4 → B5 (plat)
  B6 (mixte)

Phase 3 — Litiges & Retours
  C1 → C5 (produit)
  C2 → C3 (plat)
  C4 (mixte)
  D1 → D2 → D3

Phase 4 — DLC & Conversions
  E1 → E2 → E3
  F1 → F2

Phase 5 — Isolation & Synthèse
  I1 → I2
  G1 → G2
  Rapport final consolidé
```

---

## SECTION 4 — Risques identifiés avant test

| # | Risque | Niveau | Impact |
|---|--------|--------|--------|
| R1 | 1 seul plat publié — tests plat limités | Moyen | Diversité test réduite |
| R2 | CMD-000022 en statut "ouverte" — peut interférer | Faible | À clôturer ou ignorer |
| R3 | Share stock OFF — pas de test visibilité stock | Info | Feature non testable |
| R4 | Bouton facture corrigé (isReceiver) — à valider terrain | P0 | Correction récente non testée |
| R5 | Realtime plats ajouté récemment — à valider terrain | P1 | Ajout récent non testé |

---

## SECTION 5 — Prochaine étape

L'**Étape 2** exécutera les tests **A1, A2, A3** (happy path) avec vérification complète :
- Création et envoi de commandes
- Traitement fournisseur (ouverture, préparation, expédition)
- Réception client
- Vérification stock_events, notifications, statuts
- Vérification bouton facture (correction P0)
- Vérification realtime (correction P1)

**En attente de validation pour lancer l'Étape 2.**
