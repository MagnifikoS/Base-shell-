/**
 * Tests for Vision AI session persistence utilities
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  VISION_AI_SESSION_KEYS,
  purgeVisionAISession,
  purgeVisionAISessionKeepFlag,
  markInvoiceAsRegistered,
  wasInvoiceAlreadyRegistered,
  saveProductsValidatedState,
  loadProductsValidatedState,
} from "../utils/sessionPersistence";

// ═══════════════════════════════════════════════════════════════════════════
// Setup: Clear sessionStorage before each test
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: VISION_AI_SESSION_KEYS constants
// ═══════════════════════════════════════════════════════════════════════════

describe("VISION_AI_SESSION_KEYS", () => {
  it("has all expected keys", () => {
    expect(VISION_AI_SESSION_KEYS.ITEMS).toBe("vision_ai_extracted_items");
    expect(VISION_AI_SESSION_KEYS.INVOICE).toBe("vision_ai_extracted_invoice");
    expect(VISION_AI_SESSION_KEYS.INSIGHTS).toBe("vision_ai_extracted_insights");
    expect(VISION_AI_SESSION_KEYS.DUPLICATE_DISMISSED).toBe("vision_ai_duplicate_popup_dismissed");
    expect(VISION_AI_SESSION_KEYS.PRODUCTS_VALIDATED).toBe("vision_ai_products_validated");
    expect(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED).toBe("vision_ai_invoice_registered");
  });

  it("has 6 keys total", () => {
    expect(Object.keys(VISION_AI_SESSION_KEYS).length).toBe(6);
  });

  it("all values are unique strings", () => {
    const values = Object.values(VISION_AI_SESSION_KEYS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: purgeVisionAISession
// ═══════════════════════════════════════════════════════════════════════════

describe("purgeVisionAISession", () => {
  it("removes all session keys", () => {
    // Set all keys
    Object.values(VISION_AI_SESSION_KEYS).forEach((key) => {
      sessionStorage.setItem(key, "test-value");
    });

    purgeVisionAISession();

    // All should be removed
    Object.values(VISION_AI_SESSION_KEYS).forEach((key) => {
      expect(sessionStorage.getItem(key)).toBeNull();
    });
  });

  it("does not affect other sessionStorage keys", () => {
    sessionStorage.setItem("other-key", "other-value");
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.ITEMS, "test");

    purgeVisionAISession();

    expect(sessionStorage.getItem("other-key")).toBe("other-value");
  });

  it("handles empty sessionStorage gracefully", () => {
    expect(() => purgeVisionAISession()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: purgeVisionAISession with preserveRegisteredFlag
// ═══════════════════════════════════════════════════════════════════════════

describe("purgeVisionAISession — preserveRegisteredFlag", () => {
  it("preserves INVOICE_REGISTERED when preserveRegisteredFlag=true", () => {
    Object.values(VISION_AI_SESSION_KEYS).forEach((key) => {
      sessionStorage.setItem(key, "test-value");
    });

    purgeVisionAISession(true);

    // INVOICE_REGISTERED should be preserved
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED)).toBe("test-value");

    // All others should be removed
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.ITEMS)).toBeNull();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE)).toBeNull();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INSIGHTS)).toBeNull();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.DUPLICATE_DISMISSED)).toBeNull();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.PRODUCTS_VALIDATED)).toBeNull();
  });

  it("removes INVOICE_REGISTERED when preserveRegisteredFlag=false (default)", () => {
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED, "1");

    purgeVisionAISession(false);

    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: purgeVisionAISessionKeepFlag
// ═══════════════════════════════════════════════════════════════════════════

describe("purgeVisionAISessionKeepFlag", () => {
  it("keeps INVOICE_REGISTERED flag", () => {
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED, "1");
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.ITEMS, "some-items");

    purgeVisionAISessionKeepFlag();

    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED)).toBe("1");
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.ITEMS)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: markInvoiceAsRegistered
// ═══════════════════════════════════════════════════════════════════════════

describe("markInvoiceAsRegistered", () => {
  it("sets the INVOICE_REGISTERED flag to '1'", () => {
    markInvoiceAsRegistered();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED)).toBe("1");
  });

  it("can be called multiple times without error", () => {
    markInvoiceAsRegistered();
    markInvoiceAsRegistered();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED)).toBe("1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: wasInvoiceAlreadyRegistered
// ═══════════════════════════════════════════════════════════════════════════

describe("wasInvoiceAlreadyRegistered", () => {
  it("returns false when no flag is set", () => {
    expect(wasInvoiceAlreadyRegistered()).toBe(false);
  });

  it("returns true after markInvoiceAsRegistered", () => {
    markInvoiceAsRegistered();
    expect(wasInvoiceAlreadyRegistered()).toBe(true);
  });

  it("returns false after purge", () => {
    markInvoiceAsRegistered();
    purgeVisionAISession();
    expect(wasInvoiceAlreadyRegistered()).toBe(false);
  });

  it("returns true after purgeKeepFlag", () => {
    markInvoiceAsRegistered();
    purgeVisionAISessionKeepFlag();
    expect(wasInvoiceAlreadyRegistered()).toBe(true);
  });

  it("returns false for non-'1' values", () => {
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED, "0");
    expect(wasInvoiceAlreadyRegistered()).toBe(false);
  });

  it("returns false for 'true' string value", () => {
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INVOICE_REGISTERED, "true");
    expect(wasInvoiceAlreadyRegistered()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: saveProductsValidatedState / loadProductsValidatedState
// ═══════════════════════════════════════════════════════════════════════════

describe("saveProductsValidatedState + loadProductsValidatedState", () => {
  it("defaults to false when nothing saved", () => {
    expect(loadProductsValidatedState()).toBe(false);
  });

  it("saves and loads true state", () => {
    saveProductsValidatedState(true);
    expect(loadProductsValidatedState()).toBe(true);
  });

  it("saves and loads false state (removes key)", () => {
    saveProductsValidatedState(true);
    expect(loadProductsValidatedState()).toBe(true);

    saveProductsValidatedState(false);
    expect(loadProductsValidatedState()).toBe(false);
  });

  it("is cleared by purgeVisionAISession", () => {
    saveProductsValidatedState(true);
    purgeVisionAISession();
    expect(loadProductsValidatedState()).toBe(false);
  });

  it("is cleared by purgeVisionAISessionKeepFlag", () => {
    saveProductsValidatedState(true);
    purgeVisionAISessionKeepFlag();
    expect(loadProductsValidatedState()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Integration — full workflow
// ═══════════════════════════════════════════════════════════════════════════

describe("sessionPersistence — full workflow", () => {
  it("simulates complete extraction -> save -> purge cycle", () => {
    // 1. Start extraction: store items, invoice, insights
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.ITEMS, JSON.stringify([{ name: "Product" }]));
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INVOICE, JSON.stringify({ total: 100 }));
    sessionStorage.setItem(VISION_AI_SESSION_KEYS.INSIGHTS, JSON.stringify({ accuracy: 0.95 }));

    // 2. Validate products
    saveProductsValidatedState(true);
    expect(loadProductsValidatedState()).toBe(true);

    // 3. Register invoice
    markInvoiceAsRegistered();
    expect(wasInvoiceAlreadyRegistered()).toBe(true);

    // 4. Purge session (keep flag)
    purgeVisionAISessionKeepFlag();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.ITEMS)).toBeNull();
    expect(sessionStorage.getItem(VISION_AI_SESSION_KEYS.INVOICE)).toBeNull();
    expect(wasInvoiceAlreadyRegistered()).toBe(true);

    // 5. Full purge (new extraction)
    purgeVisionAISession();
    expect(wasInvoiceAlreadyRegistered()).toBe(false);
  });
});
