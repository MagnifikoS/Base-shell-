/**
 * generateInvoicePdf — Generates a clean PDF from snapshot data only.
 * No live catalog reads. Pure function (data in → PDF blob out).
 *
 * Uses billed_* snapshot fields from app_invoice_lines for display.
 * Falls back to canonical values for legacy invoices without billed_* fields.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { AppInvoiceWithLines } from "../types";
import { displayProductName } from "@/utils/displayName";
import type { DisplayInvoiceLine } from "../hooks/useInvoiceDisplayPrices";

function fmtEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function fmtDate(d: string): string {
  const p = d.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return d;
}

export async function generateInvoicePdf(
  invoice: AppInvoiceWithLines,
  displayLines?: DisplayInvoiceLine[]
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  // ── Optional logo ──
  if (invoice.supplier_logo_url_snapshot) {
    try {
      const img = await loadImage(invoice.supplier_logo_url_snapshot);
      doc.addImage(img, "PNG", margin, y, 30, 30);
    } catch {
      // logo load failed — skip silently
    }
  }

  // ── Title ──
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURE", pageW - margin, y + 8, { align: "right" });

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(invoice.invoice_number, pageW - margin, y + 16, { align: "right" });

  y += 38;

  // ── Supplier / Client blocks ──
  const colW = (pageW - margin * 2 - 10) / 2;

  // Supplier
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("FOURNISSEUR", margin, y);
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(invoice.supplier_name_snapshot, margin, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let sy = y + 12;
  if (invoice.supplier_address_snapshot) {
    const lines = doc.splitTextToSize(invoice.supplier_address_snapshot, colW);
    doc.text(lines, margin, sy);
    sy += lines.length * 4;
  }
  if (invoice.supplier_siret_snapshot) {
    doc.text(`SIRET : ${invoice.supplier_siret_snapshot}`, margin, sy);
  }

  // Client
  const cx = margin + colW + 10;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("CLIENT", cx, y);
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(invoice.client_name_snapshot, cx, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let cy2 = y + 12;
  if (invoice.client_address_snapshot) {
    const lines = doc.splitTextToSize(invoice.client_address_snapshot, colW);
    doc.text(lines, cx, cy2);
    cy2 += lines.length * 4;
  }
  if (invoice.client_siret_snapshot) {
    doc.text(`SIRET : ${invoice.client_siret_snapshot}`, cx, cy2);
  }

  y += 32;

  // ── Metadata ──
  doc.setFontSize(9);
  doc.setTextColor(80);
  const metaLines = [
    `Date facture : ${fmtDate(invoice.invoice_date)}`,
    `N° Commande : ${invoice.order_number_snapshot}`,
  ];
  if (invoice.commande_date_snapshot) {
    metaLines.push(`Date commande : ${fmtDate(invoice.commande_date_snapshot)}`);
  }
  metaLines.forEach((t) => {
    doc.text(t, margin, y);
    y += 5;
  });
  doc.setTextColor(0);

  y += 4;

  // ── Lines table ──
  // Use displayLines (from snapshot) if available, otherwise fall back to raw lines
  const dlMap = new Map((displayLines ?? []).map((dl) => [dl.id, dl]));
  const tableBody = invoice.lines.map((line) => {
    const dl = dlMap.get(line.id);
    // Priority: displayLine (from hook) > billed_* snapshot > canonical
    const qty = dl?.display_quantity ?? line.billed_quantity ?? line.quantity;
    const unitLabel = dl?.display_unit_label ?? line.billed_unit_label ?? line.unit_label_snapshot ?? "unité";
    const unitPrice = dl?.display_unit_price ?? line.billed_unit_price ?? line.unit_price;
    return [
      displayProductName(line.product_name_snapshot),
      `${qty}`,
      unitLabel,
      fmtEur(unitPrice),
      fmtEur(line.line_total),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Produit", "Qté", "Unité", "P.U. HT", "Total HT"]],
    body: tableBody,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: {
      fillColor: [55, 65, 81],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { halign: "right", cellWidth: 18 },
      2: { cellWidth: 22 },
      3: { halign: "right", cellWidth: 28 },
      4: { halign: "right", cellWidth: 28 },
    },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Total ──
  doc.setFillColor(240, 240, 240);
  doc.roundedRect(pageW - margin - 70, y, 70, 14, 2, 2, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Total HT", pageW - margin - 66, y + 9);
  doc.text(fmtEur(invoice.total_ht), pageW - margin - 4, y + 9, { align: "right" });

  // ── Cancelled watermark ──
  if (invoice.status === "annulee") {
    doc.setFontSize(50);
    doc.setTextColor(220, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.text("ANNULÉE", pageW / 2, 150, {
      align: "center",
      angle: 45,
    });
    doc.setTextColor(0);
  }

  // ── Footer ──
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(
    `Facture ${invoice.invoice_number} — Générée le ${new Date().toLocaleDateString("fr-FR")}`,
    pageW / 2,
    pageH - 10,
    { align: "center" }
  );

  return doc.output("blob");
}

function loadImage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas context"));
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}
