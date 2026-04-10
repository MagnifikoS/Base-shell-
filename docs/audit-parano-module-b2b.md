# AUDIT PARANO — MODULE B2B

**Date** : 2026-03-18  
**Statut** : 🔍 AUDIT (aucune correction appliquée)  
**Auteur** : Lovable AI  
**Contexte** : Suite à la découverte et correction du bug cross-tenant sur `conditionnement_config`

---

## 1. RÉSUMÉ EXÉCUTIF

### Niveau de risque global : 🟡 MODÉRÉ

Le module B2B est globalement bien architecturé, avec des choix de sécurité solides (SECURITY DEFINER, vérification d'appartenance, transactions atomiques). Cependant, l'audit révèle **7 failles identifiées**, dont **2 probablement déjà actives en production** et **5 risques latents**.

### Verdict

> Le bug cross-tenant sur `conditionnement_config` était le plus grave et est corrigé. Il n'existe **pas d'autre faille de même gravité** (contamination silencieuse massive). Cependant, plusieurs **faiblesses de cohérence et de fiabilité** existent, dont certaines peuvent produire des comportements subtils mais incorrects.

---

## 2. CARTOGRAPHIE COMPLÈTE DU MODULE B2B

### 2.1 Fichiers Frontend

| Fichier | Rôle |
|---------|------|
| `services/b2bTypes.ts` | Types partagés |
| `services/b2bCatalogService.ts` | RPC catalogue + import atomique |
| `services/b2bPartnershipService.ts` | Partenariats + codes invitation |
| `services/b2bUnitMapper.ts` | Phase B : mapping unités source → local |
| `services/b2bCategoryMapper.ts` | Phase C : mapping catégories |
| `services/b2bConfigRebuilder.ts` | Phase D : remapping UUID dans JSON |
| `services/b2bImportPipeline.ts` | Orchestrateur 6 phases |
| `services/shareStockService.ts` | Stock partagé (lecture seule) |
| `hooks/useB2BCatalog.ts` | Fetch catalogue + enrichissement |
| `hooks/useB2BImport.ts` | Mutation d'import batch |
| `components/B2BCatalogBrowser.tsx` | UI catalogue + findOrCreateLocalSupplier |
| `components/B2BProductFixDialog.tsx` | Correction manuelle unité/catégorie |

### 2.2 Edge Functions

| Fonction | Rôle B2B |
|----------|----------|
| `commandes-api` | Lifecycle commandes produits (send/open/ship/receive/resolve_litige) |
| `commandes-plats-api` | Lifecycle commandes plats (isolé, pas de stock) |

### 2.3 RPC SQL critiques

| Fonction | Rôle | Écriture stock |
|----------|------|----------------|
| `fn_get_b2b_catalogue` | Lecture catalogue fournisseur | Non |
| `fn_import_b2b_product_atomic` | Import produit + init stock | Oui (init) |
| `fn_redeem_b2b_code` | Activation partenariat | Non |
| `fn_get_b2b_partner_profile` | Profil partenaire | Non |
| `fn_get_b2b_supplier_stock` | Stock fournisseur partagé | Non |
| `fn_send_commande` | Envoi commande | Non |
| `fn_ship_commande` | Expédition + retrait stock FO | Oui (WITHDRAWAL) |
| `fn_receive_commande` | Réception + entrée stock CL | Oui (RECEIPT) |
| `fn_resolve_litige` | Correction litige + ajustement stock FO | Oui (ADJUSTMENT) |
| `fn_generate_app_invoice` | Facturation | Non (direct) |

### 2.4 Tables B2B

| Table | Rôle |
|-------|------|
| `b2b_partnerships` | Liens fournisseur ↔ client |
| `b2b_invitation_codes` | Codes d'invitation |
| `b2b_imported_products` | Traçabilité import (source → local) |
| `b2b_recipe_listings` | Catalogue recettes B2B |
| `b2b_followed_recipes` | Recettes suivies par clients |
| `commandes` | Commandes produits |
| `commande_lines` | Lignes commandes produits |
| `commande_plats` | Commandes plats |
| `commande_plat_lines` | Lignes commandes plats |
| `litiges` / `litige_lines` | Litiges réception |

### 2.5 Flux de données inter-établissements

```
FOURNISSEUR (FO)                          CLIENT (CL)
─────────────                              ──────────
products_v2 (FO)  ──[catalogue RPC]──>  enrichissement client-side
measurement_units (FO) ──[catalogue]──>  mapping vers units (CL)
product_categories (FO) ──[catalogue]──> mapping vers categories (CL)
                                         ↓
                                    fn_import_b2b_product_atomic
                                         ↓
                                    products_v2 (CL) [données remappées]
                                    b2b_imported_products [traçabilité]
                                         ↓
                                    commande_lines (CL products)
                                         ↓
                  fn_ship_commande ←──── commandes-api (ship)
                  stock_events (FO) ←    [WITHDRAWAL sur produits FO]
                                         ↓
                                    fn_receive_commande
                                    stock_events (CL) [RECEIPT sur produits CL]
```

---

## 3. ANALYSE DES IMPORTS B2B

### 3.1 Ce qui est copié, remappé, reconstruit

| Donnée | Traitement | Risque |
|--------|-----------|--------|
| `nom_produit` | Copié brut | ✅ OK — texte, pas de référence |
| `code_produit` | Copié brut | ✅ OK — texte local |
| `category_id` | **Remappé** par nom normalisé | ✅ OK |
| `category` (legacy text) | Copié `null` | ✅ OK |
| `final_unit_id` | **Remappé** via unit mapper | ✅ OK (corrigé Phase 4) |
| `supplier_billing_unit_id` | **Remappé** via `remapDirectUnit` | ✅ OK |
| `delivery_unit_id` | **Remappé** via `remapDirectUnit` | ✅ OK |
| `stock_handling_unit_id` | **Remappé** via `remapDirectUnit` | ✅ OK |
| `kitchen_unit_id` | **Remappé** via `remapDirectUnit` | ✅ OK |
| `price_display_unit_id` | **Remappé** via `remapDirectUnit` | ✅ OK |
| `min_stock_unit_id` | Forcé à `localFinalUnitId` | ✅ OK |
| `final_unit_price` | Copié brut | ⚠️ Voir FAILLE-01 |
| `conditionnement_config` | **Remappé** (JSON deep) | ✅ OK (corrigé Phase 4) |
| `conditionnement_resume` | Copié brut | ⚠️ Voir FAILLE-02 |
| `storage_zone_id` | **Reconstruit** (choisi par utilisateur) | ✅ OK |
| `supplier_id` | **Reconstruit** (findOrCreateLocalSupplier) | ✅ OK |
| `min_stock_quantity_canonical` | Forcé à 0 | ✅ OK |

### 3.2 Réponse aux questions obligatoires

#### A. À l'import, qu'est-ce qui est :
- **Copié brut** : `nom_produit`, `code_produit`, `final_unit_price`, `conditionnement_resume`
- **Remappé** : toutes les colonnes `*_unit_id`, `category_id`, tout le JSON `conditionnement_config`
- **Reconstruit** : `storage_zone_id`, `supplier_id`, `min_stock_unit_id`, `min_stock_quantity_canonical`
- **Dérivé** : `name_normalized` (recalculé par `normalizeProductNameV2`)

#### B. Existe-t-il d'autres champs comparables à `conditionnement_config` ?
**Non.** C'est le seul champ JSON contenant des UUID techniques. Les autres colonnes UUID sont des FK directes remappées individuellement.

#### C. Les unités sont-elles le seul point fragile ?
Les unités étaient le **point le plus dangereux** (corrigé). Restent :
- Les **prix** (voir FAILLE-01)
- Le **texte `conditionnement_resume`** (voir FAILLE-02)
- Les **`canonical_unit_id` dans les commande_lines** (voir FAILLE-03)

---

## 4. ANALYSE DES COMMANDES ET RÉCEPTIONS B2B

### 4.1 Création de commande (CL → FO)

La commande est créée côté client avec ses propres `product_id` et `canonical_unit_id`. Les lignes sont insérées via `upsertCommandeLines` en utilisant les UUID du client.

**Observation clé** : `commande_lines.canonical_unit_id` contient l'UUID de l'unité **du client**. C'est correct pour le CL, mais pose un problème pour le FO lors de l'expédition.

### 4.2 Expédition (fn_ship_commande)

```sql
-- La jointure inverse le mapping via b2b_imported_products
JOIN b2b_imported_products bip
  ON bip.local_product_id = cl.product_id         -- CL's product
  AND bip.establishment_id = v_commande.client_establishment_id
  AND bip.source_establishment_id = v_commande.supplier_establishment_id
JOIN products_v2 sp ON sp.id = bip.source_product_id  -- FO's product
LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id  -- ⚠️ CL's unit UUID
```

**FAILLE-03 IDENTIFIÉE** : Le `canonical_unit_id` de la commande_line est celui du **client**. Lors du `fn_ship_commande`, il est utilisé tel quel pour créer les `stock_events` du **fournisseur**. C'est un UUID cross-tenant écrit dans le ledger du fournisseur.

### 4.3 Réception (fn_receive_commande)

```sql
-- Ici c'est correct : on utilise cl.product_id (produit CL) et cl.canonical_unit_id (unité CL)
-- pour écrire dans le stock du CL
```

✅ La réception est correcte : les `stock_events` du client utilisent les UUID du client.

### 4.4 Résolution de litige (fn_resolve_litige)

```sql
-- Même pattern que ship : utilise cl.canonical_unit_id du CL
-- pour écrire dans les stock_events du FO
LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id  -- ⚠️ CL's unit UUID
```

**FAILLE-03 bis** : Même problème que l'expédition. Les ajustements de litige sur le stock du FO utilisent l'UUID d'unité du CL.

---

## 5. ANALYSE DES CONTAMINATIONS CROSS-TENANT

### 5.1 Zones de risque identifiées

| Zone | Risque | Probabilité en prod |
|------|--------|---------------------|
| `stock_events.canonical_unit_id` (FO, via ship) | UUID du CL dans ledger FO | **✅ DÉJÀ PRÉSENT** |
| `stock_events.canonical_unit_id` (FO, via resolve_litige) | UUID du CL dans ledger FO | **✅ DÉJÀ PRÉSENT** |
| `stock_document_lines.canonical_unit_id` (FO, via ship) | UUID du CL dans documents FO | **✅ DÉJÀ PRÉSENT** |
| `conditionnement_config` (CL) | UUID du FO dans config CL | ✅ CORRIGÉ (Phase 1-3) |
| `products_v2.*_unit_id` (CL) | UUID du FO dans colonnes CL | ✅ CORRIGÉ (Phase 1-3) |

### 5.2 Données déjà contaminées

Les `stock_events` du fournisseur créés par `fn_ship_commande` et `fn_resolve_litige` contiennent des `canonical_unit_id` provenant de l'établissement client. C'est le **sujet ouvert identifié dans le rapport final Phase 5**, maintenant confirmé comme faille structurelle dans le code SQL.

---

## 6. LISTE DES FAILLES IDENTIFIÉES

### FAILLE-01 : Prix fournisseur copié sans snapshot sémantique

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🟡 Faible |
| **Impact** | Cosmétique / décisionnel |
| **Probabilité en prod** | Latent |
| **Fichiers** | `b2bImportPipeline.ts` L144 |
| **Tables** | `products_v2.final_unit_price` |

**Description** : Le `final_unit_price` du fournisseur est copié brut dans le produit du client. Ce prix représente le prix unitaire du fournisseur pour ses propres opérations — pas nécessairement le prix d'achat négocié B2B. Après import, le client voit le "prix interne" du fournisseur, qui peut ne pas correspondre au tarif réel facturé.

**Scénario terrain** : Le fournisseur a un prix interne de 2,50 €/kg mais facture 3,00 €/kg au client B2B. Le produit importé affiche 2,50 €, faussant les calculs de food cost du client.

**Comportement** : Le système fonctionne, mais les données sont sémantiquement incorrectes.

**Recommandation** : Soit ne pas copier le prix (laisser le client le saisir), soit ajouter un champ `b2b_price` négocié dans le partenariat, soit documenter clairement que le prix est indicatif.

---

### FAILLE-02 : `conditionnement_resume` copié brut avec noms d'unités FO

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🟡 Faible |
| **Impact** | Cosmétique |
| **Probabilité en prod** | **✅ Déjà présent** |
| **Fichiers** | `b2bImportPipeline.ts` L146 |
| **Tables** | `products_v2.conditionnement_resume` |

**Description** : Le champ `conditionnement_resume` est un texte descriptif humainement lisible (ex: "Colis de 6 × Bouteille 75cl"). Il est copié tel quel du fournisseur. Les noms d'unités dans ce texte sont ceux du fournisseur, qui peuvent différer des noms utilisés par le client (abréviations différentes, conventions différentes).

**Scénario terrain** : Le fournisseur utilise "Bte" pour bouteille, le client utilise "BT". Le resume affiché contient "Bte" alors que le client s'attend à "BT".

**Impact** : Purement cosmétique. Le texte est un résumé pour l'affichage, pas utilisé pour des calculs. Mais c'est une incohérence visible.

**Recommandation** : Recalculer le `conditionnement_resume` à partir du config remappé lors de l'import, en utilisant les noms d'unités locales.

---

### FAILLE-03 : `canonical_unit_id` cross-tenant dans fn_ship_commande et fn_resolve_litige

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🔴 **Élevée** |
| **Impact** | Corruption ledger stock fournisseur |
| **Probabilité en prod** | **✅ Déjà présent à chaque expédition B2B** |
| **Fichiers** | Migration `fn_ship_commande` (20260311), Migration `fn_resolve_litige` (20260305) |
| **Tables** | `stock_events`, `stock_document_lines` (côté fournisseur) |

**Description** : Lors de l'expédition d'une commande B2B, le SQL join récupère le `canonical_unit_id` depuis `commande_lines`, qui contient l'UUID d'unité **du client** (car la commande est créée côté client avec ses propres unités). Ce UUID est ensuite écrit dans les `stock_events` et `stock_document_lines` du **fournisseur**.

**Preuve dans le code SQL** :
```sql
-- fn_ship_commande, ligne stock_events INSERT :
sl.canonical_unit_id,     -- ← vient de commande_lines.canonical_unit_id = UUID du CLIENT
sl.canonical_family,      -- ← vient de LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
                          -- ← cette jointure échoue silencieusement si l'unité n'existe pas chez le FO
```

La jointure `LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id` cherche l'unité du client dans la table `measurement_units` **sans filtre sur `establishment_id`**. Si l'UUID du client existe dans les unités du fournisseur (collision UUID peu probable mais possible), elle retournera des métadonnées erronées. Si elle ne trouve rien, `canonical_family` et `canonical_label` seront `NULL`.

**Impact réel** :
1. Les `stock_events` du fournisseur ont des `canonical_unit_id` invalides
2. Le reporting par unité est faussé côté FO
3. Le `canonical_family` peut être NULL (jointure échouée), ce qui peut affecter des filtres downstream
4. Tout recalcul de stock basé sur `canonical_unit_id` est compromis

**Scénario terrain** : Le fournisseur regarde son historique de mouvements de stock. Les lignes de retrait B2B affichent des unités inconnues ou aucun label d'unité. Si le FO tente de regrouper ses mouvements par unité, les retraits B2B ne se consolident pas avec les autres mouvements du même produit.

**Correction nécessaire** : `fn_ship_commande` doit résoudre le `canonical_unit_id` du fournisseur pour chaque ligne, pas utiliser celui du client. Approche recommandée :
- Utiliser `sp.final_unit_id` (unité du produit FO) comme `canonical_unit_id` pour les stock_events du FO
- Ou ajouter une colonne `supplier_canonical_unit_id` dans `commande_lines` remplie au moment du `fn_send_commande`

---

### FAILLE-04 : Pas de remapping inverse pour `canonical_unit_id` dans fn_ship_commande

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🟠 Moyenne |
| **Impact** | Incohérence quantitative potentielle |
| **Probabilité en prod** | Latent (pas encore manifesté si les familles sont alignées) |
| **Fichiers** | Migration `fn_ship_commande` |
| **Tables** | `stock_events` (FO) |

**Description** : Même si les familles d'unités (mass, volume, count) sont identiques entre FO et CL (ce qui est très probable car les unités "kg", "L", "pce" sont universelles), le `canonical_unit_id` dans les stock_events du FO pointe vers l'unité du CL. Cela signifie que toute logique qui fait un `JOIN measurement_units` sur ces events ne trouvera pas l'unité (ou trouvera la mauvaise si les UUID sont recyclés).

**Impact** : Les requêtes d'analyse/reporting qui joignent `stock_events` avec `measurement_units` filtré par `establishment_id` ne retourneront pas de résultats pour les lignes B2B. Le stock numériquement est correct (delta_quantity_canonical est bon), mais les métadonnées d'unité sont incorrectes.

---

### FAILLE-05 : `findOrCreateLocalSupplier` — race condition potentielle

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🟡 Faible |
| **Impact** | Doublons fournisseurs théoriques |
| **Probabilité en prod** | Très faible |
| **Fichiers** | `B2BCatalogBrowser.tsx` L481-541 |
| **Tables** | `invoice_suppliers` |

**Description** : La fonction `findOrCreateLocalSupplier` fait un SELECT puis un INSERT si non trouvé, sans verrou. Deux imports simultanés pour le même fournisseur B2B pourraient créer deux entrées `invoice_suppliers`. Le `internal_code` unique devrait protéger via constraint, mais l'erreur n'est pas gérée gracieusement.

**Impact** : Très faible en pratique (les imports B2B sont séquentiels via l'UI). Mais l'absence de `ON CONFLICT` sur l'INSERT est une dette technique.

---

### FAILLE-06 : `fn_import_b2b_product_atomic` UPDATE écrase `conditionnement_config` sans vérification

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🟠 Moyenne |
| **Impact** | Écrasement de configuration locale |
| **Probabilité en prod** | Latent (se manifeste au réimport) |
| **Fichiers** | Migration `fn_import_b2b_product_atomic` (20260313) |
| **Tables** | `products_v2` |

**Description** : Si un produit existe déjà (match par code ou nom), le SQL fait un UPDATE qui écrase **toutes** les colonnes de configuration, y compris celles que l'utilisateur aurait pu modifier localement après l'import initial :
```sql
UPDATE products_v2 SET
  final_unit_id = p_final_unit_id,
  conditionnement_config = p_conditionnement_config,
  -- ... toutes les colonnes écrasées
```

**Scénario terrain** : Le client importe un produit, modifie son conditionnement localement (change un packaging level), puis réimporte le catalogue. Le produit est matché par nom → toute la configuration locale est écrasée par les données du fournisseur (remappées, certes, mais pas celles que le client avait personnalisées).

**Recommandation** : Soit empêcher le réimport silencieux (demander confirmation), soit ne pas écraser les champs déjà modifiés localement, soit ajouter un flag `locally_modified` pour protéger les personnalisations.

---

### FAILLE-07 : Absence de validation `establishment_id` sur `measurement_units` dans fn_ship_commande

| Attribut | Valeur |
|----------|--------|
| **Gravité** | 🟡 Faible |
| **Impact** | Sécurité / isolation |
| **Probabilité en prod** | Latent |
| **Fichiers** | Migration `fn_ship_commande` |
| **Tables** | `measurement_units` |

**Description** : Le LEFT JOIN sur `measurement_units` ne filtre pas par `establishment_id` :
```sql
LEFT JOIN measurement_units mu ON mu.id = cl.canonical_unit_id
```

Comme le `canonical_unit_id` est celui du client, la jointure cherche dans **toute** la table `measurement_units` (tous établissements confondus). Si un UUID d'unité d'un autre établissement est référencé, les données seront retournées sans vérification de propriété.

Ce n'est pas un vecteur d'attaque (les UUID sont des PK uniques), mais c'est une violation du principe d'isolation multi-tenant.

---

## 7. PRIORISATION

### Bugs déjà présents en production

| # | Faille | Gravité | Action |
|---|--------|---------|--------|
| FAILLE-03 | `canonical_unit_id` cross-tenant dans stock_events FO | 🔴 Élevée | **Corriger dans fn_ship_commande et fn_resolve_litige** |
| FAILLE-02 | `conditionnement_resume` avec noms d'unités FO | 🟡 Faible | Documenter, corriger si UX problématique |

### Risques latents à corriger

| # | Faille | Gravité | Action |
|---|--------|---------|--------|
| FAILLE-06 | UPDATE écrase config locale au réimport | 🟠 Moyenne | Ajouter confirmation ou protection |
| FAILLE-04 | Jointure sans filtre establishment sur units | 🟠 Moyenne | Ajouter filtre dans fn_ship_commande |

### Dette technique

| # | Faille | Gravité | Action |
|---|--------|---------|--------|
| FAILLE-01 | Prix copié sans sémantique B2B | 🟡 Faible | Décision produit |
| FAILLE-05 | Race condition findOrCreateLocalSupplier | 🟡 Faible | Ajouter ON CONFLICT |
| FAILLE-07 | Pas de filtre establishment sur JOIN units | 🟡 Faible | Refactoring |

---

## 8. RÉPONSES AUX QUESTIONS OBLIGATOIRES

### D. Le flux B2B peut-il contaminer les tables critiques ?

| Table | Contamination possible | Via |
|-------|----------------------|-----|
| `products_v2` | ✅ CORRIGÉ (conditionnement_config, *_unit_id) | Import B2B |
| `stock_events` | **⚠️ OUI** (canonical_unit_id FO ← UUID CL) | fn_ship_commande, fn_resolve_litige |
| `stock_document_lines` | **⚠️ OUI** (canonical_unit_id FO ← UUID CL) | fn_ship_commande |
| `inventory_lines` | ⚠️ Possible (canonical_unit_id via bootstrap) | fn_ship_commande bootstrap |
| `commande_lines` | ✅ OK (utilise correctement les UUID du CL) | Création commande |
| `invoice_lines` (app_invoice_lines) | ✅ OK (snapshot des commande_lines CL) | fn_generate_app_invoice |

### E. Chemins différents selon le scénario ?

| Scénario | Chemin | Risque spécifique |
|----------|--------|-------------------|
| Import initial | INSERT dans products_v2 + stock init | ✅ OK après Phase 4 |
| Réimport (produit existant) | UPDATE dans products_v2 | ⚠️ FAILLE-06 (écrasement) |
| Expédition | fn_ship_commande | ⚠️ FAILLE-03 (canonical_unit_id) |
| Réception | fn_receive_commande | ✅ OK |
| Litige | fn_resolve_litige | ⚠️ FAILLE-03 bis |
| Correction manuelle | Via B2BProductFixDialog | ✅ OK (overrides client-side) |

### F. UUID supposé global mais en réalité local ?

**Oui** — `commande_lines.canonical_unit_id`. Ce UUID est créé par le client lors de la commande, mais est utilisé côté fournisseur dans `fn_ship_commande` comme s'il était universel. En réalité, il n'a de sens que dans l'établissement client.

### G. Failles de fiabilité ?

| Aspect | Statut |
|--------|--------|
| **Atomicité** | ✅ Toutes les RPC critiques sont transactionnelles |
| **Idempotence** | ✅ `idempotency_key` sur les documents stock |
| **Rollback** | ✅ RAISE EXCEPTION annule la transaction |
| **Dépendance implicite** | ⚠️ fn_ship_commande dépend de b2b_imported_products pour résoudre les produits FO — si le tracking est supprimé/corrompu, l'expédition échoue silencieusement (le produit est ignoré dans _ship_lines) |
| **Ordre des opérations** | ✅ Le statut machine enforce l'ordre (brouillon → envoyée → ouverte → expédiée → reçue) |

---

## 9. VERDICT FINAL

### Le module B2B contient-il d'autres faiblesses comparables au bug cross-tenant déjà découvert ?

**Oui, une faille de gravité élevée** : `fn_ship_commande` et `fn_resolve_litige` écrivent des UUID d'unités cross-tenant dans les `stock_events` du fournisseur (FAILLE-03). C'est structurellement le même type de bug que celui corrigé sur `conditionnement_config` — une donnée du client est copiée dans le contexte du fournisseur sans remapping.

**Cependant**, l'impact est plus limité :
- Les `stock_events` sont un **ledger** (append-only), pas une configuration recalculée
- Le `delta_quantity_canonical` est numériquement correct (la quantité est juste)
- L'impact est principalement sur le **reporting** et l'**affichage** des unités côté FO

### Niveau de sensibilité / fragilité

Le module B2B est **sensible mais pas fragile** :
- L'architecture atomique (RPC transactionnelles) protège contre les corruptions catastrophiques
- Le bug cross-tenant dans les stock_events est structurel mais à impact limité
- Les corrections Phase 4 ont éliminé la source principale de contamination (import)
- Il reste de la dette technique (prix, resume, race conditions) mais rien de bloquant

### Ce qu'il faut faire en priorité

1. **P0** : Corriger FAILLE-03 (canonical_unit_id dans fn_ship_commande et fn_resolve_litige)
2. **P1** : Corriger FAILLE-06 (protection contre écrasement au réimport)
3. **P2** : Documenter FAILLE-01 et FAILLE-02 comme limitations connues

---

*Fin de l'audit parano — Module B2B*
