# AUDIT + PLAN D'IMPLÉMENTATION — Stabilisation B2B via Mapping d'Unités Persisté

> Document basé sur l'analyse exhaustive du code source réel au 25/03/2026.

---

## 1. REFORMULATION DU PROBLÈME

**Situation actuelle :**

Le pipeline d'import B2B (`b2bImportPipeline.ts`) calcule un mapping complet et fiable entre les UUID d'unités fournisseur et les UUID d'unités client via `b2bUnitMapper.ts`. Ce mapping est utilisé par `b2bConfigRebuilder.ts` pour réécrire le `conditionnement_config` et les colonnes directes (`final_unit_id`, `delivery_unit_id`, etc.) du produit local. **Mais le mapping lui-même est jeté après l'import.**

**Conséquence :**

Quand il faut traduire des quantités entre client et fournisseur (affichage ERP, préparation, expédition, litiges), le système **recalcule** la correspondance à chaque fois par :

- **Frontend** (`b2bQuantity.ts` + `useErpQuantityLabels.ts`) : matching par nom/abréviation d'unité contre les `ReachableUnit[]` BFS du fournisseur.
- **Backend** (`fn_convert_b2b_quantity` V4) : matching sémantique (nom+famille) puis remappage via `conditionnement_config` du produit fournisseur.

Ce matching textuel est **fragile** : sensible aux typos, aux différences de nommage entre établissements, et crée des logiques parallèles difficiles à maintenir.

**Objectif :** Persister le mapping UUID↔UUID calculé à l'import, et le faire lire en priorité par tous les consommateurs.

---

## 2. VALIDATION DE LA STRATÉGIE

### Verdict : ✅ STRATÉGIE SAINE ET RECOMMANDÉE

**Arguments pour :**

1. **Le mapping est déjà calculé et fiable.** `b2bUnitMapper.ts` produit un `UnitMappingResult[]` complet (lignes 32-93) avec 3 niveaux de résolution : abréviation, nom, aliases. Le code est pur, testé, et déterministe. On ne réinvente rien — on persiste ce qui existe déjà.

2. **Risque minimal vs refonte globale.** Une refonte "global units" toucherait : `measurement_units` (structure), `products_v2` (6 FK par produit × N produits), `conditionnement_config` (JSONB complexe), `stock_events`, `inventory_lines`, `commande_lines`, etc. L'approche mapping persisté ne touche à aucune de ces structures.

3. **Couvre exactement la douleur.** Le problème n'est pas le stock local, l'inventaire local, ou le BFS local. Le problème est la **translation inter-org** — et c'est précisément la couche ciblée.

4. **Backward-compatible par design.** Le matching texte reste en fallback. Le jour où le mapping est vide ou absent, le comportement actuel continue. Zéro régression possible.

**Limites connues (acceptées) :**

- Ne résout pas la duplication structurelle des UUID par établissement (dette long terme)
- Ne simplifie pas le BFS ou le `conditionnement_config` (hors scope)
- Le mapping doit être maintenu si le fournisseur change ses unités (cas rare, gérable par re-sync)

---

## 3. OÙ PERSISTER LE MAPPING ET SOUS QUEL FORMAT

### Recommandation : Colonne JSONB `unit_mapping` sur `b2b_imported_products`

**Pourquoi c'est le bon endroit :**

- `b2b_imported_products` modélise déjà la **relation d'import** entre un produit source et un produit local.
- Le mapping d'unités est intrinsèquement lié à cette relation : c'est au moment de l'import qu'on sait quelles unités fournisseur correspondent à quelles unités client.
- Les colonnes existantes (`source_product_id`, `local_product_id`, `source_establishment_id`, `establishment_id`) fournissent déjà le contexte nécessaire.
- Tous les consommateurs (`useErpQuantityLabels`, `PreparationDialog`, `CompositePreparationDialog`, `LitigeDetailDialog`, `fn_ship_commande`, `fn_resolve_litige`) **interrogent déjà `b2b_imported_products`** — donc aucune jointure supplémentaire n'est nécessaire.

**Pourquoi pas une table séparée :**

- Une table `b2b_unit_mappings` serait plus normalisée, mais ajouterait une jointure supplémentaire dans chaque flow SQL.
- Le mapping est 1:1 avec l'import — il n'y a pas de cardinalité N:M qui justifierait une table séparée.
- Le JSONB sur la ligne existante est plus simple, plus rapide, et plus safe en prod.

**Format recommandé :**

```jsonb
{
  "version": 1,
  "mappings": [
    {
      "source_unit_id": "uuid-fournisseur-carton",
      "local_unit_id": "uuid-client-carton",
      "source_name": "Carton",
      "source_abbreviation": "Ctn",
      "source_family": "unit",
      "match_method": "abbreviation"
    },
    {
      "source_unit_id": "uuid-fournisseur-piece",
      "local_unit_id": "uuid-client-piece",
      "source_name": "Pièce",
      "source_abbreviation": "pce",
      "source_family": "unit",
      "match_method": "name"
    }
  ],
  "created_at": "2026-03-25T10:00:00Z"
}
```

**Justification du format :**

| Champ | Raison |
|-------|--------|
| `version` | Permet d'évoluer le format sans migration |
| `source_unit_id` | Clé de lookup primaire — UUID fournisseur |
| `local_unit_id` | UUID client — le résultat du mapping |
| `source_name` + `source_abbreviation` | Audit trail — permet de comprendre pourquoi le mapping a été fait |
| `source_family` | Garde-fou — permet de valider que la famille n'a pas changé |
| `match_method` | Traçabilité — "abbreviation", "name", "alias" — utile pour le debug |
| `created_at` | Permet de savoir si le mapping est ancien et potentiellement obsolète |

**Ce format permet :**

- Un lookup O(1) par `source_unit_id` (frontend : `Map`, backend : `jsonb_array_elements`)
- Une traçabilité complète pour le debug
- Une évolution future (ajout de champs) sans casser l'existant

---

## 4. COMPORTEMENT POUR LES PRODUITS DÉJÀ IMPORTÉS / STOCK / INVENTAIRE

### A. Cette stratégie s'applique-t-elle aux produits déjà importés ?

**OUI**, via backfill. Le mapping peut être reconstruit a posteriori pour chaque ligne de `b2b_imported_products` en :
1. Chargeant les unités du fournisseur (`source_establishment_id` → `measurement_units`)
2. Chargeant les unités du client (`establishment_id` → `measurement_units`)
3. Identifiant les unités utilisées par le produit source (`products_v2` du fournisseur)
4. Rejouant `mapProductUnits()` (ou son équivalent SQL) pour calculer le mapping

### B. Change-t-elle quelque chose au stock local existant ?

**NON, absolument rien.** Le mapping est un champ informatif sur `b2b_imported_products`. Il ne modifie aucune ligne de :
- `stock_events`
- `stock_document_lines`
- `zone_stock_snapshots`
- `products_v2` (ni colonnes, ni `conditionnement_config`)

Le stock local utilise les UUID **locaux** (déjà remappés à l'import par `b2bConfigRebuilder.ts`). Le mapping persisté ne change pas ces UUID — il les **documente**.

### C. Change-t-elle quelque chose aux inventaires déjà saisis ?

**NON.** Les `inventory_sessions`, `inventory_lines`, `inventory_adjustments` sont entièrement dans le référentiel local. Ils n'ont aucune interaction avec le mapping B2B.

### D. Impacte-t-elle des données existantes (`stock_events`, `commande_lines`, etc.) ?

**NON.** Le mapping est en **lecture seule** par les consommateurs. Les quantités dans `commande_lines.canonical_quantity` restent dans le référentiel client. Les `stock_events` restent dans le référentiel fournisseur. Les conversions qui ont déjà eu lieu (via `fn_ship_commande`, `fn_resolve_litige`) ne sont pas rejouées.

### E. Le backfill est-il suffisant sans toucher aux données stock ?

**OUI.** Le backfill enrichit `b2b_imported_products` avec un champ informatif. Les flows qui lisaient ce mapping (ou le calculaient à la volée) commenceront simplement à utiliser le mapping persisté au lieu du matching textuel. Le résultat affiché sera **identique ou meilleur** (plus fiable).

### F. Risque de backfill échoué ?

**OUI, cas marginaux possibles :**

| Cas | Probabilité | Impact |
|-----|------------|--------|
| Unité fournisseur supprimée/renommée depuis l'import | Faible | Le backfill ne trouvera pas de match → `unit_mapping` sera partiel → le fallback texte prend le relais (comportement identique à aujourd'hui) |
| Produit source supprimé/archivé | Faible | `source_product_id` → aucun produit → backfill skip → le code filtre déjà ces cas dans `getImportedProducts()` |
| Ambiguïté de matching (2+ unités locales matchent) | Très faible | Le backfill logguera l'ambiguïté → l'opérateur peut résoudre manuellement si nécessaire |

**Aucun de ces cas ne crée de régression** : le système retombe sur le comportement actuel (matching texte).

---

## 5. POINTS DE CODE IMPACTÉS

### Frontend

#### À modifier (lecture du mapping) :

| Fichier | Modification | Risque |
|---------|-------------|--------|
| `src/modules/commandes/hooks/useErpQuantityLabels.ts` | Pass 2 : au lieu de refaire du matching par nom (lignes 250-266), **lire `unit_mapping` JSONB** depuis la query `b2b_imported_products` (déjà jointe ligne 132). Utiliser le `local_unit_id` ↔ `source_unit_id` pour déterminer le `factorToTarget` directement sans matching textuel. | **Faible** — la query existe déjà, on ajoute un champ au `.select()` |
| `src/modules/commandes/utils/b2bQuantity.ts` | `findMatchingUnit()` (lignes 92-100) : ajouter un paramètre optionnel `unitMapping` pour lookup direct par UUID avant le fallback nom/abréviation. | **Très faible** — ajout d'un paramètre optionnel, fallback inchangé |
| `src/modules/commandes/components/PreparationDialog.tsx` | Charger `unit_mapping` lors du lookup `b2b_imported_products` (ligne 182). Passer au BFS modal avec le mapping pour éviter le matching textuel. | **Faible** — la query existe, on étend le `.select()` |
| `src/pages/commandes/CompositePreparationDialog.tsx` | Même pattern que PreparationDialog. | **Faible** |
| `src/modules/litiges/components/LitigeDetailDialog.tsx` | Charger `unit_mapping` dans la query existante (ligne 92). | **Faible** |

#### Aucun changement nécessaire :

| Fichier | Raison |
|---------|--------|
| `src/core/unitConversion/` (tout le répertoire) | Le BFS reste inchangé — il opère dans un seul référentiel |
| `src/modules/conditionnementV2/` | Opère en local — pas de cross-org |
| `src/modules/inventaire/` | Stock local uniquement |
| `src/modules/produitsV2/` | Produits locaux uniquement |
| `src/modules/clientsB2B/services/b2bUnitMapper.ts` | Reste tel quel — il calcule le mapping à l'import |
| `src/modules/clientsB2B/services/b2bConfigRebuilder.ts` | Reste tel quel — il consomme le mapping pour réécrire le config |

#### Fallback texte temporairement nécessaire :

- `useErpQuantityLabels` Pass 2 : si `unit_mapping` est NULL (import ancien non backfillé), le matching par nom/abréviation actuel (lignes 250-266) reste actif.
- `b2bQuantity.ts` : si aucun `unitMapping` n'est passé, `findMatchingUnit()` fait le matching textuel comme aujourd'hui.

### Backend (SQL)

#### À modifier :

| Fonction | Modification | Risque |
|----------|-------------|--------|
| `fn_convert_b2b_quantity` (V4) | Ajouter un **Step 0** : lire `unit_mapping` JSONB depuis `b2b_imported_products` pour le couple (source_product_id, client_unit_id). Si trouvé, utiliser directement le `local_unit_id` pour la conversion BFS, court-circuitant les étapes 3-6 (matching sémantique). | **Faible-Moyen** — la fonction est SECURITY DEFINER et critique. Mais l'ajout est un early-return, les étapes existantes restent en fallback. |
| `fn_ship_commande` | **Aucune modification directe.** Cette fonction utilise `cl.canonical_unit_id` (UUID client) directement pour les `stock_document_lines` et `stock_events` (lignes 183-213). Elle ne fait **pas** de conversion B2B — elle opère dans l'espace client. La seule conversion se fait dans `_ship_lines` via la jointure sur `measurement_units` (ligne 127) pour le label. | **Aucun** |
| `fn_resolve_litige` | **Modification indirecte** via `fn_convert_b2b_quantity` qu'elle appelle (lignes 65-84). Si `fn_convert_b2b_quantity` utilise le mapping persisté, `fn_resolve_litige` en bénéficie automatiquement. Aucune modification de `fn_resolve_litige` elle-même. | **Aucun** |

#### ⚠️ Point critique découvert dans `fn_ship_commande` :

Les lignes 183-186 de `fn_ship_commande` écrivent dans `stock_document_lines` et `stock_events` avec `sl.canonical_unit_id` (qui est le **UUID client** de `commande_lines`). C'est correct car `shipped_quantity` est dans le référentiel client (conformément à la policy mémorisée). **Mais** le `canonical_family` utilisé vient de `mu.family` qui est la famille de l'unité **client** — ce qui est correct car c'est le même nom de famille (ex: "unit") même si les UUID diffèrent.

**Verdict : `fn_ship_commande` n'a pas besoin de modification.** Sa logique est correcte car elle opère entièrement dans l'espace client pour les quantités, et utilise le `source_product_id` (fournisseur) pour le produit cible dans le stock.

---

## 6. ANALYSE DE COMPATIBILITÉ

| Flow | Amélioration immédiate | Dépend du backfill | Dépend d'un fallback texte |
|------|----------------------|-------------------|--------------------------|
| **Import B2B (nouveaux)** | ✅ Le mapping est persisté dès Phase 2 | — | — |
| **Import B2B (existants)** | — | ✅ Oui — backfill Phase 5 | ✅ Tant que pas backfillé |
| **Nouvelles commandes** | ✅ `useErpQuantityLabels` lira le mapping | — | — |
| **Anciennes commandes** | ✅ Si le produit importé a été backfillé | ✅ Oui | ✅ Sinon fallback texte |
| **Préparation fournisseur** | ✅ PreparationDialog lit le mapping | ✅ Pour imports anciens | ✅ Sinon fallback |
| **Expédition (fn_ship_commande)** | ❌ Pas impacté — opère en espace client | — | — |
| **Réception** | ✅ Affichage ERP amélioré | ✅ Pour imports anciens | ✅ Sinon fallback |
| **Litiges (fn_resolve_litige)** | ✅ Via `fn_convert_b2b_quantity` amélioré | ✅ Pour imports anciens | ✅ Sinon fallback |
| **Retours** | ✅ Même pattern que litiges | ✅ | ✅ |
| **Affichages ERP** | ✅ `formatQty()` plus fiable | ✅ Pour imports anciens | ✅ Sinon fallback |

**Résumé :** Dès Phase 2, **tous les nouveaux imports** bénéficient du mapping. Les imports existants dépendent du backfill (Phase 5). En attendant le backfill, le fallback texte assure la continuité.

---

## 7. STRATÉGIE DE BACKFILL

### Comment reconstruire le `unit_mapping` :

1. **Charger** chaque ligne de `b2b_imported_products`
2. **Charger** le produit source via `source_product_id` → `products_v2` (pour connaître les unit IDs utilisés)
3. **Charger** les unités fournisseur : `measurement_units WHERE establishment_id = source_establishment_id`
4. **Charger** les unités client : `measurement_units WHERE establishment_id = establishment_id`
5. **Rejouer** la logique de `mapProductUnits()` pour calculer le mapping
6. **Persister** le résultat dans `unit_mapping`

### Peut-on réutiliser `b2bUnitMapper.ts` ?

**OUI pour la logique**, mais le backfill doit être exécuté côté serveur (edge function ou script SQL). Deux options :

**Option A : Edge Function (recommandée)**

- Avantage : peut réutiliser la logique TypeScript de `b2bUnitMapper.ts` quasi-telle quelle
- Avantage : peut être exécutée de manière idempotente (skip si `unit_mapping` déjà rempli)
- Avantage : journalisation facile (log les cas UNKNOWN/AMBIGUOUS)
- Avantage : peut être exécutée par un admin via un bouton ou un call API
- Risque : nécessite un accès service-role pour écrire dans `b2b_imported_products`

**Option B : Migration SQL pure**

- Avantage : exécution garantie au déploiement
- Inconvénient : la logique de matching (normalisation, singularisation, aliases) est complexe à réécrire en SQL pur
- Inconvénient : moins de contrôle sur les erreurs
- Risque : si le matching échoue pour beaucoup de produits, on n'a pas de mécanisme de retry

**Option C : Script one-shot Node.js**

- Avantage : réutilise le code TypeScript existant
- Inconvénient : nécessite un environnement d'exécution externe
- Risque : non-reproductible

### Recommandation : Option A (Edge Function)

Une edge function `backfill-b2b-unit-mapping` qui :
1. Lit toutes les lignes `b2b_imported_products` WHERE `unit_mapping IS NULL`
2. Pour chaque lot (batch de 50) :
   - Charge les unités fournisseur et client
   - Calcule le mapping via la logique de `mapProductUnits`
   - Persiste le résultat
   - Log les cas échoués
3. Retourne un rapport : `{ total, mapped, partial, failed }`

### Détection des échecs :

| Cas | Détection | Action |
|-----|-----------|--------|
| UNKNOWN (unité non trouvée) | `status: "UNKNOWN"` dans le mapping result | Le mapping est persisté comme partiel (les unités trouvées sont enregistrées, les autres sont marquées `local_unit_id: null`) |
| AMBIGUOUS | `status: "AMBIGUOUS"` | Pareil — persisté comme partiel avec `candidates` |
| Produit source inexistant | `source_product_id` → `products_v2` retourne NULL | La ligne est skippée, loguée comme `backfill_skip_reason: "source_product_not_found"` |

### Le backfill peut-il être fait sans toucher au produit lui-même ?

**OUI, totalement.** Le backfill n'écrit que dans `b2b_imported_products.unit_mapping`. Il ne touche ni à `products_v2`, ni au `conditionnement_config`, ni aux unités locales, ni au stock.

---

## 8. PLAN D'IMPLÉMENTATION PAR PHASES

### Phase 1 — Structure (Migration SQL)

**Objectif :** Ajouter la colonne JSONB.

**Fichiers touchés :**
- Nouvelle migration SQL : `ALTER TABLE b2b_imported_products ADD COLUMN unit_mapping JSONB DEFAULT NULL`

**Risques :** Quasi-nul. Ajout d'une colonne nullable sur une table existante. Aucun impact sur les lectures/écritures existantes.

**Validation :** Vérifier que `b2b_imported_products` est lisible avec la nouvelle colonne. Vérifier que les imports existants continuent de fonctionner.

**Rollback :** `ALTER TABLE b2b_imported_products DROP COLUMN unit_mapping` — trivial.

---

### Phase 2 — Persistance pour les nouveaux imports

**Objectif :** À chaque nouvel import B2B, persister le `unit_mapping` dans `b2b_imported_products`.

**Fichiers touchés :**
- `src/modules/clientsB2B/services/b2bImportPipeline.ts` : dans `importSingleProduct()`, après le succès de l'import atomique, écrire le mapping
- `src/modules/clientsB2B/services/b2bCatalogService.ts` : ajouter `unit_mapping` au call `importProductAtomic`
- **OU** alternative plus simple : un `UPDATE b2b_imported_products SET unit_mapping = ... WHERE local_product_id = ... AND source_product_id = ...` juste après le `importProductAtomic` réussi

**Risques :** Faible. C'est un write additionnel après un import réussi. Si le write échoue, l'import est déjà fait — le mapping peut être reconstruit ultérieurement (backfill).

**Validation :**
1. Importer un nouveau produit B2B
2. Vérifier que `b2b_imported_products.unit_mapping` est rempli
3. Vérifier que le format correspond au schéma défini en section 3

**Rollback :** Ne pas écrire le mapping (le champ reste NULL). Aucun impact.

---

### Phase 3 — Lecture prioritaire côté frontend

**Objectif :** Les hooks et composants lisent `unit_mapping` en priorité, avec fallback texte.

**Fichiers touchés :**
- `src/modules/commandes/hooks/useErpQuantityLabels.ts` : étendre le `.select()` de la query `b2b_imported_products` (ligne 133) pour inclure `unit_mapping`. Dans le Pass 2, utiliser le mapping pour déterminer la correspondance UUID au lieu du matching par nom.
- `src/modules/commandes/utils/b2bQuantity.ts` : ajouter une surcharge optionnelle `unitMapping?: Record<string, string>` à `translateClientQtyToSupplier`. Si présent, lookup direct par UUID.
- `src/modules/commandes/components/PreparationDialog.tsx` : étendre le `.select()` (ligne 183) pour inclure `unit_mapping`. Passer au composant BFS.
- `src/pages/commandes/CompositePreparationDialog.tsx` : même modification.
- `src/modules/litiges/components/LitigeDetailDialog.tsx` : même modification.

**Risques :** Faible. Le fallback texte reste actif. Si `unit_mapping` est NULL ou vide, le comportement est identique à aujourd'hui.

**Validation :**
1. Ouvrir une commande avec un produit importé (nouveau, avec mapping)
2. Vérifier que l'affichage ERP est correct
3. Ouvrir PreparationDialog → vérifier que le BFS modal affiche les bonnes quantités
4. Tester avec un produit importé SANS mapping → vérifier que le fallback texte fonctionne

**Rollback :** Reverter les fichiers frontend. Le champ `unit_mapping` est ignoré.

---

### Phase 4 — Lecture prioritaire côté backend

**Objectif :** `fn_convert_b2b_quantity` utilise le mapping persisté en priorité.

**Fichiers touchés :**
- Nouvelle migration SQL : modification de `fn_convert_b2b_quantity`

**Modification :**

Ajouter un **Step 0** avant l'étape 1 actuelle :

```sql
-- ── 0. Try persisted unit mapping (highest priority) ──
SELECT bip.unit_mapping INTO v_mapping
FROM b2b_imported_products bip
WHERE bip.source_product_id = p_product_id
  -- Resolve client_unit_id → source_unit_id from mapping
LIMIT 1;

IF v_mapping IS NOT NULL THEN
  -- Find matching entry where local_unit_id = p_client_unit_id
  SELECT (el->>'source_unit_id')::uuid INTO v_mapped_source_id
  FROM jsonb_array_elements(v_mapping->'mappings') el
  WHERE (el->>'local_unit_id')::uuid = p_client_unit_id
  LIMIT 1;

  IF v_mapped_source_id IS NOT NULL THEN
    -- We now have the supplier's UUID for this client unit
    -- Use it for BFS conversion (step 4) or identity (step 3)
    IF v_mapped_source_id = v_supplier_unit_id THEN
      v_result.supplier_unit_id  := v_supplier_unit_id;
      v_result.supplier_quantity := p_client_quantity;
      v_result.supplier_family   := v_supplier_family;
      v_result.status            := 'ok';
      RETURN v_result;
    END IF;

    -- Try BFS with the mapped UUID
    SELECT fn_product_unit_price_factor(p_product_id, v_mapped_source_id, v_supplier_unit_id)
      INTO v_factor;
    IF v_factor IS NOT NULL AND v_factor != 0 THEN
      v_result.supplier_unit_id  := v_supplier_unit_id;
      v_result.supplier_quantity := ROUND(p_client_quantity / v_factor, 4);
      v_result.supplier_family   := v_supplier_family;
      v_result.status            := 'ok';
      RETURN v_result;
    END IF;
  END IF;
END IF;
```

**Risques :** Moyen. `fn_convert_b2b_quantity` est appelée dans des contextes transactionnels critiques (`fn_resolve_litige`). Mais l'ajout est un early-return — si le mapping n'existe pas ou ne matche pas, les étapes existantes (3-6) prennent le relais sans modification.

**Validation :**
1. Créer une commande avec un produit backfillé
2. Déclencher un litige
3. Résoudre le litige → vérifier que les `stock_events` ont les bonnes quantités converties
4. Tester avec un produit SANS mapping → vérifier que le fallback sémantique fonctionne

**Rollback :** Redéployer l'ancienne version de `fn_convert_b2b_quantity` (V4 sans Step 0).

---

### Phase 5 — Backfill des imports existants

**Objectif :** Calculer et persister le mapping pour tous les imports historiques.

**Fichiers touchés :**
- Nouvelle edge function : `supabase/functions/backfill-b2b-unit-mapping/index.ts`

**Risques :** Faible (write-only sur une colonne nullable). Mais nécessite une validation attentive du rapport de backfill.

**Validation :**
1. Exécuter le backfill sur un environnement de test
2. Vérifier le rapport : X mapped, Y partial, Z failed
3. Pour les cas failed : vérifier que le fallback texte fonctionne toujours
4. Exécuter en prod avec monitoring

**Rollback :** `UPDATE b2b_imported_products SET unit_mapping = NULL` — supprime tout le backfill. Aucune conséquence car le fallback texte prend le relais.

---

### Phase 6 — Réduction du fallback texte

**Objectif :** Après validation du backfill et stabilisation, réduire puis supprimer le matching textuel.

**Fichiers touchés :**
- `src/modules/commandes/hooks/useErpQuantityLabels.ts` : supprimer le bloc de matching par nom (lignes 250-266) si `unit_mapping` est toujours présent
- `src/modules/commandes/utils/b2bQuantity.ts` : supprimer `findMatchingUnit()` si plus utilisée
- `fn_convert_b2b_quantity` : supprimer les étapes 5-6 (matching sémantique et remap config)

**Risques :** Moyen. Ne faire cette phase que lorsque le monitoring confirme que 100% des imports ont un mapping valide.

**Validation :** Monitoring des logs DEV pour `B2B_NO_UNIT_MATCH` et `B2B_UNIT_MATCH_FAIL` — doivent être à zéro.

**Rollback :** Remettre le fallback texte.

---

## 8. CE QUI NE DOIT PAS ÊTRE TOUCHÉ

| Élément | Raison |
|---------|--------|
| `measurement_units` (structure/données) | Aucun changement structurel. Les UUID locaux restent tels quels. |
| `products_v2` (colonnes d'unités, conditionnement_config) | Déjà remappés correctement à l'import. Pas de re-remap. |
| `stock_events`, `stock_document_lines` | Données historiques. Aucune réécriture. |
| `inventory_sessions`, `inventory_lines` | Stock local, hors scope B2B. |
| `commande_lines.canonical_quantity` | Toujours dans le référentiel client. Aucun changement. |
| `commande_lines.shipped_quantity` | Toujours dans le référentiel client. Aucun changement. |
| Moteur BFS (`resolveProductUnitContext`, `findConversionPath`) | Opère en local. Pas de modification. |
| `conditionnement_config` (structure/logique) | La vérité métier du produit. Pas de modification. |
| `b2bConfigRebuilder.ts` | Fonctionne correctement. Le mapping est déjà consommé. |
| `b2bUnitMapper.ts` | Fonctionne correctement. C'est la source du mapping. |
| `fn_ship_commande` | Opère en espace client. Pas de conversion B2B. |

---

## 9. ESTIMATION DU NIVEAU DE CHANTIER

### Taille : PETIT à MOYEN

| Phase | Effort | Fichiers | Risque |
|-------|--------|----------|--------|
| 1 — Migration colonne | 15 min | 1 SQL | Quasi-nul |
| 2 — Persistance import | 1-2h | 2 TS | Faible |
| 3 — Frontend lecture | 3-4h | 5 TS/TSX | Faible |
| 4 — Backend lecture | 1-2h | 1 SQL | Moyen (mais isolé) |
| 5 — Backfill | 2-3h | 1 edge function | Faible |
| 6 — Cleanup fallback | 1-2h | 3 TS + 1 SQL | Moyen (ne pas précipiter) |
| **TOTAL** | **~10-14h** | **~13 fichiers** | **Faible globalement** |

### Faisable sans casser la prod ?

**OUI, catégoriquement.** Chaque phase est indépendante, backward-compatible, et possède un rollback trivial. Le fallback texte garantit la continuité à chaque étape.

### Réaliste comme amélioration ciblée ?

**OUI.** C'est exactement le type d'amélioration progressive que recommande la mémoire stratégique du projet. Pas de big bang, pas de migration massive, pas de changement de paradigme.

### Angles morts sous-estimés ?

| Angle mort potentiel | Analyse |
|---------------------|---------|
| Re-import / resync d'un produit existant | `fn_import_b2b_product_atomic` écrase le `conditionnement_config`. Le `unit_mapping` devrait être recalculé lors d'un resync. **Action :** s'assurer que le pipeline de resync (s'il existe) met aussi à jour `unit_mapping`. |
| Changement d'unités chez le fournisseur | Si le fournisseur renomme/supprime une unité après l'import, le mapping devient obsolète. **Mitigation :** le backfill peut être rejouable. Un bouton "re-sync mapping" peut être ajouté plus tard. |
| Performance du Step 0 dans `fn_convert_b2b_quantity` | La jointure sur `b2b_imported_products` + `jsonb_array_elements` ajoute un coût. **Mitigation :** `b2b_imported_products` a déjà un index sur `(source_product_id)`. Le JSONB est petit (5-15 entrées max). Impact négligeable. |
| Plusieurs imports du même produit source | Un même `source_product_id` peut être importé dans plusieurs établissements clients. Le `LIMIT 1` dans le Step 0 SQL doit être filtré par `establishment_id`. **Action :** ajouter un filtre `establishment_id` dans la query. |

---

## 10. VERDICT FINAL

### ✅ STRATÉGIE VALIDÉE — RECOMMANDATION : PROCÉDER

**Cette stratégie est la meilleure option pragmatique pour stabiliser le B2B.**

Elle :
- ✅ Cible exactement la douleur (translation inter-org)
- ✅ Ne touche à rien de critique (stock, inventaire, BFS, conditionnement)
- ✅ Est backward-compatible à chaque phase
- ✅ Possède un rollback trivial à chaque phase
- ✅ Réutilise du code déjà prouvé (`b2bUnitMapper`)
- ✅ Est réalisable en ~10-14h de développement
- ✅ Est déployable progressivement sans interruption de service

**Le seul point de vigilance** est la Phase 4 (modification de `fn_convert_b2b_quantity`) qui doit être testée avec soin car cette fonction est appelée dans des transactions critiques. Mais le pattern early-return avec fallback rend le risque très maîtrisé.

**Recommandation de séquence :** Phases 1→2→3→5→4→6

(Faire le backfill **avant** la modification backend permet de valider que les mappings sont corrects avant que le SQL les utilise.)

---

## 11. STOP
