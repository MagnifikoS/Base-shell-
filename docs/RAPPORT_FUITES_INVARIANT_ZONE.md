# Rapport complet — 3 fuites d'invariant `storage_zone_id`

> **Date :** 31 mars 2026  
> **Scope :** `products_v2.storage_zone_id` — SSOT zone de stockage  
> **État actuel DB :** 432/433 produits actifs ont une zone. 1 seul orphelin (`CAS-A EAU PLATE TEST`).

---

## FUITE #1 — FK `ON DELETE SET NULL`

### Constat

```sql
-- Migration 20260210202611
ALTER TABLE public.products_v2 
  ADD COLUMN storage_zone_id UUID REFERENCES public.storage_zones(id) ON DELETE SET NULL;
```

Si une `storage_zone` est supprimée en dur (DELETE physique), **tous les produits liés perdent silencieusement leur zone** → `storage_zone_id = NULL`.

### Impact réel actuel : FAIBLE (mais piège latent)

Le code actuel (`useStorageZones.ts:deleteZone`) fait un **soft-delete** (`is_active = false`) + un SET NULL explicite en JS :

```typescript
// useStorageZones.ts lignes 103-116
const deleteZone = useMutation({
  mutationFn: async (id: string) => {
    // Soft delete: mark inactive
    await supabase.from("storage_zones").update({ is_active: false }).eq("id", id);
    // Clear references in products_v2
    await supabase.from("products_v2").update({ storage_zone_id: null }).eq("storage_zone_id", id);
  },
});
```

**Problème :** Le code JS fait lui-même le SET NULL ! Donc même avec le soft-delete, les produits perdent leur zone quand on "supprime" une zone via l'UI.

### Danger

| Scénario | Probabilité | Impact |
|----------|-------------|--------|
| DELETE physique en SQL (admin DB) | Faible | **Critique** — perte silencieuse, pas de log |
| Soft-delete via UI (code actuel) | **Réel — se produit** | **Critique** — le code JS efface volontairement les zones de tous les produits liés |
| Pas de notification à l'utilisateur | — | L'utilisateur ne sait pas que N produits viennent de perdre leur zone |

### Correction recommandée

**A. Migration DB : changer la FK**

```sql
-- Remplacer ON DELETE SET NULL par ON DELETE RESTRICT
ALTER TABLE public.products_v2 
  DROP CONSTRAINT IF EXISTS products_v2_storage_zone_id_fkey;
ALTER TABLE public.products_v2 
  ADD CONSTRAINT products_v2_storage_zone_id_fkey 
  FOREIGN KEY (storage_zone_id) REFERENCES public.storage_zones(id) ON DELETE RESTRICT;
```

**B. Correction code : empêcher la suppression si produits liés**

```typescript
// useStorageZones.ts — deleteZone
const deleteZone = useMutation({
  mutationFn: async (id: string) => {
    // Vérifier s'il reste des produits dans cette zone
    const { count } = await supabase
      .from("products_v2")
      .select("id", { count: "exact", head: true })
      .eq("storage_zone_id", id)
      .is("archived_at", null);
    
    if (count && count > 0) {
      throw new Error(`Impossible : ${count} produit(s) utilisent encore cette zone. Réassignez-les d'abord.`);
    }
    
    // Soft delete seulement si aucun produit lié
    const { error } = await supabase
      .from("storage_zones")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw error;
    
    // Plus besoin de SET NULL — aucun produit n'est lié
  },
});
```

---

## FUITE #2 — `ProductLineDrawer` : sauvegarde sans zone

### Constat

`ProductLineDrawer.tsx` (Vision AI) permet de sauvegarder un produit (création et modification) avec `storage_zone_id: null`.

**Ligne 269 :**
```typescript
storage_zone_id: formData.storage_zone_id?.trim() || null,  // ← null accepté
```

**Ligne 766-771 — Bouton disabled conditions :**
```typescript
disabled={
  (!isDirty && isMatched) ||
  isSaving ||
  !formData.nom_produit.trim() ||
  !formData.supplier_id ||
  (!isMatched && (!formData.category?.trim() || !formData.conditionnement_config))
  // ⚠️ AUCUNE VÉRIF SUR storage_zone_id !
}
```

### Comparaison avec le Wizard V3

Le Wizard V3 (`WizardStep5Stock.tsx`) **protège correctement** :

```typescript
// useWizardState.ts ligne 588-590
const canProceedStep5 =
  (!!state.categoryId || !!state.category.trim()) &&
  !!state.storageZoneId &&   // ✅ Zone obligatoire dans le Wizard
  !!state.minStockQuantity && // ...
```

Mais le `ProductFormV3Modal` écrit quand même `null` au moment du save :
```typescript
// ProductFormV3Modal.tsx ligne 519, 581
storage_zone_id: wizard.state.storageZoneId || null,  // ← techniquement null possible
```

### Chemins de fuite identifiés

| Chemin d'écriture | Zone obligatoire ? | Fuite ? |
|---|---|---|
| **Wizard V3 — création** | ✅ Oui (`canProceedStep5`) | Non |
| **Wizard V3 — édition conditionnement** | ✅ Oui (`canProceedStep5`) | Non |
| **ProductLineDrawer — update** | ❌ Non vérifié | **OUI** |
| **ProductLineDrawer — create (upsert)** | ❌ Non vérifié | **OUI** |
| **useProductV2Mutations — create** | ❌ Aucun guard | **OUI** (si appelé directement) |
| **useProductV2Mutations — update** | ❌ Aucun guard | **OUI** (si appelé directement) |
| **ProduitV2DetailPage — save** | ⚠️ Zone en read-only ("Wizard only") | Faible (zone non modifiable) |
| **ZoneInlineEdit — transfer** | ✅ Sélection parmi zones existantes | Non |
| **Import B2B** | Variable | À vérifier |

### Correction recommandée

**A. Guard dans `ProductLineDrawer.tsx` :**

Ajouter `!formData.storage_zone_id` aux conditions du bouton disabled :

```typescript
disabled={
  (!isDirty && isMatched) ||
  isSaving ||
  !formData.nom_produit.trim() ||
  !formData.supplier_id ||
  !formData.storage_zone_id ||  // ← AJOUT
  (!isMatched && (!formData.category?.trim() || !formData.conditionnement_config))
}
```

**B. Guard dans `useProductV2Mutations.ts` (défense en profondeur) :**

```typescript
// Dans create et update :
if (!formData.storage_zone_id?.trim()) {
  throw new Error("Zone de stockage obligatoire");
}
```

---

## FUITE #3 — Pas de `NOT NULL` en DB

### Constat

```sql
-- État actuel
storage_zone_id UUID NULL REFERENCES public.storage_zones(id) ON DELETE SET NULL
```

Aucune contrainte backend. Tout code qui fait un `INSERT` ou `UPDATE` sur `products_v2` peut écrire `NULL` dans `storage_zone_id` sans erreur.

### Pourquoi on ne peut pas ajouter `NOT NULL` tout de suite

1. **1 produit actif sans zone** (`CAS-A EAU PLATE TEST`) — le `NOT NULL` planterait
2. **425 produits sans `product_input_config`** — corrélé mais pas bloquant pour le `NOT NULL`
3. **Les mutations existantes écrivent `|| null`** — il faut d'abord les corriger

### Stratégie en 3 phases

| Phase | Action | Prérequis |
|-------|--------|-----------|
| **Phase 1** (immédiat) | Corriger le code : guards dans ProductLineDrawer + useProductV2Mutations | Aucun |
| **Phase 2** (après correction data manuelle) | Assigner une zone au produit test orphelin | Fait manuellement |
| **Phase 3** (après Phase 2) | Migration `ALTER TABLE products_v2 ALTER COLUMN storage_zone_id SET NOT NULL` | 0 produits sans zone |

---

## Résumé exécutif

| Fuite | Danger réel | Fréquence | Correction |
|-------|-------------|-----------|------------|
| **#1 FK ON DELETE SET NULL** | 🔴 **Critique** — le soft-delete JS efface déjà les zones | À chaque suppression de zone | Migration FK → RESTRICT + guard code "produits liés" |
| **#2 ProductLineDrawer sans guard** | 🟡 **Moyen** — possible mais pas fréquent (utilisé dans Vision AI) | Rare (chemin secondaire) | Ajouter `!formData.storage_zone_id` au disabled |
| **#3 Pas de NOT NULL** | 🟡 **Latent** — aucun filet backend | Permanent | Phase 3 après correction data |

### Ordre de correction recommandé

1. **Code immédiat (0 risque, pas de migration) :**
   - Guard `ProductLineDrawer` → bloquer save sans zone
   - Guard `useProductV2Mutations` → throw si zone vide
   - Modifier `deleteZone` → interdire si produits liés

2. **Migration DB (après review) :**
   - FK → `ON DELETE RESTRICT`

3. **Après correction manuelle data :**
   - Assigner zone au produit orphelin
   - `ALTER COLUMN storage_zone_id SET NOT NULL`
