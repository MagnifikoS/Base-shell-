// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTS — validateProductCreated (PR-13)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase ──
const mockFrom = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { validateProductCreated } from "../validateProductCreated";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function chainBuilder(resolvedValue: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

function headChainBuilder(count: number | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  // head: true queries resolve directly with count
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null, count });
  // The select with { count, head } returns the chain that resolves with count
  const outerChain: Record<string, unknown> = {};
  outerChain.select = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ count, error: null }) });
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PRODUCT = {
  id: "prod-1",
  nom_produit: "TOMATE",
  stock_handling_unit_id: "u-kg",
  storage_zone_id: "zone-1",
  final_unit_price: 2.5,
};

const VALID_CONFIG = {
  purchase_mode: "continuous",
  reception_mode: "continuous",
  internal_mode: "continuous",
};

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("validateProductCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupMocks(overrides: {
    product?: { data: unknown; error: unknown };
    config?: { data: unknown; error: unknown };
    stockCount?: number | null;
  }) {
    const product = overrides.product ?? { data: VALID_PRODUCT, error: null };
    const config = overrides.config ?? { data: VALID_CONFIG, error: null };
    const stockCount = overrides.stockCount ?? 1;

    let callIndex = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "products_v2") {
        return chainBuilder(product);
      }
      if (table === "product_input_config") {
        return chainBuilder(config);
      }
      if (table === "stock_events") {
        // stock_events uses select with count+head, then .eq
        const obj: Record<string, unknown> = {};
        obj.select = vi.fn().mockReturnValue(obj);
        obj.eq = vi.fn().mockReturnValue(
          Promise.resolve({ count: stockCount, error: null }),
        );
        // Actually the code calls .eq which returns a promise-like with count
        // Let's match the actual Supabase pattern
        const eqChain = {
          eq: vi.fn().mockResolvedValue({ count: stockCount, error: null }),
        };
        const selectChain = {
          select: vi.fn().mockReturnValue(eqChain),
        };
        return selectChain;
      }
      return chainBuilder({ data: null, error: null });
    });
  }

  it("Test 1 — Produit valide et complet → valid: true", async () => {
    setupMocks({});

    const report = await validateProductCreated("prod-1", "est-1");

    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.checks.length).toBeGreaterThanOrEqual(3);
    expect(report.checks.find((c) => c.name === "Produit existe")?.passed).toBe(true);
    expect(report.checks.find((c) => c.name === "Config saisie existe")?.passed).toBe(true);
    expect(report.checks.find((c) => c.name === "Zone de stockage assignée")?.passed).toBe(true);
  });

  it("Test 2 — product_input_config absent → valid: false", async () => {
    setupMocks({ config: { data: null, error: null } });

    const report = await validateProductCreated("prod-1", "est-1");

    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.includes("product_input_config"))).toBe(true);
    expect(report.checks.find((c) => c.name === "Config saisie existe")?.passed).toBe(false);
  });

  it("Test 3 — storage_zone_id null → valid: false", async () => {
    setupMocks({
      product: {
        data: { ...VALID_PRODUCT, storage_zone_id: null },
        error: null,
      },
    });

    const report = await validateProductCreated("prod-1", "est-1");

    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.includes("Zone de stockage"))).toBe(true);
    expect(report.checks.find((c) => c.name === "Zone de stockage assignée")?.passed).toBe(false);
  });

  it("Test 4 — Aucun stock_event → valid: true (warning)", async () => {
    setupMocks({ stockCount: 0 });

    const report = await validateProductCreated("prod-1", "est-1");

    expect(report.valid).toBe(true);
    expect(report.checks.find((c) => c.name === "Stock événement existe")?.passed).toBe(false);
  });
});
