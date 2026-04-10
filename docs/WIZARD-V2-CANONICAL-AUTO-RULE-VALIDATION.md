# Wizard V2 — Règle canonique auto : Validation SAFE avant implémentation

**Date** : 2026-04-01  
**Scope** : Valider la règle automatique de `stock_handling_unit_id` contre le code réel et les 507 produits en base.

---

## 1. Règle cible rappelée

| Cas | Condition | Canonique résultante |
|-----|-----------|---------------------|
| A | Poids/volume variable (billing=kg/L, pas d'équivalence fixe) | kg ou L |
| B | Unité terminale pondérale/volumique fixe (g, ml) | kg ou L (normalisation) |
| C | Unité terminale de décompte stable | pièce (ou l'unité terminale) |

---

## 2. Logique existante dans le code (`resolveCanonical`)

**Fichier** : `src/core/unitConversion/resolveProductUnitContext.ts`, lignes 100-127

```typescript
function resolveCanonical(baseTargetId, billingId, equivalence, dbUnits) {
  if (!baseTargetId) return null;
  if (!billingId || billingId === baseTargetId) return baseTargetId;
  
  const billingUnit = dbUnits.find(u => u.id === billingId);
  if (!billingUnit) return baseTargetId;
  if (!isPhysicalFamily(billingUnit)) return baseTargetId;
  
  // Billing is physical → check for fixed equivalence
  if (hasFixedEquivalence) return baseTargetId;
  
  // Variable weight → use billing
  return billingId;
}
```

**Résumé** : La canonique actuelle est calculée ainsi :
1. Point de départ = `stock_handling_unit_id` (ou fallback `final_unit_id`)
2. Si billing est physique (weight/volume) ET pas d'équivalence fixe → canonique = billing (cas variable weight)
3. Sinon → canonique = baseTarget

**⚠️ Constat critique** : La canonique actuelle dépend de `stock_handling_unit_id` comme entrée. Ce n'est PAS un calcul automatique — c'est un choix utilisateur validé par BFS.

---

## 3. Données réelles — 507 produits analysés

### Distribution globale

| Pattern | Nombre | % |
|---------|--------|---|
| `stock = final_unit` | **421** | 83% |
| `stock = billing_unit` (≠ final) | **14** | 3% |
| `stock = autre` (packaging choisi manuellement) | **26** | 5% |
| Pas de stock_handling_unit_id | **46** | 9% |
| **Total** | **507** | 100% |

### Les 26 produits "stock = autre" — CAS CRITIQUES

Ce sont des produits où l'utilisateur a **délibérément** choisi une unité de packaging comme unité de stock :

| Produit | stock | final | billing | Équiv ? | Pourquoi l'utilisateur a choisi cette unité |
|---------|-------|-------|---------|---------|---------------------------------------------|
| BARQUETTE ALU 870ML | paq | pce | pce | oui | Compte en paquets, pas en pièces |
| BURRATA 125G (×3 dupes) | bte | pce | kg | oui | Compte en boîtes, pas en pièces ni en kg |
| BURRATA SAPORI MIEI | bte | pce | pce | oui | Compte en boîtes |
| CHORIZO BOEUF IKBAL (×2) | pack | bte | kg | oui | Compte en packs |
| CRENEAUX DE NOIX (×2) | pce | sach | sach | oui | Compte en pièces (sachets ≠ pièces ici) |
| GOBLET CARTON 10CL (×2) | paq | pce | car | non | Compte en paquets |
| GOBLET CARTON 20CL (×2) | paq | pce | car | non | Compte en paquets |
| GRANA EN POUDRE | sac | kg | kg | oui | Compte en sacs, pas en kg |
| GRANA PADANO EN POUDRE (×2) | sac | kg | kg | oui | Compte en sacs malgré billing=kg |
| Langues de chat (×2) | paq | pce | bte | oui | Compte en paquets |
| NUTELLA (×2) | bid | kg | pack | non | Compte en bidons |
| SPRITE (×2) | pack | bout | bout | oui | Compte en packs |
| TEST 1 (×3) | car | pce | pce | oui | Compte en cartons |

### Les 14 produits "stock = billing"

| Produit | stock=billing | final | Cas |
|---------|---------------|-------|-----|
| FILET DE BOEUF | kg | pce | Variable weight : billing=kg, final=pce → stock=kg |
| GRANA PADANO Q2 | kg | pce | Variable weight : billing=kg, final=pce → stock=kg |
| GRANA PADANO SAPORI | kg | sac | Variable weight : billing=kg, final=sac → stock=kg |
| MANGUE BATEAU | kg | pce | Variable weight |
| + 10 autres | count | count | stock=billing=final (même famille) |

---

## 4. Challenge de la règle cible — Tableau de validation

### A. Cas par cas

| Cas produit | Arbre / structure | Canonique actuelle | Canonique selon règle | Compatible ? | Risque | Safe ? |
|------------|-------------------|-------------------|----------------------|:---:|--------|:---:|
| Produit simple kg (AIL EN POUDRE) | kg → sach | kg | kg (Cas A/B) | ✅ | — | ✅ |
| Produit simple L (HUILE) | L | L | L (Cas A) | ✅ | — | ✅ |
| Produit simple pièce (ABRASIF) | roul | roul | roul (Cas C) | ✅ | — | ✅ |
| Sac 500g (AIL POUDRE) | kg → sach(1kg) | kg | kg (Cas B) | ✅ | — | ✅ |
| Packaging profond (BURRATA 125G) | pce→125g, carton→boîte→pce | **bte** | **kg** (Cas B: g→kg) | ❌ | **Changement destructif** | ❌ |
| Poids variable (FILET DE BOEUF) | pce, billing=kg, pas d'equiv fixe | kg | kg (Cas A) | ✅ | — | ✅ |
| Pièce + poids fixe (GRANA PADANO Q2) | pce→equiv kg | kg | kg (Cas B) | ✅ | — | ✅ |
| GRANA EN POUDRE | kg→sac(1kg) | **sac** | **kg** (Cas B) | ❌ | **Changement destructif** | ❌ |
| NUTELLA | kg→pack→bid | **bid** | **kg** (Cas B) | ❌ | **Changement destructif** | ❌ |
| SPRITE | bout→pack | **pack** | **bout** (Cas C) | ❌ | **Changement destructif** | ❌ |
| GOBLET CARTON | pce→paq→car | **paq** | **pce** (Cas C) | ❌ | **Changement destructif** | ❌ |
| Produit B2B importé | Même structure que source | stock copié | Dépend de la structure | ✅ si simple | — | ✅ |
| Produit OCR | Structure déduite | Pas de stock_handling_unit | Idem | ✅ si simple | — | ✅ |
| Produit ancien wizard | variable | déjà fixé | Potentiel conflit | ⚠️ | Double logique | ⚠️ |

### B. Résultat

**Sur les 461 produits avec stock_handling_unit_id :**
- **421 (91%)** : stock = final → la règle auto donnerait le même résultat ✅
- **14 (3%)** : stock = billing → la règle auto (Cas A) donnerait le même résultat ✅
- **26 (6%)** : stock = packaging choisi manuellement → la règle auto donnerait un résultat DIFFÉRENT ❌

---

## 5. Impact runtime si on imposait la règle auto

| Flow | Impact potentiel | Risque réel ? | Pourquoi | Safe ? |
|------|-----------------|:---:|---------|:---:|
| Stock ledger | Changement de canonical_unit_id pour 26 produits | **OUI** | SUM(delta) deviendrait incohérent | ❌ |
| Inventaire | Comptage dans une unité différente | **OUI** | L'inventaire passerait de "bte" à "kg" | ❌ |
| Réception | Unité de réception pourrait diverger | Non | Réception utilise product_input_config | ✅ |
| Retrait | Unité de retrait pourrait diverger | Non | Utilise product_input_config | ✅ |
| Commandes | canonical_unit_id dans commande_lines | Non | Fixé au moment de la commande | ✅ |
| B2B import | Copie le stock_handling_unit_id source | Non | Pas impacté par la règle locale | ✅ |
| OCR | Pas de stock_handling_unit_id à la création | Non | Sera setté par le wizard | ✅ |
| Prix / facturation | Utilise final_unit_price + BFS | Non | Indépendant de stock_handling | ✅ |
| Affichage stock | Affiche en stock_handling_unit | **OUI** | Changerait de "bte" à "kg" | ❌ |
| Paramètres avancés | product_input_config | Non | Inchangé | ✅ |

---

## 6. Produits existants — risque de casse

| Sujet | Risque sur produits existants ? | Double logique ? | Action nécessaire |
|-------|:---:|:---:|-------------------|
| BFS / conversion | Non | Non | BFS ne dépend pas de stock_handling |
| Stock ledger | **OUI si on change stock_handling** | **OUI** | Ne pas changer les existants |
| Inventaire | **OUI si on change stock_handling** | **OUI** | Ne pas changer les existants |
| Réception | Non | Non | Lit product_input_config |
| Retrait | Non | Non | Lit product_input_config |
| Commandes | Non | Non | Snapshot au moment de l'envoi |
| OCR | Non | Non | Pas de stock_handling à la création |
| B2B import | Non | Non | Copie depuis la source |
| Édition produit | ⚠️ | ⚠️ | Si la règle auto remplace le choix → conflit |
| Duplication produit | Non | Non | Copie les champs tels quels |
| Affichage détail | Non | Non | Lit la valeur en DB |
| Paramètres avancés | Non | Non | Indépendant |

---

## 7. Conclusion — Décision

### ⚠️ CAS 2 — La règle est globalement bonne mais certains cas DOIVENT rester manuels

#### A. Ce qui est validé ✅

1. **La règle auto couvre 94% des cas** (435/461) correctement
2. **Cas A (poids variable)** : Déjà implémenté dans `resolveCanonical` — fonctionne parfaitement
3. **Cas B (normalisation g→kg, ml→L)** : Correct pour les produits simples
4. **Cas C (décompte stable)** : Correct pour les produits simples

#### B. Ce qui reste risqué ❌

1. **26 produits (6%) ont un choix de packaging intentionnel** que la règle auto ne peut pas deviner :
   - BURRATA → stock en boîtes (pas en kg ni en pièces)
   - GRANA PADANO → stock en sacs (pas en kg)
   - NUTELLA → stock en bidons (pas en kg)
   - SPRITE → stock en packs (pas en bouteilles)
   - GOBELETS → stock en paquets (pas en pièces)

2. **Ces choix sont des décisions opérationnelles** : le restaurateur choisit l'unité dans laquelle il compte physiquement son stock. Aucune règle algorithmique ne peut deviner qu'on compte le NUTELLA en bidons plutôt qu'en kg.

3. **Imposer la règle auto casserait le ledger** pour ces 26 produits.

#### C. Ce qu'on peut implémenter sans risque ✅

**La règle auto comme PRÉ-REMPLISSAGE intelligent, pas comme remplacement du choix utilisateur.**

Concrètement :
1. **Dans le Wizard Step 4 (ou futur Step "Zone & Stock")** : la règle auto pré-sélectionne une valeur par défaut dans le dropdown
2. **L'utilisateur peut toujours changer** vers un packaging s'il le souhaite
3. **Le choix reste enregistré dans `stock_handling_unit_id`** comme aujourd'hui
4. **Aucun changement sur les produits existants**

C'est exactement ce que fait déjà le code actuel (lignes 127-131 de WizardStep4.tsx) :
```typescript
useEffect(() => {
  if (!stockHandlingUnitId && (canonicalStockUnitId || finalUnitId)) {
    onStockHandlingUnitChange(canonicalStockUnitId ?? finalUnitId);
  }
}, [canonicalStockUnitId, finalUnitId]);
```

**La logique de pré-remplissage existe déjà.** L'amélioration possible est de rendre ce pré-remplissage plus intelligent (normalisation g→kg, ml→L), pas de supprimer le choix.

---

## 8. Stratégie d'implémentation recommandée

### Ce qu'on PEUT faire (safe)

| Étape | Action | Risque | Pourquoi safe |
|-------|--------|--------|---------------|
| 1 | Créer une fonction `suggestCanonicalUnit(finalUnitId, billingId, equivalence, packagingLevels, dbUnits)` | Aucun | Pure fonction, pas connectée |
| 2 | Utiliser cette fonction comme pré-remplissage dans WizardStep4 (remplacer le `useEffect` existant) | Aucun | Même pattern, meilleure heuristique |
| 3 | Ajouter la normalisation g→kg, ml→L dans la suggestion | Aucun | Améliore le défaut sans imposer |

### Ce qu'on NE DOIT PAS faire

| Action interdite | Pourquoi |
|-----------------|---------|
| Supprimer le dropdown de choix d'unité de stock | 6% des produits nécessitent un choix différent |
| Remplacer silencieusement `stock_handling_unit_id` | Corrompt le ledger des 26 produits existants |
| Créer une logique parallèle | Double source de vérité |
| Changer la logique de `resolveCanonical` | Impact sur tous les flows runtime |

---

## 9. Implémentation proposée (si validée)

### Fonction `suggestCanonicalUnit`

```typescript
/**
 * Suggests the best canonical (stock handling) unit based on product structure.
 * This is a SUGGESTION only — user can override in the wizard.
 * 
 * Rules:
 * A. Variable weight (billing=physical, no fixed equiv) → billing unit (kg/L)
 * B. Fixed equiv with terminal physical unit (g→kg, ml→L) → reference unit of that family
 * C. Otherwise → final_unit_id (the base unit chosen in Step 1)
 */
function suggestCanonicalUnit(
  finalUnitId: string | null,
  billingId: string | null,
  equivalence: Equivalence | null,
  dbUnits: UnitWithFamily[]
): string | null {
  if (!finalUnitId) return null;
  
  // Case A: Variable weight (already handled by resolveCanonical)
  if (billingId && billingId !== finalUnitId) {
    const billingUnit = dbUnits.find(u => u.id === billingId);
    if (billingUnit && isPhysicalFamily(billingUnit)) {
      const hasFixed = equivalence?.quantity && equivalence.quantity > 0;
      if (!hasFixed) return billingId; // Variable weight → kg/L
    }
  }
  
  // Case B: Equivalence with g→kg or ml→L normalization
  if (equivalence?.unit_id) {
    const equivUnit = dbUnits.find(u => u.id === equivalence.unit_id);
    if (equivUnit) {
      if (equivUnit.abbreviation === 'g' || equivUnit.family === 'weight') {
        const kg = dbUnits.find(u => u.is_reference && u.family === 'weight');
        if (kg) return kg.id;
      }
      if (equivUnit.abbreviation === 'ml' || equivUnit.family === 'volume') {
        const l = dbUnits.find(u => u.is_reference && u.family === 'volume');
        if (l) return l.id;
      }
    }
  }
  
  // Case C: Default → final unit
  return finalUnitId;
}
```

### Où l'intégrer

**Fichier** : `src/modules/visionAI/components/ProductFormV3/WizardStep4.tsx`, lignes 127-131

Remplacer :
```typescript
useEffect(() => {
  if (!stockHandlingUnitId && (canonicalStockUnitId || finalUnitId)) {
    onStockHandlingUnitChange(canonicalStockUnitId ?? finalUnitId);
  }
}, [canonicalStockUnitId, finalUnitId]);
```

Par :
```typescript
useEffect(() => {
  if (!stockHandlingUnitId) {
    const suggested = suggestCanonicalUnit(finalUnitId, billedUnitId, equivalence, dbUnits);
    onStockHandlingUnitChange(suggested ?? finalUnitId);
  }
}, [finalUnitId, billedUnitId, equivalence, dbUnits]);
```

### Ce qui ne change PAS

- `resolveCanonical` dans `resolveProductUnitContext.ts` → **INCHANGÉ**
- `stock_handling_unit_id` en DB → **INCHANGÉ**
- Ledger / `fn_post_stock_document` → **INCHANGÉ**
- `product_input_config` → **INCHANGÉ**
- Dropdown de choix utilisateur → **CONSERVÉ**
- Produits existants → **INCHANGÉS**

---

## 10. Audit post-implémentation prévu

Après implémentation, vérifier que la suggestion aurait été correcte pour les produits existants :

| Catégorie | Nombre | Action |
|-----------|--------|--------|
| Produits où suggestion = stock actuel | ~435 | ✅ Rien à faire |
| Produits où suggestion ≠ stock actuel | ~26 | ⚠️ Normal — choix utilisateur intentionnel |
| Produits sans stock_handling_unit_id | ~46 | 🔧 À configurer via wizard |

---

*Fin de la validation — Aucun code modifié.*
