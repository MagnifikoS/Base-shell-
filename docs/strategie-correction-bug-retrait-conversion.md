# STRATÉGIE DE CORRECTION — BUG CRITIQUE CONVERSION RETRAIT

---

## 1. Résumé exécutif

### Bug confirmé

Lorsqu'un salarié retire un produit dans une **unité de retrait** (ex : Sac) différente de l'**unité canonique** (ex : kg), la quantité saisie est écrite **telle quelle** dans le stock, sans conversion. Résultat : 1 sac retiré = 1 kg enlevé au lieu de 25 kg.

### Cause racine

Le popup retrait (`WithdrawalQuantityPopup`) utilise le moteur de conversion universel (`convertUnitsDB`) qui ne sait convertir qu'**au sein d'une même famille d'unités** (ex : kg → g). Une unité de conditionnement comme "Sac" appartient à la famille `packaging`, tandis que "kg" appartient à la famille `mass`. Le moteur retourne `null`, et un **fallback silencieux** traite alors la quantité brute comme canonique.

### Stratégie recommandée

**Correction chirurgicale en un seul point** : remplacer le bloc de conversion dans `WithdrawalQuantityPopup.handleConfirm` par une logique qui :

1. Détecte si l'unité de retrait et l'unité canonique sont identiques → pas de conversion
2. Sinon, tente d'abord le moteur universel (même famille)
3. Si échec, résout l'équivalence via `conditionnement_config.equivalence` du produit
4. Si échec, résout via `conditionnement_config.levels` du produit
5. Si aucun chemin ne fonctionne → **blocage dur**, aucune écriture

### Niveau de sécurité

**Maximum** — zéro fallback silencieux, zéro écriture sans conversion prouvée.

---

## 2. Point exact à corriger

### Où intervenir

**Fichier unique** : `src/modules/stockLedger/components/WithdrawalQuantityPopup.tsx`

**Fonction unique** : `handleConfirm` (lignes 114-147)

**Bloc précis** : le calcul de `canonicalQty` (lignes 118-136)

### Pourquoi c'est le bon point

Ce bloc est le **seul et unique endroit** où la quantité saisie par l'utilisateur dans l'unité de retrait est transformée en quantité canonique avant d'être transmise au parent (`onConfirm`). Tout ce qui se passe en aval (buildCanonicalLine, insert dans stock_document_lines, fn_post_stock_document) travaille déjà avec la valeur canonique fournie par ce point.

Le bug est donc **exclusivement dans la conversion amont**, pas dans l'écriture aval.

### Pourquoi ne pas élargir

- `buildCanonicalLine` fonctionne correctement — il ne fait que résoudre les métadonnées (famille, hash, label), pas la quantité
- `fn_post_stock_document` écrit correctement ce qu'on lui donne
- Le moteur de conversion universel (`convertUnitsDB`) fonctionne correctement pour son périmètre (intra-famille) — il ne faut pas le modifier
- Les autres modules (réception, inventaire, commandes) n'utilisent pas `WithdrawalQuantityPopup` — aucun risque de régression

### Point secondaire à corriger

**Même fichier**, le `useEffect` d'initialisation (lignes 74-90) fait la conversion inverse (canonique → unité de retrait) pour pré-remplir la quantité quand un retrait existant est édité. Ce bloc souffre du même problème et doit utiliser la même logique de résolution.

---

## 3. Stratégie de conversion recommandée

### Principe fondamental

L'unité de retrait est une **unité de conditionnement produit**. Sa relation avec l'unité canonique n'est pas une propriété universelle des unités (comme kg → g), mais une **propriété du produit** (1 sac de farine = 25 kg, 1 sac de sucre = 50 kg).

Cette relation est déjà modélisée dans le champ `products_v2.conditionnement_config` sous deux formes :

#### Forme A — `equivalence`
```json
{
  "equivalence": {
    "source_unit_id": "uuid-sac",
    "unit_id": "uuid-kg",
    "quantity": 25
  }
}
```
Signifie : 1 unité de `source_unit_id` = `quantity` unités de `unit_id`.

#### Forme B — `levels`
```json
{
  "levels": [
    {
      "type_unit_id": "uuid-sac",
      "contains_unit_id": "uuid-kg",
      "quantity": 25
    }
  ]
}
```
Signifie : 1 unité de `type_unit_id` contient `quantity` unités de `contains_unit_id`.

### Algorithme de résolution (pseudo-code, pas de code réel)

```
ENTRÉE : quantity (nombre saisi), withdrawal_unit_id, canonical_unit_id, product

SI withdrawal_unit_id == canonical_unit_id :
    → canonicalQty = quantity (pas de conversion)

SINON, ESSAYER dans l'ordre :

  ÉTAPE 1 — Moteur universel (même famille)
    résultat = convertUnitsDB(quantity, withdrawal_unit_id, canonical_unit_id)
    SI résultat != null → canonicalQty = résultat

  ÉTAPE 2 — Équivalence produit (conditionnement_config.equivalence)
    SI equivalence.source_unit_id == withdrawal_unit_id
       ET equivalence.unit_id == canonical_unit_id :
        → canonicalQty = quantity × equivalence.quantity

    SI equivalence.unit_id == withdrawal_unit_id
       ET equivalence.source_unit_id == canonical_unit_id :
        → canonicalQty = quantity / equivalence.quantity

  ÉTAPE 3 — Niveaux de conditionnement (conditionnement_config.levels)
    POUR chaque level :
      SI level.type_unit_id == withdrawal_unit_id
         ET level.contains_unit_id == canonical_unit_id :
          → canonicalQty = quantity × level.quantity

      SI level.contains_unit_id == withdrawal_unit_id
         ET level.type_unit_id == canonical_unit_id :
          → canonicalQty = quantity / level.quantity

  ÉTAPE 4 — ÉCHEC → BLOCAGE
    → Afficher un toast d'erreur explicite
    → NE PAS appeler onConfirm
    → NE PAS fermer le popup
    → L'utilisateur ne peut pas valider ce retrait
```

### Pourquoi cette stratégie est la bonne

1. **Pas de nouvelle source de vérité** — elle utilise `conditionnement_config` qui est déjà la référence pour le conditionnement produit dans tout le système
2. **Pas de modification du moteur universel** — `convertUnitsDB` reste intact, son périmètre (intra-famille) est respecté
3. **Cohérence avec le modèle existant** — `buildCanonicalLine` lit déjà `conditionnement_config` pour le context_hash, la conversion utilise la même source
4. **Localité** — toute la logique ajoutée reste dans le popup retrait, aucun autre module n'est impacté

### Données nécessaires

Le popup reçoit déjà les données du produit via `MobileWithdrawalView`, mais **ne reçoit pas actuellement `conditionnement_config`**. La correction nécessitera d'ajouter ce champ dans l'interface `WithdrawalProduct` et de le passer depuis `MobileWithdrawalView` (qui le charge déjà dans sa query).

---

## 4. Comportement de sécurité

### Cas : conversion impossible

**Situation** : le produit a une unité de retrait configurée, mais ni le moteur universel, ni l'équivalence, ni les levels ne permettent de résoudre la conversion.

**Comportement recommandé** :

1. Le bouton "Ajouter au retrait" reste **désactivé**
2. Un message d'erreur clair est affiché dans le popup : _"Conversion impossible : le conditionnement de ce produit n'est pas configuré pour [Sac → kg]. Contactez un administrateur."_
3. Aucune écriture n'est faite
4. Aucun toast d'erreur flashant — le message est inline, permanent, visible

### Cas : conditionnement incohérent

**Situation** : le produit a une équivalence définie mais les unités ne correspondent pas à l'unité de retrait ou à l'unité canonique.

**Même comportement** : blocage + message explicite.

### Cas : données absentes

**Situation** : `conditionnement_config` est `null` et les unités sont de familles différentes.

**Même comportement** : blocage + message explicite.

### Principe directeur

**Aucune quantité ne doit jamais être écrite dans le stock si elle n'a pas été convertie de manière prouvée.** Le système préfère bloquer un retrait plutôt que corrompre silencieusement le stock.

---

## 5. Analyse de non-régression

### Pourquoi la correction reste isolée

1. **Un seul fichier modifié** (`WithdrawalQuantityPopup.tsx`) + passage d'un champ supplémentaire depuis `MobileWithdrawalView.tsx`
2. **Aucun module externe touché** — ni réception, ni inventaire, ni commandes, ni BL, ni corrections
3. **Le moteur universel reste intact** — `convertUnitsDB` n'est pas modifié
4. **`buildCanonicalLine` reste intact** — il continue à recevoir la quantité canonique déjà convertie
5. **`fn_post_stock_document` reste intact** — il continue à écrire ce qu'on lui donne
6. **Le format d'écriture dans le ledger ne change pas** — même colonnes, même types, même sémantique

### Pourquoi les autres modules ne sont pas touchés

- La réception utilise `UniversalQuantityModal` → chemin séparé
- L'inventaire utilise son propre flow → chemin séparé  
- Les commandes utilisent leur propre logique → chemin séparé
- Le seul point commun est `buildCanonicalLine` qui n'est pas modifié

### Pourquoi le ledger reste cohérent

La correction ne change que la **valeur numérique** de `canonicalQuantity` passée à `onConfirm`. Tout le reste du pipeline (buildCanonicalLine → insert stock_document_lines → fn_post_stock_document → stock_events) reste identique. Le résultat est simplement un nombre correct (25 kg) au lieu d'un nombre incorrect (1 kg).

---

## 6. Gestion des données passées

### Le bug a-t-il pu corrompre des retraits existants ?

**Oui, potentiellement.** Tout retrait effectué avec une unité de retrait différente de l'unité canonique a pu écrire une quantité incorrecte dans le stock.

### Comment le confirmer

Requête d'audit recommandée (à exécuter séparément, après la correction) :

- Identifier tous les `stock_events` de type `WITHDRAWAL` où le produit associé a un `withdrawal_unit_id` différent de `stock_handling_unit_id`
- Vérifier si la quantité enregistrée correspond à la valeur brute (erreur) ou à la valeur convertie (correct)
- Croiser avec `conditionnement_config.equivalence` pour calculer l'écart

### Séparation des responsabilités

**Phase 1** (ce document) : Corriger le bug pour empêcher toute nouvelle corruption.

**Phase 2** (document séparé, après correction) : Auditer les données passées, quantifier l'écart, proposer une correction des soldes si nécessaire.

**Ne jamais mélanger les deux.** La correction du bug est prioritaire et urgente. L'audit des données passées est important mais ne doit pas retarder la correction.

---

## 7. Plan de validation post-correction

### Cas de test obligatoires

#### Cas 1 — Unité de retrait = unité canonique
- **Config** : produit en kg, retiré en kg
- **Action** : retirer 3 kg
- **Attendu** : stock diminué de 3 kg
- **Vérifie** : pas de régression sur le cas simple

#### Cas 2 — Conditionnement simple (masse)
- **Config** : produit canonique en kg, unité de retrait = Sac, équivalence 1 sac = 25 kg
- **Action** : retirer 1 sac
- **Attendu** : stock diminué de 25 kg
- **Vérifie** : la conversion cross-famille via equivalence fonctionne

#### Cas 3 — Conditionnement pièce
- **Config** : produit canonique en pièce, unité de retrait = Carton, level 1 carton = 12 pièces
- **Action** : retirer 2 cartons
- **Attendu** : stock diminué de 24 pièces
- **Vérifie** : la conversion via levels fonctionne

#### Cas 4 — Produit mal configuré
- **Config** : produit avec unité de retrait = Bidon, canonique = Litre, AUCUNE equivalence ni level configuré
- **Action** : tenter de retirer 1 bidon
- **Attendu** : bouton désactivé, message d'erreur affiché, AUCUNE écriture
- **Vérifie** : le blocage de sécurité fonctionne

#### Cas 5 — Produit sans unité de retrait
- **Config** : `withdrawal_unit_id` est null → fallback vers `stock_handling_unit_id`
- **Action** : retirer dans l'unité par défaut
- **Attendu** : comportement identique au MVP, pas de conversion nécessaire
- **Vérifie** : le fallback par défaut ne casse pas

#### Cas 6 — Pas fractionnaires
- **Config** : unité de retrait = Sac, équivalence 1 sac = 25 kg, pas de 0.5
- **Action** : retirer 0.5 sac
- **Attendu** : stock diminué de 12.5 kg
- **Vérifie** : les quantités fractionnaires sont correctement multipliées

### Preuves attendues

Pour chaque cas, vérifier :
1. La valeur de `canonicalQuantity` transmise par `onConfirm`
2. La valeur de `delta_quantity_canonical` écrite dans `stock_document_lines`
3. La valeur du `stock_event` généré par `fn_post_stock_document`
4. Le stock affiché après retrait

---

## 8. Verdict final

| Critère | Évaluation |
|---------|-----------|
| **Stratégie sûre ?** | ✅ Oui — blocage dur en cas d'échec, zéro fallback silencieux |
| **Locale ?** | ✅ Oui — un seul fichier de logique modifié, un champ ajouté au passage de données |
| **Trop large ?** | ❌ Non — aucun module externe touché, aucun moteur modifié |
| **Recommandée ?** | ✅ Oui — correction minimale, sécurité maximale |
| **Risque de régression ?** | ⚪ Très faible — le chemin simple (même unité) reste inchangé, les autres modules sont isolés |
| **Moteur universel respecté ?** | ✅ Oui — `convertUnitsDB` reste la première tentative, complété par la résolution produit spécifique |
| **Nouvelle source de vérité ?** | ❌ Non — utilise `conditionnement_config` qui est déjà la référence existante |

### Résumé en une phrase

> La correction consiste à enrichir le bloc de conversion du popup retrait avec la lecture de `conditionnement_config` (equivalence + levels) du produit, en gardant le moteur universel en première tentative et en remplaçant le fallback silencieux par un blocage dur.
