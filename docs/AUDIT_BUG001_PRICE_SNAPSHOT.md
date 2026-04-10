# AUDIT BUG-001 — Snapshot prix incorrect sur unités de conditionnement

**Date :** 2026-03-28  
**Auditeur :** Claude (QA Produit / SQL / Pricing)  
**Statut :** Audit terminé — Pas de correctif proposé  

---

## 1. RÉSUMÉ EXÉCUTIF

### Nature du bug
Le pipeline de figement des prix dans `fn_send_commande` ne convertissait **pas** le prix unitaire (`final_unit_price`) de l'unité finale du produit vers l'unité de la ligne de commande (`canonical_unit_id`). Le prix était copié **à l'identique**, ignorant le facteur de conversion packaging.

### Gravité : CRITIQUE (P0)
- **18 lignes de commande** contiennent un `unit_price_snapshot` factuellement faux
- **Impact financier : 753,43 € de sous-facturation** sur le périmètre audité
- Le bug **s'est propagé aux factures** via `fn_generate_app_invoice` (3 factures confirmées)
- Le bug a touché des **produits réels** (BURRATA, NUTELLA, CHORIZO...), pas seulement des données de test

### Portée estimée
- **Toutes les commandes envoyées entre le 6 mars et le 17 mars** (V1 de fn_send_commande)
- **Possiblement** certaines commandes entre le 17 et le 22 mars (V2 avec COALESCE fallback si BFS échouait)
- Après le 22 mars, un hard block empêche les cas où BFS retourne NULL, mais le COALESCE(…, 1.0) reste dans le code comme branche morte dangereuse

### Confiance dans le diagnostic : ÉLEVÉE (95%)
- Preuve par les données historiques (18 lignes SUSPECT vérifiées)
- Preuve par l'historique des migrations (3 versions de fn_send_commande tracées)
- Preuve par le test direct du BFS (retourne 20.0 aujourd'hui pour TEST 1)
- **1 question ouverte** : l'état exact du `conditionnement_config` au moment de chaque envoi n'est pas auditable (pas d'historique JSONB)

---

## 2. RECONSTITUTION DU FLOW EXACT

### Flow normal attendu

```
1. Produit créé : final_unit_price = 1.36 €/Pièce
2. Conditionnement : 1 Carton = 10 Boîtes = 20 Pièces
3. Client commande : 2 Cartons
4. commande_line créée : canonical_unit_id = Carton, canonical_quantity = 2
5. fn_send_commande appelée :
   a. BFS(Pièce → Carton) = facteur 20.0
   b. unit_price_snapshot = 1.36 × 20.0 = 27.20 €/Carton  ← ATTENDU
   c. line_total_snapshot = 2 × 27.20 = 54.40 €            ← ATTENDU
6. Facture : 2 × 27.20 = 54.40 €
```

### Flow réellement exécuté (V1 — 6 au 17 mars)

```
1-4. Identique
5. fn_send_commande V1 appelée :
   a. AUCUNE CONVERSION — copie directe de final_unit_price
   b. unit_price_snapshot = 1.36 €/Carton                   ← FAUX (=€/Pièce)
   c. line_total_snapshot = 2 × 1.36 = 2.72 €              ← FAUX
6. Facture : 2 × 1.36 = 2.72 €                             ← FAUX
```

### Propagation vers la facture

`fn_generate_app_invoice` utilise **directement** `cl.unit_price_snapshot` sans aucune re-vérification :
```sql
cl.unit_price_snapshot,
ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
```

Le prix faux est donc **propagé intégralement** dans `app_invoice_lines.unit_price` et `app_invoice_lines.line_total`, puis dans `app_invoices.total_ht`.

---

## 3. CARTOGRAPHIE DES FONCTIONS IMPLIQUÉES

### Fonctions SQL

| Fonction | Rôle | Impliquée dans le bug |
|----------|------|----------------------|
| `fn_send_commande` | Fige les prix et envoie la commande | **OUI — CAUSE DIRECTE** |
| `fn_product_unit_price_factor` | BFS packaging : retourne le facteur de conversion prix | Non appelée en V1, appelée en V2/V3 |
| `fn_convert_line_unit_price` | Wrapper read-only autour du BFS | Non utilisée par fn_send_commande |
| `fn_generate_app_invoice` | Génère la facture à partir des snapshots | **OUI — PROPAGE le bug** |
| `trg_commande_lines_immutable_price` | Empêche la modification post-snapshot | **OUI — VERROUILLE les données fausses** |

### Colonnes / tables

| Table.Colonne | Rôle |
|--------------|------|
| `products_v2.final_unit_price` | Prix unitaire SSOT (€ par final_unit) |
| `products_v2.final_unit_id` | UUID de l'unité finale (ex: Pièce) |
| `products_v2.conditionnement_config` | JSONB contenant packagingLevels + equivalence |
| `commande_lines.canonical_unit_id` | Unité de la ligne commandée (ex: Carton) |
| `commande_lines.unit_price_snapshot` | Prix figé par fn_send_commande |
| `commande_lines.line_total_snapshot` | Total figé = qty × unit_price_snapshot |
| `app_invoice_lines.unit_price` | Copie de unit_price_snapshot |
| `app_invoice_lines.line_total` | received_qty × unit_price |

### Triggers

| Trigger | Impact |
|---------|--------|
| `trg_commande_lines_immutable_price` | BEFORE UPDATE — RAISE EXCEPTION si `unit_price_snapshot` modifié après première affectation. **Empêche toute correction in-place.** |

### Fichiers frontend pertinents

- `src/modules/commandes/services/commandeService.ts` — crée les lignes (sans snapshot)
- `src/modules/commandes/types.ts` — définit `CommandeLine` avec `unit_price_snapshot`

---

## 4. EXEMPLE TERRAIN COMPLET

### Produit : TEST 1 (client)

```
Product ID    : 20290fe7-c7ea-4e5a-b2c0-b212739d1534
Établissement : beff6f4a (Client CL)
final_unit_price : 1.3600 €
final_unit_id    : dee78c0d (Pièce)
stock_handling   : 0c2807d9 (Carton)
delivery_unit    : 0c2807d9 (Carton)
```

#### Conditionnement config :
```
packagingLevels:
  [0] Carton (0c2807d9) contient 10 × Boîte (9efd1893)
  [1] Boîte  (9efd1893) contient  2 × Pièce (dee78c0d)
→ 1 Carton = 20 Pièces
```

#### BFS actuel :
```sql
SELECT fn_product_unit_price_factor('20290fe7...', 'dee78c0d...(Pce)', '0c2807d9...(Car)');
→ 20.0  ✓
```

#### Commandes historiques affectées :

| Commande | Date envoi | Qté (Carton) | Snapshot | Correct | Perte |
|----------|-----------|:---:|------:|-------:|------:|
| CMD-000009 | 2026-03-06 | 2 | 2,72 € | 54,40 € | **51,68 €** |
| CMD-000010 | 2026-03-08 | 3,5 | 4,76 € | 95,20 € | **90,44 €** |
| CMD-000032 | 2026-03-11 | 10 | 13,60 € | 272,00 € | **258,40 €** |
| CMD-000033 | 2026-03-11 | 1 | 1,36 € | 27,20 € | **25,84 €** |
| CMD-000034 | 2026-03-11 | 2 | 2,72 € | 54,40 € | **51,68 €** |
| CMD-000036 | 2026-03-12 | 1 | 1,36 € | 27,20 € | **25,84 €** |
| CMD-000040 | 2026-03-16 | 1,1 | 1,50 € | 29,92 € | **28,42 €** |

**Sous-total TEST 1 : 532,30 € de perte sur 7 commandes**

#### Factures affectées :

| Facture | Prix facturé TEST 1 | Correct |
|---------|-------------------:|--------:|
| FAC-APP-000001 | 2,72 € | 54,40 € |
| FAC-APP-000002 | 4,08 € | 81,60 € |
| FAC-APP-000009 | 1,36 € | 27,20 € |

---

## 5. ANALYSE CAUSALE

### Cause racine : Absence de conversion prix dans fn_send_commande V1

**La V1 (6 mars, migration `20260306180508`)** copiait `p.final_unit_price` directement sans aucune conversion :

```sql
-- V1 — Code exact déployé le 6 mars
UPDATE commande_lines cl
SET unit_price_snapshot = p.final_unit_price,  -- ← PAS DE FACTEUR
    line_total_snapshot = ROUND(cl.canonical_quantity * COALESCE(p.final_unit_price, 0), 2)
FROM products_v2 p
WHERE cl.commande_id = p_commande_id AND cl.product_id = p.id;
```

Le prix `final_unit_price` est en **€/final_unit** (ex: €/Pièce). Quand la ligne est en Carton, il faut multiplier par le facteur packaging (20×). La V1 ne le faisait pas.

### Cause secondaire 1 : COALESCE(…, 1.0) dans V2

La V2 (17 mars, migration `20260317175003`) a ajouté l'appel BFS mais avec un fallback silencieux :

```sql
COALESCE(fn_product_unit_price_factor(...), 1.0)
```

Si le BFS échouait (config incomplète, unité manquante), le facteur retombait à 1.0 → prix copié sans conversion, **sans erreur, sans log, sans blocage**.

### Cause secondaire 2 : Trigger d'immutabilité verrouille les données fausses

`trg_commande_lines_immutable_price` empêche toute mise à jour du `unit_price_snapshot` une fois défini. Même si le code est corrigé, les commandes déjà envoyées **ne peuvent pas être re-snapshotées** sans désactiver le trigger.

### Cause secondaire 3 : Le hard block V3 a un trou logique

Le hard block (V3, 22 mars) vérifie :
```sql
WHERE cl.canonical_unit_id != p.final_unit_id
  AND fn_product_unit_price_factor(...) IS NULL
```

**Trou SQL** : si `p.final_unit_id IS NULL`, alors `cl.canonical_unit_id != NULL` → évalue à **NULL** (pas TRUE). La ligne est **exclue** du hard block. Le COALESCE prend alors le relais avec 1.0.

### Ce qui N'EST PAS la cause

- ❌ `fn_product_unit_price_factor` ne contient pas de bug de calcul (retourne 20.0 correctement)
- ❌ Le frontend ne pré-remplit pas `unit_price_snapshot` (vérifié : NULL en brouillon)
- ❌ La conversion de **quantité** fonctionne correctement (stock OK)
- ❌ Le problème n'est pas dans `fn_convert_line_unit_price` (cette fonction n'est pas utilisée par `fn_send_commande`)

---

## 6. CAS IMPACTÉS

### Impactés avec certitude

| Type de produit | Impacté ? | Explication |
|----------------|:---------:|-------------|
| **Multi-niveaux** (Carton→Boîte→Pièce) | ✅ OUI | Facteur 20× ignoré |
| **Conditionnement simple** (Lot→Pièce) | ✅ OUI | Facteur N× ignoré |
| **Pièce livrée en Carton** | ✅ OUI | canonical ≠ final |
| **Produit avec equivalence poids** | ✅ SI commandé en unité ≠ final | Facteur ignoré |

### Produits réels affectés (confirmés par données)

| Produit | Facteur | Snapshot | Correct | Erreur |
|---------|:-------:|--------:|---------:|:------:|
| TEST 1 | 20× | 1,36 | 27,20 | -95,0% |
| BURRATA 125G | 20× | 1,36 | 27,18 | -95,0% |
| BARQUETTE ALU 680ML | 50× | 0,13 | 6,63 | -98,0% |
| NUTELLA | 3× | 6,67 | 20,00 | -66,7% |
| CHORIZO IKBAL | 2× | 14,18 | 28,37 | -50,0% |
| BURRATA SAPORI MIEI | 2× | 1,35 | 2,70 | -50,0% |
| Langues de chat | 20× | 0,04 | 0,81 | -95,0% |
| CITRON JAUNE | 0,1× | 0,22 | 0,022 | **+900%** (sur-facturation) |

### Non impactés

| Type | Explication |
|------|-------------|
| **Produit simple** (canonical = final) | Facteur = 1.0, identité correcte |
| **TEST 2** (kg→kg) | canonical = final, pas de conversion |
| **TEST 3** (pce→pce) | canonical = final, pas de conversion |

### Cas limite intéressant : CITRON JAUNE

Facteur 0,1 signifie que le prix **correct** est 10× plus bas que le snapshot. Ce produit est **sur-facturé**. Le bug joue dans les deux sens selon la direction de conversion.

### Impact sur autres flows

| Flow | Impacté ? | Explication |
|------|:---------:|-------------|
| BL Retrait | **Non** | Utilise `fn_create_bl_withdrawal` qui a sa propre logique de prix |
| Commande Plats | **Non** | Utilise un pipeline séparé avec `fn_send_commande_plat` |
| Inventaire | **Non** | Ne passe pas par les commandes |
| Stock ledger | **Non** | La conversion de quantité fonctionne correctement |

---

## 7. RISQUES MÉTIER

### 7.1 Sous-facturation systématique

Pour tout produit commandé dans une unité de packaging supérieure à l'unité finale :
- **Perte financière** : le fournisseur facture au prix de la pièce pour un carton entier
- **Impact cumulé confirmé** : **753,43 €** sur le périmètre audité
- **Taux de sous-facturation moyen** : ~87% sur les lignes affectées

### 7.2 Sur-facturation possible

Le cas CITRON JAUNE montre qu'un produit avec facteur < 1 (prix final_unit > prix canonical_unit) peut être **sur-facturé**. Le client paie trop.

### 7.3 Impact comptable

- **3 factures émises** avec des montants factuellement faux
- Ces factures ont potentiellement été comptabilisées
- La correction nécessitera des **avoirs** ou **factures rectificatives**

### 7.4 Impact confiance

- Si un client ou comptable vérifie les montants, l'incohérence est immédiatement visible
- Le prix affiché (1,36 €/Carton) est absurde pour un produit vendu à la pièce à ce prix

### 7.5 Données verrouillées

Le trigger `trg_commande_lines_immutable_price` rend la correction **impossible** sans intervention SQL administrative (désactivation temporaire du trigger ou correction directe).

---

## 8. QUESTIONS OUVERTES

### 8.1 État historique du conditionnement_config

**Question :** Le `conditionnement_config` de certains produits était-il peut-être incomplet au moment de l'envoi (pas de packagingLevels), et complété ultérieurement ?

**Impact :** Si la config était vide au moment de l'envoi mais que le BFS retournait NULL, la V2 (COALESCE fallback) aurait produit le même résultat que la V1.

**Preuve manquante :** Pas d'audit trail sur la colonne JSONB `conditionnement_config`. Le `updated_at` du produit TEST 1 est le 18 mars, donc la config a été modifiée après les premiers envois. Impossible de prouver l'état exact au 6-16 mars.

**Conclusion partielle :** Que la cause soit V1 (pas de conversion) ou V2+config vide (COALESCE), le résultat est le même : le snapshot est faux.

### 8.2 COALESCE toujours présent dans V3

**Question :** Pourquoi la migration `20260322163745` (intitulée "Remove COALESCE(..., 1.0) fallback") a-t-elle **conservé** le COALESCE dans le code déployé ?

**Observation :** Le code actuel en production contient toujours :
```sql
COALESCE(fn_product_unit_price_factor(...), 1.0)  -- Safe: we already verified all paths exist above
```

Le commentaire "Safe" est techniquement correct si le hard block fonctionne, mais le COALESCE reste une **branche morte dangereuse** qui pourrait être atteinte via le trou SQL NULL décrit en §5.

### 8.3 Trou NULL non exploité (mais exploitable)

**Question :** Existe-t-il des produits avec `final_unit_id IS NULL` qui ont été ou pourraient être commandés ?

**Vérification :** Aucun produit commandé avec `final_unit_id IS NULL` dans les données actuelles. Mais le trou logique existe dans le code.

---

## ANNEXE A — Chronologie des versions de fn_send_commande

| Version | Migration | Date | Logique prix |
|:-------:|-----------|------|-------------|
| V1 | `20260306180508` | 6 mars | `snapshot = final_unit_price` (aucune conversion) |
| V2 | `20260317175003` | 17 mars | `snapshot = final_unit_price × COALESCE(BFS, 1.0)` |
| V3 | `20260322163745` | 22 mars | Hard block + `snapshot = final_unit_price × COALESCE(BFS, 1.0)` |

## ANNEXE B — Impact financier détaillé (18 lignes)

| Commande | Produit | Snapshot | Correct | Perte |
|----------|---------|--------:|--------:|------:|
| CMD-000009 | TEST 1 | 2,72 | 54,40 | 51,68 |
| CMD-000010 | TEST 1 | 4,76 | 95,20 | 90,44 |
| CMD-000028 | BURRATA SAPORI MIEI | 13,50 | 27,00 | 13,50 |
| CMD-000031 | CHORIZO IKBAL | 14,18 | 28,37 | 14,19 |
| CMD-000032 | TEST 1 | 13,60 | 272,00 | 258,40 |
| CMD-000033 | TEST 1 | 1,36 | 27,20 | 25,84 |
| CMD-000034 | TEST 1 | 2,72 | 54,40 | 51,68 |
| CMD-000036 | TEST 1 | 1,36 | 27,20 | 25,84 |
| CMD-000037 | BARQUETTE ALU | 0,66 | 33,15 | 32,49 |
| CMD-000038 | NUTELLA | 6,67 | 20,00 | 13,33 |
| CMD-000039 | BURRATA 125G | 2,72 | 54,35 | 51,63 |
| CMD-000040 | TEST 1 | 1,50 | 29,92 | 28,42 |
| CMD-000041 | NUTELLA | 6,67 | 20,00 | 13,33 |
| CMD-000041 | Langues de chat | 0,20 | 4,05 | 3,85 |
| CMD-000041 | CITRON JAUNE | 1,32 | 0,13 | **-1,19** |
| CMD-000041 | BURRATA 125G | 2,72 | 54,35 | 51,63 |
| CMD-000041 | CHORIZO IKBAL | 28,37 | 56,74 | 28,37 |
| CMD-000050 | BOL ROND CARTON | 0,00 | 0,00 | 0,00 |
| | | **TOTAL** | | **753,43 €** |

## ANNEXE C — Code exact actuel de fn_send_commande (extrait critique)

```sql
-- ── HARD BLOCK: Check for unconvertible lines BEFORE snapshotting ──
SELECT jsonb_agg(...)
INTO v_unconvertible_lines
FROM commande_lines cl
JOIN products_v2 p ON p.id = cl.product_id
WHERE cl.commande_id = p_commande_id
  AND cl.canonical_unit_id != p.final_unit_id       -- ⚠️ TROU: NULL != X → NULL (exclus)
  AND fn_product_unit_price_factor(...) IS NULL;

-- ── Snapshot prices with VALIDATED conversion (no fallback) ──
UPDATE commande_lines cl
SET unit_price_snapshot = ROUND(
      p.final_unit_price * COALESCE(
        fn_product_unit_price_factor(...),
        1.0  -- ⚠️ BRANCHE MORTE DANGEREUSE — atteinte si final_unit_id IS NULL
      ), 4)
FROM products_v2 p
WHERE cl.commande_id = p_commande_id AND cl.product_id = p.id;
```
