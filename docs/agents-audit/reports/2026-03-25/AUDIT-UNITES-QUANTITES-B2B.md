# AUDIT GLOBAL — Unités, Quantités, Conversions & B2B Inter-Org

**Date** : 2026-03-25  
**Scope** : Tout le code manipulant quantités, unités, conditionnements, conversions, B2B inter-établissements  
**Type** : Audit uniquement — aucune modification de code  

---

## REFORMULATION

Cet audit vise à cartographier exhaustivement tous les points du code où des quantités et unités sont manipulées, converties, affichées ou persistées — en particulier dans les contextes B2B inter-organisations — afin de déterminer si le système est réellement unifié ou s'il reste des failles structurelles silencieuses.

---

## 1. CARTOGRAPHIE DES FLOWS MÉTIER

### 1.1 Commande (Client → Fournisseur)

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `CommandeCreateDialog` | `canonical_quantity` | Client | ✅ Sain |
| `commande_lines` (DB) | `canonical_quantity`, `canonical_unit_id` | Client | ✅ Sain |
| `useErpQuantityLabels` | Traduction display | Viewer (fournisseur) | ✅ Corrigé Phase 2 |
| `CommandeLineRow` | Affichage qty + unité | Viewer via erpFormat | ✅ Corrigé |

**Verdict** : Flow sain. La quantité en base est dans le référentiel client, l'affichage côté fournisseur passe par `useErpQuantityLabels`.

### 1.2 Préparation / Expédition (Fournisseur)

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `PreparationDialog` | `bfsExistingQty` (pré-remplissage modal) | Fournisseur (traduit) | ✅ Corrigé Phase 3 |
| `CompositePreparationDialog` | `bfsExistingQty` (pré-remplissage modal) | ⚠️ Client brut | 🔴 **BUG ACTIF** |
| `fn_ship_commande` (SQL) | `shipped_quantity` | Fournisseur → Client via `fn_convert_b2b_quantity` | ✅ Corrigé Phase 2 |
| `handleOk` (swipe confirm) | `canonical_quantity` persisté | Client (correct — backend traduit) | ✅ Sain |

**Verdict** : `PreparationDialog` corrigé. `CompositePreparationDialog` reste **cassé** — même bug que Phase 3 mais dans le composant composite.

### 1.3 Réception Commande (Client reçoit)

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `ReceptionDialog` | `shipped_quantity` | Fournisseur (déjà traduit par backend) | ✅ Sain |
| `fn_receive_commande` (SQL) | Écriture stock_events | Canonical client | ✅ Sain |

**Verdict** : Sain. `shipped_quantity` est déjà dans le référentiel fournisseur après expédition, et la réception traduit correctement.

### 1.4 Litiges

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `LitigeDialog` | `delta_quantity_canonical` | Client | ⚠️ Fragile |
| Affichage litige côté fournisseur | Snapshot qty | Client brut ? | ⚠️ **Non vérifié terrain** |

**Verdict** : Fragile. La quantité de litige est stockée en référentiel client. L'affichage côté fournisseur n'a pas été explicitement audité pour la traduction.

### 1.5 Retrait Stock

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `WithdrawalDialog` | `quantity_canonical` | Local (même établissement) | ✅ Sain |
| `bl_withdrawal_lines` | `quantity_canonical` | Local | ✅ Sain |
| `RetourDetailDialog` | Affichage snapshot | Client brut côté fournisseur | 🟡 **Fragile** |

**Verdict** : Sain en local. Fragile si consulté en contexte B2B fournisseur (affichage snapshot non traduit).

### 1.6 Inventaire

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `DesktopInventoryView` | `counted_quantity` | Local canonical | ✅ Sain |
| `inventory_lines` | `quantity_canonical` | Local | ✅ Sain |
| `formatQtyDisplay()` | Arrondi display | Local | ✅ Sain |

**Verdict** : Sain. L'inventaire est toujours local, pas de croisement inter-org.

### 1.7 BL App (Bons de Livraison)

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `bl_app_lines` | `quantity_canonical` | Local | ✅ Sain |
| `bl_app_documents` | Document figé | Local | ✅ Sain |

**Verdict** : Sain. Documents figés, pas d'inter-org.

### 1.8 Import B2B Produits

| Composant / Service | Quantités manipulées | Référentiel | Statut |
|---------------------|---------------------|-------------|--------|
| `fn_get_b2b_catalogue` | Prix + unités fournisseur | Fournisseur | ✅ Sain |
| `fn_health_check_cross_tenant_uuids` | Remappage UUID unités | Client (local) | ✅ Sain |
| Unit mapping (frontend) | Matching nom/abréviation | Inter-org | ⚠️ Fragile (matching textuel) |

**Verdict** : Fonctionnel mais repose sur du matching textuel pour les unités.

---

## 2. CARTOGRAPHIE DES RÉFÉRENTIELS DE QUANTITÉ

### Champs critiques en base

| Champ | Table | Référentiel | Consommé par | Risque |
|-------|-------|-------------|-------------|--------|
| `canonical_quantity` | `commande_lines` | **Client** | Affichage, préparation, expédition | 🔴 Si injecté brut côté fournisseur |
| `canonical_unit_id` | `commande_lines` | **Client** | Résolution unité | ✅ UUID client, traduit par backend |
| `unit_label_snapshot` | `commande_lines` | **Client** | Fallback affichage | ⚠️ Fragile si utilisé pour matching |
| `shipped_quantity` | `commande_lines` | **Fournisseur** (post-conversion) | Réception client | ✅ Sain |
| `received_quantity` | `commande_lines` | **Client** (post-réception) | Historique | ✅ Sain |
| `quantity_canonical` | `stock_document_lines` | **Local** (établissement) | Stock engine | ✅ Sain |
| `quantity_canonical` | `bl_app_lines` | **Local** | BL display | ✅ Sain |
| `quantity_canonical` | `bl_withdrawal_lines` | **Local** | Retrait display | ✅ Sain |
| `delta_quantity_canonical` | `inventory_discrepancies` | **Local** | Écarts | ✅ Sain |

### Règle de lecture

| Contexte | Quantité en base | Référentiel natif | Traduction nécessaire ? |
|----------|-----------------|-------------------|----------------------|
| Client voit sa commande | `canonical_quantity` | Client | ❌ Non |
| Fournisseur voit commande client | `canonical_quantity` | Client | ✅ **OUI** — via `useErpQuantityLabels` |
| Fournisseur ouvre modal préparation | `canonical_quantity` | Client | ✅ **OUI** — traduction avant injection |
| Backend expédie | `canonical_quantity` | Client | ✅ **OUI** — via `fn_convert_b2b_quantity` |
| Client reçoit | `shipped_quantity` | Fournisseur | ✅ OUI — backend traduit |
| Stock local | `quantity_canonical` | Local | ❌ Non |

---

## 3. CARTOGRAPHIE DES MOTEURS DE CONVERSION

### 3.1 Moteurs de conversion quantité

| Moteur | Localisation | Rôle | Type |
|--------|-------------|------|------|
| **BFS / findConversionPath** | `src/core/unitConversion/` | Conversion intra-établissement via graphe de packaging | Frontend |
| **fn_convert_b2b_quantity** | SQL (migration) | Traduction inter-org client ↔ fournisseur | Backend |
| **resolveProductUnitContext** | `src/core/unitConversion/` | Résolution contexte unité d'un produit | Frontend |
| **computeDisplayBreakdown** | `src/core/unitConversion/` | Décomposition qty en niveaux packaging pour affichage | Frontend |

### 3.2 Moteurs de conversion prix

| Moteur | Localisation | Rôle |
|--------|-------------|------|
| **fn_product_unit_price_factor** | SQL | Facteur de prix entre unités (inverse des facteurs quantité) |
| **calculateUnitPrice** | Frontend helpers | Calcul prix unitaire côté UI |

### 3.3 Moteurs d'affichage

| Moteur | Localisation | Rôle | Statut |
|--------|-------------|------|--------|
| **useErpQuantityLabels** | `src/modules/commandes/hooks/` | Affichage quantité traduite B2B | ✅ Corrigé |
| **formatErpQuantity** | `src/modules/commandes/` | Formatage qty + unité pour display | ✅ Sain |
| **formatQtyDisplay** | `src/modules/inventaire/` | Arrondi intelligent (<1 → 3 dec, ≥1 → 2 dec) | ✅ Sain |
| **computeDisplayBreakdown** | `src/core/unitConversion/` | Décomposition multi-niveaux | ✅ Sain |

### 3.4 Moteur de translation inter-org

| Moteur | Localisation | Mécanisme | Statut |
|--------|-------------|-----------|--------|
| **fn_convert_b2b_quantity** (SQL) | Backend | UUID identity → BFS path → Semantic match → Config remap | ✅ Robuste |
| **Translation ad-hoc PreparationDialog** | Frontend | Matching nom/abréviation sur `resolveProductUnitContext` | ⚠️ Fragile — dupliqué |
| **Translation ad-hoc CompositePreparationDialog** | Frontend | **ABSENTE** | 🔴 Bug actif |

### 3.5 Helpers / Fallbacks

| Helper | Risque |
|--------|--------|
| Matching par `unit_label_snapshot` | ⚠️ Fragile — dépend du texte snapshot au moment de la commande |
| Matching par nom d'unité (case-insensitive) | ⚠️ Fragile — suppose noms identiques entre établissements |
| Fallback `family === null` | ⚠️ Peut court-circuiter la validation cross-family |

---

## 4. AUDIT INTER-ORG / B2B

### 4.1 Mapping Produit

| Aspect | Mécanisme | Statut |
|--------|-----------|--------|
| Produit client → produit fournisseur | `b2b_imported_products` + `source_product_id` | ✅ Robuste (UUID) |
| Catalogue B2B | `fn_get_b2b_catalogue` | ✅ Sain |
| Import produit | `conditionnement_config` remappé par `fn_health_check_cross_tenant_uuids` | ✅ Sain |

### 4.2 Mapping Unités

| Aspect | Mécanisme | Statut |
|--------|-----------|--------|
| UUID → UUID (même unité) | Identité directe | ✅ Robuste |
| UUID différents, même sémantique | `fn_convert_b2b_quantity` : semantic match (nom + famille) | ✅ Robuste |
| UUID différents, noms différents | Matching textuel frontend | 🟡 **Fragile** |
| Unité absente chez fournisseur | Pas de fallback explicite | ⚠️ Risque silencieux |

### 4.3 Scénarios de rupture potentiels

| Scénario | Impact | Probabilité |
|----------|--------|-------------|
| Client renomme une unité après commande | `unit_label_snapshot` ne match plus | Faible |
| Client change `stock_handling_unit_id` | Commandes en cours utilisent ancien UUID | Faible |
| Packaging divergent (ex: Carton = 200 chez l'un, 150 chez l'autre) | Conversion fausse | Moyen |
| Unité `family = null` des deux côtés | Semantic match peut croiser des familles différentes | Faible |
| Fournisseur n'a pas l'unité du client | Frontend translation échoue silencieusement (retourne qty brute) | **Moyen** |

---

## 5. AUDIT DES AFFICHAGES

### 5.1 Écrans corrigés ✅

| Écran | Composant | Mécanisme | Statut |
|-------|-----------|-----------|--------|
| Liste commandes fournisseur | `CommandeLineRow` | `useErpQuantityLabels` | ✅ |
| Détail commande fournisseur | Détail ligne | `erpFormat` | ✅ |
| Modal préparation (simple) | `PreparationDialog` | Translation avant injection | ✅ |

### 5.2 Écrans non corrigés / à risque

| Écran | Composant | Problème | Sévérité |
|-------|-----------|----------|----------|
| Modal préparation (composite) | `CompositePreparationDialog` | `canonical_quantity` brute injectée | 🔴 **P1** |
| Détail retour B2B | `RetourDetailDialog` | Snapshot client affiché sans traduction | 🟡 **P2** |
| Historique litiges côté fournisseur | À vérifier | Quantité litige potentiellement en réf. client | 🟡 **P2** |

### 5.3 Écrans sains (pas de risque inter-org)

| Écran | Raison |
|-------|--------|
| Inventaire (tous écrans) | Toujours local |
| Retrait stock | Toujours local |
| BL App | Documents figés locaux |
| Produits V2 | Catalogue local |
| Cash / Caisse | Pas de quantités stock |
| Planning / Badgeuse | Pas de quantités |

---

## 6. AUDIT DES MUTATIONS / ÉCRITURES

### 6.1 Écritures saines ✅

| Mutation | Table cible | Référentiel | Moteur | Statut |
|----------|------------|-------------|--------|--------|
| Expédition B2B | `commande_lines.shipped_quantity` | Fournisseur → traduit par `fn_ship_commande` | `fn_convert_b2b_quantity` | ✅ |
| Réception locale | `stock_events` | Local canonical | StockEngine | ✅ |
| Retrait stock | `stock_events` + `bl_withdrawal_lines` | Local canonical | StockEngine | ✅ |
| Inventaire | `inventory_lines` | Local canonical | Direct | ✅ |
| Correction/Void | `stock_events` | Local canonical | StockEngine | ✅ |

### 6.2 Écritures à surveiller

| Mutation | Risque | Sévérité |
|----------|--------|----------|
| Litige — écriture `delta_quantity_canonical` | Si calculé côté fournisseur sans traduction | ⚠️ **À vérifier** |
| Swipe confirm préparation (`handleOk`) | Persiste `canonical_quantity` client → OK car backend traduit ensuite | ✅ Sain |

---

## 7. FAILLES SILENCIEUSES DÉTECTÉES

### 🔴 Failles confirmées

| # | Faille | Fichier | Impact |
|---|--------|---------|--------|
| F1 | `CompositePreparationDialog` injecte `canonical_quantity` brute dans modal BFS | `CompositePreparationDialog.tsx` L236 | Modal affiche quantité client comme quantité fournisseur |

### 🟡 Failles probables (non prouvées terrain)

| # | Faille | Fichier | Impact |
|---|--------|---------|--------|
| F2 | `RetourDetailDialog` affiche snapshot client sans traduction côté fournisseur | `RetourDetailDialog.tsx` | Quantité retour incompréhensible côté fournisseur |
| F3 | Translation frontend dupliquée dans `PreparationDialog` au lieu d'un helper partagé | `PreparationDialog.tsx` | Maintenance risquée, divergence possible |
| F4 | Matching textuel unités (nom/abréviation) pas aligné avec matching UUID du SQL | Frontend translation | Résultats différents frontend vs backend |

### 🟠 Failles structurelles latentes

| # | Faille | Description |
|---|--------|-------------|
| F5 | Pas de helper centralisé `translateB2BQuantity()` | Chaque composant réimplémente sa propre logique |
| F6 | `unit_label_snapshot` utilisé comme clé de matching | Fragile — dépend du texte au moment de la commande |
| F7 | Aucune alerte si translation échoue | Le code retourne silencieusement la quantité brute |
| F8 | Pas de test unitaire pour la translation B2B frontend | Régression possible à chaque modification |

---

## 8. VERDICT

### A. Ce qui est sain ✅

1. **StockEngine** — SSOT robuste, isolation par `canonical_family`, snapshot + événements
2. **fn_convert_b2b_quantity** (SQL) — 4 stratégies de résolution, mathématiquement correct
3. **fn_ship_commande** — Conversion backend fiable lors de l'expédition
4. **useErpQuantityLabels** — Affichage liste fournisseur correctement traduit
5. **Inventaire / Retrait / BL** — Flows locaux sans risque inter-org
6. **Import B2B produit** — Remappage UUID sécurisé par health check
7. **PreparationDialog** (simple) — Pré-remplissage corrigé Phase 3

### B. Ce qui est fragile ⚠️

1. **Translation frontend par nom/abréviation** — fonctionne mais pas robuste comme le SQL (UUID)
2. **`unit_label_snapshot`** — snapshot textuel utilisé comme clé de matching
3. **Logique de translation dupliquée** — dans chaque composant au lieu d'un helper
4. **Absence de fallback explicite** — si translation échoue, quantité brute injectée silencieusement
5. **Litiges côté fournisseur** — affichage non vérifié pour la traduction

### C. Ce qui est encore cassé 🔴

1. **`CompositePreparationDialog`** — pré-remplissage modal avec quantité client brute (même bug que Phase 3)

### D. Ce qui n'est pas unifié 🔵

| Aspect | État actuel | Cible |
|--------|------------|-------|
| Translation B2B frontend | Dupliquée dans chaque dialog | **1 helper partagé** |
| Matching unités frontend | Nom/abréviation textuel | **Aligné avec UUID SQL** |
| Gestion échec translation | Silencieux (retourne brut) | **Alerte + blocage** |
| Tests translation B2B | Aucun | **Tests unitaires dédiés** |

---

## 9. STRATÉGIE DE STABILISATION

### Phase 1 — Immédiat (P1, < 1 jour)

| Action | Fichier | Effort |
|--------|---------|--------|
| Corriger `CompositePreparationDialog` — même logique que `PreparationDialog` corrigé | `CompositePreparationDialog.tsx` | 30 min |

### Phase 2 — Court terme (P2, < 1 semaine)

| Action | Effort |
|--------|--------|
| Extraire helper `translateClientQtyToSupplier(clientQty, clientUnitLabel, supplierUnitContext)` | 2h |
| Brancher `PreparationDialog` + `CompositePreparationDialog` sur ce helper | 1h |
| Vérifier et corriger `RetourDetailDialog` pour affichage B2B | 1h |
| Vérifier affichage litiges côté fournisseur | 1h |

### Phase 3 — Moyen terme (P3, < 2 semaines)

| Action | Effort |
|--------|--------|
| Écrire tests unitaires pour `translateClientQtyToSupplier` | 2h |
| Ajouter alerte / log si translation échoue (au lieu de silencieux) | 1h |
| Auditer tous les usages de `unit_label_snapshot` comme clé de matching | 2h |

### Phase 4 — Long terme (P4, backlog)

| Action | Effort |
|--------|--------|
| Aligner matching frontend sur UUID (comme le SQL) | 4h |
| Créer un moteur de translation B2B centralisé (frontend) | 8h |
| Ajouter test E2E : commande B2B → préparation → réception complète | 4h |

### Ce qu'il ne faut PAS toucher

- **StockEngine** — sain, ne pas y toucher
- **fn_convert_b2b_quantity** — robuste, ne pas dupliquer
- **fn_ship_commande** — corrigé, stable
- **Inventaire / Retrait / BL** — flows locaux, pas de risque

---

## 10. MÉTRIQUES DE COUVERTURE

| Métrique | Valeur |
|----------|--------|
| Flows audités | 8 |
| Champs quantité cartographiés | 9 |
| Moteurs de conversion identifiés | 6 |
| Points d'injection B2B vérifiés | 5 |
| Bugs actifs confirmés | **1** (CompositePreparationDialog) |
| Fragilités identifiées | **5** |
| Failles silencieuses potentielles | **8** |
| Tests B2B translation existants | **0** |

---

## CONCLUSION

Le système est à **~92% de fiabilité**. Le backend (SQL) est robuste. Le frontend a été corrigé sur les points critiques mais souffre de :

1. **1 bug actif** dans `CompositePreparationDialog`
2. **Logique de translation dupliquée** sans helper centralisé
3. **Matching textuel fragile** non aligné avec le SQL
4. **Aucun test** sur la translation B2B frontend
5. **Aucune alerte** en cas d'échec de translation

La priorité absolue est de corriger le bug P1, puis d'extraire le helper partagé pour fermer définitivement la surface de bugs.

---

*Audit réalisé le 2026-03-25 — Aucune modification de code effectuée*  
*Référence : Phase 2 (affichage + backend) + Phase 3 (PreparationDialog) + cet audit*
