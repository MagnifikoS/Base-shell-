# Audit doublons retours commandes

**Date** : 2026-03-10  
**Périmètre** : Retours marchandise dupliqués sur une même ligne de commande  
**Méthode** : Analyse code + données de production  

---

## SECTION 1 — Cartographie flux retour

### Cycle de vie

```
Client réceptionne commande
  ↓ Constate un problème (produit cassé, mauvais, DLC, etc.)
  ↓ Clique "Signaler un retour" dans l'UI
  ↓ Remplit le formulaire (type, quantité, commentaire, photo optionnelle)
  ↓ createReturn() → INSERT INTO product_returns
  ↓ Statut initial : 'pending'
  ↓ Fournisseur résout : 'accepted' ou 'refused' + résolution (avoir, remplacement, retour physique)
```

### Nature des retours

Les retours sont des **SIGNALEMENTS DÉCLARATIFS** (cf. types.ts L4-8) :
- N'impactent PAS le stock
- N'impactent PAS les litiges
- N'impactent PAS les commandes
- Sont indépendants de tout autre flux

### Service

`retourService.ts` :
- `createReturn()` : INSERT simple, sans vérification de doublon
- `resolveReturn()` : UPDATE status + resolution
- Pas de contrainte d'unicité sur `(commande_line_id, return_type)`

---

## SECTION 2 — Reproduction théorique / réelle

### Données réelles en production

**Doublon confirmé** :

| ID | commande_line_id | return_type | status | created_at |
|----|-----------------|-------------|--------|------------|
| `e5fbe5c0-...` | `69a3d099-...` | mauvais_produit | pending | 2026-03-06 14:54:08 |
| `bb25510c-...` | `69a3d099-...` | mauvais_produit | pending | 2026-03-06 14:54:53 |

**Produit** : PRODUIT Y - HUILE AMPHORE  
**Commande** : CMD-000005  
**Écart temporel** : 45 secondes entre les deux insertions

### Reproduction théorique

| Scénario | Probabilité | Mécanisme |
|----------|-------------|-----------|
| Double clic utilisateur | **Élevée** | Pas de `isSending` guard visible dans le service |
| Double soumission formulaire | **Élevée** | Pas de debounce côté UI |
| Race condition réseau | **Moyenne** | Deux requêtes parallèles, pas de verrou |
| Mauvaise UX (pas de feedback) | **Élevée** | Utilisateur re-soumet si pas de toast rapide |

---

## SECTION 3 — Cause probable

### Cause principale : Absence totale de garde anti-doublon

**Niveau DB** : Pas de contrainte UNIQUE sur `(commande_line_id, return_type)` ni sur aucune combinaison pertinente.

**Niveau service** : `createReturn()` fait un `INSERT` brut sans vérification préalable :
```typescript
const { data, error } = await db.from("product_returns").insert({...}).select().single();
```

**Niveau UI** : Non audité en détail, mais l'écart de 45 secondes entre les deux inserts suggère une re-soumission manuelle plutôt qu'un double-clic technique.

**Niveau RLS** : La policy `Client can create returns` autorise l'insertion sans vérification de doublon.

---

## SECTION 4 — Impact

### Impact métier

| Aspect | Impact | Sévérité |
|--------|--------|----------|
| Liste des retours | 2 entrées identiques pour le même produit | 🟡 P2 |
| Résolution fournisseur | Doit résoudre les deux séparément | 🟡 P2 |
| Reporting | Comptage faussé (2 retours au lieu de 1) | 🟡 P2 |
| Stock | Aucun (retours sont déclaratifs) | ✅ |
| Facturation | Aucun (retours sont déclaratifs) | ✅ |
| Commande | Aucun (retours sont déclaratifs) | ✅ |

### Facteur atténuant

Les retours étant purement déclaratifs et sans impact sur le stock, la facturation ou les commandes, le risque est limité à de la **pollution de données et UX**. Ce n'est pas un bug métier grave.

---

## SECTION 5 — Recommandation

### R1 — Garde frontend (Priorité haute, effort faible)

Ajouter un `isSending` state dans le formulaire de retour pour empêcher la double soumission :
```typescript
const [isSending, setIsSending] = useState(false);
// Désactiver le bouton pendant l'envoi
```

### R2 — Contrainte DB (Priorité moyenne)

Ajouter une contrainte UNIQUE partielle ou un check en service :
```sql
-- Option 1 : contrainte unique
ALTER TABLE product_returns 
ADD CONSTRAINT uq_return_line_type 
UNIQUE (commande_line_id, return_type);

-- Option 2 : contrainte plus souple (par commande)
-- Permettre plusieurs types de retour différents sur la même ligne
```

⚠️ Attention : un utilisateur peut légitimement signaler deux problèmes différents sur le même produit (ex: `mauvais_produit` ET `produit_casse`). La contrainte doit être sur `(commande_line_id, return_type)`, pas juste `commande_line_id`.

### R3 — Nettoyage des doublons existants (Priorité basse)

Supprimer le doublon `bb25510c-...` (le plus récent des deux, tous deux en `pending`).

---

## SECTION 6 — Verdict

### 🟡 DETTE ACCEPTABLE — Pas de risque métier grave

Le doublon est confirmé et reproductible, mais son impact est limité car les retours sont déclaratifs. La correction la plus efficace est un guard frontend (`isSending`) qui empêche la double soumission. Une contrainte DB est souhaitable mais pas urgente.

**Risque réel** : Pollution UX et données, pas de corruption business.  
**Effort de correction** : ~30 minutes (guard frontend + purge doublon).
