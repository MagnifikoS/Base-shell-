/**
 * AUTH-02: Password Policy Assessment
 *
 * Audits password policy enforcement across all edge functions that accept
 * user-provided passwords:
 * - bootstrap-admin: first admin account creation
 * - accept-invitation: new employee account via invitation link
 * - admin-reset-password: admin resets another user's password
 *
 * Current state: All three enforce minimum 8-character length.
 * Missing: No complexity requirements (uppercase, digit, special character).
 * Missing: No centralized _shared/passwordPolicy.ts module.
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("AUTH-02: Password Policy Assessment", () => {
  // ---------------------------------------------------------------------------
  // Minimum password length enforcement
  // ---------------------------------------------------------------------------
  describe("Minimum password length (>= 8 characters)", () => {
    it("bootstrap-admin should reject passwords shorter than 8 characters", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const lengthCheck = findInSource(source, /password\.length\s*<\s*(\d+)/);
      expect(lengthCheck.length).toBeGreaterThan(0);
      const minLength = parseInt(lengthCheck[0][1], 10);
      expect(minLength).toBeGreaterThanOrEqual(8);
    });

    it("accept-invitation should reject passwords shorter than 8 characters", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      const lengthCheck = findInSource(source, /password\.length\s*<\s*(\d+)/);
      expect(lengthCheck.length).toBeGreaterThan(0);
      const minLength = parseInt(lengthCheck[0][1], 10);
      expect(minLength).toBeGreaterThanOrEqual(8);
    });

    it("admin-reset-password should reject passwords shorter than 8 characters", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const lengthCheck = findInSource(source, /new_password\.length\s*<\s*(\d+)/);
      expect(lengthCheck.length).toBeGreaterThan(0);
      const minLength = parseInt(lengthCheck[0][1], 10);
      expect(minLength).toBeGreaterThanOrEqual(8);
    });
  });

  // ---------------------------------------------------------------------------
  // Complexity requirements (VULNERABILITY DOCUMENTATION)
  // These tests document MISSING complexity rules that SHOULD be added.
  // They PASS when the vulnerability EXISTS (no complexity enforcement found).
  // ---------------------------------------------------------------------------
  describe("Complexity requirements — MISSING (vulnerability documentation)", () => {
    it("[VULN] bootstrap-admin does NOT enforce uppercase requirement", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const _uppercaseCheck = findInSource(source, /[A-Z].*test\(|uppercase|[A-Z]/);
      // Filter to only matches related to password validation regex patterns
      const passwordComplexity = findInSource(
        source,
        /\/\[A-Z\]\/\.test\(password\)|password.*uppercase|(?:must|should).*uppercase/i
      );
      // This test PASSES because the vulnerability EXISTS (no uppercase enforcement)
      expect(passwordComplexity.length).toBe(0);
    });

    it("[VULN] bootstrap-admin does NOT enforce digit requirement", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const digitCheck = findInSource(
        source,
        /\/\\d\/\.test\(password\)|\/\[0-9\]\/\.test\(password\)|password.*digit|(?:must|should).*(?:number|digit)/i
      );
      // This test PASSES because the vulnerability EXISTS
      expect(digitCheck.length).toBe(0);
    });

    it("[VULN] accept-invitation does NOT enforce uppercase requirement", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      const passwordComplexity = findInSource(
        source,
        /\/\[A-Z\]\/\.test\(password\)|password.*uppercase|(?:must|should).*uppercase/i
      );
      expect(passwordComplexity.length).toBe(0);
    });

    it("[VULN] accept-invitation does NOT enforce digit requirement", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      const digitCheck = findInSource(
        source,
        /\/\\d\/\.test\(password\)|\/\[0-9\]\/\.test\(password\)|password.*digit|(?:must|should).*(?:number|digit)/i
      );
      expect(digitCheck.length).toBe(0);
    });

    it("[VULN] admin-reset-password does NOT enforce uppercase requirement", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const passwordComplexity = findInSource(
        source,
        /\/\[A-Z\]\/\.test\(new_password\)|new_password.*uppercase|(?:must|should).*uppercase/i
      );
      expect(passwordComplexity.length).toBe(0);
    });

    it("[VULN] admin-reset-password does NOT enforce digit requirement", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const digitCheck = findInSource(
        source,
        /\/\\d\/\.test\(new_password\)|\/\[0-9\]\/\.test\(new_password\)|new_password.*digit|(?:must|should).*(?:number|digit)/i
      );
      expect(digitCheck.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Centralized password policy module
  // ---------------------------------------------------------------------------
  describe("Centralized password policy module", () => {
    it("[VULN] _shared/passwordPolicy.ts does NOT exist yet — policy is duplicated inline", async () => {
      let fileExists = true;
      try {
        await readSourceFile("supabase/functions/_shared/passwordPolicy.ts");
      } catch {
        fileExists = false;
      }
      // This test PASSES because the vulnerability EXISTS (no centralized policy)
      expect(fileExists).toBe(false);
    });

    it("password length check is duplicated across 3 edge functions (no SSOT)", async () => {
      const files = [
        "supabase/functions/bootstrap-admin/index.ts",
        "supabase/functions/accept-invitation/index.ts",
        "supabase/functions/admin-reset-password/index.ts",
      ];

      let checkCount = 0;
      for (const file of files) {
        const source = await readSourceFile(file);
        const checks = findInSource(source, /\.length\s*<\s*8/);
        checkCount += checks.length;
      }
      // Each file has its own length check — 3 duplicates total
      expect(checkCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting on password endpoints
  // ---------------------------------------------------------------------------
  describe("Rate limiting on password endpoints", () => {
    it("bootstrap-admin should have rate limiting", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const rateLimit = findInSource(source, /checkRateLimit/);
      expect(rateLimit.length).toBeGreaterThan(0);
    });

    it("accept-invitation should have rate limiting", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      const rateLimit = findInSource(source, /checkRateLimit/);
      expect(rateLimit.length).toBeGreaterThan(0);
    });

    it("admin-reset-password should have rate limiting", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const rateLimit = findInSource(source, /checkRateLimit/);
      expect(rateLimit.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Error messages do not leak internal details
  // ---------------------------------------------------------------------------
  describe("Error message safety", () => {
    it("bootstrap-admin should not expose stack traces or internal errors to client", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      // Should use generic error messages and log details server-side
      const genericError = findInSource(source, /SEC-20|log\.error/);
      expect(genericError.length).toBeGreaterThan(0);
    });

    it("accept-invitation should not expose stack traces or internal errors to client", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      const genericError = findInSource(source, /SEC-20|log\.error/);
      expect(genericError.length).toBeGreaterThan(0);
    });

    it("admin-reset-password should not expose stack traces or internal errors to client", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const genericError = findInSource(source, /SEC-20|log\.error/);
      expect(genericError.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Auth checks on protected endpoints
  // ---------------------------------------------------------------------------
  describe("Auth checks on password endpoints", () => {
    it("admin-reset-password should verify caller is authenticated", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const authCheck = findInSource(source, /auth\.getUser\(\)/);
      expect(authCheck.length).toBeGreaterThan(0);
    });

    it("admin-reset-password should verify caller has admin role", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const adminCheck = findInSource(source, /is_admin/);
      expect(adminCheck.length).toBeGreaterThan(0);
    });

    it("admin-reset-password should verify target user belongs to same organization", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const orgCheck = findInSource(source, /organization_id\s*!==\s*callerOrg/);
      expect(orgCheck.length).toBeGreaterThan(0);
    });

    it("bootstrap-admin should verify bootstrap secret via timing-safe comparison", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const secretCheck = findInSource(source, /timingSafeEqual/);
      expect(secretCheck.length).toBeGreaterThan(0);
    });
  });
});
