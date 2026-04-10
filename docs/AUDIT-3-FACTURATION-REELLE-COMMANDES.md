# Audit facturation réelle commandes

**Date** : 2026-03-10  
**Périmètre** : Flux complet de génération de facture — commande reçue → bouton fournisseur → facture en base → cloturee  
**Méthode** : Analyse code RPC + données de production  

---

## SECTION 1 — Cartographie flux facture

### Chaîne de génération

```
Fournisseur (isReceiver) clique "Générer facture"
  ↓ factureAppService.generateAppInvoice(commandeId, userId)
  ↓ RPC fn_generate_app_invoice(p_commande_id, p_user_id)
  ↓ SECURITY DEFINER — exécution avec droits élevés
  ↓ Vérifications :
    1. Commande existe (SELECT FOR UPDATE → verrou exclusif)
    2. Status == 'recue' (rejette si != recue, y compris 'cloturee')
    3. Pas de litiges ouverts (litiges.status = 'open')
    4. Pas de prix manquants (unit_price_snapshot IS NULL)
    5. Pas de facture existante (anti-doublon par commande_id)
    6. Au moins une ligne avec received_quantity > 0
  ↓ Snapshots immuables :
    - Profil fournisseur (nom, adresse, SIRET, logo)
    - Profil client (nom, adresse, SIRET)
  ↓ INSERT app_invoices + app_invoice_lines
  ↓ UPDATE commandes SET status = 'cloturee' (ATOMIQUE — même transaction)
  ↓ Retour { ok, invoice_id, invoice_number, total_ht }
```

### Composants frontend

| Composant | Rôle |
|-----------|------|
| `factureAppService.ts` | Appelle la RPC |
| `useGenerateAppInvoice` (hook) | Mutation React Query |
| `getInvoiceForCommande` | Vérifie si facture existe déjà |
| Bouton dans le détail commande | Visible uniquement pour isReceiver + status=recue |

---

## SECTION 2 — Cas testés

### T1 — Factures existantes en production

| Facture | Commande | Statut cmd | Statut facture | Total HT |
|---------|----------|------------|----------------|----------|
| FAC-APP-000001 | CMD-000009 | recue | emise | 72.72€ |
| FAC-APP-000002 | CMD-000010 | recue | emise | 404.08€ |

**Observation critique** : CMD-000009 et CMD-000010 sont toujours en statut `recue`, pas `cloturee`. Cela signifie que ces factures ont été générées **avant** l'ajout de la migration qui passe atomiquement à `cloturee`.

### T2 — Commandes facturables non facturées

| Commande | Statut | Facture |
|----------|--------|---------|
| CMD-000022 | recue | ❌ Aucune |
| CMD-000021 | recue | ❌ Aucune |
| CMD-000008 | recue | ❌ Aucune |
| CMD-000007 | recue | ❌ Aucune |
| CMD-000006 à CMD-000001 | recue | ❌ Aucune |

12 commandes en `recue` dont 10 non facturées. C'est normal (pas encore de facturation systématique).

### T3 — Anti-doublon

La RPC vérifie `SELECT id FROM app_invoices WHERE commande_id = p_commande_id`. Si une facture existe → retour `invoice_already_exists`. **Garde solide**.

### T4 — Commande plat dans la facturation

`fn_generate_app_invoice` ne gère que la table `commandes` et `commande_lines`. Le champ `commande_plat_id` existe dans `app_invoices` mais :
- Il n'est **jamais peuplé** par la RPC actuelle
- La RPC n'insère **pas** de lignes depuis `commande_plat_lines`
- La table `app_invoice_dish_lines` existe mais n'est **jamais alimentée** par la RPC

### T5 — Passage à cloturee

La migration `20260309213912` ajoute `UPDATE commandes SET status = 'cloturee'` dans la RPC. Cependant :
- Les 2 factures existantes (FAC-APP-000001, 000002) ont été créées AVANT cette migration
- Donc les commandes CMD-000009 et CMD-000010 sont restées en `recue`
- Toute nouvelle facturation passera bien à `cloturee`

---

## SECTION 3 — Résultats observés

### ✅ Ce qui fonctionne

| Point | Statut |
|-------|--------|
| RPC de génération | ✅ Fonctionnelle (2 factures créées) |
| Snapshots immuables (fournisseur, client) | ✅ Corrects |
| Séquence de numérotation FAC-APP-XXXXXX | ✅ Incrémentale |
| Anti-doublon | ✅ Solide (vérifie en base avant insert) |
| Verrou exclusif (FOR UPDATE) | ✅ Prévient race condition |
| Vérification litiges ouverts | ✅ Bloque si litige actif |
| Vérification prix snapshot | ✅ Bloque si prix manquant |
| Filtre lignes à quantité 0 | ✅ Exclues de la facture |

### ⚠️ Points de vigilance

| Point | Statut | Sévérité |
|-------|--------|----------|
| CMD-000009/010 pas passées à cloturee | ⚠️ Données héritées pré-migration | 🟡 P2 |
| Plats absents de la facturation | ⚠️ `commande_plat_id` et `app_invoice_dish_lines` non utilisés | 🟡 P2 |
| Statut `emise` sur facture (pas de cycle de vie) | ⚠️ Toujours `emise`, pas de `payee`/`annulee` | 🟢 P3 |

---

## SECTION 4 — Points de vigilance

### V1 — Incohérence des commandes historiques

CMD-000009 et CMD-000010 ont une facture mais restent en `recue`. Cela signifie :
- Le bouton "Générer facture" ne s'affiche pas (car `getInvoiceForCommande` retourne la facture existante)
- MAIS ces commandes apparaissent dans l'onglet "Reçue" au lieu de "Facturée"
- Pas de risque de double facturation (anti-doublon OK), mais confusion UX

**Recommandation** : Passer manuellement CMD-000009 et CMD-000010 à `cloturee` en base.

### V2 — Facturation des plats : architecture prête mais non connectée

Les tables `app_invoice_dish_lines` et le champ `commande_plat_id` sur `app_invoices` existent. Mais la RPC actuelle ne les utilise pas. Si la facturation des plats est prévue :
- Il faudra étendre `fn_generate_app_invoice` pour accepter un `p_commande_plat_id` optionnel
- Ou créer une RPC dédiée

### V3 — Pas de notification de facturation

Ni `commandes-api` ni la RPC ne déclenchent de notification quand une facture est générée. Le client n'est pas informé automatiquement qu'une facture est disponible.

### V4 — Commande mixte et facturation

Pour une commande mixte (CMD-000022 + CP-20260310-9460) :
- La facturation produit fonctionnera normalement sur CMD-000022
- La partie plat (CP-20260310-9460) ne sera **pas** incluse dans la facture
- Pas de blocage, mais la facture sera incomplète du point de vue business

---

## SECTION 5 — Verdict

### 🟢 OPÉRATIONNEL pour les commandes produit seules

Le flux de facturation produit fonctionne correctement :
- 2 factures générées avec succès en production
- Anti-doublon solide
- Passage atomique à `cloturee` (post-migration)
- Snapshots immuables fiables

### 🟡 CONDITIONNEL pour les commandes mixtes

La facturation ne couvre pas les plats. Les commandes mixtes auront une facture partielle (produits uniquement). Ce n'est pas bloquant si c'est un choix V1 accepté, mais doit être documenté pour les utilisateurs.

### Actions requises avant prod

| Action | Priorité |
|--------|----------|
| Passer CMD-000009/010 à `cloturee` | P2 — nettoyage data |
| Décider de la stratégie facturation plats | P2 — décision produit |
| Ajouter notification "facture disponible" | P3 — amélioration UX |
