/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE — PDF Export Stock par Fournisseur
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { DesktopProductStock } from "../hooks/useDesktopStock";
import type { EstimatedStockOutcome } from "@/modules/stockLedger";

interface GenerateStockPdfParams {
  supplierName: string;
  products: DesktopProductStock[];
  estimatedStock: Map<string, EstimatedStockOutcome>;
  unitAbbreviations: Map<string, string>; // unitId → abbreviation
}

function getStatusLabel(
  product: DesktopProductStock,
  estimatedStock: Map<string, EstimatedStockOutcome>
): string {
  const outcome = estimatedStock.get(product.product_id);
  if (!outcome) return "—";
  if (!outcome.ok) {
    const errCode = (outcome as { ok: false; error: { code: string } }).error.code;
    return errCode === "NO_SNAPSHOT_LINE" ? "Non initialisé" : "Non calculable";
  }

  const est = outcome.data.estimated_quantity;
  const minStock = product.min_stock_quantity_canonical;

  if (est <= 0) return "Rupture";
  if (minStock != null && est < minStock) return "Sous seuil";
  return "OK";
}

function getStockLabel(
  product: DesktopProductStock,
  estimatedStock: Map<string, EstimatedStockOutcome>,
  unitAbbreviations: Map<string, string>
): string {
  const outcome = estimatedStock.get(product.product_id);
  if (!outcome) return "—";
  if (!outcome.ok) return "—";

  // Clamp: never show negative stock
  const est = Math.max(0, outcome.data.estimated_quantity);
  const unitAbbr = unitAbbreviations.get(outcome.data.canonical_unit_id) ?? "";
  return `${est} ${unitAbbr}`.trim();
}

export async function generateInventoryStockPdf({
  supplierName,
  products,
  estimatedStock,
  unitAbbreviations,
}: GenerateStockPdfParams): Promise<void> {
  if (products.length === 0) return;

  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const dateStr = format(new Date(), "dd MMMM yyyy 'à' HH:mm", { locale: fr });

  // Title
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Stock — ${supplierName}`, 14, 20);

  // Date
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Généré le ${dateStr}`, 14, 28);
  doc.setTextColor(0);

  // Count
  doc.text(`${products.length} produit${products.length > 1 ? "s" : ""}`, 14, 34);

  // Table
  const headers = ["N°", "Produit", "Catégorie", "Zone", "Stock actuel", "Seuil min", "Statut"];

  const rows = products.map((p, i) => {
    const status = getStatusLabel(p, estimatedStock);
    const stockLabel = getStockLabel(p, estimatedStock, unitAbbreviations);

    let minLabel = "—";
    if (p.min_stock_quantity_canonical != null) {
      const unitAbbr = p.min_stock_unit_id
        ? (unitAbbreviations.get(p.min_stock_unit_id) ?? "")
        : "";
      minLabel = `${p.min_stock_quantity_canonical} ${unitAbbr}`.trim();
    }

    return [
      String(i + 1),
      (p.nom_produit ?? "").toUpperCase(),
      p.category_name ?? "—",
      p.storage_zone_name ?? "—",
      stockLabel,
      minLabel,
      status,
    ];
  });

  autoTable(doc, {
    startY: 40,
    head: [headers],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: {
      fillColor: [41, 98, 255],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: "auto" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6) {
        const val = data.cell.raw as string;
        if (val === "Rupture") {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = "bold";
        } else if (val === "Sous seuil") {
          data.cell.styles.textColor = [245, 158, 11];
          data.cell.styles.fontStyle = "bold";
        } else if (val === "OK") {
          data.cell.styles.textColor = [16, 185, 129];
          data.cell.styles.fontStyle = "bold";
        } else if (val === "Non calculable") {
          data.cell.styles.textColor = [249, 115, 22];
          data.cell.styles.fontStyle = "italic";
        }
      }
    },
  });

  const fileName = `stock-${supplierName.replace(/[^a-zA-Z0-9]/g, "_")}-${format(new Date(), "yyyy-MM-dd")}.pdf`;
  doc.save(fileName);
}
