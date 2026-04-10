# AUDIT COMPLÉMENTAIRE FINAL (DERNIER NIVEAU) + PLAN D'IMPLÉMENTATION PAR ÉTAPES

> Audit croisé code réel — Produits neufs — Zéro legacy — Zéro fallback

---

## PARTIE A — AUDIT DES 8 POINTS

---

### 1. SUPPRESSION LOGIQUE DE `product_input_config` (PARTIE RÉCEPTION)

**Réponse directe : NON, on ne peut PAS supprimer la dépendance à `product_input_config` pour les modals réception en V1.**

**Preuve code** — `resolveInputUnitForContext.ts` ligne 153-164 :
```typescript
if (!config) {
  return { status: "not_configured", reason: "..." };
}
```
Ce garde bloque **AVANT** toute dérivation. Même si on ajoute une dérivation dynamique de l'unité fournisseur, le résolveur refuse de fonctionner sans `config`.

**Pourquoi c'est structurellement nécessaire** : Le résolveur ne choisit pas seulement l'unité — il choisit aussi le **mode** (`integer`, `continuous`, `multi_level`, `fraction`, `decimal`). Le mode n'est pas dérivable du conditionnement. Il dépend des préférences de l'utilisateur.

**Conclusion** : `product_input_config.reception_*` doit rester. La stratégie cible est de **dériver l'unité fournisseur** dynamiquement du packaging et de l'**injecter** dans la config (auto-configuration), pas de supprimer la config.

⚠️ **Correction de la stratégie** : On ne supprime pas `product_input_config.reception_*`. On change sa **source de vérité pour l'unité** : au lieu que l'utilisateur la choisisse manuellement, elle sera dérivée automatiquement du packaging.

---

### 2. WIZARD — VALIDATION BLOQUANTE CACHÉE

**Code vérifié** — `ProductFormV3Modal.tsx` ligne 697 :
```typescript
if (wizard.state.inputConfigReceptionMode && wizard.state.inputConfigInternalMode) {
  // save config
}
```

C'est un `if`, pas un garde bloquant. Si `inputConfigReceptionMode` est `null`, la config n'est simplement **pas sauvegardée**. Le produit est créé quand même.

**Le wizard ne bloque PAS la création si la config réception est absente.**

Cependant : sans config sauvegardée → le produit sera bloqué dans tous les modals (`not_configured`).

**Conditions de blocage wizard réelles** :
1. `productName` vide → toast erreur (ligne 636)
2. `identitySupplierId` absent → toast erreur (ligne 646)
3. C'est tout. Pas de validation stricte sur la config input.

**Réponse** : Oui, on peut créer un produit sans `reception_*`, mais il sera inutilisable dans les modals jusqu'à configuration.

**Comportement wizard actuel pour la config** : `WizardStep5Stock.tsx` (étape 4) pré-sélectionne automatiquement les choix pour les produits mono-unité (auto-config) et oblige un choix manuel pour les multi-unités. Si l'utilisateur ne fait pas de choix → la config n'est pas sauvegardée → produit créé mais bloqué.

---

### 3. IMPORT B2B — DÉPENDANCE RÉELLE AU CONFIG

**Réponse directe : OUI, on a toujours besoin de `product_input_config` même avec la dérivation dynamique.**

**Raison** : Le résolveur central (`resolveInputUnitForContext`) a un garde dur `if (!config) → BLOCKED`. Ce garde n'est pas contournable sans modifier le résolveur.

**Options** :
- **Option A** : Modifier le résolveur pour accepter `config === null` et dériver dynamiquement → risque de casse sur les 13 modals existants
- **Option B** : Auto-créer la config dans le pipeline d'import → **safe**, cohérent avec l'architecture

**Recommandation** : Option B. L'import B2B doit créer une `product_input_config` automatiquement, initialisée sur l'unité fournisseur (packaging niveau 0).

---

### 4. CAS FACTURATION ≠ CONDITIONNEMENT

**Vérification code** :

`supplier_billing_unit_id` est utilisé dans les modals de commandes uniquement comme **champ passif** pour construire le `QuantityProduct` (objet passé au résolveur). Il n'influence **jamais** directement le choix d'unité dans un modal.

**Fichiers vérifiés** :
- `NouvelleCommandeDialog.tsx` : `supplier_billing_unit_id` est passé dans l'objet `QuantityProduct` → transmis au BFS engine
- `PreparationDialog.tsx` : idem
- `CommandeDetailDialog.tsx` : idem
- `ReceptionDialog.tsx` : idem

Le BFS engine utilise `supplier_billing_unit_id` comme **seed unit** pour le graphe, ce qui rend cette unité **atteignable** dans le graphe. Mais le choix d'unité affichée dans le modal dépend de `config.reception_preferred_unit_id`.

**Réponse** : Aucun modal n'utilise `supplier_billing_unit_id` directement pour déterminer l'unité de saisie. C'est le config qui décide.

**Implication** : Si `supplier_billing_unit_id = kg` et `packagingLevels[0].type_unit_id = carton`, le modal proposera l'unité configurée dans `reception_preferred_unit_id` — qui devra être `carton` (dérivée du packaging) dans la stratégie cible.

---

### 5. COHÉRENCE AVEC FUTUR MODULE CONSOMMATION

**Analyse** :
- Commande B2B = unité fournisseur (packaging) → ex: cartons
- Consommation (futur) = basée sur unité de facturation ou unité canonique → ex: kg

**Ces deux logiques divergent-elles ?** OUI, et c'est **voulu**.

Le stock ledger fonctionne en **unité canonique** (`stock_handling_unit_id`). Toute quantité saisie en cartons est convertie en canonique via BFS avant écriture.

Donc : commander 2 cartons (= 24 pièces) et consommer en kg sont cohérents tant que le BFS a un chemin pièce → kg (via l'équivalence).

**Risque** : Si un produit n'a pas d'équivalence pièce↔poids, on ne peut pas consommer en kg ce qui a été commandé en cartons. Mais ce n'est pas un bug de la stratégie — c'est un produit mal configuré.

**Verdict** : Pas d'incohérence structurelle. Le ledger canonique assure la cohérence.

---

### 6. MOBILE VS DESKTOP — COMPORTEMENT IDENTIQUE ?

**Vérification code** :

| Flow | Desktop | Mobile | Identique ? |
|------|---------|--------|-------------|
| Réception | `QuantityModalWithResolver` + `contextType="reception"` → `toInputContext → "reception"` | `resolveInputUnitForContext(product, "reception", ...)` direct | ✅ Même contexte, même résolveur |
| Retrait | `QuantityModalWithResolver` + `contextType="withdrawal"` → `toInputContext → "internal"` | `resolveInputUnitForContext(product, "internal", ...)` direct | ✅ Même contexte |
| Inventaire | `QuantityModalWithResolver` + `contextType="inventory"` → `toInputContext → "internal"` | `useCountingModal` → `resolveInputUnitForContext(product, "internal", ...)` | ✅ Même contexte |

**multi_level** : les deux chemins gèrent le cas `resolved.mode === "multi_level"` avec construction identique du `stepperConfig`.

**toggle** : le toggle `allow_unit_sale` n'est pas encore implémenté. Quand il le sera, il devra être propagé aux deux chemins.

**Verdict** : ✅ Comportement identique garanti — même résolveur, même contexte.

---

### 7. EDGE CASE — PRODUIT AVEC 1 SEUL NIVEAU

**Scénario** : Produit avec `packagingLevels = [{ type: "Carton", type_unit_id: "uuid-carton", containsQuantity: 6, contains_unit_id: "uuid-piece" }]`

**Toggle OFF** : Unité fournisseur = carton. Mode = `integer` (1 seul niveau). → OK

**Toggle ON** : 2 niveaux max = carton + pièce. Mode = `multi_level` avec chain `["uuid-carton", "uuid-piece"]`.

**Vérification multi_level avec chain length = 1** :
```typescript
// resolveInputUnitForContext.ts ligne 181
if (!unitChain || unitChain.length < 2) {
  return { status: "needs_review", reason: "..." };
}
```
→ Si le toggle est ON mais qu'il n'y a qu'1 niveau → la chain aurait length 1 → **BLOQUÉ** `needs_review`.

⚠️ **RISQUE IDENTIFIÉ** : Un produit avec exactement 1 niveau de packaging et toggle ON sera bloqué en `needs_review` car la chain multi_level a besoin de ≥ 2 entrées.

**Mitigation** : Si le produit n'a qu'un seul niveau de packaging, le toggle ON doit automatiquement fallback en mode `integer` sur l'unité fournisseur (pas de multi_level possible). Cette logique doit être gérée à la **configuration**, pas au runtime.

---

### 8. PHRASE FINALE À VALIDER

> "Un produit neuf peut fonctionner dans TOUS les modals sans product_input_config.reception_*, fallback legacy, configuration manuelle supplémentaire"

**Réponse : NON, cette phrase est FAUSSE.**

Un produit neuf **nécessite** `product_input_config` (reception ET internal) pour fonctionner dans les modals. Le résolveur bloque sans.

**Phrase corrigée** :
> "Un produit neuf peut fonctionner dans TOUS les modals À CONDITION que `product_input_config` soit auto-générée lors de la création (wizard) ou de l'import (B2B), sans intervention manuelle supplémentaire de l'utilisateur."

C'est déjà le cas pour le wizard (auto-config mono-unité). Il manque uniquement l'auto-génération dans le pipeline d'import B2B.

---

## PARTIE B — PLAN D'IMPLÉMENTATION EN ÉTAPES

---

### ÉTAPE 1 — Fondations DB + Toggle (SANS CASSE)

**Objectif** : Ajouter le toggle `allow_unit_sale` et préparer le terrain.

**Actions** :
1. Migration DB : ajouter colonne `allow_unit_sale BOOLEAN DEFAULT false` à `products_v2`
2. Exposer le toggle dans le wizard V3 (Step 5 — UI uniquement, optionnel)
3. Exposer le toggle dans la fiche produit (ProduitsV2 detail)
4. **Aucune modification de logique** — le toggle est un champ passif à ce stade

**Risque** : Zéro. C'est un ajout pur.

**Validation** : Toggle visible et persisté → feu vert pour étape 2.

---

### ÉTAPE 2 — Correction routage `toInputContext` (1 ligne)

**Objectif** : Les commandes et préparations B2B utilisent l'unité fournisseur.

**Actions** :
1. Modifier `toInputContext` dans `QuantityModalWithResolver.tsx` :
   ```typescript
   return (ct === "reception" || ct === "order") ? "reception" : "internal";
   ```
2. Aucun autre fichier modifié

**Risque** : Moyen. Les commandes B2B changeront d'unité affichée (de `internal_preferred` à `reception_preferred`). Si les produits existants ont une config réception correcte → transparent. Sinon → modal bloqué `needs_review`.

**Mitigation** : Tester sur 3 produits B2B existants avant déploiement. Si `reception_preferred_unit_id` est null → le modal sera bloqué → il faut que l'utilisateur configure.

**Validation** : Commande B2B ouvre le modal avec l'unité réception → feu vert pour étape 3.

---

### ÉTAPE 3 — Auto-config import B2B

**Objectif** : Les produits importés B2B sont immédiatement utilisables.

**Actions** :
1. Modifier `fn_import_b2b_product_atomic` (SQL) pour auto-créer une entrée `product_input_config` :
   - `reception_mode` : `integer` (ou `multi_level` si 2+ niveaux)
   - `reception_preferred_unit_id` : `packagingLevels[0].type_unit_id` (remappé via `unit_mapping`)
   - `reception_unit_chain` : les 2 premiers niveaux si multi_level
   - `internal_mode` : copié depuis le produit source ou `integer` par défaut
   - `internal_preferred_unit_id` : `stock_handling_unit_id` local
2. Ajouter `allow_unit_sale` au pipeline d'import (copié depuis le produit source)

**Risque** : Faible. Ajout pur dans la fonction SQL atomique.

**Validation** : Importer un produit B2B → ouvrir un modal → PAS de "Produit non configuré" → feu vert pour étape 4.

---

### ÉTAPE 4 — Dérivation dynamique dans le wizard

**Objectif** : Le wizard V3 auto-dérive l'unité fournisseur du packaging pour la config réception.

**Actions** :
1. Dans `WizardStep5Stock.tsx` : quand le conditionnement est défini, pré-sélectionner automatiquement `reception_preferred_unit_id` = `packagingLevels[0].type_unit_id`
2. Si `allow_unit_sale = true` ET 2+ niveaux : pré-sélectionner `multi_level` avec chain = 2 premiers niveaux
3. Si `allow_unit_sale = true` ET 1 seul niveau : rester en mode `integer` (pas de multi_level avec chain < 2)
4. L'utilisateur peut toujours override manuellement

**Risque** : Faible. C'est un changement de valeurs par défaut dans le wizard, pas de logique métier.

**Validation** : Créer un produit via wizard → la config réception est auto-remplie → feu vert pour étape 5.

---

### ÉTAPE 5 — Nettoyage (OPTIONNEL en V1)

**Objectif** : Retirer la possibilité de modifier manuellement `reception_preferred_unit_id` quand le produit a un conditionnement.

**Actions** :
1. Dans `SingleConfigDialog` et `WizardStep5Stock` : rendre le champ réception read-only / auto-dérivé si conditionnement présent
2. Garder l'override manuel pour les produits sans conditionnement
3. **NE PAS supprimer les colonnes DB** `reception_*` — elles restent comme stockage

**Risque** : Faible. L'utilisateur ne peut plus casser la config réception.

**Validation** : La config réception est automatiquement cohérente avec le packaging.

---

## RÉCAPITULATIF DES RISQUES RÉSIDUELS

| # | Risque | Gravité | Probabilité | Étape | Mitigation |
|---|--------|---------|-------------|-------|------------|
| 1 | Produit 1 niveau + toggle ON → multi_level avec chain=1 → bloqué | 🟡 Moyen | Moyen | Étape 4 | Garde : 1 niveau → mode integer forcé |
| 2 | Import B2B sans config → modal bloqué | 🔴 Critique | 100% | Étape 3 | Auto-création config dans fn_import |
| 3 | Commandes B2B en mauvaise unité | 🔴 Critique | 100% | Étape 2 | Correction toInputContext |
| 4 | staleTime 60s sur inputConfigs | 🟢 Faible | Rare | N/A | Acceptable V1 |
| 5 | Produit sans packaging → dérivation impossible | 🟡 Moyen | Faible | Étape 4 | Garde : pas de packaging → mode simple sur stock_handling_unit |
