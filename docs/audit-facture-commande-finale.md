# Audit facture commande finale

**Date :** 2026-03-09  
**Périmètre :** Intégration des plats dans la facture fournisseur sans casser le flux produit existant

---

## SECTION 1 — Cartographie du flux facture actuel

### Déclenchement
- **Qui :** Le fournisseur, via `GenerateInvoiceButton` affiché dans le détail commande
- **Quand :** Statut commande = `recue` (vérifié côté RPC)
- **Comment :** Appel RPC `fn_generate_app_invoice(p_commande_id, p_user_id)`

### Pré-conditions vérifiées par la RPC (atomique, SECURITY DEFINER)
1. Commande existe et status = `recue`
2. Aucun litige ouvert (`litiges.status = 'open'`)
3. Aucune ligne sans `unit_price_snapshot`
4. Pas de facture existante pour cette commande (ratio 1:1)
5. Au moins une ligne avec `received_quantity > 0`

### Tables utilisées
| Table | Rôle |
|---|---|
| `commandes` | Source : statut, order_number, dates, establishment IDs |
| `commande_lines` | Source des lignes : product_id, product_name_snapshot, received_quantity, unit_price_snapshot, canonical_unit_id, unit_label_snapshot |
| `establishment_profiles` | Snapshots fournisseur/client (nom, adresse, SIRET, logo) |
| `app_invoices` | Destination : facture header (snapshots immuables) |
| `app_invoice_lines` | Destination : lignes de facture (snapshots immuables) |
| `app_invoice_seq` | Séquence de numérotation `FAC-APP-XXXXXX` |

### Calcul total
```sql
SUM(ROUND(received_quantity * unit_price_snapshot, 2))
```
Uniquement sur les lignes avec `received_quantity > 0`.

### Flux client
- Le client voit la facture dans `AppInvoicesClientList` (onglet "Factures émises")
- Détail via `AppInvoiceDetailSheet` (bottom sheet)
- Téléchargement PDF via `generateInvoicePdf` (jsPDF, sans état, snapshots uniquement)

### Composants impliqués
| Fichier | Rôle |
|---|---|
| `GenerateInvoiceButton.tsx` | Bouton fournisseur, appelle la RPC |
| `AppInvoiceDetailSheet.tsx` | Détail + PDF |
| `AppInvoicesClientList.tsx` | Liste côté client |
| `FacturesEmisesTab.tsx` | Liste côté fournisseur |
| `useFactureApp.ts` | Hooks React Query |
| `factureAppService.ts` | Appels Supabase |
| `generateInvoicePdf.ts` | Génération PDF jsPDF |

---

## SECTION 2 — Dépendances actuelles au modèle produit

### RPC `fn_generate_app_invoice` — couplages produit

| Point de couplage | Détail | Sévérité |
|---|---|---|
| `commande_lines` comme seule source | La RPC ne lit QUE `commande_lines` pour les lignes de facture | **Forte** |
| `product_id` obligatoire | Colonne NOT NULL dans `app_invoice_lines` | **Bloquante** |
| `commande_id` comme clé unique | `app_invoices.commande_id` est UNIQUE (1:1 commande→facture) | **Bloquante** pour les plats |
| `unit_price_snapshot` depuis `commande_lines` | Prix figé lors de l'envoi de la commande produit | N/A pour les plats |
| `canonical_unit_id` + `unit_label_snapshot` | Unités de mesure produit — pas pertinent pour les plats | **Structurel** |

### Types TypeScript — couplages

```typescript
// AppInvoiceLine
product_id: string;        // ← Obligatoire, pas de champ alternatif pour les plats
commande_line_id: string;  // ← FK vers commande_lines (produits), pas commande_plat_lines
canonical_unit_id: string; // ← Unité produit, les plats n'en ont pas
```

### Verdict couplage
**Le flux facture actuel est 100% couplé au modèle produit.** Il n'y a aucun point d'entrée pour les plats — ni dans la RPC, ni dans les tables, ni dans les types.

---

## SECTION 3 — État de préparation des plats pour la facture

### Snapshots disponibles dans `commande_plat_lines`

| Donnée | Colonne | Prêt ? |
|---|---|---|
| Nom commercial | `commercial_name_snapshot` | ✅ Snapshoté à la création |
| Prix unitaire | `unit_price_snapshot` | ✅ Snapshoté depuis `b2b_recipe_listings.b2b_price` |
| Quantité commandée | `quantity` | ✅ |
| Quantité reçue | `received_quantity` | ✅ Rempli lors de la réception |
| Total ligne | `line_total_snapshot` | ✅ `quantity * unit_price_snapshot` |
| Portions | `portions_snapshot` | ✅ Informatif |
| Listing ID | `listing_id` | ✅ FK stable vers la fiche plat commerciale |

### Données manquantes pour la facture

| Donnée | Existe ? | Impact |
|---|---|---|
| `canonical_unit_id` | ❌ | Les plats n'ont pas d'unité de mesure canonique — ce sont des "pièces" |
| `unit_label_snapshot` | ❌ | Pas d'unité — on peut utiliser "portion(s)" ou "pièce(s)" |
| `product_id` | ❌ | Les plats ne sont pas des produits — c'est un `listing_id` |

### Verdict préparation
**Les plats ont 90% des données nécessaires.** Il manque seulement la notion d'unité (trivial : "pièce" ou "portion"), et l'identifiant n'est pas un `product_id` mais un `listing_id`.

---

## SECTION 4 — Analyse des options d'intégration

### Option A — Mélanger produits et plats dans `app_invoice_lines`

**Principe :** Rendre `product_id` nullable, ajouter `listing_id` nullable, et insérer les plats directement dans `app_invoice_lines`.

| Avantage | Inconvénient |
|---|---|
| Une seule table de lignes | Pollue la table existante avec des colonnes nullable |
| PDF et UI simples | Casse la contrainte NOT NULL sur `product_id` |
| | `commande_line_id` ne peut pas pointer vers `commande_plat_lines` (FK différente) |
| | Confusion produit/plat dans les requêtes |

**Risque : ÉLEVÉ.** Modification destructive du schéma existant. Régression possible sur les factures déjà générées.

### Option B — Facture unique avec sections séparées (nouvelle table `app_invoice_dish_lines`)

**Principe :** Garder `app_invoice_lines` intacte pour les produits. Créer `app_invoice_dish_lines` pour les plats. Les deux pointent vers la même `app_invoices`.

| Avantage | Inconvénient |
|---|---|
| `app_invoice_lines` produit intacte | Deux tables de lignes pour une facture |
| Isolation totale produit/plat | RPC plus complexe (deux INSERTs) |
| Suppressible : DROP table dish_lines et c'est fini | Total HT = somme des deux tables |
| PDF lisible avec deux sections | UI doit gérer deux sources |

**Risque : FAIBLE.** Additif, réversible, pas de modification du schéma existant.

### Option C — Facture composite wrapper (comme la réception)

**Principe :** Deux factures séparées (une produit, une plat), regroupées visuellement par un wrapper.

| Avantage | Inconvénient |
|---|---|
| Zéro modification du moteur facture produit | Deux factures = deux numéros = confusion comptable |
| | Deux PDF séparés = mauvaise UX |
| | Le client reçoit deux documents pour une même commande |
| | Séquence `FAC-APP-` consomme deux numéros |

**Risque : MOYEN.** Propre techniquement mais mauvaise UX et problématique comptablement.

### Option D — Facture liée au `order_group` au lieu de la `commande`

**Principe :** La facture est générée à partir de l'`order_group` (qui lie commande + commande_plat). La RPC lit les deux tables de lignes.

| Avantage | Inconvénient |
|---|---|
| Modèle conceptuellement correct | Modification de la FK `commande_id` → `order_group_id` dans `app_invoices` |
| Un seul point d'entrée | Régression possible : les commandes sans order_group ne seraient plus facturables |
| | Les commandes produit-only n'ont pas toutes un order_group |

**Risque : ÉLEVÉ.** Modifie la source de vérité de la facture. Non rétrocompatible.

### Recommandation

**Option B** est la plus propre et la plus sûre :
- Zéro modification sur `app_invoice_lines` et `fn_generate_app_invoice` existants
- Nouvelle table `app_invoice_dish_lines` purement additive
- Nouvelle RPC ou extension de la RPC existante pour ajouter les lignes plats
- Facture unique avec un total unifié
- Supprimable sans impact

---

## SECTION 5 — Sources de vérité et snapshots

### Produits (existant — ne pas toucher)

| Donnée | Source de vérité | Snapshot dans |
|---|---|---|
| Prix unitaire | `commande_lines.unit_price_snapshot` (figé par `fn_send_commande`) | `app_invoice_lines.unit_price` |
| Nom produit | `commande_lines.product_name_snapshot` | `app_invoice_lines.product_name_snapshot` |
| Quantité facturée | `commande_lines.received_quantity` | `app_invoice_lines.quantity` |
| Total ligne | Calculé : `received_quantity × unit_price_snapshot` | `app_invoice_lines.line_total` |
| Unité | `commande_lines.canonical_unit_id` + `unit_label_snapshot` | `app_invoice_lines.canonical_unit_id` + `unit_label_snapshot` |

### Plats (à ajouter)

| Donnée | Source de vérité | Snapshot dans |
|---|---|---|
| Prix unitaire | `commande_plat_lines.unit_price_snapshot` (figé à la création/envoi) | Future `app_invoice_dish_lines.unit_price` |
| Nom commercial | `commande_plat_lines.commercial_name_snapshot` | Future `app_invoice_dish_lines.dish_name_snapshot` |
| Quantité facturée | `commande_plat_lines.received_quantity` | Future `app_invoice_dish_lines.quantity` |
| Total ligne | Calculé : `received_quantity × unit_price_snapshot` | Future `app_invoice_dish_lines.line_total` |
| Listing ID | `commande_plat_lines.listing_id` | Future `app_invoice_dish_lines.listing_id` |

### ⚠️ Point d'attention : moment du snapshot prix plat

Le prix des plats (`unit_price_snapshot`) est-il figé au même moment que pour les produits ?
- **Produits :** figé par `fn_send_commande` (trigger d'immutabilité)
- **Plats :** figé à la création de la ligne (`commande_plat_lines` INSERT) depuis `b2b_recipe_listings.b2b_price`

→ Les deux sont figés avant la réception. **OK pour la facture.**

---

## SECTION 6 — Risques de casse ou de conflit

### Risques avec Option B (recommandée)

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Total HT facture ne compte que les produits | CERTAIN si on ne modifie pas la RPC | Facture incomplète | Étendre la RPC pour sommer les deux tables |
| PDF n'affiche pas les plats | CERTAIN si on ne modifie pas le générateur | Facture incomplète | Ajouter section "Plats" dans `generateInvoicePdf` |
| `AppInvoiceDetailSheet` n'affiche pas les plats | CERTAIN si on ne modifie pas le composant | UI incomplète | Ajouter section plats dans le détail |
| Commande plat pas au bon statut | Possible | Facture incohérente | Vérifier `commande_plats.status = 'recue'` dans la RPC |
| Litige plat ouvert | Possible | Facture prématurée | Vérifier `litige_plats.status != 'open'` |
| Commande sans plats | Normal | Facture produit-only | La RPC doit gérer le cas : pas de plats = pas de dish_lines |
| Commande sans produits (plats seuls) | Possible | `commande_id` NULL dans app_invoices | Nécessite de rendre `commande_id` nullable OU de toujours avoir une commande produit |

### Risque structurel : commande plats-only

Actuellement `app_invoices.commande_id` est NOT NULL et UNIQUE. Si une commande n'a que des plats (pas de commande produit), il n'y a pas de `commande_id` à fournir.

**Solutions :**
1. Interdire les commandes plats-only pour la facturation (acceptable en V1)
2. Ajouter `commande_plat_id` nullable dans `app_invoices` et rendre `commande_id` nullable
3. Utiliser `order_group_id` comme clé de facture (Option D — trop risqué)

**Recommandation V1 :** Interdire la facturation plats-only. Si `order_group` a un `commande_id`, la facture est rattachée à la commande produit. Les plats sont ajoutés comme lignes supplémentaires.

---

## SECTION 7 — Recommandation d'architecture

### Architecture recommandée : Option B étendue

```
app_invoices (existante — une seule modification)
├── commande_id (existant, clé primaire de rattachement)
├── commande_plat_id (NOUVEAU, nullable)  ← identifie la commande plat liée
├── total_ht (recalculé : produits + plats)
├── ... (tous les snapshots fournisseur/client identiques)
│
├── app_invoice_lines (existante — INTACTE)
│   └── lignes produit (product_id, received_quantity, unit_price_snapshot...)
│
└── app_invoice_dish_lines (NOUVELLE TABLE)
    ├── app_invoice_id FK
    ├── commande_plat_line_id FK → commande_plat_lines.id
    ├── listing_id FK → b2b_recipe_listings.id
    ├── dish_name_snapshot TEXT NOT NULL
    ├── quantity NUMERIC NOT NULL (received_quantity)
    ├── unit_price NUMERIC NOT NULL
    ├── line_total NUMERIC NOT NULL
    ├── portions_snapshot INT (informatif)
    └── created_at TIMESTAMPTZ
```

### Modifications nécessaires

| Cible | Modification | Risque |
|---|---|---|
| `app_invoices` | Ajouter colonne `commande_plat_id` (nullable, FK) | Nul — additif |
| Nouvelle table `app_invoice_dish_lines` | Créer | Nul — additif |
| `fn_generate_app_invoice` RPC | Étendre : lire `order_groups` → trouver `commande_plat_id` → insérer dish_lines → recalculer total | Moyen — tester soigneusement |
| `factureAppService.ts` | `getAppInvoiceWithLines` : fetch aussi `app_invoice_dish_lines` | Faible |
| `types.ts` (module) | Ajouter `AppInvoiceDishLine`, étendre `AppInvoiceWithLines` | Nul |
| `AppInvoiceDetailSheet.tsx` | Ajouter section "Plats" sous les lignes produits | Faible |
| `generateInvoicePdf.ts` | Ajouter section "Plats" dans le PDF | Faible |

### Flux de facturation étendu

1. Fournisseur clique "Générer facture" (même bouton)
2. RPC vérifie : commande `recue`, pas de litiges ouverts, prix snapshots OK
3. RPC cherche `order_groups` pour trouver le `commande_plat_id` associé
4. Si `commande_plat_id` trouvé : vérifie statut `recue`, pas de litige plat ouvert
5. INSERT `app_invoices` (avec `commande_plat_id` si applicable)
6. INSERT `app_invoice_lines` (produits — code existant inchangé)
7. INSERT `app_invoice_dish_lines` (plats — nouveau code)
8. Total HT = somme produits + somme plats
9. Retour `{ok: true, invoice_id, invoice_number, total_ht}`

### Réversibilité

Pour retirer les plats de la facture :
1. `DROP TABLE app_invoice_dish_lines`
2. `ALTER TABLE app_invoices DROP COLUMN commande_plat_id`
3. Retirer le code plats de la RPC
4. Retirer la section plats du UI et du PDF
5. **Le flux facture produit continue exactement comme avant**

---

## SECTION 8 — Verdict final

### Réponses explicites

| Question | Réponse |
|---|---|
| **Peut-on ajouter les plats sans casser la facture produit ?** | ✅ OUI — avec Option B (table séparée, RPC étendue) |
| **Le flux actuel est-il trop couplé aux produits ?** | OUI — 100% couplé, mais c'est normal car les plats n'existaient pas. Le couplage est dans la RPC et les tables, pas dans l'architecture |
| **Les plats ont-ils les bonnes snapshots ?** | ✅ OUI — `commercial_name_snapshot`, `unit_price_snapshot`, `received_quantity` sont tous présents dans `commande_plat_lines` |
| **Faut-il une facture composite ou un autre modèle ?** | Une facture UNIQUE avec deux tables de lignes (produits + plats). Pas deux factures |
| **Quelle est la solution la plus propre ?** | **Option B** : table `app_invoice_dish_lines` additive, RPC étendue, UI avec section "Plats" |
| **Que faut-il absolument éviter ?** | (1) Rendre `product_id` nullable dans `app_invoice_lines` (2) Mélanger produits et plats dans la même table (3) Modifier la FK `commande_id` pour pointer vers `order_groups` (4) Créer deux factures séparées |

### Verdict

**GO conditionnel** — L'intégration est faisable proprement avec l'Option B. Conditions :

1. **P0 — Table `app_invoice_dish_lines`** : créer avant toute modification de la RPC
2. **P0 — Extension RPC** : ajouter le bloc plats dans `fn_generate_app_invoice` avec les mêmes gardes (statut, litiges)
3. **P1 — UI + PDF** : ajouter la section plats dans le détail et le PDF
4. **P1 — Cas plats-only** : décider si on interdit la facturation sans commande produit (recommandé en V1)
5. **P2 — Tests** : ajouter des tests business pour les cas mixtes, produit-only, plat avec écart

### Ce qui NE DOIT PAS être touché
- `app_invoice_lines` (table) — zéro modification
- Le code d'insertion des lignes produit dans la RPC — zéro modification
- Les snapshots fournisseur/client — identiques pour produits et plats (même commande groupée)
- `GenerateInvoiceButton` — même bouton, même flow
- La séquence `FAC-APP-` — un seul numéro par facture

---

*Fin de l'audit. Aucun code produit. En attente de validation de l'architecture avant implémentation.*
