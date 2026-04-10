# Module "Écarts Inventaire" — Rapport d'Analyse & Plan d'Implémentation

> **Date** : 2026-03-07  
> **Statut** : Proposition V0 — Revue architecture + croisement code  
> **Auteur** : Lovable AI

---

## 1. Résumé Exécutif

Le module "Écarts Inventaire" est un **observateur intelligent** branché sur le système d'inventaire existant. Il détecte et trace les situations où un retrait est effectué alors que le stock théorique est à 0 ou insuffisant, sans jamais modifier le stock réel.

**Philosophie** : `il lit → il déduit → il trace → il ne réécrit rien`

---

## 2. Croisement avec le Code Existant

### 2.1 Points d'Interception Identifiés

| Composant existant | Fichier | Rôle dans le module Écarts |
|---|---|---|
| **Stock Engine** | `src/modules/stockLedger/engine/stockEngine.ts` | Fournit `estimated_quantity` — le module Écarts **lit** cette valeur, ne la modifie jamais |
| **Post Guards** | `src/modules/stockLedger/engine/postGuards.ts` | `checkNegativeStock()` détecte déjà les stocks négatifs (lignes 123-143). C'est ici que l'écart doit être **détecté** |
| **Withdrawal View (Mobile)** | `src/modules/stockLedger/components/MobileWithdrawalView.tsx` | Flow de retrait mobile — le retrait est autorisé même si stock = 0, l'écart est créé au moment du POST |
| **Withdrawal View (Desktop)** | `src/modules/stockLedger/components/WithdrawalView.tsx` | Idem desktop |
| **Inventaire Page** | `src/modules/inventaire/pages/InventairePage.tsx` | Ajouter l'icône "Écarts" dans la barre de navigation (tab bar existante, ligne 29-36) |
| **Stock Events** | Table `stock_events` | Le module Écarts lit les événements WITHDRAWAL pour enrichir l'enquête |
| **Inventory Sessions** | Table `inventory_sessions` + `inventory_lines` | Dernier comptage du produit — données d'enquête |

### 2.2 Architecture Existante Respectée

| Principe | Conformité |
|---|---|
| **SSOT Stock Engine** | ✅ Le module ne recalcule jamais le stock — il lit `estimated_quantity` |
| **Snapshot Immutability** | ✅ Aucune écriture dans `inventory_lines` historiques |
| **Module Independence** | ✅ Isolé dans `src/modules/ecartsInventaire/` avec barrel export |
| **DAG sans cycles** | ✅ Dépendance lecture seule vers `stockLedger` et `inventaire` |
| **RLS Mandatory** | ✅ Tables protégées par `establishment_id` + `organization_id` |
| **Realtime centralisé** | ✅ Si besoin, canal ajouté dans `useAppRealtimeSync.ts` |

### 2.3 Risques Identifiés → Tous Mitigés

| Risque | Mitigation |
|---|---|
| Modification du stock par le module | **Impossible** — aucune écriture dans `stock_events`, `inventory_lines`, `zone_stock_snapshots` |
| Blocage du retrait | **Impossible** — le retrait passe normalement, l'écart est un **effet secondaire passif** |
| Couplage fort avec inventaire | **Mitigé** — lecture seule via des requêtes SQL simples, pas d'import de hooks internes |
| Performance | **Mitigé** — écriture d'un seul INSERT par écart, lecture lazy des données d'enquête |

---

## 3. Schéma Base de Données

### 3.1 Nouvelle Table : `inventory_discrepancies`

```sql
CREATE TYPE public.discrepancy_status AS ENUM ('open', 'analyzed', 'closed');

CREATE TABLE public.inventory_discrepancies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Données du retrait
  product_id      UUID NOT NULL REFERENCES products_v2(id),
  storage_zone_id UUID NOT NULL REFERENCES storage_zones(id),
  quantity_gap    NUMERIC NOT NULL,          -- quantité en écart (toujours positive)
  canonical_unit_id UUID NOT NULL REFERENCES measurement_units(id),
  
  -- Contexte du retrait
  withdrawal_document_id UUID REFERENCES stock_documents(id),
  withdrawal_at   TIMESTAMPTZ NOT NULL,
  withdrawal_by   UUID,                      -- user_id qui a fait le retrait
  withdrawal_reason TEXT,                    -- CONSUMPTION / EXPIRY
  
  -- Stock au moment du retrait
  estimated_stock_at_withdrawal NUMERIC NOT NULL DEFAULT 0,
  
  -- Statut d'enquête
  status          discrepancy_status NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_discrepancies_establishment_status 
  ON inventory_discrepancies(establishment_id, status);
CREATE INDEX idx_discrepancies_product 
  ON inventory_discrepancies(product_id);

-- RLS
ALTER TABLE inventory_discrepancies ENABLE ROW LEVEL SECURITY;

-- Policies (même pattern que inventory_mutualisation_*)
CREATE POLICY "Users can read discrepancies for their establishment"
  ON inventory_discrepancies FOR SELECT TO authenticated
  USING (
    establishment_id IN (
      SELECT establishment_id FROM user_establishments 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert discrepancies for their establishment"
  ON inventory_discrepancies FOR INSERT TO authenticated
  WITH CHECK (
    establishment_id IN (
      SELECT establishment_id FROM user_establishments 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update discrepancies for their establishment"
  ON inventory_discrepancies FOR UPDATE TO authenticated
  USING (
    establishment_id IN (
      SELECT establishment_id FROM user_establishments 
      WHERE user_id = auth.uid()
    )
  );
```

> **Note** : Pas de table de settings séparée pour V0. Le module est actif dès qu'il est branché, comme la mutualisation.

---

## 4. Structure du Module

```
src/modules/ecartsInventaire/
├── index.ts                          # Barrel export (SSOT module boundary)
├── types.ts                          # Discrepancy, DiscrepancyStatus, etc.
├── components/
│   ├── EcartsInventaireView.tsx      # Vue principale (liste des écarts)
│   ├── EcartDetailDrawer.tsx         # Drawer détail + données d'enquête
│   ├── EcartStatusBadge.tsx          # Badge ouvert/analysé/clos
│   └── EcartInvestigationPanel.tsx   # Panel avec dernière réception, dernier retrait, dernier inventaire
├── hooks/
│   ├── useDiscrepancies.ts           # React Query: liste des écarts
│   ├── useDiscrepancyDetail.ts       # React Query: détail + données d'enquête
│   └── useUpdateDiscrepancyStatus.ts # Mutation: changer statut
└── services/
    └── createDiscrepancy.ts          # Logique de création d'un écart (appelée depuis postGuards)
```

---

## 5. Étapes d'Implémentation (Ordre Strict)

### Étape 1 — Migration DB (0 risque)
- Créer la table `inventory_discrepancies` + enum + index + RLS
- **Isolation** : aucune modification de table existante
- **Rollback** : `DROP TABLE inventory_discrepancies; DROP TYPE discrepancy_status;`

### Étape 2 — Module Frontend Isolé (0 risque)
- Créer `src/modules/ecartsInventaire/` avec types, hooks, composants
- **Isolation** : aucun fichier existant modifié
- **Supprimable** : `rm -rf src/modules/ecartsInventaire/`

### Étape 3 — Branchement Tab Inventaire (risque minimal)
- Ajouter un tab "Écarts" dans `InventairePage.tsx` (ligne 29-36 du tableau `BASE_INVENTORY_TABS`)
- Ajouter une icône `Scale` (ou `TriangleAlert`) + badge compteur
- **Modification** : 1 seul fichier (`InventairePage.tsx`), ajout de ~5 lignes
- **Rollback** : retirer le tab

### Étape 4 — Détection d'Écart au POST (risque faible, bien isolé)
- **Point d'interception** : après le POST réussi d'un document WITHDRAWAL
- **Logique** : si `checkNegativeStock()` retourne des produits négatifs → créer un écart via INSERT dans `inventory_discrepancies`
- **Modification** : hook `usePostDocument` — ajouter un callback `onPostSuccess` qui vérifie et crée les écarts
- **Le retrait passe normalement** — l'écart est un effet secondaire asynchrone
- **Rollback** : retirer le callback

### Étape 5 — Vue Écarts (0 risque)
- Liste des écarts ouverts/analysés/clos avec filtres
- Chaque ligne : produit, quantité, date, utilisateur, zone
- Click → Drawer détail avec panel d'enquête

### Étape 6 — Panel d'Enquête (0 risque, lecture seule)
- Requêtes en lecture seule sur :
  - `stock_events` WHERE `event_type = 'RECEIPT'` → dernière réception
  - `stock_events` WHERE `event_type = 'WITHDRAWAL'` → dernier retrait avant celui-ci
  - `inventory_lines` JOIN `inventory_sessions` → dernier comptage
- Calcul des indicateurs :
  - "Dernière réception il y a X jours"
  - "Dernier comptage il y a X jours"
  - "Aucune réception enregistrée"

### Étape 7 — Mise à jour statut (risque minimal)
- Boutons : Ouvert → Analysé → Clos
- Champ `resolution_note` optionnel
- Mutation simple UPDATE sur `inventory_discrepancies`

---

## 6. Améliorations Proposées (au-delà de la V0)

### 6.1 Immédiat (V0+)

| Idée | Détail | Complexité |
|---|---|---|
| **Badge compteur temps réel** | Ajouter `inventory_discrepancies` au `supabase_realtime` pour que le badge "Écarts (4)" se mette à jour en live | Faible |
| **Regroupement par produit** | Si le même produit génère 3 écarts en 1 semaine → les regrouper visuellement avec un indicateur "récurrent" | Faible |
| **Export CSV** | Bouton export des écarts ouverts pour analyse externe (utiliser `exportCsv` existant dans `src/utils/`) | Faible |

### 6.2 V1 (après validation terrain)

| Idée | Détail | Complexité |
|---|---|---|
| **Score de fiabilité zone** | Ratio écarts/retraits par zone sur 30 jours → identifier les zones problématiques | Moyen |
| **Suggestion automatique de cause** | Si dernière réception < 48h et écart → afficher "Réception probablement non saisie" | Moyen |
| **Notification push** | Alerter le manager quand un écart est créé (brancher sur `pushNotif` module existant) | Moyen |
| **Lien direct vers réception** | Depuis un écart, créer un brouillon de réception pré-rempli pour corriger | Moyen |

### 6.3 V2 (si le module prouve sa valeur)

| Idée | Détail | Complexité |
|---|---|---|
| **Tableau de bord écarts** | Graphiques : écarts/semaine, top produits en écart, zones les plus touchées | Élevé |
| **Workflow de validation** | Manager doit valider la résolution d'un écart avant clôture | Élevé |
| **Corrélation avec DLC** | Croiser écarts avec les alertes DLC → produits retirés pour péremption non tracée | Élevé |

---

## 7. Ce que le Module NE FAIT PAS (Garde-fous V0)

| Interdit V0 | Raison |
|---|---|
| ❌ Modifier `stock_events` | Le module est un observateur, pas un moteur |
| ❌ Modifier `inventory_lines` | Snapshot immutability policy |
| ❌ Modifier `zone_stock_snapshots` | Intégrité du StockEngine |
| ❌ Bloquer un retrait | Le retrait passe toujours, l'écart est passif |
| ❌ Créer un stock parallèle | Un seul stock théorique (StockEngine) |
| ❌ Corriger automatiquement | L'humain enquête et décide |
| ❌ Toucher Produits V2, Commandes, Factures, DLC, B2B | Isolation stricte |

---

## 8. Matrice de Suppression (Test d'Indépendance)

Pour supprimer le module sans casser le reste :

```bash
# 1. Supprimer le module
rm -rf src/modules/ecartsInventaire/

# 2. Retirer le tab dans InventairePage.tsx (1 ligne dans BASE_INVENTORY_TABS)

# 3. Retirer le callback onPostSuccess dans usePostDocument (si ajouté)

# 4. Migration DB rollback
DROP TABLE IF EXISTS inventory_discrepancies;
DROP TYPE IF EXISTS discrepancy_status;
```

**Résultat** : 0 impact sur le reste du système. ✅

---

## 9. Résumé Décisionnel

| Question | Réponse |
|---|---|
| Est-ce isolé ? | ✅ Oui — module indépendant, 1 table, barrel export |
| Est-ce sans risque ? | ✅ Oui — lecture seule sur le stock, aucune modification du moteur |
| Est-ce supprimable ? | ✅ Oui — `rm -rf` + 2 lignes à retirer |
| Est-ce utile ? | ✅ Oui — remonte les oublis de réception, les mauvais comptages, les erreurs de zone |
| Est-ce le bon pattern ? | ✅ Oui — même architecture que `inventaireMutualisation` (isolé, branché, supprimable) |

---

## 10. Prochaine Action

**En attente de validation** pour lancer l'implémentation en suivant les 7 étapes ci-dessus.

Temps estimé : ~2-3 sessions de travail pour la V0 complète.
