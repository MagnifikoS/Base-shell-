# Audit statut `cloturee` — Commandes Produit

**Date** : 2026-03-09  
**Objectif** : Valider la faisabilité de `recue → cloturee` après génération de facture  
**Périmètre** : Commandes produit uniquement (`commande_status` enum)

---

## SECTION 1 — Cartographie des usages du statut

### 1.1 Enum PostgreSQL `commande_status`

```
'brouillon', 'envoyee', 'ouverte', 'expediee', 'litige', 'recue'
```

> ⚠️ **DÉCOUVERTE CRITIQUE** : `cloturee` n'existe PAS dans l'enum `commande_status` (produits).  
> Il existe dans `commande_plat_status` (plats), mais PAS pour les commandes produit.  
> Le type TS `CommandeStatus` dans `src/modules/commandes/types.ts` déclare `"cloturee"`, mais c'est un mensonge — le backend refusera cette valeur.

### 1.2 Fichiers utilisant `recue` / `cloturee` pour les commandes produit

| Fichier | Usage de `recue` | Usage de `cloturee` |
|---------|-----------------|-------------------|
| `CommandeStatusBadge.tsx` | Badge "✔" vert (icône seule) | Badge gris "Clôturée" |
| `CommandeDetailDialog.tsx` L252 | `isReceivedStatus` (DLC) | inclus dans `isReceivedStatus` |
| `CommandeDetailDialog.tsx` L411 | `showShipped` | inclus dans `showShipped` |
| `CommandeDetailDialog.tsx` L412 | `canSignalReturn` | inclus dans `canSignalReturn` |
| `CommandesList.tsx` L134-135 | Filtre onglet "Terminée" | inclus dans filtre `["recue","cloturee"]` |
| `UnifiedCommandesList.tsx` L154 | Filtre onglet "Terminée" | inclus dans filtre `["recue","cloturee"]` |
| `useUnifiedCommandes.ts` L195 | Priorité 4 | Priorité 5 |
| `GenerateInvoiceButton.tsx` L31 | `isFacturable` | inclus dans `isFacturable` |
| `factureAppService.ts` (RPC) | Appelle `fn_generate_app_invoice` | — |

### 1.3 RPCs backend

| RPC | Accepte `recue` | Accepte `cloturee` | Produit `cloturee` |
|-----|----------------|-------------------|-------------------|
| `fn_receive_commande` | Non (requiert `expediee`) | — | → met à `recue` |
| `fn_resolve_litige` | — | — | → met à `recue` |
| `fn_generate_app_invoice` (migration la + récente `20260306190816`) | ✅ `status != 'recue'` seulement | ❌ refuse | ❌ ne change pas le statut |
| `fn_generate_app_invoice` (migration `20260306181632`) | ✅ | ✅ `NOT IN ('recue','cloturee')` | ❌ ne change pas le statut |

> ⚠️ **INCOHÉRENCE RPC** : Deux versions de `fn_generate_app_invoice` existent dans les migrations. La plus récente (`20260306190816`) a RÉGRESSÉ en restreignant à `status != 'recue'` seulement (ligne 30). La version active en prod est la **dernière appliquée** (`20260306190816`), qui ne vérifie que `recue`.

### 1.4 Notifications

| Événement | Statut déclencheur |
|-----------|-------------------|
| `commande_reception_validee` | Après `fn_receive_commande` → `recue` |
| `commande_litige` | Après réception avec écarts → `litige` |
| Aucune notification pour `cloturee` | — n'existe pas encore |
| Aucune notification pour "facture générée" | — n'existe pas encore |

### 1.5 Realtime

Canal `commandes` écoute les changements. Pas de filtre par statut → **pas d'impact**.

### 1.6 PDF / Exports

Aucun export CSV/PDF ne filtre par statut de commande. La facture PDF est indépendante (générée depuis `app_invoices`). **Pas d'impact**.

---

## SECTION 2 — Conditions cachées / dépendances

| Condition | Fichier | Impact si `cloturee` devient actif |
|-----------|---------|-----------------------------------|
| `isReceivedStatus = status === "recue" \|\| status === "cloturee"` | `CommandeDetailDialog.tsx` L252 | ✅ Déjà couvert |
| `showShipped` inclut `recue` et `cloturee` | `CommandeDetailDialog.tsx` L411 | ✅ Déjà couvert |
| `canSignalReturn` inclut `recue`, `cloturee`, `litige` | `CommandeDetailDialog.tsx` L412 | ⚠️ **Point d'attention** : peut-on signaler un retour sur une commande facturée ? |
| Filtre "Terminée" = `["recue","cloturee"]` | `CommandesList.tsx` L135, `UnifiedCommandesList.tsx` L154 | ✅ Déjà couvert |
| `isFacturable` = `["recue","cloturee"]` | `GenerateInvoiceButton.tsx` L31 | ⚠️ Si `cloturee` = "déjà facturée", le bouton ne doit PLUS apparaître. Il faut ajouter la vérif `hasInvoice` (qui existe déjà dans le composant). |
| Priorité affichage groupé | `useUnifiedCommandes.ts` L195 | ✅ Déjà couvert |
| `CommandeStatusBadge` case `cloturee` | Renvoie un badge gris "Clôturée" | ✅ Existe déjà |
| `CommandeStatusBadge` case `recue` | Renvoie une icône verte seule | ⚠️ Devrait afficher un libellé texte si "Reçue" devient un vrai état visible |

### Conditions véritablement cachées identifiées :

1. **`canSignalReturn` après facture** : Aujourd'hui un retour est possible sur `recue` et `cloturee`. Si `cloturee` = facturé → faut-il encore autoriser les retours ? **Décision métier requise.**

2. **Le bouton "Générer facture"** vérifie déjà `hasInvoice` (via `getInvoiceForCommande`). Donc même si `isFacturable` accepte `cloturee`, le bouton ne s'affichera pas si la facture existe. **Pas de risque de double facturation UI.**

3. **Aucun dashboard ou rapport** ne filtre par `recue` vs `cloturee`. **Pas d'impact.**

---

## SECTION 3 — Analyse du flux facture

### Flux actuel

```
Client valide réception → fn_receive_commande → status = 'recue'
    OU
Fournisseur résout litige → fn_resolve_litige → status = 'recue'
    PUIS
Fournisseur clique "Générer facture" → fn_generate_app_invoice → facture créée, status INCHANGÉ
```

### Flux visé

```
[...même chose...]
    PUIS
fn_generate_app_invoice → facture créée + UPDATE commandes SET status = 'cloturee'
```

### Faisabilité technique

| Question | Réponse |
|----------|---------|
| Peut-on ajouter l'UPDATE dans la même RPC ? | ✅ **OUI** — `fn_generate_app_invoice` est déjà transactionnelle (PL/pgSQL = transaction implicite). L'ajout d'un `UPDATE commandes SET status = 'cloturee'` avant le `RETURN` est atomique. Si la facture échoue → rollback, statut inchangé. |
| Doit-ce être atomique ? | ✅ **OUI, obligatoire.** Si le statut passait à `cloturee` sans facture créée, on aurait un état incohérent. La transaction PL/pgSQL garantit l'atomicité. |
| Risque si la facture échoue ? | **Aucun.** Le rollback transactionnel annule tout, y compris le changement de statut. |
| Faut-il ajouter `cloturee` à l'enum `commande_status` ? | ✅ **OUI — c'est le prérequis n°1.** Sans ça, le `UPDATE` échouera car la valeur n'est pas dans l'enum. |

### Migration requise

```sql
-- 1. Ajouter 'cloturee' à l'enum commande_status
ALTER TYPE commande_status ADD VALUE IF NOT EXISTS 'cloturee' AFTER 'recue';

-- 2. Modifier fn_generate_app_invoice pour passer à 'cloturee' après facturation
-- Ajouter avant le RETURN final :
UPDATE commandes SET status = 'cloturee', updated_at = now()
WHERE id = p_commande_id;
```

### Verdict flux facture : ✅ **Faisable proprement et sans risque**

---

## SECTION 4 — Analyse litiges / retours / actions post-réception

### 4.1 Litiges

| Scénario | Impact |
|----------|--------|
| Commande `recue` avec litige ouvert → facture bloquée | ✅ Déjà géré (`fn_generate_app_invoice` vérifie `v_open_litiges > 0`) |
| Litige résolu → commande passe à `recue` | ✅ Compatible — on peut alors facturer et passer à `cloturee` |
| Litige sur commande `cloturee` (déjà facturée) | ⚠️ **Impossible aujourd'hui** — les litiges sont créés uniquement à la réception (`fn_receive_commande`). Pas de création de litige post-réception. **Pas de risque.** |

### 4.2 Retours

| Scénario | Impact |
|----------|--------|
| Retour signalé sur `recue` (avant facture) | ✅ Aucun changement |
| Retour signalé sur `cloturee` (après facture) | ⚠️ **Actuellement autorisé par `canSignalReturn`.** |

**Recommandation** : Garder `canSignalReturn` pour `cloturee` est **acceptable métier**. Un retour post-facturation est un cas réel (marchandise défectueuse découverte après). La facture est déjà émise — le retour crée un avoir ou une régularisation séparée. **Ne pas bloquer.**

### 4.3 Actions post-`cloturee`

| Action | Possible ? | Doit rester possible ? |
|--------|-----------|----------------------|
| Signaler retour | Oui (UI) | ✅ Oui |
| Générer facture | Bloqué (already exists) | ✅ Correct |
| Modifier commande | Impossible (pas brouillon/envoyée) | ✅ Correct |
| Ouvrir litige | Impossible (créé uniquement à réception) | ✅ Correct |
| Voir DLC | Oui | ✅ Correct |

### Verdict litiges/retours : ✅ **Aucun flux cassé**

---

## SECTION 5 — Cohérence UI (onglets / chips / labels)

### 5.1 Question métier : quel label pour une commande reçue sans facture ?

| Option | Pour terrain | Pour fournisseur | Pour logique entreprise |
|--------|-------------|-----------------|----------------------|
| **"Reçue"** | ✅ Clair — "j'ai reçu la marchandise" | ⚠️ Ambigu — "reçue" peut signifier "j'ai reçu la commande" (=envoyée) | ✅ Signifie "réception validée" |
| **"Terminée"** | ⚠️ Confond "terminée opérationnellement" et "terminée administrativement" | ⚠️ Même confusion | ❌ Imprécis |

### 5.2 Recommandation

```
recue    → Chip : "Reçue"     (vert, icône PackageCheck)
cloturee → Chip : "Facturée"  (gris, icône CheckCircle2)
```

**Justification** :
- "Reçue" est immédiatement compris par le terrain
- "Facturée" est plus explicite que "Clôturée" — l'utilisateur sait exactement ce qui s'est passé
- "Clôturée" est un terme administratif opaque pour un utilisateur terrain

**Alternative acceptable** :
```
cloturee → Chip : "Clôturée" (gris) — si "Facturée" est jugé trop financier
```

### 5.3 Onglets

| Option A : Un seul onglet | Option B : Deux sous-onglets |
|--------------------------|---------------------------|
| **"Terminée"** contient `recue` + `cloturee` | **"Reçue"** + **"Facturée"** séparés |
| ✅ Simple, actuel, pas de changement UX | ⚠️ Sur-segmentation — peu de volume attendu |

**Recommandation : Option A — garder un onglet "Terminée" unique** contenant les deux statuts. La chip suffit à les distinguer visuellement.

### 5.4 Badge actuel `recue` — problème

Aujourd'hui le badge `recue` est une **icône seule** (cercle vert avec PackageCheck, sans texte). Si `recue` devient un vrai statut intermédiaire visible (avant facturation), il faut un **badge avec texte** :

```tsx
case "recue":
  return (
    <Badge className="text-xs flex items-center gap-1 bg-emerald-500 text-white hover:bg-emerald-600">
      <PackageCheck className="h-3 w-3" />
      Reçue
    </Badge>
  );
```

---

## SECTION 6 — Impact notifications / historique

### 6.1 Notifications existantes

Aucune notification n'est émise pour le passage à `recue` côté client (c'est le client qui fait l'action). Les notifications de réception vont au **fournisseur** (`commande_reception_validee`).

### 6.2 Impact du passage `recue → cloturee`

| Élément | Impact |
|---------|--------|
| Centre de notifications | Aucune notification existante ne filtre par `cloturee`. **Pas d'impact.** |
| Push notifications | Aucun push lié au statut final. **Pas d'impact.** |
| Historique | Le champ `updated_at` sera mis à jour. **Pas d'impact négatif.** |

### 6.3 Recommandation optionnelle

Ajouter une notification au client quand la facture est générée :
```
Type: "commande_facturee"
Destinataire: client (tous les membres de l'établissement client)
Body: "Le fournisseur X a généré la facture pour la commande CMD-XXXX"
```

Ce n'est **pas requis** pour le changement de statut, mais c'est une bonne pratique.

### Verdict notifications : ✅ **Aucun trou, aucune incohérence**

---

## SECTION 7 — Recommandation d'architecture

### 7.1 Plan d'implémentation (4 étapes)

| # | Action | Risque | Fichiers |
|---|--------|--------|----------|
| 1 | Migration SQL : `ALTER TYPE commande_status ADD VALUE 'cloturee'` | ⚠️ Irréversible (enum ADD VALUE) — mais déjà voulu | Migration SQL |
| 2 | Migration SQL : modifier `fn_generate_app_invoice` pour ajouter `UPDATE commandes SET status = 'cloturee'` dans la même transaction | Faible — atomique | Migration SQL |
| 3 | UI : modifier `CommandeStatusBadge` case `recue` pour afficher "Reçue" en badge texte | Aucun | 1 fichier |
| 4 | UI : modifier `GenerateInvoiceButton` — `isFacturable` ne doit accepter que `recue` (plus `cloturee` car = déjà facturée) | ⚠️ Important — éviter confusion | 1 fichier |

### 7.2 Fichiers impactés (exhaustif)

| Fichier | Modification |
|---------|-------------|
| **Migration SQL** (nouveau) | `ALTER TYPE` + `fn_generate_app_invoice` modifiée |
| `src/modules/commandes/components/CommandeStatusBadge.tsx` | Case `recue` → badge texte "Reçue" |
| `src/modules/factureApp/components/GenerateInvoiceButton.tsx` | `isFacturable` → `commandeStatus === "recue"` uniquement |
| `src/modules/commandes/types.ts` | Déjà OK (a `cloturee`) |
| `src/pages/commandes/useUnifiedCommandes.ts` | Déjà OK |
| `src/pages/commandes/UnifiedCommandesList.tsx` | Déjà OK |
| `src/modules/commandes/components/CommandesList.tsx` | Déjà OK |
| `src/modules/commandes/components/CommandeDetailDialog.tsx` | Déjà OK |

### 7.3 Ce qui ne change PAS

- Onglets ("Terminée" garde `recue + cloturee`) ✅
- Retours (toujours possibles sur `cloturee`) ✅
- Litiges (pas créables post-réception) ✅
- DLC (visible sur `recue` et `cloturee`) ✅
- Factures existantes ✅
- Notifications ✅
- Realtime ✅
- Commandes plats (enum séparé, non impacté) ✅

---

## SECTION 8 — Verdict final

### Réponses aux questions obligatoires

| # | Question | Réponse |
|---|----------|---------|
| 1 | Le changement est-il métier-ment cohérent ? | ✅ **OUI** — `recue` = opérationnel terminé, `cloturee` = administrativement terminé (facturé). C'est la bonne logique. |
| 2 | Le changement est-il techniquement safe ? | ✅ **OUI** — sous réserve d'ajouter `cloturee` à l'enum `commande_status` (prérequis bloquant). |
| 3 | Le passage à `cloturee` doit-il être dans la même transaction que la facture ? | ✅ **OUI, obligatoire.** Atomicité garantie par PL/pgSQL. |
| 4 | Y a-t-il des conditions cachées qui risquent de casser ? | ✅ **NON** — toutes les conditions UI incluent déjà `cloturee`. Le seul ajustement est `GenerateInvoiceButton` qui doit restreindre à `recue` seul. |
| 5 | `recue` doit-il rester la chip de la commande terminée sans facture ? | ✅ **OUI** — avec le label "Reçue" (badge texte, pas juste icône). |
| 6 | `cloturee` doit-il devenir la chip après facture ? | ✅ **OUI** — avec le label "Facturée" ou "Clôturée". |
| 7 | Le changement est-il faisable sans toucher d'autres modules ? | ✅ **OUI** — 1 migration SQL + 2 fichiers UI modifiés. |

### ⚠️ Prérequis bloquant découvert

**L'enum `commande_status` en base ne contient PAS `cloturee`.** Il faut l'ajouter AVANT toute implémentation. Le type TypeScript le déclare mais c'est un mensonge côté DB.

### Score de faisabilité : **9/10**

Le seul point d'attention est l'ajout de valeur à l'enum (irréversible) et la décision métier sur le label exact de la chip (`"Facturée"` vs `"Clôturée"`).

---

*Audit réalisé le 2026-03-09 — analyse de 23 fichiers, 5 migrations SQL, 4 RPCs, 2 enums.*
