/**
 * PAYROLL PREP PDF — Génération PDF front-only
 *
 * Génère un PDF fidèle à l'écran avec jspdf + autotable.
 * Toutes les dates sont formatées en timezone Europe/Paris.
 * Supports hidden columns — excluded from PDF output.
 */

import type { PayrollPrepEmployee } from "../hooks/usePayrollPrepData";
import type { EmployeeLocalEdits } from "../types";
import type { PayrollPrepColumnKey } from "../columnDefs";
import { PAYROLL_PREP_COLUMNS } from "../columnDefs";

interface GeneratePdfOptions {
  employees: PayrollPrepEmployee[];
  localEdits: Record<string, EmployeeLocalEdits>;
  yearMonth: string;
  observations: string;
  hiddenColumns: Set<PayrollPrepColumnKey>;
}

function formatDateParis(dateStr: string | null): string {
  if (!dateStr) return "–";
  const [year, month, day] = dateStr.split("-").map(Number);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function getDateRanges(dates: string[]): Array<{ debut: string; fin: string }> {
  if (dates.length === 0) {
    return [{ debut: "–", fin: "–" }];
  }
  const sorted = [...dates].sort();
  const periods: Array<{ debut: string; fin: string }> = [];
  let periodStart = sorted[0];
  let periodEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(periodEnd + "T12:00:00");
    const currDate = new Date(sorted[i] + "T12:00:00");
    const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays <= 1) {
      periodEnd = sorted[i];
    } else {
      periods.push({ debut: formatDateParis(periodStart), fin: formatDateParis(periodEnd) });
      periodStart = sorted[i];
      periodEnd = sorted[i];
    }
  }
  periods.push({ debut: formatDateParis(periodStart), fin: formatDateParis(periodEnd) });
  return periods;
}

function formatMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const months = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  return `${months[month - 1]} ${year}`;
}

/** Build all cell values for one row, keyed by column */
function buildRowCells(
  emp: PayrollPrepEmployee,
  edits: EmployeeLocalEdits | undefined,
  cpRanges: Array<{ debut: string; fin: string }>,
  absRanges: Array<{ debut: string; fin: string }>,
  amRanges: Array<{ debut: string; fin: string }>,
  rowIdx: number
): Record<PayrollPrepColumnKey, string> {
  const isFirst = rowIdx === 0;
  return {
    poste: isFirst ? (emp.position || "–") : "",
    hHebdo: isFirst ? (edits?.hoursWeekly?.toString() || "–") : "",
    hMens: isFirst ? (edits?.hoursMonthly?.toString() || "–") : "",
    debutContrat: isFirst ? formatDateParis(emp.contractStartDate) : "",
    finContrat: isFirst ? formatDateParis(emp.contractEndDate) : "",
    cpDebut: cpRanges[rowIdx]?.debut ?? "",
    cpFin: cpRanges[rowIdx]?.fin ?? "",
    absDebut: absRanges[rowIdx]?.debut ?? "",
    absFin: absRanges[rowIdx]?.fin ?? "",
    amDebut: amRanges[rowIdx]?.debut ?? "",
    amFin: amRanges[rowIdx]?.fin ?? "",
    navigo: isFirst ? (emp.hasNavigoPass ? "Oui" : "Non") : "",
    diversAmount: isFirst ? (edits?.diversAmount || "") : "",
    diversNature: isFirst ? (edits?.diversNature || "") : "",
    remarque: isFirst ? (edits?.remark || "") : "",
  };
}

export async function generatePayrollPrepPdf({
  employees,
  localEdits,
  yearMonth,
  observations,
  hiddenColumns,
}: GeneratePdfOptions): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const title = `ÉTAT PRÉPARATOIRE — ${formatMonthLabel(yearMonth).toUpperCase()}`;
  doc.setFontSize(14);
  doc.text(title, 14, 15);

  // Filter visible columns
  const visibleCols = PAYROLL_PREP_COLUMNS.filter((c) => !hiddenColumns.has(c.key));

  // Build header: "Salarié" is always first
  const tableHead = [["Salarié", ...visibleCols.map((c) => c.pdfHeader)]];

  // Build body
  const tableBody: string[][] = [];
  for (const emp of employees) {
    const edits = localEdits[emp.userId];
    const cpRanges = getDateRanges(emp.cpDates);
    const absRanges = getDateRanges(emp.absenceDates);
    const amRanges = getDateRanges(emp.amDates);
    const maxRows = Math.max(cpRanges.length, absRanges.length, amRanges.length);

    for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
      const cells = buildRowCells(emp, edits, cpRanges, absRanges, amRanges, rowIdx);
      const row = [
        rowIdx === 0 ? emp.fullName : "",
        ...visibleCols.map((c) => cells[c.key]),
      ];
      tableBody.push(row);
    }
  }

  // Build column styles dynamically
  const columnStyles: Record<number, { cellWidth: number; halign?: "center" | "left" | "right" }> = {
    0: { cellWidth: 30 }, // Salarié
  };
  visibleCols.forEach((c, i) => {
    const style: { cellWidth: number; halign?: "center" | "left" | "right" } = { cellWidth: c.pdfWidth };
    if (c.pdfAlign) style.halign = c.pdfAlign;
    columnStyles[i + 1] = style;
  });

  autoTable(doc, {
    startY: 22,
    head: tableHead,
    body: tableBody,
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
    },
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles,
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.text(
        `Page ${data.pageNumber} / ${pageCount}`,
        data.settings.margin.left,
        doc.internal.pageSize.height - 10
      );
    },
  });

  // Observations
  if (observations.trim()) {
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 100;
    const pageHeight = doc.internal.pageSize.height;

    if (finalY + 30 > pageHeight - 20) {
      doc.addPage();
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("Observations :", 14, 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(observations, 260);
      doc.text(lines, 14, 28);
    } else {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("Observations :", 14, finalY + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(observations, 260);
      doc.text(lines, 14, finalY + 18);
    }
  }

  const fileName = `etat-preparatoire-${yearMonth}.pdf`;
  doc.save(fileName);
}
