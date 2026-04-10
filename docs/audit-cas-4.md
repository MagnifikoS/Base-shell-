# AUDIT CAS 4 — Module Alertes Stock

**Date :** 2026-03-14  
**Auditeur :** Lovable AI (mandat audit SaaS parano)  
**Version du code :** HEAD courant  
**Périmètre :** `src/modules/stockAlerts/` uniquement + dépendances directes

---

## 1 — Résumé exécutif

**Le module Alertes Stock est globalement fiable pour un MVP.**

Il utilise la **même source de vérité** (StockEngine `getEstimatedStockBatch`) et les **mêmes données** (snapshots + events filtrés par `snapshot_version_id` + `canonical_family`) que le module stock principal (`useEstimatedStock`). La comparaison seuil/stock est faite dans l'unité canonique, ce qui élimine le risque de faux positifs par mélange d'unités.

**Risques identifiés :**
- 🔴 **P0** : Absence de `.limit()` sur la requête `stock_events` → troncation silencieuse possible au-delà de 1000 lignes (défaut Supabase)
- 🟡 **P1** : Chargement de TOUS les produits (y compris ceux sans `min_stock`) → surcharge inutile
- 🟡 **P1** : Absence de `.limit()` sur `invoice_line_items` → performance dégradée sur historiques longs
- 🟢 **P2** : Duplication de `convertToDisplay()` entre Desktop et Mobile

**Verdict : Safe sous conditions** (corriger P0 avant production).

---

## 2 — Cartographie du module

### Fichiers

| Fichier | Rôle |
|---------|------|
| `src/modules/stockAlerts/index.ts` | Barrel export (2 composants) |
| `src/modules/stockAlerts/hooks/useStockAlerts.ts` | Hook principal — fetch + calcul (430 lignes) |
| `src/modules/stockAlerts/components/StockAlertsView.tsx` | Vue Desktop (685 lignes) |
| `src/modules/stockAlerts/components/MobileStockAlertsView.tsx` | Vue Mobile (684 lignes) |

### Tables lues

| Table | Usage |
|-------|-------|
| `products_v2` | Produits actifs + `min_stock_quantity_canonical`, `min_stock_unit_id`, config unités |
| `storage_zones` | Noms des zones |
| `invoice_suppliers` | Noms fournisseurs |
| `invoice_line_items` | Historique fournisseurs par produit |
| `zone_stock_snapshots` | Snapshots actifs par zone |
| `inventory_lines` | Lignes d'inventaire snapshot |
| `stock_events` | Mouvements stock postés |

### Dépendances externes au module

| Dépendance | Rôle |
|-----------|------|
| `@/modules/stockLedger` → `getEstimatedStockBatch` | Moteur de calcul stock (SSOT) |
| `@/hooks/useUnits` | Unités de mesure |
| `@/core/unitConversion` → `resolveProductUnitContext` | Conversion affichage |
| `@/modules/inventaireMutualisation` | Regroupement présentation |

### Realtime / Invalidations

Le query key `["stock-alerts", estId, zoneFilter]` est invalidé par :
- `invalidateStock()` dans `src/hooks/realtime/invalidators.ts` (via channels stock_events + inventory)
- Mutations directes : `usePostDocument`, `useVoidDocument`, `useInventorySessions`, `useTransferProductZone`, `useQuickAdjustment`, `useCreateWithdrawalCorrection`, `BlAppDocumentList`

**Couverture complète** — toute mutation stock invalide les alertes.

---

## 3 — Source de vérité du stock

### Formule utilisée

```
Stock Estimé = inventory_lines[snapshot_version_id].quantity + Σ(stock_events WHERE snapshot_version_id AND canonical_family = snapshot_family)
```

### Identique au module stock principal ?

**OUI.** Les deux hooks (`useStockAlerts` lignes 317-329 et `useEstimatedStock` lignes 123-135) appellent exactement la même fonction pure `getEstimatedStockBatch` du `stockEngine.ts`.

### Filtrage par snapshot_version_id

**OUI.** Ligne 260 de `useStockAlerts` :
```typescript
.in("snapshot_version_id", allSnapshotVersionIds)
```
Conforme au standard SSOT (`snapshot_version_id` ET `canonical_family` via le StockEngine).

### Filtrage par canonical_family

**OUI.** Fait dans `stockEngine.ts` ligne 116 :
```typescript
const compatibleEvents = events.filter((e) => e.canonical_family === snapshotFamily);
```

### Contournement ou approximation ?

**AUCUN.** Pas de recalcul parallèle, pas de cache local, pas de valeur hardcodée.

---

## 4 — Audit des unités

### Unité du stock estimé

L'unité retournée par le StockEngine est celle de la **ligne d'inventaire snapshot** (`inventory_lines.unit_id`), qui correspond à l'unité canonique du produit au moment de l'inventaire.

### Unité du seuil

Le seuil est stocké dans `products_v2.min_stock_quantity_canonical` avec `products_v2.min_stock_unit_id`.

Le nom du champ (`_canonical`) implique que la valeur est exprimée dans l'unité canonique du produit (`stock_handling_unit_id`).

### Où se fait la comparaison ?

`useStockAlerts.ts` lignes 363-369 :
```typescript
const est = outcome.data.estimated_quantity;  // en unité canonique (snapshot)
const minStock = p.min_stock_quantity_canonical;  // en unité canonique (produit)
if (est <= 0) level = "rupture";
else if (minStock != null && est < minStock) level = "warning";
```

### La conversion est-elle fiable ?

**Il n'y a PAS de conversion au moment de la comparaison** — les deux valeurs sont supposées être dans la même unité canonique. C'est correct SI :
1. `min_stock_quantity_canonical` est toujours stocké dans la même unité que `stock_handling_unit_id`
2. `inventory_lines.unit_id` est la même que `stock_handling_unit_id`

**Vérification :** Le Wizard produit (seul point d'écriture de `min_stock_quantity_canonical`) écrit dans l'unité canonique du produit. Le stock est calculé dans l'unité du snapshot (= unité canonique au moment de l'inventaire). La politique d'immutabilité de l'unité canonique (`products_v2.stock_handling_unit_id` verrouillé quand stock > 0) garantit la cohérence.

**VERDICT UNITÉS : ✅ Fiable.** L'architecture d'immutabilité de l'unité canonique protège contre les dérives.

### Conversion pour l'affichage

La conversion affichage (mode "référence" vs "fournisseur") est faite par `convertToDisplay()` dans les composants UI. Cette conversion est purement visuelle et n'affecte PAS la logique d'alerte.

---

## 5 — Audit des seuils

### Où le seuil est stocké

`products_v2.min_stock_quantity_canonical` (number | null) + `products_v2.min_stock_unit_id` (string | null).

### Comment il est lu

`useStockAlerts` ligne 81 — fetch direct depuis `products_v2`.

### Comment il est comparé

```typescript
// Ligne 365-368
if (est <= 0) level = "rupture";       // stock nul ou négatif → rupture (quel que soit le seuil)
else if (minStock != null && est < minStock) level = "warning";  // strict <
```

### Logique de comparaison

| Condition | Résultat |
|-----------|----------|
| `est <= 0` | **Rupture** (indépendant du seuil) |
| `est > 0 && est < minStock` | **Warning** (sous seuil) |
| `est >= minStock` ou `minStock == null` | **OK** |

**Opérateur strict `<`** (pas `<=`) : un produit exactement au seuil est considéré OK. C'est un choix métier acceptable (le restaurateur a défini "minimum acceptable", donc exactement ce nombre = OK).

### Arrondis

Le StockEngine arrondit à 4 décimales (`round4`). Le seuil est stocké tel quel en DB (number). Risque d'arrondi ?

**Cas pathologique** : `est = 4.99995` (arrondi à 5.0000), `minStock = 5.0` → `5.0 < 5.0` = false → OK. Correct.
**Cas inverse** : `est = 5.00004` (arrondi à 5.0000), `minStock = 5.0` → `5.0 < 5.0` = false → OK. Correct.

**VERDICT : ✅ Pas de risque d'arrondi dangereux** avec 4 décimales.

---

## 6 — Audit de cohérence module stock vs alertes

### Un même produit peut-il afficher un stock correct mais une alerte fausse ?

**NON.** Les deux modules utilisent `getEstimatedStockBatch` avec les mêmes paramètres (snapshot_version_id, events filtrés par snapshot_version_id). La seule divergence théorique serait un décalage temporel de cache (staleTime = 30s pour les deux), mais les invalidations sont identiques.

### Un produit peut-il être sous seuil sans alerte ?

**OUI, dans 2 cas identifiés :**

1. **Produit sans zone de stockage et sans `min_stock`** : le hook ne le charge pas du tout (OK, pas de seuil configuré = pas d'alerte attendue).

2. **🔴 FAILLE P0 — Troncation silencieuse des stock_events** : `useStockAlerts` n'a PAS de `.limit()` sur sa requête `stock_events` (lignes 253-261). Le défaut Supabase est 1000 lignes. Si un produit a plus de 1000 événements dans une zone, les événements au-delà sont silencieusement ignorés → le stock estimé est FAUX → l'alerte peut être absente ou inversée.

   **Preuve :** Comparer avec `useEstimatedStock` qui a explicitement `.limit(STOCK_EVENTS_LIMIT)` avec `STOCK_EVENTS_LIMIT = 10_000` et un `console.warn` de troncation.

### Une alerte peut-elle apparaître alors que le stock est correct ?

**NON** (même moteur de calcul). Sauf troncation ci-dessus (dans l'autre sens).

---

## 7 — Audit performance / latence

### Nombre de requêtes

Pour un établissement avec N zones et M produits :

| Requête | Nombre | Poids |
|---------|--------|-------|
| `products_v2` (tous produits actifs) | 1 | Potentiellement lourd (tous les produits, pas seulement ceux avec min_stock) |
| `storage_zones` | 1 | Léger |
| `invoice_suppliers` (primaires) | 1 | Léger |
| `invoice_line_items` (historique) | 1 | ⚠️ **Sans .limit()** — peut être très lourd |
| `invoice_suppliers` (extra) | 0-1 | Léger |
| `zone_stock_snapshots` | 1 | Léger |
| `inventory_lines` (batch) | 1 | Moyen |
| `stock_events` (batch) | 1 | ⚠️ **Sans .limit()** — risque troncation |
| **Total** | **7-8** | |

### N+1 ?

**NON.** Le code a été optimisé (commentaire `API-PERF-014`). Toutes les données sont chargées en batch, puis indexées en mémoire.

### Problèmes identifiés

1. **🟡 P1 — Chargement de TOUS les produits** : La requête `products_v2` charge tous les produits actifs sans filtre sur `min_stock_quantity_canonical IS NOT NULL`. Les produits sans seuil min sont chargés, traités, puis filtrés côté client. Impact : données inutiles transférées et traitées.

2. **🟡 P1 — `invoice_line_items` sans limit** : La requête historique fournisseurs n'a pas de `.limit()`. Sur un établissement avec un long historique d'achats, cette requête peut retourner des milliers de lignes juste pour résoudre des noms de fournisseurs.

3. **🔴 P0 — `stock_events` sans limit** : Troncation silencieuse possible (cf. section 6).

### Latence perçue

- `staleTime: 30_000` (30s) → les alertes sont rafraîchies automatiquement toutes les 30s ou à chaque invalidation realtime.
- Le calcul est client-side (StockEngine pur) → pas de latence serveur pour le calcul.
- **Une alerte peut apparaître 0-30s après un mouvement stock** (délai acceptable pour un MVP).

### Recalculs superflus

Le hook recharge TOUT quand le `zoneFilter` change (la query key inclut `zoneFilter`). Cela signifie que basculer entre zones provoque un re-fetch complet au lieu de filtrer les données déjà chargées. Impact mineur pour un MVP mais améliorable.

---

## 8 — Audit UX métier

### Desktop (`StockAlertsView`)

| Critère | Évaluation |
|---------|-----------|
| **Libellé alerte** | ✅ Clair : "Rupture", "Sous seuil", "Non calculable", "OK" |
| **Quantité affichée** | ✅ Stock + Seuil avec unité |
| **Unité affichée** | ✅ Mode "référence" (canonique) ou "fournisseur" (converti) |
| **Gravité** | ✅ Code couleur (rouge rupture, orange warning, gris erreur, vert OK) + bordure gauche |
| **Compréhension** | ✅ Le restaurateur voit : produit, zone, fournisseur, stock actuel, seuil min, statut |
| **Action** | ✅ "Voir" (fiche produit) ou "Corriger" (wizard) |
| **Filtres** | ✅ Zone, fournisseur, catégorie, niveau d'alerte |

### Mobile (`MobileStockAlertsView`)

| Critère | Évaluation |
|---------|-----------|
| **Format** | ✅ Cartes adaptées mobile |
| **Actions** | ✅ "Créer BL APP" (réapprovisionnement) + "Voir produit" |
| **Filtres** | ✅ Sheet bottom avec pills tactiles |

### Le restaurateur comprend-il ?

**OUI.** L'interface est claire :
- Quel produit → nom + zone
- Combien il reste → quantité stock avec unité
- À partir de quel seuil → quantité min avec unité
- Si le chiffre est fiable → le statut "Non calculable" signale explicitement les cas douteux

**Point d'attention UX** : le mode "Unité fournisseur" peut afficher des quantités différentes du stock réel canonique. Pas d'indication visuelle que c'est une conversion. Un restaurateur pourrait confondre.

---

## 9 — Liste des failles identifiées

### FAILLE 1 — Troncation silencieuse stock_events (P0)

| | |
|---|---|
| **Gravité** | 🔴 P0 — Critique |
| **Fichier** | `useStockAlerts.ts` lignes 253-261 |
| **Preuve** | Absence de `.limit()` sur `stock_events` → défaut Supabase = 1000 lignes. `useEstimatedStock` a `.limit(10_000)` + warning. |
| **Conséquence terrain** | Si un produit a > 1000 événements dans une zone/snapshot, le stock estimé est FAUX. L'alerte affichée (ou son absence) est incorrecte. Le restaurateur prend une décision d'achat basée sur un chiffre erroné. |
| **Conditions** | Établissement avec volume élevé de mouvements (réceptions + retraits fréquents). Typiquement atteint après 3-6 mois d'usage intensif sans nouvel inventaire. |
| **Impact métier** | Faux négatif (pas d'alerte alors que rupture) OU faux positif (alerte alors que stock OK). |

### FAILLE 2 — Chargement inutile de tous les produits (P1)

| | |
|---|---|
| **Gravité** | 🟡 P1 — Performance |
| **Fichier** | `useStockAlerts.ts` ligne 78-84 |
| **Preuve** | Pas de filtre `.not("min_stock_quantity_canonical", "is", null)`. Un établissement avec 500 produits dont 20 avec seuil min charge les 500. |
| **Conséquence terrain** | Latence accrue au chargement. Consommation bandwidth inutile sur mobile. |
| **Conditions** | Dès que l'établissement a beaucoup de produits. |
| **Impact métier** | Lenteur perçue. Pas de faux résultat. |

### FAILLE 3 — `invoice_line_items` sans limit (P1)

| | |
|---|---|
| **Gravité** | 🟡 P1 — Performance |
| **Fichier** | `useStockAlerts.ts` lignes 122-126 |
| **Preuve** | Pas de `.limit()` sur `invoice_line_items`. La requête charge potentiellement des milliers de lignes pour résoudre des noms fournisseurs. |
| **Conséquence terrain** | Requête lente sur établissements avec long historique. |
| **Conditions** | Établissement actif depuis plusieurs mois avec nombreuses factures. |
| **Impact métier** | Lenteur perçue. Possible timeout. |

### FAILLE 4 — Duplication de `convertToDisplay()` (P2)

| | |
|---|---|
| **Gravité** | 🟢 P2 — Maintenabilité |
| **Fichier** | `StockAlertsView.tsx` lignes 105-129 ET `MobileStockAlertsView.tsx` lignes 58-83 |
| **Preuve** | Fonctions identiques copier-collées. |
| **Conséquence terrain** | Risque de divergence si une correction est faite sur un seul fichier. |
| **Conditions** | Lors d'une future modification. |
| **Impact métier** | Aucun actuellement. |

---

## 10 — Liste des faux positifs écartés

### FP-1 — Mélange unité canonique / unité d'affichage dans la comparaison

**Risque suspecté :** La comparaison seuil/stock pourrait utiliser une unité d'affichage au lieu de l'unité canonique.

**Écarté :** La comparaison (lignes 363-369) utilise `outcome.data.estimated_quantity` (retour du StockEngine, en unité canonique) et `min_stock_quantity_canonical` (stocké en canonique). La conversion `convertToDisplay()` est appelée uniquement pour l'UI, APRÈS le calcul d'alerte.

### FP-2 — Divergence entre StockEngine des alertes et du module stock

**Risque suspecté :** Les deux modules pourraient utiliser des versions différentes du StockEngine.

**Écarté :** Les deux importent exactement `getEstimatedStockBatch` depuis `@/modules/stockLedger`. Fonction pure, pas d'état interne, pas de version différente possible.

### FP-3 — Changement d'unité canonique provoquant un faux seuil

**Risque suspecté :** Si un utilisateur change l'unité canonique d'un produit (kg → g), le seuil et le stock seraient dans des unités différentes.

**Écarté :** La politique d'immutabilité (`stock_handling_unit_id` verrouillé quand stock > 0) empêche ce scénario. Le changement n'est possible que quand le stock est à zéro, ce qui force un nouvel inventaire et donc une nouvelle ligne snapshot dans la nouvelle unité.

### FP-4 — Race condition entre invalidation realtime et cache

**Risque suspecté :** Une alerte pourrait apparaître en retard à cause du cache.

**Écarté partiellement :** Le `staleTime` de 30s + invalidation realtime via `useStockEventsChannel` et `useInventoryChannels` garantit un rafraîchissement quasi-instantané. Le délai max est la latence Postgres Realtime (~200ms) + re-fetch (~500ms). Acceptable pour un MVP.

### FP-5 — Produits archivés affichant des alertes fantômes

**Risque suspecté :** Un produit archivé pourrait encore apparaître dans les alertes.

**Écarté :** Filtre `.is("archived_at", null)` présent ligne 84.

---

## 11 — Verdict

### 🟡 SAFE SOUS CONDITIONS

Le module Alertes Stock peut être utilisé en MVP **à condition de corriger la faille P0** (troncation silencieuse `stock_events`).

Sans cette correction :
- Un établissement avec un volume de mouvements élevé (> 1000 événements par zone/snapshot) affichera des alertes basées sur un stock estimé incomplet.
- Le restaurateur ne sera pas averti que le calcul est tronqué.
- Des décisions d'achat erronées sont possibles.

Avec la correction P0 :
- Le module est **fiable**, **cohérent** avec le module stock, et **compréhensible** pour le restaurateur.
- Les failles P1/P2 sont des optimisations qui n'affectent pas la fiabilité.

---

## 12 — Plan de correction recommandé

### Correction 1 — Ajouter `.limit()` + warning sur `stock_events` (P0)

| | |
|---|---|
| **Gravité** | 🔴 P0 |
| **Impact** | Supprime le risque de stock estimé faux |
| **Complexité** | Triviale — 3 lignes |
| **Risque de régression** | Nul |
| **Priorité** | **Avant production** |
| **Action** | Ajouter `.limit(10_000)` sur la requête `stock_events` dans `useStockAlerts.ts` (aligner sur `useEstimatedStock`). Ajouter un `console.warn` si le nombre retourné atteint la limite. |

### Correction 2 — Filtrer les produits par `min_stock IS NOT NULL` côté requête (P1)

| | |
|---|---|
| **Gravité** | 🟡 P1 |
| **Impact** | Réduit significativement le volume de données chargées |
| **Complexité** | Triviale — 1 ligne ajoutée à la requête |
| **Risque de régression** | Faible — les produits sans seuil ne sont de toute façon pas affichés comme "warning" |
| **Priorité** | Avant production (amélioration perf) |
| **Action** | Ajouter `.not("min_stock_quantity_canonical", "is", null)` à la requête `products_v2`. Note : les ruptures (stock ≤ 0) seraient alors masquées pour les produits sans seuil. Si on veut conserver l'affichage des ruptures sans seuil, il faut une requête OR plus complexe ou accepter le chargement complet. **À arbitrer métier.** |

### Correction 3 — Limiter `invoice_line_items` (P1)

| | |
|---|---|
| **Gravité** | 🟡 P1 |
| **Impact** | Évite les requêtes lourdes sur l'historique |
| **Complexité** | Triviale — 1 ligne |
| **Risque de régression** | Nul (un DISTINCT côté SQL ou un limit élevé suffit) |
| **Priorité** | Avant production (perf) |
| **Action** | Utiliser `.limit(5000)` ou mieux : créer un index / vue matérialisée pour "fournisseurs distincts par produit". |

### Correction 4 — Extraire `convertToDisplay()` en utilitaire partagé (P2)

| | |
|---|---|
| **Gravité** | 🟢 P2 |
| **Impact** | Maintenabilité |
| **Complexité** | Faible — déplacer dans un fichier commun |
| **Risque de régression** | Nul |
| **Priorité** | Peut attendre |
| **Action** | Créer `src/modules/stockAlerts/utils/convertToDisplay.ts` et importer dans les deux composants. |

---

## Réponse à la question finale

> Le module Alertes Stock de Restaurant OS peut-il aujourd'hui prévenir correctement les ruptures et passages sous seuil, avec les bonnes unités et sans divergence avec le stock réel ?

**OUI, sous réserve** que le volume de mouvements stock par zone reste inférieur à 1000 lignes (défaut Supabase sans `.limit()`).

- ✅ Les unités sont correctement harmonisées (comparaison en canonique)
- ✅ La source de vérité est identique au module stock (même StockEngine)
- ✅ Les seuils sont comparés dans la bonne unité
- ✅ Pas de recalcul parallèle ni de vérité alternative
- ✅ L'UX est claire et exploitable
- ⚠️ **Une seule correction critique** (`.limit()` sur `stock_events`) est nécessaire avant production

**Fin de l'audit.**
