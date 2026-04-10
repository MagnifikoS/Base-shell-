/**
 * CONFIG-01: Test Mode Flags Assessment
 *
 * Verifies that test mode flags are properly tied to the DEV environment
 * and are NOT hardcoded to permissive values that would persist in production.
 *
 * Assessment scope:
 *   - ADMIN_TEST_MODE is derived from import.meta.env.DEV (not hardcoded true)
 *   - INVITATION_EMAIL_ENABLED is derived from env (not hardcoded false)
 *   - No other flags are hardcoded to bypass security
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("CONFIG-01: Test Mode Flags Assessment", () => {
  describe("testModeFlags.ts exists and is properly configured", () => {
    it("should have a testModeFlags.ts config file", async () => {
      const files = await globSourceFiles("src/config/testModeFlags.ts");
      expect(files.length).toBe(1);
    });

    it("should export ADMIN_TEST_MODE", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      expect(source).toContain("export const ADMIN_TEST_MODE");
    });

    it("should export INVITATION_EMAIL_ENABLED", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      expect(source).toContain("export const INVITATION_EMAIL_ENABLED");
    });
  });

  describe("ADMIN_TEST_MODE is NOT hardcoded to true", () => {
    it("should derive ADMIN_TEST_MODE from import.meta.env.DEV", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      const matches = findInSource(source, /ADMIN_TEST_MODE\s*=\s*import\.meta\.env\.DEV/);
      expect(matches.length).toBe(1);
    });

    it("should NOT have ADMIN_TEST_MODE hardcoded to true", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      const hardcoded = findInSource(source, /ADMIN_TEST_MODE\s*=\s*true/);
      expect(hardcoded.length).toBe(0);
    });
  });

  describe("INVITATION_EMAIL_ENABLED is NOT hardcoded to false", () => {
    it("should derive INVITATION_EMAIL_ENABLED from env (negated DEV)", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      const matches = findInSource(
        source,
        /INVITATION_EMAIL_ENABLED\s*=\s*!import\.meta\.env\.DEV/
      );
      expect(matches.length).toBe(1);
    });

    it("should NOT have INVITATION_EMAIL_ENABLED hardcoded to false", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      const hardcoded = findInSource(source, /INVITATION_EMAIL_ENABLED\s*=\s*false/);
      expect(hardcoded.length).toBe(0);
    });
  });

  describe("No other flags are hardcoded to bypass security", () => {
    it("should not contain any hardcoded true/false exports besides env-derived ones", async () => {
      const source = await readSourceFile("src/config/testModeFlags.ts");
      // Find all export const declarations
      const exports = findInSource(source, /export const \w+\s*=\s*(.*)/);
      for (const match of exports) {
        const value = match[1].trim().replace(/;$/, "");
        // Each exported value should reference import.meta.env, not be a bare literal
        const isEnvDerived = value.includes("import.meta.env") || value.includes("process.env");
        const isHardcodedLiteral = /^(true|false)$/.test(value);
        expect(isHardcodedLiteral).toBe(false);
        expect(isEnvDerived).toBe(true);
      }
    });
  });

  describe("featureFlags.ts does not have hardcoded test overrides", () => {
    it("should not contain hardcoded ADMIN_TEST_MODE = true in featureFlags", async () => {
      const source = await readSourceFile("src/config/featureFlags.ts");
      const hardcoded = findInSource(source, /ADMIN_TEST_MODE\s*=\s*true/);
      expect(hardcoded.length).toBe(0);
    });
  });
});
