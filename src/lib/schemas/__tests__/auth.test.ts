/**
 * Tests for auth schemas — login, reset password, bootstrap, invite
 */

import { describe, it, expect } from "vitest";
import { loginSchema, resetPasswordSchema, bootstrapSchema, inviteSchema } from "../auth";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: loginSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("loginSchema", () => {
  it("accepts valid email and password", () => {
    const result = loginSchema.safeParse({ email: "test@example.com", password: "pass" });
    expect(result.success).toBe(true);
  });

  it("rejects empty email", () => {
    const result = loginSchema.safeParse({ email: "", password: "pass" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "pass" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("email");
    }
  });

  it("rejects missing email", () => {
    const result = loginSchema.safeParse({ password: "pass" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({ email: "test@example.com", password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "test@example.com" });
    expect(result.success).toBe(false);
  });

  it("accepts password of any length >= 1", () => {
    const result = loginSchema.safeParse({ email: "test@example.com", password: "x" });
    expect(result.success).toBe(true);
  });

  it("password error message says required", () => {
    const result = loginSchema.safeParse({ email: "test@example.com", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const pwError = result.error.issues.find((i) => i.path.includes("password"));
      expect(pwError?.message).toContain("requis");
    }
  });

  it("email error message says invalid", () => {
    const result = loginSchema.safeParse({ email: "bad", password: "pass" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailError = result.error.issues.find((i) => i.path.includes("email"));
      expect(emailError?.message).toContain("invalide");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: resetPasswordSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("resetPasswordSchema", () => {
  it("accepts valid email", () => {
    const result = resetPasswordSchema.safeParse({ email: "user@company.com" });
    expect(result.success).toBe(true);
  });

  it("rejects empty email", () => {
    const result = resetPasswordSchema.safeParse({ email: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = resetPasswordSchema.safeParse({ email: "foobar" });
    expect(result.success).toBe(false);
  });

  it("rejects missing email field", () => {
    const result = resetPasswordSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: bootstrapSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("bootstrapSchema", () => {
  const validData = {
    organizationName: "Mon Restaurant",
    fullName: "Jean Dupont",
    email: "admin@example.com",
    password: "Secure1!pass",
  };

  it("accepts valid bootstrap data", () => {
    const result = bootstrapSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("rejects empty organizationName", () => {
    const result = bootstrapSchema.safeParse({ ...validData, organizationName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects organizationName > 100 chars", () => {
    const result = bootstrapSchema.safeParse({ ...validData, organizationName: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts organizationName at exactly 100 chars", () => {
    const result = bootstrapSchema.safeParse({ ...validData, organizationName: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects empty fullName", () => {
    const result = bootstrapSchema.safeParse({ ...validData, fullName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects fullName > 100 chars", () => {
    const result = bootstrapSchema.safeParse({ ...validData, fullName: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = bootstrapSchema.safeParse({ ...validData, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects password < 8 chars", () => {
    const result = bootstrapSchema.safeParse({ ...validData, password: "short" });
    expect(result.success).toBe(false);
  });

  it("accepts password at exactly 8 chars meeting complexity", () => {
    const result = bootstrapSchema.safeParse({ ...validData, password: "Ab1!xxxx" });
    expect(result.success).toBe(true);
  });

  it("rejects missing organizationName", () => {
    const { organizationName: _organizationName, ...rest } = validData;
    const result = bootstrapSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing fullName", () => {
    const { fullName: _fullName, ...rest } = validData;
    const result = bootstrapSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing email", () => {
    const { email: _email, ...rest } = validData;
    const result = bootstrapSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing password", () => {
    const { password: _password, ...rest } = validData;
    const result = bootstrapSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: inviteSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("inviteSchema", () => {
  const validInvite = {
    fullName: "Marie Curie",
    password: "Secure1!pass",
    confirmPassword: "Secure1!pass",
  };

  it("accepts valid invite data", () => {
    const result = inviteSchema.safeParse(validInvite);
    expect(result.success).toBe(true);
  });

  it("rejects empty fullName", () => {
    const result = inviteSchema.safeParse({ ...validInvite, fullName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects fullName > 100 chars", () => {
    const result = inviteSchema.safeParse({ ...validInvite, fullName: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects password < 8 chars", () => {
    const result = inviteSchema.safeParse({
      ...validInvite,
      password: "short",
      confirmPassword: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty confirmPassword", () => {
    const result = inviteSchema.safeParse({ ...validInvite, confirmPassword: "" });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = inviteSchema.safeParse({
      ...validInvite,
      password: "Secure1!pass",
      confirmPassword: "Secure2!pass",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const matchError = result.error.issues.find((i) => i.path.includes("confirmPassword"));
      expect(matchError?.message).toContain("ne correspondent pas");
    }
  });

  it("accepts matching passwords at exactly 8 chars meeting complexity", () => {
    const result = inviteSchema.safeParse({
      fullName: "Test User",
      password: "Ab1!xxxx",
      confirmPassword: "Ab1!xxxx",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when only password is provided (no confirmPassword)", () => {
    const result = inviteSchema.safeParse({
      fullName: "Test User",
      password: "Secure1!pass",
    });
    expect(result.success).toBe(false);
  });
});
