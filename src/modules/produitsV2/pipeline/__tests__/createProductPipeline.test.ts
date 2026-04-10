// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createProductPipeline } from "../createProductPipeline";
import type { CreateProductPipelineInput, SaveInputConfigFn, UpsertProductFn } from "../createProductPipeline";
import type { CollisionChecker } from "../validateProductPayload";
import type { WizardState } from "@/modules/visionAI/components/ProductFormV3/types";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_KG: UnitWithFamily = { id: "u-kg", name: "kg", abbreviation: "kg", category: "mass", family: "weight", is_reference: true, aliases: null };
const UNIT_PIECE: UnitWithFamily = { id: "u-piece", name: "pièce", abbreviation: "pce", category: "count", family: "count", is_reference: true, aliases: null };

const DB_UNITS: UnitWithFamily[] = [UNIT_KG, UNIT_PIECE];
const DB_CONVERSIONS: ConversionRule[] = [];

function makeWizardState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    currentStep: 5,
    productName: "Tomate Cerise",
    productCode: "TC-001",
    identitySupplierId: "supplier-1",
    finalUnit: "kg",
    finalUnitId: "u-kg",
    hasPackaging: false,
    packagingLevels: [],
    billedQuantity: "10",
    billedUnit: "kg",
    billedUnitId: "u-kg",
    lineTotal: "25",
    priceLevel: null,
    deliveryUnitId: null,
    stockHandlingUnitId: null,
    priceDisplayUnitId: null,
    category: "",
    categoryId: null,
    storageZoneId: "zone-1",
    minStockQuantity: "5",
    minStockUnitId: "u-kg",
    initialStockQuantity: "0",
    initialStockUnitId: null,
    barcode: "",
    dlcWarningDays: "",
    inputConfigReceptionMode: null,
    inputConfigReceptionUnitId: null,
    inputConfigReceptionChain: null,
    inputConfigReceptionPartial: false,
    inputConfigInternalMode: null,
    inputConfigInternalUnitId: null,
    inputConfigInternalChain: null,
    inputConfigInternalPartial: false,
    allowUnitSale: false,
    ...overrides,
  };
}

const noCollision: CollisionChecker = async () => ({
  hasCollision: false,
  collisionType: null,
  existingProductName: null,
});

const mockUpsert: UpsertProductFn = async (_estId, _payload) => ({
  product: {
    id: "prod-new-1",
    establishment_id: "est-1",
    nom_produit: "TOMATE CERISE",
    nom_produit_fr: null,
    name_normalized: "tomate cerise",
    code_produit: "TC-001",
    code_barres: null,
    variant_format: null,
    category: null,
    category_id: null,
    supplier_id: "supplier-1",
    supplier_billing_unit_id: "u-kg",
    conditionnement_config: null,
    conditionnement_resume: null,
    final_unit_price: 2.5,
    final_unit_id: "u-kg",
    stock_handling_unit_id: "u-kg",
    kitchen_unit_id: null,
    delivery_unit_id: "u-kg",
    price_display_unit_id: "u-kg",
    storage_zone_id: "zone-1",
    min_stock_quantity_canonical: 5,
    min_stock_unit_id: "u-kg",
    min_stock_updated_at: null,
    min_stock_updated_by: null,
    info_produit: null,
    dlc_warning_days: null,
    supplier_billing_quantity: 10,
    supplier_billing_line_total: 25,
    allow_unit_sale: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    created_by: "user-1",
  },
  wasCreated: true,
  matchedBy: null,
});

const mockSaveConfig: SaveInputConfigFn = async () => {};

function makeInput(overrides: Partial<CreateProductPipelineInput> = {}): CreateProductPipelineInput {
  return {
    wizardState: makeWizardState(),
    establishmentId: "est-1",
    userId: "user-1",
    dbUnits: DB_UNITS,
    dbConversions: DB_CONVERSIONS,
    initialData: null,
    collisionChecker: noCollision,
    saveInputConfigFn: mockSaveConfig,
    upsertFn: mockUpsert,
    calculationResult: { unitPriceFinal: 2.5 },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("createProductPipeline", () => {
  // Test 1 — Pipeline complet produit simple → ok: true
  it("should create a simple product successfully", async () => {
    const result = await createProductPipeline(makeInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productId).toBe("prod-new-1");
      expect(result.wasCreated).toBe(true);
      expect(result.warnings).toEqual([]);
    }
  });

  // Test 2 — productName vide → ok: false, VALIDATION
  it("should fail with VALIDATION when productName is empty", async () => {
    const result = await createProductPipeline(
      makeInput({
        wizardState: makeWizardState({ productName: "" }),
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fail = result as Extract<typeof result, { ok: false }>;
      expect(fail.code).toBe("VALIDATION");
      expect(fail.retryable).toBe(false);
    }
  });

  // Test 3 — Collision → ok: false, COLLISION
  it("should fail with COLLISION when collisionChecker reports a collision", async () => {
    const collisionChecker: CollisionChecker = async () => ({
      hasCollision: true,
      collisionType: "name",
      existingProductName: "TOMATE CERISE EXISTANTE",
    });

    const result = await createProductPipeline(
      makeInput({ collisionChecker }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fail = result as Extract<typeof result, { ok: false }>;
      expect(fail.code).toBe("COLLISION");
      expect(fail.retryable).toBe(false);
    }
  });

  // Test 4 — saveInputConfigFn échoue → CONFIG_ERROR
  it("should fail with CONFIG_ERROR when saveInputConfigFn throws", async () => {
    const failingSaveConfig: SaveInputConfigFn = async () => {
      throw new Error("Config persistence failed");
    };

    const result = await createProductPipeline(
      makeInput({ saveInputConfigFn: failingSaveConfig }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fail = result as Extract<typeof result, { ok: false }>;
      expect(fail.code).toBe("CONFIG_ERROR");
      expect(fail.retryable).toBe(true);
      expect(fail.message).toContain("Config persistence failed");
    }
  });

  // Test 5 — deliveryUnitId calculé AVANT stockHandlingUnitId
  it("should compute deliveryUnitId before stockHandlingUnitId (sequential dependency)", async () => {
    const callOrder: string[] = [];

    const ws = makeWizardState({
      hasPackaging: true,
      packagingLevels: [
        {
          id: "lvl-1",
          type: "Carton",
          type_unit_id: "u-piece",
          containsQuantity: 6,
          containsUnit: "kg",
          contains_unit_id: "u-kg",
        },
      ],
    });

    const trackingUpsert: UpsertProductFn = async (estId, payload) => {
      callOrder.push(`delivery:${payload.delivery_unit_id}`);
      callOrder.push(`stock:${payload.stock_handling_unit_id}`);
      return mockUpsert(estId, payload);
    };

    const result = await createProductPipeline(
      makeInput({ wizardState: ws, upsertFn: trackingUpsert }),
    );

    expect(result.ok).toBe(true);
    // deliveryUnitId = first packaging level's type_unit_id = u-piece
    expect(callOrder[0]).toBe("delivery:u-piece");
    expect(callOrder.length).toBe(2);
  });
});
