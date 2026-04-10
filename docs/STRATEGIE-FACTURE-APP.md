# Stratégie Module "Facture App" — Plan détaillé

> **Document de stratégie uniquement — Aucun code modifié.**
> Chaque étape sera validée par le product owner avant implémentation.

---

## Verdict après audit du socle

### ✅ Ce qui est déjà solide

| Élément | État | Preuve |
|---------|------|--------|
| Cycle de vie commande | 6 statuts atomiques + verrouillage `FOR UPDATE` | `fn_ship_commande`, `fn_receive_commande` |
| Stock / Ledger | Append-only, idempotent, transactionnel | `fn_post_stock_document` |
| B2B mapping | Isolation complète, UUID locaux | `b2b_imported_products` |
| Snapshots noms/unités dans `commande_lines` | `product_name_snapshot`, `unit_label_snapshot` | DDL confirmé |
| Snapshots prix dans BL | `bl_withdrawal_lines.unit_price_snapshot` | DDL confirmé |
| Fiches client/fournisseur | `establishment_profiles` (legal_name, siret, adresse, logo) | DDL confirmé |
| Numérotation commande | Séquence `commande_order_seq` → `order_number` immuable | Trigger `trg_commandes_immutable_fields` |
| Séquence facture B2B | `b2b_invoice_seq` déjà existante | `information_schema.sequences` |
| Module Factures importées isolé | `src/modules/factures/` avec table `invoices` | Code existant |

### 🔴 Le seul P0 bloquant

**`commande_lines` ne stocke PAS le prix.**

Colonnes actuelles de `commande_lines` :
```
id, commande_id, product_id, canonical_quantity, canonical_unit_id,
product_name_snapshot, unit_label_snapshot, shipped_quantity, received_quantity, line_status
```

**Il manque :**
- `unit_price_snapshot` (prix unitaire figé)
- `line_total_snapshot` (quantité × prix, calculé)

**Conséquence :** Impossible de générer une facture juste sans prix figé par ligne de commande.

---

## Règles métier confirmées après audit

### A. Source de vérité du prix de facture

```
                    ┌────────────────────────────────┐
 Catalogue          │ products_v2.final_unit_price   │ ← MUTABLE (OCR, sync B2B)
                    └─────────────┬──────────────────┘
                                  │ FIGER au moment de l'envoi
                                  ▼
 Commande           │ commande_lines.unit_price_snapshot │ ← IMMUABLE après envoi
                    └─────────────┬──────────────────────┘
                                  │ COPIER tel quel
                                  ▼
 Facture App        │ app_invoice_lines.unit_price       │ ← IMMUABLE (copie)
                    └────────────────────────────────────┘
```

**Règle : le prix est figé dans `commande_lines` lors du passage au statut `envoyée` (`fn_send_commande`).** Ce prix ne change jamais. La facture le copie tel quel.

### B. Quantité facturable

```
Facturable = received_quantity finale (après résolution litige si applicable)
```

| Cas | Quantité facturée |
|-----|-------------------|
| Réception complète (pas de litige) | `received_quantity` |
| Réception avec litige résolu | `received_quantity` (mise à jour par `fn_resolve_litige`) |
| Réception avec litige ouvert | ⛔ Facture **bloquée** |
| Ligne rupture (shipped=0) | 0 → ligne exclue de la facture |

**Règle : une commande n'est facturable que si statut = `recue` ET aucun litige `en_cours`.**

### C. Moment de facturation

```
Commande facturable = statut 'recue' + litige résolu (ou absent)
```

Le fournisseur génère la facture manuellement (V0). Pas de génération automatique.

---

## Architecture proposée

### Nouvelles tables

```sql
-- 1. En-tête facture générée dans l'app
CREATE TABLE app_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   text NOT NULL UNIQUE,           -- FAC-APP-000001
  commande_id      uuid NOT NULL REFERENCES commandes(id),
  
  -- Émetteur (fournisseur)
  supplier_establishment_id  uuid NOT NULL REFERENCES establishments(id),
  supplier_org_id            uuid NOT NULL REFERENCES organizations(id),
  
  -- Destinataire (client)
  client_establishment_id    uuid NOT NULL REFERENCES establishments(id),
  
  -- Snapshots en-tête (figés à la génération)
  supplier_name_snapshot     text NOT NULL,
  supplier_address_snapshot  text,
  supplier_siret_snapshot    text,
  client_name_snapshot       text NOT NULL,
  client_address_snapshot    text,
  client_siret_snapshot      text,
  
  -- Montants
  total_ht                   numeric(12,2) NOT NULL DEFAULT 0,
  -- Préparé pour TVA future (nullable pour V0)
  vat_rate                   numeric(5,2),
  vat_amount                 numeric(12,2),
  total_ttc                  numeric(12,2),
  
  -- Dates
  invoice_date               date NOT NULL DEFAULT CURRENT_DATE,
  commande_date              date,
  
  -- Métadonnées
  status                     text NOT NULL DEFAULT 'emise',  -- emise | annulee
  created_by                 uuid NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT app_invoices_one_per_commande UNIQUE (commande_id)
);

-- 2. Lignes de facture (copie figée des commande_lines)
CREATE TABLE app_invoice_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_invoice_id        uuid NOT NULL REFERENCES app_invoices(id) ON DELETE CASCADE,
  commande_line_id      uuid NOT NULL REFERENCES commande_lines(id),
  
  -- Snapshots produit
  product_id            uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  unit_label_snapshot   text,
  canonical_unit_id     uuid NOT NULL,
  
  -- Valeurs facturées (IMMUABLES)
  quantity              numeric NOT NULL,           -- = received_quantity finale
  unit_price            numeric(12,4) NOT NULL,     -- = commande_lines.unit_price_snapshot
  line_total            numeric(12,2) NOT NULL,     -- = quantity × unit_price arrondi
  
  created_at            timestamptz NOT NULL DEFAULT now()
);
```

### Ce que le module NE crée PAS

| Élément | Raison |
|---------|--------|
| Nouvelle table client/fournisseur | `establishment_profiles` existe déjà |
| Nouvelle table produit | `commande_lines` a tous les snapshots |
| Table de paiement | Hors scope V0 |
| Table d'avoir | Hors scope V0 |
| Logique TVA complète | Préparé (colonnes nullable) mais pas implémenté |

---

## Plan d'exécution en 6 étapes

### ÉTAPE 0 — Pré-requis : Figer le prix dans `commande_lines`

**Objectif :** Ajouter `unit_price_snapshot` et `line_total_snapshot` à `commande_lines`, remplis lors de `fn_send_commande`.

**Actions :**
1. Migration : `ALTER TABLE commande_lines ADD COLUMN unit_price_snapshot numeric(12,4), ADD COLUMN line_total_snapshot numeric(12,2)`
2. Modifier `fn_send_commande` pour figer le prix depuis `products_v2.final_unit_price` via le mapping B2B au moment de l'envoi
3. Étendre `trg_commandes_immutable_fields` pour protéger ces colonnes après envoi
4. Backfill optionnel des commandes passées (si données disponibles)

**Risques :** Aucun — ajout de colonnes nullable, pas de breaking change.

**Validation :** Envoyer une commande → vérifier que `unit_price_snapshot` est renseigné et immuable.

---

### ÉTAPE 1 — Tables et RLS `app_invoices` + `app_invoice_lines`

**Objectif :** Créer les tables, index, contraintes et politiques RLS.

**Actions :**
1. Migration SQL : création des 2 tables
2. Index : `app_invoices(supplier_establishment_id, invoice_date)`, `app_invoices(client_establishment_id, invoice_date)`
3. Séquence : utiliser `b2b_invoice_seq` existante pour `FAC-APP-XXXXXX`
4. RLS :
   - Fournisseur : lecture/écriture sur ses propres factures émises
   - Client : lecture seule sur les factures reçues
   - Isolation stricte par `establishment_id`
5. Contrainte `UNIQUE(commande_id)` → une seule facture par commande

**Risques :** Aucun — nouvelles tables isolées.

---

### ÉTAPE 2 — RPC `fn_generate_app_invoice`

**Objectif :** Créer la RPC atomique qui génère une facture à partir d'une commande validée.

**Actions :**
1. Vérifications pré-génération :
   - Commande au statut `recue`
   - Aucun litige `en_cours` sur cette commande
   - Pas de facture déjà existante pour cette commande
   - L'appelant est bien côté fournisseur
2. Snapshot des en-têtes depuis `establishment_profiles` + `establishments`
3. Copie des lignes avec `received_quantity` > 0 :
   - `quantity` = `commande_lines.received_quantity`
   - `unit_price` = `commande_lines.unit_price_snapshot`
   - `line_total` = `ROUND(quantity × unit_price, 2)`
4. Calcul `total_ht` = somme des `line_total`
5. Attribution `invoice_number` via `nextval('b2b_invoice_seq')`

**Sécurité :**
- `SECURITY DEFINER` avec auth check interne
- Verrouillage `FOR UPDATE` sur la commande
- Idempotence via `UNIQUE(commande_id)`

**Risques :**
- Si `unit_price_snapshot` est NULL (commande pré-migration) → erreur explicite, pas de facture silencieusement fausse

---

### ÉTAPE 3 — Module frontend `src/modules/factureApp/`

**Objectif :** Créer le module frontend isolé, côté fournisseur ET client.

**Structure :**
```
src/modules/factureApp/
├── index.ts                    # Barrel export
├── types.ts                    # AppInvoice, AppInvoiceLine
├── services/
│   └── appInvoiceService.ts    # Appel RPC + queries
├── hooks/
│   ├── useAppInvoices.ts       # Liste factures émises/reçues
│   └── useGenerateInvoice.ts   # Mutation génération
├── components/
│   ├── AppInvoiceList.tsx       # Liste avec filtres mois
│   ├── AppInvoiceDetail.tsx     # Vue détail facture
│   ├── AppInvoiceGenerateBtn.tsx # Bouton "Générer facture" sur commande
│   └── AppInvoicePdfView.tsx    # Rendu PDF (jsPDF)
```

**Côté fournisseur :**
- Nouveau sous-onglet **"Factures émises"** dans l'onglet Factures existant
- Liste par mois avec total mensuel en haut
- Colonnes : Client | Date | N° Commande | N° Facture | Montant HT
- Actions : Visualiser | Télécharger PDF

**Côté client :**
- Les factures app apparaissent **dans le même onglet** que les factures importées
- Distinction visuelle : badge `App` ou icône distincte
- Même classement par mois, même logique de totaux

---

### ÉTAPE 4 — Bouton "Générer facture" sur la commande

**Objectif :** Permettre au fournisseur de déclencher la génération depuis le détail commande.

**Actions :**
1. Sur le détail d'une commande `recue` (sans litige ouvert), afficher le bouton
2. Si la facture existe déjà → afficher "Voir la facture" à la place
3. Confirmation avant génération
4. Après succès → navigation vers le détail facture

**Règles d'affichage :**
```
Si commande.status !== 'recue'         → pas de bouton
Si litige.status === 'en_cours'        → bouton désactivé + tooltip "Litige en cours"
Si app_invoice existe pour commande_id → bouton "Voir la facture"
Sinon                                  → bouton "Générer la facture"
```

---

### ÉTAPE 5 — Génération PDF

**Objectif :** Produire un PDF propre téléchargeable.

**Actions :**
1. Utiliser `jsPDF` + `jspdf-autotable` (déjà installés)
2. En-tête : logo fournisseur (si dispo) + coordonnées fournisseur / client
3. Corps : tableau des lignes (produit, unité, qté, PU, total)
4. Pied : Total HT (+ emplacement réservé TVA/TTC)
5. Numéro de facture + numéro de commande + dates
6. Stockage optionnel dans Supabase Storage (bucket `app-invoices`)

---

## Cartographie des sources de vérité

| Donnée | SSOT | Table | Moment de figeage |
|--------|------|-------|--------------------|
| Prix unitaire facture | `commande_lines.unit_price_snapshot` | `commande_lines` | Envoi commande (`fn_send_commande`) |
| Quantité facturée | `commande_lines.received_quantity` | `commande_lines` | Réception finale (post-litige) |
| Nom produit | `commande_lines.product_name_snapshot` | `commande_lines` | Création commande |
| Unité | `commande_lines.unit_label_snapshot` | `commande_lines` | Création commande |
| Identité fournisseur | `establishment_profiles` | `establishment_profiles` | Snapshot à la génération |
| Identité client | `establishment_profiles` | `establishment_profiles` | Snapshot à la génération |
| N° commande | `commandes.order_number` | `commandes` | Envoi commande (immuable) |
| N° facture | `app_invoices.invoice_number` | `app_invoices` | Génération (séquence) |

---

## Risques identifiés et mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Prix NULL sur commandes pré-migration | Facture impossible | `fn_generate_app_invoice` refuse si prix NULL → message explicite |
| Double facture même commande | Incohérence financière | Contrainte `UNIQUE(commande_id)` en DB |
| Litige résolu après facture | Montant facturé ≠ réalité | V0 : bloque la facture si litige ouvert. V1 : avoir/annulation |
| Confusion factures importées / app | UX confuse | Badge visuel distinct + tables séparées |
| Prix catalogue modifié après envoi | Facture fausse | `unit_price_snapshot` figé + trigger d'immutabilité |
| Client modifie received_quantity | Montant change | `received_quantity` est set par `fn_receive_commande` (atomique) |

---

## Ce qui est préparé pour plus tard (PAS implémenté en V0)

| Fonctionnalité future | Préparation V0 |
|------------------------|----------------|
| **TVA** | Colonnes `vat_rate`, `vat_amount`, `total_ttc` nullable dans `app_invoices` |
| **Avoir / annulation** | Statut `annulee` prévu. Table `app_credit_notes` ajoutée plus tard |
| **Paiement** | Pas de colonne `is_paid` pour V0. Ajout ultérieur |
| **Envoi email** | Pas en V0. Le PDF est téléchargeable |
| **Multi-commandes / facture groupée** | `UNIQUE(commande_id)` → 1 commande = 1 facture. Changement possible plus tard |

---

## Scénarios E2E à tester après implémentation

1. **Happy path :** Commande → envoi → réception complète → générer facture → vérifier montants → télécharger PDF
2. **Litige bloquant :** Commande → réception partielle → litige ouvert → bouton facture désactivé → résoudre litige → facture possible
3. **Rupture :** Commande avec lignes rupture → facture n'inclut que les lignes livrées
4. **Double-clic :** Tenter de générer 2 factures pour la même commande → refus (contrainte UNIQUE)
5. **Prix post-envoi :** Modifier le prix catalogue après envoi → vérifier que la facture utilise le prix figé
6. **Côté client :** Facture visible dans l'onglet Factures existant avec badge "App"
7. **Côté fournisseur :** Facture visible dans sous-onglet "Factures émises" avec totaux mensuels

---

## Résumé des décisions clés

| Question | Réponse |
|----------|---------|
| Sur quoi on facture ? | `received_quantity` finale × `unit_price_snapshot` |
| À quel moment on fige le prix ? | À l'envoi de la commande (`fn_send_commande`) |
| À quel moment une commande est facturable ? | Statut `recue` + aucun litige `en_cours` |
| Où vivent les factures générées ? | Table `app_invoices` + `app_invoice_lines` (séparées de `invoices`) |
| Comment s'affichent-elles côté fournisseur ? | Sous-onglet "Factures émises" dans Factures |
| Comment s'affichent-elles côté client ? | Dans le même onglet Factures, avec badge distinctif |
| Conflit avec l'existant ? | Aucun — tables et module frontend totalement séparés |
