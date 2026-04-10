# Module Produit Mutualisé — Stratégie Complète

> **Statut** : Pré-implémentation — Document de référence  
> **Auteur** : Audit croisé GPT × Codebase réelle  
> **Date** : 2026-03-07  
> **Règle n°1** : `rm -rf src/modules/inventaireMutualisation` ne doit RIEN casser.

---

## 1. Le Besoin Métier

Un restaurant achète parfois plusieurs marques d'un même produit générique :
- **Lasagne Rummo** (stock = 4)
- **Lasagne Molisana** (stock = 2)

Dans l'inventaire, le cuisinier veut voir :
> **Lasagne = 6** (dépliable pour voir le détail par marque)

Et les alertes doivent raisonner au niveau du groupe, pas de chaque marque.

---

## 2. Périmètre Strict — Ce Que Le Module Fait / Ne Fait Pas

### ✅ IL AGIT SUR (lecture seule + affichage)
| Cible | Action |
|-------|--------|
| Inventaire Desktop | Affiche les groupes mutualisés avec somme du stock |
| Inventaire Mobile | Idem |
| Alertes Stock | 1 alerte groupe remplace N alertes individuelles |

### ❌ IL NE TOUCHE PAS
| Module | Raison |
|--------|--------|
| `products_v2` (table) | Aucune colonne ajoutée, aucun champ modifié |
| `stock_events` | Le stock reste calculé par produit réel |
| `inventory_lines` / `inventory_sessions` | Aucune modification |
| Commandes / Réceptions | Le fournisseur voit ses vrais produits |
| Factures / VisionAI | Aucun impact |
| DLC / B2B | Aucun impact |
| BL App / BL Retrait | Aucun impact |
| ProduitsV2 Wizard | Aucun impact |

---

## 3. Analyse Croisée : GPT vs Codebase Réelle

### 3.1 — "Même famille canonique" ❌ N'EXISTE PAS

La stratégie GPT mentionne `même famille canonique` comme critère de matching.

**Réalité codebase** : Il n'existe aucune table `product_families` ni aucun champ `family_id` sur `products_v2`. La notion de "famille" existe uniquement sur les `measurement_units` (famille d'unité : poids, volume, pièce) via `canonical_family`.

**Décision** : Ce critère est remplacé par **même `stock_handling_unit_id`** (même unité de stock canonique). C'est la donnée réelle qui garantit que deux produits sont comparables en inventaire.

### 3.2 — "Même catégorie" ✅ EXISTE

`products_v2.category_id` → FK vers `product_categories`. Source de vérité validée.

### 3.3 — "Même zone de stockage" ✅ EXISTE

`products_v2.storage_zone_id` → FK vers `storage_zones`. Source de vérité validée.

### 3.4 — "Similarité de nom" ⚠️ FAISABLE MAIS CONTRAINT

`products_v2.name_normalized` existe (lowercase, sans accents, espaces collapsés).
On peut l'utiliser pour détecter des candidats. Mais :
- La détection automatique est une **suggestion**, jamais une décision
- L'humain **valide toujours**

### 3.5 — Stock Engine ✅ COMPATIBLE

Le `StockEngine` (`getEstimatedStockBatch`) retourne un `Map<product_id, EstimatedStockOutcome>`.
Le module de mutualisation doit simplement **sommer les résultats** des produits membres d'un groupe.
Aucune modification du StockEngine n'est nécessaire.

### 3.6 — Alertes Stock ✅ COMPATIBLE

`useStockAlerts` produit un `StockAlertItem[]` par produit.
Le module de mutualisation doit **intercepter en aval** (couche de présentation) :
- Regrouper les alertes des produits membres
- Calculer le stock groupe = Σ stocks individuels
- Comparer au seuil du produit porteur
- Afficher 1 alerte groupe au lieu de N alertes individuelles

---

## 4. Architecture Technique

### 4.1 — Structure Module

```
src/modules/inventaireMutualisation/
├── index.ts                          # Barrel export (seul point d'entrée)
├── types.ts                          # Types du module
├── components/
│   ├── MutualisationToggle.tsx       # Toggle on/off par établissement
│   ├── SuggestionDialog.tsx          # Popup de suggestion + validation
│   └── GroupedStockRow.tsx           # Ligne affichage groupe (dépliable)
├── hooks/
│   ├── useMutualisationEnabled.ts    # Lit le toggle établissement
│   ├── useMutualisationGroups.ts     # Lit les groupes validés
│   └── useSuggestGroups.ts           # Moteur de suggestion
├── services/
│   └── mutualisationService.ts       # CRUD groupes (Supabase)
└── utils/
    └── nameKernel.ts                 # Extraction noyau produit
```

### 4.2 — Tables DB (nouvelles, isolées)

```sql
-- Table 1 : Toggle par établissement
CREATE TABLE public.inventory_mutualisation_settings (
  establishment_id UUID PRIMARY KEY REFERENCES establishments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

-- Table 2 : Groupes validés
CREATE TABLE public.inventory_mutualisation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,          -- "Lasagne"
  carrier_product_id UUID NOT NULL REFERENCES products_v2(id),  -- produit porteur du seuil
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 3 : Membres d'un groupe
CREATE TABLE public.inventory_mutualisation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES inventory_mutualisation_groups(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products_v2(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, product_id)
);

-- Index pour performances
CREATE INDEX idx_img_establishment ON inventory_mutualisation_groups(establishment_id) WHERE is_active;
CREATE INDEX idx_imm_group ON inventory_mutualisation_members(group_id);
CREATE INDEX idx_imm_product ON inventory_mutualisation_members(product_id);
```

### 4.3 — RLS (sécurité standard)

```sql
ALTER TABLE inventory_mutualisation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_mutualisation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_mutualisation_members ENABLE ROW LEVEL SECURITY;

-- Policies : même pattern que les autres tables inventaire
-- SELECT/INSERT/UPDATE/DELETE pour les utilisateurs authentifiés
-- avec vérification établissement via has_module_access
```

---

## 5. Critères de Suggestion (Moteur)

Deux produits ne peuvent être **proposés** ensemble que si **TOUS** ces critères sont remplis :

| # | Critère | Champ source | Obligatoire |
|---|---------|-------------|-------------|
| 1 | Même établissement | `establishment_id` | ✅ |
| 2 | Même catégorie | `category_id` | ✅ |
| 3 | Même unité de stock | `stock_handling_unit_id` | ✅ |
| 4 | Même zone de stockage | `storage_zone_id` | ✅ |
| 5 | Non archivé | `archived_at IS NULL` | ✅ |
| 6 | Noms similaires | `name_normalized` | ✅ (seuil ≥ 0.5) |

### Algorithme de similarité de nom

```typescript
// utils/nameKernel.ts
export function extractKernel(nameNormalized: string): string {
  // Retirer les mots courts (≤2 chars) et les marques connues
  const BRAND_STOPWORDS = ["rummo", "molisana", "mutti", "barilla", "panzani"];
  const words = nameNormalized.split(" ")
    .filter(w => w.length > 2)
    .filter(w => !BRAND_STOPWORDS.includes(w));
  return words.join(" ");
}

export function kernelSimilarity(a: string, b: string): number {
  const ka = extractKernel(a);
  const kb = extractKernel(b);
  if (ka === kb) return 1.0;
  // Jaccard sur les mots
  const setA = new Set(ka.split(" "));
  const setB = new Set(kb.split(" "));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

**Important** : La machine **propose**, l'humain **valide**. Jamais de création automatique.

---

## 6. Flux Utilisateur

### 6.1 — Activation

1. Paramètres Inventaire → Onglet "Mutualisation"
2. Toggle ON/OFF
3. Si ON → scan automatique des candidats → popup de suggestions

### 6.2 — Validation des suggestions

```
┌─────────────────────────────────────────┐
│  Suggestion de regroupement             │
│                                         │
│  🔗 Lasagne Rummo                       │
│  🔗 Lasagne Molisana                    │
│                                         │
│  Nom du groupe : [Lasagne          ]    │
│  Produit porteur du seuil :             │
│  ○ Lasagne Molisana (par défaut)        │
│  ○ Lasagne Rummo                        │
│                                         │
│  [ Ignorer ]  [ Modifier ]  [ Valider ] │
└─────────────────────────────────────────┘
```

### 6.3 — Affichage en inventaire (quand activé)

**Vue repliée :**
```
📦 Lasagne               6 kg    Seuil: 2 kg    ✅ OK
```

**Vue dépliée :**
```
📦 Lasagne               6 kg    Seuil: 2 kg    ✅ OK
   └─ Lasagne Molisana   2 kg
   └─ Lasagne Rummo      4 kg
```

### 6.4 — Alertes (quand activé)

| Situation | Affichage |
|-----------|-----------|
| Rummo=0, Molisana=4, seuil=2 | ✅ Groupe OK (4 > 2) — **pas d'alerte** sur Rummo |
| Rummo=0, Molisana=1, seuil=2 | ⚠️ **Lasagne sous seuil** (1 < 2) — 1 seule alerte groupe |
| Rummo=0, Molisana=0, seuil=2 | 🔴 **Lasagne en rupture** — 1 seule alerte groupe |

### 6.5 — Désactivation

Toggle OFF → retour immédiat au mode standard :
- Les groupes sont conservés en DB (is_active = false)
- Aucune alerte groupe
- Chaque produit retrouve ses alertes individuelles

---

## 7. Points d'Intégration (Branchement)

### 7.1 — Dans `DesktopInventoryView.tsx`

**Avant le rendu de la table :**
```typescript
// Si mutualisation activée, regrouper les displayProducts
const { groups, isEnabled } = useMutualisationGroups();
const finalProducts = isEnabled
  ? applyMutualisation(displayProducts, groups, estimatedStock)
  : displayProducts;
```

Le module exporte une pure function `applyMutualisation()` qui :
- Prend la liste de produits + les groupes + le stock estimé
- Retourne une liste mixte : produits individuels + groupes (avec enfants)
- Ne modifie aucune donnée source

### 7.2 — Dans `useStockAlerts.ts`

**En aval, dans le composant `StockAlertsView.tsx` :**
```typescript
// Wrapper : si mutualisation activée, fusionner les alertes
const { groups, isEnabled } = useMutualisationGroups();
const displayAlerts = isEnabled
  ? applyMutualisationAlerts(alerts, groups)
  : alerts;
```

La function `applyMutualisationAlerts()` :
- Fusionne les alertes des produits d'un même groupe
- Somme les stocks estimés
- Compare au seuil du produit porteur
- Retourne 1 alerte groupe au lieu de N

### 7.3 — Dans `InventaireSettingsPage.tsx`

Ajouter un 3ème onglet "Mutualisation" avec le toggle et la gestion des groupes.

---

## 8. Le Seuil — Règle Unique

| Règle | Détail |
|-------|--------|
| Le seuil du groupe = le seuil du **produit porteur** | Pas de seuil copié, pas de seuil dupliqué |
| Produit porteur par défaut = 1er alphabétiquement | Modifiable par l'utilisateur lors de la validation |
| Modifier le seuil du groupe = modifier le seuil du produit porteur | Via `products_v2.min_stock_quantity_canonical` |
| Le produit porteur est stocké dans `inventory_mutualisation_groups.carrier_product_id` | Source unique |

---

## 9. Garanties de Non-Régression

### 9.1 — Suppression du module = 0 impact

```bash
rm -rf src/modules/inventaireMutualisation
# Puis retirer :
# - Import dans DesktopInventoryView.tsx (if isEnabled → supprimé → affichage standard)
# - Import dans StockAlertsView.tsx (idem)
# - Onglet dans InventaireSettingsPage.tsx
# - Route si ajoutée dans App.tsx
# - Tables DB (optionnel, elles deviennent orphelines mais ne gênent rien)
```

### 9.2 — Aucun conflit stock possible

| Propriété | Garantie |
|-----------|----------|
| Stock réel | Toujours calculé par produit via `StockEngine` — jamais modifié |
| `stock_events` | Jamais modifié par le module |
| `inventory_lines` | Jamais modifié par le module |
| `zone_stock_snapshots` | Jamais modifié par le module |
| Seuil min | Lu depuis `products_v2.min_stock_quantity_canonical` du produit porteur — jamais dupliqué |

### 9.3 — Aucun conflit alertes possible

Les alertes individuelles sont **masquées en couche présentation** quand le groupe est actif.
Le hook `useStockAlerts` lui-même n'est jamais modifié.
Si le module est désactivé ou supprimé, les alertes individuelles réapparaissent automatiquement.

---

## 10. Ce Qui Diffère de la Stratégie GPT

| Point GPT | Réalité Codebase | Décision |
|-----------|-----------------|----------|
| "Même famille canonique" | Pas de `product_families` table | → Remplacé par `même stock_handling_unit_id` |
| "1er mot à 85%" | Trop fragile | → Extraction noyau + Jaccard + validation humaine |
| "Détection mots de marque connus" | Pas de dictionnaire de marques en DB | → Liste statique extensible côté frontend (V1) |
| "Même type d'usage cuisine" | Pas de champ `usage_cuisine` | → Non implémenté en V1 (critère optionnel futur) |
| "Modifier seuil dans l'inventaire du groupe" | Seuil vit sur `products_v2` | → Mutation directe sur le produit porteur (pas de proxy) |

---

## 11. Plan d'Implémentation (V1 Minimale)

### Phase 1 : DB + Toggle (1 session)
1. Migration : créer les 3 tables + RLS
2. `useMutualisationEnabled` hook
3. Toggle dans Paramètres Inventaire

### Phase 2 : Moteur de suggestion (1 session)
1. `useSuggestGroups` : scan des candidats
2. `SuggestionDialog` : popup de validation
3. `mutualisationService` : CRUD groupes

### Phase 3 : Affichage mutualisé (1 session)
1. `applyMutualisation()` pure function
2. `GroupedStockRow` composant dépliable
3. Intégration dans `DesktopInventoryView`

### Phase 4 : Alertes mutualisées (1 session)
1. `applyMutualisationAlerts()` pure function
2. Intégration dans `StockAlertsView`

### Phase 5 : Mobile (optionnel, session ultérieure)
1. Même logique dans `MobileInventoryView`
2. Même logique dans `MobileStockAlertsView`

---

## 12. Verdict

✅ **La stratégie est faisable et safe** avec les ajustements documentés ci-dessus.

Le module est :
- **Isolé** : aucun import depuis d'autres modules vers lui
- **Désactivable** : toggle OFF = retour immédiat au standard
- **Supprimable** : `rm -rf` sans casse
- **Non-intrusif** : ne modifie ni le stock réel, ni les alertes source, ni les produits
- **Compatible** : s'appuie sur les données existantes (`category_id`, `stock_handling_unit_id`, `storage_zone_id`, `name_normalized`)

**Aucune notion de "famille canonique" ou de "type d'usage cuisine" n'existe en DB** — ces critères GPT sont remplacés par des données réelles disponibles.
