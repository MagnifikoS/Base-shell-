# Audit Code / Flows / Logiques — V1 Stabilisation Finale

> Date : 31 mars 2026  
> Scope : Code uniquement — aucune correction de données  
> Objectif : Vérifier l'unification saisie + zones + fermer les doubles logiques

---

## A. TABLEAU LOGIQUE DE SAISIE

La cible :
- **Réception** → `product_input_config.reception_*`
- **Tout le reste** → `product_input_config.internal_*`

| # | Flow | Modal utilisé | Resolver utilisé | contextType | Source vérité saisie | Conforme ? | Action |
|---|------|---------------|------------------|-------------|---------------------|------------|--------|
| 1 | Réception desktop | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"reception"` → `reception` | `product_input_config.reception_*` | ✅ OUI | — |
| 2 | Réception mobile | `UniversalQuantityModal` (direct) | `resolveInputUnitForContext` | `"reception"` | `product_input_config.reception_*` | ✅ OUI | — |
| 3 | Retrait desktop | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"withdrawal"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 4 | Retrait mobile | `UniversalQuantityModal` (direct) | `resolveInputUnitForContext` | `"internal"` | `product_input_config.internal_*` | ✅ OUI | — |
| 5 | Inventaire comptage | `UniversalQuantityModal` (embedded via `useCountingModal`) | `resolveInputUnitForContext` | `"internal"` | `product_input_config.internal_*` | ✅ OUI | — |
| 6 | Inventaire correction mobile | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"inventory"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 7 | Inventaire correction desktop (drawer) | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"inventory"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 8 | **Nouvelle commande** | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"order"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 9 | **Détail commande** | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"order"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 10 | **Préparation commande** | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"order"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 11 | Nouvelle commande composite | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"order"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 12 | Correction BL (réception) | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"correction"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |
| 13 | Correction BL Retrait | `QuantityModalWithResolver` | `resolveInputUnitForContext` | `"correction"` → `internal` | `product_input_config.internal_*` | ✅ OUI | — |

### Verdict saisie : ✅ DÉJÀ UNIFIÉE

Tous les flows passent par `resolveInputUnitForContext` via `QuantityModalWithResolver` (desktop) ou `UniversalQuantityModal` (mobile).  
Le mapping `toInputContext()` dans `QuantityModalWithResolver.tsx` (ligne 43-45) est la preuve :  
```ts
function toInputContext(ct: QuantityContextType): InputContext {
  return ct === "reception" ? "reception" : "internal";
}
```
**Zéro exception. Zéro double chemin pour la SAISIE.**

---

## A-bis. FOCUS COMMANDES

### Ce que les commandes utilisent pour la SAISIE (input) :
- `QuantityModalWithResolver` avec `contextType="order"` → résolu en `"internal"` → lit `product_input_config.internal_*`
- **Conforme à 100%**

### Ce que les commandes utilisent ENCORE via `resolveProductUnitContext` (BFS) :

| Fichier | Usage | Rôle | Double logique saisie ? |
|---------|-------|------|------------------------|
| `PreparationDialog.tsx` | `resolveProductUnitContext()` (l.224) | Traduction B2B client→fournisseur pour injecter la bonne quantité canonique dans le modal | ❌ NON — c'est de la **conversion B2B**, pas de la saisie |
| `useErpQuantityLabels.ts` | `resolveProductUnitContext()` (l.68) | **Affichage** ERP : décomposer une quantité canonique en unités lisibles (cartons + pièces) | ❌ NON — c'est du **display**, pas de la saisie |
| `b2bQuantity.ts` | `import type { ReachableUnit }` | Import de type uniquement | ❌ NON |

### Conclusion commandes :
**Les commandes sont 100% conformes pour la saisie.** Les usages restants de `resolveProductUnitContext` sont légitimes : ils servent à la **conversion B2B** et à l'**affichage ERP**, jamais à déterminer les unités de saisie.

---

## B. TABLEAU ZONES DE STOCKAGE

| # | Module / Flow | Lit quelle zone ? | Écrit quelle zone ? | Rôle | Verdict |
|---|---------------|-------------------|---------------------|------|---------|
| 1 | **`products_v2.storage_zone_id`** | — | — | **SSOT zone produit** | ✅ Source unique |
| 2 | `fn_post_stock_document` (SQL) | `products_v2.storage_zone_id` par JOIN | `stock_events.storage_zone_id` | Route chaque événement vers la zone du **produit** (pas du document) | ✅ Lit la bonne source |
| 3 | `stock_documents.storage_zone_id` | — | Placeholder technique | Champ NOT NULL mais **non utilisé** pour le routage réel (voir `WithdrawalView.tsx` l.45-47) | ⚠️ Vestige — sans danger |
| 4 | `inventory_zone_products` | `storage_zone_id` + `preferred_unit_id` | Upsert via `useInventoryProductDrawer` | **Table d'assignation zone + préférence d'affichage inventaire** | ✅ Dérivée, pas SSOT zone |
| 5 | `zone_stock_snapshots` | `storage_zone_id` + `snapshot_version_id` | Créé lors de la clôture inventaire | **Cache de snapshot** pour le calcul de stock estimé | ✅ Cache, pas SSOT zone |
| 6 | `inventory_sessions` | `storage_zone_id` | Écrit à la création de session | **Scope de session** : sur quelle zone porte cet inventaire | ✅ Contextuel |
| 7 | `inventory_lines` | — | — | Lignes de comptage (pas de zone directe) | ✅ Neutre |
| 8 | Réception mobile (`MobileReceptionView`) | `products_v2.storage_zone_id` pour afficher la zone | — | Affichage + validation (bloque si null) | ✅ Lit la bonne source |
| 9 | Retrait (`WithdrawalView`) | Placeholder zone pour le document | `products_v2.storage_zone_id` via SQL | Le routage réel est côté SQL | ✅ Correct |
| 10 | Stock alerts (`useStockAlerts`) | `products_v2.storage_zone_id` via JOIN | — | Lit zone pour filtrer les snapshots | ✅ Lit la bonne source |
| 11 | Import B2B (`B2BZoneSelectDialog`) | — | `products_v2.storage_zone_id` | Force l'assignation à l'import | ✅ Écrit la bonne source |
| 12 | Wizard Produit | — | `products_v2.storage_zone_id` | Assignation à la création | ✅ Écrit la bonne source |
| 13 | `useDesktopStock` (inventaire) | `products_v2.storage_zone_id` + `inventory_zone_products.preferred_unit_id` | — | Lit zone produit + préférence affichage | ✅ Correct |

### Relation `products_v2.storage_zone_id` ↔ `inventory_zone_products` :
- `products_v2.storage_zone_id` = **SSOT** (où est physiquement le produit)
- `inventory_zone_products` = **table auxiliaire** pour `preferred_unit_id` (unité d'affichage préférée en inventaire par zone)
- `inventory_zone_products.storage_zone_id` est **toujours synchronisé** avec `products_v2.storage_zone_id` (audit confirme 100% cohérence)
- Il n'y a **aucun flow qui écrit dans `inventory_zone_products.storage_zone_id` une valeur différente** de `products_v2.storage_zone_id`

### Verdict zones : ✅ DÉJÀ UNIFIÉES (source unique = `products_v2.storage_zone_id`)

La dualité `inventory_zone_products` est **sans risque** : c'est une table de préférences d'affichage, pas une source de vérité zone concurrente.

---

## C. TABLEAU DOUBLES LOGIQUES RESTANTES

| # | Élément | Type | Où utilisé | Encore atteignable ? | Danger réel ? | Bloquant V1 ? | Action |
|---|---------|------|-----------|---------------------|---------------|---------------|--------|
| 1 | `resolveProductUnitContext` | Resolver BFS structure | 41 fichiers (91 appels hors tests) | ✅ Oui, massivement | ❌ NON — c'est le resolver **structurel** (graphe de conversion), pas le resolver **de saisie**. Il sert à l'affichage, la conversion, la décomposition. Il ne décide **jamais** quelles unités saisir. | ❌ Non | **Aucune.** C'est un outil complémentaire, pas une double logique. |
| 2 | `inventory_display_unit_id` (col `products_v2`) | Champ legacy | `useDesktopStock.ts`, `StockBreakdownCell.tsx`, `EstimatedStockCell.tsx` | ✅ Oui (fallback display) | ⚠️ FAIBLE — utilisé comme fallback d'affichage uniquement : `preferred_display_unit_id ?? inventory_display_unit_id ?? largestUnit` | ❌ Non | **Post-lancement** : migrer vers `product_input_config.internal_unit_id` comme source d'affichage, supprimer ce champ. |
| 3 | `stock_documents.storage_zone_id` | Champ technique | `WithdrawalView.tsx` (placeholder), `useDocumentsHistory.ts` (affichage) | ✅ Oui | ❌ NON — le commentaire dans `WithdrawalView.tsx` (l.45-47) documente explicitement que c'est un placeholder NOT NULL, le routage réel est côté SQL. | ❌ Non | Aucune. Documentation suffisante. |
| 4 | `inventory_zone_products.storage_zone_id` | Champ dérivé | `useDesktopStock.ts` (lecture preferred_unit), `useInventoryProductDrawer.ts` (écriture preferred_unit) | ✅ Oui | ❌ NON — toujours synchronisé avec `products_v2.storage_zone_id`. | ❌ Non | Aucune. |
| 5 | `MobileStockListView.tsx` — `resolveProductUnitContext` pour affichage stock | Affichage legacy | Vue mobile stock inventaire | ✅ Oui | ⚠️ FAIBLE — utilise `allowedInventoryEntryUnits` du resolver BFS pour déterminer l'unité d'affichage au lieu de `product_input_config` | ❌ Non | **Post-lancement** : aligner sur `resolveInputUnitForContext("internal")` pour cohérence totale. |

### Verdict doubles logiques : ✅ AUCUNE DOUBLE LOGIQUE DANGEREUSE

Les seuls vestiges sont :
1. `inventory_display_unit_id` — fallback d'affichage inoffensif
2. `MobileStockListView` — affichage via BFS au lieu d'input config (cosmétique)

**Rien ne crée de divergence métier dans les écritures ou les calculs.**

---

## D. TABLEAU DONNÉES À CORRIGER MANUELLEMENT

### D1. Family mismatch (10 produits)

Ces produits ont des événements de stock avec une famille d'unité incohérente avec leur configuration actuelle. À corriger via un reset de snapshot ou une correction manuelle.

| Produit | Établissement | Problème |
|---------|---------------|----------|
| Pomme de terre grenaille | FO / NONNA | Poids vs Décompte mismatch B2B |
| Huile Amphore | FO / NONNA | Poids vs Décompte mismatch B2B |
| Safran | FO / NONNA | Poids vs Décompte mismatch B2B |
| Mozzarella | FO / NONNA | Poids vs Décompte mismatch B2B |
| *(6 autres identifiés dans l'audit précédent)* | — | Vérifier via query `brain_events` WHERE `action = 'family_mismatch'` |

> **Action** : Corriger manuellement l'équivalence poids dans le Wizard Produit pour chaque produit.

### D2. B2B sans unit_mapping (4 imports)

| Produit importé | Établissement client | Source |
|-----------------|---------------------|--------|
| *(à identifier via query)* | FO | `b2b_imported_products WHERE unit_mapping IS NULL` |

> **Action** : Ouvrir le Wizard Produit côté client, définir le mapping d'unité.

### D3. Produits sans `supplier_billing_unit_id` (4 produits)

| Produit | Établissement |
|---------|---------------|
| *(à identifier via query)* | NONNA SECRET |

> **Action** : Ouvrir le Wizard Produit, définir l'unité de facturation fournisseur.

### D4. `product_input_config` manquante (425 produits)

| Scope | Count | Action |
|-------|-------|--------|
| Produits actifs sans config | ~425 | Configurer via le dialog de configuration (par produit ou par lot) |

> **Action** : Utiliser le bulk config dialog existant OU configurer un par un dans le Wizard.

### D5. Produits archivés / liens B2B résiduels

| Sujet | Action recommandée |
|-------|-------------------|
| Produits archivés avec `b2b_imported_products` orphelins | **Supprimer** les liens B2B orphelins (pas corriger) |
| Produits archivés sans config | **Ignorer** — archivés = hors scope opérationnel |

---

## CONCLUSION FINALE

### 1. Saisie : ✅ DÉJÀ UNIFIÉE
Tous les flows de saisie (réception, retrait, inventaire, commandes, corrections, BL) passent par `resolveInputUnitForContext` + `product_input_config`. Zéro exception.

### 2. Zones : ✅ DÉJÀ UNIFIÉES
`products_v2.storage_zone_id` est la source unique de vérité. `inventory_zone_products` est une table de préférences d'affichage, pas une SSOT concurrente. Le moteur SQL (`fn_post_stock_document`) lit exclusivement `products_v2.storage_zone_id` pour le routage des événements.

### 3. Code / flows à corriger avant lancement : **AUCUN BLOQUANT**

| # | Correction code | Pourquoi | Risque | Bloquant ? |
|---|----------------|----------|--------|------------|
| — | — | — | — | — |

**Il n'y a aucune correction de code obligatoire pour lancer la V1.**

### 4. Améliorations post-lancement (non bloquantes)

| # | Amélioration | Pourquoi | Priorité |
|---|-------------|----------|----------|
| 1 | Supprimer `inventory_display_unit_id` fallback | Nettoyer le vestige — remplacer par `product_input_config.internal_unit_id` | Basse |
| 2 | Aligner `MobileStockListView` sur `resolveInputUnitForContext` | Cohérence affichage, actuellement via BFS | Basse |
| 3 | Documenter `stock_documents.storage_zone_id` comme placeholder | Déjà documenté en commentaire, formaliser | Très basse |

---

### Phrase finale

> **Après correction manuelle des données (425 configs produit + 10 family mismatch + 4 unit_mapping + 4 billing units), la V1 a une logique de saisie unique et une source de vérité zone unifiée. Aucune correction de code n'est nécessaire.**
