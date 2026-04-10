# Correction Conversion Retrait

## 1. Résumé exécutif

**Bug corrigé** : Lorsqu'un retrait était saisi dans une unité de conditionnement (ex: Sac) différente de l'unité canonique (ex: kg), la quantité brute était écrite directement dans le stock sans conversion. 1 Sac retirait 1 kg au lieu de 25 kg.

**Cause racine** : Le popup retrait utilisait `convertUnitsDB` (moteur intra-famille uniquement). Pour les conversions cross-famille (Sac → kg), ce moteur retournait `null`, et un `if (converted === null) { canonicalQty = quantity }` traitait silencieusement la quantité brute comme canonique.

**Correction** : Remplacement par `findConversionPath` du module conditionnementV2, qui utilise le graphe BFS complet (DB conversions + packaging levels + equivalence). Suppression totale du fallback silencieux. Hard block si aucun chemin de conversion n'existe.

**Bug fermé** : Oui.

---

## 2. Périmètre réellement modifié

### Fichiers modifiés

| Fichier | Nature du changement |
|---------|---------------------|
| `src/modules/stockLedger/components/WithdrawalQuantityPopup.tsx` | Réécriture de la logique de conversion (import `findConversionPath`, suppression `convertUnitsDB`, ajout hard block, ajout `conditionnement_config` à l'interface) |
| `src/modules/stockLedger/components/MobileWithdrawalView.tsx` | 1 ligne ajoutée : passage de `conditionnement_config` au popup via la prop `product` |

### Ce qui n'a PAS été modifié

- `UniversalQuantityModal` — inchangé
- `convertUnitsDB` / moteur global core — inchangé
- `findConversionPath` (conditionnementV2) — inchangé (consommé tel quel)
- `buildCanonicalLine` — inchangé
- `fn_post_stock_document` — inchangé
- `stock_events` / ledger — inchangé
- Réception, inventaire, commandes — inchangés
- Aucun nouveau fichier créé
- Aucune migration DB

---

## 3. Correction C1 — Validation

### Avant

```
handleConfirm:
  if (withdrawal_unit === canonical_unit) → pas de conversion
  else → convertUnitsDB(qty, withdrawal, canonical)
    if (null) → canonicalQty = quantity  ← FALLBACK SILENCIEUX DANGEREUX
  → onConfirm(canonicalQty)
```

1 Sac → `convertUnitsDB` retourne `null` (cross-famille) → `canonicalQty = 1` → écrit 1 kg.

### Après

```
resolveWithdrawalConversion (calculé en useMemo, une seule fois par produit):
  if (withdrawal_unit === canonical_unit) → factor = 1
  else → findConversionPath(withdrawal, canonical, dbUnits, dbConversions, packagingLevels, equivalence)
    if (reached) → factor = result.factor
    else → factor = null, error = "Conversion impossible : ..."

handleConfirm:
  if (factor === null) → BLOQUÉ, rien ne part
  else → canonicalQty = quantity × factor → onConfirm(canonicalQty)
```

1 Sac → `findConversionPath` traverse le graphe (Sac →[level: 1 Sac = 25 kg]→ kg) → factor = 25 → `canonicalQty = 25` → écrit 25 kg. ✅

### Hiérarchie de résolution

1. Identité (`withdrawal_unit_id === canonical_unit_id`) → factor = 1
2. `findConversionPath` qui construit un graphe BFS à partir de :
   - A) `unit_conversions` DB (conversions physiques intra-famille)
   - B) `packagingLevels` du produit (ex: 1 Sac = 25 kg)
   - C) `equivalence` du produit (ex: 1 Pièce = 200 g)
3. Si aucun chemin → **hard block** (factor = null, erreur affichée)

Le fallback silencieux `canonicalQty = quantity` a été **totalement supprimé**.

---

## 4. Correction C2 — Réouverture / édition

### Avant

```
useEffect (open):
  if existingQuantity:
    converted = convertUnitsDB(existingQty, canonical, withdrawal)
    setQuantity(converted ?? existingQuantity)  ← FALLBACK : affiche en canonical
```

Pour un existant de 25 kg avec unité retrait Sac : `convertUnitsDB` retournait `null` → affichait 25 (en "Sac") au lieu de 1 Sac.

### Après

```
useEffect (open):
  if existingQuantity AND conversion.factor:
    setQuantity(existingQuantity / conversion.factor)  ← inverse du même factor
```

25 kg ÷ 25 (factor Sac→kg) = 1 → affiche correctement "1 Sac". Le même factor pré-calculé en `useMemo` est réutilisé, garantissant la cohérence aller-retour.

---

## 5. Sécurité

### Si aucune conversion n'est possible

1. `conversion.error` est non-null
2. Un bandeau rouge `AlertTriangle` s'affiche : « Conversion impossible : Sac → Kilogramme. Vérifiez le conditionnement du produit. »
3. Le bouton affiche « Conversion impossible » et est `disabled`
4. Les chips de quantité sont masquées
5. Les boutons +/- sont désactivés
6. `handleConfirm` refuse de s'exécuter (`if (!canConfirm)`)
7. **Aucun appel `onConfirm` ne part** → aucun `addLine` → aucun `POST` → aucun mouvement stock

### Corruption impossible

Le seul chemin vers `onConfirm` passe par `canConfirm = quantity > 0 && conversion.factor !== null`. Sans factor prouvé, le code ne peut physiquement pas appeler `onConfirm`.

---

## 6. Vérification anti-régression

| Composant / Module | Modifié ? |
|---------------------|-----------|
| `UniversalQuantityModal` | ❌ Non |
| `convertUnitsDB` (core) | ❌ Non |
| `findConversionPath` (conditionnementV2) | ❌ Non (consommé, pas modifié) |
| `buildCanonicalLine` | ❌ Non |
| Réception | ❌ Non |
| Inventaire | ❌ Non |
| Commandes | ❌ Non |
| Ledger / stock_events | ❌ Non |
| Backend (edge functions) | ❌ Non |
| `fn_post_stock_document` | ❌ Non |

---

## 7. Scénarios avant / après

### Scénario 1 — Unité retrait = unité canonique

- Produit : Sel, stock en kg, retrait en kg
- `withdrawal_unit_id === canonical_unit_id` → factor = 1
- 2 kg retiré → 2 kg écrit ✅
- **Comportement inchangé**

### Scénario 2 — Conditionnement simple (levels)

- Produit : Farine, stock en kg, retrait en Sac
- `conditionnement_config.levels` = `[{ type_unit_id: "uuid-sac", contains_unit_id: "uuid-kg", quantity: 25 }]`
- `findConversionPath("uuid-sac", "uuid-kg")` → factor = 25
- 1 Sac retiré → 25 kg écrit ✅

### Scénario 3 — Conditionnement via levels (pièces)

- Produit : Yaourts, stock en Pièce, retrait en Carton
- `conditionnement_config.levels` = `[{ type_unit_id: "uuid-carton", contains_unit_id: "uuid-pce", quantity: 12 }]`
- `findConversionPath("uuid-carton", "uuid-pce")` → factor = 12
- 1 Carton retiré → 12 pièces écrit ✅

### Scénario 4 — Aucune conversion possible

- Produit mal configuré : retrait en Bidon, stock en kg, aucun level ni equivalence
- `findConversionPath` → `reached: false`
- Bandeau erreur affiché, bouton désactivé
- **Aucun mouvement stock** ✅

### Scénario 5 — Réédition d'une ligne existante

- Produit : Farine, existingQuantity = 50 (kg canonical)
- factor = 25 → `50 / 25 = 2` → popup affiche "2 Sac" ✅
- Utilisateur modifie à 3 → `3 × 25 = 75` kg écrit ✅

---

## 8. Preuves de non-bricolage

- **Fichiers modifiés** : exactement 2 (`WithdrawalQuantityPopup.tsx`, `MobileWithdrawalView.tsx`)
- **Aucun nouveau chemin global de conversion créé** : la fonction `findConversionPath` du module `conditionnementV2` est consommée telle quelle, sans modification
- **Aucun module hors scope touché** : grep confirmé — réception, inventaire, commandes, modal global, moteur core tous inchangés
- **Correction non élargie** : strictement limitée au popup retrait et à son appel dans `MobileWithdrawalView`

---

## 9. Données passées

- **Des retraits passés ont pu être corrompus** : tout retrait effectué avec une unité de retrait ≠ unité canonique avant cette correction a potentiellement écrit une quantité brute au lieu de la quantité convertie
- **Cette mission ne corrige pas l'historique** : seul le flow prospectif est corrigé
- **Un audit séparé est nécessaire** pour identifier et éventuellement corriger les mouvements stock historiques corrompus

---

## 10. Verdict final

| Critère | Statut |
|---------|--------|
| Bug fermé | ✅ Oui |
| Correction safe | ✅ Oui |
| Périmètre respecté | ✅ Oui — 2 fichiers, 0 module hors scope |
| Fallback silencieux supprimé | ✅ Oui — totalement |
| Hard block implémenté | ✅ Oui — UI + logique |
| Moteur global inchangé | ✅ Oui |
| Backend inchangé | ✅ Oui |
