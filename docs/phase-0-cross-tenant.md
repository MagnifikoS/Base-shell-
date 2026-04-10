# PHASE 0 — PRÉPARATION ET GARDE-FOUS

## Document : phase 0 cross tenant

**Date** : 2026-03-18  
**Statut** : Audit terminé, aucune donnée modifiée  
**Périmètre** : `conditionnement_config` JSON uniquement (hors `stock_events`)

---

## 1. NOMBRE EXACT DE PRODUITS CONCERNÉS

| Établissement | Type | Produits affectés | Refs JSON cassées | Inactifs (0 events) | Actifs (events > 0) |
|---|---|---|---|---|---|
| **CL** | CROSS_TENANT | 3 | 9 | 1 | 2 |
| **Magnifiko** | CROSS_TENANT | 189 | 389 | 73 | 116 |
| **Magnifiko** | ORPHAN | 25 | 25 | 12 | 13 |
| **NONNA SECRET** | ORPHAN | 30 | 30 | 10 | 20 |
| **Piccolo Magnifiko** | CROSS_TENANT | 148 | 292 | 101 | 47 |
| **Piccolo Magnifiko** | ORPHAN | 21 | 21 | 18 | 3 |

### Totaux

| Métrique | Valeur |
|---|---|
| **Produits cross-tenant** | 340 (CL: 3, Magnifiko: 189, Piccolo: 148) |
| **Refs cross-tenant dans JSON** | 690 |
| **Produits avec UUID orphelin** | 76 (Magnifiko: 25, NONNA: 30, Piccolo: 21) |
| **Refs orphelines** | 76 |
| **UUID orphelin unique** | `0d2550fd-98ba-48ab-92a2-233a2da40c92` |
| **Produits inactifs corrigeables** | 215 |
| **Produits actifs à traiter avec prudence** | 201 |

---

## 2. UUID ORPHELIN IDENTIFIÉ

**UUID** : `0d2550fd-98ba-48ab-92a2-233a2da40c92`

- **Identité probable** : Millilitre (ml) — apparaît dans `equivalence.unit_id` avec `unit: "ml"` et `quantity: 500` (ex: Bouteille → 500 ml)
- **Présent chez** : NONNA SECRET, Magnifiko, Piccolo Magnifiko
- **Statut** : Supprimé de `measurement_units` — aucune correspondance possible directe
- **Produits touchés** : ~76 (dont ~36 avec events > 0)
- **Contexte JSON** : Toujours dans `equivalence.unit_id` (jamais dans `packagingLevels`)

### Traitement recommandé

Pour chaque établissement, remapper vers le `ml` local :
- **Magnifiko** : `824ee66f-97ab-420a-a7c3-db2b938f4589` (Millilitre, ml, base)
- **NONNA SECRET** : `dc97a0d9-9a3d-4564-a50b-077c408815b6` (Millilitre, ml, base)
- **Piccolo Magnifiko** : `25e9b22f-5a14-4277-8b0a-5f4cf1dfe33e` (Millilitre, ml, base)

**Qualité du mapping** : SÛRE — l'UUID apparaît exclusivement avec le label "ml" dans le JSON.

---

## 3. TABLE DE MAPPING PROPOSÉE

### CL ← FO (3 produits, 9 refs)

| Unité | Abbreviation | Family | UUID étranger (FO) | UUID local (CL) | Match |
|---|---|---|---|---|---|
| Pièce | pce | base | `55abed2d-941b-423e-a1e8-11bd0be0adbc` | `dee78c0d-2af2-4059-a58a-f45cfd7aeec8` | ✅ EXACT |
| Gramme | g | base | `b90bf1cd-d308-4e6d-8a41-90730a18ef8e` | `bd67e02d-d994-4b3d-bb04-b8e04c8714b7` | ✅ EXACT |
| Litre | L | base | `2038e93d-448d-410b-a945-f0b799ddece2` | `e49807a0-f5e3-4bd6-a338-6f7c73de4636` | ✅ EXACT |

### Magnifiko ← NONNA SECRET (189 produits, 389 refs)

| Unité | Abbr | Family | UUID étranger (NONNA) | UUID local (Magnifiko) | Match |
|---|---|---|---|---|---|
| Bidon | bid | packaging | `38c30b91-c915-4507-9b39-72fff6867162` | `22408ee3-c663-403c-877e-943f8bb52c0f` | ✅ EXACT |
| Boîte | bte | packaging | `e8fe3966-bd47-483c-b725-df1e62e8470a` | `d30f20eb-23a5-43c1-a62f-433e51c3533f` | ✅ EXACT |
| Bouteille | bout | packaging | `d54e0350-7dc7-46da-bd34-5de2207e753b` | `02f610ef-0e90-4fd1-80cd-000e3c4112e8` | ✅ EXACT |
| Canette | can | packaging | `a6d71940-3ee0-4904-b10d-a4fd441e9a96` | `f6acc619-b2f3-4d30-b54d-ca48606c4bf0` | ✅ EXACT |
| Carton | car | packaging | `c4905c17-8b2e-4e37-92c5-8631843be784` | `ff3c8bb6-7e0b-40ec-8880-5b74595d3d1c` | ✅ EXACT |
| Colis | col | packaging | `b6fc5c05-ef49-4f59-a7fc-1f0357d4f1bd` | `9f30f66c-75d9-4123-8ab0-5487152452f3` | ✅ EXACT |
| Gramme | g | base | `02b6fa14-b8eb-47e4-bb81-38f13fb94fdc` | `f1c2eb78-4f8c-4d01-b958-986ef58afe40` | ✅ EXACT |
| Kilogramme | kg | base | `09a320f0-c826-4234-b1d9-a30fd87508cf` | `0acf2a5f-5ea4-48c5-8fee-e91a587eab53` | ✅ EXACT |
| Litre | L | base | `5d959707-b7cd-4a0b-81cb-c1fbcb11ac29` | `be5d064e-9860-45c6-9049-af88e77436c7` | ✅ EXACT |
| Millilitre | ml | base | `dc97a0d9-9a3d-4564-a50b-077c408815b6` | `824ee66f-97ab-420a-a7c3-db2b938f4589` | ✅ EXACT |
| Pack | pack | packaging | `ba187c41-9f99-49e4-87e1-7bcda7bc3fe8` | `bba6ca4c-4300-486d-a25f-40ba3b9f5d9b` | ✅ EXACT |
| Paquet | paq | packaging | `814a7be5-4416-4a1f-8a9f-46d7bf19ffcf` | `52ba0538-b4f6-43e6-8713-4a355aeca3f0` | ✅ EXACT |
| Pièce | pce | base | `252649a4-3905-4e56-959e-f4735521fbf4` | `100978f3-3e0d-437c-89ac-23d7a9fd6738` | ✅ EXACT |
| Pot | pot | packaging | `70922c6d-d866-42e4-869f-cc45f06fe3e3` | `c3b46d02-aa09-4465-bfd5-1eb6c21a4e39` | ✅ EXACT |
| Rouleau | roul | packaging | `06ae69f9-2d21-45a7-a1bd-ce40b486d68d` | `0b6f0acf-cd61-4e3f-a1e9-42e2e21ac28f` | ✅ EXACT |
| Sac | sac | packaging | `2d059409-d81e-4cf5-ab1e-72485a45ef5d` | `3a15c389-4fdd-4c53-ad89-87021a1afdf8` | ✅ EXACT |
| Sachet | sach | packaging | `922fde96-4e1c-4605-aa45-da802e07c582` | `77d0f1a1-cb92-464e-9b10-f61bcc12870a` | ✅ EXACT |

### Piccolo Magnifiko ← NONNA SECRET (148 produits, 292 refs)

| Unité | Abbr | Family | UUID étranger (NONNA) | UUID local (Piccolo) | Match |
|---|---|---|---|---|---|
| Mêmes unités NONNA que ci-dessus | — | — | — | Correspondances locales Piccolo | ✅ EXACT |

*(Le mapping complet Piccolo utilise les mêmes UUID source NONNA avec les équivalents Piccolo locaux — tous en EXACT_MATCH)*

### Orphelin global

| UUID orphelin | Remapping par établissement |
|---|---|
| `0d2550fd-...233a2da40c92` | Magnifiko: `824ee66f...` (ml) / NONNA: `dc97a0d9...` (ml) / Piccolo: `25e9b22f...` (ml) |

---

## 4. CAS AMBIGUS

**Aucun cas ambigu détecté.**

Tous les mappings cross-tenant sont en EXACT_MATCH (même abbreviation, même family). Il n'y a aucun cas PARTIAL_MATCH ni NO_LOCAL_EQUIVALENT.

---

## 5. CAS NON CORRIGEABLES AUTOMATIQUEMENT

**Aucun cas non corrigeable.**

L'UUID orphelin `0d2550fd` est clairement identifié comme "ml" (Millilitre) d'après le contexte JSON (`unit: "ml"`). Le remapping est sûr.

---

## 6. FLOWS RÉELLEMENT IMPACTÉS PAR `conditionnement_config`

Analyse des 73 fichiers référençant `conditionnement_config` :

### Flows critiques (utilisent les UUID internes pour conversion)

| Flow | Fichier clé | Impact |
|---|---|---|
| **BFS / Conversion d'unités** | `src/core/unitConversion/resolveProductUnitContext.ts` | ⚠️ **BLOQUÉ** — ne trouve pas les unités étrangères |
| **buildCanonicalLine** | `src/modules/stockLedger/engine/buildCanonicalLine.ts` | ⚠️ Lit `levels`/`equivalence` pour les conversions |
| **Retrait stock** | `src/modules/stockLedger/` | ⚠️ Unités manquantes dans le sélecteur |
| **Réception (BL App)** | `src/modules/blApp/` | ⚠️ Conversion cassée si unité étrangère |
| **Inventaire** | `src/modules/inventaire/` | ⚠️ Unités manquantes |

### Flows non critiques (lecture seule / affichage)

| Flow | Impact |
|---|---|
| Wizard V3 (reconfiguration) | Ré-écrira un nouveau JSON propre |
| Page détail produit | Affichage du résumé texte |
| Export CSV | Pas d'utilisation des UUID |

### Structures JSON touchées

| Clé JSON | Contient des UUID étrangers ? |
|---|---|
| `equivalence.unit_id` | ✅ OUI |
| `equivalence.source_unit_id` | ✅ OUI |
| `packagingLevels[].type_unit_id` | ✅ OUI |
| `packagingLevels[].contains_unit_id` | ✅ OUI |
| `priceLevel.billed_unit_id` | ✅ OUI |
| `finalUnit` (texte) | ❌ Non (c'est un label texte) |
| `final_unit_id` (dans JSON) | ❌ Généralement correct (pointe vers local) |

---

## 7. VÉRIFICATION ÉCHANTILLON — PRODUITS ACTIFS DÉJÀ UTILISÉS

### Exemple 1 : Magnifiko — "FARINE T55" (produit `ecf5e00d`)
- `equivalence.unit_id` = `09a320f0...` → NONNA's kg ❌
- `final_unit_id` (colonne FK) = `3a15c389...` → Magnifiko's Sac ✅
- Le BFS ne peut pas résoudre Sac → kg car le kg référencé n'existe pas localement

### Exemple 2 : Magnifiko — "PECORINO POIVRE" (produit `a5511b4b`)
- `priceLevel.billed_unit_id` = `09a320f0...` → NONNA's kg ❌
- `final_unit_id` (colonne FK) = `0acf2a5f...` → Magnifiko's kg ✅
- Le prix est facturé vers un UUID étranger

### Exemple 3 : CL — "TEST 1" (produit `20290fe7`, 30 events)
- `equivalence.source_unit_id` = `55abed2d...` → FO's Pièce ❌
- `equivalence.unit_id` = `b90bf1cd...` → FO's Gramme ❌
- `final_unit_id` (colonne FK) = `dee78c0d...` → CL's Pièce ✅

---

## 8. CONCLUSION

### Ce qui est sûr

- ✅ **Toutes les FK directes** (`final_unit_id`, `delivery_unit_id`, etc.) sur `products_v2` sont correctes — elles pointent vers des unités locales
- ✅ **Le mapping est 100% EXACT_MATCH** — aucune ambiguïté
- ✅ Le JSON `conditionnement_config` est de la **pure configuration** — le modifier ne change aucun solde de stock
- ✅ Les `stock_events` ne sont pas touchés par cette correction
- ✅ Modifier le JSON ne modifie ni les inventaires passés, ni les mouvements historiques

### Ce qui est cassé

- ❌ Le BFS ne résout pas les conversions pour ~340 produits
- ❌ Les unités dérivées (kg, g, ml, etc.) n'apparaissent pas dans les sélecteurs de retrait/inventaire
- ❌ Les facturations/prix peuvent référencer un UUID étranger

### Risque de ne pas corriger

- Les produits affectés restent **sans conversion BFS fonctionnelle**
- Impossible de faire des retraits en unité alternative (ex: kg pour un produit en Sac)
- Le problème empire avec chaque nouvel import B2B

---

## 9. CONFIRMATION

- ✅ **Aucune donnée n'a été modifiée**
- ✅ Aucun UPDATE, INSERT ou DELETE n'a été exécuté
- ✅ Toutes les requêtes étaient en SELECT uniquement
- ✅ Le document est prêt pour validation avant Phase 1

---

## STOP — En attente de validation pour passer à la PHASE 1
