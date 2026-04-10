/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — PDF Export par Fournisseur
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Génère un PDF listant les produits d'un fournisseur.
 * Lecture seule depuis products_v2 (SSOT).
 * Aucun calcul métier, aucune transformation.
 */

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ProductV2ListItem } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// COLONNES DISPONIBLES
// ═══════════════════════════════════════════════════════════════════════════

export interface PdfColumnConfig {
  key: keyof ProductV2ListItem | "index";
  label: string;
  defaultSelected: boolean;
}

export const AVAILABLE_COLUMNS: PdfColumnConfig[] = [
  { key: "index", label: "N°", defaultSelected: false },
  { key: "nom_produit", label: "Nom produit", defaultSelected: true },
  { key: "code_produit", label: "Code produit", defaultSelected: true },
  { key: "category", label: "Catégorie", defaultSelected: true },
  { key: "final_unit_price", label: "Prix unitaire", defaultSelected: true },
  { key: "code_barres", label: "Code-barres", defaultSelected: false },
  { key: "conditionnement_resume", label: "Conditionnement", defaultSelected: false },
];

// ═══════════════════════════════════════════════════════════════════════════
// GÉNÉRATION PDF
// ═══════════════════════════════════════════════════════════════════════════

interface GeneratePdfParams {
  supplierName: string;
  products: ProductV2ListItem[];
  selectedColumns: string[]; // keys from AVAILABLE_COLUMNS
}

export async function generateSupplierProductsPdf({
  supplierName,
  products,
  selectedColumns,
}: GeneratePdfParams): Promise<void> {
  if (products.length === 0 || selectedColumns.length === 0) return;

  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const dateStr = format(new Date(), "dd MMMM yyyy 'à' HH:mm", { locale: fr });

  // Titre
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Catalogue produits — ${supplierName}`, 14, 20);

  // Date de génération
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Généré le ${dateStr}`, 14, 28);
  doc.setTextColor(0);

  // Nombre de produits
  doc.text(`${products.length} produit${products.length > 1 ? "s" : ""}`, 14, 34);

  // Construire le tableau
  const columns = AVAILABLE_COLUMNS.filter((col) => selectedColumns.includes(col.key));
  const headers = columns.map((col) => col.label);

  const rows = products.map((product, index) => {
    return columns.map((col) => {
      if (col.key === "index") {
        return String(index + 1);
      }
      const value = product[col.key as keyof ProductV2ListItem];
      if (col.key === "final_unit_price" && typeof value === "number") {
        return `${value.toFixed(2)} €`;
      }
      return typeof value === "object" ? "—" : (value ?? "—");
    });
  });

  autoTable(doc, {
    startY: 40,
    head: [headers],
    body: rows,
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [41, 98, 255],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250],
    },
    columnStyles: {
      0: { cellWidth: "auto" },
    },
  });

  // Télécharger
  const fileName = `produits-${supplierName.replace(/[^a-zA-Z0-9]/g, "_")}-${format(new Date(), "yyyy-MM-dd")}.pdf`;
  doc.save(fileName);
}
