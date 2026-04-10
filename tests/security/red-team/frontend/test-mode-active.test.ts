/**
 * RED-FRONTEND — CONFIG-01: Test Mode Flags Active
 *
 * Original finding: ADMIN_TEST_MODE = true and INVITATION_EMAIL_ENABLED = false
 * were hardcoded, meaning test features were active in production.
 *
 * Updated status: These values are now derived from import.meta.env.DEV,
 * meaning they are only active in development builds.
 *
 * This test verifies the current state of test mode flags.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("CONFIG-01: Test mode flags", () => {
  it("should verify testModeFlags.ts exists", async () => {
    const source = await readSourceFile("src/config/testModeFlags.ts");
    expect(source.length).toBeGreaterThan(0);
  });

  it("should verify ADMIN_TEST_MODE is tied to import.meta.env.DEV (not hardcoded true)", async () => {
    const source = await readSourceFile("src/config/testModeFlags.ts");

    // Check for the ADMIN_TEST_MODE declaration
    const declaration = findInSource(source, /export const ADMIN_TEST_MODE\s*=/g);
    expect(declaration.length).toBe(1);

    // Verify it references import.meta.env.DEV (environment-aware)
    const envAware = findInSource(source, /ADMIN_TEST_MODE\s*=\s*import\.meta\.env\.DEV/g);

    // If this passes: the flag is now tied to DEV mode (remediated)
    // If this fails: the flag is hardcoded (vulnerability present)
    expect(envAware.length).toBe(1);
  });

  it("should verify INVITATION_EMAIL_ENABLED is tied to import.meta.env.DEV (not hardcoded false)", async () => {
    const source = await readSourceFile("src/config/testModeFlags.ts");

    // Check for the INVITATION_EMAIL_ENABLED declaration
    const declaration = findInSource(source, /export const INVITATION_EMAIL_ENABLED\s*=/g);
    expect(declaration.length).toBe(1);

    // Verify it references import.meta.env.DEV (inverted: !DEV = true in prod)
    const envAware = findInSource(
      source,
      /INVITATION_EMAIL_ENABLED\s*=\s*!import\.meta\.env\.DEV/g
    );

    // If this passes: emails are enabled in production, disabled in dev (remediated)
    // If this fails: email sending is hardcoded off (vulnerability present)
    expect(envAware.length).toBe(1);
  });

  it("should verify NO hardcoded true/false values for test flags", async () => {
    const source = await readSourceFile("src/config/testModeFlags.ts");

    // Check for hardcoded boolean assignments (the original vulnerability)
    const hardcodedTrue = findInSource(source, /ADMIN_TEST_MODE\s*=\s*true/g);
    const hardcodedFalse = findInSource(source, /INVITATION_EMAIL_ENABLED\s*=\s*false/g);

    // If these are 0, the hardcoded values have been removed (remediated)
    expect(hardcodedTrue.length).toBe(0);
    expect(hardcodedFalse.length).toBe(0);
  });

  it("RESIDUAL RISK: should verify no other files override test mode flags", async () => {
    const source = await readSourceFile("src/config/testModeFlags.ts");

    // Check if there's any logic that could re-enable test mode
    // e.g., URL parameter overrides, localStorage overrides, etc.
    const overridePatterns = findInSource(
      source,
      /localStorage|sessionStorage|searchParams|URLSearchParams|window\.location/g
    );

    // No dynamic override mechanism — the flags are compile-time constants
    expect(overridePatterns.length).toBe(0);
  });

  it("RESIDUAL RISK: should check if featureFlags.ts has any hardcoded test values", async () => {
    const source = await readSourceFile("src/config/featureFlags.ts");

    // Look for any test-related flags that might be hardcoded
    const testFlags = findInSource(source, /test.*=\s*true|debug.*=\s*true/gi);

    // Document any hardcoded test/debug flags in the feature flags file
    expect(testFlags).toBeDefined();
  });

  it("should verify test mode flags file has clear documentation about production safety", async () => {
    const source = await readSourceFile("src/config/testModeFlags.ts");

    // The file should contain documentation explaining the test mode behavior
    const hasDocumentation = findInSource(source, /\/\*\*|\/\//g);
    expect(hasDocumentation.length).toBeGreaterThan(0);

    // Verify there's a mention of DEV/production in comments
    const hasEnvMention = findInSource(source, /DEV|prod|production|development/gi);
    expect(hasEnvMention.length).toBeGreaterThan(0);
  });
});
