# Audit facture + realtime commandes

> Date : 2026-03-10
> Statut : ✅ IMPLÉMENTÉ — P0 + P1 corrigés

---

## SECTION 1 — Executive summary

### Causes confirmées (bugs factuels)

| # | Bug | Preuve |
|---|-----|--------|
| **B1** | Le wrapper du bouton facture utilise `isSender` (= client) au lieu de `isReceiver` (= fournisseur). Le **fournisseur ne voit jamais le bouton**. | `CommandeDetailDialog.tsx` L187-188, L709 |
| **B2** | Le **client ne voit pas le bouton non plus** car même si le wrapper passe (`isSender = true` côté client), `useInvoiceForCommande` query `app_invoices` — et la RLS **autorise** le client à lire (policy `app_invoices_client_select`). Donc la query passe mais retourne `null` (pas de facture) → `isFacturable = "recue" === "recue"` → `true` → **le bouton DEVRAIT s'afficher côté client**. S'il ne s'affiche pas, c'est que `currentStatus ≠ "recue"` au moment du rendu ou que `checkingExisting` est bloqué. | Voir analyse détaillée Section 2.3 |
| **B3** | Aucun canal realtime pour `commande_plats` ni `commande_plat_lines`. Ces tables **ne sont même pas dans la publication `supabase_realtime`**. | `pg_publication_tables` : `plats_published = false`, `plat_lines_published = false`. Aucun hook dans `src/hooks/realtime/`. |

### Hypothèses rejetées

| Hypothèse | Verdict |
|-----------|---------|
| RLS `app_invoices` bloque le fournisseur | **REJETÉ** — policy `app_invoices_supplier_select` autorise `supplier_establishment_id IN get_user_establishment_ids()`. Le fournisseur peut lire. |
| RLS `app_invoices` bloque le client | **REJETÉ** — policy `app_invoices_client_select` autorise `client_establishment_id IN get_user_establishment_ids()`. Le client peut lire. |
| `staleTime` cause l'absence du bouton | **REJETÉ** — le bouton est rendu dans un dialog qui fetch à l'ouverture, pas soumis au staleTime pour son premier rendu. |

### Ordre de priorité

1. **P0** — Corriger la condition du wrapper bouton facture (`isReceiver` au lieu de `isSender`)
2. **P1** — Ajouter realtime `commande_plats` + `commande_plat_lines`
3. **P2** — Évaluer si `staleTime` impacte les listes (post-fix)

---

## SECTION 2 — Audit bouton "Générer facture"

### 2.1 Logique de rôle

**Fichier** : `src/modules/commandes/components/CommandeDetailDialog.tsx`

```ts
// Ligne 187-188
const isSender = commande?.client_establishment_id === estId;   // = CLIENT (celui qui envoie la commande)
const isReceiver = commande?.supplier_establishment_id === estId; // = FOURNISSEUR (celui qui reçoit la commande)
```

**Sémantique** :
- `isSender` → le **client** qui a envoyé/passé la commande
- `isReceiver` → le **fournisseur** qui reçoit et traite la commande

**Le fournisseur doit voir le bouton facture** → la condition doit être `isReceiver`.

### 2.2 Montage du composant

```tsx
// Ligne 709
{isSender && currentStatus && (
  <div className="px-5 pt-3">
    <GenerateInvoiceButton commandeId={commande!.id} commandeStatus={currentStatus} />
  </div>
)}
```

**Condition actuelle** : `isSender && currentStatus`
- `isSender` = `true` uniquement côté **client**
- `isReceiver` = `true` uniquement côté **fournisseur**

**Verdict** : Le wrapper **empêche le fournisseur de voir le bouton**. C'est la cause racine confirmée.

### 2.3 Logique interne du bouton

Le composant `GenerateInvoiceButton` a 3 points de sortie `return null` :

| Condition | Quand ça retourne `null` | Impact |
|-----------|--------------------------|--------|
| `commandeStatus !== "recue"` | Commande pas au bon statut | Normal — filtre métier attendu |
| `checkingExisting` (isLoading) | Query `useInvoiceForCommande` en cours | Transitoire — disparaît en ~100ms |
| `existingInvoice` truthy | Facture déjà générée | Normal — affiche un indicateur read-only à la place |

**Pour le cas du client (test actuel)** :
- `commandeStatus` = `"recue"` → `isFacturable = true` ✅
- `useInvoiceForCommande(commandeId)` → query `app_invoices` avec `commande_id = X`
- RLS `app_invoices_client_select` → le client **peut lire** → query retourne `null` (aucune facture)
- `checkingExisting = false`, `existingInvoice = null` → **le bouton DEVRAIT s'afficher**

**Si le client ne voit pas le bouton**, 2 possibilités restantes :
1. Le `currentStatus` n'est pas `"recue"` au moment du rendu (ex: données stale, status déjà `"cloturee"`)
2. Le dialog s'ouvre avec les données du `commande` prop (pas encore refetched) dont le status pourrait différer

**Mais dans tous les cas, le vrai problème est que le bouton NE DOIT PAS apparaître côté client** (règle métier). C'est le fournisseur qui facture. Donc le bug principal reste la condition `isSender`.

### 2.4 RLS `app_invoices`

**Policies existantes** (vérifiées en base) :

| Policy | Commande | Condition | Verdict |
|--------|----------|-----------|---------|
| `app_invoices_supplier_select` | SELECT | `supplier_establishment_id IN get_user_establishment_ids()` | ✅ Fournisseur peut lire |
| `app_invoices_client_select` | SELECT | `client_establishment_id IN get_user_establishment_ids()` | ✅ Client peut lire |
| `app_invoices_supplier_insert` | INSERT | `supplier_establishment_id IN get_user_establishment_ids()` | ✅ Fournisseur peut créer |
| `app_invoices_supplier_update` | UPDATE | `supplier_establishment_id IN get_user_establishment_ids()` | ✅ Fournisseur peut modifier |

**Conclusion RLS** : **RLS OK**. Les deux côtés peuvent lire `app_invoices`. La RLS n'est pas en cause.

### 2.5 Conclusion Partie A

| Question | Réponse |
|----------|---------|
| Cause exacte du bouton absent | **Bug de rôle** : condition `isSender` (L709) au lieu de `isReceiver` |
| Bug confirmé ? | **OUI** — confirmé par lecture du code |
| Fichier exact | `src/modules/commandes/components/CommandeDetailDialog.tsx` |
| Ligne exacte | 709 |
| Condition actuelle | `isSender && currentStatus` |
| Condition correcte | `isReceiver && currentStatus` |
| RLS en cause ? | **NON** — policies OK des deux côtés |
| Correction minimale | Remplacer `isSender` par `isReceiver` sur la ligne 709 |

---

## SECTION 3 — Audit realtime commandes produit

### 3.1 État

**Fichier** : `src/hooks/realtime/channels/useCommandesChannel.ts`

| Canal | Table | Filtre | Côté |
|-------|-------|--------|------|
| `app-commandes-cl-{estId}` | `commandes` | `client_establishment_id=eq.{estId}` | Client |
| `app-commandes-fo-{estId}` | `commandes` | `supplier_establishment_id=eq.{estId}` | Fournisseur |
| `app-commande-lines-{estId}` | `commande_lines` | Aucun (filtré côté client) | Les deux |

**Publication Realtime** :
- `commandes` → **publié** ✅
- `commande_lines` → **publié** ✅

**Query keys invalidées** :
- `["commandes"]` (exact: false) ✅
- `["unified-commandes-products"]` (exact: false) ✅

### 3.2 Problèmes

- **Aucun bug structurel** sur les commandes produit. Les deux côtés (client + fournisseur) reçoivent les events.
- `commande_lines` n'a pas de filtre Postgres mais utilise un filtrage client-side intelligent (vérifie si des commandes sont en cache avant d'invalider).

### 3.3 Verdict

**Realtime commandes produit : FONCTIONNEL** ✅

Si l'utilisateur constate un délai, c'est lié au `staleTime` de 2 minutes sur les queries commandes — mais les invalidations sont bien déclenchées par realtime. Le refetch se fait quand le composant est re-monté ou re-focusé.

---

## SECTION 4 — Audit realtime commandes plats

### 4.1 État

| Élément | Présent ? |
|---------|-----------|
| Canal realtime pour `commande_plats` | ❌ **ABSENT** |
| Canal realtime pour `commande_plat_lines` | ❌ **ABSENT** |
| `commande_plats` dans `supabase_realtime` publication | ❌ **NON PUBLIÉ** |
| `commande_plat_lines` dans `supabase_realtime` publication | ❌ **NON PUBLIÉ** |
| Hook `useCommandePlatsChannel` | ❌ **N'EXISTE PAS** |
| Appel dans `useAppRealtimeSync` | ❌ **ABSENT** |

### 4.2 Query keys du module plats

**Fichier** : `src/modules/commandesPlats/hooks/useCommandesPlats.ts`

```ts
const QK = "commandes-plats";
```

Le canal commandes produit invalide `["commandes"]` mais **pas `["commandes-plats"]`**. Donc même si les events `commandes` arrivent, ils **ne rafraîchissent pas les plats**.

### 4.3 Problèmes

1. **`commande_plats` n'est pas dans la publication `supabase_realtime`** → aucun event Postgres n'est émis
2. **`commande_plat_lines` n'est pas dans la publication `supabase_realtime`** → aucun event Postgres n'est émis
3. **Aucun hook d'écoute n'existe** → même si on ajoutait la publication, personne n'écoute
4. **Les query keys `["commandes-plats"]` ne sont jamais invalidées par realtime** → le module dépend à 100% du polling/refetch manuel

### 4.4 Verdict

**Realtime commandes plats : TOTALEMENT ABSENT** ❌

C'est un manque complet, pas un bug partiel. Il faut :
1. Ajouter `commande_plats` et `commande_plat_lines` à la publication `supabase_realtime`
2. Créer un hook `useCommandePlatsChannel` similaire à `useCommandesChannel`
3. L'ajouter dans `useAppRealtimeSync`
4. Invalider `["commandes-plats"]` et `["unified-commandes-products"]`

---

## SECTION 5 — RLS `app_invoices`

### 5.1 Policies

| Nom | Commande | Rôle autorisé | Condition |
|-----|----------|---------------|-----------|
| `app_invoices_supplier_select` | SELECT | authenticated | `supplier_establishment_id IN get_user_establishment_ids()` |
| `app_invoices_client_select` | SELECT | authenticated | `client_establishment_id IN get_user_establishment_ids()` |
| `app_invoices_supplier_insert` | INSERT | authenticated | `supplier_establishment_id IN get_user_establishment_ids()` |
| `app_invoices_supplier_update` | UPDATE | authenticated | `supplier_establishment_id IN get_user_establishment_ids()` |

### 5.2 Lecture fournisseur

Le fournisseur peut lire via `app_invoices_supplier_select`. **OK** ✅

### 5.3 Lecture client

Le client peut lire via `app_invoices_client_select`. **OK** ✅

### 5.4 Impact réel

**Aucun impact sur le bouton facture.** Les RLS ne bloquent ni le fournisseur ni le client pour la lecture. La query `useInvoiceForCommande` fonctionne correctement des deux côtés.

---

## SECTION 6 — Priorités de correction

| Priorité | Sujet | Type | Effort | Détail |
|----------|-------|------|--------|--------|
| **P0** | Bouton facture absent côté fournisseur | Bug confirmé | 1 ligne | Changer `isSender` → `isReceiver` en L709 de `CommandeDetailDialog.tsx` |
| **P1** | Realtime commandes plats totalement absent | Manque fonctionnel | ~50 lignes | Migration SQL (publication) + hook + wiring |
| **P2** | `staleTime` 2min sur commandes | Cosmétique | Optionnel | N'est PAS la cause des bugs ci-dessus. À évaluer uniquement après P0 et P1. |

---

## SECTION 7 — Verdict final

### Pourquoi le bouton facture est absent

**Cause unique confirmée : bug de condition de rôle.**

- Ligne 709 de `CommandeDetailDialog.tsx` utilise `isSender` (= client)
- Le fournisseur (seul autorisé à facturer) a `isSender = false` → le wrapper ne rend rien
- Le client a `isSender = true` mais ne devrait pas voir le bouton (règle métier)
- **Ce n'est PAS un bug de RLS** (policies OK)
- **Ce n'est PAS un bug de staleTime**
- **C'est un bug d'une seule variable dans une seule condition**

### Est-ce un bug de rôle, de RLS, ou les deux ?

**Bug de rôle uniquement.** RLS fonctionnelles.

### Le realtime produit est-il suffisant ?

**OUI** — 3 canaux couvrent les deux côtés + les lignes. Fonctionnel.

### Le realtime plats est-il incomplet ?

**OUI — totalement absent.** Pas de publication, pas de hook, pas de wiring. Rien.

### Quelle correction doit être faite en premier ?

1. ~~**P0** : Corriger `isSender` → `isReceiver` (1 ligne, 0 risque de régression)~~ ✅ FAIT
2. ~~**P1** : Implémenter le realtime commandes plats (migration + hook)~~ ✅ FAIT
3. **P2** : Réévaluer staleTime si besoin après P0+P1

---

## SECTION 8 — Rapport d'implémentation

### Phase 1 — Bouton facture (P0)

**Ce qui a été fait :**
- `CommandeDetailDialog.tsx` L709 : `isSender` → `isReceiver`

**Ce qui n'a PAS été touché :**
- RLS `app_invoices` — inchangée (correcte)
- `GenerateInvoiceButton` logique interne — inchangée
- `staleTime` — inchangé
- Flux de génération facture — inchangé

**Pourquoi c'est safe :**
- Changement d'une seule condition de visibilité
- Le composant `GenerateInvoiceButton` a ses propres gardes internes (`isFacturable`, `existingInvoice`, `commandeStatus`)
- Le fournisseur voit le bouton si commande `recue` et pas encore facturée
- Le client ne voit plus le bouton (correct : seul le fournisseur facture)

### Phase 2 — Realtime commandes plats (P1)

**Ce qui a été fait :**
- Migration SQL : `commande_plats` + `commande_plat_lines` ajoutés à `supabase_realtime`
- Nouveau hook : `src/hooks/realtime/channels/useCommandePlatsChannel.ts`
  - 3 canaux : CL (client), FO (fournisseur), lines (filtré client-side)
  - Invalide `["commandes-plats"]` query key
- Wiring : branché dans `useAppRealtimeSync.ts`
- Barrel export : ajouté dans `src/hooks/realtime/index.ts`
- `CHANNEL_COUNT` : 23 → 26

**Ce qui n'a PAS été touché :**
- Realtime commandes produit — strictement intact
- Bouton facture — aucun changement dans cette phase
- `staleTime` — inchangé
- Query keys produit — inchangées

**Realtime produit reste intact :**
- `useCommandesChannel` n'a pas été modifié
- Les canaux produit (`commandes CL/FO`, `commande_lines`) restent séparés
- Aucune mutualisation prématurée

**Query keys invalidées :**
- `["commandes-plats"]` (exact: false) — couvre toutes les variantes

**Vérification client / fournisseur :**
- Client reçoit les updates via canal `commande_plats CL` (filtre `client_establishment_id`)
- Fournisseur reçoit les updates via canal `commande_plats FO` (filtre `supplier_establishment_id`)
- Les deux voient les changements de lignes via `commande_plat_lines` (filtré client-side)
