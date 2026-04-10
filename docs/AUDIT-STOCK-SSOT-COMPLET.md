# AUDIT PARANO COMPLET — Sources de vérité stock

> **Date** : 2026-03-11  
> **Statut** : ✅ CORRIGÉ — 3 FIX appliqués (P0 backend + P1 mobile + P1 discrepancy)  
> **Scope** : Tous les fichiers frontend + backend qui lisent, calculent, comparent ou contrôlent le stock

## Corrections appliquées (2026-03-11)

| # | Composant | Fichier/Migration | Fix |
|---|-----------|------------------|-----|
| P0 | `fn_post_stock_document` | Migration SQL | Ajout CTE `active_snapshots` + JOIN `se.snapshot_version_id = asp.snapshot_version_id` dans le negative check |
| P1 | `MobileWithdrawalView` stock display | `MobileWithdrawalView.tsx` | Remplacé query ad-hoc par `checkStockAvailability` (SSOT) |
| P1 | Discrepancy detection Desktop | `WithdrawalView.tsx` | Remplacé queries ad-hoc par `checkStockAvailability` (SSOT) |
| P1 | Discrepancy detection Mobile | `MobileWithdrawalView.tsx` | Remplacé calcul inline par `checkStockAvailability` (SSOT) |

### Verdict post-fix

Après correction, **tous les lecteurs/contrôleurs de stock utilisent la même formule SSOT** :
- ✅ Backend `fn_post_stock_document` → filtre par `snapshot_version_id`
- ✅ `useEstimatedStock` → conforme
- ✅ `useProductCurrentStock` → conforme
- ✅ `useProductHasStock` → conforme
- ✅ `useCheckStockAvailability` → conforme
- ✅ `useStockAlerts` → conforme
- ✅ `StockEngine` → conforme
- ✅ `MobileWithdrawalView` stock display → via `checkStockAvailability`
- ✅ Discrepancy detection (Desktop + Mobile) → via `checkStockAvailability`

**Zéro lecture concurrente restante. Une seule vérité stock.**

---

## stock réel

**Oui — le vrai problème de fond est identifié :**

L'application n'a pas UNE source de vérité stock unique aujourd'hui. Elle en a **plusieurs versions concurrentes** :
- Une formule correcte côté UI (hooks conformes)
- Une formule différente dans la RPC backend critique (`fn_post_stock_document`)
- Des formules ad-hoc dans les vues mobiles retrait
- Des formules ad-hoc dans la détection d'écarts

C'est exactement pour ça qu'un même produit peut afficher "stock OK" sur un écran, puis déclencher "stock négatif" dans un popup.

---

## Section 1 — SSOT officielle du stock

### Formule officielle

```
Stock Estimé = Snapshot(zone, produit) + Σ(stock_events WHERE snapshot_version_id = current_snapshot_version_id AND storage_zone_id = product.storage_zone_id)
```

### Tables impliquées

| Table | Rôle |
|-------|------|
| `products_v2` | `storage_zone_id` = zone réelle du produit |
| `storage_zones` | Zones de stockage par établissement |
| `zone_stock_snapshots` | Snapshot actif par zone : `snapshot_version_id` = session d'inventaire de référence |
| `inventory_sessions` | Sessions d'inventaire (statut `termine`) |
| `inventory_lines` | Quantité comptée par produit dans une session (= baseline du snapshot) |
| `stock_events` | Événements de stock (RECEIPT, WITHDRAWAL, ADJUSTMENT, VOID) |

### Champs obligatoires dans le calcul

1. `products_v2.storage_zone_id` → détermine la zone du produit
2. `zone_stock_snapshots.snapshot_version_id` → lie au `session_id` de l'inventaire de référence
3. `inventory_lines.quantity` WHERE `session_id = snapshot_version_id` AND `product_id = X` → baseline
4. `stock_events.delta_quantity_canonical` WHERE `snapshot_version_id = current_snapshot` AND `storage_zone_id = product_zone` → deltas

### Filtres obligatoires

- ✅ Filtrer `stock_events` par `snapshot_version_id` = snapshot actif de la zone du produit
- ✅ Filtrer `stock_events` par `storage_zone_id` = zone réelle du produit
- ✅ Filtrer `inventory_lines` par `session_id` = `snapshot_version_id`
- ❌ NE JAMAIS sommer TOUS les stock_events historiques sans filtre snapshot

---

## Section 2 — Tous les lecteurs de stock

### Tableau exhaustif

| # | Composant / Hook / Fonction | Fichier | Rôle |
|---|---------------------------|---------|------|
| L1 | `stockEngine.getEstimatedStock()` | `src/modules/stockLedger/engine/stockEngine.ts` | Moteur pur SSOT — calcul stock |
| L2 | `useEstimatedStock` | `src/modules/inventaire/hooks/useEstimatedStock.ts` | Stock estimé batch par zone (Desktop) |
| L3 | `useProductCurrentStock` | `src/hooks/useProductCurrentStock.ts` | Stock unitaire par produit (modales) |
| L4 | `useProductHasStock` | `src/hooks/useProductHasStock.ts` | Vérifie si stock ≠ 0 (verrouillage unité) |
| L5 | `useCheckStockAvailability` | `src/modules/stockLedger/hooks/useCheckStockAvailability.ts` | Pré-check avant retrait (batch) |
| L6 | `useStockAlerts` | `src/modules/stockAlerts/hooks/useStockAlerts.ts` | Alertes stock bas/rupture |
| L7 | `useDesktopStock` | `src/modules/inventaire/hooks/useDesktopStock.ts` | Vue desktop inventaire (snapshot raw) |
| L8 | `MobileWithdrawalView` (query inline) | `src/modules/stockLedger/components/MobileWithdrawalView.tsx:197-260` | Stock estimé retrait mobile |
| L9 | `WithdrawalView` (discrepancy IIFE) | `src/modules/stockLedger/components/WithdrawalView.tsx:165-198` | Stock pour détection écarts desktop |
| L10 | `MobileWithdrawalView` (discrepancy) | `src/modules/stockLedger/components/MobileWithdrawalView.tsx:388-410` | Stock pour détection écarts mobile |
| L11 | `fn_post_stock_document` | `supabase/migrations/20260216230004:L462-527` | Check stock négatif backend (RPC) |
| L12 | `fn_get_b2b_supplier_stock` | `supabase/migrations/20260310190742` | Stock B2B partagé fournisseur |
| L13 | `inventoryHistoryVarianceEngine` | `src/modules/inventaireHistory/engine/inventoryHistoryVarianceEngine.ts` | Calcul écarts historiques |
| L14 | `discrepancyService.fetchInvestigation` | `src/modules/ecartsInventaire/services/discrepancyService.ts:68-161` | Investigation écart (lecture events) |
| L15 | `postGuards.checkNegativeStock` | `src/modules/stockLedger/engine/postGuards.ts:123-144` | Check négatif frontend (pur) |
| L16 | `PostConfirmDialog` | `src/modules/stockLedger/components/PostConfirmDialog.tsx` | Affiche message stock négatif |

---

## Section 3 — Conformité SSOT par lecteur

| # | Lecteur | Filtre snapshot_version_id ? | Filtre zone produit ? | Conforme SSOT ? | Détail |
|---|---------|:-:|:-:|:-:|--------|
| L1 | `stockEngine` | ✅ (param explicite) | ✅ (param explicite) | ✅ | Moteur pur, reçoit les données pré-filtrées |
| L2 | `useEstimatedStock` | ✅ `.eq("snapshot_version_id", ...)` | ✅ `.eq("storage_zone_id", zoneId)` | ✅ | Délègue au StockEngine |
| L3 | `useProductCurrentStock` | ✅ `.eq("snapshot_version_id", ...)` | ✅ `.eq("storage_zone_id", ...)` | ✅ | Conforme |
| L4 | `useProductHasStock` | ✅ `.eq("snapshot_version_id", ...)` | ✅ `.eq("storage_zone_id", ...)` | ✅ | Conforme |
| L5 | `useCheckStockAvailability` | ✅ `ev.snapshot_version_id !== snapId` → skip | ✅ `.in("storage_zone_id", zoneIds)` | ✅ | Conforme |
| L6 | `useStockAlerts` | ✅ `.in("snapshot_version_id", ...)` | ✅ `.in("storage_zone_id", ...)` | ✅ | Délègue au StockEngine |
| L7 | `useDesktopStock` | N/A (lit snapshot raw) | N/A | ✅ | Ne calcule pas le stock estimé, lit inventory_lines |
| **L8** | **MobileWithdrawalView (query)** | **❌ AUCUN FILTRE** | **❌ AUCUN FILTRE** | **❌ FAUX** | **Somme TOUS les stock_events sans filtre snapshot ni zone** |
| **L9** | **WithdrawalView (discrepancy)** | **❌ AUCUN FILTRE** | **❌ AUCUN FILTRE** | **❌ FAUX** | **Somme TOUS les stock_events de l'établissement pour le produit** |
| **L10** | **MobileWithdrawalView (discrepancy)** | ⚠️ Utilise `stockByProduct` (L8 = faux) | ❌ | **❌ FAUX** | **Hérite du calcul faux de L8** |
| **L11** | **fn_post_stock_document** | **⚠️ BUG: `se.snapshot_version_id = zs2.zss_id`** | ✅ zone produit | **❌ BUG P0** | **Compare snapshot_version_id (session UUID) avec zss.id (row UUID) — MAUVAISE JOINTURE** |
| L12 | `fn_get_b2b_supplier_stock` | ✅ `se.snapshot_version_id = zss_m.snapshot_version_id` | ✅ `se.storage_zone_id = pm.storage_zone_id` | ✅ | Conforme |
| L13 | `inventoryHistoryVarianceEngine` | ✅ `.in("snapshot_version_id", sessionIds)` | N/A (par zone) | ✅ | Conforme |
| L14 | `discrepancyService.fetchInvestigation` | N/A (historique) | N/A (lecture seule) | ⚠️ Partiel | Ne calcule pas le stock, lit les événements bruts |
| L15 | `postGuards.checkNegativeStock` | N/A (pur, reçoit des données) | N/A | ✅ | Fonction pure, dépend de l'appelant |
| L16 | `PostConfirmDialog` | N/A (affiche les données du backend) | N/A | ✅ | Affiche ce que le backend renvoie |

---

## Section 4 — Tous les messages UI liés au stock

| Message | Composant | Source de données | Peut être faux ? |
|---------|-----------|-------------------|:-:|
| "Stock négatif détecté" | `PostConfirmDialog` | Backend `fn_post_stock_document` → `NEGATIVE_STOCK` | **❌ OUI — BUG P0 (jointure zss.id au lieu de snapshot_version_id)** |
| "Stock insuffisant" (retrait mobile) | `MobileWithdrawalView` badge | Query inline L8 (FAUSSE) | **❌ OUI — pas de filtre snapshot** |
| Stock affiché dans modal quantité | `ReceptionQuantityModal` via `useProductCurrentStock` | L3 (conforme) | ✅ Non |
| "Produit en rupture" | `useStockAlerts` → badges alertes | L6 (conforme) | ✅ Non |
| "Stock bas" / "Warning" | `useStockAlerts` → alertes | L6 (conforme) | ✅ Non |
| "Aucun inventaire de référence" | `PostConfirmDialog` | Backend GUARD | ✅ Non |
| "Produit sans zone" | `PostConfirmDialog` | Backend GUARD | ✅ Non |
| "Écart détecté" | `useCreateDiscrepancy` → `inventory_discrepancies` | L9/L10 (FAUX) | **❌ OUI — données polluées** |
| Stock affiché dans fiche produit (Desktop) | `EstimatedStockCell` via `useEstimatedStock` | L2 (conforme) | ✅ Non |
| Stock affiché dans liste mobile | `MobileStockListView` via `useDesktopStock` + `useEstimatedStock` | L2+L7 (conforme) | ✅ Non |

---

## Section 5 — Popups / warnings / drawers

| Popup/Warning | Calcul | Local/Backend | Même formule FE/BE ? | Contradiction possible ? |
|---------------|--------|:----------:|:-:|:-:|
| `PostConfirmDialog` → "Stock négatif" | Backend RPC L11 | Backend | **❌ NON — BE a bug jointure** | **❌ OUI** |
| `PostConfirmDialog` → "Confirmer retrait ?" | Aucun calcul | N/A | N/A | Non |
| `ToleranceWarningDialog` | Tolérance réception | Local | N/A | Non |
| Zone warning (produits sans zone) | Check local | Local | N/A | Non |
| `BlRetraitPostPopup` | Aucun stock | N/A | N/A | Non |

---

## Section 6 — Divergences frontend vs backend

### DIVERGENCE 1 (P0 CRITIQUE) : `fn_post_stock_document` negative check

**Frontend** (`useProductCurrentStock`, `useEstimatedStock`, `useCheckStockAvailability`) :
```sql
stock_events WHERE snapshot_version_id = zss.snapshot_version_id
```
→ ✅ Filtre correct

**Backend** (`fn_post_stock_document` L490-496) :
```sql
FROM stock_events se
JOIN zone_snapshots zs2 ON zs2.storage_zone_id = se.storage_zone_id
WHERE se.snapshot_version_id = zs2.zss_id   -- ← BUG: zss_id = zone_stock_snapshots.id (PK UUID)
                                              --   mais se.snapshot_version_id = inventory_session.id
```

**Analyse** : `zss_id` est l'alias de `zone_stock_snapshots.id` (la clé primaire de la table). Or `stock_events.snapshot_version_id` contient l'`id` de la session d'inventaire (`inventory_sessions.id`), qui est la valeur de `zone_stock_snapshots.snapshot_version_id`.

**Conséquence** : Le JOIN ne matche quasiment JAMAIS (sauf coïncidence UUID), donc `ev_sum.total_delta` est toujours `NULL` → `COALESCE(NULL, 0) = 0`. Le stock calculé par le backend = snapshot_qty seul, sans les deltas d'événements.

**Impact concret** :
- Si un produit a été réceptionné après l'inventaire (delta positif) → le backend ne le voit pas → stock sous-estimé
- Si un produit a été retiré après l'inventaire (delta négatif) → le backend ne le voit pas → stock sur-estimé
- Résultat : faux positifs NEGATIVE_STOCK (popup intempestif) ET faux négatifs (retrait autorisé alors que stock réellement négatif)

### DIVERGENCE 2 (P1) : MobileWithdrawalView stock inline

**Formule utilisée** :
```typescript
// L232-245: AUCUN filtre snapshot_version_id ni storage_zone_id
.from("stock_events")
.select("product_id, delta_quantity_canonical, canonical_unit_id")
.eq("establishment_id", estId)
.in("product_id", batch)
```

**Impact** : Le stock affiché en badge sur la vue retrait mobile inclut TOUS les événements historiques de TOUTES les zones. Stock potentiellement faux (gonflé ou dégonflé selon l'historique).

### DIVERGENCE 3 (P1) : Détection d'écarts (Desktop + Mobile)

**WithdrawalView L189-194** :
```typescript
.from("stock_events")
.select("delta_quantity_canonical")
.eq("establishment_id", capturedEstId)
.eq("product_id", line.product_id)
// AUCUN filtre snapshot_version_id ni storage_zone_id
```

**Impact** : Des écarts fantômes sont créés dans `inventory_discrepancies` car le stock "avant" est calculé avec tous les événements historiques.

---

## Section 7 — Mobile vs Desktop

| Flux | Mobile | Desktop | Même source ? | Même logique ? |
|------|--------|---------|:-:|:-:|
| **Réception — stock affiché** | `useProductCurrentStock` (L3 ✅) | `useProductCurrentStock` (L3 ✅) | ✅ | ✅ |
| **Retrait — stock affiché** | **Query inline L8 ❌** | N/A (pas d'affichage inline) | ❌ | ❌ |
| **Retrait — validation backend** | `fn_post_stock_document` (L11 ❌ BUG) | `fn_post_stock_document` (L11 ❌ BUG) | ✅ (même bug) | ✅ (même bug) |
| **Retrait — discrepancy** | `stockByProduct` (L10 → L8 ❌) | Query ad-hoc (L9 ❌) | ❌ | ❌ (formules différentes, toutes deux fausses) |
| **Inventaire — stock** | `useDesktopStock` + `useEstimatedStock` | `useDesktopStock` + `useEstimatedStock` | ✅ | ✅ |
| **Alertes** | `useStockAlerts` (L6 ✅) | `useStockAlerts` (L6 ✅) | ✅ | ✅ |

---

## Section 8 — Modules indirects

| Module | Lit le stock ? | Source | Conforme ? |
|--------|:-:|--------|:-:|
| `useWithdrawalDraft` / `useReceiptDraft` | Non | N/A | N/A |
| `useCreateDiscrepancy` | Indirectement (reçoit `estimatedStockBefore` de L8/L9) | Paramètre appelant | **❌ Données polluées** |
| `useCheckStockAvailability` | Oui | L5 | ✅ |
| `useStockAlerts` | Oui | L6 via StockEngine | ✅ |
| `postGuards.ts` | Oui (pur, reçoit `currentEstimates`) | Dépend appelant | ✅ (pur) |
| `useTransferProductZone` | Oui (reçoit `estimatedQty`) | Paramètre appelant | ✅ si appelant conforme |
| BL correction (`BlAppCorrectionDialog`) | Non (delta = newQty - effectiveQty) | N/A | ✅ |
| B2B stock (`fn_get_b2b_supplier_stock`) | Oui | RPC SQL | ✅ |
| `inventoryHistoryVarianceEngine` | Oui | Filtre par `snapshot_version_id` | ✅ |
| `discrepancyService.fetchInvestigation` | Lecture historique | Pas de calcul stock | ⚠️ Partiel (acceptable) |

---

## Section 9 — Données historiques aggravantes

### 9.1 — Le bug `fn_post_stock_document` est-il aggravé par les données ?

**OUI.** Le bug de jointure `se.snapshot_version_id = zs2.zss_id` fait que :
- Si `zone_stock_snapshots.id` (UUID auto-généré) ne correspond jamais à `inventory_sessions.id` → les deltas sont TOUJOURS 0
- Le backend calcule donc : `stock = snapshot_qty + 0`
- Plus il y a d'événements post-inventaire, plus l'écart entre "stock réel" et "stock vu par le backend" grandit

### 9.2 — Anciens stock_events hors snapshot courant

Les événements d'anciens snapshots restent en base. Les lecteurs conformes (L2-L6) les ignorent correctement via le filtre `snapshot_version_id`. Les lecteurs non conformes (L8, L9, L10) les comptent tous → stock gonflé/dégonflé.

### 9.3 — Produits sans zone

Correctement gérés : le backend renvoie `PRODUCT_NO_ZONE`, l'UI l'affiche.

### 9.4 — Snapshots manquants

Correctement gérés : le backend renvoie `NO_ACTIVE_SNAPSHOT_FOR_PRODUCT_ZONE`.

### Les erreurs visibles viennent de :
- **Bug de formule** : jointure incorrecte dans `fn_post_stock_document` (P0)
- **Absence de filtre** : queries ad-hoc dans MobileWithdrawalView et discrepancy detection (P1)
- **Données historiques polluées** : les formules fausses sont aggravées par l'accumulation d'événements

---

## Section 10 — Matrice complète des sources de vérité stock

| Type de stock | Où utilisé | Source exacte | Conforme ? |
|---------------|-----------|---------------|:-:|
| Stock affiché produit (modal) | `ReceptionQuantityModal`, `UniversalQuantityModal` | `useProductCurrentStock` (L3) | ✅ |
| Stock estimé desktop | `EstimatedStockCell`, `DesktopStockView` | `useEstimatedStock` → StockEngine (L2) | ✅ |
| Stock estimé mobile | `MobileStockListView` | `useEstimatedStock` (L2) | ✅ |
| Stock retrait mobile (badges) | `MobileWithdrawalView` | **Query ad-hoc inline (L8)** | **❌** |
| Stock check backend avant POST | `fn_post_stock_document` | **RPC SQL (L11)** | **❌ BUG** |
| Stock popup "négatif" | `PostConfirmDialog` | Données de L11 | **❌** |
| Stock alertes (bas/rupture) | Dashboard alertes | `useStockAlerts` → StockEngine (L6) | ✅ |
| Stock inventaire | `useDesktopStock` | Snapshot raw (L7) | ✅ |
| Stock écarts (discrepancy) | `useCreateDiscrepancy` | Données de L8/L9 | **❌** |
| Stock B2B partagé | Commandes B2B | `fn_get_b2b_supplier_stock` (L12) | ✅ |
| Stock verrouillage unité | Wizard produit | `useProductHasStock` (L4) | ✅ |
| Stock pré-check retrait | `BlRetraitPostPopup` | `checkStockAvailability` (L5) | ✅ |
| Stock variance historique | `InventoryHistoryView` | `inventoryHistoryVarianceEngine` (L13) | ✅ |

---

## Section 11 — Liste des incohérences

### ❌ INCOHÉRENCE 1 — P0 CRITIQUE
**`fn_post_stock_document` : jointure sur `zss.id` au lieu de `zss.snapshot_version_id`**
- Fichier : `supabase/migrations/20260216230004:L494`
- Code fautif : `WHERE se.snapshot_version_id = zs2.zss_id`
- Correction : `WHERE se.snapshot_version_id = zs2.snapshot_version_id`
- Impact : TOUS les POST (réception + retrait + ajustement + correction) sont affectés
- Le stock négatif check utilise un stock = snapshot_qty + 0 (deltas ignorés)

### ❌ INCOHÉRENCE 2 — P1
**`MobileWithdrawalView` query inline : aucun filtre snapshot ni zone**
- Fichier : `src/modules/stockLedger/components/MobileWithdrawalView.tsx:232-245`
- Impact : stock affiché sur badges mobile retrait = somme historique totale

### ❌ INCOHÉRENCE 3 — P1
**`WithdrawalView` détection écarts : aucun filtre snapshot ni zone**
- Fichier : `src/modules/stockLedger/components/WithdrawalView.tsx:189-194`
- Impact : écarts fantômes créés dans `inventory_discrepancies`

### ❌ INCOHÉRENCE 4 — P1
**`MobileWithdrawalView` détection écarts : hérite de L8 (faux)**
- Fichier : `src/modules/stockLedger/components/MobileWithdrawalView.tsx:388-410`
- Impact : même que INCOHÉRENCE 2+3

---

## Section 12 — Verdict final

### Réponses aux questions obligatoires

**1. Quelle est la vraie formule officielle du stock ?**
```
Stock = snapshot_qty(product, zone) + Σ(stock_events WHERE snapshot_version_id = active_snapshot AND storage_zone_id = product_zone)
```

**2. Combien d'endroits utilisent cette formule correctement ?**
**10 sur 16** : L1, L2, L3, L4, L5, L6, L7, L12, L13, L15

**3. Combien d'endroits utilisent une autre formule ?**
**4 sur 16** : L8, L9, L10, L11

**4. Quels popups/messages peuvent être faux ?**
- "Stock négatif détecté" (PostConfirmDialog) — **FAUX** à cause du bug L11
- Stock badges retrait mobile — **FAUX** à cause de L8
- Écarts détectés (inventory_discrepancies) — **FAUX** à cause de L9/L10

**5. Le frontend et le backend ont-ils une seule vérité commune ?**
**NON.** Le frontend (hooks conformes) calcule correctement. Le backend (`fn_post_stock_document`) a une jointure cassée qui ignore les deltas d'événements.

**6. Quels modules lisent encore un stock non conforme ?**
- `MobileWithdrawalView` (query inline + discrepancy)
- `WithdrawalView` (discrepancy detection)
- `fn_post_stock_document` (negative stock check)

**7. Le bug P0 dans fn_post_stock_document est-il isolé ou révélateur ?**
**Révélateur d'un problème systémique.** Le code SQL n'a pas de tests d'intégration qui vérifient la VALEUR du stock calculé. Les tests existants vérifient la STRUCTURE (présence de JOIN, FOR UPDATE) mais pas l'EXACTITUDE de la jointure.

Les 3 formules ad-hoc dans le frontend (L8, L9, L10) montrent que le pattern SSOT n'est pas systématiquement appliqué — des développeurs ont recréé des calculs locaux sans passer par le StockEngine.

**8. Après cet audit, peut-on dire que le stock a une seule source de vérité ?**
**NON.** Il y a aujourd'hui **3 vérités concurrentes** :

| Vérité | Utilisée par | Correcte ? |
|--------|-------------|:-:|
| StockEngine (snapshot + events filtrés) | UI Desktop, alertes, modales, B2B, historique | ✅ |
| Query ad-hoc (snapshot + TOUS events) | Retrait mobile badges, discrepancy detection | ❌ |
| RPC backend (snapshot + events JOIN cassé) | `fn_post_stock_document` → validation POST | ❌ |

---

## Plan de correction recommandé

### FIX 1 — P0 CRITIQUE : `fn_post_stock_document`
**Migration SQL** : Corriger L494 de `se.snapshot_version_id = zs2.zss_id` → `se.snapshot_version_id = zs2.snapshot_version_id`

### FIX 2 — P1 : MobileWithdrawalView query inline
**Refactorer** la query L232-245 pour utiliser `useEstimatedStock` ou reproduire le pattern SSOT avec filtres `snapshot_version_id` + `storage_zone_id`

### FIX 3 — P1 : Discrepancy detection (Desktop + Mobile)
**Refactorer** les calculs ad-hoc dans WithdrawalView L165-198 et MobileWithdrawalView L388-410 pour utiliser `checkStockAvailability` (L5, déjà conforme) ou le StockEngine

### Priorité
1. FIX 1 (migration SQL) — résout le popup "stock négatif" erroné
2. FIX 2 + FIX 3 (frontend) — unifie toutes les lectures sur la SSOT

### Risque si non corrigé
- Faux blocages lors de la validation de retraits légitimes
- Faux écarts créés dans `inventory_discrepancies` (pollution de données)
- Perte de confiance utilisateur dans le système de stock
