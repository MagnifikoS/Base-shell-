# AUDIT PARANO — RÈGLE GLOBALE STOCK NÉGATIF

> **Date :** 2026-03-18
> **Portée :** Toute l'application Restaurant OS — tous les flux qui écrivent dans `stock_events`
> **Objectif :** Identifier la règle réelle, les incohérences, et proposer la règle cible unique

---

## 1. RÉSUMÉ EXÉCUTIF

### Niveau de gravité : 🔴 CRITIQUE

**Problème réel :** La règle de stock négatif est **appliquée de manière incohérente** à travers 5 chemins d'écriture différents. Le guard central (`fn_post_stock_document`) bloque aveuglément **tous les types de documents** (y compris les RECEIPT) dès que le résultat est négatif, alors que 3 autres chemins **contournent totalement le guard** en écrivant directement dans `stock_events`.

**Verdict :** Le système est dans un état contradictoire :
- Il **bloque** les réceptions qui corrigeraient un stock négatif ← BUG BLOQUANT observé
- Il **autorise** les retraits B2B sans aucun check ← risque de création silencieuse de négatifs
- Il **force** les quick adjustments sans restriction ← cohérent (vérité terrain)
- Il **vérifie** les void mais **ne donne pas la possibilité d'override** ← blocage potentiel

---

## 2. CARTOGRAPHIE DES FLUX STOCK

### Tous les points d'écriture dans `stock_events`

| # | Flux | Fonction/RPC | Type d'événement | Direction stock | Chemin |
|---|------|-------------|-------------------|-----------------|--------|
| 1 | Réception manuelle | `fn_post_stock_document` | RECEIPT | ↑ Ajout | Via edge fn `stock-ledger` |
| 2 | Retrait manuel | `fn_post_stock_document` | WITHDRAWAL | ↓ Retrait | Via edge fn `stock-ledger` |
| 3 | Correction réception | `fn_post_stock_document` | ADJUSTMENT (mappé de RECEIPT_CORRECTION) | ↑ ou ↓ | Via edge fn `stock-ledger` |
| 4 | Ajustement manuel | `fn_post_stock_document` | ADJUSTMENT | ↑ ou ↓ | Via edge fn `stock-ledger` |
| 5 | Quick Adjustment | `fn_quick_adjustment` → `fn_post_stock_document` | ADJUSTMENT | ↑ ou ↓ | Via edge fn (override=true) |
| 6 | Expédition B2B fournisseur | `fn_ship_commande` | WITHDRAWAL | ↓ Retrait | **INLINE direct** (bypass fn_post) |
| 7 | Réception B2B client | `fn_post_b2b_reception` | RECEIPT | ↑ Ajout | **INLINE direct** (bypass fn_post) |
| 8 | Auto-correction B2B | `fn_post_b2b_reception` (STEP 5) | ADJUSTMENT | ↑ Correction | **INLINE direct** |
| 9 | Transfert zone (retrait) | `fn_transfer_product_zone` → `fn_post_stock_document` | WITHDRAWAL | ↓ Retrait | Via fn_post (sans override) |
| 10 | Transfert zone (réception) | `fn_transfer_product_zone` → `fn_post_stock_document` | RECEIPT | ↑ Ajout | Via fn_post (sans override) |
| 11 | Annulation (void) | `fn_void_stock_document` | VOID | ↑ ou ↓ (inverse) | Propre guard séparé |

---

## 3. CARTOGRAPHIE DES GUARDS NÉGATIFS

### 3.1 Guard central : `fn_post_stock_document` (migration `20260316185857`)

**Localisation :** Étape 9, lignes 200-282

**Comportement actuel :**
```
SI p_override_flag = false ALORS
  Calculer stock_résultant = snapshot + Σ(events) + line_delta
  SI stock_résultant < 0 POUR N'IMPORTE QUEL PRODUIT ALORS
    Rollback status → DRAFT
    RAISE EXCEPTION 'NEGATIVE_STOCK:...'
  FIN SI
FIN SI
```

**⚠️ PROBLÈME CRITIQUE :** Ce guard s'applique **à TOUS les types de documents** sans distinction :
- `RECEIPT` → bloqué si résultat < 0 ❌ (ne devrait JAMAIS être bloqué)
- `WITHDRAWAL` → bloqué si résultat < 0 ✅ (correct — sauf si override)
- `ADJUSTMENT` → bloqué si résultat < 0 ⚠️ (dépend du cas — quick_adj passe avec override)
- `RECEIPT_CORRECTION` → bloqué si résultat < 0 ⚠️ (correction positive ne devrait pas bloquer)

### 3.2 Guard void : `fn_void_stock_document` (migration `20260216230004`)

**Localisation :** Étape 6 (STK-LED-016)

**Comportement :**
- Calcule l'impact inverse du void
- Si le void d'une RECEIPT (= retrait implicite) rend le stock < 0 → RAISE EXCEPTION
- **Pas d'override possible** → blocage absolu

**Verdict :** Logiquement correct (annuler une réception = retirer du stock = doit vérifier), mais **l'absence d'override** est un risque de blocage opérationnel.

### 3.3 Flux SANS guard : `fn_ship_commande` (migration `20260311144047`)

**Localisation :** Étape 5e — INSERT direct dans `stock_events`

**Comportement :**
- **AUCUN check de stock négatif**
- `override_flag` hardcodé à `true`
- `override_reason` = 'Expedition commande B2B ...'
- Écrit directement des WITHDRAWAL avec delta négatif

**⚠️ PROBLÈME :** Le fournisseur peut expédier plus que son stock sans aucun avertissement. Le stock peut devenir arbitrairement négatif.

### 3.4 Flux SANS guard : `fn_post_b2b_reception` (migration `20260314083810`)

**Localisation :** Étapes 3-4 — INSERT direct dans `stock_events`

**Comportement :**
- **AUCUN check de stock négatif pour la RECEIPT** (normal — ajout de stock)
- **MAIS** : l'étape 5 détecte les stocks négatifs résultants et les corrige avec un `AUTO_NEGATIVE_CORRECTION` (ADJUSTMENT positif)

**Verdict :** Ce flux a sa **propre logique de gestion du négatif** — complètement séparée du guard central. C'est **incohérent architecturalement** mais **fonctionnellement correct** pour le cas B2B.

### 3.5 Quick Adjustment : `fn_quick_adjustment` (migration `20260317144338`)

**Comportement :**
- Appelle `fn_post_stock_document` avec `p_override_flag := true`
- Donc **bypass complet** du guard négatif
- Justification : "vérité terrain" — l'utilisateur saisit la réalité physique

**Verdict :** ✅ Correct et cohérent.

### 3.6 Transfert de zone : `fn_transfer_product_zone` (migration `20260302211005`)

**Comportement :**
- Appelle `fn_post_stock_document` **SANS override** pour le WITHDRAWAL
- Puis appelle `fn_post_stock_document` **SANS override** pour la RECEIPT

**⚠️ PROBLÈME :** Si le stock est déjà négatif dans l'ancienne zone, le transfert de zone ÉCHOUE au retrait. Même si l'utilisateur veut juste changer la zone d'un produit à stock 0.

**⚠️ PROBLÈME 2 :** Si le stock est positif mais que la RECEIPT échoue (stock négatif dans la NOUVELLE zone — cas théorique), le système est dans un état incohérent : le retrait a été posté mais pas la réception.

---

## 4. ANALYSE DES INCOHÉRENCES

### INCOHÉRENCE 1 : RECEIPT bloquée par guard négatif
- **Gravité :** 🔴 CRITIQUE — BUG BLOQUANT observé en production
- **Localisation :** `fn_post_stock_document` étape 9
- **Scénario :** Stock = -16 (suite à retraits). Utilisateur reçoit +10. Résultat = -6. Guard bloque.
- **Contradiction :** On empêche l'utilisateur de **corriger** le stock négatif par une réception légitime.
- **Impact :** L'établissement ne peut plus recevoir de marchandise tant que le stock est négatif.

### INCOHÉRENCE 2 : fn_ship_commande bypass total
- **Gravité :** 🟠 HAUTE
- **Localisation :** `fn_ship_commande` étape 5e
- **Scénario :** Fournisseur expédie 100 unités alors qu'il en a 5 en stock.
- **Contradiction :** Les retraits manuels sont bloqués, mais les retraits B2B passent sans check.
- **Impact :** Création silencieuse de stocks négatifs massifs côté fournisseur.

### INCOHÉRENCE 3 : Deux systèmes de gestion du négatif non alignés
- **Gravité :** 🟡 MOYENNE
- `fn_post_stock_document` : bloque via RAISE EXCEPTION
- `fn_post_b2b_reception` : détecte et corrige avec AUTO_NEGATIVE_CORRECTION
- Ces deux approches ne sont pas coordonnées et appliquent des philosophies différentes.

### INCOHÉRENCE 4 : Le transfert de zone peut échouer sur un produit à stock 0
- **Gravité :** 🟡 MOYENNE
- **Scénario :** Produit avec stock = 0. L'utilisateur veut changer sa zone. `fn_transfer_product_zone` appelle fn_post avec un WITHDRAWAL de qty=0 (noop si 0, mais qty>0 requis). Si le stock réel est légèrement négatif (arrondi), le transfert bloque.
- **Impact :** Blocage opérationnel pour la réorganisation des zones.

### INCOHÉRENCE 5 : Void sans override possible
- **Gravité :** 🟡 MOYENNE
- **Scénario :** On veut annuler une réception postée par erreur. Le void crée un retrait inverse. Si ce retrait rend le stock < 0, on ne peut pas annuler. Pas d'override.
- **Impact :** Impossibilité de corriger des erreurs de saisie passées.

---

## 5. CAS DE PROD NÉGATIFS

### Données réelles (requête du 2026-03-18)

| Produit | Établissement | Snap qty | Events delta | Stock estimé |
|---------|--------------|----------|-------------|-------------|
| TEST 2 | 78eb1ffe... | 0 | -117.5 | **-117.5** |
| TEST 3 | 78eb1ffe... | 0 | -78 | **-78** |
| YOGA 100% ANANAS | 7775d89d... | 11 | -35 | **-24** |
| Sac poubelle | e9c3dccf... | 12 | -28 | **-16** |
| PRODUIT Y - HUILE AMPHORE | 78eb1ffe... | 0 | -16 | **-16** |
| PRODUIT X - SAFRAN IRANIEN | 78eb1ffe... | 0 | -10 | **-10** |
| POIVRON GRILLER | 7775d89d... | 0.5 | -10 | **-9.5** |
| MASCARPONE GRANAROLO | 7775d89d... | 0 | -9 | **-9** |
| BURRATA 125G | 7775d89d... | 0 | -5 | **-5** |
| VIANDE HACHE | e9c3dccf... | 0 | -2 | **-2** |
| *(+ 5 autres de -1.5 à -0.2)* | | | | |

**Total : 15 produits actifs avec stock négatif dans 4 établissements**

### Origine probable

1. **Produits TEST** (78eb1ffe) : Probablement des tests manuels avec retraits sans réception préalable. Snap à 0 + retraits purs = négatif inévitable.
2. **Produits réels** (7775d89d, e9c3dccf, c0129f18) : Retraits ayant dépassé le stock réel. Les retraits passent avec `override_flag=true` quand l'utilisateur confirme.
3. **Expéditions B2B** (`fn_ship_commande`) : Retraits sans aucun guard → créent du négatif silencieusement.

### Sévérité
- Les produits TEST ne sont pas critiques
- Les 10+ produits réels en négatif sont un **symptôme opérationnel** → soit réceptions manquantes, soit inventaire non fait
- L'état négatif **bloque maintenant les réceptions B2B** (le bug observé)

---

## 6. AUDIT DES ÉCARTS

### 6.1 Logique existante : inventory_discrepancies

La table `inventory_discrepancies` existe et capture les écarts entre stock estimé et stock réel. Elle est peuplée :
- À l'inventaire quand `counted_quantity ≠ estimated_stock`
- Par `fn_post_b2b_reception` (STEP 5) via `AUTO_NEGATIVE_CORRECTION`

### 6.2 Quick Adjustment (Centre de contrôle)

- L'utilisateur saisit la **valeur cible** (vérité terrain)
- Le système calcule le delta et force l'override
- **C'est le mécanisme de correction principal pour les stocks faux**
- ✅ Fonctionne correctement même sur stock négatif

### 6.3 Inventaire complet

- Un inventaire terminé crée un nouveau snapshot
- Tous les stocks sont recalculés depuis le snapshot = 0 + events post-snapshot
- **L'inventaire ne corrige pas directement un négatif** — il crée une nouvelle baseline

### 6.4 Réception comme correction

- Une réception est le moyen naturel de "combler" un stock négatif (la marchandise arrive)
- **MAIS le guard bloque cette réception** si le résultat reste < 0 ← LE BUG

### 6.5 RECEIPT_CORRECTION

- Mappé vers ADJUSTMENT dans `fn_post_stock_document`
- Permet de corriger une réception précédente (ajouter des lignes oubliées)
- **Soumis au même guard aveugle** → peut être bloqué si stock négatif

---

## 7. RÈGLE GÉNÉRALE MÉTIER RECOMMANDÉE

### Principe fondamental

> **Le guard de stock négatif existe pour empêcher les opérations qui RETIRENT du stock de créer ou aggraver un déficit. Il ne doit JAMAIS empêcher les opérations qui AJOUTENT du stock ou qui CORRIGENT un déficit.**

### Règle matricielle par type d'opération

| Type d'opération | Direction | Guard négatif | Override possible | Justification |
|-------------------|-----------|---------------|-------------------|---------------|
| **RECEIPT** | ↑ Ajout | ❌ JAMAIS bloqué | N/A | Ajoute du stock — ne peut qu'améliorer le solde |
| **RECEIPT_CORRECTION** | ↑ Ajout (positif) | ❌ JAMAIS bloqué | N/A | Correction positive = ajout |
| **RECEIPT_CORRECTION** | ↓ Retrait (négatif) | ✅ Bloqué | Oui (override) | Correction négative = retrait |
| **WITHDRAWAL** | ↓ Retrait | ✅ Bloqué | Oui (override + raison) | Protège le stock |
| **ADJUSTMENT** (positif) | ↑ Ajout | ❌ JAMAIS bloqué | N/A | Correction positive |
| **ADJUSTMENT** (négatif) | ↓ Retrait | ✅ Bloqué | Oui (override + raison) | Protège le stock |
| **B2B SHIPMENT** | ↓ Retrait | ✅ Bloqué (avec override possible) | Oui | Alignement avec retraits manuels |
| **B2B RECEPTION** | ↑ Ajout | ❌ JAMAIS bloqué | N/A | Ajoute du stock |
| **ZONE TRANSFER** | ↔ Neutre | ❌ Exempt (atomique) | N/A | Opération neutre (retrait + réception liés) |
| **VOID de RECEIPT** | ↓ Retrait implicite | ✅ Bloqué | Oui (override manquant) | Annuler une réception = retirer |
| **VOID de WITHDRAWAL** | ↑ Ajout implicite | ❌ JAMAIS bloqué | N/A | Annuler un retrait = ajouter |
| **QUICK ADJUSTMENT** | ↑ ou ↓ | ❌ Exempt (override forcé) | Toujours forcé | Vérité terrain |

### Règle résumée en une phrase

> **Seuls les deltas négatifs (qui retirent du stock) doivent être soumis au guard. Tous les deltas positifs (qui ajoutent du stock) passent sans restriction.**

### Formule du guard

```
SI override_flag = false
  ET delta_ligne < 0 (retrait)
  ET stock_résultant < 0
ALORS bloquer
```

C'est la seule condition qui doit déclencher `NEGATIVE_STOCK`.

---

## 8. LISTE DES FAILLES IDENTIFIÉES

### FAILLE-NS-01 : Guard aveugle sur RECEIPT
- **Gravité :** 🔴 CRITIQUE
- **Scénario :** Stock = -16. Réception B2B de +10. Résultat = -6. Guard bloque la réception.
- **Impact :** Blocage opérationnel — impossible de recevoir de la marchandise
- **Complexité de correction :** Faible — ajouter condition `WHERE line_delta < 0` dans le guard
- **Risque métier :** Utilisateurs ne peuvent plus travailler. Contournement par quick adjustment.

### FAILLE-NS-02 : fn_ship_commande sans guard
- **Gravité :** 🟠 HAUTE
- **Scénario :** Fournisseur expédie 100 unités, stock = 5. Résultat = -95 sans avertissement.
- **Impact :** Création silencieuse de stocks négatifs massifs
- **Complexité de correction :** Moyenne — ajouter check inline ou appeler fn_post_stock_document
- **Risque métier :** Données de stock fournisseur corrompues silencieusement

### FAILLE-NS-03 : Void sans override
- **Gravité :** 🟡 MOYENNE
- **Scénario :** Utilisateur veut annuler une réception erronée. Stock = 2, réception = 5. Void retirerait 5, résultat = -3. Bloqué sans option.
- **Impact :** Impossibilité de corriger des erreurs de saisie
- **Complexité de correction :** Faible — ajouter paramètre override à fn_void
- **Risque métier :** Opérationnel — utilisateur doit faire un adjustment au lieu d'un void propre

### FAILLE-NS-04 : Transfert de zone fragile
- **Gravité :** 🟡 MOYENNE
- **Scénario :** Produit à stock = 0.001 (arrondi). Transfert tente un WITHDRAWAL de 0.001. Si calcul donne -0.0001 après arrondi → bloqué.
- **Impact :** Blocage de la réorganisation des zones
- **Complexité de correction :** Faible — passer override=true pour les transferts (opération neutre)
- **Risque métier :** Faible mais irritant

### FAILLE-NS-05 : Deux philosophies de gestion du négatif
- **Gravité :** 🟡 MOYENNE (dette architecturale)
- **Scénario :** `fn_post_stock_document` bloque et raise. `fn_post_b2b_reception` détecte et corrige.
- **Impact :** Deux comportements différents pour le même problème → confusion, maintenance difficile
- **Complexité de correction :** Haute — nécessite harmonisation architecturale
- **Risque métier :** Faible immédiatement, mais dette croissante

### FAILLE-NS-06 : 15 produits déjà négatifs en prod
- **Gravité :** 🟡 MOYENNE
- **Scénario :** Stocks négatifs existants bloquent les réceptions (FAILLE-NS-01)
- **Impact :** Cercle vicieux — le stock négatif empêche sa propre correction
- **Complexité de correction :** Faible — corriger FAILLE-NS-01 débloque automatiquement
- **Risque métier :** Opérationnel immédiat

---

## 9. PRIORISATION

### 🔴 P0 — Corriger immédiatement

1. **FAILLE-NS-01** : Exempter les RECEIPT du guard négatif dans `fn_post_stock_document`
   - Correction : ne vérifier le négatif que si `line_delta < 0`
   - Impact : débloque toutes les réceptions bloquées
   - Risque de régression : nul (on retire un blocage erroné)

### 🟠 P1 — Corriger rapidement

2. **FAILLE-NS-02** : Ajouter un check de stock négatif dans `fn_ship_commande`
   - Avec override_flag hardcodé à true (pour ne pas bloquer les commandes B2B)
   - Mais ajouter une détection + alerte ou log

### 🟡 P2 — Corriger au prochain sprint

3. **FAILLE-NS-03** : Ajouter override au void
4. **FAILLE-NS-04** : Override forcé pour transferts de zone

### 📐 P3 — Amélioration structurelle

5. **FAILLE-NS-05** : Harmoniser la philosophie (un seul pattern pour tous les flux)

---

## 10. VERDICT FINAL

### Quelle doit être la règle générale du stock négatif dans Restaurant OS ?

> **Le guard de stock négatif ne doit s'appliquer qu'aux opérations à delta négatif (retraits, expéditions, corrections négatives, voids de réceptions). Toute opération à delta positif (réceptions, corrections positives, voids de retraits) doit être autorisée sans restriction, car elle ne peut qu'améliorer le solde.**

### Où le système actuel la viole-t-il ?

1. **`fn_post_stock_document`** viole la règle en **bloquant les RECEIPT** quand le résultat final est < 0. C'est la violation la plus grave car elle **empêche la correction naturelle** d'un stock négatif.

2. **`fn_ship_commande`** viole la règle en **n'appliquant aucun guard** sur les retraits B2B. C'est incohérent avec les retraits manuels qui sont bloqués.

3. **`fn_void_stock_document`** viole partiellement la règle en ne proposant **pas d'override** quand l'annulation d'une réception rendrait le stock négatif.

### Le système est-il sûr aujourd'hui ?

**Non.** Le guard est trop large (bloque les réceptions) ET trop lax (laisse passer les expéditions B2B). L'incohérence crée un **cercle vicieux** : les retraits B2B créent du négatif → les réceptions qui corrigeraient le négatif sont bloquées → le stock reste figé dans un état faux.

### La correction est-elle simple ?

**Oui pour P0.** La modification de `fn_post_stock_document` est chirurgicale : ajouter `AND line_delta < 0` dans la clause WHERE du CTE `negatives`. Cela suffit à débloquer le bug observé sans risque de régression.

---

*Fin de l'audit. Document prêt pour revue et stratégie de correction.*
