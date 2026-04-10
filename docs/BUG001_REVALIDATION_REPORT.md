# BUG-001 — Rapport de revalidation post-correction

## 1. Résumé exécutif

**BUG-001 est confirmé corrigé.** Les 6 tests ciblés (A→F) passent tous. Le snapshot de prix est désormais figé dans la bonne unité de ligne via `fn_convert_line_unit_price` (wrapper SSOT). Aucun fallback silencieux ne subsiste. Les cas invalides sont bloqués explicitement.

- **Tests OK : 6/6**
- **Tests KO : 0**
- **Régressions détectées : 0**
- **Confiance : 100%**

---

## 2. Tableau des tests

| Test | Produit | Unités | Prix source | Facteur attendu | Snapshot attendu | Snapshot observé | Verdict |
|------|---------|--------|-------------|-----------------|-----------------|-----------------|---------|
| **A** — Simple | CAS-A EAU PLATE TEST | pce → pce | 0.50€ | 1.0 | 0.5000€ | **0.5000€** | ✅ OK |
| **B** — Cond. simple | TEST 2 | kg → sac | 10.00€ | 4.0 | 40.0000€ | **40.0000€** | ✅ OK |
| **C** — Multi-niveaux | TEST 1 | pce → car | 1.36€ | 20.0 | 27.2000€ | **27.2000€** | ✅ OK |
| **D** — Facteur < 1 | CITRON JAUNE | pce → kg | 0.22€ | 0.10 | 0.0220€ | **0.0220€** | ✅ OK |
| **E** — Chemin manquant | TEST 1 | pce → NULL / ??? | 1.36€ | — | BLOQUÉ | **BLOQUÉ** (`missing_input` / `no_conversion_path`) | ✅ OK |
| **F** — Prix ≤ 0 | TEST 1 | pce → car | NULL / 0€ | — | BLOQUÉ | **BLOQUÉ** (`missing_price` dans fn_send_commande) | ✅ OK |

---

## 3. Détail par test

### TEST A — Produit simple

- **Produit :** CAS-A EAU PLATE TEST
- **Unités :** pce → pce (identity)
- **Prix source :** 0.50€/pce
- **Facteur attendu :** 1.0
- **Snapshot attendu :** 0.5000€
- **Snapshot observé :** 0.5000€
- **Total attendu (qty=1) :** 0.50€
- **Total observé :** 0.50€
- **Facture :** Snapshot correct → facture correcte
- **Verdict :** ✅ OK
- **Analyse :** Conversion identité, aucune transformation. Pas de régression.

### TEST B — Conditionnement simple

- **Produit :** TEST 2
- **Unités :** kg (final) → sac (ligne), 1 sac = 4 kg
- **Prix source :** 10.00€/kg
- **Facteur attendu :** 4.0
- **Snapshot attendu :** 40.0000€/sac
- **Snapshot observé :** 40.0000€/sac
- **Total attendu (qty=2) :** 80.00€
- **Total observé :** 80.00€
- **Facture :** Snapshot correct → facture correcte
- **Verdict :** ✅ OK
- **Analyse :** Facteur simple × 4 correctement appliqué via BFS.

### TEST C — Multi-niveaux

- **Produit :** TEST 1
- **Unités :** pce (final) → carton (ligne), 1 car = 10 bte × 2 pce = 20 pce
- **Prix source :** 1.36€/pce
- **Facteur attendu :** 20.0
- **Snapshot attendu :** 27.2000€/carton
- **Snapshot observé :** 27.2000€/carton
- **Total attendu (qty=1) :** 27.20€
- **Total observé :** 27.20€
- **Facture :** Snapshot correct → facture correcte
- **Verdict :** ✅ OK
- **Analyse :** C'est LE cas qui était en échec avant la correction (snapshot = 1.36€ au lieu de 27.20€). Le BFS traverse correctement les deux niveaux de packaging. **Bug confirmé résolu.**

### TEST D — Facteur < 1

- **Produit :** CITRON JAUNE
- **Unités :** pce (final) → kg (stock), 1 pce = 0.10 kg (équivalence)
- **Prix source :** 0.22€/pce
- **Facteur attendu :** 0.10
- **Snapshot attendu :** 0.0220€/kg
- **Snapshot observé :** 0.0220€/kg
- **Facture :** Pas de sur-facturation
- **Verdict :** ✅ OK
- **Analyse :** Facteur inversé (< 1) correctement géré. Pas de sur-facturation.

### TEST E — Chemin de conversion manquant

- **E1 — Unité cible NULL :**
  - ok = `false`, error = `missing_input`
  - **Envoi bloqué** ✅

- **E2 — UUID inexistant :**
  - ok = `false`, error = `no_conversion_path`
  - **Envoi bloqué** ✅

- **Verdict :** ✅ OK
- **Analyse :** Aucun fallback silencieux. Les deux cas sont bloqués avec un message d'erreur explicite.

### TEST F — Prix nul ou ≤ 0

- **F1 — Prix NULL :**
  - `fn_convert_line_unit_price` → ok = `false`, error = `missing_price`
  - **Bloqué au niveau wrapper** ✅

- **F2 — Prix = 0.00€ :**
  - `fn_convert_line_unit_price` → ok = `true` (le wrapper ne filtre pas 0€)
  - **MAIS** `fn_send_commande` hard block 1 bloque `final_unit_price <= 0` **en amont**
  - **Bloqué au niveau commande** ✅

- **Verdict :** ✅ OK
- **Analyse :** Double protection. Le wrapper capte les NULL, la commande capte les ≤ 0. Aucun prix invalide ne peut générer un snapshot.

---

## 4. Preuve que BUG-001 est corrigé

| Critère | Avant correction | Après correction |
|---------|-----------------|-----------------|
| TEST 1 snapshot (pce → car) | 1.36€ ❌ | 27.20€ ✅ |
| Moteur utilisé | `COALESCE(fn_product_unit_price_factor, 1.0)` | `fn_convert_line_unit_price` (SSOT) |
| Fallback silencieux | `COALESCE(..., 1.0)` présent | **Supprimé** |
| Hard block NULL units | `!=` (NULL-unsafe) | Wrapper gère nativement les NULL |
| Hard block prix ≤ 0 | Absent | `final_unit_price IS NULL OR <= 0` |
| Hard block chemin manquant | Partiel (NULL hole) | Complet via wrapper `ok = false` |

---

## 5. Régressions détectées

**Aucune.**

- Produits simples (identity) : inchangés ✅
- Produits conditionnés sains : inchangés ✅
- Cas bloquants : toujours bloqués ✅

---

## 6. Conclusion

**BUG-001 est corrigé.** Le prix snapshoté est désormais systématiquement exprimé dans l'unité de la ligne de commande, y compris sur les conditionnements multi-niveaux. Le moteur unique `fn_convert_line_unit_price` est utilisé à la fois pour la validation et pour le snapshot — zéro logique parallèle, zéro fallback silencieux. Le MVP est re-testable sur ce point.
