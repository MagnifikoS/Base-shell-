/**
 * ===============================================================================
 * THE BRAIN -- Unit Tests
 * ===============================================================================
 *
 * Comprehensive tests for Brain module services:
 * - brainEventsService (logEvent, brainSafeLog, getHealthSummary, getSubjectsSummary)
 * - brainProductRulesService (upsertProductMatchingRule, getBestProductRuleSuggestion, getProductMatchingRules)
 * - brainSupplierRulesService (upsertSupplierMatchingRule, getBestSupplierRuleSuggestion)
 * - supplierMatchingService (getSupplierMatchingRules)
 *
 * All DB calls are mocked via vi.mock of brainDb and supabase client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that use the mocked modules
// ---------------------------------------------------------------------------

// Mock brainDb module
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockUpdateChain = vi.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = vi.fn(() => ({
  eq: mockUpdateChain,
}));
const mockMaybeSingle = vi.fn();
const mockOrderChain = vi.fn(() => ({
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  then: vi.fn(),
}));
const mockGte = vi.fn().mockResolvedValue({ data: [], error: null });
const mockEq4 = vi.fn(() => ({
  maybeSingle: mockMaybeSingle,
}));
const mockEq3 = vi.fn(() => ({
  eq: mockEq4,
  maybeSingle: mockMaybeSingle,
  gte: mockGte,
}));
const mockEq2 = vi.fn(() => ({
  eq: mockEq3,
  gte: mockGte,
  order: mockOrderChain,
}));
const mockEq1 = vi.fn(() => ({
  eq: mockEq2,
  gte: mockGte,
  order: mockOrderChain,
}));
const mockSelect = vi.fn(() => ({
  eq: mockEq1,
  order: mockOrderChain,
}));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
}));

vi.mock("../services/brainDb", () => ({
  brainDb: {
    from: mockFrom,
  },
}));

// Mock supabase client (used by getProductMatchingRules for products_v2 lookup
// and by supplierMatchingService for invoice_suppliers lookup)
const mockSupabaseIn = vi.fn().mockResolvedValue({ data: [], error: null });
const mockSupabaseSelect = vi.fn(() => ({
  in: mockSupabaseIn,
}));
const mockSupabaseFrom = vi.fn(() => ({
  select: mockSupabaseSelect,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

// Mock constants — Brain ENABLED for tests by default
let brainDisabled = false;
vi.mock("../constants", () => ({
  get THE_BRAIN_DISABLED() {
    return brainDisabled;
  },
  BRAIN_SUBJECTS: {
    PRODUCT_MATCHING: "product_matching",
    PRICING: "pricing",
    SUPPLIER_MATCHING: "supplier_matching",
    INVENTORY: "inventory",
    PURCHASE_MONITORING: "purchase_monitoring",
    PRICE_EVOLUTION: "price_evolution",
    INVOICE_LIFECYCLE: "invoice_lifecycle",
  },
  BRAIN_ACTIONS: {
    CONFIRMED: "confirmed",
    CORRECTED: "corrected",
    IGNORED: "ignored",
    CREATED: "created",
    UPDATED: "updated",
    DELETED: "deleted",
    OBSERVED: "observed",
    VOIDED: "voided",
  },
  SUBJECT_LABELS: {},
  ACTION_LABELS: {},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  logEvent,
  brainSafeLog,
  getHealthSummary,
  getSubjectsSummary,
} from "../services/brainEventsService";

import {
  upsertProductMatchingRule,
  getBestProductRuleSuggestion,
  getProductMatchingRules,
} from "../services/brainProductRulesService";

import {
  upsertSupplierMatchingRule,
  getBestSupplierRuleSuggestion,
} from "../services/brainSupplierRulesService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ESTAB_ID = "estab-001";
const PRODUCT_ID = "prod-abc";
const SUPPLIER_ID = "supp-xyz";

function resetAllMocks() {
  vi.clearAllMocks();
  brainDisabled = false;

  // Reset defaults so chains resolve
  mockInsert.mockResolvedValue({ data: null, error: null });
  mockUpdateChain.mockResolvedValue({ data: null, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockGte.mockResolvedValue({ data: [], error: null });
  mockSupabaseIn.mockResolvedValue({ data: [], error: null });
  mockOrderChain.mockReturnValue({
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    then: vi.fn(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. brainEventsService
// ═══════════════════════════════════════════════════════════════════════════

describe("brainEventsService", () => {
  beforeEach(resetAllMocks);

  // -----------------------------------------------------------------------
  // logEvent
  // -----------------------------------------------------------------------
  describe("logEvent", () => {
    it("should call brainDb.from('brain_events').insert() with correct params", async () => {
      const result = await logEvent({
        establishmentId: ESTAB_ID,
        subject: "product_matching",
        action: "confirmed",
        context: { product_id: PRODUCT_ID },
        actorUserId: "user-001",
      });

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith("brain_events");
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          establishment_id: ESTAB_ID,
          subject: "product_matching",
          action: "confirmed",
          context: { product_id: PRODUCT_ID },
          actor_user_id: "user-001",
        }),
      ]);
    });

    it("should default context to {} and actor_user_id to null when omitted", async () => {
      await logEvent({
        establishmentId: ESTAB_ID,
        subject: "pricing",
        action: "observed",
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context: {},
          actor_user_id: null,
        }),
      ]);
    });

    it("should return success: false when insert returns an error", async () => {
      mockInsert.mockResolvedValueOnce({
        data: null,
        error: { message: "RLS violation" },
      });

      const result = await logEvent({
        establishmentId: ESTAB_ID,
        subject: "pricing",
        action: "confirmed",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("RLS violation");
    });

    it("should return success: false when insert throws an exception", async () => {
      mockInsert.mockRejectedValueOnce(new Error("network timeout"));

      const result = await logEvent({
        establishmentId: ESTAB_ID,
        subject: "pricing",
        action: "confirmed",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("network timeout");
    });
  });

  // -----------------------------------------------------------------------
  // brainSafeLog
  // -----------------------------------------------------------------------
  describe("brainSafeLog", () => {
    it("should not throw even when logEvent fails", () => {
      mockInsert.mockRejectedValueOnce(new Error("DB down"));

      // brainSafeLog is fire-and-forget, should never throw
      expect(() =>
        brainSafeLog({
          establishmentId: ESTAB_ID,
          subject: "product_matching",
          action: "confirmed",
        })
      ).not.toThrow();
    });

    it("should do nothing when THE_BRAIN_DISABLED is true", () => {
      brainDisabled = true;

      brainSafeLog({
        establishmentId: ESTAB_ID,
        subject: "product_matching",
        action: "confirmed",
      });

      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getHealthSummary
  // -----------------------------------------------------------------------
  describe("getHealthSummary", () => {
    it("should compute acceptance rate correctly (confirmed / (confirmed + corrected))", async () => {
      // Set up the chainable mock for brain_events query
      const events = [
        { subject: "product_matching", action: "confirmed" },
        { subject: "product_matching", action: "confirmed" },
        { subject: "product_matching", action: "corrected" },
        { subject: "supplier_matching", action: "confirmed" },
        { subject: "pricing", action: "observed" },
      ];

      // getHealthSummary calls: brainDb.from("brain_events").select(...).eq(...).gte(...)
      mockGte.mockResolvedValueOnce({ data: events, error: null });

      const result = await getHealthSummary(ESTAB_ID, "7d");

      // 3 confirmed, 1 corrected -> rate = 3/4 = 0.75
      expect(result.totalEvents).toBe(5);
      expect(result.activeSubjects).toBe(3);
      expect(result.acceptanceRate).toBe(0.75);
    });

    it("should return 0 acceptance rate when no confirmed/corrected events", async () => {
      const events = [
        { subject: "pricing", action: "observed" },
        { subject: "pricing", action: "observed" },
      ];
      mockGte.mockResolvedValueOnce({ data: events, error: null });

      const result = await getHealthSummary(ESTAB_ID, "7d");

      expect(result.acceptanceRate).toBe(0);
      expect(result.totalEvents).toBe(2);
    });

    it("should return empty summary when DB returns error", async () => {
      mockGte.mockResolvedValueOnce({
        data: null,
        error: { message: "DB error" },
      });

      const result = await getHealthSummary(ESTAB_ID, "30d");

      expect(result.totalEvents).toBe(0);
      expect(result.activeSubjects).toBe(0);
      expect(result.acceptanceRate).toBe(0);
      expect(result.topSubjects).toEqual([]);
    });

    it("should compute topSubjects sorted by event count (descending)", async () => {
      const events = [
        { subject: "product_matching", action: "confirmed" },
        { subject: "product_matching", action: "confirmed" },
        { subject: "product_matching", action: "corrected" },
        { subject: "supplier_matching", action: "confirmed" },
        { subject: "supplier_matching", action: "confirmed" },
        { subject: "supplier_matching", action: "confirmed" },
        { subject: "supplier_matching", action: "confirmed" },
      ];
      mockGte.mockResolvedValueOnce({ data: events, error: null });

      const result = await getHealthSummary(ESTAB_ID, "7d");

      expect(result.topSubjects).toHaveLength(2);
      // supplier_matching has 4 events, product_matching has 3
      expect(result.topSubjects[0].subject).toBe("supplier_matching");
      expect(result.topSubjects[0].eventCount).toBe(4);
      expect(result.topSubjects[1].subject).toBe("product_matching");
      expect(result.topSubjects[1].eventCount).toBe(3);
    });

    it("should compute per-subject acceptance rate correctly", async () => {
      const events = [
        { subject: "product_matching", action: "confirmed" },
        { subject: "product_matching", action: "corrected" },
      ];
      mockGte.mockResolvedValueOnce({ data: events, error: null });

      const result = await getHealthSummary(ESTAB_ID, "7d");

      // product_matching: 1 confirmed, 1 corrected -> 1/2 = 0.5
      const pmSubject = result.topSubjects.find((s) => s.subject === "product_matching");
      expect(pmSubject).toBeDefined();
      expect(pmSubject!.acceptanceRate).toBe(0.5);
      expect(pmSubject!.confirmedCount).toBe(1);
      expect(pmSubject!.correctedCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // getSubjectsSummary
  // -----------------------------------------------------------------------
  describe("getSubjectsSummary", () => {
    it("should correctly group events by subject", async () => {
      const events = [
        { subject: "product_matching", action: "confirmed" },
        { subject: "product_matching", action: "corrected" },
        { subject: "supplier_matching", action: "confirmed" },
        { subject: "supplier_matching", action: "confirmed" },
        { subject: "supplier_matching", action: "corrected" },
      ];
      mockGte.mockResolvedValueOnce({ data: events, error: null });

      const result = await getSubjectsSummary(ESTAB_ID, "7d");

      expect(result).toHaveLength(2);
      // supplier_matching: 3 events, product_matching: 2 events (sorted desc)
      expect(result[0].subject).toBe("supplier_matching");
      expect(result[0].eventCount).toBe(3);
      expect(result[0].confirmedCount).toBe(2);
      expect(result[0].correctedCount).toBe(1);
      expect(result[0].acceptanceRate).toBeCloseTo(2 / 3);

      expect(result[1].subject).toBe("product_matching");
      expect(result[1].eventCount).toBe(2);
      expect(result[1].confirmedCount).toBe(1);
      expect(result[1].correctedCount).toBe(1);
      expect(result[1].acceptanceRate).toBe(0.5);
    });

    it("should return empty array on DB error", async () => {
      mockGte.mockResolvedValueOnce({
        data: null,
        error: { message: "connection refused" },
      });

      const result = await getSubjectsSummary(ESTAB_ID, "30d");

      expect(result).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. brainProductRulesService
// ═══════════════════════════════════════════════════════════════════════════

describe("brainProductRulesService", () => {
  beforeEach(resetAllMocks);

  // -----------------------------------------------------------------------
  // getBestProductRuleSuggestion
  // -----------------------------------------------------------------------
  describe("getBestProductRuleSuggestion", () => {
    it("should return null when THE_BRAIN_DISABLED is true", async () => {
      brainDisabled = true;

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should return null when label is empty (no valid context key)", async () => {
      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "",
      });

      expect(result).toBeNull();
    });

    it("should return null when confirmations < 2", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { product_id: PRODUCT_ID },
          confirmations_count: 1,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).toBeNull();
    });

    it("should return null when corrections > 0", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { product_id: PRODUCT_ID },
          confirmations_count: 5,
          corrections_count: 1,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).toBeNull();
    });

    it("should return suggestion with 'probable' confidence when confirmations=2, corrections=0", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { product_id: PRODUCT_ID },
          confirmations_count: 2,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).not.toBeNull();
      expect(result!.productId).toBe(PRODUCT_ID);
      expect(result!.confirmationsCount).toBe(2);
      expect(result!.correctionsCount).toBe(0);
      expect(result!.confidence).toBe("probable");
    });

    it("should return suggestion with 'stable' confidence when confirmations >= 3, corrections=0", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { product_id: PRODUCT_ID },
          confirmations_count: 5,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: null,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe("stable");
      expect(result!.confirmationsCount).toBe(5);
    });

    it("should return null when product_id in value is not a string", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { product_id: 12345 },
          confirmations_count: 3,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).toBeNull();
    });

    it("should try fallback with 'unknown' supplier when real supplier key returns no result", async () => {
      // First call (real supplier key): no match
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      // Second call (fallback 'unknown' key): match
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { product_id: PRODUCT_ID },
          confirmations_count: 4,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
      });

      expect(result).not.toBeNull();
      expect(result!.productId).toBe(PRODUCT_ID);
      expect(result!.confidence).toBe("stable");
    });

    it("should not try fallback when supplierId is already null/unknown", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await getBestProductRuleSuggestion({
        establishmentId: ESTAB_ID,
        supplierId: null, // already "unknown"
        category: "Dairy",
        label: "Beurre Doux",
      });

      // Only 1 call (no fallback since supplier is already null -> "unknown")
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // upsertProductMatchingRule
  // -----------------------------------------------------------------------
  describe("upsertProductMatchingRule", () => {
    it("should do nothing when THE_BRAIN_DISABLED is true", async () => {
      brainDisabled = true;

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should skip when label is empty (no valid context key)", async () => {
      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        label: "",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("should INSERT new rule with confirmations_count=1 on 'confirmed' action", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          establishment_id: ESTAB_ID,
          subject: "product_matching",
          value: { product_id: PRODUCT_ID },
          confirmations_count: 1,
          corrections_count: 0,
          enabled: true,
        }),
      ]);
    });

    it("should INSERT new rule with corrections_count=1 on 'corrected' action", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
        productId: PRODUCT_ID,
        action: "corrected",
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          confirmations_count: 0,
          corrections_count: 1,
        }),
      ]);
    });

    it("should INSERT new rule with confirmations_count=1 on 'created' action", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        label: "Fromage Blanc",
        productId: PRODUCT_ID,
        action: "created",
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          confirmations_count: 1,
          corrections_count: 0,
        }),
      ]);
    });

    it("should UPDATE existing rule and increment confirmations on 'confirmed'", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          id: "rule-123",
          confirmations_count: 3,
          corrections_count: 0,
          value: { product_id: "old-product" },
        },
        error: null,
      });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          value: { product_id: PRODUCT_ID },
          confirmations_count: 4, // 3 + 1
        })
      );
      expect(mockUpdateChain).toHaveBeenCalledWith("id", "rule-123");
    });

    it("should UPDATE existing rule and increment corrections on 'corrected'", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          id: "rule-456",
          confirmations_count: 5,
          corrections_count: 2,
          value: { product_id: "old-product" },
        },
        error: null,
      });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Dairy",
        label: "Beurre Doux",
        productId: PRODUCT_ID,
        action: "corrected",
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          value: { product_id: PRODUCT_ID },
          corrections_count: 3, // 2 + 1
        })
      );
    });

    it("should not throw when fetch returns an error (silent failure)", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: "table not found" },
      });

      // Should not throw
      await expect(
        upsertProductMatchingRule({
          establishmentId: ESTAB_ID,
          label: "Beurre",
          productId: PRODUCT_ID,
          action: "confirmed",
        })
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Context key building (tested indirectly via upsertProductMatchingRule)
  // -----------------------------------------------------------------------
  describe("context key building (indirect)", () => {
    it("should use 'unknown' for null supplierId", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: null,
        category: "Dairy",
        label: "Beurre",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      // context_key should be: unknown|dairy|beurre
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context_key: "unknown|dairy|beurre",
        }),
      ]);
    });

    it("should normalize accented labels in context_key", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Boissons",
        label: "Cafe Creme",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      // context_key: supplierId|boissons|cafe_creme
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context_key: `${SUPPLIER_ID}|boissons|cafe_creme`,
        }),
      ]);
    });

    it("should use 'unknown' for null/undefined category", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: null,
        label: "Beurre",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      // category normalizes to "" which becomes "unknown"
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context_key: `${SUPPLIER_ID}|unknown|beurre`,
        }),
      ]);
    });

    it("should strip special characters from label in context_key", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        category: "Fruits & Legumes",
        label: "Tomates (bio) 100%",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      // "Fruits & Legumes" -> "fruits__legumes" -> after collapse: "fruits_legumes"
      // Actually: "Fruits & Legumes" -> lowercase -> "fruits & legumes" -> NFD -> same ->
      // remove non-alphanumeric except spaces -> "fruits  legumes" -> trim -> "fruits  legumes" -> collapse -> "fruits_legumes"
      // "Tomates (bio) 100%" -> "tomates bio 100" -> "tomates_bio_100"
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context_key: `${SUPPLIER_ID}|fruits_legumes|tomates_bio_100`,
        }),
      ]);
    });

    it("should handle accented characters correctly (e.g. Cafe Creme)", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertProductMatchingRule({
        establishmentId: ESTAB_ID,
        supplierId: SUPPLIER_ID,
        // Use actual accented characters
        category: "Cafe",
        label: "Caf\u00e9 Cr\u00e8me",
        productId: PRODUCT_ID,
        action: "confirmed",
      });

      // "Cafe" (no accents) -> "cafe"
      // "Cafe Creme" (with accents e->e, e->e) -> "cafe_creme"
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context_key: `${SUPPLIER_ID}|cafe|cafe_creme`,
        }),
      ]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. brainSupplierRulesService
// ═══════════════════════════════════════════════════════════════════════════

describe("brainSupplierRulesService", () => {
  beforeEach(resetAllMocks);

  // -----------------------------------------------------------------------
  // getBestSupplierRuleSuggestion
  // -----------------------------------------------------------------------
  describe("getBestSupplierRuleSuggestion", () => {
    it("should return null when THE_BRAIN_DISABLED is true", async () => {
      brainDisabled = true;

      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash & Carry",
      });

      expect(result).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should return null when extractedLabel is empty", async () => {
      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "",
      });

      expect(result).toBeNull();
    });

    it("should return null when confirmations < 2", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { supplier_id: SUPPLIER_ID },
          confirmations_count: 1,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
      });

      expect(result).toBeNull();
    });

    it("should return null when corrections > 0", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { supplier_id: SUPPLIER_ID },
          confirmations_count: 5,
          corrections_count: 1,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
      });

      expect(result).toBeNull();
    });

    it("should return suggestion when confirmations >= 2 and corrections === 0", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { supplier_id: SUPPLIER_ID },
          confirmations_count: 3,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
      });

      expect(result).not.toBeNull();
      expect(result!.supplierId).toBe(SUPPLIER_ID);
      expect(result!.confirmationsCount).toBe(3);
      expect(result!.correctionsCount).toBe(0);
    });

    it("should return null when supplier_id in value is not a string", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { supplier_id: null },
          confirmations_count: 5,
          corrections_count: 0,
          enabled: true,
        },
        error: null,
      });

      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
      });

      expect(result).toBeNull();
    });

    it("should return null when DB returns an error (silent failure)", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied" },
      });

      const result = await getBestSupplierRuleSuggestion({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
      });

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // upsertSupplierMatchingRule
  // -----------------------------------------------------------------------
  describe("upsertSupplierMatchingRule", () => {
    it("should do nothing when THE_BRAIN_DISABLED is true", async () => {
      brainDisabled = true;

      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
        supplierId: SUPPLIER_ID,
        action: "confirmed",
      });

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should skip when extractedLabel is empty", async () => {
      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "",
        supplierId: SUPPLIER_ID,
        action: "confirmed",
      });

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("should INSERT new rule with confirmations_count=1 on 'confirmed'", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash & Carry",
        supplierId: SUPPLIER_ID,
        action: "confirmed",
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          establishment_id: ESTAB_ID,
          subject: "supplier_matching",
          context_key: "metro_cash_carry",
          value: { supplier_id: SUPPLIER_ID },
          confirmations_count: 1,
          corrections_count: 0,
          enabled: true,
        }),
      ]);
    });

    it("should INSERT new rule with corrections_count=1 on 'corrected'", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
        supplierId: SUPPLIER_ID,
        action: "corrected",
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          confirmations_count: 0,
          corrections_count: 1,
        }),
      ]);
    });

    it("should UPDATE existing rule and increment confirmations on 'confirmed'", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          id: "rule-s-001",
          confirmations_count: 2,
          corrections_count: 0,
        },
        error: null,
      });

      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
        supplierId: SUPPLIER_ID,
        action: "confirmed",
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          value: { supplier_id: SUPPLIER_ID },
          confirmations_count: 3, // 2 + 1
        })
      );
      expect(mockUpdateChain).toHaveBeenCalledWith("id", "rule-s-001");
    });

    it("should UPDATE existing rule and increment corrections on 'corrected'", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          id: "rule-s-002",
          confirmations_count: 4,
          corrections_count: 1,
        },
        error: null,
      });

      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "Metro Cash",
        supplierId: SUPPLIER_ID,
        action: "corrected",
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          corrections_count: 2, // 1 + 1
        })
      );
    });

    it("should normalize accented labels in context_key", async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      await upsertSupplierMatchingRule({
        establishmentId: ESTAB_ID,
        extractedLabel: "Boulangerie P\u00e2tissi\u00e8re",
        supplierId: SUPPLIER_ID,
        action: "confirmed",
      });

      // "Boulangerie Patissiere" normalized: "boulangerie_patissiere"
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          context_key: "boulangerie_patissiere",
        }),
      ]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. computeConfidenceStatus (tested indirectly via getProductMatchingRules)
// ═══════════════════════════════════════════════════════════════════════════

describe("computeConfidenceStatus (indirect via getProductMatchingRules)", () => {
  beforeEach(resetAllMocks);

  /**
   * Helper: set up the chain for getProductMatchingRules which does:
   * 1. brainDb.from("brain_rules").select(...).eq(...).eq(...).order(...)
   * 2. supabase.from("products_v2").select(...).in(...)
   */
  function setupProductMatchingRulesChain(
    rules: Array<{
      id: string;
      context_key: string;
      value: Record<string, unknown>;
      confirmations_count: number;
      corrections_count: number;
      last_used_at: string | null;
    }>,
    products: Array<{ id: string; nom_produit: string; archived_at: string | null }>
  ) {
    // brainDb.from("brain_rules").select().eq().eq().order() -> rules
    mockOrderChain.mockResolvedValueOnce({ data: rules, error: null });

    // supabase.from("products_v2").select().in() -> products
    mockSupabaseIn.mockResolvedValueOnce({ data: products, error: null });
  }

  it("should assign 'stable' when confirmations >= 3 and corrections === 0", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r1",
          context_key: `${SUPPLIER_ID}|dairy|beurre`,
          value: { product_id: PRODUCT_ID },
          confirmations_count: 5,
          corrections_count: 0,
          last_used_at: "2026-01-15T10:00:00Z",
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Beurre Doux", archived_at: null }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("stable");
  });

  it("should assign 'probable' when confirmations=2 and corrections <= 1", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r2",
          context_key: `${SUPPLIER_ID}|dairy|lait`,
          value: { product_id: PRODUCT_ID },
          confirmations_count: 2,
          corrections_count: 1,
          last_used_at: null,
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Lait Demi-Ecreme", archived_at: null }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("probable");
  });

  it("should assign 'weak' for 1 confirmation and 0 corrections", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r3",
          context_key: `${SUPPLIER_ID}|meat|poulet`,
          value: { product_id: PRODUCT_ID },
          confirmations_count: 1,
          corrections_count: 0,
          last_used_at: null,
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Poulet Fermier", archived_at: null }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("weak");
  });

  it("should assign 'weak' for 0 confirmations and 5 corrections", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r4",
          context_key: `${SUPPLIER_ID}|fish|saumon`,
          value: { product_id: PRODUCT_ID },
          confirmations_count: 0,
          corrections_count: 5,
          last_used_at: null,
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Saumon Fume", archived_at: null }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("weak");
  });

  it("should exclude rules with archived products", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r5",
          context_key: `${SUPPLIER_ID}|dairy|beurre`,
          value: { product_id: PRODUCT_ID },
          confirmations_count: 5,
          corrections_count: 0,
          last_used_at: null,
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Beurre Doux", archived_at: "2026-01-01T00:00:00Z" }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(0);
  });

  it("should exclude rules without valid product_id", async () => {
    // Only set up the brain_rules chain -- no products mock needed because
    // validRules will be empty (product_id is null) and the function returns
    // before calling supabase.from("products_v2")
    mockOrderChain.mockResolvedValueOnce({
      data: [
        {
          id: "r6",
          context_key: `${SUPPLIER_ID}|dairy|beurre`,
          value: { product_id: null },
          confirmations_count: 5,
          corrections_count: 0,
          last_used_at: null,
        },
      ],
      error: null,
    });

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(0);
  });

  it("should mark rules with supplier_id='unknown' as isLegacy", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r7",
          context_key: "unknown|dairy|beurre",
          value: { product_id: PRODUCT_ID },
          confirmations_count: 3,
          corrections_count: 0,
          last_used_at: null,
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Beurre", archived_at: null }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(1);
    expect(result[0].isLegacy).toBe(true);
  });

  it("should mark rules with real supplier_id as not isLegacy", async () => {
    setupProductMatchingRulesChain(
      [
        {
          id: "r8",
          context_key: `${SUPPLIER_ID}|dairy|beurre`,
          value: { product_id: PRODUCT_ID },
          confirmations_count: 3,
          corrections_count: 0,
          last_used_at: null,
        },
      ],
      [{ id: PRODUCT_ID, nom_produit: "Beurre", archived_at: null }]
    );

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toHaveLength(1);
    expect(result[0].isLegacy).toBe(false);
  });

  it("should return empty array when THE_BRAIN_DISABLED is true", async () => {
    brainDisabled = true;

    const result = await getProductMatchingRules(ESTAB_ID);

    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
