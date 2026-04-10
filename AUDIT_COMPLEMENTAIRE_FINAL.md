# AUDIT COMPLÉMENTAIRE FINAL — Points non couverts (Stratégie Unité Fournisseur V1)

> Audit croisé avec le code réel — Produits neufs uniquement — Zéro legacy

---

## 1. CAS LIMITE — CONDITIONNEMENT NON STANDARD

### 1.1 `containsQuantity = null` ou `contains_unit_id = null`

**Code vérifié** : `conversionGraph.ts` ligne 131 :
```typescript
if (!typeId || !containsId || !qty || qty <= 0) continue;
```

**Comportement** : Le niveau de packaging est **silencieusement ignoré** dans le graphe BFS. Aucune arête n'est créée. Cela signifie :
- Si `packagingLevels[0]` a `containsQuantity = null` → le niveau 0 n'a **aucune arête BFS**
- L'unité `type_unit_id` existe dans le référentiel mais est **isolée** dans le graphe
- Le résolveur la verra comme **non-atteignable** si elle n'a pas d'autre chemin
- **Résultat** : `needs_review` ou `not_configured` → modal **bloqué**

**Validation wizard** : `wizardGraphValidator.ts` ligne 81 et `engine.ts` ligne 88 détectent bien `containsQuantity === null` et génèrent un warning. Donc le wizard **empêche** la création d'un produit avec ce cas.

✅ **Verdict** : Pas de risque pour un produit neuf créé via wizard. Le wizard bloque avant.

### 1.2 Incohérence `supplier_billing_unit_id` vs `packagingLevels[0].type_unit_id`

**Analyse code** : Le résolveur `resolveInputUnitForContext.ts` ne lit **jamais** directement `packagingLevels[0].type_unit_id` pour décider l'unité. Il lit `config.reception_preferred_unit_id` (DB statique).

Dans la stratégie cible (dérivation dynamique), l'unité fournisseur sera tirée de `packagingLevels[0].type_unit_id`.

**Source de vérité** : 
- `supplier_billing_unit_id` = vérité **commerciale** (facturation)
- `packagingLevels[0].type_unit_id` = vérité **logistique** (conditionnement physique)
- Ces deux **peuvent légitimement différer** (ex: facturé au kg, livré en carton)

⚠️ **RISQUE IDENTIFIÉ** : Si on dérive l'unité fournisseur UNIQUEMENT de `packagingLevels[0]`, on ignore le cas où le fournisseur facture en kg mais livre en carton. Pour la V1 (produits neufs simples), ce cas est rare mais possible.

**Mitigation** : Le wizard V3 aligne déjà ces deux valeurs pour les produits simples. Le risque n'existe que pour les produits avec logique de prix variable (variable_weight), qui sont hors scope V1.

---

## 2. DIRECT CALLS AU RÉSOLVEUR — LISTE EXHAUSTIVE

### 2.1 Appels DIRECTS à `resolveInputUnitForContext` (hors QuantityModalWithResolver)

| # | Fichier | Ligne | Contexte passé | Passe par le routage `toInputContext` ? |
|---|---------|-------|-----------------|----------------------------------------|
| 1 | `MobileReceptionView.tsx` | 987 | `"reception"` ❤️ | ❌ NON — appel direct, pas de `toInputContext` |
| 2 | `MobileWithdrawalView.tsx` | 602 | `"internal"` | ❌ NON — appel direct |
| 3 | `useCountingModal.ts` | ~20 | `"internal"` | ❌ NON — appel direct |
| 4 | `useSaveInputConfig.ts` | 95 | `"reception"` + `"internal"` (validation) | ❌ NON — appel direct |

### 2.2 Appels via `QuantityModalWithResolver` (passent par `toInputContext`)

| # | Fichier | contextType passé | Résultat `toInputContext` |
|---|---------|-------------------|--------------------------|
| 1 | `ReceptionView.tsx` | `"reception"` | → `"reception"` ✅ |
| 2 | `WithdrawalView.tsx` | `"withdrawal"` | → `"internal"` ✅ |
| 3 | `NouvelleCommandeDialog.tsx` | `"order"` | → `"internal"` ⚠️ **PROBLÈME** |
| 4 | `CommandeDetailDialog.tsx` | `"order"` | → `"internal"` ⚠️ **PROBLÈME** |
| 5 | `PreparationDialog.tsx` | `"order"` | → `"internal"` ⚠️ **PROBLÈME** |
| 6 | `BlAppCorrectionDialog.tsx` | `"correction"` | → `"internal"` ✅ |
| 7 | `BlRetraitCorrectionDialog.tsx` | `"correction"` | → `"internal"` ✅ |
| 8 | `InventoryProductDrawer.tsx` | `"inventory"` | → `"internal"` ✅ |
| 9 | `MobileInventoryView.tsx` | `"inventory"` | → `"internal"` ✅ |

### 2.3 Appels DIRECTS à `UniversalQuantityModal` (sans QuantityModalWithResolver)

| # | Fichier | Résolveur utilisé | Bypass ? |
|---|---------|-------------------|----------|
| 1 | `MobileReceptionView.tsx` | `resolveInputUnitForContext` direct | ⚠️ Pas de `toInputContext` mais passe `"reception"` directement — **OK** |
| 2 | `MobileWithdrawalView.tsx` | `resolveInputUnitForContext` direct | ⚠️ Passe `"internal"` directement — **OK** |

**Verdict** : Les 2 appels directs mobile passent le bon contexte en dur. Pas de bypass de logique.

### 2.4 CONCLUSION CRITIQUE

**3 fichiers** passent `contextType="order"` qui est routé vers `"internal"` via `toInputContext`. C'est le point de modification central pour la stratégie V1 :
```typescript
// ACTUEL
function toInputContext(ct: QuantityContextType): InputContext {
  return ct === "reception" ? "reception" : "internal";
}

// CIBLE
function toInputContext(ct: QuantityContextType): InputContext {
  return (ct === "reception" || ct === "order") ? "reception" : "internal";
}
```

**Mais attention** : `PreparationDialog.tsx` est côté **fournisseur**. Quand le fournisseur prépare, il utilise **son propre** produit (pas le produit importé du client). Donc `"order"` → `"reception"` est correct pour le fournisseur aussi, car il prépare dans son unité fournisseur.

---

## 3. PERFORMANCE — DÉRIVATION DYNAMIQUE

### 3.1 Données déjà en mémoire ?

- **`product_input_config`** : Chargé en bulk par `useProductInputConfigs()` avec `staleTime: 60_000` (1 min). → **En mémoire** ✅
- **`conditionnement_config`** : Fait partie du `select` produit dans chaque flow. → **Déjà chargé** ✅
- **`dbUnits` + `dbConversions`** : Chargés par `useUnitConversions()` avec cache React Query. → **En mémoire** ✅

### 3.2 Refetch nécessaire ?

NON. La dérivation utilise `product.conditionnement_config` (déjà dans le produit chargé) + `dbUnits` (en cache). Aucun refetch supplémentaire.

### 3.3 Risque de latence sur listes ?

Le résolveur est **synchrone** (pur calcul BFS en mémoire). Même avec 50 produits, chaque appel BFS est O(n) avec n = nombre d'unités (typiquement < 10). **Aucun risque de latence**.

Le seul coût est le `useMemo` dans `QuantityModalWithResolver` qui recalcule à chaque changement de produit — mais c'est un calcul < 1ms.

---

## 4. SYNCHRONISATION TOGGLE `allow_unit_sale`

### 4.1 Les modals relisent-ils la donnée produit à chaque ouverture ?

**Flux QuantityModalWithResolver** (9 flows desktop) :
- Le `product` est passé en **prop**
- Le `resolved` est dans un `useMemo` avec `[product, inputConfigs, contextType, dbUnits, dbConversions]` comme deps
- Si le produit change → recalcul ✅
- Si `inputConfigs` change (React Query refetch) → recalcul ✅

**Flux Mobile (2 flows)** :
- Calcul inline dans le JSX à chaque render → toujours frais ✅

### 4.2 Cas critique : toggle changé pendant que le modal est ouvert

**Scénario** : User A change le toggle `allow_unit_sale` → User B a déjà un modal ouvert.

- `inputConfigs` a un `staleTime: 60_000`. Le changement ne sera visible qu'après 1 min ou re-focus fenêtre.
- **Mais** : dans la stratégie cible, `allow_unit_sale` sera sur `products_v2`, pas dans `product_input_config`. Les produits ne sont pas re-fetchés en temps réel.
- **Impact réel** : L'utilisateur voit l'ancienne configuration jusqu'au prochain chargement de page. **Non destructif** — la quantité saisie reste convertible.

⚠️ **Risque faible** : incohérence temporaire d'affichage (ex: 2 niveaux au lieu de 1). Pas de corruption de données.

**Mitigation** : Acceptable pour V1. En V2, on peut ajouter un invalidation React Query sur update du toggle.

---

## 5. FLOW UI COMPLET — PRODUIT NEUF

### Scénario : Burrata (Carton → Boîte → Pièce → 125g)

| Étape | Action | Résolveur | Config requise ? | Résultat |
|-------|--------|-----------|------------------|----------|
| 1. Wizard | Création produit | N/A | Le wizard crée `product_input_config` à l'étape 4 | ✅ Config créée |
| 2. Réception desktop | `contextType="reception"` | `toInputContext → "reception"` | Lit `config.reception_*` | ✅ OK |
| 3. Commande B2B | `contextType="order"` | `toInputContext → "internal"` ⚠️ | Lit `config.internal_*` | ⚠️ **PROBLÈME** — devrait lire réception |
| 4. Préparation | `contextType="order"` | `toInputContext → "internal"` ⚠️ | Lit `config.internal_*` | ⚠️ **PROBLÈME** — même souci |
| 5. Réception client B2B | `contextType="reception"` | `toInputContext → "reception"` | Lit `config.reception_*` | ✅ OK |

**Verdict** : Étapes 3 et 4 nécessitent la correction de `toInputContext` pour router `"order"` → `"reception"`.

### Risque `not_configured` ?

- Pour un produit neuf via wizard : **NON** — le wizard oblige la config à l'étape 4.
- Pour un produit importé B2B : **OUI** ⚠️ — `fn_import_b2b_product_atomic` ne crée PAS de `product_input_config`. Le produit importé sera **bloqué** dans tous les modals.

---

## 6. IMPACT SUR VALIDATION EXISTANTE

### 6.1 Conditions qui bloquent un produit neuf

| Condition | Fichier | Impact |
|-----------|---------|--------|
| `config === null` | `resolveInputUnitForContext.ts:154` | → `not_configured` → modal bloqué |
| `!preferredMode \|\| !preferredUnitId` | `resolveInputUnitForContext.ts:249` | → `not_configured` → modal bloqué |
| `!reachableIds.has(preferredUnitId)` | `resolveInputUnitForContext.ts:262` | → `needs_review` → modal bloqué |
| `unitChain.length < 2` (multi_level) | `resolveInputUnitForContext.ts:181` | → `needs_review` → modal bloqué |
| `unitChain has duplicates` | `resolveInputUnitForContext.ts:194` | → `needs_review` → modal bloqué |
| `unitChain has unreachable units` | `resolveInputUnitForContext.ts:207` | → `needs_review` → modal bloqué |

### 6.2 Pour un produit wizard neuf

Le wizard V3 valide la config via `computeConfigStatusFromChoices` avant de sauvegarder. Tous les gardes ci-dessus sont satisfaits. → **Aucun blocage**.

### 6.3 Pour un produit importé B2B

Pas de `product_input_config` → condition 1 atteinte → **BLOQUÉ**.

---

## 7. CAS MULTI-OUVERTURE MODAL

### 7.1 Le résolveur est-il recalculé à chaque ouverture ?

**QuantityModalWithResolver** :
```typescript
const resolved = useMemo(() => {
  if (!product) return null;
  const config = inputConfigs.get(product.id) ?? null;
  return resolveInputUnitForContext(product, toInputContext(contextType), config, dbUnits, dbConversions);
}, [product, inputConfigs, contextType, dbUnits, dbConversions]);
```

- Quand le modal **se ferme** : `product` passe à `null` → `resolved = null`
- Quand le modal **se rouvre** avec un nouveau produit : `product` change → recalcul ✅
- Quand le modal **se rouvre** avec le **même** produit : `product` est le même objet référence → **pas de recalcul** (mémoïsé)

⚠️ **Cas subtil** : Si la config a été modifiée entre deux ouvertures mais que `inputConfigs` n'a pas été re-fetché (staleTime 60s), le modal utilise l'ancienne config. Non destructif mais potentiellement confus.

### 7.2 Flux mobile (appel direct)

Calcul inline dans le JSX → **toujours recalculé** à chaque render. Pas de risque de stale.

---

## 8. EDGE CASE — PRODUIT SANS PACKAGING

### Simulation : `packagingLevels = []`

**Graphe BFS** : Aucune arête packaging. Seules les conversions physiques globales (kg↔g, L↔ml) existent.

**Unités atteignables** : `stock_handling_unit_id` + conversions physiques classiques.

**Dérivation unité fournisseur** : `packagingLevels[0]` → `undefined` → **pas d'unité fournisseur dérivable**.

**Impact sur le résolveur actuel** : Le résolveur lit `config.reception_preferred_unit_id` (DB). Si la config est correcte, tout fonctionne normalement.

**Impact sur la stratégie cible** : Si on dérive dynamiquement de `packagingLevels[0]`, un produit sans packaging retournera `undefined`. Il faut un **garde explicite**.

**Comportement attendu** :
- Pour produit sans packaging : l'unité fournisseur = `stock_handling_unit_id` ou `final_unit_id`
- Message clair : pas de conditionnement → mode simple
- Le modal doit fonctionner en mode `integer` ou `continuous` sur l'unité canonique

⚠️ **RISQUE** : Si la dérivation retourne `undefined` sans garde, le modal sera bloqué (`needs_review`).

**Mitigation** : Garde `if (!packagingLevels?.length) return stock_handling_unit_id ?? final_unit_id`.

---

## 9. CONSISTANCE CLIENT / FOURNISSEUR (B2B)

### 9.1 Même unité fournisseur ?

**Côté fournisseur** : Le produit source a son propre `conditionnement_config` avec `packagingLevels[0].type_unit_id`.

**Côté client** : Le produit importé a un `conditionnement_config` synchronisé via `fn_import_b2b_product_atomic`, avec remappage des UUID d'unités via `unit_mapping`.

**Vérification** : `b2bCatalogService.ts` ligne 101 :
```typescript
p_conditionnement_config: (params.conditionnement_config ?? null)
```

Le `conditionnement_config` est copié tel quel, et le `unit_mapping` remappe les UUID. Donc `packagingLevels[0].type_unit_id` côté client pointe vers l'**unité locale équivalente** à celle du fournisseur.

✅ **Les deux côtés utilisent la même structure logique** — seuls les UUID diffèrent (remappés).

### 9.2 Recalcul local ?

Aucun. Le client utilise la structure importée. Pas de recalcul.

⚠️ **Risque de désynchronisation** : Si le fournisseur modifie son conditionnement après import, le produit client reste figé. Ce risque est déjà documenté et accepté (pas de re-sync automatique en V1).

---

## 10. TESTS MINIMUM À PRÉVOIR

### Test 1 : Produit neuf simple (wizard → réception)
1. Créer un produit via wizard avec 2 niveaux (carton → pièce)
2. Configurer la réception en `multi_level` à l'étape 4
3. Ouvrir une réception manuelle
4. **Vérifier** : le modal propose carton + pièce, pas d'erreur, conversion correcte

### Test 2 : Commande B2B (après correction `toInputContext`)
1. Créer un partenariat B2B
2. Importer un produit (avec `product_input_config` ajouté au pipeline)
3. Créer une commande côté client
4. **Vérifier** : le modal utilise l'unité fournisseur, pas l'unité interne
5. Côté fournisseur : préparer la commande
6. **Vérifier** : même unité fournisseur

### Test 3 : Produit importé B2B → modal non bloqué
1. Importer un produit B2B
2. Ouvrir immédiatement un modal de réception
3. **Vérifier** : PAS de message "Produit non configuré"
4. Le modal doit être fonctionnel immédiatement

---

## SYNTHÈSE DES RISQUES (PRODUITS NEUFS UNIQUEMENT)

| # | Risque | Gravité | Probabilité | Impact | Mitigation |
|---|--------|---------|-------------|--------|------------|
| 1 | `toInputContext` route `"order"` → `"internal"` au lieu de `"reception"` | 🔴 Critique | 100% | Commandes B2B en mauvaise unité | Modifier `toInputContext` : `order` → `"reception"` |
| 2 | Import B2B ne crée pas `product_input_config` | 🔴 Critique | 100% | Tous les modals bloqués pour produits importés | Ajouter création auto dans le pipeline d'import |
| 3 | Produit sans packaging → dérivation retourne `undefined` | 🟡 Moyen | Faible (wizard valide) | Modal bloqué si un tel produit existe | Garde fallback vers `stock_handling_unit_id` |
| 4 | Toggle changé pendant modal ouvert | 🟢 Faible | Rare | Affichage stale temporaire | Acceptable V1, invalidation React Query en V2 |
| 5 | `staleTime: 60s` sur `inputConfigs` | 🟢 Faible | Rare | Config stale si modifiée juste avant | Acceptable V1 |
| 6 | `PreparationDialog` utilise le produit du fournisseur | 🟢 Info | N/A | Le routage `order → reception` est aussi correct pour le fournisseur | Aucune — comportement souhaité |

---

## VALIDATION FINALE

### La stratégie est-elle implémentable sans fallback legacy ?

**OUI**, sous réserve de résoudre les 2 points critiques :
1. **Correction `toInputContext`** — 1 ligne de code
2. **Ajout `product_input_config` dans le pipeline d'import B2B** — extension de `fn_import_b2b_product_atomic`

### Est-elle cohérente avec le code actuel ?

**OUI**. L'architecture est déjà en place :
- Résolveur centralisé ✅
- UQM passif ✅  
- Séparation `reception` / `internal` ✅
- BFS en mémoire ✅
- Wizard crée la config ✅

### Reste-t-il un point bloquant avant implémentation ?

**NON**, les 2 points critiques sont des modifications mineures et bien délimitées. Le chantier peut démarrer.
