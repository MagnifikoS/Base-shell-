/**
 * Tests for admin schemas — role creation, role name edit, timepoint rules
 */

import { describe, it, expect } from "vitest";
import {
  createRoleSchema,
  editRoleNameSchema,
  timepointRuleSchema,
  timepointPolicySchema,
} from "../admin";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: createRoleSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("createRoleSchema", () => {
  it("accepts valid role name", () => {
    const result = createRoleSchema.safeParse({ name: "Chef de cuisine" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createRoleSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("requis");
    }
  });

  it("rejects name > 50 chars", () => {
    const result = createRoleSchema.safeParse({ name: "a".repeat(51) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("50");
    }
  });

  it("accepts name at exactly 50 chars", () => {
    const result = createRoleSchema.safeParse({ name: "a".repeat(50) });
    expect(result.success).toBe(true);
  });

  it("accepts names with accented characters", () => {
    const result = createRoleSchema.safeParse({ name: "Responsable équipe" });
    expect(result.success).toBe(true);
  });

  it("accepts names with hyphens and underscores", () => {
    const result = createRoleSchema.safeParse({ name: "sous-chef_principal" });
    expect(result.success).toBe(true);
  });

  it("accepts names with numbers", () => {
    const result = createRoleSchema.safeParse({ name: "Equipe 2" });
    expect(result.success).toBe(true);
  });

  it("rejects names with special characters (!@#$)", () => {
    const result = createRoleSchema.safeParse({ name: "Role @#$" });
    expect(result.success).toBe(false);
  });

  it("rejects names with special characters (/)", () => {
    const result = createRoleSchema.safeParse({ name: "Role/Test" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name field", () => {
    const result = createRoleSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: editRoleNameSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("editRoleNameSchema", () => {
  it("accepts valid name", () => {
    const result = editRoleNameSchema.safeParse({ name: "Nouveau nom" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = editRoleNameSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name > 50 chars", () => {
    const result = editRoleNameSchema.safeParse({ name: "b".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("rejects special characters", () => {
    const result = editRoleNameSchema.safeParse({ name: "Test!!" });
    expect(result.success).toBe(false);
  });

  it("accepts spaces in name", () => {
    const result = editRoleNameSchema.safeParse({ name: "Chef de rang" });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: timepointRuleSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("timepointRuleSchema", () => {
  it("accepts valid time and break_minutes", () => {
    const result = timepointRuleSchema.safeParse({ time: "12:00", break_minutes: 30 });
    expect(result.success).toBe(true);
  });

  it("accepts zero break_minutes", () => {
    const result = timepointRuleSchema.safeParse({ time: "09:00", break_minutes: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts 120 break_minutes (maximum)", () => {
    const result = timepointRuleSchema.safeParse({ time: "13:00", break_minutes: 120 });
    expect(result.success).toBe(true);
  });

  it("rejects break_minutes > 120", () => {
    const result = timepointRuleSchema.safeParse({ time: "12:00", break_minutes: 121 });
    expect(result.success).toBe(false);
  });

  it("rejects negative break_minutes", () => {
    const result = timepointRuleSchema.safeParse({ time: "12:00", break_minutes: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format (missing colon)", () => {
    const result = timepointRuleSchema.safeParse({ time: "1200", break_minutes: 30 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format (single digit)", () => {
    const result = timepointRuleSchema.safeParse({ time: "9:00", break_minutes: 30 });
    expect(result.success).toBe(false);
  });

  it("accepts midnight time", () => {
    const result = timepointRuleSchema.safeParse({ time: "00:00", break_minutes: 15 });
    expect(result.success).toBe(true);
  });

  it("accepts end of day time", () => {
    const result = timepointRuleSchema.safeParse({ time: "23:59", break_minutes: 15 });
    expect(result.success).toBe(true);
  });

  it("rejects empty time", () => {
    const result = timepointRuleSchema.safeParse({ time: "", break_minutes: 30 });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: timepointPolicySchema
// ═══════════════════════════════════════════════════════════════════════════

describe("timepointPolicySchema", () => {
  it("accepts valid policy with one rule", () => {
    const result = timepointPolicySchema.safeParse({
      rules: [{ time: "12:00", break_minutes: 30 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid policy with multiple rules", () => {
    const result = timepointPolicySchema.safeParse({
      rules: [
        { time: "09:00", break_minutes: 15 },
        { time: "12:00", break_minutes: 30 },
        { time: "15:00", break_minutes: 15 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty rules array", () => {
    const result = timepointPolicySchema.safeParse({ rules: [] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate times", () => {
    const result = timepointPolicySchema.safeParse({
      rules: [
        { time: "12:00", break_minutes: 30 },
        { time: "12:00", break_minutes: 15 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("doublon");
    }
  });

  it("accepts different times that are similar but not duplicate", () => {
    const result = timepointPolicySchema.safeParse({
      rules: [
        { time: "12:00", break_minutes: 30 },
        { time: "12:30", break_minutes: 15 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing rules field", () => {
    const result = timepointPolicySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("validates individual rules within the policy", () => {
    const result = timepointPolicySchema.safeParse({
      rules: [{ time: "bad-time", break_minutes: 30 }],
    });
    expect(result.success).toBe(false);
  });
});
