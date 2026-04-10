# Audit findConversionPath

## 1. Résumé exécutif

| Critère | Verdict |
|---------|---------|
| Moteur fiable | ✅ **Safe** |
| Niveau de risque | **Faible** — aucune faille critique identifiée |
| Conversion plausible mais fausse | **Non** — le BFS multiplie correctement les facteurs le long du chemin |
| Risque de corruption stock | **Non** — en l'absence de chemin, le moteur retourne `null` (jamais de factor inventé) |

Le moteur `findConversionPath` est **structurellement sain**. Le seul bug réel était en amont (extracteurs `levels`/`packagingLevels` et `quantity`/`containsQuantity` — déjà corrigé).

---

## 2. Cartographie du moteur

| Élément | Fichier |
|---------|---------|
| `findConversionPath` | `src/modules/conditionnementV2/conversionGraph.ts:162-233` |
| `buildGraph` (privé) | `src/modules/conditionnementV2/conversionGraph.ts:54-152` |
| `addEdge` (privé) | `src/modules/conditionnementV2/conversionGraph.ts:62-66` |
| Types `PackagingLevel`, `Equivalence` | `src/modules/conditionnementV2/types.ts` |
| Types `ConversionRule`, `UnitWithFamily` | `src/core/unitConversion/types.ts` |
| Tests | `src/modules/conditionnementV2/__tests__/conversionGraph.test.ts` (10 tests) |

### Données d'entrée
- `fromId`, `toId` — UUIDs des unités source/cible
- `units: UnitWithFamily[]` — toutes les unités DB (pour labels + famille + via-reference)
- `dbConversions: ConversionRule[]` — conversions physiques DB (ex: kg↔g, factor 1000)
- `packagingLevels: PackagingLevel[]` — niveaux de conditionnement produit (ex: 1 Sac = 25 kg)
- `equivalence: Equivalence | null` — équivalence produit (ex: 1 Pièce = 50 g)

### Données de sortie
- `factor: number | null` — facteur multiplicatif (`null` si aucun chemin)
- `reached: boolean` — chemin trouvé ou non
- `warnings: string[]` — messages d'erreur
- `path: string[]` — chemin lisible (debug UX)

---

## 3. Sens de conversion

### Analyse du code

Le graphe est **bidirectionnel**. Chaque source d'arête crée deux entrées :

**DB conversions (L68-77)** :
- `from → to` avec `factor` (ex: kg→g = 1000)
- `to → from` avec `1/factor` (ex: g→kg = 0.001)
- ✅ Protégé contre division par zéro : `if (rule.factor !== 0)` (L74)

**Packaging levels (L126-139)** :
- `type → contains` avec `containsQuantity` (ex: Sac→kg = 25)
- `contains → type` avec `1/containsQuantity` (ex: kg→Sac = 0.04)
- ✅ Protégé : `if (!qty || qty <= 0) continue` (L131)

**Equivalence (L141-149)** :
- `source → unit` avec `quantity` (ex: Pièce→g = 50)
- `unit → source` avec `1/quantity` (ex: g→Pièce = 0.02)
- ✅ Protégé : `equivalence.quantity > 0` (L142)

### Preuve de correction du sens

Le BFS (L200-226) multiplie les facteurs : `newFactor = current.factor * edge.factor` (L207).

**Cas Sac → kg** :
- Edge `Sac→kg` a factor = 25 (via packaging level)
- Résultat : `1 × 25 = 25` ✅

**Cas kg → Sac** :
- Edge `kg→Sac` a factor = `1/25 = 0.04`
- Résultat : `1 × 0.04 = 0.04` ✅

**Cas multi-étape kg → pce (via g + équivalence)** :
- Edge `kg→g` factor = 1000
- Edge `g→pce` factor = `1/50 = 0.02`
- Résultat : `1 × 1000 × 0.02 = 20` ✅ (vérifié par test L135-152)

**Verdict sens** : ✅ Correct. Les facteurs sont toujours dans le bon sens grâce à la bidirectionnalité systématique.

---

## 4. Audit des chemins multi-étapes

### Mécanisme

Le BFS utilise une file FIFO (L200 : `queue.shift()`) et multiplie les facteurs à chaque traversée (L207). Le `visited` set (L192) empêche les revisites.

### Cas testés

| Chemin | Étapes | Facteur attendu | Test |
|--------|--------|-----------------|------|
| kg → g | 1 | 1000 | ✅ L91-95 |
| g → kg | 1 (inverse) | 0.001 | ✅ L97-101 |
| carton → boîte | 1 (packaging) | 10 | ✅ L103-117 |
| boîte → carton | 1 (inverse) | 0.1 | ✅ L119-133 |
| kg → pce | 2 (DB + éq.) | 20 | ✅ L135-152 |
| kg → boîte | 3 (DB + éq. + packaging) | 10 | ✅ L224-230 |

### Multiplication correcte ?

Oui. Le facteur est accumulé par multiplication simple : `current.factor * edge.factor`. Pour un chemin A→B→C avec factors f₁ et f₂, le résultat est `f₁ × f₂`. C'est mathématiquement correct pour les conversions d'unités.

### Risque d'erreur de précision flottante

Les tests utilisent `toBeCloseTo` pour les inversions (ex: `0.1`). En pratique, les quantités de conditionnement sont des entiers (25, 12, 10) et les conversions physiques sont des multiples de 10 (1000). Le risque de dérive IEEE-754 significative est **négligeable** pour les cas métier réels.

**Verdict multi-étapes** : ✅ Correct.

---

## 5. Audit de cohérence des sources

### Ordre de construction du graphe

1. **DB conversions** (L68-77) — conversions physiques universelles
2. **Via-reference composites** (L79-124) — raccourcis intra-famille (ex: g→mg via kg)
3. **Packaging levels** (L126-139) — conditionnement produit
4. **Equivalence** (L141-149) — équivalence pièce ↔ poids

### Priorité / ambiguïté

Le graphe ne gère pas de priorité explicite. Toutes les arêtes coexistent. Le BFS retourne le **premier chemin trouvé** (plus court en nombre d'arêtes, pas en priorité métier).

### Risque ?

Si deux chemins mènent au même résultat par des routes différentes, le BFS retourne le plus court. Si deux chemins donnent des facteurs différents, c'est un problème de données (contradiction dans la config produit), pas du moteur.

Le moteur ne peut pas détecter une contradiction de données (ex: un level dit 1 Sac = 25 kg et une equivalence dit 1 Sac = 30 kg). Mais cette situation est un bug de configuration produit, pas du moteur.

**Verdict cohérence** : ✅ Le moteur est correct. La cohérence des données d'entrée est la responsabilité du wizard produit.

---

## 6. Audit des ambiguïtés

### Plusieurs chemins possibles

Le BFS retourne le **premier chemin le plus court** (en nombre d'arêtes). C'est déterministe car :
- L'ordre d'insertion des arêtes est déterministe (DB → via-ref → packaging → equivalence)
- Le BFS utilise FIFO (`shift()`)
- Le `visited` set empêche les revisites

### Deux chemins, même destination, facteurs différents ?

C'est possible uniquement si les données d'entrée sont contradictoires. Le moteur prendra le chemin le plus court. Ce n'est **pas un bug du moteur** mais une donnée invalide.

### Via-reference composites (L79-124)

Ce bloc crée des raccourcis directs entre unités de la même famille via l'unité de référence. Ex: si on a g→kg (via DB) et kg→mg (via DB), il crée g→mg directement. Ces raccourcis sont cohérents avec les arêtes DB (même facteurs, composés).

**Risque identifié : doublons d'arêtes** — Le bloc via-reference peut créer des arêtes qui existent déjà dans les DB conversions directes. Cela ne cause pas de facteur faux (le BFS s'arrête au premier chemin trouvé via `visited`), mais ajoute des arêtes inutiles. **Impact : aucun** (performance négligeable pour les tailles de graphe réelles).

**Verdict ambiguïtés** : ✅ Déterministe et sûr.

---

## 7. Audit des protections

### Cycles

Le `visited` set (L192, L205, L219) empêche toute boucle infinie. Un nœud visité n'est jamais revisité. Le BFS termine toujours.

**Preuve** : chaque itération ajoute au moins un nœud à `visited` ou passe. Le nombre de nœuds est fini (= nombre d'unités). Donc le BFS termine en O(V+E).

### Données invalides

| Donnée invalide | Protection |
|-----------------|-----------|
| `fromId` ou `toId` null/undefined | L172-176 : retourne `{ factor: null, reached: false }` |
| `factor <= 0` dans addEdge | L63 : arête ignorée (`if (factor <= 0) return`) |
| `fromId` ou `toId` vide | L63 : arête ignorée (`if (!fromId \|\| !toId)`) |
| `containsQuantity` null/0/négatif | L131 : level ignoré (`if (!qty \|\| qty <= 0) continue`) |
| `equivalence.quantity` 0/négatif | L142 : equivalence ignorée (`equivalence.quantity > 0`) |
| `rule.factor === 0` | L74 : seule l'arête inverse est bloquée |
| `rule.is_active === false` | L70 : règle ignorée |

### Arêtes dupliquées

Le graphe peut avoir plusieurs arêtes du même nœud vers le même nœud (pas de dédoublonnage). Le BFS prend la première rencontrée. **Pas de risque** car les doublons ont le même facteur (proviennent de la même source de données).

**Verdict protections** : ✅ Robuste contre les cas limites.

---

## 8. Liste des failles identifiées

### Faille 1 — Absence de validation des contradictions de données

- **Gravité** : Faible (P3)
- **Description** : Si un produit a des données contradictoires (ex: 1 Sac = 25 kg via level ET 1 Sac = 30 kg via une deuxième source), le moteur utilise le chemin le plus court sans détecter la contradiction.
- **Impact métier** : Conversion plausible mais basée sur la mauvaise source. En pratique, les données produit ont une seule source (wizard), donc ce cas est théorique.
- **Condition de déclenchement** : Nécessite une corruption des données produit ou un wizard buggé.

### Faille 2 — Pas de borne sur la profondeur du BFS

- **Gravité** : Négligeable (P4)
- **Description** : Le BFS traverse tout le graphe sans limite de profondeur. Pour un graphe avec N unités, il visite au plus N nœuds.
- **Impact métier** : Aucun. En pratique, le nombre d'unités est < 100. Performance négligeable.
- **Condition de déclenchement** : Jamais en conditions réelles.

---

## 9. Faux positifs écartés

| Hypothèse vérifiée | Résultat |
|---------------------|----------|
| Le BFS pourrait boucler indéfiniment | ❌ Faux — `visited` set empêche les revisites |
| La multiplication flottante pourrait dériver | ❌ Faux — les facteurs métier sont des entiers ou des multiples de 10, la dérive est négligeable |
| Le sens inverse pourrait être inversé | ❌ Faux — `1/factor` est systématiquement appliqué pour chaque arête inverse |
| Le moteur pourrait favoriser un chemin incohérent | ❌ Faux — BFS FIFO est déterministe |
| Les arêtes via-reference pourraient créer des facteurs faux | ❌ Faux — elles sont composées à partir des mêmes DB conversions, les facteurs sont mathématiquement identiques |

---

## 10. Verdict

**`findConversionPath` est SAFE pour la conversion retrait → canonique.**

| Critère | Statut |
|---------|--------|
| Sens de conversion | ✅ Toujours correct |
| Multi-étapes | ✅ Multiplication correcte |
| Protection cycles | ✅ `visited` set |
| Protection données invalides | ✅ Guards sur null/0/négatif |
| Déterminisme | ✅ BFS FIFO, insertion ordonnée |
| Risque de factor faux | ✅ Aucun (sauf données contradictoires) |

---

## 11. Recommandations

Aucune correction bloquante n'est nécessaire. Le moteur est safe pour production.

### Recommandations optionnelles (non bloquantes)

1. **Warning si multiples chemins** (P4) — Ajouter un avertissement si le BFS détecte qu'un nœud cible est atteignable par plus d'un chemin avec des facteurs différents. Utile uniquement pour le debug admin, pas pour bloquer.

2. **Tests supplémentaires** (P3) — Ajouter des tests pour :
   - Sac → kg (le cas métier exact de la farine)
   - Niveau 3+ imbriqué (palette → carton → boîte → pièce)
   - Données contradictoires (deux levels vers la même unité)

3. **Dédoublonnage d'arêtes** (P4) — Optionnel. Le bloc via-reference crée parfois des arêtes redondantes. Pas de risque, mais un `Set` de clés `${from}-${to}` éviterait les doublons.
