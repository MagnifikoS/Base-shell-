# Audit DLC V0 — Rapport Final

> Date : 2026-03-06
> Statut : ✅ Implémentation complète — Aucune régression détectée

---

## 1. Cartographie finale « qui écrit quoi »

| Donnée | SSOT (table) | Qui écrit | Quand | Impact stock |
|--------|-------------|-----------|-------|-------------|
| Quantités reçues | `commande_lines.received_quantity` | RPC `fn_receive_commande` | Réception | ✅ Oui (ledger) |
| Écarts quantité | `litiges` + `litige_lines` | RPC `fn_receive_commande` (auto) | Réception partielle | ✅ Oui (à résolution) |
| DLC par lot | `reception_lot_dlc` | `dlcService.ts` (client JS) | Après RPC réception | ❌ Non |
| Signalement qualité | `product_returns` | `retourService.ts` + `useCreateReturn` | Pendant ou après réception | ❌ Non |
| Photos retour | `product_return_photos` + bucket `return-photos` | `retourService.ts` | Avec le signalement | ❌ Non |
| Alertes/Notifs | `notification_events` via `notification_rules` | Edge function `commandes-api` | Cycle de vie commande | ❌ Non |

### Séparation des sources de vérité

| Concept | Source de vérité | Module | Rôle |
|---------|-----------------|--------|------|
| **Date DLC d'un lot** | `reception_lot_dlc.dlc_date` | DLC | La **mesure** (donnée factuelle) |
| **Statut DLC** | `computeDlcStatus()` dans `dlcCompute.ts` | DLC | Le **calcul** (dérivé de la mesure + seuil) |
| **Seuil d'alerte** | `products_v2.dlc_warning_days` (fallback: 3 jours) | Produits V2 | La **configuration** |
| **Refus pour DLC** | `product_returns` (types `dlc_depassee`, `dlc_trop_proche`) | Retours | Le **signalement** (action corrective) |
| **Notifications DLC** | Non implémenté en V0 (reporté) | — | — |

---

## 2. Liste des fichiers touchés

### Fichiers créés

| Fichier | Rôle |
|---------|------|
| `src/modules/dlc/lib/dlcCompute.ts` | Logique pure SSOT : `computeDlcStatus`, `computeDlcDaysRemaining`, `formatDlcDate`, `dlcUrgencyComparator` |
| `src/modules/dlc/components/DlcReceptionSummaryDialog.tsx` | Popup de synthèse DLC avant validation réception |
| `src/modules/dlc/components/DlcCritiquePage.tsx` | Vue de surveillance DLC critique (lecture seule) |
| `src/modules/dlc/hooks/useDlcCritique.ts` | Hook query pour la vue DLC critique |
| `src/pages/DlcCritique.tsx` | Page wrapper (thin) |

### Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `src/modules/dlc/components/DlcBadge.tsx` | Refactor : import `computeDlcStatus` + `formatDlcDate` depuis `dlcCompute.ts` au lieu de logique inline. Re-export pour rétrocompatibilité. |
| `src/modules/dlc/index.ts` | Barrel export mis à jour : ajout des exports SSOT, DlcReceptionSummaryDialog, DlcCritiquePage, useDlcCritique |
| `src/modules/commandes/components/ReceptionDialog.tsx` | Intégration popup DLC + branchement refus → module Retours |
| `src/config/navRegistry.ts` | Ajout item `dlc-critique` (icon ShieldAlert, moduleKey "commandes", order 106.5) |
| `src/config/sidebarSections.ts` | Ajout `dlc-critique` dans section "Stock & Achats" après "commandes" |
| `src/routes/AppRoutes.tsx` | Ajout route `/dlc-critique` avec lazy loading + PermissionGuard |

### Fichiers NON modifiés (vérification explicite)

| Fichier / Zone | Statut |
|----------------|--------|
| RPC `fn_receive_commande` | ❌ Non modifié |
| RPC `fn_ship_commande` | ❌ Non modifié |
| RPC `fn_resolve_litige` | ❌ Non modifié |
| Tables `litiges` / `litige_lines` | ❌ Non modifié |
| Stock Ledger (`stock_events`) | ❌ Non modifié |
| Module Litiges (`src/modules/litiges/`) | ❌ Non modifié |
| Module Retours (`src/modules/retours/`) | ❌ Non modifié (réutilisé, pas modifié) |
| `notification_rules` / `notification_events` | ❌ Non modifié |
| `supabase/functions/` | ❌ Aucune edge function créée ou modifiée |
| Migrations SQL | ❌ Aucune migration créée |

---

## 3. Architecture implémentée

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOGIQUE SSOT (étape 1)                       │
│            src/modules/dlc/lib/dlcCompute.ts                    │
│  computeDlcStatus() · computeDlcDaysRemaining() ·               │
│  formatDlcDate() · dlcUrgencyComparator()                       │
└────────┬──────────────┬──────────────┬──────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌────────────────┐ ┌──────────────┐ ┌──────────────────────────┐
│  DlcBadge      │ │ Popup DLC    │ │  Vue DLC critique        │
│  (existant,    │ │ (étape 2)    │ │  (étape 4)               │
│   refactoré)   │ │ avant récep. │ │  lecture seule            │
└────────────────┘ └──────┬───────┘ └──────────────────────────┘
                          │
                   Refus? │
                          ▼
                  ┌───────────────────────────────────┐
                  │  Module Retours existant (étape 3) │
                  │  useCreateReturn()                 │
                  │  type: dlc_depassee / dlc_trop_proche │
                  │  reasonComment prérempli            │
                  └───────────────────────────────────┘
```

---

## 4. Flux détaillé à la réception

```
Clic "Valider réception"
         │
         ▼
   Des DLC proches ou expirées ?
         │
    ┌────┴────┐
    │ Non     │ Oui
    ▼         ▼
  Confirm   Popup DLC synthèse
  standard  ┌──────────────────┐
            │ Section rouge :   │
            │   DLC dépassée    │
            │ Section orange :  │
            │   DLC proche      │
            │                  │
            │ Par ligne :      │
            │  [Accepté] [Refusé] │
            └────────┬─────────┘
                     │
                     ▼
              Confirm standard
                     │
                     ▼
            RPC fn_receive_commande (inchangée)
                     │
                     ▼
            DLC batch upsert (reception_lot_dlc)
                     │
                     ▼
            Lignes refusées ?
            ┌────┴────┐
            │ Non     │ Oui
            ▼         ▼
          Fin     createReturn() × N
                  type: dlc_depassee / dlc_trop_proche
                  reasonComment prérempli
                     │
                     ▼
                   Toast info
                   "X retour(s) créé(s) pour DLC"
```

**Important** : la réception réussit toujours, même si l'utilisateur accepte des produits expirés. Le système est **non bloquant** en V0.

---

## 5. Point RBAC — moduleKey "commandes"

### Choix actuel

La vue `/dlc-critique` utilise `PermissionGuard moduleKey="commandes"`.

### Justification

- La DLC est un sous-ensemble fonctionnel du flux commandes/réception
- Les données viennent de `reception_lot_dlc`, liées aux `commande_lines`
- En V0, créer un module RBAC dédié (`module_dlc`) serait une sur-ingénierie
- Tout utilisateur qui peut réceptionner des commandes a besoin de voir les DLC critiques

### Évolution future (V1+)

Si un rôle "gestionnaire stock" distinct émerge, il faudra :
1. Ajouter un module `dlc` ou `stock_surveillance` dans la table `modules`
2. Créer les permissions associées
3. Changer `moduleKey="commandes"` → `moduleKey="dlc"` dans navRegistry + route

**Aucune action requise en V0.**

---

## 6. Validation d'isolation

### Le module DLC reste supprimable

Pour supprimer complètement le module DLC :

1. `rm -rf src/modules/dlc/`
2. Retirer les imports DLC dans `ReceptionDialog.tsx` (~30 lignes)
3. Retirer les imports DLC dans `CommandeDetailDialog.tsx` (~15 lignes)
4. Retirer `src/pages/DlcCritique.tsx`
5. Retirer la route `/dlc-critique` dans `AppRoutes.tsx`
6. Retirer `dlc-critique` dans `navRegistry.ts` et `sidebarSections.ts`
7. `DROP TABLE reception_lot_dlc;`
8. `ALTER TABLE products_v2 DROP COLUMN dlc_warning_days;`

### Le module Retours n'a pas été modifié

- `useCreateReturn` est **appelé**, pas modifié
- Aucun nouveau type, hook ou service créé dans le module Retours
- Les types `dlc_depassee` et `dlc_trop_proche` existaient déjà dans `ReturnType`

### Aucune double vérité

| Question | Réponse |
|----------|---------|
| Y a-t-il une table "alertes DLC" ? | Non |
| Y a-t-il un "module refus DLC" ? | Non — le module Retours est réutilisé |
| Y a-t-il une logique DLC dupliquée ? | Non — `dlcCompute.ts` est le SSOT unique |
| Y a-t-il un cron ou scheduler ? | Non (reporté, hors V0) |
| Y a-t-il une nouvelle edge function ? | Non |

---

## 7. Scénarios E2E

| # | Scénario | Résultat attendu | Couvert par |
|---|----------|-------------------|-------------|
| 1 | Produit reçu avec DLC OK | Réception normale, DLC enregistrée, aucun popup, aucun retour | Popup (pas de déclenchement) |
| 2 | Produit reçu avec DLC proche → **accepté** | Popup affiché, clic "Accepté", réception normale, DLC enregistrée, aucun retour | Popup + handleReceive |
| 3 | Produit reçu avec DLC proche → **refusé** | Popup affiché, clic "Refusé", réception OK, retour créé avec type `dlc_trop_proche` et comment prérempli | Popup + handleReceive + useCreateReturn |
| 4 | Produit reçu avec DLC dépassée → **refusé** | Popup affiché, clic "Refusé", réception OK, retour créé avec type `dlc_depassee` et comment prérempli | Popup + handleReceive + useCreateReturn |
| 5 | Produit reçu avec DLC OK qui **expire plus tard** | Visible dans `/dlc-critique` quand `dlc_date - today ≤ warning_days` | useDlcCritique + computeDlcStatus |
| 6 | **Isolation multi-tenant** : établissement A ≠ B | `reception_lot_dlc` filtré par `establishment_id` via RLS. A ne voit pas les DLC de B. | RLS existant sur `reception_lot_dlc` |
| 7 | **Fournisseur** non impacté hors retour | Le fournisseur ne voit la DLC qu'en lecture (DlcSupplierNotice). Il est notifié uniquement si un retour est créé via le module Retours standard. | DlcSupplierNotice (existant) + pipeline retours |
| 8 | Aucune DLC saisie → pas de popup | Le popup ne s'affiche que si au moins une DLC est critique. Sans DLC → confirm standard. | dlcIssues.length === 0 check |

---

## 8. Résumé des étapes

| Étape | Description | Statut |
|-------|-------------|--------|
| 1 | Logique DLC pure unifiée (`dlcCompute.ts`) | ✅ Fait |
| 2 | Popup synthèse DLC à la réception | ✅ Fait |
| 3 | Branchement refus DLC → module Retours | ✅ Fait |
| 4 | Vue "DLC critique" (surveillance) | ✅ Fait |
| 5 | ~~Cron notifications~~ → Reporté (hors V0) | ⏸️ Reporté |
| 6 | Rapport final + validation | ✅ Ce document |

---

## 9. Décisions reportées (V1+)

| Sujet | Décision V0 | Évolution possible |
|-------|-------------|-------------------|
| Notifications DLC centrales | Non implémenté | Notification événementielle à la réception OU cron léger |
| Module RBAC dédié | `moduleKey="commandes"` | Module `dlc` ou `stock_surveillance` si rôles distincts |
| Navigation vers commande depuis DLC critique | Non implémenté | Lien cliquable vers `CommandeDetailDialog` |
| Export CSV des DLC critiques | Non implémenté | Bouton export dans DlcCritiquePage |
| Seuil DLC global par établissement | Fallback hardcodé (3 jours) | Colonne dans `establishments` ou settings |
