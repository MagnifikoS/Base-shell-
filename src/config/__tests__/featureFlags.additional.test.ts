/**
 * Additional tests for featureFlags.ts
 *
 * Supplements existing featureFlags.test.ts with:
 * - usePermissionsV2Enabled detailed scenarios
 * - BLOCKED_USERS behavior
 * - Type safety checks
 * - Session storage interaction
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  usePermissionsV2Enabled,
  SIDEBAR_V21_ENABLED,
  CASH_ENABLED,
  CONGES_ABSENCES_ENABLED,
  SIGNATURE_STUDIO_ENABLED,
  VISION_AI_GUARDRAILS_ENABLED,
} from "../featureFlags";

describe("featureFlags — additional tests", () => {
  describe("usePermissionsV2Enabled — detailed scenarios", () => {
    it("returns true for a standard UUID", () => {
      expect(usePermissionsV2Enabled("12345678-1234-1234-1234-123456789abc")).toBe(true);
    });

    it("returns true for another UUID", () => {
      expect(usePermissionsV2Enabled("abcdef01-2345-6789-abcd-ef0123456789")).toBe(true);
    });

    it("returns false for null", () => {
      expect(usePermissionsV2Enabled(null)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(usePermissionsV2Enabled("")).toBe(false);
    });

    it("returns true for UUID-like string with dashes", () => {
      expect(usePermissionsV2Enabled("a-b-c-d-e")).toBe(true);
    });

    it("returns true for short non-empty string", () => {
      expect(usePermissionsV2Enabled("x")).toBe(true);
    });
  });

  describe("flag types are correct", () => {
    it("SIDEBAR_V21_ENABLED is boolean true", () => {
      expect(SIDEBAR_V21_ENABLED).toBe(true);
      expect(typeof SIDEBAR_V21_ENABLED).toBe("boolean");
    });

    it("CASH_ENABLED is boolean true", () => {
      expect(CASH_ENABLED).toBe(true);
      expect(typeof CASH_ENABLED).toBe("boolean");
    });

    it("CONGES_ABSENCES_ENABLED is boolean true", () => {
      expect(CONGES_ABSENCES_ENABLED).toBe(true);
      expect(typeof CONGES_ABSENCES_ENABLED).toBe("boolean");
    });

    it("SIGNATURE_STUDIO_ENABLED is boolean true", () => {
      expect(SIGNATURE_STUDIO_ENABLED).toBe(true);
      expect(typeof SIGNATURE_STUDIO_ENABLED).toBe("boolean");
    });

    it("VISION_AI_GUARDRAILS_ENABLED is boolean true", () => {
      expect(VISION_AI_GUARDRAILS_ENABLED).toBe(true);
      expect(typeof VISION_AI_GUARDRAILS_ENABLED).toBe("boolean");
    });
  });

  describe("usePermissionsV2Enabled — session storage test mode", () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    it("returns false when V2_BLOCKLIST_TEST session flag is set", () => {
      sessionStorage.setItem("V2_BLOCKLIST_TEST", "1");
      expect(usePermissionsV2Enabled("valid-user-id")).toBe(false);
      sessionStorage.removeItem("V2_BLOCKLIST_TEST");
    });

    it("returns true when V2_BLOCKLIST_TEST is not set", () => {
      expect(usePermissionsV2Enabled("valid-user-id")).toBe(true);
    });

    it("cleans up legacy localStorage V2_BLOCKLIST_TEST flag", () => {
      // Simulate legacy flag
      localStorage.setItem("V2_BLOCKLIST_TEST", "1");

      // Calling the function should clean it up
      usePermissionsV2Enabled("valid-user-id");

      // Legacy flag should be removed
      expect(localStorage.getItem("V2_BLOCKLIST_TEST")).toBeNull();
    });
  });

  describe("flag immutability", () => {
    it("flags are not accidentally writable at module level", () => {
      // These are const exports, so they should keep their values
      expect(SIDEBAR_V21_ENABLED).toBe(true);
      expect(CASH_ENABLED).toBe(true);
    });
  });
});
