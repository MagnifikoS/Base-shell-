# 🧪 RAPPORT DE SIMULATION — STRATÉGIE UNITÉ FOURNISSEUR V1

> **Document de validation croisée — Zéro implémentation**
> Croisement de 6 produits × 8 flows × 5 edge cases contre le doc `STRATEGIE_UNITE_FOURNISSEUR_V1.md`

---

## 1. PRODUITS DE TEST

| ID | Produit | Conditionnement | Niveaux | Toggle | Famille unité |
|----|---------|-----------------|---------|--------|---------------|
| B1 | Citron | Pièce (simple) | 0 | OFF | count (discret) |
| B2 | Burrata (OFF) | Carton → Boîte → Pièce | 3 | OFF | count (discret) |
| B3 | Burrata (ON) | Carton → Boîte → Pièce | 3 | ON | count (discret) |
| B4 | Boisson | Pack → Bouteille → ml | 3 | ON | count + volume |
| B5 | Crème liquide | Bidon → Litre | 2 | OFF | volume (continu) |
| B6 | Atypique | Carton → Pièce (saut) | 2 | ON | count (discret) |

---

## 2. RÉSOLUTION ATTENDUE PAR PRODUIT

### Logique de dérivation (doc §3.1 + §3.3)

Pour chaque produit, la stratégie auto-génère `product_input_config` :

| ID | `reception_preferred_unit_id` | `reception_mode` | `reception_unit_chain` | `internal_preferred_unit_id` | `internal_mode` |
|----|-------------------------------|------------------|------------------------|------------------------------|-----------------|
| B1 | pièce (= stock_handling) | `integer` | — | pièce | `integer` |
| B2 | carton (packaging[0]) | `integer` | — | pièce ou boîte (choix user) | `integer` |
| B3 | carton (packaging[0]) | `multi_level` | [carton, boîte] | pièce ou boîte (choix user) | `integer` |
| B4 | pack (packaging[0]) | `multi_level` | [pack, bouteille] | bouteille (choix user) | `integer` |
| B5 | **bidon** (packaging[0]) | **integer** | — | litre (= stock_handling) | `continuous` ou `decimal` |
| B6 | carton (packaging[0]) | `multi_level` | [carton, pièce] | pièce | `integer` |

---

## 3. SIMULATION FLOW PAR FLOW

---

### 3.1 COMMANDE CLIENT (`NouvelleCommandeDialog`)

**Routage après fix :** `"order"` → `"reception"` (doc §4, Critique 1)

| ID | Unité affichée | Mode | Exemple saisie | Verdict | Ref doc |
|----|----------------|------|----------------|---------|---------|
| B1 | pièce | integer | 10 pièces | ✅ OK | §13.4 |
| B2 | carton | integer | 2 cartons | ✅ OK | §3.3 toggle OFF |
| B3 | carton + boîte | multi_level | 1 carton + 3 boîtes | ✅ OK | §3.3 toggle ON |
| B4 | pack + bouteille | multi_level | 2 packs + 6 bouteilles | ✅ OK | §3.3 toggle ON, top 2 |
| B5 | **bidon** | **integer** | **2 bidons** | 🔴 **DIVERGENCE** | — |
| B6 | carton + pièce | multi_level | 1 carton + 2 pièces | ✅ OK | §13.3 |

**Divergence B5 :** L'utilisateur attend `10.5 L` en mode `continuous`. La stratégie dérive `bidon` (packaging[0]) en mode `integer`. Voir §5.1.

---

### 3.2 PRÉPARATION FOURNISSEUR (`PreparationDialog`)

**Routage après fix :** `"order"` → `"reception"` (doc §4, Critique 1)
**Produit utilisé :** Produit fournisseur (confirmé doc §13.6)

| ID | Unité affichée | Mode | Verdict | Note |
|----|----------------|------|---------|------|
| B1 | pièce | integer | ✅ OK | Identique commande |
| B2 | carton | integer | ✅ OK | Fournisseur voit son propre packaging |
| B3 | carton + boîte | multi_level | ✅ OK | Idem |
| B4 | pack + bouteille | multi_level | ✅ OK | Idem |
| B5 | **bidon** | **integer** | 🔴 **DIVERGENCE** | Même divergence que commande |
| B6 | carton + pièce | multi_level | ✅ OK | BFS arête directe |

**Note :** Le fournisseur utilise son propre produit via `b2b_imported_products.source_product_id` (doc §13.6). Le packaging fournisseur est la référence. Zéro divergence structurelle client/fournisseur pour les produits discrets.

---

### 3.3 RÉCEPTION CLIENT (`ReceptionView` / `MobileReceptionView`)

**Routage :** `"reception"` directement (déjà correct, doc §2.4)

| ID | Unité affichée | Mode | Exemple | Verdict | Note |
|----|----------------|------|---------|---------|------|
| B1 | pièce | integer | 10 pièces | ✅ OK | |
| B2 | carton | integer | 2 cartons | ✅ OK | |
| B3 | carton + boîte | multi_level | 1 carton + 3 boîtes | ✅ OK | Ancien bug 1.13 carton = résolu |
| B4 | pack + bouteille | multi_level | 2 packs + 6 bouteilles | ✅ OK | ❌ ml exclu correctement |
| B5 | **bidon** | **integer** | **2 bidons** | 🔴 **DIVERGENCE** | Utilisateur attend 10.5 L |
| B6 | carton + pièce | multi_level | 1 carton + 2 pièces | ✅ OK | |

**Commande = Réception :** ✅ Garanti par la stratégie — les deux utilisent le contexte `"reception"` et le même `product_input_config.reception_*`. Identité structurelle absolue.

**Bug 1.13 carton résolu :** ✅ La commande et la réception partagent le même mode `multi_level` avec la même chain. Plus de conversion bizarre en décimal.

---

### 3.4 CORRECTION / LITIGE (`CommandeDetailDialog` + `BlAppCorrectionDialog`)

**Deux composants distincts avec des routages différents :**

| Composant | contextType | Routage actuel | Routage après fix |
|-----------|-------------|----------------|-------------------|
| `CommandeDetailDialog` | `"order"` | → `"internal"` | → `"reception"` ✅ |
| `BlAppCorrectionDialog` | `"correction"` | → `"internal"` | → `"internal"` (inchangé) |

**Simulation `CommandeDetailDialog` (correction commande B2B) :**

| ID | Unité affichée | Mode | Exemple | Verdict |
|----|----------------|------|---------|---------|
| B1 | pièce | integer | 10 → 8 pièces | ✅ OK |
| B2 | carton | integer | 2 → 1 carton | ✅ OK |
| B3 | carton + boîte | multi_level | 1c+3b → 1c+2b | ✅ OK |
| B4 | pack + bouteille | multi_level | 2p+6b → 2p+4b | ✅ OK |
| B5 | **bidon** | **integer** | 2 → 1 bidon | 🔴 **DIVERGENCE** |
| B6 | carton + pièce | multi_level | 1c+2p → 1c+1p | ✅ OK |

**Simulation `BlAppCorrectionDialog` (correction BL réception) :**

| ID | Unité affichée | Mode | Verdict | Note |
|----|----------------|------|---------|------|
| B1 | pièce | integer | ✅ OK | Interne = fournisseur ici |
| B2 | pièce ou boîte | integer | 🔴 **DIVERGENCE** | Utilisateur attend carton (fournisseur) |
| B3 | pièce ou boîte | integer | 🔴 **DIVERGENCE** | Utilisateur attend carton+boîte |
| B4 | bouteille | integer | 🟡 **AMBIGU** | Utilisateur attend pack+bouteille ? |
| B5 | litre | continuous/decimal | ✅ OK | Interne = litre = ce que l'utilisateur veut |
| B6 | pièce | integer | 🔴 **DIVERGENCE** | Utilisateur attend carton+pièce |

**Synthèse correction :**
- `CommandeDetailDialog` : ✅ aligné sur fournisseur (après fix routage)
- `BlAppCorrectionDialog` : 🔴 reste sur interne → **divergence avec l'attente utilisateur** qui veut corriger dans les mêmes unités que la réception

---

### 3.5 RETRAIT INTERNE (`WithdrawalView` / `MobileWithdrawalView`)

**Routage :** `"withdrawal"` → `"internal"` (correct, doc §3.2)

| ID | Unité affichée | Mode | Exemple | Verdict |
|----|----------------|------|---------|---------|
| B1 | pièce | integer | 5 pièces | ✅ OK |
| B2 | pièce ou boîte (config user) | integer | 10 pièces | ✅ OK |
| B3 | pièce ou boîte (config user) | integer | 5 pièces | ✅ OK — PAS carton/boîte |
| B4 | bouteille (config user) | integer | 12 bouteilles | ✅ OK |
| B5 | litre | continuous/decimal | 3.5 L | ✅ OK |
| B6 | pièce | integer | 8 pièces | ✅ OK |

**Verdict global : ✅ 6/6 — Aucune divergence.** Le retrait utilise toujours l'unité interne, totalement découplée du fournisseur. Conforme à la stratégie.

---

### 3.6 INVENTAIRE (`InventoryProductDrawer` / `MobileInventoryView`)

**Routage :** `"inventory"` → `"internal"` (correct, doc §3.2)

| ID | Unité attendue (test) | Unité résolue (stratégie) | Verdict |
|----|----------------------|--------------------------|---------|
| B1 | pièce | pièce (internal) | ✅ OK |
| B2 | pièce ou boîte | pièce ou boîte (config user) | ✅ OK |
| B3 | pièce ou boîte | pièce ou boîte (config user) | ✅ OK |
| B4 | bouteille | bouteille (config user) | ✅ OK |
| B5 | litre | litre (internal = stock_handling) | ✅ OK |
| B6 | pièce | pièce (internal) | ✅ OK |

**Verdict global : ✅ 6/6 — Aucune divergence.** L'inventaire = interne pur.

---

### 3.7 IMPORT B2B

**État après étape 3 (auto-config) :**

| ID | Config auto-générée | Modal bloqué ? | Verdict |
|----|--------------------|----|---------|
| B1 | reception: pièce/integer, internal: pièce/integer | ❌ Non bloqué | ✅ OK |
| B2 | reception: carton/integer, internal: pièce/integer | ❌ | ✅ OK |
| B3 | reception: carton/multi_level [carton,boîte], internal: pièce/integer | ❌ | ✅ OK |
| B4 | reception: pack/multi_level [pack,bouteille], internal: bouteille/integer | ❌ | ✅ OK |
| B5 | reception: bidon/integer, internal: litre/continuous | ❌ | 🟡 Fonctionne mais B5 divergence |
| B6 | reception: carton/multi_level [carton,pièce], internal: pièce/integer | ❌ | ✅ OK |

**Guards du résolveur (doc §13.2) :**

| Guard | B1 | B2 | B3 | B4 | B5 | B6 |
|-------|----|----|----|----|----|----|
| `!config` → not_configured | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chain.length < 2` (multi_level) | N/A | N/A | ✅ [2] | ✅ [2] | N/A | ✅ [2] |
| Doublons dans chain | N/A | N/A | ✅ OK | ✅ OK | N/A | ✅ OK |
| Unité unreachable (BFS) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `!preferredMode \|\| !preferredUnitId` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `preferredUnitId` unreachable | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Verdict : ✅ 6/6 aucun blocage modal** — tous les guards passent. L'import est structurellement sûr.

---

### 3.8 MOBILE

**Vérification :** Le mobile utilise les mêmes résolveurs et contextes (doc §6).

| Flow | Desktop | Mobile | Identique ? |
|------|---------|--------|-------------|
| Réception | `ReceptionView` → `"reception"` | `MobileReceptionView` → `"reception"` en dur | ✅ OUI |
| Retrait | `WithdrawalView` → `"withdrawal"` → `"internal"` | `MobileWithdrawalView` → `"internal"` en dur | ✅ OUI |
| Inventaire | `InventoryProductDrawer` → `"inventory"` → `"internal"` | `MobileInventoryView` → `"inventory"` → `"internal"` | ✅ OUI |

**Verdict : ✅ Mobile = Desktop strictement.**

---

## 4. EDGE CASES

### 4.1 Produit 1 niveau + toggle ON (B1 avec toggle ON)

- Packaging : 0 ou 1 niveau
- Toggle ON → normalement multi_level
- **Garde doc §3.3 :** "1 seul niveau → mode integer forcé"
- **Résultat :** integer/pièce ✅ — pas de multi_level cassé avec chain=1
- **Verdict : ✅ PROTÉGÉ**

### 4.2 Saut de niveau (B6)

- Carton → Pièce (pas de boîte intermédiaire)
- BFS crée une arête directe Carton↔Pièce via `containsQuantity`
- multi_level chain = [carton, pièce] → length=2 ✅
- Pas de doublons ✅
- Les deux sont BFS-atteignables ✅
- **Verdict : ✅ FONCTIONNE** (doc §13.3)

### 4.3 Unité identique partout (B1)

- reception = internal = stock_handling = pièce
- Pas de conflit de mode (both integer)
- Pas de double affichage
- Pas de passage en multi_level
- **Verdict : ✅ TRIVIAL, ZÉRO RISQUE** (doc §13.4)

### 4.4 Multi_level partiel — top 2 niveaux (B4)

- 3 niveaux : Pack → Bouteille → ml
- Toggle ON → top 2 = [Pack, Bouteille]
- ml exclu de la chain ✅
- Pas de saisie en ml ✅
- **Verdict : ✅ CORRECT**

### 4.5 Correction litige multi_level (B3)

- Commande : 1 carton + 3 boîtes
- Réception réelle : 1 carton + 2 boîtes
- `CommandeDetailDialog` → `"reception"` → multi_level [carton, boîte]
- Correction saisie : 1 carton + 2 boîtes ✅
- Pas de conversion bizarre
- **Mais :** `BlAppCorrectionDialog` → `"internal"` → unité différente → 🔴 DIVERGENCE (voir §5.2)

---

## 5. DIVERGENCES — ANALYSE DÉTAILLÉE

---

### 🔴 5.1 DIVERGENCE CRITIQUE — B5 : Produits continus (Bidon vs Litre)

**Le problème :**

| Aspect | Attente utilisateur | Résultat stratégie V1 |
|--------|--------------------|-----------------------|
| Unité commande | Litre | Bidon (packaging[0]) |
| Mode commande | continuous / decimal | integer |
| Exemple | 10.5 L | 2 bidons |

**Pourquoi la stratégie donne Bidon :**
- §3.1 : "L'Unité Fournisseur est dérivée de `packagingLevels[0].type_unit_id`"
- Pour B5, `packagingLevels[0].type_unit_id` = Bidon
- §3.3 : toggle OFF → seul le niveau 0 → Bidon en integer

**Pourquoi l'utilisateur veut Litre :**
- Un bidon est un contenant, pas une unité de mesure commerciale
- Le fournisseur facture en litres, pas en bidons
- La saisie "10.5 L" est plus naturelle que "2 bidons" pour un liquide

**Analyse du cas réel :**

Le problème vient d'un **conflit entre deux vérités** :
1. **Vérité logistique** : le fournisseur livre des bidons (objets physiques)
2. **Vérité commerciale** : le fournisseur facture en litres (unité de mesure)

La stratégie V1 s'aligne sur la vérité logistique (packaging[0] = bidon). Mais pour les produits **continus** (kg, L), la vérité commerciale est souvent plus pertinente pour la saisie.

**Impact :** Affecte tous les produits dont :
- Le packaging contient une unité continue (L, kg, ml, g)
- Le mode d'entrée naturel est la mesure, pas le comptage de contenants

**Produits typiquement concernés :** Crème, huile, sauce, farine en sac (kg), sucre...

**Stratégie de correction proposée :**

**Option A — Détection automatique de la famille d'unité contenue :**

Lors de l'auto-config (wizard + import), si l'unité contenue (`contains_unit_id`) du dernier niveau de packaging est de famille `weight` ou `volume` :
- `reception_mode` = `continuous` (ou `decimal` selon préférence)
- `reception_preferred_unit_id` = l'unité **contenue** (Litre), pas le contenant (Bidon)

Règle : **"Si le fond du packaging est continu, la saisie est continue"**

**Option B — Laisser le mode configurable manuellement :**

L'auto-config met Bidon/integer par défaut, mais l'utilisateur peut manuellement changer dans les settings. Non recommandé car ça contredit le principe "zéro config manuelle" de V1.

**Option C — Introduire un mode hybride :**

Pour les packaging continus, proposer un mode `"packaging_continuous"` : saisir X bidons de Y litres. Trop complexe pour V1.

**Recommandation : Option A** — C'est la plus cohérente. La détection est simple (vérifier `unit.family === "weight" || "volume"` sur l'unité terminale) et couvre tous les cas.

**Conséquence sur la règle du doc §3.1 :**

> ~~"L'Unité Fournisseur est dérivée de `packagingLevels[0].type_unit_id`"~~
> **Modifié :** "L'Unité Fournisseur est dérivée de `packagingLevels[0].type_unit_id`, SAUF si l'unité terminale est continue (weight/volume) — dans ce cas, l'unité de saisie est l'unité contenue la plus profonde, en mode `continuous`."

---

### 🔴 5.2 DIVERGENCE IMPORTANTE — Correction BL sur contexte interne

**Le problème :**

| Composant | Routage doc | Attente utilisateur |
|-----------|-------------|---------------------|
| `BlAppCorrectionDialog` | `"correction"` → `"internal"` | Unité **fournisseur** (même que réception) |

**Pourquoi c'est un problème :**

Quand un client corrige un BL de réception B2B, il doit corriger dans les **mêmes unités** que la réception originale. Si la réception était en "carton + boîte" (multi_level), la correction doit aussi être en "carton + boîte".

**Scénario concret :**

1. Réception B2B de Burrata (B3) : 1 carton + 3 boîtes
2. Erreur détectée : il manque 1 boîte
3. L'utilisateur ouvre la correction BL
4. **Actuel (doc) :** modal affiche en pièce (interne) → l'utilisateur doit calculer combien de pièces = 1 boîte
5. **Attendu :** modal affiche en carton + boîte → l'utilisateur corrige directement

**Impact par produit :**

| ID | Correction interne | Correction fournisseur attendue | Problème ? |
|----|-------------------|--------------------------------|------------|
| B1 | pièce | pièce | ❌ Non (identique) |
| B2 | pièce | carton | ✅ OUI — unité différente |
| B3 | pièce | carton + boîte | ✅ OUI — mode + unité différents |
| B4 | bouteille | pack + bouteille | ✅ OUI — mode + unité différents |
| B5 | litre | litre (avec option A) | ❌ Non (identique) |
| B6 | pièce | carton + pièce | ✅ OUI — mode + unité différents |

**Stratégie de correction proposée :**

**Modifier le routage de `BlAppCorrectionDialog` :**

```
// AVANT
"correction" → "internal"

// APRÈS — Deux options :

// Option 1 : Toujours fournisseur (simple)
"correction" → "reception"

// Option 2 : Contextuel selon l'origine du BL
Si BL est de type réception B2B → "reception"
Si BL est de type retrait interne → "internal"
```

**Recommandation : Option 2** — La correction doit utiliser le même référentiel que le document corrigé. Un BL de réception se corrige en unité fournisseur, un BL de retrait se corrige en unité interne.

**Mais attention :** `BlRetraitCorrectionDialog` (correction retrait) doit rester sur `"internal"`. Il n'y a pas de divergence ici — seul `BlAppCorrectionDialog` est concerné.

**Conséquence sur le doc §3.2 :**

| Contexte | Avant (doc actuel) | Après (corrigé) |
|----------|-------------------|-----------------|
| Correction BL réception | `"internal"` | `"reception"` |
| Correction BL retrait | `"internal"` | `"internal"` (inchangé) |

---

### 🟡 5.3 DIVERGENCE MINEURE — B5 mode auto-dérivation à l'import

**Le problème :**

L'auto-config import (étape 3) doit choisir le mode (`integer` vs `continuous` vs `decimal`). Le doc §13.1 dit que le mode **n'est PAS entièrement dérivable** pour les produits continus.

**Mais pour l'import B2B :** L'import peut copier le mode du produit source (fournisseur). Si le fournisseur a configuré `reception_mode = "continuous"`, le client hérite de ce mode.

**Risque résiduel :** Si le fournisseur n'a PAS de `product_input_config` sur son propre produit (produit legacy), l'import ne sait pas quel mode choisir.

**Stratégie :** L'import doit appliquer la même logique que l'Option A de §5.1 :
1. Si unité terminale = weight/volume → `continuous`
2. Si unité terminale = count → `integer`
3. Si toggle ON + 2+ niveaux → `multi_level`

Cela rend le mode **dérivable pour l'auto-config**, même si l'utilisateur peut le modifier manuellement plus tard.

---

## 6. MATRICE DE CONFORMITÉ GLOBALE

### 6.1 Par produit × flow

| | Commande | Préparation | Réception | Correction (CDDialog) | Correction (BLApp) | Retrait | Inventaire | Import |
|---|---------|-------------|-----------|----------------------|--------------------|---------|-----------|----|
| **B1** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **B2** | ✅ | ✅ | ✅ | ✅ | 🔴 | ✅ | ✅ | ✅ |
| **B3** | ✅ | ✅ | ✅ | ✅ | 🔴 | ✅ | ✅ | ✅ |
| **B4** | ✅ | ✅ | ✅ | ✅ | 🔴 | ✅ | ✅ | ✅ |
| **B5** | 🔴 | 🔴 | 🔴 | 🔴 | ✅ | ✅ | ✅ | 🟡 |
| **B6** | ✅ | ✅ | ✅ | ✅ | 🔴 | ✅ | ✅ | ✅ |

### 6.2 Score global

- **Total cells :** 48 (6 produits × 8 flows)
- **✅ OK :** 39 (81%)
- **🔴 Divergence :** 8 (17%)
- **🟡 Mineur :** 1 (2%)

### 6.3 Répartition des divergences

| Divergence | Cells affectées | Cause racine |
|------------|----------------|--------------|
| B5 (continu) | 4 | Packaging[0] = contenant, pas unité de mesure |
| BlAppCorrection | 4 | Routage interne au lieu de fournisseur |
| Import B5 mode | 1 | Mode non dérivable sans règle famille |

---

## 7. CE QUI FONCTIONNE PARFAITEMENT

### 7.1 Alignement Commande = Préparation = Réception

✅ **Garanti structurellement** par le routage unique `"reception"` pour les 3 flows. Le `product_input_config.reception_*` est la source de vérité commune. Zéro divergence possible.

### 7.2 Isolation Fournisseur / Interne

✅ **Étanche.** Le retrait et l'inventaire utilisent `"internal"`, totalement découplé du fournisseur. Les deux configurations évoluent indépendamment.

### 7.3 Toggle `allow_unit_sale`

✅ **Fonctionne correctement** pour tous les produits discrets (B1-B4, B6) :
- OFF → integer sur packaging[0]
- ON → multi_level sur top 2
- ON + 1 niveau → integer forcé (garde)

### 7.4 BFS et saut de niveau

✅ **B6 prouve** que le BFS gère les sauts de niveau (Carton → Pièce sans Boîte) sans aucun problème. Arête directe dans le graphe.

### 7.5 Ancien bug 1.13 carton

✅ **Résolu définitivement.** Le multi_level garantit que la commande et la réception utilisent le même mode de saisie. Plus de conversion fraction flottante.

### 7.6 Mobile = Desktop

✅ **Strictement identique.** Même résolveur, même contexte, même UQM. Pas de code path spécifique mobile.

### 7.7 Import B2B → Zéro blocage modal

✅ **Tous les guards passent** (doc §13.2). L'auto-config à l'import (étape 3) garantit que tous les champs requis sont remplis.

### 7.8 Quantité canonique context-agnostic

✅ **Aucun code aval** ne dépend du contexte de saisie (doc §13.5). Le modal retourne `canonicalQuantity` + `canonicalUnitId`. Le changement de contexte est transparent pour le stock, les BL, les factures.

---

## 8. STRATÉGIE DE CORRECTION DES DIVERGENCES

### 8.1 Plan d'action révisé (3 correctifs)

| # | Correctif | Type | Impact sur le doc |
|---|-----------|------|-------------------|
| C1 | Règle "unité terminale continue" | Logique auto-config | Modifier §3.1 + ajouter garde famille |
| C2 | Routage BlAppCorrectionDialog | Routage contexte | Modifier §3.2 + mettre à jour §2.4 |
| C3 | Dérivation mode à l'import | Logique SQL | Compléter §3 étape 3 |

### 8.2 Correctif C1 — Règle unité terminale continue

**Objectif :** Les produits dont le packaging aboutit à une unité continue (kg, L) doivent avoir le mode `continuous` et l'unité contenue comme unité de saisie en réception.

**Règle formelle :**

```
SI stock_handling_unit.family ∈ {weight, volume}
  ALORS reception_mode = "continuous"
  ET    reception_preferred_unit_id = stock_handling_unit_id
SINON
  SI allow_unit_sale = true ET niveaux ≥ 2
    ALORS reception_mode = "multi_level"
    ET    reception_unit_chain = [top 2 niveaux]
  SINON
    reception_mode = "integer"
    ET    reception_preferred_unit_id = packaging[0].type_unit_id
```

**Sections du doc à modifier :**
- §3.1 : Ajouter l'exception "unité terminale continue"
- §3.3 : Préciser que le toggle n'est pertinent que pour les produits discrets
- Étape 3 (import SQL) : Intégrer la détection de famille
- Étape 4 (wizard) : Même logique de dérivation

### 8.3 Correctif C2 — Routage BlAppCorrectionDialog

**Objectif :** Les corrections de BL de réception utilisent les unités fournisseur.

**Modification du routage :**

```
// DANS toInputContext ou dans BlAppCorrectionDialog directement
Si le BL corrigé est un BL de réception (bl_app_documents) → "reception"
Si le BL corrigé est un BL de retrait (bl_withdrawal_documents) → "internal"
```

**Sections du doc à modifier :**
- §3.2 : Ligne Correction BL → `"reception"` (pour BL réception)
- §2.4 : Mettre à jour BlAppCorrectionDialog → `"reception"`

### 8.4 Correctif C3 — Dérivation mode import

**Objectif :** L'import B2B dérive le mode correctement pour tous les types de produits.

**Algorithme :**

```
1. Résoudre stock_handling_unit_id local (après remappage)
2. Chercher la famille de l'unité dans measurement_units
3. Appliquer la règle C1 :
   - weight/volume → continuous
   - count + toggle ON + 2+ niveaux → multi_level
   - count + (toggle OFF ou 1 niveau) → integer
```

**Section du doc à modifier :**
- Étape 3 : Détailler l'algorithme de dérivation du mode

---

## 9. RÉSUMÉ EXÉCUTIF

### ✅ Ce qui est solide (aucun changement requis)

1. **Routage Commande/Préparation/Réception** → `"reception"` ✅
2. **Toggle allow_unit_sale** → logique discrète parfaite ✅
3. **Isolation fournisseur/interne** → étanche ✅
4. **BFS** → robuste même avec sauts de niveau ✅
5. **Import** → guards passent pour 6/6 produits ✅
6. **Mobile = Desktop** → identique ✅
7. **Aval context-agnostic** → aucun code ne dépend du contexte ✅

### 🔴 Ce qui doit être corrigé dans le doc (avant implémentation)

1. **§3.1 — Règle unité terminale continue** : Ajouter exception pour weight/volume
2. **§3.2 — BlAppCorrectionDialog** : Passer à `"reception"` pour les BL de réception
3. **Étape 3 — Algorithme dérivation mode** : Intégrer détection famille d'unité

### 📊 Score final après correctifs

Si les 3 correctifs sont intégrés au doc :
- **48/48 cells OK** (100%)
- **0 divergence**
- **Zéro surprise après déploiement**
