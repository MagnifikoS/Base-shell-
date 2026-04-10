# Audit Unité Retrait

> Document d'audit d'implémentation — préparation uniquement, aucun code produit.

---

## 1. Résumé exécutif

**La stratégie est faisable proprement et de manière isolée.**

L'implémentation de "unité retrait" et "pas retrait" peut être réalisée avec :
- **2 colonnes ajoutées** sur `products_v2` (migration simple)
- **1 nouveau composant popup** dédié au Retrait (isolé, ne remplace PAS le modal BFS global)
- **1 popup de configuration** dans le tableau produit (inline, pas de refonte wizard)
- **Zéro modification** sur le moteur BFS, le wizard, les modules réception/inventaire/commandes

### Points de vigilance principaux
1. La conversion unité retrait → quantité canonique doit réutiliser le moteur BFS existant en arrière-plan (pas de nouveau moteur)
2. Le fallback pour les produits non configurés doit être transparent (→ `stock_handling_unit_id`)
3. Les "pas retrait" doivent être stockés de façon simple (JSONB array de nombres)

---

## 2. Cartographie de l'existant

### 2.1 Modal global BFS — où il est utilisé

| Module | Composant | Impact |
|--------|-----------|--------|
| Réception | `ReceptionDialog.tsx`, `CompositePreparationDialog.tsx` | ❌ NE PAS TOUCHER |
| Retrait (actuel) | `MobileWithdrawalView.tsx` → via `ReceptionQuantityModal` (alias) | ✅ À REMPLACER localement |
| Inventaire | `CountingModal` via `UniversalQuantityModal` | ❌ NE PAS TOUCHER |
| Commandes | `NouvelleCommandeDialog.tsx`, `PreparationDialog.tsx` | ❌ NE PAS TOUCHER |
| Correction BL | `BlAppCorrectionDialog.tsx`, `BlRetraitCorrectionDialog.tsx` | ❌ NE PAS TOUCHER |

**Fichier source SSOT du modal** : `src/components/stock/UniversalQuantityModal.tsx` (741 lignes)

### 2.2 Flow Retrait actuel

```
MobileWithdrawalView.tsx (793 lignes)
├── Chargement produits via Supabase (products_v2)
├── Recherche fuzzy + affichage alphabétique
├── Tap produit → setModalProduct(product)
├── ReceptionQuantityModal (= alias UniversalQuantityModal)
│   ├── Résolution BFS complète (toutes unités)
│   ├── Affichage stock actuel + stock après
│   ├── Plusieurs champs de saisie multi-unités
│   └── Conversion canonique
├── handleModalConfirm → buildCanonicalLine → addLine
└── POST via usePostDocument
```

**Point d'entrée pour le remplacement** : lignes 252-256 (`handleProductTap`) et le rendu du modal (fin du fichier).

### 2.3 Tableau produit — point d'adaptation

- **Fichier** : `src/modules/produitsV2/components/ProductsV2Table.tsx` (399 lignes)
- **Colonne actuelle** : "Unité inventaire" (affiche `stock_handling_unit_name`)
- **Service** : `src/modules/produitsV2/services/productsV2Service.ts`
- **Types** : `src/modules/produitsV2/types.ts` (`ProductV2ListItem`)

### 2.4 Colonnes existantes sur `products_v2` (pertinentes)

| Colonne | Rôle | Impact |
|---------|------|--------|
| `stock_handling_unit_id` | Unité manipulation stock (inventaire) | Fallback pour unité retrait |
| `final_unit_id` | Unité interne de référence | Target de conversion |
| `delivery_unit_id` | Unité de livraison | Non concerné |
| `supplier_billing_unit_id` | Unité facturation fournisseur | Non concerné |
| `kitchen_unit_id` | Unité cuisine | Non concerné |
| `conditionnement_config` | Config packaging JSONB | Source des unités compatibles |

---

## 3. Stratégie d'implémentation recommandée

### 3.1 Stockage — unité retrait

**Recommandation : nouvelle colonne `withdrawal_unit_id` sur `products_v2`**

```sql
ALTER TABLE products_v2
ADD COLUMN withdrawal_unit_id UUID REFERENCES measurement_units(id) DEFAULT NULL;
```

**Justification :**
- Suit le pattern existant (`stock_handling_unit_id`, `kitchen_unit_id`, `delivery_unit_id`)
- FK vers `measurement_units` = même SSOT que toutes les autres unités
- `NULL` = pas encore configuré → fallback sur `stock_handling_unit_id`
- Aucune table supplémentaire nécessaire
- Pas de duplication de données

### 3.2 Stockage — pas retrait

**Recommandation : nouvelle colonne JSONB `withdrawal_steps` sur `products_v2`**

```sql
ALTER TABLE products_v2
ADD COLUMN withdrawal_steps JSONB DEFAULT NULL;
```

**Format :**
```json
[0.25, 0.5, 1]
```

Un simple tableau de nombres décimaux. Pas d'objet complexe.

**Justification :**
- Pas besoin d'une table séparée (relation 1:1 avec le produit)
- JSONB est déjà utilisé sur products_v2 (`conditionnement_config`)
- Format ultra-simple : array de numbers
- `NULL` = pas de chips configurés → fallback sur pas par défaut (ex: `[1]`)
- Pas de FK à gérer, pas de migration complexe

**Alternative rejetée : table séparée `product_withdrawal_config`**
- Over-engineering pour 2 champs
- Ajoute une jointure inutile
- Le pattern existant (colonnes sur products_v2) est le standard du projet

### 3.3 Configuration dans le tableau produit

**Implémentation recommandée :**

1. **Colonne dans `ProductsV2Table`** : Remplacer "Unité inventaire" par "Unité retrait"
2. **Au clic sur la cellule** : Ouvrir un **petit popup/popover** (pas un dialog plein écran)
3. **Contenu du popup** :
   - Dropdown avec les unités compatibles du produit (issues du graphe BFS existant via `resolveProductUnitContext`)
   - Checkbox/chips pour sélectionner les pas retrait parmi des valeurs prédéfinies
   - Bouton "Valider"
4. **Sauvegarde** : `UPDATE products_v2 SET withdrawal_unit_id = ?, withdrawal_steps = ? WHERE id = ?`

**Fichiers à créer :**
- `src/modules/produitsV2/components/WithdrawalUnitPopover.tsx` — popup de config
- Modification de `ProductsV2Table.tsx` — colonne cliquable

**Fichiers NON modifiés :**
- Wizard de création produit
- Fiche détail produit (sauf si souhaité plus tard)

### 3.4 Nouveau popup retrait dédié

**Implémentation recommandée :**

Créer un composant **complètement séparé** du modal BFS :

```
src/modules/stockLedger/components/WithdrawalQuantityPopup.tsx
```

**Ce popup affiche :**
- Nom du produit
- Champ quantité entier (+ / −)
- Chips des pas retrait configurés (ex: 1/4, 1/2, 1)
- Unité retrait affichée en label
- Bouton "Ajouter au retrait"

**Ce popup NE affiche PAS :**
- Stock actuel
- Conversions
- Unités secondaires
- Choix d'unités alternatives

**Branchement dans `MobileWithdrawalView.tsx` :**

```tsx
// AVANT (actuel)
<ReceptionQuantityModal ... />

// APRÈS
<WithdrawalQuantityPopup
  product={modalProduct}
  withdrawalUnitId={modalProduct.withdrawal_unit_id ?? modalProduct.stock_handling_unit_id}
  withdrawalSteps={modalProduct.withdrawal_steps ?? [1]}
  onConfirm={handleWithdrawalConfirm}
  onClose={() => setModalProduct(null)}
/>
```

**Conversion canonique en arrière-plan :**

Le popup produit une quantité dans l'unité retrait. Ensuite, on réutilise le moteur existant pour convertir :

```typescript
// Pseudo-code — réutilisation du moteur existant
const factor = convertUnitsDB(withdrawalUnitId, canonicalUnitId, dbConversions, dbUnits);
const canonicalQuantity = userQuantity * factor;
```

Puis on appelle `handleModalConfirm` avec les mêmes paramètres qu'aujourd'hui (`canonicalQuantity`, `canonicalUnitId`, etc.).

**Aucun nouveau moteur de conversion. Aucune modification du moteur BFS.**

---

## 4. Analyse de non-régression

### 4.1 Modal BFS global

| Vérification | Statut |
|-------------|--------|
| `UniversalQuantityModal.tsx` modifié ? | ❌ NON — aucune modification |
| `resolveProductUnitContext.ts` modifié ? | ❌ NON — aucune modification |
| `conversionEngine.ts` modifié ? | ❌ NON — lecture seule |
| Nouveau composant isolé ? | ✅ OUI — `WithdrawalQuantityPopup.tsx` |

### 4.2 Modules non impactés

| Module | Utilise le modal BFS ? | Impacté ? |
|--------|----------------------|-----------|
| Réception | Oui | ❌ NON |
| Inventaire | Oui | ❌ NON |
| Commandes | Oui | ❌ NON |
| Correction BL | Oui | ❌ NON |
| Correction BL Retrait | Oui | ❌ NON |

### 4.3 Chemin canonique backend

Le chemin de données reste identique :

```
Popup retrait → quantité + unité retrait
  → conversion via convertUnitsDB (moteur existant, lecture seule)
  → canonicalQuantity + canonicalUnitId
  → buildCanonicalLine (existant, inchangé)
  → addLine → stock_document_lines (même format)
  → fn_post_stock_document (même RPC)
```

**Zéro changement backend. Zéro nouvelle route. Zéro nouveau RPC.**

---

## 5. Cas limites

### Cas 1 : Produit retiré par unité entière (pièce, bouteille)

- **Unité retrait** : `pièce` ou `bouteille`
- **Pas retrait** : `[1, 2, 3]`
- **Comportement** : Chips `1 | 2 | 3`, boutons `+/-` par incrément de 1
- **Risque** : Aucun — cas le plus simple

### Cas 2 : Produit retiré par fractions (boîte, kg, bidon)

- **Unité retrait** : `boîte` / `kg` / `bidon`
- **Pas retrait** : `[0.25, 0.5, 1]`
- **Comportement** : Chips `1/4 | 1/2 | 1`, le salarié compose (ex: 2 + 1/2 = 2.5)
- **Affichage** : Les fractions sont affichées en notation humaine (`1/4`, `1/2`, pas `0.25`)
- **Risque** : Faible — nécessite un mapping d'affichage fraction → décimal

### Cas 3 : Produit sans unité retrait configurée

- **Fallback** : `stock_handling_unit_id` (unité inventaire)
- **Pas retrait fallback** : `[1]` (entier uniquement)
- **Comportement** : Le popup retrait fonctionne quand même, juste avec l'unité par défaut
- **Risque** : Aucun — transparent pour l'utilisateur

### Cas 4 : Produit avec plusieurs pas retrait

- **Exemple** : kg avec pas `[0.25, 0.5, 1, 2, 5]`
- **Comportement** : Chips affichés en ligne, le salarié tape sur un chip pour ajouter
- **Risque** : UX si trop de chips → recommandation : **max 5 pas** par produit (validation côté popup config)

### Cas 5 : Unité retrait ≠ unité inventaire

- **Exemple** : Inventaire en `kg`, retrait en `boîte` (1 boîte = 0.5 kg)
- **Comportement** : Le popup affiche `boîte`, la conversion se fait en arrière-plan via `convertUnitsDB`
- **Pré-requis** : La conversion `boîte → kg` doit exister dans `unit_conversions` ou le graphe BFS du produit
- **Risque** : Moyen — si la conversion n'existe pas, `convertUnitsDB` retourne `null`
- **Mitigation** : Vérifier à la configuration (popup tableau) que l'unité choisie est bien dans le graphe BFS du produit. Si pas convertible → bloquer le choix.

### Cas 6 : Produit à haute fréquence de retrait (vitesse critique)

- **Objectif** : < 3 taps pour un retrait standard
- **Flow optimisé** : Tap produit → Tap chip "1" → Tap "Ajouter" = **3 taps**
- **Encore mieux si pas = 1 et unité entière** : Tap produit → auto-1 → Tap "Ajouter" = **2 taps**
- **Risque** : Aucun — le popup dédié est plus rapide que le modal BFS actuel par conception

---

## 6. Fallback MVP recommandé

### Recommandation : fallback transparent sur `stock_handling_unit_id`

```
SI withdrawal_unit_id IS NOT NULL → utiliser withdrawal_unit_id
SINON → utiliser stock_handling_unit_id
SINON → utiliser final_unit_id (dernier recours)
```

```
SI withdrawal_steps IS NOT NULL → utiliser withdrawal_steps
SINON → [1] (pas unitaire par défaut)
```

**Pas de blocage. Pas de message d'erreur. Le popup retrait fonctionne toujours.**

Les produits non configurés se comportent exactement comme aujourd'hui mais avec le nouveau popup simplifié.

---

## 7. Risques identifiés

### R1 — Conversion manquante entre unité retrait et unité canonique

| | |
|---|---|
| **Gravité** | Moyenne |
| **Preuve** | Si un admin choisit une unité retrait qui n'est pas dans le graphe BFS du produit, `convertUnitsDB` retourne `null` |
| **Impact** | Le retrait ne peut pas produire de quantité canonique → erreur silencieuse ou crash |
| **Mitigation** | Dans le popup de configuration (tableau produit), ne proposer QUE les unités atteignables via `resolveProductUnitContext.allowedInventoryEntryUnits`. Cela garantit que toute unité sélectionnée est convertible. |

### R2 — Incohérence si conditionnement modifié après configuration retrait

| | |
|---|---|
| **Gravité** | Faible |
| **Preuve** | Si on change le conditionnement d'un produit (wizard), l'unité retrait configurée peut devenir orpheline |
| **Impact** | L'unité retrait pointe vers une unité qui n'est plus dans le graphe BFS |
| **Mitigation** | Au moment de l'ouverture du popup retrait, vérifier que `withdrawal_unit_id` est encore dans le graphe BFS. Sinon, fallback silencieux sur `stock_handling_unit_id`. |

### R3 — Valeurs de pas retrait invalides

| | |
|---|---|
| **Gravité** | Faible |
| **Preuve** | Un admin pourrait saisir des pas négatifs ou nuls |
| **Impact** | Comportement incohérent dans le popup |
| **Mitigation** | Validation simple côté popup config : `pas > 0`, `max 5 pas`, `pas ≤ 100` |

### R4 — Migration DB simple mais nécessite regen types

| | |
|---|---|
| **Gravité** | Nulle |
| **Preuve** | Ajout de 2 colonnes nullable → migration non destructive |
| **Impact** | `types.ts` auto-généré doit être mis à jour après migration |
| **Mitigation** | Standard — la regen types est automatique dans Lovable Cloud |

---

## 8. Verdict

### ✅ Faisable de manière isolée

L'implémentation de "unité retrait" et "pas retrait" est :

- **Faisable** avec un impact minimal sur le codebase existant
- **Isolée** — aucun module existant n'est modifié sauf le tableau produit (1 colonne) et `MobileWithdrawalView` (remplacement du modal)
- **Simple** — 2 colonnes DB + 2 nouveaux composants React
- **Sans nouvelle source de vérité** — réutilisation du moteur BFS existant en lecture seule
- **Sans casse** — le modal BFS global reste intact, les autres modules ne sont pas touchés

### Estimation d'impact

| Élément | Fichiers touchés |
|---------|-----------------|
| Migration DB | 1 fichier SQL (2 colonnes) |
| Nouveau composant popup retrait | 1 fichier (`WithdrawalQuantityPopup.tsx`) |
| Nouveau composant config | 1 fichier (`WithdrawalUnitPopover.tsx`) |
| Modification MobileWithdrawalView | 1 fichier (remplacement du modal) |
| Modification ProductsV2Table | 1 fichier (colonne cliquable) |
| Modification types/service produit | 2 fichiers (ajout champs) |
| **Total** | **~7 fichiers** |

### Réponse à la question finale

> **Comment implémenter "unité retrait" et "pas retrait" de façon simple, isolée, intuitive, sans créer de nouvelle source de vérité ni casser les flows existants ?**

**Réponse :** Ajouter 2 colonnes nullable sur `products_v2` (`withdrawal_unit_id` FK + `withdrawal_steps` JSONB), configurer via un popover inline dans le tableau produit (unités filtrées par le graphe BFS existant), et remplacer **uniquement dans `MobileWithdrawalView`** le modal BFS par un popup retrait dédié ultra-simplifié qui produit en sortie les mêmes paramètres canoniques attendus par `buildCanonicalLine`. Fallback transparent sur `stock_handling_unit_id` pour les produits non configurés.
