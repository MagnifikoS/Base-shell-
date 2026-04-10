/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VISION AI — Session Persistence Utilities
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Centralized sessionStorage management for Vision AI extraction sessions.
 * Ensures complete cleanup after successful invoice registration.
 */

// All sessionStorage keys used by Vision AI
export const VISION_AI_SESSION_KEYS = {
  ITEMS: "vision_ai_extracted_items",
  INVOICE: "vision_ai_extracted_invoice",
  INSIGHTS: "vision_ai_extracted_insights",
  DUPLICATE_DISMISSED: "vision_ai_duplicate_popup_dismissed",
  PRODUCTS_VALIDATED: "vision_ai_products_validated",
  INVOICE_REGISTERED: "vision_ai_invoice_registered",
} as const;

/**
 * Purge ALL Vision AI session data from sessionStorage.
 * Call this after successful invoice registration to prevent
 * stale data from reappearing when user returns to /vision-ai.
 *
 * @param preserveRegisteredFlag - If true, keeps INVOICE_REGISTERED flag (default: false)
 */
export function purgeVisionAISession(preserveRegisteredFlag = false): void {
  try {
    Object.entries(VISION_AI_SESSION_KEYS).forEach(([name, key]) => {
      // Optionally preserve the INVOICE_REGISTERED flag
      if (preserveRegisteredFlag && name === "INVOICE_REGISTERED") {
        return;
      }
      sessionStorage.removeItem(key);
    });
    if (import.meta.env.DEV)
      // eslint-disable-next-line no-console
      console.log("[Vision AI] Session purged successfully", { preserveRegisteredFlag });
  } catch (error) {
    if (import.meta.env.DEV) console.error("[Vision AI] Failed to purge session:", error);
  }
}

/**
 * Purge session data BUT keep the INVOICE_REGISTERED flag.
 * Use this for UI reset after successful invoice save.
 */
export function purgeVisionAISessionKeepFlag(): void {
  purgeVisionAISession(true);
}

/**
 * Mark the current extraction session as "invoice registered".
 * This flag prevents the session from being reloaded on remount.
 */
export function markInvoiceAsRegistered(): void {
  try {
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED, "1");
  } catch {
    // Silently fail
  }
}

/**
 * Check if the current session was already registered (invoice saved).
 * If true, the session should NOT be restored - purge and start fresh.
 */
export function wasInvoiceAlreadyRegistered(): boolean {
  try {
    return sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED) === "1";
  } catch {
    return false;
  }
}

/**
 * Save products validated state
 */
export function saveProductsValidatedState(validated: boolean): void {
  try {
    if (validated) {
      sessionStorage.setItem(VISION_AI_SESSION_KEYS.PRODUCTS_VALIDATED, "1");
    } else {
      sessionStorage.removeItem(VISION_AI_SESSION_KEYS.PRODUCTS_VALIDATED);
    }
  } catch {
    // Silently fail
  }
}

/**
 * Load products validated state
 */
export function loadProductsValidatedState(): boolean {
  try {
    return sessionStorage.getItem(VISION_AI_SESSION_KEYS.PRODUCTS_VALIDATED) === "1";
  } catch {
    return false;
  }
}
