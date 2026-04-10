/**
 * Tests for generateInvoicePdf — verifies PDF generation uses ONLY snapshot data.
 */
import { describe, it, expect, vi } from "vitest";
import type { AppInvoiceWithLines } from "../types";

// Mock jspdf + autotable so tests run without canvas
const mockText = vi.fn();
const mockOutput = vi.fn(() => new Blob(["fake-pdf"], { type: "application/pdf" }));
const mockAddImage = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetFont = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetFillColor = vi.fn();
const mockRoundedRect = vi.fn();
const mockSplitTextToSize = vi.fn((t: string) => [t]);

function MockJsPDF() {
  return {
    text: mockText,
    output: mockOutput,
    addImage: mockAddImage,
    setFontSize: mockSetFontSize,
    setFont: mockSetFont,
    setTextColor: mockSetTextColor,
    setFillColor: mockSetFillColor,
    roundedRect: mockRoundedRect,
    splitTextToSize: mockSplitTextToSize,
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    lastAutoTable: { finalY: 150 },
  };
}

vi.mock("jspdf", () => ({
  default: MockJsPDF,
}));

vi.mock("jspdf-autotable", () => ({
  default: vi.fn(),
}));

function makeInvoice(overrides: Partial<AppInvoiceWithLines> = {}): AppInvoiceWithLines {
  return {
    id: "inv-1",
    invoice_number: "FAC-APP-000042",
    commande_id: "cmd-1",
    order_number_snapshot: "CMD-2025-001",
    supplier_establishment_id: "est-s",
    client_establishment_id: "est-c",
    supplier_name_snapshot: "Boulangerie Dupont",
    supplier_address_snapshot: "12 rue du Pain, 75001 Paris",
    supplier_siret_snapshot: "12345678901234",
    supplier_logo_url_snapshot: null,
    client_name_snapshot: "Restaurant Martin",
    client_address_snapshot: "5 avenue Foch, 75016 Paris",
    client_siret_snapshot: "98765432109876",
    total_ht: 150.0,
    vat_rate: null,
    vat_amount: null,
    total_ttc: null,
    invoice_date: "2026-03-06",
    commande_date_snapshot: "2026-03-01",
    status: "emise",
    created_by: "user-1",
    created_at: "2026-03-06T12:00:00Z",
    lines: [
      {
        id: "line-1",
        app_invoice_id: "inv-1",
        commande_line_id: "cl-1",
        product_id: "prod-1",
        product_name_snapshot: "Farine T65",
        unit_label_snapshot: "kg",
        canonical_unit_id: "unit-kg",
        quantity: 10,
        unit_price: 5.0,
        line_total: 50.0,
        created_at: "2026-03-06T12:00:00Z",
        billed_unit_id: null,
        billed_unit_label: null,
        billed_quantity: null,
        billed_unit_price: null,
      },
      {
        id: "line-2",
        app_invoice_id: "inv-1",
        commande_line_id: "cl-2",
        product_id: "prod-2",
        product_name_snapshot: "Beurre AOP",
        unit_label_snapshot: "kg",
        canonical_unit_id: "unit-kg",
        quantity: 20,
        unit_price: 5.0,
        line_total: 100.0,
        created_at: "2026-03-06T12:00:01Z",
        billed_unit_id: null,
        billed_unit_label: null,
        billed_quantity: null,
        billed_unit_price: null,
      },
    ],
    ...overrides,
  };
}

describe("generateInvoicePdf", () => {
  it("returns a Blob", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    const blob = await generateInvoicePdf(makeInvoice());
    expect(blob).toBeInstanceOf(Blob);
  });

  it("renders supplier name from snapshot", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    await generateInvoicePdf(makeInvoice({ supplier_name_snapshot: "SnapshotSupplier" }));
    expect(mockText).toHaveBeenCalledWith("SnapshotSupplier", expect.any(Number), expect.any(Number));
  });

  it("renders client name from snapshot", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    await generateInvoicePdf(makeInvoice({ client_name_snapshot: "SnapshotClient" }));
    expect(mockText).toHaveBeenCalledWith("SnapshotClient", expect.any(Number), expect.any(Number));
  });

  it("renders invoice number from snapshot", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    await generateInvoicePdf(makeInvoice({ invoice_number: "FAC-APP-999999" }));
    expect(mockText).toHaveBeenCalledWith("FAC-APP-999999", expect.any(Number), expect.any(Number), expect.objectContaining({ align: "right" }));
  });

  it("renders order number from snapshot", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    await generateInvoicePdf(makeInvoice({ order_number_snapshot: "CMD-SNAP-007" }));
    expect(mockText).toHaveBeenCalledWith(
      expect.stringContaining("CMD-SNAP-007"),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("renders SIRET from snapshots", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    await generateInvoicePdf(makeInvoice({ supplier_siret_snapshot: "111", client_siret_snapshot: "222" }));
    expect(mockText).toHaveBeenCalledWith("SIRET : 111", expect.any(Number), expect.any(Number));
    expect(mockText).toHaveBeenCalledWith("SIRET : 222", expect.any(Number), expect.any(Number));
  });

  it("passes line data from snapshots to autoTable", async () => {
    const { default: autoTable } = await import("jspdf-autotable");
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    await generateInvoicePdf(makeInvoice());
    expect(autoTable).toHaveBeenCalled();
    const call = vi.mocked(autoTable).mock.calls[0][1];
    expect(call?.body).toHaveLength(2);
    // First column of each row = product_name_snapshot
    expect((call?.body as string[][])?.[0]?.[0]).toBe("Farine T65");
    expect((call?.body as string[][])?.[1]?.[0]).toBe("Beurre AOP");
  });

  it("adds ANNULÉE watermark for cancelled invoices", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    mockText.mockClear();
    await generateInvoicePdf(makeInvoice({ status: "annulee" }));
    expect(mockText).toHaveBeenCalledWith(
      "ANNULÉE",
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ angle: 45 })
    );
  });

  it("does NOT add watermark for emise invoices", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    mockText.mockClear();
    await generateInvoicePdf(makeInvoice({ status: "emise" }));
    const annuleeCalls = mockText.mock.calls.filter((c) => c[0] === "ANNULÉE");
    expect(annuleeCalls).toHaveLength(0);
  });

  it("skips logo when supplier_logo_url_snapshot is null", async () => {
    const { generateInvoicePdf } = await import("../services/generateInvoicePdf");
    mockAddImage.mockClear();
    await generateInvoicePdf(makeInvoice({ supplier_logo_url_snapshot: null }));
    expect(mockAddImage).not.toHaveBeenCalled();
  });
});
