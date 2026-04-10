/**
 * Tests for getWizardOptions (PR-11)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();

function createChain() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  return chain;
}

let chains: ReturnType<typeof createChain>[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => {
      const chain = createChain();
      chains.push(chain);
      return chain;
    }),
  },
}));

import { getWizardOptions } from "../getWizardOptions";

describe("getWizardOptions", () => {
  beforeEach(() => {
    chains = [];
    vi.clearAllMocks();
  });

  // Test 1 — Returns all 5 collections with correct shape
  it("returns all 5 collections with correct fields", async () => {
    const result = await getWizardOptions("est-1");

    expect(result.establishmentId).toBe("est-1");
    expect(Array.isArray(result.suppliers)).toBe(true);
    expect(Array.isArray(result.categories)).toBe(true);
    expect(Array.isArray(result.storageZones)).toBe(true);
    expect(Array.isArray(result.units)).toBe(true);
    expect(Array.isArray(result.conversions)).toBe(true);

    // 5 tables queried
    expect(chains.length).toBe(5);
  });

  // Test 2 — Returns empty collections on Supabase errors (no throw)
  it("returns empty collections when Supabase returns errors", async () => {
    // Re-mock to return errors
    const { supabase } = await import("@/integrations/supabase/client");
    const mockFrom = supabase.from as ReturnType<typeof vi.fn>;
    mockFrom.mockImplementation(() => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        order: vi.fn(() =>
          Promise.resolve({ data: null, error: { message: "RLS error" } }),
        ),
      };
      chains.push(chain as any);
      return chain;
    });

    const result = await getWizardOptions("est-2");

    expect(result.establishmentId).toBe("est-2");
    expect(result.suppliers).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.storageZones).toEqual([]);
    expect(result.units).toEqual([]);
    expect(result.conversions).toEqual([]);
  });

  // Test 3 — Throws if establishmentId is missing
  it("throws if establishmentId is empty", async () => {
    await expect(getWizardOptions("")).rejects.toThrow("establishmentId requis");
  });
});
