/**
 * AUTH-02 -- Weak Password Policy
 *
 * Target: supabase/functions/bootstrap-admin/index.ts
 *         supabase/functions/accept-invitation/index.ts
 *         supabase/functions/admin-reset-password/index.ts
 *
 * Vulnerability:
 *   All three functions that handle password creation/reset enforce only
 *   a minimum length of 8 characters. There are NO requirements for:
 *   - Uppercase letters
 *   - Lowercase letters
 *   - Numbers/digits
 *   - Special characters
 *   - Dictionary word checking
 *   - Common password list checking (e.g., "12345678", "password")
 *   - Password history (prevent reuse)
 *
 *   This allows extremely weak passwords like "aaaaaaaa", "12345678",
 *   or "password" to be accepted for admin accounts.
 *
 *   OWASP recommends: min 8 chars + complexity OR min 12 chars + passphrase.
 *   NIST 800-63B recommends: min 8 chars + breach corpus check.
 */

import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("AUTH-02: Weak Password Policy", () => {
  describe("bootstrap-admin", () => {
    it("should confirm minimum password length is 8 (not higher)", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      // password.length < 8
      const lengthCheck = findInSource(source, /password\.length\s*<\s*8/g);
      expect(lengthCheck.length).toBe(1);
    });

    it("should confirm NO uppercase requirement", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const upperCheck = findInSource(source, /[A-Z].*uppercase|\/[A-Z]\//gi);
      expect(upperCheck.length).toBe(0);
    });

    it("should confirm NO digit requirement", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const digitCheck = findInSource(source, /\d.*digit|\/\\d\/|\/\[0-9\]\//gi);
      expect(digitCheck.length).toBe(0);
    });

    it("should confirm NO special character requirement", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const specialCheck = findInSource(source, /special.*char|symbol|\/\[!@#\$%\^&\*\]/gi);
      expect(specialCheck.length).toBe(0);
    });

    it("should confirm NO common password list check", async () => {
      const source = await readSourceFile("supabase/functions/bootstrap-admin/index.ts");
      const commonCheck = findInSource(
        source,
        /common.*password|password.*list|breach|hibp|pwned/gi
      );
      expect(commonCheck.length).toBe(0);
    });
  });

  describe("accept-invitation", () => {
    it("should confirm minimum password length is 8", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      const lengthCheck = findInSource(source, /password\.length\s*<\s*8/g);
      expect(lengthCheck.length).toBe(1);
    });

    it("should confirm NO complexity requirements", async () => {
      const source = await readSourceFile("supabase/functions/accept-invitation/index.ts");
      // No regex patterns for password complexity
      const complexityPattern = findInSource(
        source,
        /\/\[A-Z\]\/|\/\[a-z\]\/|\/\\d\/|\/\[!@#\$\]/g
      );
      expect(complexityPattern.length).toBe(0);
    });
  });

  describe("admin-reset-password", () => {
    it("should confirm minimum password length is 8", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const lengthCheck = findInSource(source, /new_password\.length\s*<\s*8/g);
      expect(lengthCheck.length).toBe(1);
    });

    it("should confirm NO complexity requirements", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const complexityPattern = findInSource(
        source,
        /\/\[A-Z\]\/|\/\[a-z\]\/|\/\\d\/|uppercase|lowercase|digit|special/gi
      );
      expect(complexityPattern.length).toBe(0);
    });

    it("should confirm NO password history check (reuse prevention)", async () => {
      const source = await readSourceFile("supabase/functions/admin-reset-password/index.ts");
      const historyCheck = findInSource(
        source,
        /password_history|previous.*password|reuse|last.*password/gi
      );
      expect(historyCheck.length).toBe(0);
    });
  });

  describe("cross-cutting password policy gaps", () => {
    it("should confirm weak passwords like '12345678' would pass all checks", () => {
      const weakPasswords = [
        "12345678", // Sequential numbers
        "aaaaaaaa", // Repeated character
        "password", // Dictionary word
        "qwerty12", // Keyboard pattern
        "abcdefgh", // Sequential letters
      ];

      for (const pwd of weakPasswords) {
        // The only check is length >= 8
        expect(pwd.length).toBeGreaterThanOrEqual(8);
        // All of these would pass the current password policy
      }
    });

    it("should confirm no centralized password validation utility exists", async () => {
      // There is no shared password validation module
      const sharedFiles = [
        "supabase/functions/_shared/crypto.ts",
        "supabase/functions/_shared/requireAuth.ts",
      ];

      for (const filePath of sharedFiles) {
        const source = await readSourceFile(filePath);
        const passwordValidation = findInSource(
          source,
          /validatePassword|passwordStrength|passwordPolicy/gi
        );
        expect(passwordValidation.length).toBe(0);
      }
    });
  });
});
