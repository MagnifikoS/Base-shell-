# Test Terrain V1 — Rapport intermédiaire

**Date :** 2026-03-10  
**Statut :** EN COURS — Session 1 terminée, à reprendre session 2

---

## SECTION 1 — Executive Summary (provisoire)

### Environnement vérifié
- ✅ Login client (rida@magnifiko.fr) → Magnifiko OK
- ✅ Login fournisseur (hicham@labaja.fr) → NONNA SECRET (à tester session 2)
- ✅ Partnership Magnifiko → NONNA SECRET active
- ✅ 31 produits importés, 1 plat (TIRAMISU CLASSIC 11€ / 12 portions)
- ✅ 10 RPC functions, 2 Edge Functions, 14 types notification
- ✅ Realtime configuré (produit + plat)

### Findings critiques identifiés

| # | Finding | Sévérité | Détail |
|---|---------|----------|--------|
| F1 | Commande plat orpheline CP-20260310-5006 | P2 | Bloquée en "ouverte" dans order_group avec CMD-000021 (recue). Empêche la commande composite de passer en "Terminée". Donnée de test précédent, pas un bug système. |
| F2 | Stock fournisseur vide | Info | NONNA SECRET n'a aucun stock_event → WITHDRAWAL créera du stock négatif. Normal en V0 (share_stock=false). |
| F3 | Sélecteur établissement correct | ✅ | Labaja (type fournisseur, même org) n'apparaît pas dans le sélecteur restaurant. Comportement correct. |
| F4 | Affichage composite cohérent | ✅ | CMD-000021 "En cours / En préparation" car le plat est bloqué à "ouverte". L'UI affiche le statut le plus en retard du groupe. Comportement correct. |

---

## SECTION 2 — Baseline stock avant tests

### Client (Magnifiko e9c3dccf)

| Produit | Stock actuel |
|---------|-------------|
| ASIAGO | 3 |
| Beurre doux | 5 |
| BRIE | 3 |
| BURRATA 50G | 15 |

### Fournisseur (NONNA SECRET 7775d89d)

| Produit | Stock actuel |
|---------|-------------|
| (tous) | 0 (aucun stock_event) |

### Notifications baseline
- 627 notification_events existantes (types commande*)

---

## SECTION 3 — Tests UI exécutés (session browser)

### T01 — Login & navigation
| Étape | Résultat | Détail |
|-------|----------|--------|
| Login rida@magnifiko.fr | ✅ PASS | Connexion OK |
| Sélection Magnifiko | ✅ PASS | 2 établissements affichés (Magnifiko, Piccolo Magnifiko) |
| Dashboard | ✅ PASS | 8 modules visibles, 25 notifications |
| Navigation Commandes | ✅ PASS | 4 onglets (En cours, Litige, Retours, Terminée) |

### T02 — Liste commandes existantes
| Étape | Résultat | Détail |
|-------|----------|--------|
| En cours | ✅ PASS | CMD-000021 "Produit + Plat" / "En préparation" |
| Terminée | ✅ PASS | CMD-000022 "Produit + Plat" / "Reçue" |
| Badge composite | ✅ PASS | "Produit + Plat" correctement affiché |

### T03 — Création nouvelle commande (A1 — en cours)
| Étape | Résultat | Détail |
|-------|----------|--------|
| Bouton "+" | ✅ PASS | Ouvre "Nouvelle commande" |
| Sélection fournisseur | ✅ PASS | NONNA SECRET avec logo, "Produits" + "1 plat" |
| Catalogue produits | ✅ PASS | 31 produits importés visibles, scrollable |
| Onglets Produits/Plats | ✅ PASS | Deux onglets bien séparés |
| BFS Modal ASIAGO | ✅ PASS | 3 unités : Paquet / Kilogramme / Gramme |
| Ajout ASIAGO 2 kg | ✅ PASS | Panier (1), ligne bleue avec "2 kg" |
| BFS Modal Beurre doux | ✅ PASS | 1 unité : Pièce |
| Ajout Beurre doux 3 pce | ✅ PASS | Panier (2) |
| BFS Modal BRIE | ✅ PASS | 1 unité : Pièce |
| Ajout BRIE | ⏳ EN COURS | Modal ouverte, quantité non saisie |

---

## SECTION 4 — Vérifications DB

### Commandes existantes (détail)

```
CMD-000021 (6f5ddd35):
  - status: recue
  - sent_at: 2026-03-10 05:32:10
  - opened_at: 2026-03-10 05:32:23
  - shipped_at: 2026-03-10 05:32:28
  - received_at: 2026-03-10 05:33:34
  → Cycle produit complet ✅

  ORDER GROUP lié à:
  CP-20260310-5006 (503d141e):
    - status: ouverte ❌ (jamais expédié)
    - sent_at: 2026-03-10 05:32:13
    - opened_at: 2026-03-10 05:32:37
    → Plat bloqué en ouverte

CMD-000022 (df7c3be7):
  - status: recue
  - Cycle complet ✅
  
  ORDER GROUP lié à:
  CP-20260310-9460 (dd88d060):
    - status: recue ✅
    - Cycle plat complet ✅
```

### Types stock_events existants
- RECEIPT, WITHDRAWAL, ADJUSTMENT, VOID, INITIAL_STOCK

### RPC functions vérifiées (10/10 présentes)
- fn_send_commande ✅
- fn_open_commande ✅
- fn_ship_commande ✅
- fn_receive_commande ✅
- fn_generate_app_invoice ✅
- fn_send_commande_plat ✅
- fn_open_commande_plat ✅
- fn_ship_commande_plat ✅
- fn_receive_commande_plat ✅
- fn_resolve_litige_plat ✅

---

## SECTION 5 — Plan de test restant

### À exécuter en session 2+

| Test | Description | Statut |
|------|-------------|--------|
| **A1** | Commande produit happy path (finir + envoyer + cycle fournisseur + réception) | ⏳ En cours |
| **A2** | Commande plat happy path | 🔲 À faire |
| **A3** | Commande mixte happy path | 🔲 À faire |
| **B1** | Produit rupture | 🔲 À faire |
| **B2** | Produit partiellement livré | 🔲 À faire |
| **B3** | Produit quantité modifiée | 🔲 À faire |
| **B4** | Plat quantité réduite | 🔲 À faire |
| **B5** | Plat rupture | 🔲 À faire |
| **B6** | Mixte erreur un côté | 🔲 À faire |
| **C1** | Litige produit | 🔲 À faire |
| **C2** | Litige plat | 🔲 À faire |
| **C3** | Résolution litige plat | 🔲 À faire |
| **C4** | Litige mixte | 🔲 À faire |
| **C5** | Litige produit seul | 🔲 À faire |
| **D1** | Retour produit post-réception | 🔲 À faire |
| **D2** | Signaler produit non commandé | 🔲 À faire |
| **D3** | Retour sur commande reçue | 🔲 À faire |
| **E1** | DLC correcte | 🔲 À faire |
| **E2** | DLC proche | 🔲 À faire |
| **E3** | DLC expirée/refus | 🔲 À faire |
| **F1** | Unité simple | 🔲 À faire |
| **F2** | Conditionnement/conversion | 🔲 À faire |
| **G1** | Vérif stock pré/post | 🔲 À faire |
| **G2** | Stock après litige | 🔲 À faire |
| **I1** | Isolation client | 🔲 À faire |
| **I2** | Isolation fournisseur | 🔲 À faire |

### État browser actuel
- Connecté : rida@magnifiko.fr → Magnifiko
- Écran : Modal BFS ouverte pour BRIE (quantité non saisie)
- Brouillon en cours : ASIAGO 2kg + Beurre doux 3 pce

---

## SECTION 6 — Stratégie session 2

Le test browser est très action-intensive (chaque clic = 1 appel). Pour optimiser :

1. **Continuer A1 via browser** : finir l'envoi, switch fournisseur, cycle complet
2. **Vérifier via DB** : stock_events, notifications, statuts après chaque action
3. **Documenter chaque test** dans un fichier séparé si nécessaire
4. **Prioriser les tests à plus fort risque** : litiges, DLC, conversions

> **À reprendre au prochain message : continuer le test A1 (ajouter BRIE, envoyer, puis switcher côté fournisseur)**
