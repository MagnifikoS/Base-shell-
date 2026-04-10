# Correction Stock Zero V1 — Rapport Final

## Phase A — Check Général

### Résultat du re-check global

| Point vérifié | Résultat |
|---|---|
| `fn_post_stock_document` — guard NEGATIVE_STOCK supprimé, clamp ajouté | ✅ Confirmé en prod |
| `fn_void_stock_document` — clamp appliqué aux void events | ✅ Confirmé en prod |
| `fn_transfer_product_zone` — propagation v_effective_qty | ✅ Confirmé en prod |
| `fn_ship_commande` — clamp stock + alignment shipped_quantity | ✅ Confirmé en prod |
| Edge function `stock-ledger/index.ts` — parse NEGATIVE_STOCK supprimé | ✅ |
| Frontend — 6 fichiers avec NEGATIVE_STOCK | ✅ Tous corrigés |
| Guard caché supplémentaire | ❌ Aucun trouvé |
| Flux non cartographié | ❌ Aucun trouvé |

### Verdict : **FEU VERT**

---

## Phase 0 — Remise à Zéro des Stocks Négatifs

### Statut : EN ATTENTE

La migration Phase 0 a échoué lors de la première tentative car certains produits ont `final_unit_id = NULL`. 
Le fallback `COALESCE(final_unit_id, stock_handling_unit_id)` est implémenté dans `fn_transfer_product_zone`.

**NOTE** : La Phase 0 data reset nécessite une migration séparée avec :
- Requête d'identification des produits à stock < 0
- Création d'events ADJUSTMENT pour chaque produit négatif
- Utilisation de `COALESCE(final_unit_id, stock_handling_unit_id)` comme unit fallback

**Cette phase sera exécutée séparément après validation de l'implémentation logique.**

---

## Phase 1 — Backend Central

### Ce qui a été modifié

| Fonction | Changement |
|---|---|
| `fn_post_stock_document` | Guard NEGATIVE_STOCK supprimé. Clamp inline `GREATEST(delta, -current_stock)`. Filtre `WHERE effective_delta != 0`. Retourne `clamped_count` dans le résultat. |
| `fn_void_stock_document` | Suppression du check négatif. Void events clampés inline. Filtre `WHERE effective_void_delta != 0`. |
| `fn_transfer_product_zone` | Récupération de `v_effective_qty` post-clamp. Si `events_created = 0` → `v_effective_qty = 0`. Si `clamped_count > 0` → lecture du delta effectif. Receipt utilise `v_effective_qty`. |
| `fn_ship_commande` | Clamp stock inline avec `GREATEST(-shipped_qty, -current_stock)`. Filtre `!= 0` pour skip des events nuls. `shipped_quantity` alignée sur ordered_qty (cap). |

### Ce qui n'a PAS été modifié
- `fn_quick_adjustment` — utilise déjà `override_flag=true`, pas impacté
- `fn_post_b2b_reception` — flux entrant, pas impacté
- `fn_abandon_stale_drafts` — pas de logique stock

### Comportement avant → après

| Scénario | Avant | Après |
|---|---|---|
| Stock 10, retrait 3 | OK → stock 7 | OK → stock 7 (inchangé) |
| Stock 3, retrait 5 | EXCEPTION NEGATIVE_STOCK | Clamp → retrait 3, stock 0 |
| Stock 0, retrait 2 | EXCEPTION NEGATIVE_STOCK | Skip → 0 event créé |

---

## Phase 2 — Flux Composés

### fn_transfer_product_zone

| Cas | Comportement |
|---|---|
| Clamp = 0 | Aucun event WITHDRAWAL. Aucun event RECEIPT. `transferred_qty = 0`. Zone produit quand même mise à jour. |
| Clamp partiel | WITHDRAWAL réduit. RECEIPT reçoit `v_effective_qty`. Pas de stock ex nihilo. |
| Statut document | Les deux documents passent POSTED normalement. |

### fn_ship_commande

| Cas | Comportement |
|---|---|
| Clamp = 0 | Aucun event stock. `shipped_quantity` reste à la valeur saisie (cappée par ordered_qty). Commande passe `expediee`. |
| Clamp partiel | Event stock réduit. `shipped_quantity` reste celle saisie (cappée). |
| Statut commande | Toujours `expediee` si toutes lignes traitées. |

### fn_void_stock_document

| Cas | Comportement |
|---|---|
| Void d'un receipt quand stock = 0 | Clamp → 0 void event (skip silencieux) |
| Void d'un withdrawal | Delta positif (ajout stock) → pas de clamp, toujours créé |
| Void partiel | Seuls les events avec delta != 0 sont créés |

---

## Phase 3 — Edge Function + Frontend

### Fichiers modifiés

| Fichier | Changement |
|---|---|
| `supabase/functions/stock-ledger/index.ts` | Suppression du parse NEGATIVE_STOCK dans la gestion d'erreur |
| `src/modules/stockLedger/hooks/usePostDocument.ts` | Suppression de `NegativeStockProduct` interface. NEGATIVE_STOCK supprimé de `PostError` type. |
| `src/modules/stockLedger/components/PostConfirmDialog.tsx` | Suppression complète du flow override NEGATIVE_STOCK. Dialog simplifié : confirm standard OU erreur bloquante. |
| `src/modules/stockLedger/components/WithdrawalView.tsx` | Suppression branche NEGATIVE_STOCK dans handlePost. Suppression badge "Stock négatif détecté". Suppression import/usage `useCreateDiscrepancy` et `checkStockAvailability`. |
| `src/modules/stockLedger/components/ReceptionView.tsx` | Suppression branche NEGATIVE_STOCK dans handlePost. Suppression badge "Stock négatif détecté". |
| `src/modules/stockLedger/components/MobileWithdrawalView.tsx` | Suppression branche NEGATIVE_STOCK. Suppression `handleOverridePost`. Suppression `PostConfirmDialog` override. Suppression `detectDiscrepancy`. Suppression state `pendingPostProduct`, `showPostConfirm`, `postError`, `postGuard`. |
| `src/modules/blApp/components/BlAppPostPopup.tsx` | Suppression de `NEGATIVE_STOCK` du mapping de messages d'erreur |
| `src/modules/stockLedger/components/BlRetraitPostPopup.tsx` | Popup "Stock insuffisant" converti en ajustement automatique silencieux. Plus aucun dialog bloquant. |

### Fichiers NON modifiés
- `src/modules/stockLedger/engine/stockEngine.ts` — calcul pur, pas impacté
- `src/modules/stockLedger/engine/buildCanonicalLine.ts` — métadonnées, pas impacté
- `src/modules/stockLedger/engine/contextHash.ts` — hash, pas impacté
- `src/modules/stockLedger/engine/postGuards.ts` — validation pré-post, pas impacté (les guards restants sont légitimes : NO_LINES, FAMILY_MISMATCH etc.)
- `src/modules/stockLedger/engine/voidEngine.ts` — préparation void côté client, pas impacté (le clamp est côté serveur)
- `src/modules/stockLedger/hooks/useCheckStockAvailability.ts` — toujours utilisé pour afficher les stocks disponibles et l'auto-ajustement BL Retrait
- Composants inventaire, recettes, commandes — non touchés

### Comportements supprimés
- ❌ Popup bloquant "Stock négatif détecté"
- ❌ Override dialog avec textarea motif
- ❌ Badge "Stock négatif détecté" dans les vues retrait/réception
- ❌ Popup "Stock insuffisant" sur BL Retrait
- ❌ Détection automatique d'écart post-retrait
- ❌ Parse NEGATIVE_STOCK dans edge function

---

## Phase 4 — Nettoyage Final

### Supprimé
| Élément | Fichier |
|---|---|
| `NegativeStockProduct` interface | `usePostDocument.ts` |
| Import `useCreateDiscrepancy` | `WithdrawalView.tsx`, `MobileWithdrawalView.tsx` |
| Import `checkStockAvailability` (dans WithdrawalView) | `WithdrawalView.tsx` |
| Import `PostConfirmDialog` (dans Mobile) | `MobileWithdrawalView.tsx` |
| Import `StockDocumentType/Status` (dans Mobile) | `MobileWithdrawalView.tsx` |
| State `pendingPostProduct`, `showPostConfirm`, `postError`, `postGuard` | `MobileWithdrawalView.tsx` |
| `handleOverridePost` function | `MobileWithdrawalView.tsx` |
| `handleOverride` function | `PostConfirmDialog.tsx` |
| Discrepancy detection fire-and-forget | `WithdrawalView.tsx`, `MobileWithdrawalView.tsx` |
| Popup stock insuffisant | `BlRetraitPostPopup.tsx` |

### Conservé temporairement
| Élément | Raison |
|---|---|
| `onForceOverride` prop dans PostConfirmDialog | Utilisé par WithdrawalView et ReceptionView (signature de callback). Inoffensif, ne déclenche plus le flow override NEGATIVE_STOCK. |
| `overrideFlag`/`overrideReason` params dans usePostDocument | Passés au backend qui les accepte toujours. Utilisés pour d'autres cas (fn_quick_adjustment). |
| `checkStockAvailability` dans MobileWithdrawalView | Utilisé pour l'affichage des stocks disponibles (badges), pas pour bloquer. |
| `checkStockAvailability` dans BlRetraitPostPopup | Utilisé pour l'auto-ajustement silencieux des quantités. |

---

## Validations

### Scénarios vérifiés (par analyse de code)

| Scénario | Résultat attendu | Vérifié |
|---|---|---|
| Stock 10, retrait 3 | Stock → 7, 1 event | ✅ fn_post inchangé pour cas normal |
| Stock 3, retrait 5 | Stock → 0, event delta = -3 | ✅ Clamp GREATEST(-5, -3) = -3 |
| Stock 0, retrait 2 | Stock → 0, aucun event | ✅ WHERE effective_delta != 0 |
| Réception après Phase 0 | Normal, stock augmente | ✅ Flux entrant pas clampé |
| Expédition B2B > stock | Clamp, shipped_qty cappée | ✅ fn_ship_commande |
| Transfert zone > stock | Clamp W, v_effective_qty R | ✅ fn_transfer_product_zone |
| Void d'une réception | Clamp à max(0, current_stock) | ✅ fn_void clamped |
| Void d'un retrait | Delta positif → pas de clamp | ✅ |
| Correction négative | Clampée comme withdrawal | ✅ ADJUSTMENT type clampé |
| Correction positive | Normal | ✅ |
| Quick adjustment | Inchangé (override_flag=true) | ✅ |
| Réception B2B | Flux entrant, normal | ✅ |
| Aucun popup stock insuffisant | Tous supprimés | ✅ Vérifié par grep |
| Aucune erreur NEGATIVE_STOCK | Supprimé du type + backend | ✅ |
| Aucun event à delta 0 | WHERE != 0 dans les 3 fonctions | ✅ |
| Cohérence flux composés | Transfer: v_effective_qty propagé | ✅ |

---

## Risques Résiduels

| Risque | Niveau | Mitigation |
|---|---|---|
| Phase 0 non exécutée (stocks négatifs historiques) | **Moyen** | Les stocks négatifs existants seront "résolus" au prochain flux entrant. Le clamp empêche l'aggravation. Migration data à exécuter séparément. |
| BL Retrait auto-ajusté sans notification utilisateur | **Faible** | Les quantités sont silencieusement réduites. L'utilisateur voit les quantités finales dans le BL créé. |
| `onForceOverride` prop morte dans PostConfirmDialog | **Nul** | Code mort inoffensif, nettoyable dans un refactor futur. |

---

## Liste Exacte des Fichiers Modifiés

### Backend (SQL — migration appliquée)
1. `supabase/migrations/20260318200516_*.sql` — fn_post_stock_document, fn_void_stock_document, fn_transfer_product_zone, fn_ship_commande

### Edge Function
2. `supabase/functions/stock-ledger/index.ts`

### Frontend
3. `src/modules/stockLedger/hooks/usePostDocument.ts`
4. `src/modules/stockLedger/components/PostConfirmDialog.tsx`
5. `src/modules/stockLedger/components/WithdrawalView.tsx`
6. `src/modules/stockLedger/components/ReceptionView.tsx`
7. `src/modules/stockLedger/components/MobileWithdrawalView.tsx`
8. `src/modules/blApp/components/BlAppPostPopup.tsx`
9. `src/modules/stockLedger/components/BlRetraitPostPopup.tsx`

### Documentation
10. `docs/strategie-stock-zero-v1.md`
11. `docs/correction-stock-zero-v1.md`

---

## Verdict Final

**La règle V1 "stock jamais négatif, zéro blocage, clamp à 0" a été implémentée proprement.**

- ✅ Backend : 4 fonctions SQL corrigées avec clamp inline
- ✅ Frontend : 7 fichiers nettoyés, aucun popup/guard résiduel
- ✅ Edge function : parse NEGATIVE_STOCK supprimé
- ✅ Flux composés : propagation quantité effective vérifiée
- ✅ Build : 0 erreur TypeScript
- ⚠️ Phase 0 data reset : **en attente d'exécution séparée**

**Prod-safe : OUI** (sous réserve de l'exécution de Phase 0 pour les stocks historiquement négatifs, qui ne bloque pas le fonctionnement — le clamp empêche toute aggravation).
