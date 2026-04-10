import { describe, it, expect } from "vitest";
import { employeeSchema, employeeSensitiveSchema, employeeDetailsSchema } from "../employee";

describe("employeeSchema", () => {
  it("should accept valid employee data", () => {
    const result = employeeSchema.safeParse({
      first_name: "Jean",
      last_name: "Dupont",
      email: "jean@test.com",
      role: "serveur",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty first_name", () => {
    const result = employeeSchema.safeParse({
      first_name: "",
      last_name: "Dupont",
      role: "serveur",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Le prénom est requis");
    }
  });

  it("should reject empty role", () => {
    const result = employeeSchema.safeParse({
      first_name: "Jean",
      last_name: "Dupont",
      role: "",
    });
    expect(result.success).toBe(false);
  });

  it("should accept empty string for email", () => {
    const result = employeeSchema.safeParse({
      first_name: "Jean",
      last_name: "Dupont",
      role: "serveur",
      email: "",
    });
    expect(result.success).toBe(true);
  });

  it("should reject weekly_hours over 48", () => {
    const result = employeeSchema.safeParse({
      first_name: "Jean",
      last_name: "Dupont",
      role: "serveur",
      weekly_hours: 50,
    });
    expect(result.success).toBe(false);
  });
});

describe("employeeSensitiveSchema", () => {
  it("should accept valid French IBAN", () => {
    const result = employeeSensitiveSchema.safeParse({
      iban: "FR7612345678901234567890123",
    });
    expect(result.success).toBe(true);
  });

  it("should reject non-French IBAN", () => {
    const result = employeeSensitiveSchema.safeParse({
      iban: "DE89370400440532013000",
    });
    expect(result.success).toBe(false);
  });

  it("should accept empty string for IBAN", () => {
    const result = employeeSensitiveSchema.safeParse({ iban: "" });
    expect(result.success).toBe(true);
  });

  it("should accept valid French SSN", () => {
    const result = employeeSensitiveSchema.safeParse({
      ssn: "185017512345620",
    });
    expect(result.success).toBe(true);
  });

  it("should reject SSN starting with 3", () => {
    const result = employeeSensitiveSchema.safeParse({
      ssn: "385017512345620",
    });
    expect(result.success).toBe(false);
  });

  it("should reject SSN with invalid month 13", () => {
    const result = employeeSensitiveSchema.safeParse({
      ssn: "185131234567890",
    });
    expect(result.success).toBe(false);
  });
});

describe("employeeDetailsSchema", () => {
  it("should accept valid form data with nulls", () => {
    const result = employeeDetailsSchema.safeParse({
      phone: null,
      address: null,
      position: null,
      contract_hours: null,
      gross_salary: null,
      net_salary: null,
      total_salary: null,
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid salary data", () => {
    const result = employeeDetailsSchema.safeParse({
      gross_salary: 2500,
      net_salary: 1950,
      total_salary: 2100,
    });
    expect(result.success).toBe(true);
  });

  it("should reject negative salary", () => {
    const result = employeeDetailsSchema.safeParse({
      gross_salary: -100,
    });
    expect(result.success).toBe(false);
  });

  it("should reject contract_hours over 48", () => {
    const result = employeeDetailsSchema.safeParse({
      contract_hours: 50,
    });
    expect(result.success).toBe(false);
  });

  it("should reject net_salary > gross_salary (cross-field)", () => {
    const result = employeeDetailsSchema.safeParse({
      gross_salary: 1000,
      net_salary: 2000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const netError = result.error.issues.find((i) => i.path.includes("net_salary"));
      expect(netError).toBeDefined();
      expect(netError?.message).toBe("Le salaire net ne peut pas dépasser le salaire brut");
    }
  });

  it("should reject total_salary < net_salary (cross-field)", () => {
    const result = employeeDetailsSchema.safeParse({
      gross_salary: 2500,
      net_salary: 2000,
      total_salary: 1500,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const totalError = result.error.issues.find((i) => i.path.includes("total_salary"));
      expect(totalError).toBeDefined();
      expect(totalError?.message).toBe(
        "Le salaire total doit être supérieur ou égal au salaire net"
      );
    }
  });

  it("should accept SSN with spaces (stripped before validation)", () => {
    const result = employeeDetailsSchema.safeParse({
      social_security_number: "1 85 01 75123 456 20",
    });
    expect(result.success).toBe(true);
  });

  it("should accept IBAN with spaces and lowercase (normalized)", () => {
    const result = employeeDetailsSchema.safeParse({
      iban: "fr76 1234 5678 9012 3456 7890 123",
    });
    expect(result.success).toBe(true);
  });
});
