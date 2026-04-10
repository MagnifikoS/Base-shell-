/**
 * AUTH-01: Forgot Password Assessment
 *
 * Verifies that the forgot password flow exists and is properly implemented
 * in the authentication page.
 *
 * Assessment scope:
 *   - A "forgot password" link/button is visible to users
 *   - resetPasswordForEmail is called via Supabase
 *   - Email validation is applied before sending reset request
 *   - User receives feedback after requesting a reset
 *   - A "back to login" navigation is available
 */
import { describe, it, expect } from "vitest";
import { readSourceFile, findInSource } from "../../helpers";

describe("AUTH-01: Forgot Password Assessment", () => {
  describe("Forgot password link is visible in login form", () => {
    it("should contain 'Mot de passe oublie' text", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const matches = findInSource(source, /[Mm]ot de passe oubli/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should have a clickable element to trigger forgot password flow", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      // There should be a button/link that toggles the forgot password view
      expect(source).toContain("setShowForgotPassword(true)");
    });

    it("should toggle between login and forgot password views", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("showForgotPassword");
      // The state should be boolean to toggle the view
      const stateDecl = findInSource(source, /useState.*false/);
      expect(stateDecl.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Reset password calls Supabase resetPasswordForEmail", () => {
    it("should call supabase.auth.resetPasswordForEmail", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const matches = findInSource(source, /resetPasswordForEmail/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should pass a redirectTo URL for the reset flow", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("redirectTo");
      // Should redirect back to auth page
      expect(source).toContain('window.location.origin + "/auth"');
    });

    it("should trim the email before sending", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const trimMatches = findInSource(source, /resetEmail\.trim\(\)/);
      expect(trimMatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Reset password has Zod validation", () => {
    it("should validate email with resetPasswordSchema before sending", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const matches = findInSource(source, /resetPasswordSchema\.safeParse/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it("should display validation errors for the reset email field", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("resetFieldErrors");
    });

    it("should abort reset request when validation fails", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      // After safeParse failure for reset, should return early
      const resetHandler = source.slice(
        source.indexOf("handleResetPassword"),
        source.indexOf("if (checking)")
      );
      expect(resetHandler).toContain("!result.success");
      expect(resetHandler).toContain("return;");
    });
  });

  describe("User feedback after reset request", () => {
    it("should show a success toast message after sending reset email", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      // Should show French success message
      const successMatch = findInSource(source, /toast\.success.*email.*r[eé]initialisation/i);
      expect(successMatch.length).toBeGreaterThanOrEqual(1);
    });

    it("should show an error toast on failure", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      // In the reset handler, error should be displayed via toast
      const resetHandler = source.slice(
        source.indexOf("handleResetPassword"),
        source.indexOf("if (checking)")
      );
      expect(resetHandler).toContain("toast.error");
    });

    it("should return to login view after successful reset", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      // After success, should hide forgot password view
      expect(source).toContain("setShowForgotPassword(false)");
    });
  });

  describe("Back to login navigation", () => {
    it("should have a back-to-login button in the forgot password view", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("Retour");
      // Should contain a button that sets showForgotPassword to false
      const backMatches = findInSource(source, /setShowForgotPassword\(false\)/);
      // At least 2: one in the back button, one after success
      expect(backMatches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Reset form has proper accessibility", () => {
    it("should have an aria-label on the reset form", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain('aria-label="R');
    });

    it("should have a label for the reset email input", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain('htmlFor="reset-email"');
      expect(source).toContain('id="reset-email"');
    });
  });

  describe("Loading state during reset request", () => {
    it("should track loading state during reset", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      expect(source).toContain("resetLoading");
      expect(source).toContain("setResetLoading(true)");
      expect(source).toContain("setResetLoading(false)");
    });

    it("should disable submit button while loading", async () => {
      const source = await readSourceFile("src/pages/Auth.tsx");
      const disabledMatch = findInSource(source, /disabled=\{resetLoading\}/);
      expect(disabledMatch.length).toBeGreaterThanOrEqual(1);
    });
  });
});
