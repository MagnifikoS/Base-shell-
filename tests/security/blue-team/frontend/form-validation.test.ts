/**
 * REL-02: Form Validation Assessment
 *
 * Verifies that Zod validation schemas are used in security-critical forms
 * (auth, invite, employee) to prevent invalid or malicious input.
 *
 * Assessment scope:
 *   - Zod schemas exist for auth, employee, and other forms
 *   - Auth.tsx uses Zod validation (via safeParse)
 *   - Invite.tsx uses Zod validation (via safeParse)
 *   - Schema files cover email, password, IBAN, SSN formats
 *   - Cross-field validation exists (e.g. password confirmation)
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource, globSourceFiles } from "../../helpers";

describe("REL-02: Form Validation Assessment", () => {
  describe("Zod schema files exist", () => {
    it("should have a schemas directory with multiple schema files", async () => {
      const files = await globSourceFiles("src/lib/schemas/*.ts");
      // Exclude test files
      const schemaFiles = files.filter((f) => !f.includes("__tests__"));
      expect(schemaFiles.length).toBeGreaterThanOrEqual(3);
    });

    it("should have an auth schema file", async () => {
      const files = await globSourceFiles("src/lib/schemas/auth.ts");
      expect(files.length).toBe(1);
    });

    it("should have an employee schema file", async () => {
      const files = await globSourceFiles("src/lib/schemas/employee.ts");
      expect(files.length).toBe(1);
    });

    it("should have a common schema file with shared validators", async () => {
      const files = await globSourceFiles("src/lib/schemas/common.ts");
      expect(files.length).toBe(1);
    });
  });

  describe("Auth schema covers login and password reset", () => {
    it("should export a loginSchema", async () => {
      const source = await readSourceFile("src/lib/schemas/auth.ts");
      expect(source).toContain("export const loginSchema");
    });

    it("should export a resetPasswordSchema", async () => {
      const source = await readSourceFile("src/lib/schemas/auth.ts");
      expect(source).toContain("export const resetPasswordSchema");
    });

    it("should export a bootstrapSchema", async () => {
      const source = await readSourceFile("src/lib/schemas/auth.ts");
      expect(source).toContain("export const bootstrapSchema");
    });

    it("should export an inviteSchema with password confirmation", async () => {
      const source = await readSourceFile("src/lib/schemas/auth.ts");
      expect(source).toContain("export const inviteSchema");
      // Should have password confirmation refinement
      expect(source).toContain("confirmPassword");
      expect(source).toContain("refine");
    });

    it("should use shared emailSchema for email validation", async () => {
      const source = await readSourceFile("src/lib/schemas/auth.ts");
      expect(source).toContain("emailSchema");
      // Should import from common
      expect(source).toContain('./common"');
    });

    it("should use shared passwordSchema for password strength", async () => {
      const source = await readSourceFile("src/lib/schemas/auth.ts");
      expect(source).toContain("passwordSchema");
    });
  });

  describe("Common schema enforces input constraints", () => {
    it("should validate email format", async () => {
      const source = await readSourceFile("src/lib/schemas/common.ts");
      expect(source).toContain("emailSchema");
      expect(source).toContain(".email(");
    });

    it("should enforce minimum password length", async () => {
      const source = await readSourceFile("src/lib/schemas/common.ts");
      expect(source).toContain("passwordSchema");
      const minMatch = findInSource(source, /\.min\(8/);
      expect(minMatch.length).toBeGreaterThanOrEqual(1);
    });

    it("should validate PIN format (4 digits)", async () => {
      const source = await readSourceFile("src/lib/schemas/common.ts");
      expect(source).toContain("pinSchema");
      expect(source).toContain(".length(4");
    });
  });

  describe("Employee schema validates sensitive fields", () => {
    it("should validate IBAN format with regex", async () => {
      const source = await readSourceFile("src/lib/schemas/employee.ts");
      expect(source).toContain("ibanRegex");
      const ibanMatch = findInSource(source, /FR.*\d+.*[A-Z0-9]/);
      expect(ibanMatch.length).toBeGreaterThanOrEqual(1);
    });

    it("should validate SSN format with regex", async () => {
      const source = await readSourceFile("src/lib/schemas/employee.ts");
      expect(source).toContain("ssnRegex");
    });

    it("should have cross-field salary validation (net <= gross)", async () => {
      const source = await readSourceFile("src/lib/schemas/employee.ts");
      const crossField = findInSource(
        source,
        /net_salary.*gross_salary|salaire net.*salaire brut/i
      );
      expect(crossField.length).toBeGreaterThanOrEqual(1);
    });

    it("should enforce max weekly hours constraint (48h)", async () => {
      const source = await readSourceFile("src/lib/schemas/employee.ts");
      const maxHours = findInSource(source, /max\(48/);
      expect(maxHours.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Auth.tsx uses Zod validation", () => {
    it("should import loginSchema from Zod schemas", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("loginSchema");
      expect(source).toContain("@/lib/schemas/auth");
    });

    it("should import resetPasswordSchema from Zod schemas", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("resetPasswordSchema");
    });

    it("should call safeParse on login form submission", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const safeParseMatches = findInSource(source, /loginSchema\.safeParse/);
      expect(safeParseMatches.length).toBeGreaterThanOrEqual(1);
    });

    it("should call safeParse on password reset submission", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const safeParseMatches = findInSource(source, /resetPasswordSchema\.safeParse/);
      expect(safeParseMatches.length).toBeGreaterThanOrEqual(1);
    });

    it("should display field-level validation errors", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("fieldErrors");
      expect(source).toContain("text-destructive");
    });

    it("should abort form submission when validation fails", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      // After safeParse failure, should return early before calling supabase
      const loginHandler = source.slice(
        source.indexOf("handleLogin"),
        source.indexOf("handleResetPassword")
      );
      const safeParseFail = loginHandler.indexOf("!result.success");
      const returnStatement = loginHandler.indexOf("return;", safeParseFail);
      expect(safeParseFail).toBeGreaterThan(-1);
      expect(returnStatement).toBeGreaterThan(safeParseFail);
    });
  });

  describe("Invite.tsx uses Zod validation", () => {
    it("should import inviteSchema from Zod schemas", async () => {
      const source = await readSourceFile("src/pages/Invite.tsx");
      expect(source).toContain("inviteSchema");
      expect(source).toContain("@/lib/schemas/auth");
    });

    it("should call safeParse on invite form submission", async () => {
      const source = await readSourceFile("src/pages/Invite.tsx");
      const safeParseMatches = findInSource(source, /inviteSchema\.safeParse/);
      expect(safeParseMatches.length).toBeGreaterThanOrEqual(1);
    });

    it("should display field-level validation errors", async () => {
      const source = await readSourceFile("src/pages/Invite.tsx");
      expect(source).toContain("fieldErrors");
      expect(source).toContain("text-destructive");
    });
  });

  describe("Validation uses direct Zod safeParse (not zodResolver)", () => {
    it("should use safeParse pattern rather than zodResolver in auth forms", async () => {
      // The codebase uses Zod safeParse directly rather than zodResolver + react-hook-form.
      // This is an acceptable validation pattern.
      const authSource = await readSourceFile("src/pages/Auth.tsx");
      const inviteSource = await readSourceFile("src/pages/Invite.tsx");

      // Both files use safeParse (direct Zod validation)
      expect(authSource).toContain("safeParse");
      expect(inviteSource).toContain("safeParse");

      // Neither uses zodResolver (they use native Zod directly)
      expect(authSource).not.toContain("zodResolver");
      expect(inviteSource).not.toContain("zodResolver");
    });
  });
});
