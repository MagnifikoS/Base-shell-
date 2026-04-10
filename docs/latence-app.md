# Diagnostic — Latence d'affichage de l'écran login

> **Date** : 2026-03-14  
> **Statut** : Diagnostic uniquement — aucun code modifié  
> **Contexte** : Lenteur perçue à l'ouverture de l'app avant affichage de `/auth`

---

## Chaîne de chargement identifiée

L'affichage de l'écran login passe par **4 étapes séquentielles** :

### 1. Bundle JS initial (~moyen)

- `main.tsx` charge Sentry (avec replay + tracing) **de manière synchrone** avant le premier render.
- C'est le premier goulot — Sentry init + replay integration est lourd.

### 2. AuthProvider — `getSession()` réseau (~2-3s observé dans les logs)

- Le composant `AuthProvider` appelle `supabase.auth.getSession()` + `onAuthStateChange()`.
- Pendant ce temps, `loading = true` → **écran blanc avec spinner**.
- Les logs auth montrent des temps de réponse `/user` de **2-15ms côté serveur**, mais le RTT réseau mobile (5G) ajoute facilement **1-2s**.

### 3. SmartHomeRedirect — cascade de checks

- Même pour un utilisateur non connecté, le composant passe par :
  - `authLoading` → spinner
  - `platformAdminLoading` → spinner
  - `estLoading` → spinner
  - enfin `<Navigate to="/auth">`
- C'est **3 spinners séquentiels** avant la redirection vers `/auth`.

### 4. Page Auth elle-même

- `Auth` est importée en **static** (pas lazy) → OK, pas de délai ici.

---

## Causes principales de la lenteur perçue

| Cause | Impact |
|-------|--------|
| **Sentry init synchrone** (replay + tracing) | ~200-500ms avant premier render |
| **`getSession()` réseau** | ~1-3s (RTT mobile) pendant lequel = écran blanc/spinner |
| **Cascade de loading checks** dans SmartHomeRedirect | Chaque étape attend la précédente, même quand l'utilisateur n'est pas connecté |
| **Pas de splash screen / skeleton** | L'utilisateur voit un spinner générique, impression de lenteur |

---

## Pistes d'amélioration

### P1 — Court-circuiter SmartHomeRedirect pour les non-connectés

- Si pas de session locale dans le storage Supabase, rediriger vers `/auth` immédiatement sans attendre les checks platform admin / establishment.
- **Impact** : supprime ~2-4s de cascade inutile pour les utilisateurs non connectés.
- **Risque** : faible — fallback classique si session expirée.
- **Complexité** : faible.

### P2 — Différer Sentry replay

- Charger `replayIntegration` en lazy après le premier render au lieu de synchrone dans `main.tsx`.
- **Impact** : ~200-500ms gagnés sur le premier paint.
- **Risque** : quasi nul — les replays commencent quelques secondes plus tard.
- **Complexité** : faible.

### P3 — Ajouter un splash screen branded

- Remplacer le spinner blanc générique par un écran de chargement avec le logo de l'app.
- **Impact** : perception de vitesse radicalement améliorée (même durée réelle, mais UX perçue bien meilleure).
- **Risque** : nul.
- **Complexité** : très faible.

---

## Verdict

La lenteur est **réelle mais corrigeable** sans refonte. Les 3 pistes combinées pourraient réduire le temps perçu de ~4-5s à ~1-2s sur mobile.

**Priorité recommandée** : P1 > P3 > P2
