# 🔍 AUDIT CROISÉ — Prompt "Unification BL/Facture" vs Code Réel

> **Date :** 2026-04-02  
> **Objectif :** Vérifier si le prompt est cohérent avec le code et safe à implémenter

---

## 1. DÉCOUVERTE CRITIQUE — La facture App n'est PAS créée côté frontend

### Ce que le prompt suppose :
> "Identifier le point d'entrée unique de création des lignes facture"
> → Sous-entend un service TS similaire à `blAppService.ts`

### Ce que le code montre réellement :
**La facture est créée par une RPC SQL `fn_generate_app_invoice`** (SECURITY DEFINER, côté serveur PostgreSQL).

```sql
-- Ligne 126-141 de fn_generate_app_invoice:
INSERT INTO app_invoice_lines (
    app_invoice_id, commande_line_id, product_id,
    product_name_snapshot, quantity, unit_price, line_total,
    canonical_unit_id, unit_label_snapshot
)
SELECT
    v_invoice_id, cl.id, cl.product_id,
    cl.product_name_snapshot,
    COALESCE(cl.received_quantity, 0),
    cl.unit_price_snapshot,                                    -- ← COPIE DIRECTE
    ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2),
    cl.canonical_unit_id, cl.unit_label_snapshot
FROM commande_lines cl
WHERE cl.commande_id = p_commande_id
  AND COALESCE(cl.received_quantity, 0) > 0;
```

### Implication :
- **Le prix facture est un snapshot direct de `commande_lines.unit_price_snapshot`**
- Il n'y a PAS de logique de conversion BFS dans la facture
- La facture hérite du prix tel que figé dans la commande

---

## 2. LA VRAIE QUESTION : `commande_lines.unit_price_snapshot` est-il dans l'unité de la ligne ?

### Chaîne de vérité :
```
products_v2.final_unit_price (€/final_unit_id)
    ↓ snapshot lors de fn_send_commande ou fn_ship_commande
commande_lines.unit_price_snapshot (€/??? quelle unité)
    ↓ copie directe par fn_generate_app_invoice
app_invoice_lines.unit_price (€/??? héritée)
```

### Vérification :
Le `unit_price_snapshot` dans `commande_lines` est figé **lors de l'expédition B2B** (`fn_ship_commande`). Il copie le prix du produit tel quel — dans l'unité `final_unit_id`, **PAS** dans `canonical_unit_id`.

**Donc : `app_invoice_lines.unit_price` souffre du MÊME problème que l'ancien BL** — le prix est dans l'unité source produit, pas dans l'unité de la ligne.

---

## 3. ANALYSE DU PROMPT — Point par Point

| Affirmation du prompt | Vérité code | Verdict |
|---|---|---|
| "La facture App suit encore l'ancien pattern" | ✅ VRAI — `fn_generate_app_invoice` copie `unit_price_snapshot` tel quel | ✅ Correct |
| "Le frontend facture compense via reconversion" | ✅ VRAI — `useInvoiceDisplayPrices.ts` reconvertit via BFS | ✅ Correct |
| "Identifier le point d'entrée unique côté backend" | ⚠️ Le prompt sous-entend un service TS, mais c'est une **RPC SQL** | ⚠️ Imprécis |
| "Réutiliser la logique BL telle quelle" | ❌ IMPOSSIBLE — BL = service TS avec BFS client-side, Facture = RPC SQL PL/pgSQL | ❌ Incompatible |
| "Supprimer la reconversion frontend facture" | ✅ Correct comme objectif | ✅ OK |
| "Un snapshot déjà correct ne doit pas être reconverti" | ✅ Bon principe mais non applicable ici (le snapshot n'est PAS correct) | ⚠️ NA |

---

## 4. RISQUES DU PROMPT TEL QUEL

### ❌ RISQUE 1 — Mauvais point d'intervention
Le prompt demande de modifier "le service backend" comme pour le BL. Mais la facture est créée dans une **RPC SQL**. Si Lovable applique le prompt littéralement, il risque de :
- Créer un nouveau service TS `factureAppService.createInvoiceLines()` → **nouvelle logique parallèle**
- Ou ignorer la RPC et recréer le flow côté client → **duplication**

### ❌ RISQUE 2 — Le vrai problème est en amont
Le prix de la facture vient de `commande_lines.unit_price_snapshot`. Ce snapshot est figé **lors de l'expédition** (`fn_ship_commande`). Pour que la facture soit correcte, c'est **le snapshot dans commande_lines** qui doit déjà être correct.

La correction au bon endroit serait dans `fn_ship_commande` (ou `fn_send_commande`), **PAS** dans `fn_generate_app_invoice`.

### ⚠️ RISQUE 3 — Double conversion si appliqué naïvement
Si on ajoute une conversion BFS dans `fn_generate_app_invoice` alors que `commande_lines.unit_price_snapshot` est déjà dans l'unité source, c'est correct. Mais si un jour le snapshot en amont est corrigé aussi, on aura une **double conversion**.

---

## 5. ÉTAT ACTUEL DU FRONTEND FACTURE

`useInvoiceDisplayPrices.ts` :
- Fetch `products_v2.final_unit_id` + `conditionnement_config`
- Fetch `measurement_units` + `unit_conversions`
- Appelle `convertPriceToLineUnit()` pour reconvertir le prix
- Produit `display_unit_price` pour l'affichage

**Ce hook est la compensation frontend exacte** que le prompt veut éliminer. ✅ L'objectif est correct.

---

## 6. ARCHITECTURE DE CORRECTION CORRECTE

### Option A — Corriger dans `fn_generate_app_invoice` (SQL)
- Ajouter la conversion BFS **en PL/pgSQL** dans la RPC
- Avantage : un seul point de correction
- **Problème : le moteur BFS n'existe pas en SQL**, il est en TypeScript

### Option B — Corriger dans `fn_ship_commande` (amont)
- Convertir `unit_price_snapshot` dans l'unité de la ligne au moment de l'expédition
- La facture hérite automatiquement du bon prix
- **Problème : impact sur TOUT le flux B2B** (commandes, litiges, etc.)

### Option C — Corriger dans un service TS intermédiaire (RECOMMANDÉ)
- Créer un wrapper TS autour de `fn_generate_app_invoice`
- Après l'appel RPC, mettre à jour les lignes avec les prix convertis via BFS
- Supprimer `useInvoiceDisplayPrices`
- **Aligné avec le pattern BL** sans toucher au SQL

---

## 7. VERDICT FINAL

### ⚠️ LE PROMPT EST PARTIELLEMENT INCORRECT — NE PAS EXÉCUTER TEL QUEL

| Aspect | Évaluation |
|---|---|
| Objectif (unifier BL/facture) | ✅ Correct et souhaitable |
| Diagnostic (la facture compense en frontend) | ✅ Correct |
| Stratégie d'implémentation | ❌ **Incorrecte** — suppose un service TS alors que c'est une RPC SQL |
| "Réutiliser la logique BL telle quelle" | ❌ **Impossible** — architectures différentes (TS vs PL/pgSQL) |
| Risque de nouvelle logique parallèle | ⚠️ **ÉLEVÉ** si exécuté littéralement |
| Anti double conversion | ✅ Bon réflexe mais le vrai risque est ailleurs |

### RECOMMANDATION

**STOP** — Ne pas exécuter ce prompt tel quel.

**Corrections nécessaires au prompt :**
1. Préciser que la facture est créée par `fn_generate_app_invoice` (RPC SQL), pas un service TS
2. Préciser que le prix vient de `commande_lines.unit_price_snapshot` (figé à l'expédition)
3. Choisir explicitement entre :
   - **Option B** : corriger `fn_ship_commande` (amont, cascade automatique)
   - **Option C** : post-traitement TS après la RPC (plus isolé, moins risqué)
4. Ne PAS demander de "réutiliser la logique BL telle quelle" — demander plutôt de "suivre le même principe de conversion"
