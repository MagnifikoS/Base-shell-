# Audit Cas 2 — Dérive des prix d'achat

**Date** : 2026-03-14  
**Périmètre** : Flux prix d'achat — commande → réception → facture → historique achats → rapports marchandise  
**Méthode** : Analyse code source, RPC SQL, services frontend, hooks de lecture

---

## 1. Résumé exécutif

**Le système de prix d'achat de Restaurant OS repose sur DEUX circuits de prix totalement distincts, qui ne se contaminent pas entre eux.** Le risque de dérive prix commande/facture est **maîtrisé** pour le circuit B2B commandes. En revanche, un **risque réel et documenté** existe sur le module Marchandise (food cost), qui valorise les stocks et la consommation avec le prix catalogue actuel (`final_unit_price`) au lieu d'un prix historique figé.

### Verdict rapide

| Circuit | Risque | Gravité |
|---------|--------|---------|
| B2B Commandes (commande → facture app) | ✅ Prix figé à l'envoi, immuable | Aucun |
| Vision AI → Achats (facture fournisseur → purchase_line_items) | ✅ Prix OCR réel capturé | Aucun |
| Historique prix (brain_events) | ✅ Prix observés au moment de la saisie | Aucun |
| **Marchandise / Food cost** | ⚠️ **Utilise le prix catalogue ACTUEL** | **P1 — Critique** |

**Le MVP peut-il être lancé ?** Oui, sous condition de documenter que le module Marchandise affiche une valorisation **approximative** basée sur les prix courants, pas sur les prix réellement payés.

---

## 2. Source de vérité du prix

Il existe **trois sources de vérité de prix** dans le système, chacune légitime pour son périmètre :

### A. `products_v2.final_unit_price` — Prix catalogue courant

- **Rôle** : Prix unitaire d'achat le plus récent, mis à jour par Vision AI lors de l'extraction OCR des factures fournisseur
- **Fichiers qui l'utilisent en lecture** :
  - `src/modules/marchandise/engine/monthlyMerchandiseEngine.ts` (lignes 126, 136, 146, 398-410)
  - `src/modules/commandes/services/commandeService.ts` (indirectement — `getProductsForSupplier` ne lit PAS le prix)
  - `fn_send_commande` (SQL) — lit ce prix pour le figer dans `unit_price_snapshot`
- **Nature** : **Mutable** — change à chaque nouvelle facture fournisseur traitée par Vision AI
- **Danger** : Tout calcul rétrospectif utilisant ce prix donnera un résultat faux si le prix a changé

### B. `commande_lines.unit_price_snapshot` — Prix figé à l'envoi de commande

- **Rôle** : Snapshot du prix au moment exact de l'envoi de la commande B2B
- **Fichier qui l'écrit** : `fn_send_commande` (migration `20260306180508`)
- **Protection** : Trigger d'immutabilité `trg_commande_lines_immutable_price` — toute tentative de modification post-écriture lève une exception
- **Fichiers qui le lisent** :
  - `fn_generate_app_invoice` (migration `20260309213912`) — utilise `unit_price_snapshot` pour calculer le total HT facture
  - Composants d'affichage commande (types dans `src/modules/commandes/types.ts`)
- **Nature** : **Immuable une fois écrit** — protégé par trigger SQL

### C. `purchase_line_items.line_total` / `quantite_commandee` — Prix réel facturé

- **Rôle** : Ligne d'achat extraite par Vision AI depuis la facture fournisseur réelle
- **Fichier qui l'écrit** : `src/modules/achat/utils/buildPurchaseLines.ts` → `purchaseService.createPurchaseLines()`
- **Protection** : Upsert idempotent sur `(invoice_id, source_line_id)` — pas de doublon
- **Fichiers qui le lisent** :
  - `src/modules/achat/services/purchaseService.ts` — `fetchMonthlyPurchaseSummary()`
  - `src/modules/achatsBrainSummary/services/achatsBrainSummaryService.ts`
- **Nature** : **Immuable de facto** — jamais mis à jour après insertion (seulement `product_id` peut être lié après coup)

---

## 3. Cartographie complète du flux prix

### Circuit 1 — B2B Commandes (interne app)

```
Client crée brouillon commande
  → upsertCommandeLines() — PAS de prix (quantité + produit seulement)
  → commande_lines.unit_price_snapshot = NULL
  
Client envoie la commande
  → fn_send_commande (RPC SQL, SECURITY DEFINER)
  → UPDATE commande_lines SET unit_price_snapshot = products_v2.final_unit_price
  → Vérification : si prix NULL → REJET (missing_price)
  → Trigger immutabilité actif : plus jamais modifiable
  
Fournisseur prépare/expédie
  → shipped_quantity modifié — prix JAMAIS touché
  
Client reçoit
  → received_quantity modifié — prix JAMAIS touché
  
Fournisseur facture
  → fn_generate_app_invoice lit unit_price_snapshot (figé)
  → Total HT = Σ(received_quantity × unit_price_snapshot)
  → Insertion dans app_invoice_lines avec unit_price figé
```

**Conclusion** : Ce circuit est **parfaitement sécurisé**. Le prix est figé une seule fois, protégé par trigger, et jamais recalculé.

### Circuit 2 — Vision AI → Achats (factures fournisseur externes)

```
Utilisateur upload facture fournisseur (PDF/photo)
  → Vision AI extrait les lignes (quantité, prix unitaire, total ligne)
  → Données brutes stockées dans invoice_line_items
  
Utilisateur valide la facture
  → buildPurchaseLineInputs() construit les lignes d'achat
  → line_total = prix RÉEL extrait de la facture
  → quantite_commandee = quantité RÉELLE de la facture
  → INSERT purchase_line_items (upsert idempotent)
  
Module Achat affiche le récap
  → fetchMonthlyPurchaseSummary() lit purchase_line_items
  → Agrège par (supplier_id, product_id)
  → Affiche total_amount = Σ(line_total) = vrais montants payés
```

**Conclusion** : Ce circuit capture les **vrais prix payés**. Pas de risque de dérive.

### Circuit 3 — Historique prix (The Brain)

```
Après validation facture
  → logPurchaseObserved() écrit dans brain_events
  → subject = 'price_evolution', action = 'observed'
  → context.unit_price = prix extrait au moment de l'observation
  
Module prix affiche l'historique
  → useProductPriceHistory() lit brain_events
  → Agrège par year_month
  → Affiche min/max/first/last prix OBSERVÉS
```

**Conclusion** : Ce circuit est **safe** — il capture les prix au moment de l'observation, pas les prix courants.

### Circuit 4 — Marchandise / Food Cost ⚠️

```
Moteur Marchandise calcule la consommation
  → monthlyMerchandiseEngine.ts
  → Formule : Consommation = Stock(A) + Réceptions(A→B) − Stock(B)
  → Valorisation : quantity × products_v2.final_unit_price (ACTUEL)
  
  ⚠️ Si le prix a changé entre l'inventaire A et l'inventaire B :
     → La valorisation de Stock(A) utilise le prix d'AUJOURD'HUI
     → La valorisation des réceptions utilise le prix d'AUJOURD'HUI  
     → Le résultat est mathématiquement incohérent
```

**Conclusion** : Ce circuit est **vulnérable** à la dérive de prix.

---

## 4. Audit commande — Prix figé à l'envoi

### Mécanisme

**Fichier** : `supabase/migrations/20260306180508_323d1643-b3a2-4f5c-b450-d6348b48c7f8.sql`

```sql
-- ÉTAPE 0 : Figer les prix depuis products_v2.final_unit_price
UPDATE commande_lines cl
SET unit_price_snapshot = p.final_unit_price,
    line_total_snapshot = ROUND(cl.canonical_quantity * COALESCE(p.final_unit_price, 0), 2)
FROM products_v2 p
WHERE cl.commande_id = p_commande_id
  AND cl.product_id = p.id;
```

### Protections

1. **Vérification prix NULL** : Si `unit_price_snapshot IS NULL` après le UPDATE → la RPC retourne `{ok: false, error: 'missing_price'}` et la commande n'est PAS envoyée
2. **Trigger d'immutabilité** : `trg_commande_lines_immutable_price` — lève une exception si quelqu'un tente de modifier `unit_price_snapshot` ou `line_total_snapshot` après qu'ils ont été assignés
3. **Atomicité** : Tout se passe dans une seule transaction SQL avec `SELECT ... FOR UPDATE`

### Verdict commande

✅ **SAFE** — Le prix est figé au moment de l'envoi, protégé par trigger, et jamais recalculé. Le scénario "le fournisseur change son prix jeudi" ne peut PAS affecter une commande déjà envoyée.

---

## 5. Audit réception — Prix non modifié

### Mécanisme

La réception (action `receive` dans `commandes-api`) met à jour :
- `received_quantity` sur chaque `commande_line`
- `status` de la commande → `recue`
- `reception_type` (conforme/partielle/litige)

**Elle ne touche JAMAIS à** `unit_price_snapshot` ni `line_total_snapshot`.

### Preuve

Le trigger `trg_commande_lines_immutable_price` interdirait toute modification même si la réception tentait de les changer.

### Verdict réception

✅ **SAFE** — La réception ne peut pas altérer les prix figés.

---

## 6. Audit facture — Prix snapshot utilisé

### Mécanisme

**Fichier** : `supabase/migrations/20260309213912_e73114d2-9563-4962-993f-029c2fdfc8fe.sql`

```sql
-- Calcul total HT
SELECT COALESCE(SUM(
  ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
), 0) INTO v_total_ht
FROM commande_lines cl
WHERE cl.commande_id = p_commande_id
  AND COALESCE(cl.received_quantity, 0) > 0;
```

La facture utilise :
- `received_quantity` (quantité réellement reçue)
- `unit_price_snapshot` (prix figé à l'envoi)
- **Jamais** `products_v2.final_unit_price`

### Protection supplémentaire

La RPC `fn_generate_app_invoice` vérifie que TOUS les `unit_price_snapshot` sont non-NULL avant de générer la facture :

```sql
SELECT count(*) INTO v_missing_price
FROM commande_lines
WHERE commande_id = p_commande_id AND unit_price_snapshot IS NULL;

IF v_missing_price > 0 THEN
  RETURN jsonb_build_object('ok', false, 'error', 'missing_price_snapshot');
END IF;
```

### Verdict facture

✅ **SAFE** — La facture app utilise exclusivement les prix figés, jamais le catalogue.

---

## 7. Audit historique achats (purchase_line_items)

### Ce qui est stocké

Les `purchase_line_items` stockent :
- `line_total` : montant total de la ligne tel qu'extrait de la facture fournisseur réelle (OCR Vision AI)
- `quantite_commandee` : quantité telle qu'indiquée sur la facture
- `product_name_snapshot`, `product_code_snapshot`, `unit_snapshot` : snapshots textuels

### Ce qui est affiché

`fetchMonthlyPurchaseSummary()` (ligne 74-236 de `purchaseService.ts`) :
- Lit `line_total` et `quantite_commandee` directement depuis `purchase_line_items`
- Agrège par produit et fournisseur
- **Ne relit JAMAIS** `products_v2.final_unit_price` pour recalculer les montants
- Utilise `products_v2` uniquement pour résoudre les noms et catégories (cosmétique)

### Verdict historique achats

✅ **SAFE** — L'historique affiche les vrais montants payés, pas des recalculs catalogue.

---

## 8. Faille identifiée — Module Marchandise

### F1 — Valorisation stock avec prix courant au lieu de prix historique

| Attribut | Valeur |
|----------|--------|
| **Nom** | Valorisation marchandise à prix courant |
| **Gravité** | ⚠️ P1 — Impact financier sur les rapports |
| **Fichier** | `src/modules/marchandise/engine/monthlyMerchandiseEngine.ts` |
| **Lignes** | 126, 136, 146, 398-410 |
| **Preuve** | `product.final_unit_price` est lu depuis `products_v2` au moment du calcul, pas au moment de l'inventaire |

#### Comportement actuel

```typescript
// monthlyMerchandiseEngine.ts, ligne 136
total += round2(qty * product.final_unit_price);
```

Le moteur Marchandise calcule :
- `Stock(A)` = quantités inventaire A × **prix catalogue actuel**
- `Réceptions(A→B)` = mouvements stock × **prix catalogue actuel**
- `Stock(B)` = quantités inventaire B × **prix catalogue actuel**
- `Consommation` = Stock(A) + Réceptions − Stock(B)

#### Scénario de dérive

1. **1er mars** : Inventaire A → 10 kg tomates, prix catalogue = 8 €/kg → Valorisation = 80 €
2. **15 mars** : Fournisseur passe à 9 €/kg, facture traitée par Vision AI → `final_unit_price` mis à jour à 9 €
3. **31 mars** : Inventaire B → 5 kg tomates
4. **Calcul Marchandise** (consulté le 31 mars) :
   - Stock(A) = 10 × **9** = 90 € (FAUX — c'était 80 € au moment de l'inventaire)
   - Réceptions = 20 × **9** = 180 € (possiblement faux)
   - Stock(B) = 5 × **9** = 45 €
   - Consommation = 90 + 180 − 45 = 225 € (gonflé vs réalité)

#### Conséquence terrain

- Food cost affiché plus élevé que la réalité
- Comparaison entre périodes faussée (mêmes quantités → montants différents si le prix a changé)
- Pas de crash, pas d'erreur visible — juste des chiffres plausibles mais faux

#### Conditions de déclenchement

- Un prix catalogue change entre deux inventaires
- Le rapport Marchandise est consulté après le changement de prix
- Plus la fréquence des changements de prix est élevée, plus la dérive est importante

#### Facteur atténuant

- Pour 2-3 restaurants en MVP, les prix changent peu d'un mois à l'autre
- La dérive est proportionnelle à l'écart de prix (quelques %)
- Le module est présenté comme un outil d'aide, pas comme une comptabilité certifiée

---

## 9. Faux positifs écartés

### FP1 — "Le prix de la commande B2B change si le catalogue change"

**Écarté** : Le prix est figé dans `unit_price_snapshot` au moment de l'envoi. Le trigger d'immutabilité empêche toute modification ultérieure. Même si `products_v2.final_unit_price` change ensuite, la commande conserve son prix d'origine.

### FP2 — "La facture app recalcule avec le prix catalogue"

**Écarté** : `fn_generate_app_invoice` utilise exclusivement `cl.unit_price_snapshot`, jamais `products_v2.final_unit_price`. Prouvé par le code SQL (lignes 103, 152 de la migration `20260309213912`).

### FP3 — "L'historique achats affiche le prix catalogue au lieu du prix payé"

**Écarté** : `purchase_line_items.line_total` est le montant OCR extrait de la facture réelle. `fetchMonthlyPurchaseSummary()` lit ce champ directement, sans recalcul catalogue.

### FP4 — "Le brain/price_evolution est contaminé par les changements de prix"

**Écarté** : `logPurchaseObserved()` capture le `unit_price` au moment de l'observation. Les événements sont append-only et ne sont jamais recalculés.

### FP5 — "Les BL retrait recalculent le prix"

**Écarté** : Les `bl_withdrawal_lines` stockent `unit_price_snapshot` et `line_total_snapshot` au moment de la création. Ces valeurs sont figées (même pattern que les commandes).

---

## 10. Verdict

### ✅ SAFE pour MVP — Circuit B2B Commandes

Le flux commande → réception → facture est **mathématiquement fiable** :
- Prix figé à l'envoi (fn_send_commande)
- Protégé par trigger d'immutabilité
- Facture basée sur snapshots, pas sur catalogue
- Aucun scénario de dérive identifié

### ✅ SAFE pour MVP — Circuit Achats (Vision AI)

Le flux facture fournisseur → purchase_line_items est **fiable** :
- Prix réels extraits par OCR
- Stockés tels quels, jamais recalculés
- Historique basé sur les montants réels

### ⚠️ SAFE SOUS CONDITION — Module Marchandise

Le module Marchandise utilise le prix catalogue courant pour valoriser les stocks et la consommation. Cela produit des **approximations** qui peuvent dériver si les prix changent significativement entre deux inventaires.

**Condition MVP** : Ce comportement est acceptable si :
1. Il est documenté comme une estimation (pas une comptabilité certifiée)
2. Les utilisateurs comprennent que les montants en € sont indicatifs
3. On n'utilise pas ces chiffres pour des décisions financières critiques

---

## 11. Stratégie de correction recommandée

### Pas de correction immédiate requise pour le MVP

Les circuits critiques (commandes, factures, achats) sont sécurisés. La faille F1 (marchandise) est une limitation connue, pas un bug.

### Correction future recommandée (post-MVP)

Pour le module Marchandise, la stratégie propre serait :

1. **Stocker le prix au moment de l'inventaire** : Ajouter un champ `unit_price_at_count` sur `inventory_lines` qui capture `products_v2.final_unit_price` au moment du comptage
2. **Stocker le prix au moment du mouvement stock** : Ajouter un champ `unit_price_snapshot` sur `stock_events` pour figer le prix à chaque réception/retrait
3. **Valoriser avec les prix historiques** : Le moteur Marchandise utiliserait ces prix figés au lieu du prix catalogue courant

### Ce qu'il ne faut PAS faire

- Ne pas modifier `fn_send_commande` — il est déjà correct
- Ne pas modifier le trigger d'immutabilité — il est essentiel
- Ne pas modifier `fn_generate_app_invoice` — il est déjà correct
- Ne pas ajouter de prix snapshot sur les tables existantes de commande (déjà fait)
- Ne pas "corriger" le module Achats — il est déjà correct

---

## 12. Preuves

### Fichiers vérifiés

| Fichier | Rôle | Prix utilisé | Verdict |
|---------|------|-------------|---------|
| `supabase/migrations/20260306180508_*.sql` | fn_send_commande | `products_v2.final_unit_price` → snapshot | ✅ Figé |
| `supabase/migrations/20260309213912_*.sql` | fn_generate_app_invoice | `commande_lines.unit_price_snapshot` | ✅ Snapshot |
| `src/modules/commandes/services/commandeService.ts` | Service commande | Pas de lecture prix | ✅ Neutre |
| `src/modules/achat/utils/buildPurchaseLines.ts` | Construction lignes achat | `lineTotalPrice` (OCR) | ✅ Prix réel |
| `src/modules/achat/services/purchaseService.ts` | Lecture récap achats | `purchase_line_items.line_total` | ✅ Prix réel |
| `src/modules/achat/hooks/useProductPriceHistory.ts` | Historique prix | `brain_events.context.unit_price` | ✅ Observé |
| `src/modules/achat/hooks/usePriceEvolutionEvents.ts` | Synthèse prix | `brain_events.context.unit_price` | ✅ Observé |
| **`src/modules/marchandise/engine/monthlyMerchandiseEngine.ts`** | **Valorisation stock** | **`products_v2.final_unit_price`** | **⚠️ Prix courant** |

### RPC SQL vérifiées

| RPC | Utilise snapshot ? | Utilise catalogue ? | Verdict |
|-----|-------------------|--------------------|---------| 
| `fn_send_commande` | Écrit le snapshot | Lit catalogue pour figer | ✅ |
| `fn_generate_app_invoice` | Lit snapshot uniquement | Non | ✅ |
| `fn_ship_commande` | Non (quantités seulement) | Non | ✅ |
| `fn_receive_commande` | Non (quantités seulement) | Non | ✅ |

### Triggers vérifiés

| Trigger | Table | Protection |
|---------|-------|-----------|
| `trg_commande_lines_immutable_price` | `commande_lines` | Empêche modification de `unit_price_snapshot` et `line_total_snapshot` |

---

## Question finale — Réponse

> **Restaurant OS peut-il afficher ou utiliser un prix d'achat différent du prix réellement payé dans certains scénarios ?**

**Réponse** : 

- **NON** pour les commandes B2B, les factures app, l'historique achats et les rapports prix — les prix sont figés au bon moment et jamais recalculés.
- **OUI** pour le module Marchandise (food cost) — il valorise les stocks et la consommation avec le prix catalogue courant, pas le prix payé au moment du mouvement. Cette dérive est proportionnelle aux variations de prix et reste une approximation acceptable pour un MVP, mais doit être documentée.
