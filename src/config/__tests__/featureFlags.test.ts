import { describe, it, expect } from "vitest";
import {
  usePermissionsV2Enabled,
  SIDEBAR_V21_ENABLED,
  CASH_ENABLED,
  CONGES_ABSENCES_ENABLED,
  SIGNATURE_STUDIO_ENABLED,
  VISION_AI_GUARDRAILS_ENABLED,
} from "../featureFlags";

describe("featureFlags", () => {
  describe("exported constants are booleans", () => {
    it("SIDEBAR_V21_ENABLED is a boolean", () => {
      expect(typeof SIDEBAR_V21_ENABLED).toBe("boolean");
    });

    it("CASH_ENABLED is a boolean", () => {
      expect(typeof CASH_ENABLED).toBe("boolean");
    });

    it("CONGES_ABSENCES_ENABLED is a boolean", () => {
      expect(typeof CONGES_ABSENCES_ENABLED).toBe("boolean");
    });

    it("SIGNATURE_STUDIO_ENABLED is a boolean", () => {
      expect(typeof SIGNATURE_STUDIO_ENABLED).toBe("boolean");
    });

    it("VISION_AI_GUARDRAILS_ENABLED is a boolean", () => {
      expect(typeof VISION_AI_GUARDRAILS_ENABLED).toBe("boolean");
    });
  });

  describe("usePermissionsV2Enabled", () => {
    it("returns false when userId is null (not authenticated)", () => {
      expect(usePermissionsV2Enabled(null)).toBe(false);
    });

    it("returns true for a valid non-blocked userId", () => {
      expect(usePermissionsV2Enabled("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    });

    it("returns true for any arbitrary UUID (no blocked users by default)", () => {
      expect(usePermissionsV2Enabled("00000000-0000-0000-0000-000000000000")).toBe(true);
    });

    it("returns false for empty string (falsy but not null)", () => {
      // empty string is falsy, but usePermissionsV2Enabled checks !userId
      expect(usePermissionsV2Enabled("")).toBe(false);
    });
  });

  describe("module flags default values", () => {
    it("SIDEBAR_V21_ENABLED is true", () => {
      expect(SIDEBAR_V21_ENABLED).toBe(true);
    });

    it("CASH_ENABLED is true", () => {
      expect(CASH_ENABLED).toBe(true);
    });

    it("CONGES_ABSENCES_ENABLED is true", () => {
      expect(CONGES_ABSENCES_ENABLED).toBe(true);
    });

    it("SIGNATURE_STUDIO_ENABLED is true", () => {
      expect(SIGNATURE_STUDIO_ENABLED).toBe(true);
    });

    it("VISION_AI_GUARDRAILS_ENABLED is true", () => {
      expect(VISION_AI_GUARDRAILS_ENABLED).toBe(true);
    });
  });
});
