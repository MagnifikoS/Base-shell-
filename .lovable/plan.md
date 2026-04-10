
# Plan d'implémentation — Supermodule "Stock & Achat"

## Résumé

Créer un vrai bundle fonctionnel "Stock & Achat" dans le superadmin qui, en un clic, active tous les modules du domaine ET provisionne les données de base manquantes (conversions d'unités, settings).

---

## Partie A — Où définir le supermodule

### Fichiers concernés :
1. **`src/lib/platform/moduleBundles.ts`** (NOUVEAU) — Définition SSOT des bundles
2. **`src/lib/platform/moduleDependencies.ts`** — Ajout des clés manquantes
3. **`src/components/platform/EstablishmentModulesTab.tsx`** — UI avec section bundle
4. **`src/components/platform/PlatformCreateOrgWizard.tsx`** — Step 3 avec bundle toggle

### Représentation :
Le supermodule est un **mapping frontend** (pas une nouvelle table DB). C'est un objet `STOCK_ACHAT_BUNDLE` qui liste les `module_key` à activer ensemble + les dépendances invisibles.

---

## Partie B — Modules à rattacher

### Modules visibles (clés DB existantes) :
- `produits_v2` — Catalogue produits
- `fournisseurs` — Gestion fournisseurs  
- `clients_b2b` — Clients B2B
- `commandes` — Commandes fournisseurs
- `inventaire` — Inventaire
- `factures` — Factures
- `bl_app` — Bons de livraison (⚠️ absent de la table `modules` → à insérer)
- `pertes` — Pertes & Casse
- `notif_commande` — Notifications commande

### Modules à créer dans la table `modules` :
- `bl_app` (key manquante)
- `stock_ledger` (key manquante)
- `stock_alerts` (key manquante)
- `vision_ai` (scan factures IA — key manquante)
- `dlc_critique` (DLC critique — key manquante)

### Dépendances invisibles (pas de module_key, mais provisionnées) :
- Unités de mesure (déjà seedées via `platform_unit_templates`)
- **Conversions d'unités** (g↔kg, ml↔L, cl↔L — ⚠️ MANQUANT)
- Zones de stockage (déjà seedées)
- Catégories produits (déjà seedées)
- `extraction_settings` (⚠️ MANQUANT)
- `dlc_alert_settings` (⚠️ MANQUANT)
- `establishment_stock_settings` (⚠️ MANQUANT)

---

## Partie C — Provisioning à ajouter

### Migration SQL — Mise à jour de `platform_create_organization_wizard` :

1. **Insérer les modules manquants** dans la table `modules` :
   - `bl_app`, `stock_ledger`, `stock_alerts`, `vision_ai`, `dlc_critique`

2. **Seeder les conversions d'unités** après le seed des unités :
   ```sql
   -- Pour chaque paire (g↔kg, ml↔L, cl↔L, cl↔ml) :
   INSERT INTO unit_conversions (establishment_id, from_unit_id, to_unit_id, factor)
   SELECT v_est_id, f.id, t.id, <factor>
   FROM measurement_units f, measurement_units t
   WHERE f.establishment_id = v_est_id AND f.abbreviation = 'g'
     AND t.establishment_id = v_est_id AND t.abbreviation = 'kg';
   ```

3. **Seeder les settings par défaut** :
   - `extraction_settings` (avec defaults)
   - `dlc_alert_settings` (avec defaults)
   - `establishment_stock_settings` (zone réception = première zone)

---

## Partie D — Intégration dans le wizard de création

### `PlatformCreateOrgWizard.tsx` (Step 3) :
- Ajouter un bouton "Stock & Achat" en haut qui coche/décoche tous les modules du bundle d'un coup
- Quand coché → tous les modules du bundle sont sélectionnés
- Le provisioning des conversions/settings se fait côté SQL (dans la RPC)

### `EstablishmentModulesTab.tsx` :
- Ajouter une section "Bundles" au-dessus de la grille modules
- Un toggle "Stock & Achat" qui active/désactive tous les modules du bundle
- Badge visuel "Bundle" sur les modules qui font partie du pack

---

## Partie E — Ordre d'implémentation

1. **Migration SQL** : Ajouter modules manquants + conversions + settings dans la RPC
2. **`moduleBundles.ts`** : Créer la définition SSOT du bundle
3. **`moduleDependencies.ts`** : Ajouter les nouvelles clés dans le graphe
4. **`EstablishmentModulesTab.tsx`** : Ajouter section bundle
5. **`PlatformCreateOrgWizard.tsx`** : Ajouter toggle bundle dans Step 3

---

## Partie F — Checklist de validation

- [ ] Créer un nouvel établissement avec bundle "Stock & Achat" activé
- [ ] Vérifier que tous les modules sont dans `platform_establishment_module_selections`
- [ ] Vérifier que `unit_conversions` contient 8 lignes (g↔kg, ml↔L, cl↔L, cl↔ml)
- [ ] Vérifier que `extraction_settings` existe
- [ ] Vérifier que `dlc_alert_settings` existe
- [ ] Vérifier que `establishment_stock_settings` existe
- [ ] Comparer avec l'établissement de référence (NONNA SECRET)
