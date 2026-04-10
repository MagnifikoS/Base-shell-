// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TESTS — createProductFromOptions (PR-12)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase ──
const mockRpcFn = vi.fn();
const mockFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpcFn(...args),
    auth: { getUser: () => mockGetUser() },
  },
}));

// ── Mock getWizardOptions ──
const mockGetWizardOptions = vi.fn();
vi.mock("@/modules/produitsV2/pipeline/getWizardOptions", () => ({
  getWizardOptions: (...args: unknown[]) => mockGetWizardOptions(...args),
}));

// ── Mock createProductPipeline ──
const mockCreatePipeline = vi.fn();
vi.mock("@/modules/produitsV2/pipeline/createProductPipeline", () => ({
  createProductPipeline: (...args: unknown[]) => mockCreatePipeline(...args),
}));

// ── Mock collision checker ──
vi.mock("@/modules/produitsV2/services/productsV2Service", () => ({
  checkProductV2Collision: vi.fn(),
  upsertProductV2: vi.fn(),
}));

import { createProductFromOptions } from "../createProductFromOptions";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const BASE_OPTIONS = {
  establishmentId: "est-1",
  suppliers: [{ id: "sup-1", name: "Metro" }],
  categories: [{ id: "cat-1", name: "Légumes" }],
  storageZones: [{ id: "zone-1", name: "Chambre froide", name_normalized: "chambre froide" }],
  units: [
    { id: "u-kg", name: "Kilogramme", abbreviation: "kg", family: "weight" },
    { id: "u-pce", name: "Pièce", abbreviation: "pce", family: "discrete" },
  ],
  conversions: [],
};

const BASE_INPUT = {
  name: "Tomate",
  supplierName: "Metro",
  finalUnitAbbr: "kg",
  billedUnitAbbr: "kg",
  billedQuantity: 10,
  lineTotal: 25,
  storageZoneName: "Chambre froide",
  establishmentId: "est-1",
};

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("createProductFromOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockGetWizardOptions.mockResolvedValue(BASE_OPTIONS);
    mockCreatePipeline.mockResolvedValue({
      ok: true,
      productId: "prod-1",
      wasCreated: true,
      warnings: [],
    });
  });

  it("Test 1 — Création produit simple → ok: true", async () => {
    const result = await createProductFromOptions(BASE_INPUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productId).toBe("prod-1");
    }

    // Verify pipeline was called with correct WizardState
    expect(mockCreatePipeline).toHaveBeenCalledTimes(1);
    const pipelineInput = mockCreatePipeline.mock.calls[0][0];
    expect(pipelineInput.wizardState.productName).toBe("Tomate");
    expect(pipelineInput.wizardState.identitySupplierId).toBe("sup-1");
    expect(pipelineInput.wizardState.finalUnitId).toBe("u-kg");
    expect(pipelineInput.wizardState.billedUnitId).toBe("u-kg");
    expect(pipelineInput.wizardState.storageZoneId).toBe("zone-1");
    expect(pipelineInput.wizardState.currentStep).toBe(5);
    // All optional fields have correct defaults
    expect(pipelineInput.wizardState.hasPackaging).toBe(false);
    expect(pipelineInput.wizardState.packagingLevels).toEqual([]);
    expect(pipelineInput.wizardState.priceLevel).toBeNull();
    expect(pipelineInput.wizardState.deliveryUnitId).toBeNull();
    expect(pipelineInput.wizardState.allowUnitSale).toBe(false);
  });

  it("Test 2 — Fournisseur introuvable → VALIDATION", async () => {
    const result = await createProductFromOptions({
      ...BASE_INPUT,
      supplierName: "Fournisseur Inexistant",
    });

    expect(result.ok).toBe(false);
    const err = result as { ok: false; code: string; message: string; retryable: boolean };
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toContain("Fournisseur Inexistant");
    expect(err.message).toContain("introuvable");
    expect(err.retryable).toBe(false);
    expect(mockCreatePipeline).not.toHaveBeenCalled();
  });

  it("Test 3 — Unité introuvable → VALIDATION", async () => {
    const result = await createProductFromOptions({
      ...BASE_INPUT,
      finalUnitAbbr: "xyz",
    });

    expect(result.ok).toBe(false);
    const err = result as { ok: false; code: string; message: string; retryable: boolean };
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toContain("xyz");
    expect(err.message).toContain("introuvable");
    expect(err.retryable).toBe(false);
    expect(mockCreatePipeline).not.toHaveBeenCalled();
  });
});
