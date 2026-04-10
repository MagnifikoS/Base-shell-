# STRATÉGIE DE CORRECTION — CAS 1 : Stock fiable

**Date :** 2026-03-14
**Base :** Croisement audit cas 1 + stratégie externe + re-vérification code

---

## 1. Validation croisée : la stratégie externe est-elle correcte ?

### Point 1 — « Supprimer le comportement silencieux dangereux »

**Verdict : ✅ CONFIRMÉ — aligné à 100% avec la faille F1 de l'audit.**

- **Preuve dans le code** : `COALESCE(v_line->>'client_canonical_family', 'count')` dans la migration active `20260228195700`, ligne 276.
- **Le même pattern existe dans 13 migrations** (historique de la RPC `fn_post_b2b_reception`), toutes avec le fallback `'count'`.
- **Ce fallback est le seul point d'entrée identifié** capable de polluer le ledger `stock_events` avec une famille incohérente.
- **Impact réel** : un produit `weight` (kg) recevrait un événement `count` → le StockEngine frontend l'ignore → stock sous-estimé silencieusement.

### Point 2 — « Forcer une seule lecture cohérente »

**Verdict : ✅ CONFIRMÉ — aligné à 100% avec la faille F4 de l'audit.**

- **Preuve dans le code** : `src/hooks/useProductCurrentStock.ts`, lignes 64-76.
- Le hook somme **tous** les `delta_quantity_canonical` sans filtre `canonical_family`.
- Le lecteur principal `useEstimatedStock` utilise le `StockEngine` qui **filtre** par `canonical_family`.
- **Divergence prouvée** : si F1 se déclenche, `useProductCurrentStock` (drawer produit, UniversalQuantityModal) et `useEstimatedStock` (liste stock) afficheraient des valeurs différentes pour le même produit.
- **9 fichiers** utilisent `useProductCurrentStock` : ReceptionView, MobileReceptionView, WithdrawalView, MobileWithdrawalView, MobileInventoryView, BlRetraitCorrectionDialog, et 3 autres.

### Point 3 — « Ne surtout pas refactorer »

**Verdict : ✅ CRITIQUE — totalement aligné avec l'analyse de risque.**

- La formule SSOT `Stock = Snapshot + Σ(events WHERE snapshot_version_id = actif)` est **respectée par les 7 lecteurs et les 8 écrivains** identifiés.
- Les flux standard (réception, retrait, ajustement, inventaire, void) sont **conformes à 100%**.
- Score de confiance stock : **9/10** — le 1 point perdu est exclusivement sur le flux B2B.
- **Toucher aux flux standard serait une régression** — le risque est strictement localisé.

---

## 2. Angles morts vérifiés (non couverts par la stratégie externe)

### Angle mort A — Divergence backend/frontend sur le check négatif (faille F2)

La stratégie externe ne mentionne pas explicitement ce point :

- **`fn_post_stock_document`** (CTE `current_estimates`) somme TOUS les événements du snapshot **sans filtre `canonical_family`** pour vérifier le stock négatif.
- **Le `StockEngine` frontend** filtre par `canonical_family`.
- **Conséquence** : si F1 s'est déclenché, le backend autorise un retrait sur un stock qu'il voit plus élevé que le frontend.

**Mon avis** : Cet angle mort est **réel mais secondaire**. Si on ferme F1 (point 1), F2 ne peut plus se déclencher car aucun événement avec une mauvaise famille ne peut plus être écrit. **Il n'a pas besoin d'être corrigé immédiatement** si F1 est fermé. Il reste un « nice to have » pour la cohérence architecturale.

### Angle mort B — Limite 10 000 événements (faille F3)

- `useEstimatedStock` tronque à 10 000 événements par zone.
- **Pour 2-3 restaurants avec inventaires réguliers** : impossible d'atteindre ce seuil.
- **Pas un risque MVP.** À surveiller post-launch uniquement.

### Angle mort C — Pas de faille cachée supplémentaire

J'ai re-vérifié :

| Vérification | Résultat |
|---|---|
| RLS sur `stock_events` bloque INSERT direct | ✅ Confirmé (migration `20260217140001`) |
| Tous les écrivains passent par SECURITY DEFINER | ✅ 8/8 écrivains vérifiés |
| `fn_complete_inventory_session` fait UPSERT atomique | ✅ Confirmé |
| Index unique 1 session active par zone | ✅ `uq_inventory_sessions_one_active_per_zone` |
| `fn_void_stock_document` crée des inverses exacts | ✅ Confirmé |
| Verrouillage optimiste `lock_version` | ✅ Sur tous les documents |
| Idempotence via `idempotency_key` | ✅ Sur `fn_post_stock_document` |
| Concurrence inventaire+réception | ✅ Comportement correct (événement rattaché au bon snapshot) |

**Aucun angle mort supplémentaire détecté.**

---

## 3. Ma stratégie de correction recommandée

### Correction obligatoire avant production : 2 interventions

#### C1 — Fermer le fallback silencieux (F1)

**Quoi :** Dans `fn_post_b2b_reception`, remplacer :
```
COALESCE(v_line->>'client_canonical_family', 'count')
```
par une validation stricte qui lève une exception si `client_canonical_family` est NULL.

**Périmètre exact :**
- **1 seule RPC** : `fn_post_b2b_reception`
- **1 seule ligne** à modifier dans la migration active
- **0 impact** sur les 7 autres écrivains stock
- **0 impact** sur les flux standard (réception manuelle, retrait, ajustement, inventaire)

**Preuve que c'est safe :**
- Le frontend B2B (`src/modules/clientsB2B/`) construit déjà `client_canonical_family` dans le payload
- Si le champ manque, c'est un bug frontend qui DOIT être détecté, pas masqué

#### C2 — Aligner `useProductCurrentStock` sur le StockEngine (F4)

**Quoi :** Ajouter le filtre `canonical_family` dans `useProductCurrentStock.ts` pour que la somme des événements ignore les événements de famille incompatible, exactement comme le fait le `StockEngine`.

**Périmètre exact :**
- **1 seul fichier** : `src/hooks/useProductCurrentStock.ts`
- **Lignes 64-76** : ajouter un filtre sur `canonical_family` lors de la boucle de sommation
- **0 impact** sur le `StockEngine` (déjà conforme)
- **0 impact** sur `useEstimatedStock` (déjà conforme)
- **0 impact** sur les autres lecteurs (déjà conformes)

**Preuve que c'est safe :**
- Ce hook est en lecture seule — il ne modifie aucune donnée
- Le changement ne fait qu'aligner son comportement sur le lecteur principal

### Ce qui ne doit PAS être touché

| Interdit | Raison |
|---|---|
| `stockEngine.ts` | Déjà conforme à 100% |
| `useEstimatedStock.ts` | Déjà conforme à 100% |
| `fn_post_stock_document` | Déjà conforme (F2 devient inerte si F1 est fermé) |
| `fn_complete_inventory_session` | Déjà conforme à 100% |
| `fn_void_stock_document` | Déjà conforme à 100% |
| `fn_ship_commande` | Déjà conforme à 100% |
| `fn_quick_adjustment` | Déjà conforme à 100% |
| Tout fichier de flux standard | Aucun n'est concerné par les failles identifiées |

### Ordre d'exécution

1. **D'abord C1** (backend) — ferme la source de pollution
2. **Ensuite C2** (frontend) — harmonise la lecture
3. **Pas de C3** immédiat — `fn_post_stock_document` n'a pas besoin d'être modifié si F1 est fermé

---

## 4. Preuves exigées après correction

### Pour C1 :

- [ ] Montrer le diff exact (1 seule ligne modifiée dans la RPC)
- [ ] Confirmer qu'un payload B2B sans `client_canonical_family` lève une exception claire
- [ ] Confirmer que le payload B2B normal (avec le champ) continue de fonctionner
- [ ] Confirmer que les 7 autres écrivains stock ne sont pas affectés (aucun fichier modifié)

### Pour C2 :

- [ ] Montrer le diff exact dans `useProductCurrentStock.ts`
- [ ] Confirmer que le hook requête maintenant `canonical_family` depuis les events
- [ ] Confirmer que les événements de famille incompatible sont ignorés
- [ ] Confirmer que le stock affiché dans UniversalQuantityModal correspond au stock de la liste principale
- [ ] Confirmer que les 6 autres lecteurs ne sont pas modifiés

### Anti-bricolage :

- [ ] Liste exhaustive des fichiers modifiés (doit être ≤ 2 fichiers + 1 migration)
- [ ] Confirmation que `stockEngine.ts` n'a PAS été modifié
- [ ] Confirmation que `useEstimatedStock.ts` n'a PAS été modifié
- [ ] Confirmation que les flux standard (réception, retrait, ajustement, inventaire) n'ont PAS été modifiés

---

## 5. Verdict final

| Question | Réponse |
|---|---|
| La stratégie externe est-elle correcte ? | ✅ Oui, alignée à 100% sur les failles réelles |
| Y a-t-il des angles morts ? | 1 angle mort mineur (F2), non bloquant si F1 est fermé |
| Le risque est-il bloquant pour le MVP ? | Non — le frontend envoie déjà le bon champ, le risque est conditionnel |
| Faut-il corriger avant production ? | Oui — par principe de sécurité (fermer le fallback) |
| La correction est-elle minimale et chirurgicale ? | Oui — 2 interventions, ≤ 2 fichiers + 1 migration SQL |
| Risque de régression ? | Quasi nul — aucun flux standard n'est touché |

**Confiance dans la stratégie : 10/10**
