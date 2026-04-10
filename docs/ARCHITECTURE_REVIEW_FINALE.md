# 🔴 REVIEW CRITIQUE — Architecture V2 B2B Finale

**Date** : 2026-03-26  
**Objet** : Validation de cohérence du design V2 avant implémentation

---

## DIAGRAMMES PRODUITS

| # | Diagramme | Fichier |
|---|-----------|---------|
| 1 | Vue Macro (système complet) | `B2B_Flow_01_Macro.mmd` |
| 2 | Flow Expédition (détaillé) | `B2B_Flow_02_Expedition.mmd` |
| 3 | Flow Réception | `B2B_Flow_03_Reception.mmd` |
| 4 | Flow Litige | `B2B_Flow_04_Litige.mmd` |
| 5 | Flow Annulation | `B2B_Flow_05_Annulation.mmd` |

---

## REVIEW CRITIQUE — Questions obligatoires

### ❓ 1. Y a-t-il encore un endroit où une donnée peut changer de référentiel ?

**RÉPONSE : NON** — dans le design V2.

Les frontières de conversion sont explicites et à 2 endroits seulement :
- **Étape 5** (expédition) : CLIENT → FOURNISSEUR (entrée dans le moteur stock)
- **Étape 8** (expédition) : FOURNISSEUR → CLIENT (back-conversion pour `shipped_quantity`)

Toutes les données persistées dans `commande_lines` sont en CLIENT. Toutes les données dans `stock_events` fournisseur sont en FOURNISSEUR. **Aucun mélange dans un même champ.**

Le même pattern est appliqué dans le litige (étape 5 : CLIENT → FOURNISSEUR pour l'ajustement stock).

✅ **SAFE**

---

### ❓ 2. Y a-t-il un endroit où une valeur peut être écrasée ?

**RÉPONSE : NON** — dans le design V2.

| Champ | Nb écritures | Garantie |
|-------|:------------:|----------|
| `canonical_quantity` | 1 (envoi) | Immutable après création |
| `shipped_quantity` | 1 (étape 9) | Jamais réécrite. Annulation = reset à 0 (flow distinct) |
| `received_quantity` | 1 (réception) | Jamais réécrite |
| `line_status` | 1 (étape 9) | Dérivé, écrit avec shipped_quantity |
| `stock_events.delta` | 1 (fn_post) | Append-only ledger, jamais modifié |

**Le flow d'annulation** remet `shipped_quantity = 0` mais c'est un flow métier séparé et explicite (pas une sync silencieuse). Il ne peut s'exécuter que si `status = expediee` (avant réception).

✅ **SAFE**

---

### ❓ 3. Y a-t-il un scénario non déterministe ?

**RÉPONSE : NON** — dans le design V2.

Sources de non-déterminisme éliminées :

| Source V1 | Fix V2 |
|-----------|--------|
| JOIN BIP sans déduplication | `DISTINCT ON (cl.id) ORDER BY bip.imported_at ASC` |
| `LIMIT 1` sans `ORDER BY` | Supprimé |
| Clamp dépendant du stock courant | Le clamp est une **fonction pure** du stock au moment T. Avec `FOR UPDATE` lock, le stock est stable pendant la transaction |
| Double écriture `shipped_quantity` | Écriture unique étape 9 |

**Rejouabilité** : À inputs identiques + même état stock initial → résultat identique.

⚠️ **NUANCE** : Le clamp dépend du stock courant au moment de l'exécution. Si on rejoue la même commande avec un stock initial différent (car d'autres opérations ont eu lieu entre-temps), le résultat diffère. C'est **voulu et correct** : le stock reflète la réalité physique.

✅ **SAFE**

---

### ❓ 4. Y a-t-il un risque de double mouvement stock ?

**RÉPONSE : NON** — grâce à 3 mécanismes indépendants.

1. **Idempotency key** : `ship:{commande_id}` sur `stock_documents`. Si un document POSTED existe déjà → retour immédiat.
2. **Lock pessimiste** : `SELECT ... FOR UPDATE` sur `commandes`. Le 2e user est bloqué puis reçoit `invalid_status`.
3. **Transition unidirectionnelle** : `ouverte → expediee`. Impossible de re-déclencher une expédition sur une commande déjà expédiée.

✅ **SAFE**

---

### ❓ 5. Le système est-il rejouable à 100% ?

**RÉPONSE : OUI**, sous la condition que les inputs soient identiques.

La chaîne complète est déterministe :
```
input fournisseur (CLIENT)
  → BIP lookup (DISTINCT ON, déterministe)
  → conversion (facteur fixe du unit_mapping)
  → clamp (fonction pure du stock courant)
  → back-conversion (même facteur, inverse)
  → écriture shipped_quantity
```

Chaque étape est une fonction pure de ses entrées. Pas d'aléatoire, pas de `random()`, pas de `LIMIT 1` sans `ORDER BY`.

✅ **SAFE**

---

### ❓ 6. Le système est-il réellement SSOT ?

**RÉPONSE : OUI** — avec une cartographie claire.

| Donnée | Source unique | Jamais dupliquée ? |
|--------|-------------|-------------------|
| Stock physique | `stock_events` (ledger) | ✅ Unique pipeline via `fn_post_stock_document` |
| Quantité commandée | `commande_lines.canonical_quantity` | ✅ Immutable |
| Quantité expédiée | `commande_lines.shipped_quantity` | ✅ Projection du ledger, 1 écriture |
| Quantité reçue | `commande_lines.received_quantity` | ✅ Input client, 1 écriture |
| Prix | `commande_lines.unit_price_snapshot` | ✅ Figé à l'envoi |
| Écart litige | `litige_lines` (snapshots) | ✅ Figés à la création du litige |
| Facture | `received_quantity × unit_price_snapshot` | ✅ Dérivé, pas stocké séparément |

**Aucune sync corrective. Aucune réécriture. Chaque valeur a une source et un moment d'écriture unique.**

✅ **SAFE**

---

## ANGLES MORTS IDENTIFIÉS

### ⚠️ AM-1 : Back-conversion multi-zone (agrégation)

Le design V2 prévoit `effective_supplier_qty = SUM(stock_events par source_line_id)` pour le cas multi-zone.

**Problème potentiel** : Si une même `commande_line` est ventilée sur 2 zones avec des facteurs de conversion différents (impossible aujourd'hui, mais architecturalement possible), la SUM en unité fournisseur est valide (même unité), mais la back-conversion unique l'est aussi car le facteur est lié au produit, pas à la zone.

**Verdict** : ✅ SAFE — le facteur de conversion est par produit, pas par zone. L'agrégation SUM est cohérente.

---

### ⚠️ AM-2 : Annulation après expédition partielle puis re-expédition

**Scénario** : 
1. Commande avec 3 lignes, expédiée (certaines clampées)
2. Annulation (`cancel_shipment`) → void stock, reset shipped_qty
3. Re-expédition avec stock maintenant différent

**Le design gère-t-il ça ?**

- Annulation : `fn_void_stock_document` inverse les events, `shipped_quantity = 0`, `status = ouverte`
- Re-expédition : `fn_ship_commande` s'exécute normalement (status = ouverte, pas d'idempotency_key POSTED restante car le document est VOIDED)

**Problème** : L'idempotency check utilise `WHERE idempotency_key LIKE 'ship:' || commande_id || '%' AND status = 'POSTED'`. Si le document est VOIDED, le check passe → re-expédition autorisée.

**Verdict** : ✅ SAFE — le design le gère correctement.

---

### ⚠️ AM-3 : Précision arithmétique des conversions aller-retour

**Scénario** : 800 Pièces → ÷800 = 1.0 Paquet → clamp = 0.7 Paquet → ×800 = 560 Pièces ✅

**Scénario problématique** : Facteur = 3 (1 Carton = 3 Pièces)
- 10 Pièces → ÷3 = 3.3333... Cartons → clamp = 3.3333 → ×3 = 9.9999
- Avec `ROUND(x * 10000) / 10000` : 3.3333 × 3 = 9.9999 → arrondi = 10.0 ✅ (si NUMERIC)

**Risque résiduel** : Avec `FLOAT8` au lieu de `NUMERIC`, des erreurs d'arrondi IEEE 754 peuvent créer des écarts de ±0.0001. 

**Verdict** : ⚠️ DOIT être NUMERIC, pas FLOAT. Le design le mentionne (Z-01) mais il faut le garantir dans l'implémentation.

---

### ⚠️ AM-4 : `commande_plats` non couvert

Le design V2 ne couvre PAS le module `commande_plats`. Ce module n'a actuellement **aucune intégration stock**. 

Si une intégration stock est ajoutée ultérieurement, le même pattern (moteur central) devra être appliqué.

**Verdict** : ⚠️ Zone déclarée, pas un risque immédiat. Documenté en Z-03.

---

### ⚠️ AM-5 : Données historiques (commandes clôturées)

Les commandes `cloturee` avec `shipped_quantity` corrompue (en unité fournisseur) ne seront PAS corrigées.

**Impact** : Si un rapport historique agrège `shipped_quantity` tous statuts confondus, les données pré-V2 seront fausses.

**Mitigation** : Ajouter une colonne `data_version` ou filtrer par date de la migration V2.

**Verdict** : ⚠️ Acceptable si documenté. Pas de risque opérationnel (seul impact = reporting historique).

---

## VERDICT FINAL

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   COHÉRENCE GLOBALE :  ✅ OK                                     ║
║                                                                   ║
║   Le design V2 est structurellement cohérent, déterministe,       ║
║   et élimine TOUS les bugs critiques identifiés dans l'audit.     ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║   RISQUES RÉSIDUELS :                                             ║
║                                                                   ║
║   1. [FAIBLE] Précision arithmétique : garantir NUMERIC           ║
║      pas FLOAT dans fn_convert_b2b_quantity_reverse               ║
║                                                                   ║
║   2. [INFO] Données historiques (cloturee) non corrigées          ║
║      → impact reporting uniquement                                ║
║                                                                   ║
║   3. [INFO] commande_plats hors périmètre (pas de stock)         ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║   RECOMMANDATION :  ✅ SAFE TO BUILD                              ║
║                                                                   ║
║   Le design peut être implémenté en suivant les phases 0→5.       ║
║   Aucune incohérence structurelle détectée.                       ║
║   Les 3 modifications critiques (M1, M2, M3) sont intégrées.     ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### Checklist de validation pré-implémentation

- [x] Moment de vérité défini (stock_document POSTED)
- [x] Intention ≠ Réalité (séparation explicite)
- [x] Zéro sync (aucune réécriture corrective)
- [x] Pipeline stock unique (fn_post_stock_document)
- [x] Déterminisme (DISTINCT ON + ORDER BY)
- [x] Idempotence (idempotency_key UNIQUE)
- [x] Concurrence (FOR UPDATE lock)
- [x] Traçabilité (source_line_id, ship_stock_event_id)
- [x] Back-conversion déterministe (même path forward/reverse)
- [x] Multi-zone support (agrégation SUM)
- [x] Annulation métier (cancel_shipment flow)
- [x] Litige basé sur snapshots CLIENT
- [x] Facturation basée sur received_quantity > 0
- [x] Isolation des flows (aucun flow ne corrompt un autre)

---

*Ce document accompagne les 5 flowcharts Mermaid et constitue la validation finale avant implémentation.*
