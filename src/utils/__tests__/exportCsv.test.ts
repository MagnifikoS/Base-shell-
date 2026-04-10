/**
 * Tests for exportCsv utility — table configs, CSV generation, getExportableTables
 */

import { describe, it, expect, vi } from "vitest";
import { getExportableTables, type ExportableTable } from "../exportCsv";

// We mock supabase to avoid real DB calls
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: getExportableTables
// ═══════════════════════════════════════════════════════════════════════════

describe("getExportableTables", () => {
  it("returns an array of exportable tables", () => {
    const tables = getExportableTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
  });

  it("each table has key and label", () => {
    const tables = getExportableTables();
    for (const table of tables) {
      expect(typeof table.key).toBe("string");
      expect(typeof table.label).toBe("string");
      expect(table.key.length).toBeGreaterThan(0);
      expect(table.label.length).toBeGreaterThan(0);
    }
  });

  it("includes products_v2 table", () => {
    const tables = getExportableTables();
    const products = tables.find((t) => t.key === "products_v2");
    expect(products).toBeDefined();
    expect(products!.label).toBe("Produits");
  });

  it("includes invoice_suppliers table", () => {
    const tables = getExportableTables();
    const suppliers = tables.find((t) => t.key === "invoice_suppliers");
    expect(suppliers).toBeDefined();
    expect(suppliers!.label).toBe("Fournisseurs");
  });

  it("includes invoices table", () => {
    const tables = getExportableTables();
    const invoices = tables.find((t) => t.key === "invoices");
    expect(invoices).toBeDefined();
    expect(invoices!.label).toBe("Factures");
  });

  it("includes invoice_line_items table", () => {
    const tables = getExportableTables();
    const lineItems = tables.find((t) => t.key === "invoice_line_items");
    expect(lineItems).toBeDefined();
    expect(lineItems!.label).toBe("Lignes de facture");
  });

  it("returns exactly 4 tables", () => {
    const tables = getExportableTables();
    expect(tables.length).toBe(4);
  });

  it("all keys are valid ExportableTable type values", () => {
    const validKeys: ExportableTable[] = [
      "products_v2",
      "invoice_suppliers",
      "invoices",
      "invoice_line_items",
    ];
    const tables = getExportableTables();
    for (const table of tables) {
      expect(validKeys).toContain(table.key);
    }
  });

  it("has unique keys", () => {
    const tables = getExportableTables();
    const keys = tables.map((t) => t.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("has unique labels", () => {
    const tables = getExportableTables();
    const labels = tables.map((t) => t.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(labels.length);
  });
});
