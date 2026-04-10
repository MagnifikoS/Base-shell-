# 🔍 ÉVALUATION HONNÊTE — STRATÉGIE B2B V3 vs CODE EXISTANT

> **Date** : 2026-03-26
> **Objectif** : Répondre sans complaisance — est-ce que ça règle tout ? Est-ce que ça peut casser ?

---

## VERDICT RAPIDE

| Question | Réponse |
|----------|---------|
| La stratégie règle-t-elle les 11 bugs ? | ✅ OUI, théoriquement tous |
| L'implémentation peut-elle casser l'app ? | ⚠️ **OUI, significativement** — Phases 2-3 sont à haut risque |
| Le plan est-il réaliste ? | 🟡 Oui, MAIS sous-estime la complexité frontend |

---

## 1. CE QUE LA STRATÉGIE RÈGLE BIEN ✅

### BUG-01 à BUG-05 (CRITIQUES) — Résolus par design
La réécriture de `fn_ship_commande` avec :
- Pipeline unique via `fn_post_stock_document` → élimine BUG-03 (bypass moteur) + BUG-05 (négatifs)
- Écriture unique `shipped_quantity` en CLIENT après clamp → élimine BUG-01 (double écriture) + BUG-07 (sync destructive)
- `DISTINCT ON` sur BIP → élimine BUG-02 (cartésien)
- Snapshots figés dans litiges → élimine BUG-04 (double débit)

### BUG-06 (Facturation) — Résolu simplement
Changer le filtre de `line_status` vers `received_quantity > 0` est correct et safe.

### BUG-08 à BUG-11 (Idempotence, concurrence, conversion, trous) — Résolus
Les ajouts de `FOR UPDATE`, `idempotency_key`, colonnes de conversion figées, et events CLAMP_ZERO sont tous des bonnes pratiques.

**Conclusion : La stratégie est architecturalement saine. Le design V3 est correct.**

---

## 2. CE QUE LA STRATÉGIE SOUS-ESTIME ⚠️

### RISQUE 1 — Le Frontend N'Est Pas "Transparent"

La stratégie se concentre sur le SQL (backend). Mais le code existant montre que **le frontend participe activement à la logique** :

```typescript
// src/modules/commandes/services/commandeService.ts:350-370
// updateLinePreparation() écrit DIRECTEMENT shipped_quantity + line_status
// via supabase.from("commande_lines").update(...)
```

**Problème** : Même si `fn_ship_commande` V2 fait tout correctement, la fonction `updateLinePreparation()` permet au frontend de modifier `shipped_quantity` et `line_status` **en dehors** de la transaction atomique. C'est une porte dérobée.

**Impact** : Si on ne la supprime/verrouille pas, un utilisateur peut corrompre les données entre la préparation et l'envoi.

**Niveau de risque** : 🔴 ÉLEVÉ — La stratégie ne mentionne pas ce point.

---

### RISQUE 2 — PreparationDialog Envoie `line_status` Depuis le Frontend

```typescript
// src/modules/commandes/components/PreparationDialog.tsx:301-305
const lines = localLines.map((l) => ({
  line_id: l.id,
  shipped_quantity: l.localShippedQty,
  line_status: l.localStatus!,  // ← Le frontend DÉCIDE du statut
}));
```

La stratégie V3 dit que `line_status` doit être **dérivé** côté serveur :
```
IF shipped = 0 → rupture
IF shipped < ordered → modifie
ELSE → ok
```

Mais le frontend l'envoie actuellement comme paramètre. Si la V3 SQL ignore ce paramètre, **le frontend enverra une donnée inutile** (pas dangereux mais source de confusion). Si la V3 SQL l'accepte encore → **le bug persiste**.

**Impact** : Il faut modifier `PreparationDialog.tsx` ET `commandeService.ts` ET l'edge function `commandes-api/index.ts` pour ne plus envoyer `line_status`.

**Niveau de risque** : 🟠 MOYEN — Oubli probable si on ne le documente pas.

---

### RISQUE 3 — `commandes-api/index.ts` Utilise `line_status` des Lignes Pour les Notifications

```typescript
// supabase/functions/commandes-api/index.ts:485-489
const hasRupture = lines.some((l) => l.line_status === "rupture");
const hasPartialQty = lines.some((l) =>
  l.line_status !== "rupture" && l.shipped_quantity < l.canonical_quantity
);
```

Si la V3 dérive `line_status` côté SQL et ne le renvoie plus dans le payload frontend, **les notifications de "commande expédiée partielle" cesseront de fonctionner** car l'edge function lit `line_status` du body de la requête.

**Impact** : Notifications cassées après la Phase 3.

**Niveau de risque** : 🟠 MOYEN — Fonctionnel mais pas critique.

---

### RISQUE 4 — `ReceptionDialog` Dépend de `line_status` Pour l'Affichage

```typescript
// src/modules/commandes/components/ReceptionDialog.tsx:635-637
const isRupture = line.line_status === "rupture";
const isSupplierRupture = shippedQty === 0;
const isModifie = line.line_status === "modifie";
```

Le UI de réception utilise `line_status` pour l'affichage (tri, couleurs, badges). Si le backend V3 change la sémantique ou le timing de `line_status`, l'UI sera incohérente.

**Impact** : Confusion visuelle, pas de corruption de données.

**Niveau de risque** : 🟡 FAIBLE — Cosmétique mais affecte l'UX.

---

### RISQUE 5 — Pas de `cancel_shipment` Existant (NOUVEAU FLOW)

La stratégie V3 crée un flow `cancel_shipment` qui n'existe pas du tout aujourd'hui. Ça veut dire :

1. Nouvelle RPC SQL (`fn_cancel_shipment`)
2. Nouvelle action dans `commandes-api` edge function
3. Nouveau bouton/UI dans `CommandeDetailDialog.tsx`
4. Nouvelles notifications
5. Nouveaux tests

**Impact** : C'est du développement NET, pas une correction. Le risque est moindre (pas de régression possible sur un flow qui n'existe pas) mais l'effort est sous-estimé.

**Niveau de risque** : 🟡 FAIBLE risque, ÉLEVÉ en effort.

---

### RISQUE 6 — Migrations Sur des Fonctions Réécrites 17+ Fois

J'ai trouvé **17 fichiers de migration** qui touchent `fn_ship_commande`. La dernière version active est issue de `20260319201217_*.sql`. La V3 va faire un `CREATE OR REPLACE` de plus.

**Risque** : Si la signature de la fonction change (ajout de paramètres), il faut :
1. `DROP FUNCTION` de l'ancienne signature
2. Vérifier que `types.ts` se régénère correctement
3. Que l'edge function `commandes-api` passe les bons paramètres

**Impact** : Erreur `function does not exist` en production si la signature ne match pas.

**Niveau de risque** : 🟠 MOYEN — Classique mais piégeux.

---

### RISQUE 7 — Phase 2 (fn_post_stock_document) Est le Point de Fragilité Maximum

`fn_post_stock_document` est utilisée par **66 fichiers de migration** et est le cœur de TOUT le système stock (pas seulement B2B). Si la V3 modifie son comportement (event CLAMP_ZERO, etc.), ça affecte :

- Réception de BL (`blApp`)
- Retrait de stock (`blRetrait`)
- Corrections rapides (`fn_quick_adjustment`)
- Inventaire
- Transferts inter-zones

**Impact** : Un changement dans `fn_post_stock_document` peut casser TOUT le module stock, pas seulement le B2B.

**Niveau de risque** : 🔴 ÉLEVÉ — C'est le point le plus dangereux de toute la stratégie.

---

## 3. ANALYSE DE RISQUE PAR PHASE

| Phase | Risque de casse | Composants impactés | Réversibilité |
|-------|----------------|---------------------|---------------|
| **Phase 0** (nettoyage BIP) | 🟢 Faible | Uniquement données B2B | Facile (backup) |
| **Phase 1** (schema adds) | 🟢 Faible | Aucun (colonnes nullable) | Facile (DROP COLUMN) |
| **Phase 2** (fn_post_stock_document) | 🔴 **Élevé** | Stock entier (6+ modules) | Difficile — rollback = restaurer l'ancienne version |
| **Phase 3** (fn_ship_commande) | 🔴 **Élevé** | B2B expédition + frontend PreparationDialog | Moyen — rollback possible |
| **Phase 4** (réception/litiges) | 🟠 Moyen | B2B réception + litiges | Moyen |
| **Phase 5** (facturation) | 🟢 Faible | Factures uniquement | Facile |
| **Phase 6** (validation) | 🟢 Aucun | Tests uniquement | N/A |

---

## 4. CE QUI MANQUE DANS LA STRATÉGIE

### A. Plan Frontend (NON DOCUMENTÉ)

La stratégie ne mentionne AUCUNE modification frontend. Or il faut :

| Fichier | Modification nécessaire |
|---------|----------------------|
| `PreparationDialog.tsx` | Ne plus envoyer `line_status` (dérivé par SQL) |
| `commandeService.ts` | Supprimer `updateLinePreparation()` ou la verrouiller |
| `commandeService.ts` | Adapter `shipCommande()` si la signature RPC change |
| `ReceptionDialog.tsx` | Adapter l'affichage si `line_status` timing change |
| `CommandeDetailDialog.tsx` | Ajouter bouton "Annuler expédition" (Phase 4.3) |
| `commandes-api/index.ts` | Adapter la logique notifications post-ship |
| `useCommandes.ts` | Adapter le type de la mutation `ship` |

### B. Plan de Rollback (NON DOCUMENTÉ)

Que fait-on si la Phase 2 casse le stock ? Il faut :
- Backup de la version actuelle de `fn_post_stock_document`
- Script de rollback prêt
- Capacité à identifier rapidement une régression

### C. Tests de Non-Régression (INSUFFISANT)

La Phase 6 mentionne "tests unitaires" mais ne précise pas :
- Tester que les modules NON-B2B (blApp, blRetrait, inventaire) fonctionnent encore après Phase 2
- Tester les notifications après Phase 3
- Tester l'affichage frontend après Phase 3

---

## 5. RECOMMANDATIONS CONCRÈTES

### Ordre d'implémentation sécurisé (modifié)

```
Phase 0: Nettoyage BIP                     → SAFE, faire en premier
Phase 1: Schema adds                       → SAFE, faire en parallèle
Phase 5: Facturation (received_qty > 0)    → SAFE, indépendant, faire tôt
Phase 3: fn_ship_commande V2               → RISQUÉ mais isolé au B2B
  → INCLURE les modifs frontend ici
Phase 4: Réception/Litiges/Annulation      → Après Phase 3 validée
Phase 2: fn_post_stock_document            → EN DERNIER, pas en premier
  → Tester sur TOUS les modules stock
Phase 6: Validation globale
```

**Changement majeur** : La Phase 2 devrait être APRÈS la Phase 3, pas avant. Pourquoi ? Parce que `fn_ship_commande` V2 peut appeler `fn_post_stock_document` tel quel — le clamp existe déjà. La modification de `fn_post_stock_document` (CLAMP_ZERO events) affecte tout le système et devrait être le dernier changement, pas le premier.

### Stratégie de feature flag

Pour minimiser le risque, on pourrait :
1. Créer `fn_ship_commande_v2` (nouveau nom) au lieu de `CREATE OR REPLACE`
2. L'edge function bascule via un flag
3. Tester en parallèle avant de supprimer V1

---

## 6. VERDICT FINAL

| Critère | Évaluation |
|---------|-----------|
| **La stratégie résout les bugs ?** | ✅ OUI — Les 11 bugs sont adressés |
| **Le design est correct ?** | ✅ OUI — Architecturalement sain |
| **L'implémentation peut casser ?** | ⚠️ **OUI** — Phases 2 et 3 sont à haut risque |
| **Le plan est complet ?** | ❌ **NON** — Frontend + rollback + tests non-régression manquent |
| **Peut-on le faire sans casser ?** | ✅ OUI — Si on réordonne les phases et qu'on ajoute les gardes manquantes |

### Score de confiance : **7/10**

La stratégie est **excellente en théorie** mais **incomplète en pratique**. Les 3 points manquants :

1. **Plan frontend détaillé** (7 fichiers à modifier)
2. **Réordonnement des phases** (Phase 2 en dernier, pas en premier)
3. **Tests de non-régression** sur les modules non-B2B après modification de `fn_post_stock_document`

### RECOMMANDATION : **GO CONDITIONNEL**

→ Implémenter **Phase 0 + Phase 1 + Phase 5** maintenant (zéro risque)
→ Puis Phase 3 avec modifications frontend
→ Puis Phase 4
→ Phase 2 en dernier avec batterie de tests complète
