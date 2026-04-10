/**
 * Tests for settings schemas — badgeuse, opening exceptions, packaging
 */

import { describe, it, expect } from "vitest";
import { badgeuseSettingsSchema, openingExceptionSchema, packagingFormatSchema } from "../settings";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: badgeuseSettingsSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("badgeuseSettingsSchema", () => {
  const validSettings = {
    arrival_tolerance_min: 15,
    departure_tolerance_min: 30,
    early_arrival_limit_min: 10,
    require_pin: true,
    require_selfie: false,
  };

  it("accepts valid settings", () => {
    const result = badgeuseSettingsSchema.safeParse(validSettings);
    expect(result.success).toBe(true);
  });

  it("accepts zero values for tolerances", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      arrival_tolerance_min: 0,
      departure_tolerance_min: 0,
      early_arrival_limit_min: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts maximum values for tolerances", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      arrival_tolerance_min: 120,
      departure_tolerance_min: 180,
      early_arrival_limit_min: 120,
    });
    expect(result.success).toBe(true);
  });

  it("rejects arrival_tolerance_min < 0", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      arrival_tolerance_min: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects arrival_tolerance_min > 120", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      arrival_tolerance_min: 121,
    });
    expect(result.success).toBe(false);
  });

  it("rejects departure_tolerance_min < 0", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      departure_tolerance_min: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects departure_tolerance_min > 180", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      departure_tolerance_min: 181,
    });
    expect(result.success).toBe(false);
  });

  it("rejects early_arrival_limit_min < 0", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      early_arrival_limit_min: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects early_arrival_limit_min > 120", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      early_arrival_limit_min: 121,
    });
    expect(result.success).toBe(false);
  });

  it("require_pin must be boolean", () => {
    const result = badgeuseSettingsSchema.safeParse({ ...validSettings, require_pin: "yes" });
    expect(result.success).toBe(false);
  });

  it("require_selfie must be boolean", () => {
    const result = badgeuseSettingsSchema.safeParse({ ...validSettings, require_selfie: "no" });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = badgeuseSettingsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric tolerance values", () => {
    const result = badgeuseSettingsSchema.safeParse({
      ...validSettings,
      arrival_tolerance_min: "ten",
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: openingExceptionSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("openingExceptionSchema", () => {
  it("accepts valid closed exception", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid open exception with times", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: false,
      open_time: "09:00",
      close_time: "18:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty date", () => {
    const result = openingExceptionSchema.safeParse({
      date: "",
      closed: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects open exception without open_time", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: false,
      close_time: "18:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects open exception without close_time", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: false,
      open_time: "09:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts closed exception without times", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-12-25",
      closed: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts reason up to 200 characters", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: true,
      reason: "x".repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it("rejects reason > 200 characters", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: true,
      reason: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty string reason", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: true,
      reason: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts missing reason", () => {
    const result = openingExceptionSchema.safeParse({
      date: "2026-03-01",
      closed: true,
    });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: packagingFormatSchema
// ═══════════════════════════════════════════════════════════════════════════

describe("packagingFormatSchema", () => {
  const validPackaging = {
    label: "Carton de 6",
    unit_id: "some-uuid",
    quantity: 6,
    is_active: true,
  };

  it("accepts valid packaging data", () => {
    const result = packagingFormatSchema.safeParse(validPackaging);
    expect(result.success).toBe(true);
  });

  it("rejects empty label", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, label: "" });
    expect(result.success).toBe(false);
  });

  it("rejects label > 100 chars", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, label: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts label at exactly 100 chars", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, label: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects empty unit_id", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, unit_id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects quantity < 1", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, quantity: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts quantity of 1", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, quantity: 1 });
    expect(result.success).toBe(true);
  });

  it("accepts large quantity", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, quantity: 10000 });
    expect(result.success).toBe(true);
  });

  it("is_active must be boolean", () => {
    const result = packagingFormatSchema.safeParse({ ...validPackaging, is_active: "yes" });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = packagingFormatSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
