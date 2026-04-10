# 🎯 AUDIT AVANT RENOMMAGE "BL" — Analyse de Risque

> **Date :** 2026-04-02  
> **Statut :** AUDIT UNIQUEMENT — AUCUNE MODIFICATION  
> **Périmètre :** Toutes les occurrences de "BL" dans le code, la DB et l'UI

---

## 1. RÉSUMÉ EXÉCUTIF

Le terme "BL" est utilisé pour **3 réalités métier distinctes** :

| # | Réalité métier | Terme technique | Tables DB |
|---|---|---|---|
| 1 | **Réception marchandises** (libre ou post-commande) | BL-APP | `bl_app_documents`, `bl_app_lines`, `bl_app_files` |
| 2 | **Sortie de stock interne** (retrait/transfert) | BL-Retrait | `bl_withdrawal_documents`, `bl_withdrawal_lines` |
| 3 | **Extraction IA de bon de livraison** (Vision AI) | BL (type doc) | Aucune table propre — type dans le pipeline AI |

**Verdict anticipé : CAS B — Renommage possible mais UI-only recommandé.**

---

## 2. TABLEAU DES DÉPENDANCES CRITIQUES

### A. Couche DB (Tables + Colonnes)

| Table | Colonnes "BL" | Critique ? |
|---|---|---|
| `bl_app_documents` | `bl_date`, `bl_number` | ✅ OUI — nom de table + colonnes |
| `bl_app_lines` | `bl_app_document_id` | ✅ OUI — FK |
| `bl_app_files` | `bl_app_document_id` | ✅ OUI — FK |
| `bl_withdrawal_documents` | `bl_date`, `bl_number` | ✅ OUI — nom de table + colonnes |
| `bl_withdrawal_lines` | `bl_withdrawal_document_id` | ✅ OUI — FK |

### B. Fonctions SQL / RPC

| Fonction | Rôle | Critique ? |
|---|---|---|
| `fn_create_bl_withdrawal` | Crée un BL retrait atomiquement | ✅ OUI |
| `fn_correct_bl_withdrawal` | Correction post-retrait | ✅ OUI |
| `fn_next_bl_withdrawal_number` | Séquence numérotation BL-RET-XXXXXX | ✅ OUI |

### C. Policies RLS (11 policies)

| Table | Policies |
|---|---|
| `bl_app_documents` | `bl_app_documents_select/insert/update/delete` |
| `bl_app_files` | `bl_app_files_select/insert/delete` |
| `bl_app_lines` | `bl_app_lines_select/insert/update/delete` |
| `bl_withdrawal_documents` | 5 policies (org + destination) |
| `bl_withdrawal_lines` | 5 policies (org + destination) |

### D. Services / Hooks TS

| Fichier | Type | Critique ? |
|---|---|---|
| `src/modules/blApp/services/blAppService.ts` | Service CRUD | ✅ OUI |
| `src/modules/blApp/hooks/useCreateBlApp.ts` | Mutation | ✅ OUI |
| `src/modules/blApp/hooks/useBlAppDocumentsByMonth.ts` | Query | ✅ OUI |
| `src/modules/blApp/hooks/useBlAppDocumentByStockDocumentId.ts` | Query | ✅ OUI |
| `src/modules/blApp/hooks/useCompleteBlApp.ts` | Mutation | ✅ OUI |
| `src/modules/blApp/hooks/useUploadBlAppFile.ts` | Mutation | ✅ OUI |
| `src/modules/blApp/hooks/useBlAppLines.ts` | Query | ✅ OUI |
| `src/modules/blApp/hooks/useBlAppFiles.ts` | Query | ✅ OUI |
| `src/modules/blApp/hooks/useBlAppLinesWithPrices.ts` | Query enrichi | ✅ OUI |
| `src/modules/blRetrait/services/blRetraitService.ts` | Service CRUD | ✅ OUI |
| `src/modules/blRetrait/hooks/useCreateBlRetrait.ts` | Mutation | ✅ OUI |
| `src/modules/blRetrait/hooks/useBlRetraitDocumentsByMonth.ts` | Query | ✅ OUI |
| `src/modules/blRetrait/hooks/useBlRetraitLines.ts` | Query | ✅ OUI |
| `src/modules/blRetrait/hooks/useCreateWithdrawalCorrection.ts` | Mutation | ✅ OUI |
| `src/modules/stockLedger/hooks/useCreateBlRetrait.ts` | Mutation (dupliqué?) | ⚠️ |

### E. Composants UI

| Composant | Label affiché | Objet réel |
|---|---|---|
| `BlAppTab` | "BL-APP" (titre h1) | Réception marchandises |
| `BlAppSupplierList` | "Aucun BL-APP pour ce mois" | Réception marchandises |
| `BlAppDocumentList` | "Aucun BL-APP" | Réception marchandises |
| `BlAppDocumentDetail` | "Compléter le BL-APP" | Réception marchandises |
| `BlAppPostPopup` | "Bon de Livraison" (titre) | Popup post-réception |
| `BlRetraitTab` (stockLedger) | "BL Retraits" (titre h1) | Sortie de stock |
| `BlRetraitDetail` (stockLedger) | "Bon de Livraison" (PDF) | ❌ SÉMANTIQUEMENT INVERSÉ |
| `BlRetraitDocumentDetail` (blRetrait) | "Bon de Livraison" (PDF) | ❌ SÉMANTIQUEMENT INVERSÉ |
| `BlRetraitCorrectionDialog` | "Corriger le BL Retrait" | Correction retrait |
| `FacturesPage` | tab "BL Réception" + tab "Retraits" | Navigation tabs |
| `ReceptionView` | "Réception (Bon de Livraison)" | Vue réception stock |

### F. Vision AI

| Fichier | Utilisation "BL" |
|---|---|
| `visionAI/types/blTypes.ts` | `BLHeader`, `BLItem`, `BLExtractionResponse` |
| `visionAI/hooks/useExtractDocument.ts` | `DocumentMode = "bl"`, `injectBLResponse()` |
| `visionAI/plugins/visionBlGuardrails.ts` | Guardrails post-extraction BL |
| Edge function `vision-ai-extract` | `"Référence BL"` dans prompt AI |

### G. Query Keys React Query

| Query Key | Module |
|---|---|
| `["bl-app-documents", ...]` | blApp |
| `["bl-app-by-stock-doc", ...]` | blApp |
| `["bl-app-lines", ...]` | blApp |
| `["bl-app-files", ...]` | blApp |
| `["bl-retrait-documents", ...]` | blRetrait |
| `["bl-retraits", ...]` | stockLedger |
| `["bl-withdrawal-documents", ...]` | realtime |
| `["bl-withdrawal-lines", ...]` | realtime |
| `["bl-retrait-correction-deltas", ...]` | blRetrait |

### H. PDF / Exports

| Fichier | Titre PDF | Problème |
|---|---|---|
| `BlRetraitDocumentDetail.tsx` | `"Bon de Livraison"` | ❌ C'est une SORTIE, pas une livraison |
| `BlRetraitDetail.tsx` (stockLedger) | `"Bon de Livraison"` | ❌ Idem |

---

## 3. ANALYSE — "BL" EST-IL UN LABEL OU UN CONCEPT STRUCTURANT ?

### Réponse : C'est un **LABEL**, pas un concept structurant.

**Preuves :**
- Le moteur de stock (`fn_post_stock_document`) ne connaît PAS le concept de "BL". Il travaille avec `stock_documents` + `stock_events`
- Les tables `bl_app_*` et `bl_withdrawal_*` sont des **couches documentaires** au-dessus du ledger
- Le cycle B2B (`commandes`) n'utilise jamais le terme "BL" en interne — la réception passe par `fn_post_b2b_reception`
- Les RPC SQL ne font aucune logique conditionnelle sur le mot "BL"
- Les policies RLS sont basées sur `establishment_id` / `organization_id`, jamais sur un type "BL"

**Conclusion : "BL" est purement un label de présentation. Le renommer ne touche AUCUNE logique métier.**

---

## 4. ANALYSE DES RISQUES PAR SCÉNARIO

### Scénario 1 — Ne rien changer

| Aspect | Évaluation |
|---|---|
| **Avantages** | Zéro risque technique, pas de migration |
| **Inconvénients** | Confusion métier persistante : un PDF de SORTIE de stock s'appelle "Bon de Livraison" |
| **Risque** | ⚠️ Erreurs utilisateur sur la nature des documents |

### Scénario 2 — Renommer uniquement l'UI (RECOMMANDÉ)

| Élément | Risque | Impact |
|---|---|---|
| Labels composants (h1, titres) | ✅ Nul | Texte statique |
| Titre PDF retrait | ✅ Nul | String dans `jsPDF.text()` |
| Tabs FacturesPage | ✅ Nul | Propriété `label` |
| Messages toast | ✅ Nul | String statique |
| Noms de fichiers/modules TS | ⚠️ Faible | Refactor IDE, pas de logique impactée |
| Noms de tables DB | ❌ INTERDIT | Nécessite migration + cascade FK + RLS |
| Noms de colonnes DB | ❌ INTERDIT | Idem |
| Noms de fonctions SQL | ❌ INTERDIT | Cascade d'appels |
| Query keys React Query | ⚠️ Faible | Strings, mais invalidation croisée à vérifier |
| Types Vision AI (BLHeader etc.) | ⚠️ Faible | Interne au module, pas exposé à l'utilisateur |

### Scénario 3 — Renommer + aligner concepts (backend inclus)

| Élément | Risque | Impact |
|---|---|---|
| Tables DB | ❌ CRITIQUE | ~20 migrations, cascade FK, policies, tous les services |
| Fonctions SQL | ❌ CRITIQUE | 3 RPC à renommer + tous les call sites |
| Types TS auto-générés | ❌ CRITIQUE | `types.ts` est auto-généré, cascade sur tout le code |
| Realtime channels | ❌ CRITIQUE | Noms de tables utilisés dans subscriptions |
| Storage bucket paths | ⚠️ Moyen | Si les chemins contiennent "bl-app" |

---

## 5. RISQUES PRODUIT / UX

| Risque | Scénario 2 (UI) | Scénario 3 (Full) |
|---|---|---|
| Complexifier l'app | ✅ Non — simplifie | ⚠️ Oui — risque de sur-engineering |
| Perdre l'utilisateur | ✅ Non — termes plus clairs | ⚠️ Période de transition |
| Trop de concepts | ✅ Non si on reste à 2-3 termes | ⚠️ Oui si on nomme différemment chaque sous-flux |
| Divergence écrans | ✅ Non si fait en une passe | ❌ Oui si migration progressive |

---

## 6. PROPOSITION DE RENOMMAGE UI (pour évaluation uniquement)

| Actuel | Proposition | Justification |
|---|---|---|
| "BL-APP" (h1) | **"Réceptions"** | C'est ce que c'est : une entrée de marchandises |
| "BL Réception" (tab) | **"Réceptions"** | Cohérent |
| "Compléter le BL-APP" | **"Compléter la réception"** | Plus clair |
| "BL Retraits" (h1) | **"Sorties de stock"** | C'est ce que c'est : une sortie |
| "Retraits" (tab) | **"Sorties"** | Cohérent |
| PDF retrait : "Bon de Livraison" | **"Bon de Sortie"** | Corrige l'inversion sémantique |
| "Aucun BL-APP pour ce mois" | **"Aucune réception ce mois"** | Plus clair |

---

## 7. VERDICT FINAL

### **CAS B — Renommage possible, UI-only recommandé**

| Dimension | Évaluation |
|---|---|
| Logique métier | ✅ Aucun impact — "BL" n'est pas un concept structurant |
| Cohérence système | ✅ Préservée — backend inchangé |
| Compréhension utilisateur | ✅ Améliorée — termes plus explicites |
| Effets de bord | ✅ Aucun si on ne touche que les strings UI |

---

## 8. RECOMMANDATION

### ✅ **Renommer PARTIELLEMENT — UI uniquement**

**Faire :**
- Renommer les labels visibles (h1, titres, tabs, toasts, messages vides)
- Renommer le titre PDF du retrait ("Bon de Livraison" → "Bon de Sortie")
- Garder les noms internes (tables, colonnes, modules TS, query keys) inchangés

**Ne PAS faire :**
- ❌ Renommer les tables DB
- ❌ Renommer les colonnes DB
- ❌ Renommer les fonctions SQL
- ❌ Renommer les modules TS (dossiers `blApp/`, `blRetrait/`)
- ❌ Renommer les types Vision AI (`BLHeader`, etc.)
- ❌ Renommer les query keys

**Effort estimé :** ~15 strings à modifier dans ~8 fichiers. Zéro migration DB. Zéro risque.

---

## 9. INVENTAIRE EXACT DES MODIFICATIONS (si validé)

| Fichier | Modification |
|---|---|
| `src/modules/factures/pages/FacturesPage.tsx` | Tab labels |
| `src/modules/blApp/components/BlAppTab.tsx` | Titre h1 |
| `src/modules/blApp/components/BlAppSupplierList.tsx` | Message vide |
| `src/modules/blApp/components/BlAppDocumentList.tsx` | Message vide |
| `src/modules/blApp/components/BlAppDocumentDetail.tsx` | Bouton "Compléter", toasts |
| `src/modules/blApp/components/BlAppPostPopup.tsx` | Titre popup |
| `src/modules/stockLedger/components/BlRetraitTab.tsx` | Titre h1, stats label |
| `src/modules/stockLedger/components/BlRetraitDetail.tsx` | Titre PDF |
| `src/modules/blRetrait/components/BlRetraitDocumentDetail.tsx` | Titre PDF, toast |
| `src/modules/blRetrait/components/BlRetraitCorrectionDialog.tsx` | Titre dialog |
