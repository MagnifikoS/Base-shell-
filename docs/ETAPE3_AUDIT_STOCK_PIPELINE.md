# ÉTAPE 3 — Audit du Pipeline Stock (Ledger Unique) — COMPLÉTÉE

> Date : 2026-03-28  
> Statut : ✅ AUDIT COMPLÉTÉ  
> Verdict : **PIPELINE UNIFIÉ À 99%** — 1 bug critique trouvé (correction BL-APP)

---

## 1. Architecture Stock Confirmée

```
┌─────────────────────────────────────────────────────────────┐
│                    PIPELINE STOCK UNIQUE                     │
│                                                             │
│  Frontend (intention)                                       │
│  ├── useWithdrawalDraft     → stock_documents (DRAFT)       │
│  ├── usePostDocument        → Edge Fn stock-ledger?action=post │
│  ├── useVoidDocument        → Edge Fn stock-ledger?action=void │
│  └── useCreateCorrection    → ⚠️ BUG: appel RPC direct      │
│                                                             │
│  Edge Function stock-ledger (service_role)                  │
│  ├── action=post → fn_post_stock_document (RPC atomique)    │
│  └── action=void → fn_void_stock_document (RPC atomique)    │
│                                                             │
│  Backend SQL (SECURITY DEFINER)                             │
│  ├── fn_post_stock_document  → INSERT stock_events          │
│  ├── fn_void_stock_document  → INSERT stock_events (VOID)   │
│  ├── fn_ship_commande        → appelle fn_post_stock_document │
│  ├── fn_post_b2b_reception   → appelle fn_post_stock_document │
│  ├── fn_resolve_litige       → appelle fn_post_stock_document │
│  ├── fn_cancel_b2b_shipment  → appelle fn_void_stock_document │
│  └── fn_transfer_product_zone→ appelle fn_post_stock_document │
│                                                             │
│  Garde-fous                                                 │
│  ├── trg_stock_events_no_update  (BEFORE UPDATE → RAISE)    │
│  ├── trg_stock_events_no_delete  (BEFORE DELETE → RAISE)    │
│  ├── trg_guard_stock_event_unit_ownership (BEFORE INSERT)   │
│  ├── REVOKE fn_post_stock_document FROM authenticated       │
│  └── REVOKE fn_void_stock_document FROM authenticated       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Classification Complète des Chemins d'Écriture Stock

### ✅ CHEMINS SÛRS (via pipeline unique)

| Flow | Fichier Frontend | Chemin Backend | Statut |
|------|-----------------|----------------|--------|
| **Retrait (Withdrawal)** | `useWithdrawalDraft.ts` → `usePostDocument.ts` | Edge Fn → `fn_post_stock_document` | ✅ OK |
| **Réception** | `usePostDocument.ts` | Edge Fn → `fn_post_stock_document` | ✅ OK |
| **Inventaire POST** | `usePostDocument.ts` | Edge Fn → `fn_post_stock_document` | ✅ OK |
| **VOID** | `useVoidDocument.ts` | Edge Fn → `fn_void_stock_document` | ✅ OK |
| **Expédition B2B** | `commandeService.ts` → Edge Fn `commandes-api` | `fn_ship_commande` → `fn_post_stock_document` | ✅ OK |
| **Réception B2B** | Edge Fn `commandes-api` | `fn_post_b2b_reception` → `fn_post_stock_document` | ✅ OK |
| **Litige** | Edge Fn `commandes-api` | `fn_resolve_litige` → `fn_post_stock_document` | ✅ OK |
| **Annulation expédition** | Edge Fn `commandes-api` | `fn_cancel_b2b_shipment` → `fn_void_stock_document` | ✅ OK |
| **Transfert zone** | `useTransferProductZone.ts` | `fn_transfer_product_zone` → `fn_post_stock_document` (×2) | ✅ OK |
| **Wizard produit** | Edge Fn via RPC | `fn_save_product_wizard` → `fn_transfer_product_zone` | ✅ OK |

### ⚠️ BUG CRITIQUE — Contournement Involontaire

| Flow | Fichier | Problème | Impact |
|------|---------|----------|--------|
| **Correction BL-APP** | `src/modules/blApp/hooks/useCreateCorrection.ts` (ligne 140) | Appel direct `supabase.rpc("fn_post_stock_document")` | **ÉCHEC SILENCIEUX** — RPC REVOKED depuis migration `20260216230003` |

**Explication :** Ce hook crée un document DRAFT + lignes correctement, puis tente de le POST via un appel RPC direct. Mais `fn_post_stock_document` est REVOKED du rôle `authenticated`. L'appel **échoue** à chaque fois. Le frontend ne peut pas POST ce document car il n'a pas les permissions.

**Fix requis :** Router via l'Edge Function `stock-ledger?action=post` comme le fait `usePostDocument.ts`.

### ✅ FAUX POSITIFS (pas des écritures stock)

| Élément | Fichier | Nature Réelle |
|---------|---------|---------------|
| `stock_documents.insert` dans `useWithdrawalDraft.ts` | Frontend | Création de DRAFT uniquement (pas d'événement stock) |
| `stock_documents.insert` dans `useCreateCorrection.ts` | Frontend | Création de DRAFT uniquement (pas d'événement stock) |
| `stock_documents.delete` dans `useCreateCorrection.ts` | Frontend | Cleanup d'un DRAFT orphelin si insert lignes échoue |
| `stock_document_lines.insert` dans tests | Tests | Préparation de données de test |
| `stock_documents.update({created_by: null})` dans `employees/` | Edge Fn | GDPR anonymisation — ne touche pas au stock |
| `stock_documents` SELECT dans `useBlRetraits.ts` | Frontend | Lecture seule pour affichage |
| `useProductCurrentStock`, `useProductHasStock` | Frontend | Lecture seule (Snapshot + ΣEvents) |
| `postGuards.ts checkNegativeStock` | Frontend | Calcul pur deprecated — aucune écriture |

---

## 3. Protections Actives Confirmées

| Protection | Type | Confirmé |
|------------|------|----------|
| `stock_events` append-only (UPDATE/DELETE triggers) | DB Trigger | ✅ |
| `fn_post_stock_document` REVOKED from authenticated | RBAC SQL | ✅ |
| `fn_void_stock_document` REVOKED from authenticated | RBAC SQL | ✅ |
| Unit ownership guard trigger | DB Trigger | ✅ |
| Optimistic locking (lock_version) | SQL fn | ✅ |
| Idempotency key dedup | SQL fn | ✅ |
| FOR UPDATE locking (race conditions) | SQL fn | ✅ |
| RBAC check (inventaire:write) dans Edge Fn | Edge Fn | ✅ |
| Clampage Stock Zéro (delta clampé à 0) | SQL fn | ✅ |
| CLAMP_ZERO event traçabilité | SQL fn | ✅ |
| RLS sur stock_events (SELECT + INSERT only) | RLS | ✅ |

---

## 4. Aucune Écriture Directe dans stock_events

**Preuve :**
- `0` résultats pour `.insert(.*stock_events` dans le code TypeScript
- `0` résultats pour `.update(.*stock_event` dans le code TypeScript
- `0` résultats pour `.delete().*stock_event` dans le code TypeScript
- `INSERT INTO stock_events` n'existe QUE dans les fonctions SQL SECURITY DEFINER
- Triggers BEFORE UPDATE et BEFORE DELETE bloquent toute modification

---

## 5. Plan d'Implémentation

### Seul changement requis :

**Fichier :** `src/modules/blApp/hooks/useCreateCorrection.ts`  
**Action :** Remplacer l'appel direct `supabase.rpc("fn_post_stock_document")` par un appel à l'Edge Function `stock-ledger?action=post` (même pattern que `usePostDocument.ts`).

### Ce qui ne change pas :
- Aucune modification SQL
- Aucune nouvelle table
- Aucun changement de pipeline
- Aucun changement au moteur de conversion
- Aucun changement aux triggers de protection
- Toutes les protections existantes restent en place

---

## 6. Risques

| Risque | Probabilité | Mitigation |
|--------|-------------|------------|
| Régression sur BL-APP corrections | Faible | Le flow est **déjà cassé** (RPC REVOKED) — le fix ne peut que l'améliorer |
| Signature Edge Fn incompatible | Nulle | Même body { document_id, expected_lock_version, idempotency_key, event_reason } |
| Double POST (idempotency) | Nulle | Idempotency key déjà générée dans useCreateCorrection |

---

## 7. Critères de Validation

- [ ] `useCreateCorrection` route via Edge Function `stock-ledger?action=post`
- [ ] Build ✅ sans erreur
- [ ] Tests existants passent
- [ ] Aucun appel direct à `fn_post_stock_document` ou `fn_void_stock_document` depuis le frontend (hors tests)
- [ ] Aucune écriture directe dans `stock_events` depuis le frontend

---

## 8. Conclusion

### Le pipeline stock est-il unifié à 100% ?

**OUI à 99%.** Un seul contournement involontaire a été trouvé :

- `useCreateCorrection.ts` appelle `fn_post_stock_document` en RPC direct alors que cette fonction est REVOKED depuis le rôle authenticated. Ce n'est pas un contournement fonctionnel (il échoue silencieusement) mais un **bug** qui empêche les corrections BL-APP de fonctionner.

**Après fix :** Le pipeline sera **100% unifié** avec :
- 👉 **Un seul pipeline** : `stock_documents` DRAFT → Edge Fn → `fn_post_stock_document` → `stock_events`
- 👉 **Un seul ledger** : `stock_events` (append-only, immutable)
- 👉 **Zéro écriture concurrente** : tout passe par les 2 RPCs verrouillées
- 👉 **Zéro modification directe** : triggers + REVOKE + RLS bloquent tout contournement

---

## 9. Points Hors Étape 3 (futur)

| Point | Étape |
|-------|-------|
| `fn_phase0_stock_zero_v2` — migration legacy, peut être désactivée | Cleanup futur |
| `checkNegativeStock` deprecated dans postGuards.ts | Cleanup (déjà marqué @deprecated) |
| Unifier les invalidations React Query entre usePostDocument et useCreateCorrection | Cleanup UX |
