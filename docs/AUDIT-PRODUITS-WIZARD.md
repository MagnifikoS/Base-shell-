# 🔍 Audit Hard — Module Produits + Wizard

**Date :** 2026-03-06  
**Scope :** `src/modules/produitsV2/`, `src/modules/visionAI/components/ProductFormV3/`, `src/modules/conditionnementV2/`, `src/core/unitConversion/`  
**Version :** Pré-V0 élargie

---

## SECTION A — Executive Summary

### Verdict : **GO CONDITIONNEL**

Le module Produits + Wizard est architecturalement solide, avec une discipline SSOT remarquable (UUID-only, zéro hardcode, supplier_id verrouillé). Cependant, **5 problèmes doivent être corrigés** avant de considérer le module comme base fiable pour Inventaire, Commandes, B2B et Facture.

### 🔴 3 Risques Critiques

| # | Risque | Impact |
|---|--------|--------|
| **C1** | `persistInventoryArticle` utilise `(supabase as any)` — contourne le typage TypeScript, aucune gestion d'erreur silencieuse sur l'update `products_v2.inventory_article_id` | Article inventaire créé mais pas lié → fausse rupture |
| **C2** | `dlc_warning_days` persisté via un `(supabase as any)` séparé APRÈS le RPC atomique `fn_save_product_wizard` — crée un state partiel en cas d'échec réseau | DLC incohérente entre produit et alerte |
| **C3** | Le `ProductV2` type ne contient pas `inventory_article_id` alors que la colonne existe en DB — les lectures standard ne remontent jamais cette FK | Pas de détection client-side des produits déjà liés à un article |

### 🟡 5 Risques Moyens

| # | Risque |
|---|--------|
| **M1** | `WizardStep5` (Résumé) utilise `category` texte au lieu de `categoryId` UUID dans son `onCategoryChange` — double vérité catégorie |
| **M2** | `updateProductV2` dans `useProductV2Mutations.update` passe `supplier_id` mais `updateProductV2` le bloque → erreur silencieuse possible |
| **M3** | `ProductFormV3Modal.tsx` = **918 lignes** — trop gros, mélange logique métier + UI + persistance |
| **M4** | Le champ `initialStockQuantity` dans le wizard n'est jamais persisté (ni via le payload creation, ni via RPC) |
| **M5** | `patchWizardFields` expose `category` et `storage_zone_id` dans sa whitelist malgré le commentaire "NEVER touched by the Wizard" |

### ✅ Points Solides

- **Supplier ID verrouillé** : `updateProductV2` bloque explicitement toute modification → protection identité produit
- **Optimistic lock** : `expected_updated_at` empêche les écrasements concurrents (F9)
- **Graphe BFS UUID-only** : zéro text matching, zéro hardcode, conversions bidirectionnelles
- **Validation wizard complète** : `validateFullGraph` vérifie connectivité packaging + reachability de toutes les unités avant save
- **Collision check** : triple vérification (barcode, code_produit, name_normalized)
- **Soft delete** : archivage via `archived_at`, nettoyage des sessions inventaire actives
- **Auto-init stock** : `fn_initialize_product_stock` centralisé dans `createProductV2`
- **Prix SSOT** : `final_unit_price` est la source unique, `priceDisplayResolver` est read-only

---

## SECTION B — Cartographie des Sources de Vérité

| Domaine | SSOT | Qui écrit | Qui lit | Garde-fous | Risque double vérité |
|---------|------|-----------|---------|------------|---------------------|
| **Identité produit** | `products_v2.id` + `nom_produit` + `name_normalized` | Wizard (create/upsert) | Tous modules | Collision check, unique index | ⚠️ `createOrUpdateProductV2` (legacy) bypass possible |
| **Nom produit** | `products_v2.nom_produit` (uppercased) | Wizard Step 1 | Liste, BL, Commandes | `toUpperCase()` systématique | ✅ Pas de double vérité |
| **Fournisseur** | `products_v2.supplier_id` (FK → `invoice_suppliers`) | Wizard Step 1 (création only) | Tous | `updateProductV2` bloque, `upsert` ne touche pas en update | ✅ Solide |
| **Prix unitaire** | `products_v2.final_unit_price` | Wizard Step 4 (calcul moteur) | Inventaire, BL, prix display, alertes | Read-only dans `priceDisplayResolver` | ✅ Solide |
| **Unité canonique** | `products_v2.final_unit_id` + `stock_handling_unit_id` | Wizard Step 2 + Step 5 | Inventaire, stock, BFS | `resolveProductUnitContext` | ⚠️ `stock_handling_unit_id` peut diverger (stale) |
| **Packaging/BFS** | `products_v2.conditionnement_config` (JSONB) | Wizard Steps 2-3 | Moteur calcul, prix display, stock | `validateFullGraph` pre-save | ✅ Solide |
| **Zone stockage** | `products_v2.storage_zone_id` | Wizard Step 6, inline edit | Inventaire, stock | Zone transfer atomique via RPC | ✅ Solide |
| **Catégorie** | `products_v2.category_id` (UUID) | Wizard Step 6 | Liste, DLC alertes | ⚠️ `category` texte encore écrit en parallèle | ⚠️ Dual write category + category_id |
| **Seuil stock** | `products_v2.min_stock_quantity_canonical` + `min_stock_unit_id` | Wizard Step 6 | Alertes stock | Conversion BFS vers canonical | ✅ Solide |
| **Seuil DLC** | `products_v2.dlc_warning_days` | Wizard Step 6 | DLC alertes (via `dlcCompute.ts`) | Chaîne priorité: Produit > Catégorie > Global > 3j | ⚠️ Persisté hors RPC (C2) |
| **Article inventaire** | `products_v2.inventory_article_id` (FK) | Wizard Step 7 | Inventaire agrégé | Famille canonique validée | 🔴 Pas dans le type `ProductV2` (C3) |
| **Produit porteur** | `inventory_articles.threshold_product_id` | Wizard Step 7 / CreateArticleDialog | Alertes seuil article | Triggers DB validation | ✅ Solide |
| **Mapping B2B** | `b2b_imported_products` (table séparée) | Import B2B | B2B sync | FK constraints | ✅ Isolé proprement |

---

## SECTION C — Audit Métier du Wizard

### Mapping Étapes

| Step | Num UI | Responsabilité | Champs écrits |
|------|--------|---------------|---------------|
| **Identité** | 1 | Nom, code, fournisseur | `productName`, `productCode`, `identitySupplierId` |
| **Structure** | 2 | Unité référence, équivalence | `finalUnit/Id`, `hasEquivalence`, `equivalenceQuantity/Unit/Id` |
| **Conditionnement** | 3 | Packaging multi-niveaux | `hasPackaging`, `packagingLevels[]` |
| **Facturation** | 4 | Quantité facturée, unité, total | `billedQuantity`, `billedUnit/Id`, `lineTotal` |
| **Gestion** | 5 | Unités livraison/stock/cuisine/prix | `deliveryUnitId`, `stockHandlingUnitId`, `kitchenUnitId`, `priceDisplayUnitId` |
| **Zone & Stock** | 6 | Catégorie, zone, seuil, barcode, DLC | `category/Id`, `storageZoneId`, `minStock*`, `barcode`, `dlcWarningDays` |
| **Article** | 7 | Liaison article inventaire | `inventoryArticleMode`, `inventoryArticleId` |
| **Résumé** | 8 | Récapitulatif visuel + inline edit gestion | Lecture seule + modifications inline gestion |

### Analyse

**Y a-t-il des étapes qui écrivent sur des champs déjà gérés ailleurs ?**
- ⚠️ **Step 8 (Résumé)** permet l'inline edit des unités de gestion ET de la catégorie — ces champs sont aussi gérés en Step 5 et Step 6. Pas de conflit car l'état wizard est unifié, mais UX confus.
- ⚠️ **Step 8** utilise `onCategoryChange(value)` avec un **nom texte** alors que Step 6 utilise `onCategoryChange(name, id)` avec UUID. Double logique catégorie.

**Y a-t-il des validations contradictoires entre étapes ?**
- ✅ Non — `canProceedStep*` sont indépendants et cohérents.

**Y a-t-il des écritures trop tôt dans le flow ?**
- ✅ Non — aucune écriture DB avant le bouton final "Valider". Tout reste en state wizard.

**Y a-t-il des champs qui devraient être figés après création ?**
- ✅ `supplier_id` est verrouillé (`updateProductV2` throw) — correct.
- ⚠️ `final_unit_id` peut être changé en édition — risque d'invalidation de l'historique stock. Acceptable si zone transfer est atomique.

**Le wizard est-il la seule porte d'entrée métier ?**
- ⚠️ Non — 3 chemins d'écriture existent :
  1. **Wizard V3** (modal) — chemin principal
  2. **`useProductV2Mutations.create/update`** — via `ProductV2FormData` (peu utilisé, legacy)
  3. **`patchWizardFields`** — whitelist partielle pour update conditioning-only
  4. **`createOrUpdateProductV2`** — legacy wrapper, backward compat
  - Risque : les 3 chemins n'appliquent pas tous les mêmes garde-fous (ex: stock init, article inventaire)

---

## SECTION D — Audit Prix

### Architecture Prix

```
Facture OCR → Wizard Step 4 (billedQty × lineTotal) 
  → Moteur conditionnementV2.engine.calculateConditionnement()
    → unitPriceFinal (prix par unité de référence)
      → products_v2.final_unit_price (SSOT, write)
        → priceDisplayResolver (read-only, BFS conversion pour display)
```

### Réponses

| Question | Réponse |
|----------|---------|
| Le prix a-t-il une seule vérité ? | ✅ Oui — `final_unit_price` |
| Le wizard modifie-t-il le même prix que les autres modules ? | ✅ Oui — le wizard écrit, les autres lisent |
| Le changement de prix est-il cohérent avec la sync B2B ? | ⚠️ Pas de sync prix B2B implémentée encore — mais le design est compatible |
| Le wizard peut-il créer une incohérence prix fournisseur/client ? | ✅ Non — pas de concept "prix client" dans le modèle actuel |
| Y a-t-il un risque pour la future facture ? | ✅ Non — `commande_lines.unit_price_snapshot` fige le prix au moment de l'envoi (trigger immutable). Le prix catalogue peut évoluer sans impact. |
| Existe-t-il plusieurs chemins d'écriture prix ? | ⚠️ Oui — `upsertProductV2` écrit `final_unit_price`, `patchWizardFields` aussi, `updateProductV2` aussi. Tous convergent vers la même colonne. Pas de conflit mais pas de validation moteur dans les chemins legacy. |

---

## SECTION E — Audit Unités / Packaging / BFS

### Architecture

```
measurement_units (DB) ← SSOT pour tous les UUID
  ↓
conversionGraph.ts — buildGraph() → BFS
  Sources du graphe:
    A) unit_conversions (DB) — physiques (kg↔g, L↔mL)
    B) packagingLevels — conditionnement (Carton = 12 pce)  
    C) equivalence — pièce↔poids (1 Sachet = 800g)
```

### Réponses

| Question | Réponse |
|----------|---------|
| L'unité canonique a-t-elle une seule vérité ? | ⚠️ Deux colonnes : `final_unit_id` (unité de référence produit) et `stock_handling_unit_id` (unité inventaire). `resolveProductUnitContext` résout le canonical depuis `stock_handling_unit_id` avec fallback sur `final_unit_id`. Cohérent mais fragile si désynchronisés. |
| Le packaging est-il distinct de l'unité canonique ? | ✅ Oui — packaging est stocké dans `conditionnement_config.packagingLevels[]`, canonique dans des colonnes séparées. |
| Le wizard peut-il créer des graphes incohérents ? | ✅ Non — `validateFullGraph` vérifie connectivité BFS de toutes les unités (billing, delivery, stock, kitchen, priceDisplay) vers `finalUnit` avant save. Cycles détectés via DFS. |
| Les conversions servent-elles correctement aux modules ? | ✅ Oui — `resolveProductUnitContext` est le SSOT service utilisé par inventaire mobile, desktop, prix display. |
| Risque de double logique wizard ↔ ERP ? | ⚠️ Le Résumé (Step 8) recalcule les options BFS localement au lieu d'utiliser `resolveProductUnitContext` ou `resolveWizardUnitContext`. Duplication de logique BFS dans `WizardStep5.tsx` (lignes 252-310). |

---

## SECTION F — Audit Zone / Catégorie / Seuils

### Zone de Stockage

- **SSOT :** `products_v2.storage_zone_id` (FK → `storage_zones`)
- **Write :** Wizard Step 6, inline edit (ZoneInlineEdit), RPC `fn_save_product_wizard` (zone transfer atomique)
- **Read :** Inventaire, stock, filtres
- **Garde-fou :** Zone transfer atomique (QTY + snapshot + events) via RPC
- **Risque :** ✅ Aucun — architecture propre

### Catégorie

- **SSOT :** `products_v2.category_id` (FK → `product_categories`)
- **Legacy :** `products_v2.category` (texte) — encore écrit en parallèle dans `createProductV2` (ligne 265)
- **Write :** Wizard Step 6 (UUID), Wizard Step 8 (texte!), `upsertProductV2` (texte + UUID conditionnel)
- **Risque :** ⚠️ **Double vérité** — `category` texte et `category_id` UUID coexistent et sont écrits séparément. `upsertProductV2` ne met à jour `category_id` que si le produit n'a pas de catégorie existante.

### Seuil Stock

- **SSOT :** `products_v2.min_stock_quantity_canonical` + `min_stock_unit_id`
- **Write :** Wizard Step 6 (avec conversion BFS vers canonical), `MinStockEditForm` (inline)
- **Garde-fou :** Conversion BFS `resolveCanonicalMinStock()` dans le wizard
- **Risque :** ✅ Propre — conversion automatique vers canonical

### Seuil DLC

- **SSOT :** `products_v2.dlc_warning_days` (override produit)
- **Write :** Wizard Step 6
- **Risque :** 🔴 Persisté via `(supabase as any)` hors du RPC atomique (C2). Si le RPC réussit mais l'update DLC échoue → état partiel.

---

## SECTION G — Audit "Article Inventaire" depuis le Wizard

### Flux

1. **Step 7** — L'utilisateur choisit "Créer" ou "Associer"
2. **Save** — `persistInventoryArticle()` crée l'article ou lie le produit

### Réponses

| Question | Réponse |
|----------|---------|
| L'utilisateur comprend-il la différence produit/article ? | ⚠️ Le texte explicatif est minimal ("Un article inventaire regroupe les produits fournisseur identiques"). Pas d'exemple concret. |
| Le wizard peut-il lier un produit à un article incohérent ? | ⚠️ Le filtre famille canonique est appliqué côté UI (`canonicalFamily` passé à `findMatchingArticles`) mais pas vérifié côté DB lors du `update({inventory_article_id})`. Seuls les triggers DB protègent. |
| Les garde-fous famille sont-ils bien appliqués ? | ⚠️ `persistInventoryArticle` utilise `stockUnit?.family ?? "mass"` comme fallback — si stockUnit est null, l'article est créé en "mass" par défaut, potentiellement incorrect. |
| Le produit porteur est-il bien géré ? | ⚠️ `persistInventoryArticle` ne gère PAS le `threshold_product_id`. Il crée l'article sans porteur. Le porteur doit être désigné manuellement ensuite via `CreateArticleDialog`. |

### Problèmes

1. **Type incomplet** — `ProductV2` ne contient pas `inventory_article_id` → les lectures standard ne savent pas si un produit est déjà lié (C3)
2. **Persistance fragile** — `(supabase as any)` bypass le typage et masque les erreurs (C1)
3. **Pas de protection doublon** — Rien n'empêche de lier un produit à un article d'un autre établissement (bien que RLS devrait bloquer)

---

## SECTION H — Audit B2B / Import / Produits Liés

### Architecture

```
b2b_imported_products (table tracking)
  ├── source_product_id (FK → products_v2 du fournisseur)
  ├── local_product_id (FK → products_v2 du client)
  └── source_establishment_id
```

### Réponses

| Question | Réponse |
|----------|---------|
| Un produit B2B garde-t-il une identité claire ? | ✅ Oui — `b2b_imported_products` maintient le mapping source↔local |
| Le wizard peut-il casser un mapping B2B ? | ⚠️ Le wizard peut modifier `nom_produit` et `code_produit` d'un produit local importé B2B. Le mapping reste valide (par ID) mais l'affichage peut diverger. |
| Fournisseur/client bien séparés ? | ✅ Oui — `supplier_id` verrouillé en update, mapping B2B par table séparée |
| Conflits avec catalogue fournisseur ? | ⚠️ Pas de sync bidirectionnelle implémentée. Les modifications wizard sont locales. |
| Future facture distinguera produit fournisseur/inventaire ? | ✅ Oui — design propre (`commande_lines` snapshot le produit_id, pas l'article) |

---

## SECTION I — Audit Interactions Autres Modules

### Inventaire

| Aspect | Statut | Risque |
|--------|--------|--------|
| Stock events | ✅ Sain — product_id FK, pas d'article_id dans events | — |
| Alertes stock | ✅ Sain — lit `min_stock_quantity_canonical` | — |
| Articles inventaire | ⚠️ FK `inventory_article_id` existe mais absent du type TS | Lectures incomplètes |
| Seuils article | ⚠️ `threshold_product_id` pas géré par wizard | Pas de porteur auto |

### Commandes

| Aspect | Statut | Risque |
|--------|--------|--------|
| Produits commandables | ✅ Via `products_v2` + `b2b_partnerships` | — |
| Unités | ✅ `canonical_unit_id` sur `commande_lines` | — |
| Prix | ✅ `unit_price_snapshot` figé à l'envoi | — |

### DLC

| Aspect | Statut | Risque |
|--------|--------|--------|
| Seuils | ⚠️ `dlc_warning_days` persisté hors RPC | État partiel possible (C2) |
| Lecture critique | ✅ `dlcCompute.ts` résout correctement la chaîne de priorité | — |

### Alertes Prix

| Aspect | Statut | Risque |
|--------|--------|--------|
| Source prix | ✅ `final_unit_price` SSOT | — |
| Déclenchement | ✅ Basé sur variation `final_unit_price` entre extractions | — |

### Future Facture

| Aspect | Statut | Risque |
|--------|--------|--------|
| Lisibilité produit | ✅ `product_name_snapshot` dans les lignes | — |
| Prix | ✅ Figé dans snapshots | — |
| Packaging | ✅ Non nécessaire pour facture (unité canonique suffit) | — |

---

## SECTION J — Audit UX / Compréhension Utilisateur

### Points Forts
- Wizard guidé en 8 étapes avec progress bar
- Validation visuelle (badge vert/ambre, messages d'erreur inline)
- Shortcuts pour naviguer entre étapes
- Résumé final avec inline edit

### Points Faibles

| Problème | Sévérité | Détail |
|----------|----------|--------|
| **Confusion "Unité de référence" vs "Unité de stock"** | 🟡 | L'utilisateur voit "Pièce" en Step 2, mais l'unité de stock peut être différente en Step 5. Pas d'explication de la différence. |
| **Step 7 Article trop abstrait** | 🟡 | "Regrouper les produits fournisseur identiques" — pas d'exemple concret (ex: "2 fournisseurs de Lasagne = 1 article Lasagne") |
| **Packaging Level noms techniques** | 🟡 | "type_unit_id", "contains_unit_id" — l'utilisateur voit des noms techniques dans les erreurs de validation |
| **DLC "hériter du paramètre global"** | ✅ | Bien expliqué dans le placeholder |
| **Résumé Step 8 catégorie en texte** | 🟡 | Incohérence avec Step 6 qui utilise UUID. Un utilisateur peut choisir "Légumes" en Step 6 et "LÉGUMES (valeur IA)" en Step 8. |

---

## SECTION K — Audit Technique / Taille / Complexité

| Fichier | Rôle | Lignes | Criticité | Risque | Recommandation |
|---------|------|--------|-----------|--------|---------------|
| `ProductFormV3Modal.tsx` | Wizard modal principal | **918** | 🔴 Critique | Mélange UI + logique métier + persistance | **split** |
| `useWizardState.ts` | State wizard | 655 | 🟡 Élevé | Acceptable mais gros | keep |
| `productsV2Service.ts` | Service layer | **885** | 🔴 Critique | Trop de responsabilités | **split** |
| `WizardStep5.tsx` | Résumé | 691 | 🟡 Élevé | BFS dupliqué | **refactor** |
| `WizardStep5Stock.tsx` | Zone & Stock | 349 | ✅ OK | — | keep |
| `WizardStep7Article.tsx` | Article inventaire | 253 | ✅ OK | — | keep |
| `WizardStepIdentity.tsx` | Identité | 132 | ✅ OK | — | keep |
| `resolveProductUnitContext.ts` | SSOT unités | 500 | 🟡 Élevé | Complexe mais nécessaire | document |
| `conversionGraph.ts` | Graphe BFS | 233 | 🟡 Élevé | — | keep |
| `engine.ts` | Moteur calcul | 298 | ✅ OK | — | keep |
| `wizardGraphValidator.ts` | Validation | 383 | ✅ OK | — | keep |
| `priceDisplayResolver.ts` | Prix display | 187 | ✅ OK | — | keep |
| `types.ts` (produitsV2) | Types | 282 | ✅ OK | Manque `inventory_article_id` | **fix** |
| `isProductInventoryEligible.ts` | Éligibilité | 99 | ✅ OK | — | keep |

---

## SECTION L — Code Mort / Incohérences / Dette

### Code Mort

| Élément | Fichier | Statut |
|---------|---------|--------|
| `BASE_UNIT_ABBREVIATIONS` | `conditionnementV2/types.ts` | Dead — vide `{}` avec `@deprecated` |
| `PACKAGING_TYPE_SUGGESTIONS` | `conditionnementV2/types.ts` | Dead — vide `[]` avec `@deprecated` |
| `BASE_UNIT_SUGGESTIONS` | `conditionnementV2/types.ts` | Dead — vide `[]` avec `@deprecated` |
| `supplier_name` (lecture) | `ProductV2` type | Legacy read-only — polluant |
| `supplier_billing_unit` (texte) | `ProductV2` type | Legacy read-only — polluant |
| `final_unit` (texte) | `ProductV2` type | Legacy read-only — polluant |
| `category` (texte) | `ProductV2` type | ⚠️ Encore écrit activement (dual write!) |
| `createOrUpdateProductV2` | `productsV2Service.ts` | Legacy wrapper — à supprimer |

### Incohérences Création vs Édition

| Aspect | Création | Édition |
|--------|----------|---------|
| **Chemin** | `upsert.mutateAsync` → `upsertProductV2` | `fn_save_product_wizard` RPC |
| **DLC** | Inclus dans payload `dlc_warning_days` | Séparé hors RPC (`supabase as any`) |
| **Stock init** | Auto via `fn_initialize_product_stock` dans `createProductV2` | Re-init si famille change |
| **Article** | `persistInventoryArticle` after | `persistInventoryArticle` after |
| **Supplier_id** | Passé dans payload | Non modifiable (verrouillé) |
| **Zone** | Directe dans payload | Atomique via RPC avec transfer |

### `initialStockQuantity` — Champ Fantôme

Le champ `initialStockQuantity` est dans le wizard state (Step 6, création only), avec un input pour "Stock actuel dans cette zone", mais **n'est jamais inclus dans le payload de création** (ni dans `handleValidate`, ni dans `upsertProductV2`). C'est un champ purement visuel sans effet → UX trompeur (M4).

---

## SECTION M — Pré-requis Avant la Suite

### P0 — Bloquants

| # | Problème | Impact | Preuve | Recommandation | Risque si non corrigé |
|---|----------|--------|--------|---------------|----------------------|
| **P0-1** | `ProductV2` type ne contient pas `inventory_article_id` | Lectures standard ne détectent pas les produits liés | `types.ts` ligne 27-104 vs `supabase/types.ts` ligne 4651 | Ajouter `inventory_article_id: string \| null` au type + au `fetchProductV2ById` select | Wizard Step 7 ne peut pas pré-remplir en édition |
| **P0-2** | `dlc_warning_days` persisté hors RPC atomique | État partiel possible (produit modifié, DLC pas) | `ProductFormV3Modal.tsx` lignes 447-455 | Intégrer dans `fn_save_product_wizard` RPC | DLC critique non mise à jour |
| **P0-3** | `persistInventoryArticle` utilise `(supabase as any)` sans gestion erreur retour | Article créé mais jamais lié au produit silencieusement | `ProductFormV3Modal.tsx` lignes 268-275 | Vérifier le retour de `.update()`, utiliser le type correct, gérer l'erreur | Fausses ruptures inventaire |

### P1 — Moyens

| # | Problème | Impact | Recommandation | Risque si non corrigé |
|---|----------|--------|---------------|----------------------|
| **P1-1** | Step 8 catégorie en texte au lieu de UUID | Double vérité catégorie | Aligner `onCategoryChange` Step 8 sur UUID comme Step 6 | Catégorie incohérente |
| **P1-2** | `initialStockQuantity` jamais persisté | UX trompeur — l'utilisateur saisit un stock initial qui n'est pas enregistré | Soit persister via `fn_initialize_product_stock`, soit supprimer le champ | Utilisateur pense avoir du stock |
| **P1-3** | `ProductFormV3Modal.tsx` 918 lignes | Maintenabilité faible | Extraire `usePersistProduct` hook, `useEditSave` hook, `useCreateSave` hook | Code fragile, bugs en cascade |
| **P1-4** | `WizardStep5.tsx` duplique logique BFS | Double logique inventoryOptions + priceDisplayOptions | Utiliser `resolveWizardUnitContext` depuis `resolveProductUnitContext.ts` | Divergence BFS entre wizard et runtime |
| **P1-5** | Legacy `createOrUpdateProductV2` encore exporté | Chemin d'écriture alternatif sans validation wizard | Supprimer ou marquer internal-only | Produits créés sans validation graphe |

### P2 — Dette Acceptable

| # | Problème | Recommandation |
|---|----------|---------------|
| **P2-1** | Champs deprecated (`supplier_name`, `final_unit`, `supplier_billing_unit`) toujours dans types | Supprimer progressivement + migration DB drop columns |
| **P2-2** | `BASE_UNIT_ABBREVIATIONS`, `PACKAGING_TYPE_SUGGESTIONS`, `BASE_UNIT_SUGGESTIONS` vides | Supprimer les exports deprecated |
| **P2-3** | `useProductV2Mutations.update` passe `supplier_id` qui sera bloqué | Retirer `supplier_id` du flux update du hook |
| **P2-4** | `patchWizardFields` commentaire dit "NEVER touches category/storage_zone" mais les accepte | Aligner commentaire sur la whitelist réelle |
| **P2-5** | `productsV2Service.ts` 885 lignes | Split en `productsV2Create.ts`, `productsV2Update.ts`, `productsV2Upsert.ts`, `productsV2Query.ts` |

---

## Réponses Explicites aux 7 Questions

### 1. Le module Produits a-t-il une seule vérité par donnée critique ?
**✅ Globalement oui**, avec 2 exceptions :
- `category` (texte) et `category_id` (UUID) coexistent avec écriture duale
- `inventory_article_id` absent du type TypeScript

### 2. Le Wizard est-il la bonne porte d'entrée métier ?
**⚠️ Oui mais pas la seule** — `createOrUpdateProductV2` (legacy) et `useProductV2Mutations.create` (hook direct) contournent les validations du wizard (graphe BFS, cohérence, article inventaire).

### 3. Le prix est-il bien cadré ?
**✅ Oui** — `final_unit_price` est la SSOT absolue, jamais modifié en lecture, snapshots figés pour factures. Les chemins d'écriture convergent vers la même colonne.

### 4. Les unités/packaging/BFS sont-ils cohérents ?
**✅ Oui** — architecture UUID-only avec validation graphe pré-save. Seul risque : duplication BFS dans Step 8 résumé.

### 5. Le lien avec Articles Inventaire est-il propre ?
**⚠️ Non** — type incomplet (P0-1), persistance fragile (P0-3), pas de gestion du porteur depuis le wizard.

### 6. Le module risque-t-il de casser plus tard ?
- **Inventaire :** ⚠️ Oui si P0-1 et P0-3 ne sont pas corrigés
- **Commandes :** ✅ Non — design compatible
- **B2B :** ✅ Non — isolation propre
- **Facture :** ✅ Non — snapshots protègent

### 7. Peut-on considérer le module clean pour la V0 élargie ?
**GO CONDITIONNEL** — Après correction des 3 P0, le module est suffisamment solide. Les P1 doivent suivre rapidement.
