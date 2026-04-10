# 📋 RAPPORT COMPLET — STRATÉGIE UNITÉ FOURNISSEUR V1

> **Document de référence figé — Zéro implémentation**
> Consolidation de tous les audits (initial + complémentaire + dernier niveau)

---

## 1. VISION & OBJECTIF

### Problème actuel

Les flux B2B (commande client, préparation fournisseur, réception client) utilisent le contexte `"internal"` pour résoudre l'unité de saisie. Cela signifie que **le client commande dans son unité locale** (ex: kg) au lieu de l'unité fournisseur (ex: carton). Cette incohérence crée une double réalité entre ce que le fournisseur expédie et ce que le client reçoit.

### Objectif V1

**Aligner tous les flux transactionnels B2B sur l'Unité Fournisseur**, dérivée dynamiquement du conditionnement (`packagingLevels[0]`), sans configuration manuelle supplémentaire.

### Scope strict

- **Produits neufs uniquement** — pas de migration legacy
- **Zéro fallback** — pas de comportement dégradé
- **Zéro legacy** — pas de compatibilité ascendante

---

## 2. ARCHITECTURE EXISTANTE (État des lieux)

### 2.1 Couches d'unités produit (3 couches distinctes)

| Couche | Champ | Rôle | Exemple |
|--------|-------|------|---------|
| **Facturation** | `supplier_billing_unit_id` | Vérité commerciale (prix, facture) | kg |
| **Stock canonique** | `stock_handling_unit_id` | Vérité physique immuable (ledger) | pièce |
| **Saisie terrain** | `product_input_config.*_preferred_unit_id` | Préférence d'interface (modal) | carton |

### 2.2 Résolveur central — `resolveInputUnitForContext`

Le résolveur est le **point unique** qui détermine quelle unité afficher dans un modal de saisie. Il :

1. Lit la `product_input_config` du produit
2. Selon le contexte (`"reception"` ou `"internal"`), lit les champs `reception_*` ou `internal_*`
3. Détermine le **mode** (`integer`, `continuous`, `multi_level`, `fraction`)
4. Détermine l'**unité préférée** via le graphe BFS
5. Retourne un statut : `ok`, `not_configured`, ou `needs_review`

**Garde dur** : Si `config === null` → statut `not_configured` → **modal bloqué**.

### 2.3 Routage actuel `toInputContext`

```typescript
// ACTUEL — dans QuantityModalWithResolver.tsx
function toInputContext(ct: QuantityContextType): InputContext {
  return ct === "reception" ? "reception" : "internal";
}
```

**Conséquence** : `"order"` (commande B2B) est routé vers `"internal"` → utilise l'unité locale du client, pas l'unité fournisseur.

### 2.4 Points d'appel au résolveur (liste exhaustive)

**Via `QuantityModalWithResolver` (passent par `toInputContext`)** :

| Fichier | contextType | Résultat actuel | Correct ? |
|---------|-------------|-----------------|-----------|
| `ReceptionView.tsx` | `"reception"` | → `"reception"` | ✅ |
| `WithdrawalView.tsx` | `"withdrawal"` | → `"internal"` | ✅ |
| `NouvelleCommandeDialog.tsx` | `"order"` | → `"internal"` | ❌ Devrait être `"reception"` |
| `CommandeDetailDialog.tsx` | `"order"` | → `"internal"` | ❌ Devrait être `"reception"` |
| `PreparationDialog.tsx` | `"order"` | → `"internal"` | ❌ Devrait être `"reception"` |
| `BlAppCorrectionDialog.tsx` | `"correction"` | → `"internal"` | ✅ |
| `BlRetraitCorrectionDialog.tsx` | `"correction"` | → `"internal"` | ✅ |
| `InventoryProductDrawer.tsx` | `"inventory"` | → `"internal"` | ✅ |
| `MobileInventoryView.tsx` | `"inventory"` | → `"internal"` | ✅ |

**Appels directs (sans `toInputContext`)** :

| Fichier | Contexte passé | Correct ? |
|---------|---------------|-----------|
| `MobileReceptionView.tsx` | `"reception"` en dur | ✅ |
| `MobileWithdrawalView.tsx` | `"internal"` en dur | ✅ |
| `useCountingModal.ts` | `"internal"` en dur | ✅ |
| `useSaveInputConfig.ts` | `"reception"` + `"internal"` (validation) | ✅ |

### 2.5 Pipeline d'import B2B (`fn_import_b2b_product_atomic`)

**État actuel** :

- ✅ Copie `conditionnement_config` avec remappage UUID
- ✅ Copie `supplier_billing_unit_id` (remappé)
- ✅ Copie `stock_handling_unit_id` (remappé)
- ❌ **NE crée PAS** de `product_input_config` → produit importé = modal bloqué

---

## 3. STRATÉGIE CIBLE V1

### 3.1 Principe fondamental

> **L'Unité Fournisseur est dérivée dynamiquement du premier niveau de conditionnement (`packagingLevels[0].type_unit_id`), pas d'un champ statique.**

Cette unité est **auto-configurée** dans `product_input_config.reception_preferred_unit_id` lors de :

- La création via wizard (auto-config existante)
- L'import B2B (à ajouter)

### 3.2 Contextes de saisie (règle définitive)

| Contexte opérationnel | InputContext résolveur | Source d'unité |
|-----------------------|----------------------|----------------|
| Commande B2B (client commande) | `"reception"` | Unité Fournisseur (packaging niv. 0) |
| Préparation B2B (fournisseur prépare) | `"reception"` | Unité Fournisseur (son propre packaging) |
| Réception (client reçoit) | `"reception"` | Unité Fournisseur (packaging niv. 0) |
| Retrait / Sortie | `"internal"` | Préférence locale client |
| Inventaire | `"internal"` | Préférence locale client |
| Correction BL | `"internal"` | Préférence locale client |

### 3.3 Toggle `allow_unit_sale`

**Nouveau champ** : `products_v2.allow_unit_sale BOOLEAN DEFAULT false`

**Logique** :

- **OFF** : Seule l'Unité Fournisseur (niveau 0) est autorisée en commande/réception
- **ON** : Saisie possible sur les 2 premiers niveaux de conditionnement (ex: Carton + Boîte), excluant les niveaux inférieurs (ex: Pièce, grammes)

**Garde critique** : Si le produit n'a qu'**1 seul niveau** de packaging et toggle ON → le mode reste `integer` (pas de `multi_level` avec chain < 2). Cette logique est gérée à la **configuration**, pas au runtime.

### 3.4 `product_input_config` — Maintenu, pas supprimé

**Clarification critique** : On ne supprime PAS `product_input_config.reception_*`. On change sa **source de vérité pour l'unité** :

- **Avant** : l'utilisateur choisit manuellement l'unité de réception
- **Après** : l'unité est **auto-dérivée** du packaging (read-only quand le conditionnement est défini)

Le résolveur continue de lire `config.reception_*` — mais ces valeurs sont désormais **auto-générées** et **verrouillées**.

**Pourquoi on ne peut pas supprimer la config** : Le résolveur ne choisit pas seulement l'unité — il choisit aussi le **mode** (`integer`, `continuous`, `multi_level`). Le mode n'est pas dérivable du conditionnement seul. Il dépend du toggle `allow_unit_sale` et du nombre de niveaux.

### 3.5 Phrase de vérité figée

> "Un produit neuf fonctionne dans TOUS les modals À CONDITION que `product_input_config` soit auto-générée lors de la création (wizard) ou de l'import (B2B), sans intervention manuelle supplémentaire de l'utilisateur."

---

## 4. POINTS CRITIQUES IDENTIFIÉS (2 bloquants)

### 🔴 CRITIQUE 1 — Routage `toInputContext` incorrect

- **Problème** : `"order"` → `"internal"` au lieu de `"reception"`
- **Impact** : 100% des commandes B2B utilisent la mauvaise unité
- **3 fichiers affectés** : `NouvelleCommandeDialog`, `CommandeDetailDialog`, `PreparationDialog`
- **Correction** : 1 ligne dans `QuantityModalWithResolver.tsx`

### 🔴 CRITIQUE 2 — Import B2B ne crée pas `product_input_config`

- **Problème** : `fn_import_b2b_product_atomic` ne crée pas d'entrée config
- **Impact** : 100% des produits importés sont bloqués dans tous les modals
- **Correction** : Extension SQL de la fonction d'import atomique

---

## 5. RISQUES RÉSIDUELS ET MITIGATIONS

| # | Risque | Gravité | Probabilité | Mitigation |
|---|--------|---------|-------------|------------|
| 1 | Produit 1 niveau + toggle ON → `multi_level` avec chain=1 → bloqué `needs_review` | 🟡 Moyen | Moyen | Garde : 1 niveau → mode `integer` forcé (à la config, pas au runtime) |
| 2 | `supplier_billing_unit_id` ≠ `packagingLevels[0].type_unit_id` (facturé kg, livré carton) | 🟡 Moyen | Faible (wizard aligne pour V1) | Hors scope V1 — concerne uniquement poids variable |
| 3 | Produit sans packaging (`packagingLevels = []`) → dérivation retourne `undefined` | 🟡 Moyen | Faible (wizard valide) | Garde fallback : pas de packaging → `stock_handling_unit_id` |
| 4 | Toggle changé pendant modal ouvert → affichage stale temporaire | 🟢 Faible | Rare | Acceptable V1, invalidation React Query en V2 |
| 5 | `staleTime: 60s` sur `inputConfigs` → config stale si modifiée juste avant | 🟢 Faible | Rare | Acceptable V1 |
| 6 | Fournisseur modifie son conditionnement après import → produit client désynchronisé | 🟢 Info | Connu | Pas de re-sync auto en V1 (accepté) |

---

## 6. PERFORMANCE

- **BFS** : Calcul synchrone, < 1ms par produit, O(n) avec n < 10 unités. Aucun risque même sur 50 produits.
- **Données** : `product_input_config` chargé en bulk (staleTime 60s), `conditionnement_config` déjà dans le produit, `dbUnits` + `dbConversions` en cache React Query. Aucun refetch supplémentaire.
- **Mobile vs Desktop** : Même résolveur, même contexte, même résultat. Comportement strictement identique.

---

## 7. COHÉRENCE B2B CLIENT ↔ FOURNISSEUR

- Le `conditionnement_config` est copié du fournisseur vers le client avec remappage UUID via `unit_mapping`
- `packagingLevels[0].type_unit_id` côté client pointe vers l'unité locale **équivalente** à celle du fournisseur
- Les deux côtés utilisent la **même structure logique** — seuls les UUID diffèrent
- Aucun recalcul local chez le client
- Pas de re-sync auto si le fournisseur modifie son conditionnement (accepté V1)

---

## 8. COHÉRENCE AVEC FUTUR MODULE CONSOMMATION

- Commande = unité fournisseur (packaging, ex: cartons)
- Consommation = unité canonique ou de facturation (ex: kg)
- **Pas d'incohérence** : le ledger stock fonctionne en unité canonique. Toute quantité saisie en cartons est convertie via BFS avant écriture. Commander 2 cartons (= 24 pièces) et consommer en kg reste cohérent tant que le BFS a un chemin (via équivalence).

---

## 9. CAS LIMITES VÉRIFIÉS

### 9.1 `packagingLevels[0]` avec `containsQuantity = null`

Le wizard V3 bloque la création (`wizardGraphValidator.ts` détecte et génère un warning). **Pas de risque pour un produit neuf.**

### 9.2 Produit sans packaging (`packagingLevels = []`)

Dérivation retourne `undefined`. Garde fallback nécessaire : `stock_handling_unit_id ?? final_unit_id`.

### 9.3 `supplier_billing_unit_id` ≠ conditionnement

Aucun modal n'utilise `supplier_billing_unit_id` directement pour déterminer l'unité de saisie. C'est la config qui décide. Pas d'impact.

### 9.4 Multi-ouverture modal

Le résolveur est dans un `useMemo` avec les bonnes deps. Recalcul à chaque changement de produit. Risque de stale mineur (60s) accepté V1.

---

## 10. PLAN D'IMPLÉMENTATION — 5 ÉTAPES SÉQUENTIELLES

### Étape 1 — Fondation DB (migration pure)

- Ajouter `allow_unit_sale BOOLEAN DEFAULT false` sur `products_v2`
- Zéro modification de logique
- **Validation** : Colonne existe, valeur par défaut OK

### Étape 2 — Correction routage (1 ligne de code)

- Modifier `toInputContext` : `(ct === "reception" || ct === "order") ? "reception" : "internal"`
- **Validation** : Commande B2B ouvre le modal avec l'unité réception

### Étape 3 — Auto-config import B2B (SQL)

- Étendre `fn_import_b2b_product_atomic` pour auto-créer `product_input_config`
  - `reception_mode` : `integer` (ou `multi_level` si 2+ niveaux)
  - `reception_preferred_unit_id` : `packagingLevels[0].type_unit_id` remappé
  - `internal_preferred_unit_id` : `stock_handling_unit_id` local
- Copier `allow_unit_sale` depuis le produit source
- **Validation** : Import B2B → modal non bloqué

### Étape 4 — Wizard alignement (UI)

- Auto-dériver `reception_preferred_unit_id` = `packagingLevels[0].type_unit_id`
- Toggle ON + 2+ niveaux → `multi_level` avec chain des 2 premiers niveaux
- Toggle ON + 1 niveau → `integer` forcé (garde anti-chain=1)
- Override manuel toujours possible
- **Validation** : Création produit → config réception auto-remplie

### Étape 5 — Nettoyage UI (optionnel V1)

- Rendre le champ réception read-only quand conditionnement présent
- Exposer le toggle `allow_unit_sale` dans wizard et fiche produit
- NE PAS supprimer les colonnes DB `reception_*`
- **Validation** : Config réception automatiquement cohérente

---

## 11. TESTS DE VALIDATION MINIMUM

### Test 1 — Produit neuf wizard → réception

1. Créer produit avec 2 niveaux (carton → pièce) via wizard
2. Ouvrir réception manuelle
3. ✅ Le modal propose carton + pièce, conversion correcte

### Test 2 — Commande B2B (après étape 2)

1. Importer un produit B2B (après étape 3)
2. Créer une commande côté client
3. ✅ Le modal utilise l'unité fournisseur, pas l'unité interne
4. Côté fournisseur : préparer la commande
5. ✅ Même unité fournisseur

### Test 3 — Import B2B → modal non bloqué (après étape 3)

1. Importer un produit B2B
2. Ouvrir immédiatement un modal de réception
3. ✅ PAS de message "Produit non configuré"

---

## 12. CE QUI NE CHANGE PAS

- Le résolveur `resolveInputUnitForContext` reste inchangé structurellement
- Le format de `product_input_config` reste identique (mêmes colonnes)
- Le ledger stock continue en unité canonique
- Le moteur BFS reste le même
- Le wizard V3 garde sa structure en 5 étapes
- Aucun fallback legacy, aucune migration de données existantes

---

## 13. AUDIT FINAL — VERROUILLAGE AVANT IMPLÉMENTATION (DERNIER PASS)

> Vérification code croisée — 8 points — produits neufs uniquement

---

### 13.1 DÉPENDANCE RÉELLE AU MODE — Peut-on le dériver entièrement ?

**Réponse : NON — le mode ne peut PAS être entièrement dérivé de `allow_unit_sale` + nombre de niveaux.**

**Preuve code** — `resolveInputUnitForContext.ts` ligne 167-169 :
```typescript
const preferredMode = context === "reception"
  ? config.reception_mode
  : config.internal_mode;
```

Le résolveur lit le mode depuis la config, puis l'applique tel quel (ligne 285 : `const resolvedMode: InputMode = preferredMode`).

**Modes existants** : `continuous`, `decimal`, `integer`, `fraction`, `multi_level`

**Analyse par mode** :

| Mode | Dérivable de `allow_unit_sale` + niveaux ? | Pourquoi |
|------|--------------------------------------------|----------|
| `integer` | ✅ OUI — toggle OFF ou 1 seul niveau | Cas par défaut pour unité discrète |
| `multi_level` | ✅ OUI — toggle ON + 2+ niveaux | Directement lié au toggle |
| `continuous` | ❌ NON | Choix utilisateur (stepper +/- sur poids) |
| `decimal` | ❌ NON | Choix utilisateur (saisie libre sur poids) |
| `fraction` | ❌ NON | Choix utilisateur (jetons ¼, ½, 1) |

**Conclusion** : Pour les **produits à unité discrète** (pièce, carton, boîte), le mode réception est dérivable :
- Toggle OFF → `integer`
- Toggle ON + 2+ niveaux → `multi_level`
- Toggle ON + 1 niveau → `integer` (garde)

Pour les **produits à unité continue** (kg, L), le mode n'est PAS dérivable car l'utilisateur choisit entre `continuous` (stepper) et `decimal` (saisie libre). Ce choix est une **préférence d'interface**, pas une propriété physique.

**Verdict** : `product_input_config.reception_mode` **reste nécessaire**. On ne peut pas le supprimer. La stratégie V1 auto-génère le mode à la création/import, mais le champ persiste.

> **"Peut-on supprimer complètement la notion de mode côté réception ?"**
> **NON.** Le mode `continuous` vs `decimal` est un choix UX non dérivable. Le champ `reception_mode` dans `product_input_config` reste indispensable.

---

### 13.2 GUARDS DU RÉSOLVEUR — Preuve que tout passe pour wizard + import

**Chemins du résolveur analysés ligne par ligne** (source : `resolveInputUnitForContext.ts` lignes 128-310) :

| Garde | Condition de blocage | Produit wizard neuf | Produit importé B2B (après étape 3) |
|-------|---------------------|---------------------|-------------------------------------|
| Ligne 154 : `!config` | Config absente → `not_configured` | ✅ PASSE — wizard crée la config à l'étape 4 | ✅ PASSE — import auto-crée la config (étape 3) |
| Ligne 175 : `preferredMode === "multi_level"` | Entre dans branche multi_level | ✅ PASSE — si multi_level, chain est générée par wizard | ✅ PASSE — si multi_level, chain auto-générée par import |
| Ligne 181 : `!unitChain \|\| unitChain.length < 2` | Chain invalide → `needs_review` | ✅ PASSE — wizard impose chain ≥ 2 pour multi_level | ✅ PASSE — import génère chain de 2 niveaux |
| Ligne 194 : `Set(unitChain).size !== unitChain.length` | Doublons → `needs_review` | ✅ PASSE — niveaux de packaging ont des unités distinctes | ✅ PASSE — idem |
| Ligne 207 : `unreachable.length > 0` | Unité non atteignable → `needs_review` | ✅ PASSE — les unités du packaging sont dans le graphe BFS | ✅ PASSE — le remappage UUID garantit l'atteignabilité |
| Ligne 249 : `!preferredMode \|\| !preferredUnitId` | Mode ou unité manquant → `not_configured` | ✅ PASSE — wizard impose les deux | ✅ PASSE — import remplit les deux |
| Ligne 262 : `!reachableIds.has(preferredUnitId)` | Unité non atteignable → `needs_review` | ✅ PASSE — l'unité préférée vient du graphe BFS | ✅ PASSE — l'unité remappée est dans le graphe local |

**Verdict** : ✅ **Tous les guards passent** pour un produit neuf wizard ET un produit importé B2B (après implémentation de l'étape 3). Aucun chemin ne retourne `needs_review` ou `not_configured`.

**Condition** : L'étape 3 (auto-config import B2B) doit générer :
- `reception_preferred_unit_id` = UUID atteignable via BFS
- `reception_mode` = `integer` ou `multi_level` (avec chain ≥ 2)
- `reception_unit_chain` = array de ≥ 2 UUID atteignables si `multi_level`

---

### 13.3 EDGE CASE — PACKAGING AVEC SAUT DE NIVEAU

**Exemple** : Carton → Pièce (pas de boîte intermédiaire)

**Analyse BFS** : Le graphe BFS crée une arête directe Carton → Pièce via `containsQuantity`. Le saut de niveau n'est PAS un problème car le BFS ne s'appuie pas sur une hiérarchie ordonnée — il crée des arêtes entre chaque `type_unit_id` et son `contains_unit_id`.

**multi_level avec niveaux non continus** :
- Chain = `["uuid-carton", "uuid-piece"]` → 2 entrées → ✅ garde `length < 2` passe
- Les deux sont atteignables (arête BFS directe) → ✅ garde `unreachable` passe
- Pas de doublons → ✅ garde `duplicates` passe

**Verdict** : ✅ Le multi_level fonctionne correctement avec des niveaux non continus. Le BFS est basé sur les arêtes du graphe, pas sur l'indexation des niveaux.

---

### 13.4 CAS RÉEL — UNITÉ INTERNE = UNITÉ FOURNISSEUR

**Exemple** : Produit "Citron" — `packagingLevels = []` ou trivial, unité = pièce partout.

**Analyse** :
- `reception_preferred_unit_id` = pièce (UUID)
- `internal_preferred_unit_id` = pièce (UUID)
- `reception_mode` = `integer`
- `internal_mode` = `integer`

**Risques vérifiés** :
- ❌ Conflit de mode : Impossible — les deux sont `integer` sur la même unité
- ❌ Double affichage : Le modal affiche l'unité une seule fois — il lit `preferredUnitId` qui est identique dans les deux contextes
- ❌ Passage inutile en `multi_level` : Le toggle `allow_unit_sale` est OFF par défaut → mode `integer`. Même si ON, 0 ou 1 niveau de packaging → garde force `integer`

**Verdict** : ✅ Aucun problème. Le cas trivial est le plus simple — tout converge vers `integer` + `pièce`.

---

### 13.5 IMPACT SUR LES CALCULS DE QUANTITÉ

**Question** : Un endroit dans le code suppose-t-il que la saisie vient du contexte `"internal"` ?

**Recherche code exhaustive** : Aucune référence à `"internal"` ou `"reception"` dans le code **en aval** du modal. Le modal retourne un objet `{ canonicalQuantity, canonicalUnitId }` qui est **context-agnostic**. Le code appelant ne sait pas quel contexte a produit la quantité.

**Vérifications spécifiques** :

| Aspect | Code vérifié | Dépend du contexte ? |
|--------|-------------|---------------------|
| **Pricing** | `unit_price_snapshot` dans `commande_lines` | ❌ NON — prix snapshot figé à la commande |
| **Validation de quantité** | Aucun `min_quantity` / `min_order` trouvé dans le code | ❌ N/A — n'existe pas |
| **Arrondis** | Gérés dans le modal via `steps` / `defaultStep` | ❌ NON — dépend du mode, pas du contexte |
| **Stock ledger** | `delta_quantity_canonical` dans `stock_document_lines` | ❌ NON — reçoit la quantité canonique finale |
| **BL (bons de livraison)** | `quantity_canonical` dans `bl_app_lines` | ❌ NON — quantité canonique brute |

**Verdict** : ✅ **Aucune logique métier en aval ne dépend du contexte de saisie.** Le modal retourne une quantité canonique opaque. Changer le contexte de `"internal"` à `"reception"` ne casse rien en aval.

---

### 13.6 PRÉPARATION FOURNISSEUR — SOURCE PRODUIT

**Code vérifié** — `PreparationDialog.tsx` lignes 172-217 :

```typescript
// Step 1: Find the supplier's own product via b2b mapping
const { data: importMapping } = await supabase
  .from("b2b_imported_products")
  .select("source_product_id, unit_mapping")
  .eq("local_product_id", line.product_id)
  .eq("source_establishment_id", commande.supplier_establishment_id)

// Step 2: Fetch the supplier's OWN product
const { data: product } = await supabase
  .from("products_v2")
  .select("id, nom_produit, stock_handling_unit_id, ...")
  .eq("id", importMapping.source_product_id)
```

**Analyse** :
1. La commande contient le `product_id` du **client** (produit importé)
2. Le `PreparationDialog` remonte via `b2b_imported_products` pour trouver le `source_product_id` (produit du **fournisseur**)
3. Il fetch le produit **fournisseur** depuis `products_v2`
4. Le `QuantityModalWithResolver` reçoit le produit **fournisseur** → utilise le packaging **fournisseur**

**Verdict** : ✅ **Confirmé — le fournisseur utilise bien son propre produit**, pas le produit importé du client. Le routage `"order"` → `"reception"` est donc correct des deux côtés.

---

### 13.7 CONSISTANCE AVEC FUTUR MODULE CONSOMMATION

**Recherche code** : Aucune dépendance dans les modules `commandes`, `stockLedger`, `bl_app` qui suppose que `l'unité saisie = unité interne`.

**Preuve** : Le modal retourne `canonicalQuantity` + `canonicalUnitId`. Ces valeurs sont injectées directement dans :
- `commande_lines.canonical_quantity` + `canonical_unit_id`
- `stock_document_lines.delta_quantity_canonical` + `canonical_unit_id`
- `bl_app_lines.quantity_canonical` + `canonical_unit_id`

Aucun de ces champs ne stocke le contexte d'origine. La quantité est **canonique et context-agnostic**.

**Verdict** : ✅ Le futur module consommation pourra lire les quantités canoniques sans ambiguïté, quel que soit le contexte de saisie d'origine.

---

### 13.8 QUESTION FINALE — VALIDATION ABSOLUE

> **"Peut-on déployer cette stratégie sans bug fonctionnel, incohérence d'unité, blocage modal, divergence client/fournisseur ?"**

**Réponse : OUI**, sous réserve stricte des 5 étapes du plan.

**Détail par risque** :

| Risque | Statut |
|--------|--------|
| Bug fonctionnel | ✅ Aucun — tous les guards du résolveur passent pour wizard + import |
| Incohérence d'unité | ✅ Aucune — le modal retourne du canonique, le contexte est transparent pour l'aval |
| Blocage modal | ✅ Aucun — la config est auto-générée (wizard existant + import étape 3) |
| Divergence client/fournisseur | ✅ Aucune — `PreparationDialog` utilise le produit fournisseur, le client utilise le packaging remappé |

**Seul pré-requis non négociable** : L'étape 3 (auto-config import B2B) doit être implémentée AVANT de déployer l'étape 2 (correction routage), sinon les produits B2B existants importés sans config seront bloqués.

**Ordre de déploiement recommandé** : Étape 1 → Étape 3 → Étape 2 → Étape 4 → Étape 5

> ⚠️ **Correction d'ordre vs plan initial** : L'étape 3 (auto-config import) devrait passer AVANT l'étape 2 (routage) pour éviter de casser les produits importés existants qui n'ont pas de config réception. Alternative : déployer 2 et 3 ensemble atomiquement.
