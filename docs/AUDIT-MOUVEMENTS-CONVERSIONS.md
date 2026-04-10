# Audit — Mouvements Indirects & Conversions d'Unités

> **Date** : 2026-03-11  
> **Scope** : Toutes les écritures `stock_events`, conversions d'unités, modules indirects  
> **Méthode** : Analyse code SQL + TypeScript + requêtes données production

---

## Section 1 — Mouvements stock identifiés

### 1.1 Fonctions SQL qui écrivent dans `stock_events`

| Fonction | Type d'écriture | Source `canonical_unit_id` |
|----------|----------------|--------------------------|
| `fn_post_stock_document` | INSERT direct | **Copie depuis `stock_document_lines.canonical_unit_id`** |
| `fn_void_stock_document` | INSERT inverse | Copie depuis l'event original (`-delta`, même `canonical_unit_id`) |

**Constat** : Seules 2 fonctions SQL écrivent dans `stock_events`. Tous les modules passent par `fn_post_stock_document` (via document DRAFT → POST).

### 1.2 Event types en production

| Type | Count | Description |
|------|-------|-------------|
| WITHDRAWAL | 526 | Retraits |
| RECEIPT | 428 | Réceptions |
| ADJUSTMENT | 184 | Ajustements (inventaire) |
| VOID | 135 | Annulations |
| INITIAL_STOCK | 46 | Stock initial |

### 1.3 Zéros suspects

**✅ Aucun delta = 0** détecté (hors INITIAL_STOCK). Le moteur est propre sur ce point.

---

## Section 2 — Conversions d'unités analysées

### 2.1 Architecture des conversions

- Table `unit_conversions` : facteurs bidirectionnels (A→B et B→A)
- Moteur TypeScript : `src/core/unitConversion/conversionEngine.ts`
  - Stratégie : Direct → Via référence (même famille) → null
- Les unités sont **per-establishment** (chaque établissement a ses propres UUID)

### 2.2 Cohérence des facteurs

| Vérification | Résultat |
|-------------|----------|
| Facteurs ≤ 0 ou > 100000 | **✅ Aucun** |
| Réciprocité (A×B = 1) | **✅ Toutes les paires sont réciproques** |
| Conversions inter-familles | **✅ Aucune** (weight↔volume interdit) |

### 2.3 Types de données (arrondis)

| Table | Colonne | Type |
|-------|---------|------|
| `stock_events` | `delta_quantity_canonical` | `numeric` (sans précision) |
| `stock_document_lines` | `delta_quantity_canonical` | `numeric` (sans précision) |
| `inventory_lines` | `quantity` | `numeric` (sans précision) |

**✅ Bon choix** : `numeric` sans précision = précision arbitraire, pas de perte par flottant.

Le code TypeScript utilise `Math.round(x * 10000) / 10000` (4 décimales) — cohérent avec le `ROUND(..., 4)` SQL.

---

## Section 3 — Modules indirects analysés

### 3.1 Réception fournisseur

- **Flux** : UI → `stock_document_lines` (DRAFT) → `fn_post_stock_document`
- **Source unit** : `buildCanonicalLine()` détermine `canonical_unit_id` depuis le produit
- **⚠️ Risque** : Si l'utilisateur change l'unité canonique du produit entre la création du DRAFT et le POST, le `canonical_unit_id` de la ligne sera l'ancien.

### 3.2 Retrait stock

- **Flux** : Identique — via `useWithdrawalDraft` → document DRAFT → POST
- **Source unit** : `buildCanonicalLine()` au moment de `addLine()`
- **Même risque** que réception.

### 3.3 Inventaire → Ajustement

- **Flux** : Session inventaire → `inventory_lines` → Réconciliation → document ADJUSTMENT → POST
- **Source unit** : L'inventaire écrit dans `inventory_lines.unit_id`, puis la réconciliation crée les lignes de document avec le `canonical_unit_id` du produit **au moment de la réconciliation**.

### 3.4 VOID (Annulation)

- **Flux** : `fn_void_stock_document` lit les events originaux et insère les inverses
- **Source unit** : Copie fidèle de l'event original → **✅ Correct** (même unité pour le delta inverse)

### 3.5 Commandes fournisseurs (expédition)

- **Flux** : `fn_ship_commande` → crée un `stock_document` + lignes → appelle `fn_post_stock_document`
- **Source unit** : Utilise `commande_lines.canonical_unit_id` qui est défini à la création de la commande

---

## Section 4 — 🔴 DONNÉES INCOHÉRENTES DÉTECTÉES

### 4.1 BUG P0 — 25 produits avec multi `canonical_unit_id` dans `stock_events`

**Gravité : P0 — Corruption du calcul de stock**

**25 produits** ont des `stock_events` avec des `canonical_unit_id` différents. Le `SUM(delta_quantity_canonical)` mélange des unités incompatibles.

#### Exemple concret — Produit `0380f27b`

| Unité | Abbr | Events POSTED | Total delta |
|-------|------|--------------|-------------|
| `252649a4` | pce | 16 | +19.0 |
| `c4905c17` | car (carton) | 6 | +12.5 |
| `abcfd4d7` | bte (boîte) | 1 | -2.0 |

**Stock calculé** : `snapshot_qty + 19 pce + 12.5 cartons - 2 boîtes = ???`

Le système additionne 19 + 12.5 - 2 = **29.5** comme si c'était la même unité. C'est **mathématiquement faux**.

#### Cause racine

1. L'utilisateur change l'unité canonique du produit (ex : pce → carton)
2. `fn_post_stock_document` copie `stock_document_lines.canonical_unit_id` tel quel (ligne 197)
3. Les anciens events restent en `pce`, les nouveaux en `carton`
4. `SUM(delta)` dans `useProductCurrentStock` (ligne 74) additionne tout sans conversion

#### Sous-catégories

| Catégorie | Produits | Gravité |
|-----------|----------|---------|
| Multi-unit **même famille** (ex: pce + carton = count) | 19 | P0 — convertible mais non converti |
| Multi-unit **familles différentes** (ex: kg + pce) | **6** | P0 CRITIQUE — non convertible |

### 4.2 Impact sur `useProductCurrentStock`

```typescript
// Ligne 71-76 — BUG: additionne des deltas d'unités différentes
let totalDelta = 0;
for (const evt of events ?? []) {
  totalDelta += evt.delta_quantity_canonical ?? 0; // ← mélange unités
}
```

Ce hook est utilisé par : `WithdrawalView`, `MobileWithdrawalView`, `MobileReceptionView`, `MobileInventoryView`, `BlRetraitCorrectionDialog`.

### 4.3 Impact sur `fn_post_stock_document`

Le calcul de stock négatif (step 9) utilise aussi un `SUM(delta)` brut (ligne 155-158) :

```sql
SUM(se.delta_quantity_canonical) AS total_delta
```

Ce SUM ne filtre PAS par `canonical_unit_id`. Si un produit a des events en pce et en cartons, le check négatif est **faux**.

### 4.4 Impact mitigé par l'inventaire

L'inventaire complet du 10 mars a **réinitialisé les snapshots**. Les events post-inventaire utilisent la **nouvelle** unité canonique. Cependant :

- Le `snapshot_version_id` filtre les events → seuls les events post-inventaire sont comptés
- **Si** l'utilisateur change encore l'unité d'un produit, le bug se reproduira

---

## Section 5 — Risques identifiés

| Priorité | Description | Impact | Modules affectés |
|----------|-------------|--------|-----------------|
| **P0** | Multi `canonical_unit_id` par produit dans `stock_events` | Stock calculé faux pour 25 produits | Tous (stock engine) |
| **P0** | `SUM(delta)` dans fn_post_stock_document ignore le multi-unit | Check négatif contourné | Réceptions, Retraits |
| **P0** | `useProductCurrentStock` mélange les unités | Stock affiché faux dans UI | WithdrawalView, ReceptionView |
| **P1** | Pas de garde SQL empêchant l'écriture multi-unit par produit | Récurrence garantie si changement d'unité | fn_post_stock_document |
| **P1** | 6 produits avec familles mixtes (weight+count) | Conversion impossible, stock incalculable | Stock engine |
| **P2** | `fn_void_stock_document` copie le `canonical_unit_id` original | Correct pour les voids mais perpétue le multi-unit historique | Voids |

---

## Section 6 — Recommandations (lecture seule — pas de refonte)

### Corrections minimales identifiées

1. **Garde SQL** : Ajouter une validation dans `fn_post_stock_document` qui vérifie que `stock_document_lines.canonical_unit_id` correspond à l'unité canonique actuelle du produit
2. **Migration données** : Pour les 19 produits avec multi-unit dans la même famille, convertir les anciens deltas vers l'unité actuelle
3. **6 produits inter-familles** : Nécessitent un inventaire de recalage manuel
4. **`useProductCurrentStock`** : Filtrer les events par `canonical_unit_id` du produit OU convertir

---

## Section 7 — Verdict

| Composant | État |
|-----------|------|
| Table `unit_conversions` | ✅ Sain — facteurs corrects, réciproques |
| `conversionEngine.ts` | ✅ Sain — logique correcte |
| `fn_post_stock_document` zone routing | ✅ Corrigé (per-product) |
| `fn_post_stock_document` unit routing | ⚠️ **P0 — copie l'unité de la ligne sans validation** |
| `fn_void_stock_document` | ✅ Correct (copie fidèle) |
| `useProductCurrentStock` | ⚠️ **P0 — SUM sans conversion** |
| Arrondis (numeric) | ✅ Sain |
| Delta = 0 parasites | ✅ Aucun |
| Données prod (25 produits) | 🔴 **P0 — stock faux si events pré-inventaire comptés** |
| Post-inventaire 10 mars | ✅ Les snapshots filtrent les anciens events → **impact atténué** |

### Conclusion

> **Le moteur de stock est fonctionnellement correct pour les mouvements courants** (1 produit = 1 unité fixe).  
>  
> **Le bug P0 se déclenche uniquement quand un utilisateur change l'unité canonique d'un produit après avoir déjà des mouvements stock.** L'inventaire du 10 mars atténue l'impact actuel, mais le bug est **latent et reproductible**.  
>  
> **Les conversions d'unités (unit_conversions + conversionEngine) sont saines** — le problème n'est pas dans les facteurs de conversion mais dans l'absence de conversion lors de l'écriture des events.
