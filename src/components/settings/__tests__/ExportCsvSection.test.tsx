/**
 * Tests for ExportCsvSection — renders export buttons, click behavior
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportCsvSection } from "../ExportCsvSection";

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

const mockExportTableToCsv = vi.fn();

vi.mock("@/utils/exportCsv", () => ({
  exportTableToCsv: (...args: unknown[]) => mockExportTableToCsv(...args),
  getExportableTables: () => [
    { key: "products_v2", label: "Produits" },
    { key: "invoice_suppliers", label: "Fournisseurs" },
    { key: "invoices", label: "Factures" },
    { key: "invoice_line_items", label: "Lignes de facture" },
  ],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("ExportCsvSection — rendering", () => {
  it("renders the card title", () => {
    render(<ExportCsvSection />);
    expect(screen.getByText("Export CSV")).toBeDefined();
  });

  it("renders the card description", () => {
    render(<ExportCsvSection />);
    expect(screen.getByText(/Téléchargez vos données au format CSV/)).toBeDefined();
  });

  it("renders all export buttons", () => {
    render(<ExportCsvSection />);
    expect(screen.getByText("Produits")).toBeDefined();
    expect(screen.getByText("Fournisseurs")).toBeDefined();
    expect(screen.getByText("Factures")).toBeDefined();
    expect(screen.getByText("Lignes de facture")).toBeDefined();
  });

  it("renders table key as .csv file name hint", () => {
    render(<ExportCsvSection />);
    expect(screen.getByText("products_v2.csv")).toBeDefined();
    expect(screen.getByText("invoice_suppliers.csv")).toBeDefined();
    expect(screen.getByText("invoices.csv")).toBeDefined();
    expect(screen.getByText("invoice_line_items.csv")).toBeDefined();
  });

  it("renders 4 export buttons", () => {
    render(<ExportCsvSection />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Export button click
// ═══════════════════════════════════════════════════════════════════════════

describe("ExportCsvSection — export click", () => {
  it("calls exportTableToCsv with correct key on click", async () => {
    mockExportTableToCsv.mockResolvedValue({ count: 10 });

    render(<ExportCsvSection />);

    fireEvent.click(screen.getByText("Produits"));

    expect(mockExportTableToCsv).toHaveBeenCalledWith("products_v2");
  });

  it("calls exportTableToCsv for invoices", async () => {
    mockExportTableToCsv.mockResolvedValue({ count: 5 });

    render(<ExportCsvSection />);

    fireEvent.click(screen.getByText("Factures"));

    expect(mockExportTableToCsv).toHaveBeenCalledWith("invoices");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Button states
// ═══════════════════════════════════════════════════════════════════════════

describe("ExportCsvSection — button states", () => {
  it("buttons are not disabled initially", () => {
    render(<ExportCsvSection />);
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).not.toBeDisabled();
    });
  });
});
