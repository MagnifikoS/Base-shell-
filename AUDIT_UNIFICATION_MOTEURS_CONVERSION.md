# 🔬 AUDIT D'UNIFICATION DU MOTEUR DE CONVERSION

**Date :** 2026-04-02  
**Statut :** AUDIT UNIQUEMENT — AUCUNE MODIFICATION

---

## AXE 1 — INVENTAIRE COMPLET DES MOTEURS DE CONVERSION

### MOTEUR A — SQL : `fn_product_unit_price_factor`

| Attribut | Valeur |
|---|---|
| **Type** | PL/pgSQL, BFS max profondeur 5 |
| **Fichier** | `supabase/migrations/20260317174921_...sql` |
| **Sources de données** | 1) `conditionnement_config.packagingLevels` (JSON direct depuis `products_v2`) 2) `conditionnement_config.equivalence` 3) `unit_conversions` table |
| **Sémantique** | Retourne un **facteur prix** : pour convertir un prix de `from_unit` vers `to_unit` |
| **Entrée** | `(product_id, from_unit_id, to_unit_id)` |
| **Sortie** | `numeric` (facteur) ou `NULL` si pas de chemin |
| **Wrapper** | `fn_convert_line_unit_price` (ajout récent, même moteur, retour JSONB `{ok, converted_price, factor, error}`) |

**Utilisé par :**
| Consommateur SQL | Rôle | Critique ? |
|---|---|---|
| `fn_send_commande` | Snapshot prix commande (via `fn_convert_line_unit_price`) | ✅ OUI |
| `fn_create_bl_withdrawal` | Prix BL sortie | ✅ OUI |
| `fn_ship_commande` | Conversion B2B (via `fn_convert_b2b_quantity`) | ✅ OUI |
| `fn_convert_b2b_quantity` | Conversion quantités B2B | ✅ OUI |

### MOTEUR B — TypeScript : `findConversionPath` (conditionnementV2)

| Attribut | Valeur |
|---|---|
| **Type** | TypeScript, BFS sans limite de profondeur |
| **Fichier** | `src/modules/conditionnementV2/conversionGraph.ts` |
| **Sources de données** | 1) `unit_conversions` (fetch client-side) 2) `packagingLevels` (extraites du `conditionnement_config`) 3) `equivalence` 4) **Compositions via famille** (unit_conversions through reference unit) |
| **Sémantique** | Retourne un **facteur quantité** : `1 from_unit = factor to_units` |
| **Entrée** | `(fromId, toId, units[], conversions[], packagingLevels[], equivalence)` |
| **Sortie** | `{ factor, reached, warnings, path }` |

**Utilisé par :**
| Consommateur TS | Fichier | Rôle | Critique ? |
|---|---|---|---|
| BL App (création lignes) | `blAppService.ts` | Prix BL réception | ✅ OUI |
| `resolveInputConversion` | `resolveInputConversion.ts` | Conversion saisie → canonique | ✅ OUI |
| `convertPriceToLineUnit` | `convertPriceToLineUnit.ts` | **Display-only** reconversion prix | ⚠️ Display |
| `reconvertToDisplayUnit` | `reconvertToDisplayUnit.ts` | **Display-only** reconversion qté | ⚠️ Display |
| Wizard Produit (step 3, 5) | `WizardStep3.tsx`, `WizardStep5.tsx` | Validation config prix | ✅ OUI |
| `resolveProductUnitContext` | `resolveProductUnitContext.ts` | Validation unités | ✅ OUI |
| `conditionnementV2/engine.ts` | `engine.ts` | Calculs packaging | ✅ OUI |
| Marchandise engine | `monthlyMerchandiseEngine.ts` | Valorisation stock | ✅ OUI |
| `useInvoiceDisplayPrices` | Hook facture | **Display-only** reconversion prix | ⚠️ Display |
| `QuantityModalWithResolver` | Composant UI | Conversion saisie | ✅ OUI |
| `useCountingModal` (inventaire) | Hook inventaire | Conversion comptage | ✅ OUI |

### HELPERS FRONTEND DE RECONVERSION (sous-ensemble du moteur TS)

| Helper | Fichier | Rôle |
|---|---|---|
| `convertPriceToLineUnit` | `src/lib/units/convertPriceToLineUnit.ts` | Prix source → prix display (÷ facteur) |
| `reconvertToDisplayUnit` | `src/modules/stockLedger/utils/reconvertToDisplayUnit.ts` | Qté canonique → qté display |
| `useInvoiceDisplayPrices` | `src/modules/factureApp/hooks/useInvoiceDisplayPrices.ts` | Prix facture → display |

**Tous utilisent `findConversionPath` — ce sont des wrappers, pas des moteurs séparés.**

---

## AXE 2 — HISTORIQUE ET ORIGINE DE LA DUPLICATION

### Chronologie

1. **Mars 2026-03-17** : Création de `fn_product_unit_price_factor` (SQL BFS)
   - But : permettre la conversion de prix dans `fn_send_commande` et `fn_create_bl_withdrawal` côté SQL
   
2. **Antérieur** : `findConversionPath` (TS) existait déjà dans `conditionnementV2`
   - But original : moteur de conversion du wizard produit + saisie terrain
   
3. **BL App (`blAppService.ts`)** : Utilise le moteur TS car le BL réception est un **service TypeScript** (pas une RPC SQL)

### Pourquoi deux moteurs ?

| Raison | Explication |
|---|---|
| **Contrainte architecturale** | Les RPCs SQL (`fn_send_commande`, `fn_ship_commande`, `fn_create_bl_withdrawal`) s'exécutent DANS Postgres — elles ne peuvent pas appeler du TypeScript |
| **Le BL App est un service TS** | `blAppService.ts` s'exécute côté client/serveur TS — il ne peut pas facilement appeler une RPC pour chaque ligne |
| **La duplication est structurelle, pas accidentelle** | Deux runtimes différents (SQL vs TS) nécessitent deux implémentations |

### Verdict sur l'origine

> **La duplication est ARCHITECTURALE et NON ACCIDENTELLE.**
> 
> Le moteur SQL existe parce que les RPCs doivent convertir des prix atomiquement dans une transaction SQL.  
> Le moteur TS existe parce que le frontend et les services TS doivent convertir côté client.  
> **Aucun des deux n'a été créé "par contournement" ou "par erreur".**

---

## AXE 3 — COMPARAISON FONCTIONNELLE DES DEUX MOTEURS

### Algorithme

| Aspect | Moteur SQL | Moteur TS |
|---|---|---|
| Algorithme | BFS (queue arrays) | BFS (queue array) |
| Profondeur max | **5** | **Illimitée** |
| Bidirectionnel | ✅ Oui (forward + inverse) | ✅ Oui |
| Sources : `unit_conversions` | ✅ Oui | ✅ Oui |
| Sources : `packagingLevels` | ✅ Oui (JSON direct) | ✅ Oui |
| Sources : `equivalence` | ✅ Oui | ✅ Oui |
| **Compositions via famille** | ❌ **NON** | ✅ **OUI** |

### ⚠️ DIVERGENCE CRITIQUE IDENTIFIÉE

Le moteur TS a une capacité supplémentaire (lignes 79-124 de `conversionGraph.ts`) :

```typescript
// Also add via-reference conversions from same family
// Group units by family
// For each other unit in the family, try to create an edge via ref
```

**Le moteur TS compose des conversions transitives au sein d'une même famille** (ex: g → kg via la référence de la famille `weight`), MÊME SI aucune entrée `g → kg` directe n'existe dans `unit_conversions`.

**Le moteur SQL ne fait PAS cette composition.** Il ne connaît que les chemins explicites dans `unit_conversions` + packaging + equivalence.

### Cas de test comparatifs

| Cas | Moteur TS | Moteur SQL | Même résultat ? |
|---|---|---|---|
| **pce → pce** (identité) | factor=1 ✅ | factor=1 ✅ | ✅ OUI |
| **g → kg** (via `unit_conversions` directe) | factor=0.001 ✅ | factor=0.001 ✅ | ✅ OUI (si entrée directe existe) |
| **g → kg** (via famille weight, sans entrée directe) | factor=0.001 ✅ (via composition) | **NULL** ❌ | ❌ **NON** |
| **ml → L** (via famille volume, sans entrée directe) | factor=0.001 ✅ (via composition) | **NULL** ❌ | ❌ **NON** |
| **Carton → pce** (packaging) | factor=qty ✅ | factor=qty ✅ | ✅ OUI |
| **pce → g** (équivalence) | factor=equiv_qty ✅ | factor=equiv_qty ✅ | ✅ OUI |

### Conclusion divergence

> **Les deux moteurs divergent UNIQUEMENT quand la table `unit_conversions` ne contient pas d'entrée directe pour une conversion physique standard (g→kg, ml→L, etc.).**
>
> Le moteur TS compense en composant via la référence de famille.  
> Le moteur SQL échoue silencieusement (retourne NULL).

---

## AXE 4 — CARTOGRAPHIE D'IMPACT PAR MODULE

| Module | Fonction/Fichier | Moteur | Critique ? | Impact si unification |
|---|---|---|---|---|
| **Commande (envoi)** | `fn_send_commande` → `fn_convert_line_unit_price` | SQL | ✅ | Doit garder SQL |
| **Commande (expédition B2B)** | `fn_ship_commande` → `fn_convert_b2b_quantity` | SQL | ✅ | Doit garder SQL |
| **BL Withdrawal** | `fn_create_bl_withdrawal` | SQL | ✅ | Doit garder SQL |
| **BL Réception** | `blAppService.ts` | TS | ✅ | Doit garder TS |
| **Facture App** | `fn_generate_app_invoice` | **Aucun** (copie snapshot) | ✅ | Hérite de SQL |
| **Stock Ledger** | `resolveInputConversion` | TS | ✅ | Doit garder TS |
| **Inventaire** | `useCountingModal` | TS | ✅ | Doit garder TS |
| **Produit Wizard** | `WizardStep3/5` | TS | ✅ | Doit garder TS |
| **Marchandise** | `monthlyMerchandiseEngine` | TS | ✅ | Doit garder TS |
| **Display facture** | `useInvoiceDisplayPrices` | TS (display-only) | ⚠️ | Supprimable si DB correcte |
| **Display BL retrait** | `reconvertToDisplayUnit` | TS (display-only) | ⚠️ | À conserver (reconversion qté) |

---

## AXE 5 — IDENTIFICATION DE LA SOURCE UNIQUE CIBLE

### La question n'est pas "SQL vs TS"

Les deux moteurs sont **nécessaires** dans leurs runtimes respectifs :
- Les RPCs SQL ne peuvent pas appeler du TypeScript
- Le frontend ne peut pas exécuter du PL/pgSQL inline

### Le vrai problème

> **Ce ne sont pas deux moteurs concurrents. Ce sont deux implémentations du même algorithme dans deux runtimes, avec une PARITÉ INCOMPLÈTE.**

Le moteur TS a une capacité que le SQL n'a pas : la composition via famille.

### Recommandation : SOURCE UNIQUE = ALGORITHME IDENTIQUE

Le moteur qui doit être la **spécification de référence** est le moteur TS, car :
1. Il couvre tous les cas (compositions via famille)
2. Il est plus testable (unit tests TS existants)
3. Il est plus lisible et maintenable

**Mais le moteur SQL doit RESTER** car les RPCs en dépendent.

**→ La correction juste est de mettre le moteur SQL À PARITÉ avec le TS.**

---

## AXE 6 — STRATÉGIE D'UNIFICATION

### Recommandation principale : MISE À PARITÉ DU MOTEUR SQL

**Quoi :** Ajouter la composition via référence de famille dans `fn_product_unit_price_factor`.

**Comment :**
1. Dans la boucle BFS SQL, après les vérifications `unit_conversions` directes, ajouter une étape qui :
   - Identifie la famille de l'unité courante
   - Trouve l'unité de référence de cette famille
   - Compose le chemin `current → reference → target` si les deux conversions existent dans `unit_conversions`

**Ordre de migration (risque minimal) :**

| Étape | Action | Risque |
|---|---|---|
| 1 | Ajouter la composition via famille dans `fn_product_unit_price_factor` | Très faible — ajoute des chemins, n'en supprime aucun |
| 2 | Vérifier que `fn_send_commande` produit les bons snapshots pour g→kg, ml→L | Validation |
| 3 | Vérifier que `fn_create_bl_withdrawal` produit les bons prix | Validation |
| 4 | Si snapshots commande corrects → `useInvoiceDisplayPrices` devient redondant pour les nouvelles factures | Simplification future |

### Ce qui ne doit PAS être touché

- ❌ Le moteur TS (`findConversionPath`) — il fonctionne déjà
- ❌ `blAppService.ts` — il fonctionne déjà
- ❌ Les anciennes données — elles restent dans leur format
- ❌ `useInvoiceDisplayPrices` — il reste nécessaire pour les anciennes factures

### Ce qui deviendra obsolète (phase future)

Une fois le SQL à parité :
- `useInvoiceDisplayPrices` → pour les **nouvelles** factures, le display sera inutile car `unit_price` sera déjà correct
- `convertPriceToLineUnit` → même logique : les nouveaux BL SQL seront déjà corrects

---

## AXE 7 — VALIDATION DE NON-RÉGRESSION

### Tests requis avant/après la mise à parité SQL

| Zone | Invariant | Test |
|---|---|---|
| `fn_product_unit_price_factor` | `g→kg = 0.001` (via famille) | `SELECT fn_product_unit_price_factor(product_id, g_uuid, kg_uuid)` |
| `fn_product_unit_price_factor` | `ml→L = 0.001` | Idem |
| `fn_product_unit_price_factor` | `pce→pce = 1.0` | Identité |
| `fn_product_unit_price_factor` | Packaging carton→pce = N | Via config |
| `fn_send_commande` | `unit_price_snapshot` correct pour g→kg | Créer commande test + envoyer |
| `fn_create_bl_withdrawal` | `unit_price_snapshot` correct | Créer retrait test |
| `fn_ship_commande` | `fn_convert_b2b_quantity` inchangé | Expédier commande test |
| `fn_generate_app_invoice` | Copie fidèle du snapshot | Générer facture test |
| **Moteur TS** | Doit rester identique | Tests vitest existants |
| **BL App** | Prix identiques avant/après | Créer BL réception |

### Symptômes de régression

| Symptôme | Cause probable |
|---|---|
| Prix à 0.00€ sur commande | Composition famille pas ajoutée |
| `line_total ≠ qty × unit_price` | Bug dans le facteur composé |
| Double conversion frontend | Helper display pas mis à jour |
| BFS infini ou timeout | Bug dans la boucle composition SQL |

---

## RÉSUMÉ FINAL

### Réponse à la question centrale

> **Est-ce que le moteur TypeScript du BL est un second moteur créé par contournement ?**
>
> **NON.** Le moteur TS est le moteur ORIGINAL. Le moteur SQL est une réimplémentation nécessaire pour les RPCs. La duplication est architecturale (deux runtimes) et non accidentelle.

### Le vrai problème

> **Le moteur SQL est une implémentation INCOMPLÈTE du moteur TS.** Il manque la composition via référence de famille, ce qui fait échouer les conversions physiques standard (g→kg, ml→L) quand aucune entrée directe n'existe dans `unit_conversions`.

### Point unique de correction

> **`fn_product_unit_price_factor`** — ajouter la composition via famille pour atteindre la parité avec le moteur TS.

### Analyse de risque

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| La composition SQL diverge du TS | Faible | Moyen | Tests croisés SQL vs TS |
| Performance SQL (requêtes famille) | Très faible | Faible | Max 5 profondeur, requêtes simples |
| Régression sur cas existants | Très faible | Fort | La modif ajoute des chemins, n'en supprime aucun |
| Anciennes données incohérentes | Nul | Nul | On ne touche pas l'historique |

### Recommandation finale

> **UNE SEULE action : mettre `fn_product_unit_price_factor` à parité avec `findConversionPath` en ajoutant la composition via référence de famille.**
>
> C'est la correction minimale, unique, sans effet de bord.
> Elle résout le problème facture (snapshot commande corrigé → facture corrigée automatiquement).
> Elle ne touche aucun module TS existant.
> Elle ne touche aucune donnée historique.
