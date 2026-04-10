/**
 * Tests for editProductPipeline (PR-10)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock contextHash to avoid jsdom/canvas dependency
vi.mock("@/modules/stockLedger/engine/contextHash", () => ({
  computeContextHash: vi.fn(() => "abcd1234"),
}));
import { editProductPipeline } from "../editProductPipeline";
import type { EditPipelineInput, SaveProductRpcFn, InitializeStockFn } from "../editProductPipeline";
import type { SaveInputConfigFn } from "../createProductPipeline";
import type { CollisionChecker } from "../validateProductPayload";
import type { UnitWithFamily, ConversionRule } from "@/core/unitConversion/types";
import type { WizardState } from "@/modules/visionAI/components/ProductFormV3/types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_KG: UnitWithFamily = {
  id: "unit-kg",
  name: "kg",
  abbreviation: "kg",
  category: "mass",
  family: "weight",
  is_reference: true,
  aliases: null,
};

const UNIT_PCE: UnitWithFamily = {
  id: "unit-pce",
  name: "pièce",
  abbreviation: "pce",
  category: "count",
  family: "discrete",
  is_reference: true,
  aliases: null,
};

const dbUnits: UnitWithFamily[] = [UNIT_KG, UNIT_PCE];
const dbConversions: ConversionRule[] = [];

function makeWizardState(overrides?: Partial<WizardState>): WizardState {
  return {
    currentStep: 5,
    productName: "Tomate cerise",
    productCode: "TOM-001",
    barcode: "",
    identitySupplierId: "supplier-1",
    categoryId: "cat-1",
    billedUnit: "kg",
    billedUnitId: "unit-kg",
    billedQuantity: "10",
    lineTotal: "50",
    priceLevel: null,
    finalUnit: "kg",
    finalUnitId: "unit-kg",
    packagingLevels: [],
    storageZoneId: "zone-1",
    minStockQuantity: "5",
    minStockUnitId: "unit-kg",
    initialStockQuantity: "0",
    initialStockUnitId: "unit-kg",
    dlcWarningDays: "",
    allowUnitSale: false,
    deliveryUnitId: null,
    priceDisplayUnitId: null,
    inputConfigReceptionMode: null,
    inputConfigReceptionUnitId: null,
    inputConfigReceptionChain: null,
    inputConfigInternalMode: null,
    inputConfigInternalUnitId: null,
    inputConfigInternalChain: null,
    ...overrides,
  } as WizardState;
}

const noopCollisionChecker: CollisionChecker = async () => ({ hasCollision: false, collisionType: null, existingProductName: null });
const noopSaveConfig: SaveInputConfigFn = async () => {};
const noopInitStock: InitializeStockFn = async () => ({ error: null });

function makeSuccessRpc(): SaveProductRpcFn {
  return vi.fn(async () => ({
    data: { ok: true, transferred_qty: 0 },
    error: null,
  }));
}

function makeInput(overrides?: Partial<EditPipelineInput>): EditPipelineInput {
  return {
    wizardState: makeWizardState(),
    productId: "prod-1",
    expectedUpdatedAt: "2026-04-07T10:00:00Z",
    establishmentId: "est-1",
    userId: "user-1",
    dbUnits,
    dbConversions,
    initialData: {
      storage_zone_id: "zone-1",
      stock_handling_unit_id: "unit-kg",
      updated_at: "2026-04-07T10:00:00Z",
    } as any,
    collisionChecker: noopCollisionChecker,
    saveInputConfigFn: noopSaveConfig,
    saveProductRpcFn: makeSuccessRpc(),
    initializeStockFn: noopInitStock,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("editProductPipeline", () => {
  // Test 1 — Simple edit → ok: true
  it("returns ok: true for a simple edit", async () => {
    const result = await editProductPipeline(makeInput());
    expect(result).toMatchObject({ ok: true, productId: "prod-1" });
  });

  // Test 2 — Optimistic lock conflict
  it("returns OPTIMISTIC_LOCK when RPC signals conflict", async () => {
    const rpcFn: SaveProductRpcFn = vi.fn(async () => ({
      data: { ok: false, error: "OPTIMISTIC_LOCK_CONFLICT" },
      error: null,
    }));

    const result = await editProductPipeline(
      makeInput({ saveProductRpcFn: rpcFn }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "OPTIMISTIC_LOCK",
      retryable: false,
    });
  });

  // Test 3 — Family change → needsConfirmation
  it("returns needsConfirmation when stock unit family changes", async () => {
    const input = makeInput({
      wizardState: makeWizardState({
        finalUnit: "pièce",
        finalUnitId: "unit-pce",
        billedUnit: "pièce",
        billedUnitId: "unit-pce",
      }),
      initialData: {
        storage_zone_id: "zone-1",
        stock_handling_unit_id: "unit-kg", // was weight
        updated_at: "2026-04-07T10:00:00Z",
      } as any,
    });

    const result = await editProductPipeline(input);

    expect("needsConfirmation" in result).toBe(true);
    if ("needsConfirmation" in result) {
      expect(result.needsConfirmation).toBe("family_change");
      expect(result.pendingPayload.confirmed).toBe(true);
    }
  });

  // Test 4 — Family change confirmed → ok: true + initializeStockFn called
  it("proceeds when family change is confirmed and calls initializeStockFn", async () => {
    const initFn: InitializeStockFn = vi.fn(async () => ({ error: null }));

    const input = makeInput({
      wizardState: makeWizardState({
        finalUnit: "pièce",
        finalUnitId: "unit-pce",
        billedUnit: "pièce",
        billedUnitId: "unit-pce",
        storageZoneId: "zone-1",
      }),
      initialData: {
        storage_zone_id: "zone-1", // same zone → zoneChanged = false
        stock_handling_unit_id: "unit-kg",
        updated_at: "2026-04-07T10:00:00Z",
      } as any,
      confirmed: true,
      initializeStockFn: initFn,
    });

    const result = await editProductPipeline(input);

    expect(result).toMatchObject({ ok: true, productId: "prod-1" });
    expect(initFn).toHaveBeenCalledWith("prod-1", "user-1");
  });

  // Test 5 — saveInputConfigFn fails → CONFIG_ERROR
  it("returns CONFIG_ERROR when saveInputConfigFn fails", async () => {
    const failingSaveConfig: SaveInputConfigFn = async () => {
      throw new Error("Config persistence failed");
    };

    const result = await editProductPipeline(
      makeInput({ saveInputConfigFn: failingSaveConfig }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "CONFIG_ERROR",
      retryable: true,
    });
  });

  // Test 6 — STOCK_UNIT_LOCKED
  it("returns STOCK_UNIT_LOCKED when RPC signals it", async () => {
    const rpcFn: SaveProductRpcFn = vi.fn(async () => ({
      data: { ok: false, error: "STOCK_UNIT_LOCKED" },
      error: null,
    }));

    const result = await editProductPipeline(
      makeInput({ saveProductRpcFn: rpcFn }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "STOCK_UNIT_LOCKED",
      retryable: false,
    });
  });
});
