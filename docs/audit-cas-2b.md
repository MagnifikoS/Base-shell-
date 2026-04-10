# Audit Cas 2b — Cohérence métier Food Cost & Marchandise

**Date :** 14 mars 2026  
**Périmètre :** Modules Food Cost (`src/modules/foodCost/`) et Marchandise (`src/modules/marchandise/`)  
**Objectif :** Vérifier si le système communique clairement que les valorisations sont des **estimations basées sur les prix actuels**, et non des coûts réels historiques.

---

## 1 — Résumé exécutif

| Module | Verdict |
|---|---|
| **Food Cost** | ✅ **Clair** — Le sous-titre dit « Coût de revient actuel ». La nature temps-réel est cohérente avec l'usage (fiche recette = combien ça coûte *maintenant*). Aucun risque de confusion historique. |
| **Marchandise** | ⚠️ **Ambigu** — Les chiffres « Consommation », « Stock début/fin » sont présentés comme des montants en euros *sans aucune mention* qu'ils sont calculés avec les prix catalogue *actuels* et non les prix payés au moment de la période. Un restaurateur peut croire voir un coût historique réel. |

**Verdict global : le module Marchandise présente un risque réel de mauvaise interprétation.**

---

## 2 — Cartographie des écrans

### 2.1 — Food Cost (3 écrans)

| # | Écran | Fichier | Chiffres affichés |
|---|---|---|---|
| FC-1 | Page principale Desktop | `FoodCostPage.tsx` / `FoodCostTable.tsx` | Coût de revient (Entier / Portion), Prix de vente (Entier / Portion), Ratio |
| FC-2 | Page principale Mobile | `FoodCostMobileList.tsx` | Nom recette, Ratio |
| FC-3 | Tiroir détail Mobile | `FoodCostMobileDetail.tsx` | Coût recette, Coût/portion, Prix de vente recette, Prix de vente/portion, Ratio |

### 2.2 — Marchandise (2 écrans)

| # | Écran | Fichier | Chiffres affichés |
|---|---|---|---|
| M-1 | Liste des périodes | `MarchandisePage.tsx` (liste) | Stock début €, Réceptions €, Stock fin €, **Consommation €** |
| M-2 | Détail période | `MarchandisePage.tsx` (PeriodDetailView) | Stock début, Réceptions, Stock fin, **Consommation** (cards) + tableau produit avec Prix unitaire, Total € |

---

## 3 — Analyse du wording

### 3.1 — Food Cost

| Écran | Libellé exact | Risque de confusion |
|---|---|---|
| FC-1 (header) | `"Food Cost"` | ❌ Aucun — terme métier standard |
| FC-1 (sous-titre) | `"Coût de revient actuel"` | ❌ Aucun — **le mot « actuel » est explicite** |
| FC-1 (colonnes) | `"Coût de revient"` / `"Prix de vente"` / `"Ratio"` | ❌ Aucun |
| FC-3 (drawer) | `"Coût recette"` / `"Coût / portion"` | ❌ Aucun — contexte = fiche recette |
| FC-1/FC-2 (partiel) | Préfixe `≈` + couleur ambre | ❌ Aucun — signale clairement l'approximation |

**✅ Food Cost est correctement worded.** Le sous-titre « actuel » et le préfixe `≈` sur les partiels rendent la nature estimative explicite.

### 3.2 — Marchandise

| Écran | Libellé exact | Risque de confusion |
|---|---|---|
| M-1 (titre) | `"Marchandise — Consommation par période"` | ⚠️ **Ambigu** — « Consommation » sans qualifier « estimée » |
| M-1 (sous-titre) | `"Calculé entre chaque inventaire terminé. Formule : Stock début + Réceptions − Stock fin."` | ✅ La formule est honnête, mais ne dit pas que les € sont basés sur les prix actuels |
| M-1 (colonnes) | `"Stock début €"` / `"Réceptions €"` / `"Stock fin €"` / `"Consommation €"` | ⚠️ **Présentés comme des montants factuels** |
| M-2 (cards) | `"Stock début"` / `"Réceptions"` / `"Stock fin"` / `"Consommation"` | ⚠️ **Aucune mention « estimé » ou « indicatif »** |
| M-2 (tableau) | `"Prix unitaire"` / `"Total €"` | ⚠️ **Présenté comme un prix réel** |
| M-2 (badge) | `"Prix actuel"` (badge sur chaque ligne, via `price_is_live`) | ✅ **Seul élément transparent** — mais discret et au niveau ligne, pas au niveau page |
| M-2 (alert) | `"Certains produits n'ont pas de prix configuré — les totaux peuvent être sous-estimés."` | ✅ Honnête pour les prix manquants, mais ne mentionne pas la nature estimative des prix *présents* |

**Termes problématiques identifiés :**

| Terme utilisé | Perception utilisateur | Réalité technique |
|---|---|---|
| `"Consommation €"` | Coût réel de ce qu'on a consommé | Quantité consommée × prix catalogue *actuel* |
| `"Stock début €"` / `"Stock fin €"` | Valeur réelle du stock à cette date | Quantité inventoriée × prix catalogue *actuel* |
| `"Réceptions €"` | Montant réellement payé aux fournisseurs | Quantité reçue × prix catalogue *actuel* |
| `"Prix unitaire"` | Prix payé lors de la période | Prix catalogue actuel (`final_unit_price`) |
| `"Total €"` | Total réellement dépensé | Quantité × prix actuel |

---

## 4 — Analyse des calculs

### 4.1 — Food Cost Engine (`foodCostEngine.ts`)

```
Coût recette = Σ (quantité_ingrédient × prix_unitaire_actuel × facteur_conversion)
Ratio = prix_de_vente / coût_recette
```

- **Source prix :** `product.final_unit_price` (prix catalogue courant)
- **Nature :** Estimation en temps réel — *par design*, c'est correct pour une fiche recette
- **Pas de dimension temporelle :** on ne consulte jamais un « food cost du mois dernier »
- **Verdict :** ✅ Cohérent — une fiche recette est *toujours* un calcul temps réel

### 4.2 — Merchandise Engine (`monthlyMerchandiseEngine.ts`)

```
Consommation = (Stock_début × prix_actuel) + (Réceptions × prix_actuel) − (Stock_fin × prix_actuel)
```

- **Source prix :** `products_v2.final_unit_price` (prix catalogue courant)
- **Source quantités :** `inventory_lines` (historiques — les quantités sont figées au moment de l'inventaire)
- **Nature :** **Mélange dangereux** — quantités historiques × prix actuels
- **Flag `price_is_live` :** Toujours `true` (ligne 442 : `price_is_live: true` — codé en dur)
- **Verdict :** ⚠️ Le moteur assume correctement en interne, mais l'UI ne transmet pas cette information

---

## 5 — Risques métier

### Scénario 1 — Hausse de prix fournisseur

> **Produit :** Tomates  
> **Prix :** 8 €/kg au 1er mars → 9 €/kg au 15 mars  
> **Inventaire A :** 1er mars (100 kg comptés)  
> **Inventaire B :** 31 mars (80 kg comptés)  
> **Réceptions période :** 50 kg reçus

**Ce que le restaurateur voit (M-1) :**
- Stock début : `100 × 9 = 900 €`
- Réceptions : `50 × 9 = 450 €`
- Stock fin : `80 × 9 = 720 €`
- Consommation : `900 + 450 − 720 = 630 €`

**Ce qui s'est réellement passé :**
- Stock début : `100 × 8 = 800 €`
- Réceptions : `50 × (mix 8/9) ≈ 425 €`
- Stock fin : `80 × 9 = 720 €`
- Consommation réelle : `~505 €`

**Écart :** +125 € (soit +25% de surestimation)

**Le restaurateur peut-il croire que 630 € est le coût réel ?**
> **OUI.** Rien sur l'écran ne dit le contraire. Les libellés « Consommation € » et « Stock début € » sont présentés comme des faits.

**Le rapport change-t-il rétroactivement ?**
> **OUI.** Si le prix passe à 10 €/kg en avril, les mêmes chiffres de mars seront recalculés avec 10 €. Le restaurateur ne le saura pas.

### Scénario 2 — Consultation d'une ancienne période

> Un gérant consulte la période « 01/01 → 31/01 ».  
> Entre-temps, 3 produits ont changé de prix.

**Le chiffre affiché est-il celui de janvier ?**
> **NON.** C'est le calcul d'aujourd'hui avec les prix d'aujourd'hui appliqués aux quantités de janvier. Le gérant n'a aucun moyen de le savoir.

---

## 6 — Verdict

| Module | Statut | Justification |
|---|---|---|
| **Food Cost** | ✅ **Clair** | Le sous-titre « Coût de revient actuel » est explicite. Pas de dimension temporelle = pas de confusion possible. Le préfixe ≈ signale les partiels. |
| **Marchandise** | ⚠️ **Potentiellement trompeur** | Les montants en euros sont présentés comme factuels alors qu'ils sont recalculés dynamiquement. Le badge « Prix actuel » existe au niveau ligne mais est trop discret et technique pour prévenir la confusion. Aucun avertissement au niveau page ou cards. |

---

## 7 — Recommandations produit

### 7.1 — Marchandise : Ajouter une mention estimative (PRIORITÉ HAUTE)

**Écran M-1 (liste des périodes) — Sous-titre actuel :**
```
"Calculé entre chaque inventaire terminé. Formule : Stock début + Réceptions − Stock fin."
```

**Sous-titre recommandé :**
```
"Estimation basée sur les prix catalogue actuels. Formule : Stock début + Réceptions − Stock fin."
```

**Impact :** 1 ligne de texte modifiée.

### 7.2 — Marchandise : Qualifier les colonnes € (PRIORITÉ MOYENNE)

**Colonnes actuelles :**
```
"Stock début €" / "Réceptions €" / "Stock fin €" / "Consommation €"
```

**Colonnes recommandées :**
```
"Stock début € (est.)" / "Réceptions € (est.)" / "Stock fin € (est.)" / "Consommation € (est.)"
```

Ou alternativement, ajouter un `Tooltip` sur les en-têtes : *"Valorisé au prix catalogue actuel"*.

**Impact :** Wording uniquement.

### 7.3 — Marchandise : Ajouter un bandeau info permanent (PRIORITÉ MOYENNE)

Sur l'écran M-2 (détail période), ajouter un `Alert` informatif permanent :

```
ℹ️ Les montants sont calculés avec les prix catalogue actuels, 
   pas les prix payés au moment de la période.
```

**Impact :** 1 composant Alert ajouté.

### 7.4 — Food Cost : Aucune modification nécessaire

Le module est correctement worded. Le sous-titre « Coût de revient actuel » est suffisant.

### 7.5 — Marchandise : Cards résumé (PRIORITÉ BASSE)

Les 4 cards en haut de M-2 (Stock début, Réceptions, Stock fin, Consommation) pourraient afficher un sous-label discret :

```
"au prix actuel"
```

sous chaque montant. Impact visuel minimal, clarté maximale.

---

## Ce qui n'a PAS été audité (hors périmètre)

- ❌ Circuit commande B2B (validé)
- ❌ Prix de commande figé à l'envoi (validé)
- ❌ Réception ne modifie pas les prix (validé)
- ❌ Facture utilise le prix figé (validé)
- ❌ Historique achats lit les montants réels (validé)
- ❌ Calculs financiers complets
- ❌ Moteur de conversion BFS

---

## Réponse à la question finale

> **Un restaurateur peut-il aujourd'hui croire voir un coût réel historique alors que le système affiche une estimation recalculée avec les prix actuels ?**

**OUI, sur le module Marchandise.** Les libellés « Consommation € », « Stock début € », « Stock fin € » sont présentés comme des montants factuels sans aucune qualification estimative au niveau page. Le badge « Prix actuel » au niveau ligne est trop discret et technique pour prévenir la confusion.

**NON, sur le module Food Cost.** Le sous-titre « Coût de revient actuel » est explicite et la nature temps-réel est cohérente avec l'usage métier d'une fiche recette.

**Corrections nécessaires : wording uniquement (3-4 micro-ajustements textuels sur Marchandise). Zéro changement de logique, zéro changement de code métier.**
