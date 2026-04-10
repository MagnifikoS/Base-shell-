# THE BRAIN — Module d'apprentissage observable

**Version :** Fondation v0  
**Date :** 2026-02-07

---

## 🧠 Philosophie

> **THE BRAIN ne décide jamais.**

Ce module est un **journal d'apprentissage observable**. Il :
- ✅ Enregistre des événements (append-only)
- ✅ Affiche des statistiques simples
- ✅ Permet d'observer les patterns

Il ne :
- ❌ Modifie aucune logique métier existante
- ❌ Déclenche aucune action automatique
- ❌ Utilise aucune IA ou LLM
- ❌ Impacte la performance de l'application

---

## 📁 Structure

```
src/modules/theBrain/
├── README.md                      # Ce fichier
├── index.ts                       # Exports publics
├── types.ts                       # Types TypeScript
├── constants.ts                   # Constantes (sujets, actions)
├── services/
│   └── theBrainService.ts         # Fonctions de lecture/écriture
├── hooks/
│   └── useBrainHealth.ts          # Hook React pour les données
├── pages/
│   └── TheBrainPage.tsx           # Page principale
└── components/
    ├── BrainHealthCards.tsx       # Cartes de santé globale
    ├── BrainSubjectsTable.tsx     # Table des sujets
    └── BrainEventsTable.tsx       # Table des événements récents
```

---

## 🗄️ Tables Supabase

### `brain_events` (append-only)

| Colonne | Type | Description |
|---------|------|-------------|
| id | uuid | Clé primaire |
| establishment_id | uuid | Établissement |
| subject | text | Sujet (ex: "product_matching") |
| action | text | Action (ex: "confirmed", "corrected") |
| context | jsonb | Données libres |
| actor_user_id | uuid | Utilisateur (optionnel) |
| created_at | timestamp | Date de création |

**Règle :** Append-only. Pas d'UPDATE, pas de DELETE.

### `brain_rules` (connaissance structurée)

| Colonne | Type | Description |
|---------|------|-------------|
| id | uuid | Clé primaire |
| establishment_id | uuid | Établissement |
| subject | text | Sujet |
| context_key | text | Clé de contexte unique |
| value | jsonb | Valeur apprise |
| confirmations_count | int | Compteur de confirmations |
| corrections_count | int | Compteur de corrections |
| enabled | boolean | Règle active ou non |

---

## 🚫 Règles strictes

### Interdit d'ajouter :
- Logique "smart" automatique
- Watchers globaux ou polling
- Calculs de scoring complexes
- Appels à des APIs LLM

### Interdit de brancher un sujet sans validation
Chaque nouveau sujet (ex: "inventory", "supplier_matching") doit être :
1. Documenté dans ce README
2. Validé par l'équipe
3. Testé sans impact sur les modules existants

---

## 🗑️ Comment supprimer ce module

Si vous souhaitez supprimer THE BRAIN de l'application :

### Étape 1 : Supprimer la route
Dans `src/App.tsx`, retirer :
```tsx
<Route path="/pilotage/the-brain" element={<TheBrainPage />} />
```

### Étape 2 : Supprimer l'entrée sidebar
Dans `src/config/navRegistry.ts`, retirer l'entrée avec `moduleKey: "the_brain"`.

### Étape 3 : Supprimer le dossier
```bash
rm -rf src/modules/theBrain/
```

### Étape 4 (optionnel) : Supprimer les tables
```sql
DROP TABLE IF EXISTS public.brain_events CASCADE;
DROP TABLE IF EXISTS public.brain_rules CASCADE;
```

**Résultat :** L'application fonctionne normalement sans THE BRAIN.

---

## 📊 Sujets autorisés (v0)

| Sujet | Description | Statut |
|-------|-------------|--------|
| `product_matching` | Matching produits Vision AI | ✅ **Actif (Phase 2-4)** |
| `pricing` | Comparaison de prix | 🟡 Prévu |
| `supplier_matching` | Matching fournisseurs | ✅ **Actif (Phase 1)** |

---

## 🚀 Phases d'implémentation

### Phase 1 : `supplier_matching` logging ✅
### Phase 2 : `product_matching` confirmed/created logging ✅
### Phase 3 : `product_matching` corrected logging ✅
### Phase 4 : Apprentissage exploitable (brain_rules) ✅

---

## 🔌 Plugins

### `supplier_matching` (Phase 1)

**Fichier :** `src/modules/theBrain/plugins/supplierMatching.ts`

**Actions loggées :**
- `confirmed` : sélection dropdown, best match, création fournisseur
- `corrected` : changement après validation

**Actions NON loggées :**
- Auto-match 100% (pas d'action humaine)

**Utilisation :**
```typescript
import { logSupplierConfirmed, logSupplierCorrected } from "@/modules/theBrain/plugins/supplierMatching";

// Confirmation (action humaine)
logSupplierConfirmed({
  establishmentId: "xxx",
  supplierId: "yyy",
  extractedSupplierLabel: "SAS BAYT UL LAHM",
  matchKind: "fuzzy", // ou "manual"
});

// Correction (changement après validation)
logSupplierCorrected({
  establishmentId: "xxx",
  previousSupplierId: "old-id",
  supplierId: "new-id",
  extractedSupplierLabel: "BAYT UL LAHM",
});
```

**Suppression du plugin :**
1. Supprimer `src/modules/theBrain/plugins/supplierMatching.ts`
2. Retirer les imports dans `SupplierMatchField.tsx` et `InvoiceHeader.tsx`
3. L'app fonctionne identique

---

### `product_matching` (Phase 2-4)

**Fichier :** `src/modules/theBrain/plugins/productMatching.ts`

**Actions loggées :**
- `confirmed` : confirmation fuzzy match, sélection produit existant
- `created` : création produit via Wizard V3
- `corrected` : remplacement d'un match confirmé (Phase 3)

**Actions NON loggées :**
- Auto-match 🟢 (pas d'action humaine)
- Fermeture wizard sans validation

**Phase 4 — Apprentissage exploitable :**
- À chaque log (confirmed/corrected/created), une règle est upsertée dans `brain_rules`
- Context key : `${supplier_id}|${category}|${label_normalized}`
- Seuil suggestion : confirmations ≥ 2 ET corrections = 0
- Les suggestions THE BRAIN apparaissent en premier dans le panneau "Choisir existant"

**Utilisation :**
```typescript
import { logProductMatchConfirmed, logProductCreatedFromInvoice } from "@/modules/theBrain/plugins/productMatching";

// Confirmation match produit (action humaine)
logProductMatchConfirmed({
  establishmentId: "xxx",
  supplierId: null,
  lineId: "line-123",
  extracted: { 
    code_produit: "ABC", 
    nom_produit: "Produit X",
    category: "Viandes", // Phase 4: Pour context_key
  },
  selected: { product_id: "yyy", product_code: "ABC" },
  strategy: "fuzzy", // ou "manual_select"
});

// Création produit (après succès Wizard V3)
logProductCreatedFromInvoice({
  establishmentId: "xxx",
  supplierId: null,
  lineId: null,
  extracted: { 
    code_produit: "ABC", 
    nom_produit: "Produit X",
    category: "Viandes", // Phase 4
  },
  createdProductId: "new-product-id",
});
```

**Lecture des suggestions (Phase 4) :**
```typescript
import { getBestProductRuleSuggestion } from "@/modules/theBrain";

const suggestion = await getBestProductRuleSuggestion({
  establishmentId: "xxx",
  supplierId: null,
  category: "Viandes",
  label: "Produit X",
});

if (suggestion) {
  // suggestion.productId = ID du produit à suggérer
  // suggestion.confidence = "stable" | "probable" | "weak"
  // suggestion.confirmationsCount = nombre de confirmations
}
```

**Suppression du plugin :**
1. Supprimer `src/modules/theBrain/plugins/productMatching.ts`
2. Retirer les imports dans `ExtractedProductsModal.tsx` et `ProductFormV3Modal.tsx`
3. Retirer l'export dans `src/modules/theBrain/index.ts`
4. L'app fonctionne identique (juste sans suggestions THE BRAIN)

---

## 🔧 Utilisation du helper sécurisé

```typescript
import { brainSafeLog } from "@/modules/theBrain";

// Ne casse jamais l'app, silencieux en cas d'erreur
brainSafeLog({
  establishmentId: "xxx",
  subject: "product_matching",
  action: "confirmed",
  context: { productId: "yyy", matchType: "exact_code" },
});
```

---

## ✅ Checklist de validation

- [ ] L'app compile sans warnings
- [ ] Aucune page existante modifiée en comportement
- [ ] THE BRAIN s'ouvre rapidement
- [ ] Pas de lenteur globale
- [ ] Si tables vides → UI affiche "Aucun apprentissage"
- [ ] Le module est supprimable sans casser le reste
- [ ] (Phase 4) Les suggestions THE BRAIN apparaissent après 2+ confirmations
