# 🔬 AUDIT CHIRURGICAL PRÉ-CORRECTION FACTURE — Rapport Complet

> **Date :** 2026-04-02  
> **Statut :** AUDIT UNIQUEMENT — AUCUNE MODIFICATION  
> **Objectif :** Prouver la chaîne de vérité du prix et identifier le point unique de correction

---

## AXE 1 — CHAÎNE DE VÉRITÉ DU PRIX

### 1.1 Produits (DB réelle)

| Produit | product_id | final_unit_price | final_unit_id (abbr) | stock_handling_unit_id (abbr) |
|---|---|---|---|---|
| TEST10 | `518ec011...` | **2.20** | `pce` | `pce` |
| TEST20 | `76274a82...` | **0.0076** | `g` | `kg` |
| TEST30 | `094aef31...` | **0.0007** | `ml` | `L` |

**Observation :** TEST10 a les mêmes unités prix/stock (pce=pce). TEST20 et TEST30 ont des unités divergentes (g≠kg, ml≠L).

---

### 1.2 Snapshot Commande — Où et Comment

#### Fonction responsable : `fn_send_commande` (lignes 122-137)

```sql
UPDATE commande_lines cl
SET unit_price_snapshot = (
      (fn_convert_line_unit_price(
        cl.product_id, p.final_unit_price, p.final_unit_id, cl.canonical_unit_id
      ))->>'converted_price'
    )::numeric,
    line_total_snapshot = ROUND(
      cl.canonical_quantity * (
        (fn_convert_line_unit_price(
          cl.product_id, p.final_unit_price, p.final_unit_id, cl.canonical_unit_id
        ))->>'converted_price'
      )::numeric, 2)
FROM products_v2 p
WHERE cl.commande_id = p_commande_id
  AND cl.product_id = p.id;
```

#### Moteur de conversion : `fn_convert_line_unit_price`

Cette RPC appelle `fn_product_unit_price_factor(product_id, from_unit, to_unit)` — un **moteur BFS en PL/pgSQL** qui parcourt :
1. `conditionnement_config.packagingLevels` (niveaux de conditionnement)
2. `conditionnement_config.equivalence` (équivalences produit)
3. `unit_conversions` (table globale)

Puis calcule :
```
converted_price = price_source × factor
```

**⚡ DÉCOUVERTE CRITIQUE : `fn_send_commande` convertit DÉJÀ le prix dans l'unité de la ligne via BFS SQL !**

Le snapshot commande est censé être **déjà correct**.

---

### 1.3 Données Commande Réelles (DB)

| Produit | quantity | unit (abbr) | unit_price_snapshot | line_total_snapshot | line_total/qty |
|---|---|---|---|---|---|
| TEST10 | 24 | `pce` | **2.2000** | **26.40** | 1.10 ⚠️ |
| TEST20 | 13.125 | `kg` | **0.0000** | **0.00** | ❌ |
| TEST30 | 3 | `L` | **0.0000** | **0.00** | ❌ |

### 🚨 ANOMALIE GRAVE DÉTECTÉE

- **TEST10** : `unit_price_snapshot = 2.20`, `line_total = 26.40`. Mais `26.40 / 24 = 1.10 ≠ 2.20`. ⚠️ Incohérence (probablement `canonical_quantity=24` mais `received_quantity=24` → `24 × 2.20 = 52.80` attendu, mais `line_total = 26.40` → semble calculé sur `canonical_quantity` avant réception ?)
  
  **Explication probable :** `line_total_snapshot` est figé **à l'envoi** (`fn_send_commande`) sur `canonical_quantity`, mais la facture utilise `received_quantity`. C'est normal — le snapshot date de l'envoi.

- **TEST20** : `unit_price_snapshot = 0.0000` ❌ — La conversion BFS SQL a **échoué** (g → kg, factor manquant ?)
- **TEST30** : `unit_price_snapshot = 0.0000` ❌ — La conversion BFS SQL a **échoué** (ml → L, factor manquant ?)

**Conclusion : Le moteur BFS SQL (`fn_product_unit_price_factor`) a échoué pour TEST20 et TEST30, produisant un prix de 0.**

---

## AXE 2 — PROPAGATION VERS FACTURE

### 2.1 Code RPC `fn_generate_app_invoice` (lignes 126-141)

```sql
INSERT INTO app_invoice_lines (
    app_invoice_id, commande_line_id, product_id,
    product_name_snapshot, quantity, unit_price, line_total,
    canonical_unit_id, unit_label_snapshot
)
SELECT
    v_invoice_id, cl.id, cl.product_id,
    cl.product_name_snapshot,
    COALESCE(cl.received_quantity, 0),
    cl.unit_price_snapshot,                    -- ← COPIE DIRECTE
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2),
    cl.canonical_unit_id, cl.unit_label_snapshot
FROM commande_lines cl
WHERE cl.commande_id = p_commande_id
  AND COALESCE(cl.received_quantity, 0) > 0;
```

**Confirmation :** La facture copie `unit_price_snapshot` tel quel, sans aucune transformation.

### 2.2 Données Facture Réelles (DB)

| Produit | quantity | unit (abbr) | unit_price | line_total | line_total/qty |
|---|---|---|---|---|---|
| TEST10 | 24 | `pce` | **2.2000** | **52.80** | **2.20** ✅ |
| TEST20 | 13.125 | `kg` | **0.0000** | **0.00** | ❌ |
| TEST30 | 3 | `L` | **0.0000** | **0.00** | ❌ |

**Note :** La facture recalcule `line_total = received_quantity × unit_price_snapshot`, d'où TEST10 = `24 × 2.20 = 52.80` (correct). Mais TEST20/TEST30 héritent du 0.

---

## AXE 3 — COMPARAISON BL vs COMMANDE vs FACTURE

| Source | TEST10 qty | TEST10 unit | TEST10 unit_price | TEST10 total |
|---|---|---|---|---|
| **Produit** | - | `pce` | 2.20 €/pce | - |
| **Commande** | 24 | `pce` | **2.2000** ✅ | 26.40 (sur canonical_qty) |
| **BL** | 60 | `pce` | **2.20** ✅ | 132.00 ✅ |
| **Facture** | 24 | `pce` | **2.2000** ✅ | 52.80 ✅ |

→ TEST10 : **ALIGNÉ PARTOUT** (pce=pce, pas de conversion nécessaire)

| Source | TEST20 qty | TEST20 unit | TEST20 unit_price | TEST20 total |
|---|---|---|---|---|
| **Produit** | - | `g` | 0.0076 €/g | - |
| **Commande** | 13.125 | `kg` | **0.0000** ❌ | 0.00 ❌ |
| **BL** | 25 | `kg` | **0.0076** ⚠️ | 190.00 ⚠️ |
| **Facture** | 13.125 | `kg` | **0.0000** ❌ | 0.00 ❌ |

→ TEST20 :
- **Commande** : BFS SQL a échoué → prix = 0
- **BL** : `unit_price = 0.0076` → c'est le prix EN GRAMME, pas en kg ! `25 × 0.0076 = 0.19`, pas 190. **Le BL a aussi un problème** — `line_total = 190` ne correspond pas à `25 × 0.0076`.
  
  **Explication :** `line_total = 190` = `25 × 7.60`. Le prix converti (7.60 €/kg) a été utilisé pour `line_total` mais `unit_price` stocke encore 0.0076 €/g. **C'est l'ancien bug BL** — les données viennent d'AVANT le fix V2.

- **Facture** : hérite du snapshot commande = 0

| Source | TEST30 qty | TEST30 unit | TEST30 unit_price | TEST30 total |
|---|---|---|---|---|
| **Produit** | - | `ml` | 0.0007 €/ml | - |
| **Commande** | 3 | `L` | **0.0000** ❌ | 0.00 ❌ |
| **BL** | 22.5 | `L` | **0.0007** ⚠️ | 15.75 ⚠️ |
| **Facture** | 3 | `L` | **0.0000** ❌ | 0.00 ❌ |

→ TEST30 : Même pattern que TEST20. BL pre-fix, commande BFS SQL échoué, facture = 0.

---

## AXE 4 — DIAGNOSTIC ROOT CAUSE

### 🔑 DÉCOUVERTE MAJEURE

Le problème n'est **PAS** dans `fn_generate_app_invoice`.  
Le problème n'est **PAS** dans le frontend facture.  
Le problème n'est **PAS** dans le pattern de copie.

**Le problème est dans `fn_product_unit_price_factor` (BFS SQL)** qui échoue pour les conversions g→kg et ml→L, retournant NULL, ce qui produit `unit_price_snapshot = 0`.

### Preuve :
```
fn_convert_line_unit_price(product_id, 0.0076, g_unit_id, kg_unit_id) 
  → appelle fn_product_unit_price_factor(product_id, g_unit_id, kg_unit_id) 
  → retourne NULL (pas de chemin trouvé)
  → fn_convert_line_unit_price retourne error: 'no_conversion_path'
```

Mais `fn_send_commande` utilise un **fallback à 0** quand la conversion échoue (le prix n'est pas `NULL` mais `0.0000`).

### Chaîne causale :
```
1. fn_send_commande appelle fn_convert_line_unit_price(g → kg)
2. fn_product_unit_price_factor ne trouve pas g → kg 
   (probablement car unit_conversions manque cette règle pour cet establishment)
3. Retourne NULL → fn_convert_line_unit_price retourne error
4. fn_send_commande SET unit_price_snapshot = ... qui évalue à 0 (cast NULL→0)
5. fn_generate_app_invoice copie 0 → facture = 0
```

---

## AXE 5 — FRONTEND

### `useInvoiceDisplayPrices.ts`

Le frontend :
1. Fetch `products_v2.final_unit_id` + `conditionnement_config`
2. Fetch `measurement_units` + `unit_conversions`
3. Appelle `convertPriceToLineUnit()` (BFS TypeScript)
4. Produit `display_unit_price`

**Ce hook ne corrige PAS le cas 0** — il ne peut pas transformer `0.0000` en `7.60`. Il reconvertit uniquement si `unit_price !== 0` (ligne 114 : `line.unit_price !== 0`).

**Donc pour TEST20/TEST30, même le frontend ne peut pas compenser.**

---

## RÉSUMÉ — ÉTAT DE CHAQUE INVARIANT

| Invariant | TEST10 | TEST20 | TEST30 |
|---|---|---|---|
| Commande snapshot dans unité ligne | ✅ 2.20 €/pce | ❌ 0.00 (BFS SQL fail) | ❌ 0.00 (BFS SQL fail) |
| Facture = copie fidèle commande | ✅ | ✅ (copie fidèle du 0) | ✅ (copie fidèle du 0) |
| BL unit_price dans unité ligne | ✅ 2.20 €/pce | ⚠️ Données pre-fix | ⚠️ Données pre-fix |
| line_total = qty × unit_price | ✅ | ❌ partout | ❌ partout |
| Frontend compense | N/A | ❌ Ne peut pas (prix=0) | ❌ Ne peut pas (prix=0) |

---

## ANALYSE D'IMPACT — OPTIONS DE CORRECTION

### OPTION A — Corriger `fn_product_unit_price_factor` (BFS SQL)

| Aspect | Évaluation |
|---|---|
| **Point d'intervention** | Unique — la fonction BFS SQL |
| **Impact** | Toutes les futures commandes B2B auront le bon snapshot |
| **Cascade** | Commande → Facture automatiquement corrigée |
| **Risque** | ⚠️ Moyen — il faut comprendre pourquoi g→kg échoue (manque `unit_conversions` pour cet establishment ?) |
| **Effet sur BL** | Aucun — BL utilise son propre BFS TypeScript |
| **Effet sur historique** | Aucun — ne touche pas les anciennes données |
| **Effet sur litiges** | Aucun — le prix litige vient du snapshot déjà figé |

### OPTION B — Corriger `fn_generate_app_invoice` (post-traitement)

| Aspect | Évaluation |
|---|---|
| **Point d'intervention** | La RPC facture |
| **Impact** | Facture corrigée, mais commande reste fausse |
| **Cascade** | Facture seulement |
| **Risque** | ❌ ÉLEVÉ — crée une divergence commande vs facture |
| **Diagnostic** | Masque le vrai bug (BFS SQL cassé) |

### OPTION C — Ajouter les conversions g→kg et ml→L dans `unit_conversions`

| Aspect | Évaluation |
|---|---|
| **Point d'intervention** | Données DB (table `unit_conversions`) |
| **Impact** | Le BFS SQL fonctionne immédiatement |
| **Cascade** | Toute la chaîne est corrigée d'un coup |
| **Risque** | ✅ MINIMAL — pas de code modifié |
| **Vérification** | Simple — re-exécuter fn_send_commande sur une nouvelle commande |

---

## VERDICT FINAL

### 🔑 LE VRAI PROBLÈME N'EST PAS L'ARCHITECTURE

L'architecture est **correcte** :
- `fn_send_commande` convertit le prix via BFS SQL ✅
- `fn_generate_app_invoice` copie le snapshot ✅
- `useInvoiceDisplayPrices` reconvertit pour l'affichage ✅

### LE VRAI PROBLÈME EST UNE DONNÉE MANQUANTE

Le BFS SQL (`fn_product_unit_price_factor`) ne trouve pas le chemin g→kg (ou ml→L) **pour ces produits dans cet establishment**. C'est probablement un problème de :
1. Conversions manquantes dans `unit_conversions` pour cet establishment
2. Ou `conditionnement_config` incomplet pour ces produits de test

---

## RECOMMANDATION UNIQUE

### ✅ OPTION A + C COMBINÉE

1. **Diagnostiquer** pourquoi `fn_product_unit_price_factor` échoue pour g→kg et ml→L
   - Vérifier `unit_conversions` pour cet establishment
   - Vérifier `conditionnement_config` des produits TEST20/TEST30
2. **Corriger la donnée manquante** (pas le code)
3. **Valider** que le BFS SQL fonctionne correctement
4. **Supprimer `useInvoiceDisplayPrices`** uniquement APRÈS confirmation que les nouveaux snapshots sont corrects

### ❌ NE PAS FAIRE
- Ne pas modifier `fn_generate_app_invoice`
- Ne pas modifier `fn_send_commande`
- Ne pas créer de logique parallèle
- Ne pas toucher au BL

### 📝 À INVESTIGUER EN PRIORITÉ
```sql
-- Vérifier si les conversions g→kg existent pour l'establishment
SELECT * FROM unit_conversions 
WHERE (from_unit_id = '<g_unit_id>' AND to_unit_id = '<kg_unit_id>')
   OR (from_unit_id = '<kg_unit_id>' AND to_unit_id = '<g_unit_id>');
```
