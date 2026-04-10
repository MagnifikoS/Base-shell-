# AUDIT PROFOND V2 — Boucle continue jusqu'à zéro bug

> Date: 2026-03-26
> Méthode: lecture code SQL déployé + requêtes production + trace chaîne complète
> Objectif: trouver TOUS les bugs restants, même ceux non observés

---

## RÉSUMÉ EXÉCUTIF

### Nouveaux bugs trouvés dans cette passe

| # | Bug | Sévérité | Observé en prod ? |
|---|-----|----------|-------------------|
| NEW-01 | **shipped_quantity écrasée par supplier qty (step 5f)** — TOUJOURS ACTIF | 🔴 CRITIQUE | ✅ OUI (SERVIETTE TABLE: 800→1) |
| NEW-02 | **Absence de DISTINCT ON** dans fn_ship_commande ET fn_resolve_litige | 🔴 CRITIQUE | ✅ OUI (3 ruptures fantômes) |
| NEW-03 | **57 stocks négatifs** en production | 🔴 CRITIQUE | ✅ OUI |
| NEW-04 | **stock_document_lines divergent de stock_events** (clamp inline) | 🟠 HAUTE | ✅ OUI |
| NEW-05 | **fn_receive_commande n'utilise PAS fn_convert_b2b_quantity** | 🟠 HAUTE | Non testé |
| NEW-06 | **Facturation basée sur received_quantity en unité CLIENT** mais prix snapshot en unité variable | 🟠 HAUTE | Non testé |
| NEW-07 | **fn_resolve_litige: delta basé sur shipped_quantity corrompue** | 🔴 CRITIQUE | Potentiel |
| NEW-08 | **commande_plats: aucune validation de quantité côté serveur** | 🟡 MOYENNE | Non testé |
| NEW-09 | **2 doublons BIP toujours actifs** | 🔴 CRITIQUE | ✅ OUI |

---

## PARTIE 1 — CHAÎNE 1: COMMANDE → EXPÉDITION → STOCK FOURNISSEUR

### Flow exact (fn_ship_commande — migration 20260319201217)

```
Étape 0: Lock commande (FOR UPDATE)
Étape 1: Boucle p_lines → UPDATE commande_lines SET shipped_quantity, line_status
         ⚠️ shipped_quantity = LEAST(input, canonical_quantity) — en UNITÉ CLIENT
Étape 2: Vérifier toutes les lignes traitées
Étape 3: Validation shipped_quantity cohérente
Étape 4: UPDATE commandes SET status = 'expediee'
Étape 5: Stock ledger WITHDRAWAL
  5-prep: CREATE TEMP _ship_lines avec fn_convert_b2b_quantity()
          ⚠️ JOIN b2b_imported_products SANS DISTINCT ON
  5-err:  Lignes conversion error → rupture
  5a:     Bootstrap snapshot si manquant
  5b:     Valider snapshot
  5c:     Créer stock_document (POSTED directement, bypass fn_post_stock_document)
  5d:     INSERT stock_document_lines (supplier unit, supplier qty)
  5e:     INSERT stock_events avec CLAMP inline (supplier unit, supplier qty)
          ⚠️ stock_document_lines NON clampées mais stock_events clampées → DIVERGENCE
  5f:     SYNC loop: compare effective_qty (supplier) vs requested_qty (supplier)
          ⚠️ ÉCRASE shipped_quantity avec effective_qty EN UNITÉ FOURNISSEUR
```

### BUG NEW-01 CONFIRMÉ: shipped_quantity écrasée par supplier qty

**Preuve production** — CMD-000053, SERVIETTE TABLE:
- Client commande: 800 Pièces
- Fournisseur confirme: 800 Pièces
- Étape 1 écrit: `shipped_quantity = 800` (client ref ✅)
- fn_convert_b2b_quantity convertit: 800 Pièces → 1 Paquet fournisseur
- stock_event écrit: -1 Paquet ✅
- **Étape 5f**: `effective_qty = 1`, `requested_qty = 1` → pas de sync
- **MAIS** si le clamp avait réduit: `shipped_quantity = effective_qty` en Paquet ≠ Pièce

**Preuve BURRATA 125G** (CMD-000053):
- Client commande: 2 Cartons
- Stock event: -20 Boîtes (conversion correcte)
- `shipped_quantity` reste 2 → **CORRECT dans ce cas** car pas de clamp
- **MAIS**: si stock avait été insuffisant et clampé à 10 Boîtes,
  step 5f aurait écrit `shipped_quantity = 10` au lieu de `1 Carton`

**Impact**: Toute expédition avec clamp + conversion unitaire corrompra `shipped_quantity`.

### BUG NEW-02 CONFIRMÉ: Absence de DISTINCT ON

```sql
-- fn_ship_commande: _ship_lines
SELECT prosrc LIKE '%DISTINCT ON%' FROM pg_proc WHERE proname = 'fn_ship_commande';
-- Résultat: FALSE ❌

-- fn_resolve_litige: _litige_adj_lines
SELECT prosrc LIKE '%DISTINCT ON%' FROM pg_proc WHERE proname = 'fn_resolve_litige';
-- Résultat: FALSE ❌
```

**2 doublons BIP actifs** (confirmé):
```
local_product_id=01838836... → MASCARPONE GRANAROLO → 2 lignes
local_product_id=af01f4c0... → LAIT DEMI ECREME     → 2 lignes
```

**Impact**: Le JOIN produit 2 lignes par commande_line pour ces produits.
- Dans _ship_lines: 2 stock_events de retrait créés → double débit
- Dans la sync 5f: la 2ème itération peut écraser la 1ère

### BUG NEW-04: stock_document_lines vs stock_events divergence

```
stock_document_lines: INSERT -1 * supplier_quantity (PAS clampé)
stock_events:         INSERT GREATEST(-qty, -stock_disponible) (clampé)
```

Si le stock est insuffisant, le document dit "-10 kg" mais l'event dit "-3 kg".
La réconciliation entre ces deux tables est impossible.

---

## PARTIE 2 — CHAÎNE 2: EXPÉDITION → SYNC → COMMANDE_LINES

### Flow sync (step 5f)

```sql
FOR v_sync_rec IN
  SELECT sl.line_id, sl.supplier_quantity AS requested_qty,
         ABS(COALESCE(se_eff.effective_delta, 0)) AS effective_qty
  FROM _ship_lines sl
  LEFT JOIN stock_events se_eff ON se_eff.product_id = sl.supplier_product_id
    AND se_eff.document_id = v_doc_id
  WHERE sl.supplier_zone_id = v_zone_id
LOOP
  IF effective_qty = 0 THEN
    UPDATE commande_lines SET shipped_quantity = 0, line_status = 'rupture'    -- ⚠️
  ELSIF effective_qty < requested_qty THEN
    UPDATE commande_lines SET shipped_quantity = effective_qty, line_status = 'modifie'  -- ⚠️
  END IF;
END LOOP;
```

**Problème critique**: `effective_qty` est en **unité fournisseur** (ex: Boîte), mais
`shipped_quantity` dans `commande_lines` est censée être en **unité client** (ex: Carton).
Aucune back-conversion n'est effectuée.

### Impact cascade sur fn_receive_commande

Le client voit `shipped_quantity = 1` (fournisseur Paquet) au lieu de `800` (client Pièces).
Quand le client reçoit 800 pièces et compare à `shipped_quantity = 1`:
- `received_quantity (800) != shipped_quantity (1)` → litige créé
- Delta litige = `1 - 800 = -799` → surplus massif fictif
- fn_resolve_litige tente de retirer 799 du stock fournisseur

---

## PARTIE 3 — CHAÎNE 3: RÉCEPTION CLIENT

### Flow exact (fn_receive_commande — migration 20260305153303)

```
1. Lock commande (status = 'expediee')
2. Valider que toutes les lignes sont fournies
3. Vérifier que received_quantity >= 0
4. Vérifier storage_zone_id sur produits client
5. UPDATE commande_lines SET received_quantity
6. Comparer received_quantity vs shipped_quantity → litige si écart
7. Créer stock_events client (RECEIPT) via fn_post_stock_document
```

### BUG NEW-05: Pas de conversion B2B à la réception

```sql
-- _recv_lines utilise DIRECTEMENT cl.canonical_unit_id (unité CLIENT)
CREATE TEMP TABLE _recv_lines AS
SELECT cl.product_id as client_product_id,
  COALESCE(cl.received_quantity, 0) as received_qty,
  cl.canonical_unit_id,       -- ← UNITÉ CLIENT
  cp.storage_zone_id ...
```

C'est **correct** pour le stock client (on écrit en unité client sur le stock client).

**MAIS**: Si `shipped_quantity` a été corrompue par le bug NEW-01 (écrite en unité fournisseur),
la comparaison `received_quantity != shipped_quantity` dans le détecteur d'écarts est **invalide**:
on compare des Pièces (reçues) avec des Paquets (shipped corrompu).

---

## PARTIE 4 — CHAÎNE 4: LITIGE → RÉSOLUTION

### Flow exact (fn_resolve_litige — migration 20260321061136)

```
1. Lock litige + commande
2. BUILD _litige_adj_lines:
   delta = ll.shipped_quantity - ll.received_quantity
   ⚠️ Ces valeurs viennent de litige_lines (snapshots au moment de la réception)
   ⚠️ Si shipped_quantity était corrompue → delta invalide
3. fn_convert_b2b_quantity(ABS(delta)) → supplier qty
4. Créer stock_document + stock_document_lines
5. fn_post_stock_document (clamp universel V2)
6. UPDATE litiges SET status = 'resolved'
7. UPDATE commandes SET status = 'recue'
```

### BUG NEW-07: Delta basé sur données potentiellement corrompues

`litige_lines.shipped_quantity` est copié depuis `commande_lines.shipped_quantity` au moment
de la réception. Si ce champ a été corrompu par step 5f (bug NEW-01):

```
shipped_quantity = 1 (supplier Paquet, devrait être 800 client Pièces)
received_quantity = 800 (correct, client Pièces)
delta = 1 - 800 = -799 (surplus fictif de 799)
fn_convert_b2b_quantity(799) → converti en supplier qty
→ Ajustement stock fournisseur de -799 paquets
```

**Impact**: Destruction massive du stock fournisseur sur un litige fictif.

### Pas de DISTINCT ON (BUG NEW-02 bis)

Le JOIN sur `b2b_imported_products` dans `_litige_adj_lines` n'a pas de DISTINCT ON.
Avec les 2 doublons actifs, cela peut doubler les ajustements.

---

## PARTIE 5 — CHAÎNE 5: INVENTAIRE → SNAPSHOT → STOCK

Le stock est calculé comme: `Snapshot + Σ(events WHERE snapshot_version_id = actif)`

- Les events corrompus (mauvaise unité, doubles) polluent le ledger
- Le snapshot ne "répare" pas les erreurs: il les rebase
- Un inventaire après corruption fige la corruption comme "vérité"

---

## PARTIE 6 — CHAÎNE 6: COMMANDE → RÉCEPTION → FACTURATION

### Flow exact (fn_generate_app_invoice — migration 20260309213912)

```sql
-- Total HT basé sur received_quantity * unit_price_snapshot
SELECT COALESCE(SUM(
  ROUND(COALESCE(cl.received_quantity, 0) * cl.unit_price_snapshot, 2)
), 0) INTO v_total_ht
FROM commande_lines cl
WHERE cl.commande_id = p_commande_id
  AND COALESCE(cl.received_quantity, 0) > 0;
```

### BUG NEW-06: Incohérence prix × quantité

`unit_price_snapshot` est calculé dans fn_send_commande avec conversion BFS:
```sql
unit_price_snapshot = product.final_unit_price * fn_product_unit_price_factor(from, to)
```

Le prix est converti vers `canonical_unit_id` (unité de la ligne commande = unité client).
La quantité `received_quantity` est aussi en unité client.
→ **Le calcul prix × qty est cohérent SI received_quantity est correct.**

**Risque**: Si received_quantity = 0 à cause d'un bug, la facture omet la ligne.
Les lignes `rupture` (shipped_qty = 0) ont `received_quantity = 0` → exclues de la facture.
Les ruptures fantômes (stock débité mais rupture affichée) causent une perte de revenu.

---

## PARTIE 7 — COMMANDES PLATS (Système parallèle)

### Audit fn_ship_commande_plat (migration 20260309103238)

```sql
FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(line_id uuid, shipped_quantity int, line_status text)
LOOP
  UPDATE commande_plat_lines
  SET shipped_quantity = v_line.shipped_quantity,
      line_status = v_line.line_status
  WHERE id = v_line.line_id AND commande_plat_id = p_commande_plat_id;
END LOOP;
```

### BUG NEW-08: Aucune validation serveur

- `shipped_quantity` est castée en `int` → pas de décimales, mais aucun clamp au maximum
- `line_status` accepte n'importe quelle string du client
- Aucune vérification que `shipped_quantity <= quantity` (ordered)
- Pas de stock impliqué → impact limité mais manque de rigueur

**Note positive**: Le système commande_plats est **correctement isolé** du stock.
Pas de stock_events, pas de conversion B2B, pas de ledger. Juste du suivi.

---

## PARTIE 8 — SCÉNARIOS EXTRÊMES

### Scénario 1: Expédition > stock disponible
- Le clamp inline ramène à 0 ou au stock disponible ✅
- **MAIS** step 5f écrit la qty clampée en unité fournisseur dans shipped_quantity ❌

### Scénario 2: Conversion complexe (Carton → Boîte → Pièce)
- fn_convert_b2b_quantity gère via BFS (V4.2 avec DIVISION) ✅
- **MAIS** si le BFS retourne un factor de 0, la division échoue silencieusement (guard v_factor != 0)
- Si le factor retourné est très petit (0.001), la qty arrondie peut perdre de la précision

### Scénario 3: Rupture fantôme + réception + litige
- Fournisseur expédie → stock débité → doublon BIP → 2ème itération écrase avec rupture
- Client reçoit le produit → received_qty = X, shipped_qty = 0
- Litige créé: delta = 0 - X = -X (surplus)
- fn_resolve_litige retire X du stock fournisseur (2ème débit !)
- **Impact**: Triple perte: stock fournisseur débité 2 fois + facture exclut la ligne

### Scénario 4: Double mapping B2B
- Confirmé en prod: MASCARPONE et LAIT DEMI ECREME
- Produit cartésien dans _ship_lines → double stock_event
- 2ème itération sync peut écraser la 1ère

### Scénario 5: Snapshot manquant
- fn_ship_commande bootstrap un snapshot automatiquement ✅
- Mais le bootstrap crée une inventory_session "fantôme" (0 produits comptés)
- L'inventaire apparaît comme terminé alors qu'il n'a jamais eu lieu

### Scénario 6: Litige sur produit déjà corrompu
- shipped_quantity corrompue (supplier unit) → delta litige invalide
- fn_resolve_litige applique fn_convert_b2b_quantity sur le delta invalide
- Résultat: ajustement stock doublement incorrect (mauvais delta + conversion)

---

## PARTIE 9 — DONNÉES PRODUCTION ACTUELLES

### Stocks négatifs
```sql
-- 57 produits avec stock négatif en production
SELECT count(*) FROM (
  SELECT establishment_id, product_id, SUM(delta_quantity_canonical) as total
  FROM stock_events GROUP BY establishment_id, product_id
  HAVING SUM(delta_quantity_canonical) < -0.001
) sub;
-- Résultat: 57
```

### Ruptures fantômes confirmées
```
MASCARPONE GRANAROLO  | CMD-000053 | rupture | shipped=0 | stock_delta=-18
LAIT DEMI ECREME      | CMD-000049 | rupture | shipped=0 | stock_delta=-1
MASCARPONE GRANAROLO  | CMD-000045 | rupture | shipped=0 | stock_delta=-6
```
→ Tous sur des produits avec doublons BIP

### Doublons BIP toujours actifs
```
MASCARPONE GRANAROLO  → 2 mappings
LAIT DEMI ECREME      → 2 mappings
```

### Corruption shipped_quantity
```
SERVIETTE TABLE | ordered=800 Pièce | shipped=1.0000 | status=modifie
```
→ 1 Paquet fournisseur écrit en lieu et place de Pièces client

---

## PARTIE 10 — CONTRAT DE VÉRITÉ

| Donnée | Source unique ? | Problème |
|--------|:-:|---|
| shipped_quantity | ❌ NON | Écrite étape 1 (correct), puis écrasée étape 5f (incorrect) |
| received_quantity | ✅ OUI | Écrite une seule fois par fn_receive_commande |
| stock fournisseur | ❌ NON | stock_events (clampé) ≠ stock_document_lines (non clampé) |
| stock client | ✅ OUI | Via fn_post_stock_document (centralisé) |
| line_status | ❌ NON | Écrit étape 1, peut être écrasé étape 5f sync |
| quantité facturée | ✅ OUI | = received_quantity (mais dépend de shipped_quantity pour litige) |
| prix unitaire facturé | ✅ OUI | = unit_price_snapshot figé à l'envoi |

---

## PARTIE 11 — INVARIANTS CIBLES (RAPPEL)

1. **UNE seule écriture** de shipped_quantity (pas d'écrasement)
2. **UN seul référentiel** par champ (shipped_quantity = toujours unité client)
3. **DISTINCT ON** sur tout JOIN b2b_imported_products
4. **stock_document_lines = stock_events** (pas de divergence clamp)
5. **Contrainte UNIQUE** sur b2b_imported_products(local_product_id, establishment_id, source_establishment_id)
6. **fn_post_stock_document centralisé** pour TOUT mouvement de stock
7. **Pas de stock négatif** (clamp universel respecté partout)

---

## PARTIE 12 — REQUÊTES SQL DE DIAGNOSTIC

### Détection ruptures fantômes
```sql
SELECT cl.id, cl.product_name_snapshot, cl.line_status, cl.shipped_quantity,
       c.order_number, se.delta_quantity_canonical
FROM commande_lines cl
JOIN commandes c ON c.id = cl.commande_id
LEFT JOIN stock_documents sd ON sd.source_order_id = c.id
LEFT JOIN stock_events se ON se.document_id = sd.id
  AND se.product_id IN (
    SELECT bip.source_product_id FROM b2b_imported_products bip
    WHERE bip.local_product_id = cl.product_id AND bip.establishment_id = c.client_establishment_id)
WHERE cl.line_status = 'rupture' AND cl.shipped_quantity = 0
  AND se.delta_quantity_canonical IS NOT NULL AND se.delta_quantity_canonical < 0;
```

### Détection corruption shipped_quantity (unité mismatch)
```sql
SELECT cl.product_name_snapshot, cl.canonical_quantity, cl.shipped_quantity,
       mu_cl.name as client_unit, ABS(se.delta_quantity_canonical) as supplier_deducted,
       mu_se.name as supplier_unit, c.order_number
FROM commande_lines cl
JOIN commandes c ON c.id = cl.commande_id
LEFT JOIN measurement_units mu_cl ON mu_cl.id = cl.canonical_unit_id
LEFT JOIN stock_documents sd ON sd.source_order_id = c.id
LEFT JOIN stock_events se ON se.document_id = sd.id
  AND se.product_id IN (
    SELECT bip.source_product_id FROM b2b_imported_products bip
    WHERE bip.local_product_id = cl.product_id AND bip.establishment_id = c.client_establishment_id)
LEFT JOIN measurement_units mu_se ON mu_se.id = se.canonical_unit_id
WHERE mu_cl.name != mu_se.name AND cl.shipped_quantity != cl.canonical_quantity;
```

### Détection doublons BIP
```sql
SELECT local_product_id, establishment_id, source_establishment_id, count(*)
FROM b2b_imported_products
GROUP BY local_product_id, establishment_id, source_establishment_id
HAVING count(*) > 1;
```

### Comptage stocks négatifs
```sql
SELECT se.establishment_id, se.product_id, p.nom_produit,
       SUM(se.delta_quantity_canonical) as stock_total
FROM stock_events se
JOIN products_v2 p ON p.id = se.product_id
GROUP BY se.establishment_id, se.product_id, p.nom_produit
HAVING SUM(se.delta_quantity_canonical) < -0.001;
```

---

## ÉTAT DE L'AUDIT

### 🔴 INCOMPLET — Nouveaux bugs critiques trouvés

**Bugs CONFIRMÉS en production:**
1. ❌ shipped_quantity corrompue (SERVIETTE TABLE: 800→1)
2. ❌ 3 ruptures fantômes actives (MASCARPONE, LAIT DEMI ECREME)
3. ❌ 2 doublons BIP toujours actifs
4. ❌ 57 stocks négatifs en production
5. ❌ Absence de DISTINCT ON dans fn_ship_commande ET fn_resolve_litige

**Bugs potentiels à investiguer:**
1. ⚠️ Cascade litige sur shipped_quantity corrompue → ajustement stock destructeur
2. ⚠️ Bootstrap snapshot crée des sessions fantômes
3. ⚠️ stock_document_lines ≠ stock_events (divergence clamp)

**Zones NON encore auditées:**
1. ❓ fn_post_b2b_reception (ancienne version?) vs fn_receive_commande
2. ❓ Frontend: quelles données le modal BFS envoie-t-il réellement ?
3. ❓ Impact des 57 stocks négatifs sur les futurs clamps
4. ❓ Void documents: fn_void_stock_document gère-t-il les corrections ?

---

### Prochain cycle d'audit requis:
1. Lire fn_post_stock_document (version déployée) pour comprendre le clamp central
2. Tracer l'impact exact des 57 stocks négatifs
3. Auditer le frontend (commandeShipService.ts) pour voir ce qui est envoyé à fn_ship_commande
4. Vérifier si fn_void_stock_document peut corriger les corruptions existantes
