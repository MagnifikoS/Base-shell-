/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — PDF Export : Tous les produits classés par fournisseur
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ProductV2ListItem } from "../types";

interface SupplierGroup {
  name: string;
  products: ProductV2ListItem[];
}

export async function generateAllProductsPdf(products: ProductV2ListItem[]): Promise<void> {
  if (products.length === 0) return;

  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const dateStr = format(new Date(), "dd MMMM yyyy", { locale: fr });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ── Group by supplier ──
  const groupMap = new Map<string, SupplierGroup>();
  for (const p of products) {
    const key = p.supplier_id ?? "__none__";
    const name = p.supplier_display_name ?? "Sans fournisseur";
    if (!groupMap.has(key)) {
      groupMap.set(key, { name, products: [] });
    }
    groupMap.get(key)!.products.push(p);
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  // Sort products alphabetically within each group
  for (const g of groups) {
    g.products.sort((a, b) => a.nom_produit.localeCompare(b.nom_produit, "fr"));
  }

  // ── Header ──
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Catalogue Produits", 14, 16);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(
    `${dateStr}  •  ${products.length} produit${products.length > 1 ? "s" : ""}  •  ${groups.length} fournisseur${groups.length > 1 ? "s" : ""}`,
    14,
    23
  );
  doc.setTextColor(0);

  // ── Thin separator ──
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(14, 26, pageWidth - 14, 26);

  let startY = 32;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];

    // Each supplier starts on a new page (except the first one)
    if (gi > 0) {
      doc.addPage();
      startY = 16;
    }

    // ── Supplier header ──
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(41, 98, 255);
    doc.text(group.name.toUpperCase(), 14, startY);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(140);
    doc.text(
      `${group.products.length} produit${group.products.length > 1 ? "s" : ""}`,
      14,
      startY + 5
    );
    doc.setTextColor(0);

    startY += 9;

    // ── Table ──
    const headers = [
      "#",
      "Produit",
      "Code",
      "Catégorie",
      "Conditionnement",
      "Zone stockage",
      "Prix unitaire",
    ];
    const rows = group.products.map((p, i) => [
      String(i + 1),
      p.nom_produit.toUpperCase(),
      p.code_produit ?? "—",
      p.category_name ?? "—",
      p.conditionnement_resume ?? "—",
      p.storage_zone_name ?? "—",
      p.final_unit_price != null ? `${p.final_unit_price.toFixed(2)} €` : "—",
    ]);

    autoTable(doc, {
      startY,
      head: [headers],
      body: rows,
      theme: "grid",
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        lineColor: [230, 230, 230],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [245, 247, 252],
        textColor: [60, 60, 60],
        fontStyle: "bold",
        fontSize: 7.5,
      },
      alternateRowStyles: {
        fillColor: [252, 252, 254],
      },
      columnStyles: {
        0: { cellWidth: 8, halign: "center", textColor: [160, 160, 160] },
        1: { cellWidth: "auto", fontStyle: "bold" },
        2: { cellWidth: 25 },
        3: { cellWidth: 30 },
        4: { cellWidth: 40 },
        5: { cellWidth: 35 },
        6: { cellWidth: 25, halign: "right" },
      },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        // Footer on every page
        const pageH = doc.internal.pageSize.getHeight();
        doc.setFontSize(7);
        doc.setTextColor(180);
        doc.text(`Catalogue Produits — ${dateStr}`, 14, pageH - 8);
        doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 14, pageH - 8, { align: "right" });
        doc.setTextColor(0);
      },
    });

    // Get end Y from autoTable
    startY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      startY + 20;
    startY += 10; // spacing between supplier groups
  }

  const fileName = `catalogue-produits-${format(new Date(), "yyyy-MM-dd")}.pdf`;
  doc.save(fileName);
}
