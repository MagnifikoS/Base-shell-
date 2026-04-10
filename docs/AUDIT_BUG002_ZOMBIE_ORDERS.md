# AUDIT BUG-002 — Import B2B cross-family créant des commandes zombies

## 1. Résumé exécutif

**Nature :** Le pipeline d'import B2B (`fn_import_b2b_product_atomic`) ne valide pas la cohérence entre la famille d'unités du produit fournisseur et celle du produit client créé localement. Un produit peut être importé, rendu visible, commandé par le client, mais être **impossible à expédier** car `fn_convert_b2b_quantity` ne trouve pas de chemin de conversion inter-tenant.

**Gravité : CRITIQUE** — crée des commandes bloquées en production, requiert intervention manuelle.

**Portée :** 4 produits sur 400 imports (1%) confirmés cross-family. Le bug est **toujours actif** et peut se reproduire sur tout nouvel import si le Wizard produit côté fournisseur ne définit pas d'équivalence cross-family.

**Confiance dans le diagnostic : 95%** — vérifié sur données réelles, fonctions SQL auditées, frontend scanné.

---

## 2. Reconstitution du flow exact

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 1 — IMPORT (frontend → fn_import_b2b_product_atomic)                │
│                                                                            │
│  Le fournisseur a un produit SAFRAN en kg (weight).                        │
│  Le frontend appelle b2bImportPipeline.prepareSingleProduct():             │
│    → mapProductUnits() cherche les unités fournisseur par (family, abbr)   │
│    → Trouve "kg" côté client (même family weight) → status: MAPPED        │
│    → getUnitBlockReason() → null (pas de blocage)                          │
│    → Produit marqué "ELIGIBLE"                                             │
│                                                                            │
│  ⚠️ AUCUNE VALIDATION que le produit client RÉSULTANT sera expédiable     │
│                                                                            │
│  fn_import_b2b_product_atomic() crée le produit client :                   │
│    → NOM : "SAFRAN IRANIEN"                                                │
│    → Mais le client a MODIFIÉ son produit local : final_unit = pce (count) │
│    → stock_handling_unit = pce (count)                                     │
│    → Le mapping B2B enregistre : {supplier_kg → client_kg}                 │
│                                                                            │
│  RÉSULTAT : produit client en pce, mapping en kg, aucune équivalence       │
├─────────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 2 — CATALOGUE / COMMANDABILITÉ                                       │
│                                                                            │
│  Le produit est visible dans le catalogue B2B côté client.                 │
│  Le client commande en pce (son stock_handling_unit).                      │
│  canonical_unit_id de la commande = pce (count).                           │
│  fn_send_commande() fige le prix correctement (BUG-001 corrigé).          │
│  Commande envoyée. Statut = "envoyee".                                     │
│                                                                            │
│  ⚠️ AUCUNE VALIDATION de convertibilité B2B à ce stade                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 3 — EXPÉDITION (fn_ship_commande)                                    │
│                                                                            │
│  Le fournisseur tente d'expédier.                                          │
│  fn_ship_commande() appelle fn_convert_b2b_quantity(                       │
│    source_product_id = SAFRAN_FO,                                          │
│    client_unit_id = pce (dee78c0d...),  ← unité de la LIGNE commande      │
│    client_quantity = 10                                                     │
│  )                                                                         │
│                                                                            │
│  fn_convert_b2b_quantity exécute :                                          │
│    1. supplier stock_handling = kg (57b6...)                                │
│    2. pce ≠ kg → pas identity                                              │
│    3. unit_mapping = {57b6(kg) → 1f57(kg_client)}                          │
│       Cherche: value = pce? NON (value = 1f57 = kg_client)                 │
│       → mapped_supplier_unit = NULL                                        │
│    4. BFS direct : fn_product_unit_price_factor(SAFRAN_FO, pce, kg)        │
│       → SAFRAN_FO n'a PAS de conditionnement_config → NULL                 │
│    5. Cross-tenant name match : "Pièce" vs "Kilogramme"                    │
│       → Noms différents → pas de match                                     │
│    6. Config unit IDs scan : config = {} → rien à scanner                  │
│    7. → status = 'error'                                                   │
│                                                                            │
│  La ligne est marquée conversion_status = 'error'.                         │
│  fn_ship_commande CONTINUE (ne bloque pas) mais exclut cette ligne.        │
│  La ligne devient effectivement "rupture".                                  │
│                                                                            │
│  ❌ COMMANDE ZOMBIE : envoyée, prix figé, mais non expédiable             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cartographie des fonctions impliquées

### Fonctions SQL

| Fonction | Rôle | Validation famille ? |
|----------|------|---------------------|
| `fn_import_b2b_product_atomic` | Crée/met à jour le produit client + b2b_imported_products | ❌ AUCUNE |
| `fn_convert_b2b_quantity` | Convertit quantité client → fournisseur à l'expédition | ✅ Échoue proprement |
| `fn_send_commande` | Fige prix + envoie commande | ❌ Ne vérifie pas la convertibilité B2B |
| `fn_ship_commande` | Expédie la commande | ⚠️ Tolère les erreurs (exclut la ligne) |
| `fn_product_unit_price_factor` | BFS sur conditionnement_config produit | N/A (moteur passif) |

### Frontend

| Fichier | Rôle | Validation famille ? |
|---------|------|---------------------|
| `b2bUnitMapper.ts` | Mappe unités fournisseur → client par (family, name) | ✅ Bloque UNKNOWN/AMBIGUOUS |
| `b2bImportPipeline.ts` | Orchestre l'import | ⚠️ Bloque si unité inconnue, PAS si cross-family post-import |
| `b2bConfigRebuilder.ts` | Reconstruit conditionnement_config avec UUIDs locaux | N/A |
| `b2bCatalogService.ts` | Appelle fn_import_b2b_product_atomic | Aucune validation |

### Tables

| Table | Colonnes clés | Problème |
|-------|--------------|----------|
| `b2b_imported_products` | `unit_mapping JSONB` | Peut contenir un mapping valide mais **inutile** (kg→kg quand client utilise pce) |
| `products_v2` (client) | `stock_handling_unit_id`, `final_unit_id` | Peut être modifié APRÈS import, cassant la cohérence |
| `commande_lines` | `canonical_unit_id` | Utilise l'unité du produit CLIENT, pas celle du mapping |
| `measurement_units` | `family` | Utilisé pour le match mais jamais pour la validation post-import |

### Validations présentes

- `b2bUnitMapper.ts` : bloque si unité fournisseur introuvable côté client (UNKNOWN)
- `b2bUnitMapper.ts` : bloque si unité ambiguë (AMBIGUOUS)
- `fn_convert_b2b_quantity` : retourne `error` si aucun chemin trouvé (mais trop tard)

### Validations absentes (CAUSE DU BUG)

1. **❌ Aucune validation que stock_handling_unit du produit client est convertible vers stock_handling_unit du fournisseur**
2. **❌ Aucune validation post-import si le produit client est modifié**
3. **❌ Aucun gate `fn_send_commande` ne vérifie la convertibilité B2B avant envoi**
4. **❌ `fn_ship_commande` tolère les erreurs de conversion au lieu de bloquer**

---

## 4. Exemples terrain complets

### SAFRAN IRANIEN

| Dimension | Fournisseur (FO) | Client (CL) | Cohérent ? |
|-----------|-----------------|-------------|-----------|
| **nom_produit** | PRODUIT X - SAFRAN IRANIEN | PRODUIT X - SAFRAN IRANIEN | ✅ |
| **final_unit** | kg (weight) | **pce (count)** | ❌ CROSS-FAMILY |
| **stock_handling_unit** | kg (weight) | **pce (count)** | ❌ CROSS-FAMILY |
| **delivery_unit** | NULL | pce (count) | ⚠️ |
| **final_unit_price** | NULL | 4.00€ | ⚠️ FO sans prix |
| **conditionnement_config** | `{}` | `{finalUnit: "Pièce", packagingLevels: []}` | ❌ Pas d'équivalence cross-family |
| **unit_mapping** | — | `{kg_FO → kg_CL}` | ⚠️ Mapping valide mais INUTILE (client utilise pce) |

**Analyse :** Le mapping B2B dit "kg fournisseur = kg client", mais le produit client a été configuré en pce. Quand le client commande en pce, `fn_convert_b2b_quantity` cherche "pce" dans le mapping → pas trouvé → erreur.

**Où ça dévie :** À l'import, le mapper a correctement trouvé l'unité kg côté client. Mais le produit client local utilise pce comme unité opérationnelle. Le mapping est techniquement correct (kg→kg) mais opérationnellement inutile.

**Pourquoi :** La validation d'import vérifie que les unités fournisseur ont un ÉQUIVALENT côté client, mais ne vérifie PAS que cet équivalent est l'unité OPÉRATIONNELLE du produit client (stock_handling_unit).

### HUILE AMPHORE

| Dimension | Fournisseur (FO) | Client (CL) | Cohérent ? |
|-----------|-----------------|-------------|-----------|
| **nom_produit** | PRODUIT Y - HUILE AMPHORE | PRODUIT Y - HUILE AMPHORE | ✅ |
| **final_unit** | **amph (count)** | **kg (weight)** | ❌ CROSS-FAMILY |
| **stock_handling_unit** | **amph (count)** | **kg (weight)** | ❌ CROSS-FAMILY |
| **final_unit_price** | NULL | **0.00€** | ❌ Prix nul |
| **conditionnement_config** | `{}` | `{}` | ❌ Aucune équivalence |
| **unit_mapping** | — | **NULL/vide** | ❌ AUCUN MAPPING |

**Analyse :** Aucun mapping, aucune config, aucune équivalence, prix nul. Ce produit est un cas extrême : il n'aurait jamais dû être importé.

**Où ça dévie :** L'unité "amphore" est classée `count` côté fournisseur. Le client a `kg` (weight). Le mapper n'a trouvé AUCUNE correspondance (`UNKNOWN`). Pourtant le produit a été importé — soit par un bypass, soit par un import antérieur au mapper.

**Pourquoi :** Probablement un import legacy avant l'ajout du mapper, ou un import via fallback textuel.

---

## 5. Analyse causale

### Cause racine

**Le pipeline d'import B2B valide l'existence d'une correspondance d'UNITÉS (kg ↔ kg) mais ne valide pas la CONVERTIBILITÉ OPÉRATIONNELLE du produit résultant.**

La validation est faite au niveau des unités individuelles (le fournisseur a-t-il une unité qui existe aussi chez le client ?), mais PAS au niveau du produit entier (le produit client peut-il être converti vers le produit fournisseur via les unités qu'il utilise réellement ?).

### Causes secondaires

1. **Modification post-import :** Le produit client peut être modifié dans le Wizard Produit (changement de final_unit, stock_handling_unit) SANS re-validation de la cohérence B2B. SAFRAN a probablement été importé avec des unités cohérentes puis modifié.

2. **Absence de gate à l'envoi :** `fn_send_commande` ne vérifie pas que chaque ligne est convertible B2B. Le prix est figé, la commande part, mais elle est mort-née.

3. **Tolérance à l'expédition :** `fn_ship_commande` traite les erreurs de conversion comme des "ruptures" plutôt que des erreurs fatales. Les lignes inconvertibles sont exclues silencieusement.

4. **Imports legacy :** HUILE AMPHORE a été importée avant l'ajout du mapper, sans aucune validation.

### Ce qui n'est PAS la cause

- ❌ Le moteur BFS (fn_product_unit_price_factor) fonctionne correctement
- ❌ fn_convert_b2b_quantity fonctionne correctement — il détecte bien l'erreur
- ❌ Le mapping JSONB unit_mapping est techniquement valide quand il existe
- ❌ Le prix (BUG-001/BUG-003) est un problème séparé — même avec prix correct, la conversion B2B échouerait

---

## 6. Cas impactés

### Confirmés (4 produits sur 400)

| Produit | Type de problème | Impact |
|---------|-----------------|--------|
| SAFRAN IRANIEN | Cross-family (weight→count), mapping inutile | Commande zombie |
| HUILE AMPHORE | Cross-family (count→weight), aucun mapping, prix 0€ | Commande zombie + facture fausse |
| Pomme de terre grenaille | Cross-family (count→weight), mapping complexe | À vérifier |
| MOZZARELLA MAESTRELLA | Cross-family (weight→count), mapping complexe | À vérifier |

### Familles de cas touchés

| Cas | Actif aujourd'hui ? | Fréquence estimée |
|-----|---------------------|-------------------|
| Cross-family sans équivalence | ✅ Oui | Chaque import cross-family |
| Modification produit client post-import | ✅ Oui | Non mesurable (dépend du Wizard) |
| Import legacy sans mapper | ❌ Non (mapper ajouté) | Legacy uniquement |
| Mapping NULL/vide | ✅ Oui (1 cas) | Rare |
| Unité exotique sans famille standard | ✅ Oui | 1 cas confirmé (amphore) |
| Prix client orphelin (prix != 0 mais conversion impossible) | ✅ Oui | 1 cas confirmé (SAFRAN) |

### Cas NON touchés

- Produits same-family avec mapping correct (396/400) : ✅ OK
- Produits simples identity (même UUID d'unité) : ✅ OK
- Produits avec equivalence cross-family définie dans conditionnement_config : ✅ OK

---

## 7. Risques métier

### Commande zombie
Le client commande un produit qui ne peut pas être expédié. Le fournisseur reçoit la commande, tente d'expédier, la ligne est exclue/en rupture. Le client ne reçoit jamais le produit. Aucune alerte claire n'est émise.

### Blocage fournisseur
Le fournisseur ne comprend pas pourquoi la ligne est en "rupture" alors qu'il a du stock. Perte de confiance dans le système. Intervention support nécessaire.

### Fausse rupture
La ligne est traitée comme une rupture de stock (pas de produit disponible) alors qu'il s'agit d'une incompatibilité technique de conversion. Confusion dans les métriques de rupture.

### Impact comptable
- SAFRAN : commandes avec prix (4.00€/pce) mais pas d'expédition → pas de facture
- AMPHORE : prix à 0€ (BUG-003) — même si la conversion marchait, la facture serait fausse

### Support / exploitation
Chaque commande zombie nécessite un diagnostic manuel pour comprendre pourquoi l'expédition échoue. Coût opérationnel disproportionné.

---

## 8. Questions ouvertes

1. **Modification post-import SAFRAN :** Il est probable que SAFRAN a été importé avec des unités cohérentes (kg/weight) puis le produit client a été modifié en pce/count via le Wizard. Je n'ai pas de preuve temporelle directe (pas d'audit trail sur les changements d'unités du produit). **Confiance : 80%.**

2. **Pomme de terre grenaille et MOZZARELLA :** Ces produits ont des mappings complexes (3 entrées chacun). Sont-ils fonctionnellement bloqués comme SAFRAN ou le mapping complexe résout-il partiellement le problème ? **Non testé** — nécessiterait un appel `fn_convert_b2b_quantity` avec les unités réelles de leurs commandes.

3. **Gate d'envoi vs gate d'import :** La correction optimale est-elle de bloquer à l'import (empêcher le produit zombie) ou à l'envoi de commande (empêcher la commande zombie) ou les deux ? C'est une décision architecturale à prendre avant de corriger.

4. **Produits modifiés post-import :** Existe-t-il un mécanisme de re-validation quand le Wizard Produit change les unités fondamentales d'un produit importé B2B ? **Réponse : NON.** C'est un vecteur d'attaque actif.

5. **fn_ship_commande tolérance :** Le choix de traiter les erreurs de conversion comme des "ruptures" silencieuses plutôt que des erreurs bloquantes est-il intentionnel (résilience) ou un trou ? **Non documenté.**
