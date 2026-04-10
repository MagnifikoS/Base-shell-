# ÉTAPE 1 — Rapport d'Audit SSOT Unités

> Date : 2026-03-28
> Statut : ⛔ BLOQUÉ — Incohérences critiques détectées

---

## 1. Résumé exécutif

L'audit code croisé avec le prompt montre que **le prompt ne peut pas être implémenté tel quel** sans casser l'application. La table `product_input_configs` référencée comme cible de migration **n'existe pas** dans le codebase ni en base de données.

Les colonnes legacy (`withdrawal_unit_id`, `withdrawal_steps`, `withdrawal_default_step`) ne sont **pas** une deuxième source de vérité pour les conversions — elles sont des **préférences UX** consommées en lecture seule. La conversion passe toujours par le moteur BFS (`findConversionPath`).

---

## 2. Audit du code réel

### 2.1 — Ce qui fonctionne déjà correctement ✅

| Composant | Source d'unité | Conversion | Verdict |
|-----------|---------------|------------|---------|
| `SimpleQuantityPopup` | reçoit `input_unit_id` en prop | `findConversionPath` (BFS) | ✅ Safe |
| `WithdrawalQuantityPopup` | reçoit `withdrawal_unit_id` en prop | `findConversionPath` (BFS) | ✅ Safe |
| `MobileReceptionView` | `delivery_unit_id` | `findConversionPath` (BFS) | ✅ Safe |
| `buildCanonicalLine` | `conditionnement_config` | BFS | ✅ Safe |
| `resolveProductUnitContext` | `conditionnement_config` + BFS | Resolver central unique | ✅ SSOT |

### 2.2 — Rôle réel des colonnes legacy

Les 3 colonnes sur `products_v2` ne sont PAS une source de vérité pour les unités/conversions :

| Colonne | Rôle réel | Impact conversion |
|---------|-----------|-------------------|
| `withdrawal_unit_id` | **Préférence UX** : quelle unité afficher par défaut dans le popup retrait | ❌ Aucun — la conversion BFS est indépendante |
| `withdrawal_steps` | **Chips UX** : valeurs rapides `[0.25, 0.5, 1]` pour les boutons | ❌ Aucun |
| `withdrawal_default_step` | **Incrément UX** : valeur du bouton +/- | ❌ Aucun |

### 2.3 — Chaîne de résolution dans MobileWithdrawalView (ligne 564)

```typescript
const wUnitId = modalProduct.withdrawal_unit_id 
  ?? modalProduct.stock_handling_unit_id 
  ?? modalProduct.final_unit_id;
```

Cette chaîne détermine **quelle unité afficher** dans le popup, pas comment convertir. Si `withdrawal_unit_id` pointe vers une unité sans chemin BFS vers canonical → le popup affiche "Conversion impossible" et **bloque** (hard block). Sécurité déjà en place.

### 2.4 — Fichiers qui lisent les colonnes legacy

| Fichier | Usage | Risque |
|---------|-------|--------|
| `MobileWithdrawalView.tsx` (L64-68, L144, L564-569) | Lecture pour construire `SimpleQuantityProduct` | ⚠️ UX preference, pas conversion |
| `MobileReceptionView.tsx` (L85-87, L187, L956-958) | Lecture pour popup réception | ⚠️ Idem |
| `WithdrawalUnitConfigPopover.tsx` (L103-108) | **Écriture** des colonnes legacy | ⚠️ Source de la config |
| `productsV2Service.ts` (L57-60, L123-126) | Lecture pour le catalogue produits | ⚠️ Propagation |
| `ProductsV2Table.tsx` (L388-393) | Passage au ConfigPopover | ⚠️ UI admin |
| `useWithdrawalHistory.ts` (L124-131) | Lecture pour l'historique | ⚠️ Affichage |

---

## 3. Incohérences du prompt vs réalité

### 3.1 — `product_input_configs` n'existe pas

```
Recherche "product_input_configs" → 0 résultats dans tout le codebase
Recherche "product_input_configs" → 0 résultats dans types.ts (schéma DB)
```

**Impact** : Impossible de migrer vers une table inexistante. Créer cette table nécessiterait :
- Migration SQL (CREATE TABLE + RLS)
- Script de migration des données existantes
- Nouveau service/hook de lecture
- Adaptation de tous les fichiers listés en §2.4

### 3.2 — `resolveProductUnitContext` ne couvre pas les steps

Le resolver fournit :
- ✅ `canonicalInventoryUnitId` — unité canonique
- ✅ `allowedInventoryEntryUnits` — unités atteignables avec facteurs BFS
- ✅ `allowedPriceDisplayUnits` — unités prix
- ❌ **Aucune notion de steps** (chips rapides)
- ❌ **Aucune notion de default_step** (incrément +/-)
- ❌ **Aucune notion de preferred withdrawal unit** (unité par défaut)

### 3.3 — Les colonnes legacy ne créent pas de divergence de conversion

La conversion est **toujours** calculée par `findConversionPath` dans `SimpleQuantityPopup` (L96-153). Les colonnes legacy déterminent uniquement :
- L'unité d'**affichage** (pas de calcul)
- Les **chips** visuels (pas de calcul)
- L'**incrément** des boutons +/- (pas de calcul)

---

## 4. Tableau des risques — Implémentation telle que demandée

| Action demandée | Risque | Niveau | Détail |
|-----------------|--------|--------|--------|
| Utiliser `product_input_configs` | **Table inexistante** → crash runtime | 🔴 CRITIQUE | 0 match dans le code |
| Supprimer lecture `withdrawal_unit_id` | Popup ne sait plus quelle unité afficher | 🔴 CRITIQUE | Fallback sur canonical = changement UX |
| Supprimer `withdrawal_steps` | Plus de chips rapides | 🟡 MOYEN | UX dégradée |
| Supprimer `withdrawal_default_step` | Plus d'incrément configuré | 🟡 MOYEN | Fallback à 1 partout |
| Utiliser resolver pour les steps | **Resolver ne fournit pas de steps** | 🔴 INCOHÉRENT | Architecture mismatch |
| Fallback via resolver si inputConfig absent | `inputConfig` n'existe nulle part | 🔴 CRITIQUE | Variable inexistante |

---

## 5. Ce qui est VRAI dans le prompt ✅

| Affirmation | Statut | Preuve |
|-------------|--------|--------|
| `conditionnement_config` est la source principale | ✅ Confirmé | Utilisé par BFS, `buildCanonicalLine`, `resolveProductUnitContext` |
| Le BFS est le moteur central | ✅ Confirmé | `findConversionPath` dans tous les popups |
| `resolveProductUnitContext` est le resolver unique | ✅ Confirmé | 503 lignes, couvre inventaire/prix/wizard |
| MobileWithdrawalView lit des colonnes legacy | ✅ Confirmé | Lignes 64-68, 144, 564-569 |

## 6. Ce qui est FAUX dans le prompt ❌

| Affirmation | Statut | Réalité |
|-------------|--------|---------|
| Les colonnes legacy créent une 2e source de vérité | ❌ Faux | Elles sont des préférences UX, la conversion est BFS |
| `product_input_configs` existe | ❌ Faux | 0 résultats dans le code et le schéma DB |
| Le resolver peut remplacer les steps | ❌ Faux | Il ne fournit pas de steps/incréments |

---

## 7. Options d'implémentation sûres

### Option A — Nettoyage minimal (0 risque, 30 min)

- [ ] Supprimer `WithdrawalQuantityPopup.tsx` (mort — remplacé par `SimpleQuantityPopup`)
- [ ] Fixer les deep imports (`findConversionPath` via module index)
- [ ] Ajouter commentaires SSOT sur les colonnes legacy

**Avantage** : Zéro risque de régression
**Inconvénient** : Les colonnes legacy restent

### Option B — Migration complète (nécessite DB, ~2h)

1. Créer table `product_input_configs` (migration SQL + RLS)
2. Migrer les données des 3 colonnes legacy
3. Créer hook `useProductInputConfig`
4. Adapter `MobileWithdrawalView` et `MobileReceptionView`
5. Adapter `WithdrawalUnitConfigPopover` pour écrire dans la nouvelle table
6. Fallback temporaire sur colonnes legacy pendant la transition

**Avantage** : SSOT complet
**Inconvénient** : Scope significatif, risque de régression sur mobile

---

## 8. Recommandation

**Option A immédiate** (nettoyage safe) + **Option B planifiée** (avec création DB préalable).

Ne PAS implémenter le prompt tel quel — il casserait l'app en production.

---

## 9. Fichiers audités

| Fichier | Lignes | Verdict |
|---------|--------|---------|
| `src/modules/stockLedger/components/MobileWithdrawalView.tsx` | 594 | ⚠️ Lit colonnes legacy pour UX |
| `src/modules/stockLedger/components/SimpleQuantityPopup.tsx` | 331 | ✅ Conversion BFS correcte |
| `src/modules/stockLedger/components/WithdrawalQuantityPopup.tsx` | 314 | 🗑️ Mort — jamais importé |
| `src/modules/stockLedger/components/MobileReceptionView.tsx` | ~1000 | ⚠️ Lit colonnes legacy pour UX |
| `src/modules/produitsV2/components/WithdrawalUnitConfigPopover.tsx` | ~110 | ⚠️ Écrit colonnes legacy |
| `src/modules/produitsV2/services/productsV2Service.ts` | ~130 | ⚠️ Lit colonnes legacy |
| `src/modules/stockLedger/hooks/useWithdrawalHistory.ts` | ~200 | ⚠️ Lit colonnes legacy |
| `src/core/unitConversion/resolveProductUnitContext.ts` | 503 | ✅ SSOT resolver |
