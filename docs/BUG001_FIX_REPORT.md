# BUG-001 — Rapport de correction

## 1. Diagnostic confirmé

**Cause racine :** `fn_send_commande` utilisait `COALESCE(fn_product_unit_price_factor(...), 1.0)` pour calculer le snapshot de prix. Bien qu'un hard block ait été ajouté en amont, celui-ci comportait deux failles :

1. **Comparaison NULL-unsafe :** `cl.canonical_unit_id != p.final_unit_id` — si `final_unit_id` est NULL, l'expression renvoie NULL (pas TRUE), excluant silencieusement la ligne du contrôle.
2. **Appel direct au moteur BFS :** Le hard block appelait directement `fn_product_unit_price_factor` puis le snapshot utilisait un `COALESCE(..., 1.0)` — deux chemins parallèles au lieu d'un seul wrapper sûr.

**Conséquence :** Le prix source (`final_unit_price`, exprimé en unité finale ex: pce) était copié tel quel comme snapshot dans l'unité de la ligne (ex: carton), sans multiplication par le facteur de conversion.

**Exemple réel :** TEST 1 — prix 1.36€/pce, 1 carton = 20 pce → snapshot attendu = 27.20€/car, observé = 1.36€/car.

**Confiance dans le diagnostic : 100%** — vérifié sur 7 lignes historiques avec un manque à facturer de **532.30€**.

## 2. Ce qui a été modifié

### Fonction SQL : `fn_send_commande`

**Avant (V3) :**
```sql
-- Hard block avec != (NULL-unsafe)
WHERE cl.canonical_unit_id != p.final_unit_id
  AND fn_product_unit_price_factor(...) IS NULL;

-- Snapshot avec COALESCE fallback
SET unit_price_snapshot = ROUND(
  p.final_unit_price * COALESCE(fn_product_unit_price_factor(...), 1.0), 4)
```

**Après (V4) :**
```sql
-- Hard block 1 : prix NULL ou ≤ 0 bloqué
WHERE p.final_unit_price IS NULL OR p.final_unit_price <= 0;

-- Hard block 2 : via fn_convert_line_unit_price (wrapper SSOT, NULL-safe)
WHERE (fn_convert_line_unit_price(...))->>'ok' = 'false';

-- Snapshot via le MÊME wrapper (zéro fallback)
SET unit_price_snapshot = (fn_convert_line_unit_price(...))->>'converted_price'
```

### Changements clés :
- **Remplacement de `!=` par le wrapper `fn_convert_line_unit_price`** qui gère nativement les NULL (`missing_input` error)
- **Suppression totale de `COALESCE(..., 1.0)`** — plus aucun fallback silencieux
- **Ajout du hard block prix ≤ 0** — les produits à 0€ (ex: HUILE AMPHORE) sont maintenant bloqués
- **Un seul moteur de conversion utilisé** : `fn_convert_line_unit_price` qui appelle `fn_product_unit_price_factor` en interne

## 3. Ce qui n'a PAS été modifié

- ❌ `fn_product_unit_price_factor` — moteur BFS inchangé (il fonctionne correctement)
- ❌ `fn_convert_line_unit_price` — wrapper inchangé (il fonctionne correctement)
- ❌ Conversion stock / quantité — non concernée
- ❌ Ledger `stock_events` — non concerné
- ❌ `fn_generate_app_invoice` — non modifiée (elle lit les snapshots)
- ❌ `trg_commande_lines_immutable_price` — trigger d'immutabilité inchangé
- ❌ Aucune autre fonction SQL modifiée

## 4. Preuve que la correction est chirurgicale

- **Zéro logique parallèle créée** — réutilisation exclusive de `fn_convert_line_unit_price` (SSOT)
- **Un seul moteur de conversion** — le BFS existant via `fn_product_unit_price_factor`
- **Une seule fonction modifiée** — `fn_send_commande`
- **Zéro nouveau fichier** — correction purement SQL

## 5. Résultats de revalidation

| Cas | Produit | From → To | Facteur | Prix attendu | Prix obtenu | Verdict |
|-----|---------|-----------|---------|-------------|-------------|---------|
| 1 - Simple | CAS-A | pce → pce | 1.0 | 0.50 | 0.50 | ✅ OK |
| 2 - Conditionné simple | TEST 2 | kg → sac | 4.0 | 40.00 | 40.00 | ✅ OK |
| 3 - Multi-niveaux | TEST 1 | pce → car | 20.0 | 27.20 | 27.20 | ✅ OK |
| 4 - Facteur < 1 | CITRON JAUNE | pce → kg | 0.10 | 0.022 | 0.022 | ✅ OK |
| 5a - NULL unit | TEST 1 | pce → NULL | — | BLOQUÉ | `missing_input` | ✅ OK |
| 5b - No path | TEST 1 | pce → ??? | — | BLOQUÉ | `no_conversion_path` | ✅ OK |
| 6 - Healthy | TEST 3 | pce → pack | ✓ | Correct | Correct | ✅ OK |

**6/6 cas validés.**

## 6. Risques restants

### Données historiques
- **7 lignes de commande** ont un `unit_price_snapshot` incorrect (1.36 au lieu de 27.20 pour TEST 1)
- **Manque à facturer total : 532.30€**
- Le trigger `trg_commande_lines_immutable_price` **empêche la correction directe** de ces snapshots
- **Un script de correction séparé sera nécessaire** pour :
  1. Désactiver temporairement le trigger
  2. Recalculer les snapshots via `fn_convert_line_unit_price`
  3. Réactiver le trigger
  4. Regénérer les factures concernées
- ⚠️ Ce correctif historique **n'a pas été fait** — à traiter séparément sur demande

### Factures historiques
- Les factures générées à partir des mauvais snapshots sont également fausses
- Elles devront être annulées et regénérées après correction des snapshots

### Commandes en cours
- La correction **ne touche que les nouvelles commandes** envoyées après le déploiement
- Les commandes déjà en statut `envoyee`, `recue`, `litige`, `cloturee` conservent leurs snapshots historiques

## 7. Conclusion

| Critère | Statut |
|---------|--------|
| Bug corrigé | ✅ Oui — pour toutes les nouvelles commandes |
| Régression | ✅ Aucune — les produits simples et sains ne sont pas impactés |
| Moteur unique | ✅ Oui — `fn_convert_line_unit_price` exclusivement |
| Fallback silencieux | ✅ Supprimé — plus de `COALESCE(..., 1.0)` |
| Hard block complet | ✅ Oui — couvre NULL, ≤0, missing path |
| MVP re-testable | ✅ Oui — le pricing B2B est fiable pour les nouvelles commandes |
| Données historiques | ⚠️ À corriger séparément |
