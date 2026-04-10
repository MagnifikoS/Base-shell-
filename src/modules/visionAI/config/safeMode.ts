/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — Safe Mode Configuration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce fichier gère le flag VITE_VISION_AI_SAFE_MODE qui permet de basculer
 * entre la baseline stable et les features expérimentales.
 *
 * RÈGLE: Le flag est BINAIRE TOTAL.
 * - true  = Baseline stable UNIQUEMENT
 * - false = Features expérimentales autorisées
 *
 * Aucun mix partiel, aucun switch par sous-fonction.
 *
 * @see docs/DO_NOT_TOUCH_VISION_AI_STABLE.md
 * @see docs/snapshots/vision-ai-stable-v10.6/README.md
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Retourne true si le mode safe est activé (baseline stable uniquement)
 */
export function isVisionAISafeMode(): boolean {
  const envValue = import.meta.env.VITE_VISION_AI_SAFE_MODE;

  // Par défaut, on est en mode safe (stable)
  if (envValue === undefined || envValue === null) {
    return true;
  }

  // Accepte "true", "1", true comme valeurs positives
  if (typeof envValue === "string") {
    return envValue.toLowerCase() === "true" || envValue === "1";
  }

  return Boolean(envValue);
}

/**
 * Version constante exportée (pour éviter les appels répétés)
 */
export const VISION_AI_SAFE_MODE = isVisionAISafeMode();

/**
 * Log du mode actif au démarrage (dev only)
 */
if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.log(
    `[VisionAI] Safe Mode: ${VISION_AI_SAFE_MODE ? "✅ ENABLED (stable baseline)" : "⚠️ DISABLED (experimental features allowed)"}`
  );
}
