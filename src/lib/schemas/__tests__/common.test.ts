import { describe, it, expect } from "vitest";
import { pinSchema, emailSchema, passwordSchema, phoneSchema, PASSWORD_CRITERIA } from "../common";

describe("pinSchema", () => {
  it("should accept valid 4-digit PIN", () => {
    expect(pinSchema.safeParse("1234").success).toBe(true);
    expect(pinSchema.safeParse("0000").success).toBe(true);
    expect(pinSchema.safeParse("9999").success).toBe(true);
  });

  it("should reject non-4-digit strings", () => {
    expect(pinSchema.safeParse("123").success).toBe(false);
    expect(pinSchema.safeParse("12345").success).toBe(false);
  });

  it("should reject non-numeric PIN", () => {
    expect(pinSchema.safeParse("abcd").success).toBe(false);
    expect(pinSchema.safeParse("12ab").success).toBe(false);
  });

  it("should provide French error messages", () => {
    const result = pinSchema.safeParse("12");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Le code PIN doit contenir 4 chiffres");
    }
  });
});

describe("emailSchema", () => {
  it("should accept valid email", () => {
    expect(emailSchema.safeParse("test@example.com").success).toBe(true);
  });

  it("should reject invalid email", () => {
    const result = emailSchema.safeParse("not-an-email");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Adresse email invalide");
    }
  });
});

describe("passwordSchema", () => {
  it("should accept a password meeting all complexity requirements", () => {
    expect(passwordSchema.safeParse("Secure1!pass").success).toBe(true);
    expect(passwordSchema.safeParse("MyP@ss0rd").success).toBe(true);
    expect(passwordSchema.safeParse("Ab1!xxxx").success).toBe(true);
  });

  it("should reject short password", () => {
    const result = passwordSchema.safeParse("Ab1!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Le mot de passe doit contenir au moins 8 caractères"
      );
    }
  });

  it("should reject password without uppercase", () => {
    const result = passwordSchema.safeParse("secure1!pass");
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) => i.message.includes("majuscule"));
      expect(msg).toBeDefined();
    }
  });

  it("should reject password without lowercase", () => {
    const result = passwordSchema.safeParse("SECURE1!PASS");
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) => i.message.includes("minuscule"));
      expect(msg).toBeDefined();
    }
  });

  it("should reject password without digit", () => {
    const result = passwordSchema.safeParse("Secure!pass");
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) => i.message.includes("chiffre"));
      expect(msg).toBeDefined();
    }
  });

  it("should reject password without special character", () => {
    const result = passwordSchema.safeParse("Secure1pass");
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.find((i) => i.message.includes("spécial"));
      expect(msg).toBeDefined();
    }
  });

  it("should reject simple numeric password", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });

  it("should reject simple alphabetic password", () => {
    expect(passwordSchema.safeParse("securepassword").success).toBe(false);
  });
});

describe("PASSWORD_CRITERIA", () => {
  it("should have 5 criteria", () => {
    expect(PASSWORD_CRITERIA).toHaveLength(5);
  });

  it("each criterion should have regex and label", () => {
    for (const criterion of PASSWORD_CRITERIA) {
      expect(criterion.regex).toBeInstanceOf(RegExp);
      expect(typeof criterion.label).toBe("string");
      expect(criterion.label.length).toBeGreaterThan(0);
    }
  });
});

describe("phoneSchema", () => {
  it("should accept valid French phone numbers", () => {
    expect(phoneSchema.safeParse("+33612345678").success).toBe(true);
    expect(phoneSchema.safeParse("0612345678").success).toBe(true);
    expect(phoneSchema.safeParse("0145678901").success).toBe(true);
  });

  it("should accept empty string", () => {
    expect(phoneSchema.safeParse("").success).toBe(true);
  });

  it("should accept undefined", () => {
    expect(phoneSchema.safeParse(undefined).success).toBe(true);
  });

  it("should reject invalid phone numbers", () => {
    expect(phoneSchema.safeParse("123456").success).toBe(false);
    expect(phoneSchema.safeParse("+44612345678").success).toBe(false);
    expect(phoneSchema.safeParse("0012345678").success).toBe(false);
  });
});
