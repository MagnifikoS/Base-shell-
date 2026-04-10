# Audit orphelins commandes mixtes

**Date** : 2026-03-10  
**Périmètre** : order_groups, commandes mixtes produit+plat, risque d'orphelins  
**Méthode** : Analyse code + données de production  

---

## SECTION 1 — Cartographie du flux mixte

### Création d'une commande mixte

1. L'utilisateur ouvre `NouvelleCommandeCompositeDialog`
2. Il ajoute des produits ET des plats dans deux paniers séparés (`productCart`, `dishCart`)
3. Au clic "Envoyer" (`doSend`), le code exécute séquentiellement :
   - **Étape 1** : Envoi commande produit via `commandes-api?action=send` → obtient `sentProductId`
   - **Étape 2** : Envoi commande plat via `commandes-plats-api?action=send` → obtient `sentDishId`
   - **Étape 3** : SI les deux ont réussi → `INSERT INTO order_groups` avec les deux IDs
4. L'insertion de l'order_group est dans un `try/catch` avec commentaire `// Non-blocking — orders are sent regardless`

### Affichage unifié (`useUnifiedCommandes`)

- Le hook fusionne `commandes`, `commande_plats` et `order_groups` en une liste unique
- Si un `order_group` a les deux FKs peuplées ET que les deux entités existent dans les résultats → item `kind: "groupe"`
- **Ligne critique (L129-143)** : Si un seul côté existe, l'order_group est IGNORÉ. L'entité non trouvée apparaît comme standalone

### Statut de groupe (`getGroupDisplayStatus`)

- Priorité ascendante : brouillon < envoyee < ouverte < expediee < recue < cloturee
- Le statut affiché est le **plus bas** des deux
- Si un côté est en `litige`, le groupe entier affiche `litige`

---

## SECTION 2 — Où et comment naît l'orphelin

### Scénario 1 : Envoi partiel (CONFIRMÉ — Pattern reproductible)

Si l'étape 1 (produit) réussit mais l'étape 2 (plat) échoue :
- `sentProductId` existe, `sentDishId` est null
- L'order_group n'est **jamais créé** (condition `sentProductId && sentDishId`)
- La commande produit est envoyée et traitée normalement
- Le brouillon plat reste en base en statut `brouillon`
- **Résultat** : pas d'orphelin order_group, mais brouillon plat abandonné

### Scénario 2 : Envoi réussi, group_insert échoué (THÉORIQUE mais codé)

Si les deux envois réussissent mais l'INSERT order_groups échoue :
- Les deux commandes sont envoyées et actives
- Aucun lien n'existe entre elles
- Elles apparaissent comme deux commandes standalone dans la liste
- **Résultat** : pas d'orphelin technique, mais perte de lien métier

### Scénario 3 : Désynchronisation de cycle de vie (CONFIRMÉ EN PRODUCTION)

**Cas réel observé** :

| Entité | ID | Statut | 
|--------|-------|--------|
| CMD-000021 (produit) | `6f5ddd35-...` | **recue** ✅ |
| CP-20260310-5006 (plat) | `503d141e-...` | **ouverte** ⚠️ |
| order_group | `1009e4e9-...` | lié aux deux |

Le produit a été mené à terme (envoyé → ouvert → expédié → reçu) mais le plat est resté bloqué en `ouverte` (le fournisseur n'a jamais expédié la partie plat).

**Conséquence** : `getGroupDisplayStatus` retourne `ouverte` (le plus bas). Le groupe entier apparaît comme "En préparation" dans la liste, masquant le fait que le produit est terminé.

### Scénario 4 : Absence de mécanisme d'abandon/annulation

**Aucune action** n'existe pour :
- Annuler une commande plat en cours
- Expirer un order_group partiellement complété
- Détacher un côté terminé d'un groupe bloqué
- Forcer la clôture manuelle d'un plat abandonné

---

## SECTION 3 — Impacts métier / UI / data

### Impact sur les listes

| Zone | Impact | Sévérité |
|------|--------|----------|
| Onglet "En cours" | Le groupe reste bloqué indéfiniment | 🔴 P1 |
| Onglet "Terminée" | Le groupe n'y apparaît jamais | 🔴 P1 |
| Compteur badge | Gonflement artificiel des commandes actives | 🟡 P2 |

### Impact sur les filtres

- `isEnCours("ouverte")` retourne `true` → le groupe reste dans la vue active
- Pas de filtre "partiellement terminée"

### Impact sur la clôture

- CMD-000021 est `recue` → éligible à la facturation
- MAIS dans le contexte du groupe, elle est masquée sous le statut `ouverte`
- Le fournisseur peut potentiellement la facturer (car la RPC ne regarde que le statut de la commande produit, pas du groupe), mais l'UX crée une confusion

### Impact sur les données

- Les order_groups n'ont pas de `status` propre → pas d'historique de progression
- Pas de `closed_at` ou `abandoned_at`
- L'order_group reste actif indéfiniment

---

## SECTION 4 — Cas reproductibles

| # | Scénario | Reproductibilité | Impact |
|---|----------|-------------------|--------|
| 1 | Client envoie commande mixte, fournisseur traite produit mais pas plat | **Très facile** — suffit de ne pas expédier les plats | Groupe bloqué dans "En cours" |
| 2 | Fournisseur ouvre le plat mais n'expédie jamais | **Très facile** — pas de rappel/expiration | Plat en `ouverte` indéfiniment |
| 3 | Client réceptionne produit avant le plat | **Automatique** — les cycles sont indépendants | Statut groupe incohérent |
| 4 | Erreur réseau sur l'envoi plat | **Occasionnel** — deux appels séquentiels | Produit envoyé, plat en brouillon, pas de groupe |
| 5 | Double clic sur "Envoyer" | **Peu probable** — `isSending` guard existe | Faible |

**Fréquence estimée en production** : Scénarios 1-3 sont quasi-certains dès que les plats sont utilisés régulièrement. C'est un pattern structurel, pas un bug rare.

---

## SECTION 5 — Recommandation de structuration

### R1 — Statut indépendant par composant (Priorité haute)

Ne pas afficher un statut unique pour le groupe. Afficher :
- "Produits : Reçue ✅ | Plats : En préparation ⏳"
- Le groupe est "terminé" quand les DEUX côtés sont terminés

### R2 — Action d'abandon de plat (Priorité haute)

Permettre au client d'abandonner/annuler la partie plat d'une commande mixte si le fournisseur ne la traite pas. Options :
- Bouton "Abandonner la partie plats" → statut `annulee` sur commande_plat
- Expiration automatique après X jours sans progression (plus complexe)

### R3 — Statut sur order_group (Priorité moyenne)

Ajouter un champ `status` calculé ou matérialisé sur `order_groups` pour requêtes/filtres. Valeurs possibles : `active`, `partial`, `complete`, `abandoned`.

### R4 — Gestion du brouillon orphelin (Priorité basse)

Ajouter un nettoyage des brouillons plats non envoyés après 24h, ou les exclure de la liste par défaut.

---

## SECTION 6 — Verdict

### 🔴 RISQUE CONFIRMÉ — Pattern reproductible

L'orphelin de cycle de vie est un **pattern structurel inévitable** dès que des commandes mixtes existent. Ce n'est pas un bug rare mais une conséquence directe de l'architecture à deux moteurs indépendants sans coordination de clôture.

**Cas réel en base** : CMD-000021 + CP-20260310-5006 sont exactement ce pattern.

**Risque métier** :
- Pollution des listes "En cours"
- Confusion utilisateur ("pourquoi ma commande n'est pas terminée ?")
- Impossibilité de clôturer proprement un cycle mixte

**Recommandation immédiate** : Résoudre manuellement l'orphelin existant (expédier/clôturer CP-20260310-5006) et implémenter R1 (statut dual) + R2 (abandon) avant la montée en production.
