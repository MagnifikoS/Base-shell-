/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Accounting Export Utilities
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Export payroll and financial data in formats compatible with French
 * accounting software (Sage, Cegid, QuickBooks France).
 *
 * Supported formats:
 * - FEC (Fichier des Écritures Comptables) — legal French format
 * - CSV Sage — compatible with Sage 50/100
 * - CSV Generic — for any accounting software
 *
 * RULES:
 * - All amounts in EUR with 2 decimal places
 * - Date format: YYYYMMDD (FEC) or DD/MM/YYYY (Sage)
 * - UTF-8 with BOM for Excel compatibility
 * - Separator: TAB for FEC, semicolon for Sage
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollExportLine {
  employeeName: string;
  employeeId: string;
  month: string; // YYYY-MM
  grossSalary: number;
  netSalary: number;
  totalSalary: number;
  extras: number;
  absenceDeduction: number;
  lateDeduction: number;
  charges: number;
  adjustedTotal: number;
}

export interface InvoiceExportLine {
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  supplierName: string;
  supplierSiret?: string;
  amount: number;
  vatAmount?: number;
  totalTtc?: number;
  accountCode?: string;
}

export type AccountingFormat = "fec" | "sage" | "csv";

// ─────────────────────────────────────────────────────────────────────────────
// FEC Export (Fichier des Écritures Comptables)
// ─────────────────────────────────────────────────────────────────────────────

const FEC_HEADERS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcrtureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
];

function formatFecDate(dateStr: string): string {
  // YYYY-MM-DD → YYYYMMDD
  return dateStr.replace(/-/g, "");
}

function formatFecAmount(amount: number): string {
  return amount.toFixed(2).replace(".", ",");
}

export function generatePayrollFec(lines: PayrollExportLine[], _establishmentName: string): string {
  const rows: string[] = [FEC_HEADERS.join("\t")];
  let ecritureNum = 1;

  for (const line of lines) {
    const date = formatFecDate(`${line.month}-01`);
    const ref = `PAIE-${line.month}-${String(ecritureNum).padStart(4, "0")}`;

    // Debit: Salary expense (641)
    rows.push(
      [
        "OD", // Journal code
        "Opérations Diverses",
        ref,
        date,
        "641000", // Rémunérations du personnel
        "Rémunérations du personnel",
        line.employeeId.substring(0, 17),
        line.employeeName,
        ref,
        date,
        `Salaire ${line.month} - ${line.employeeName}`,
        formatFecAmount(line.adjustedTotal),
        formatFecAmount(0),
        "",
        "",
        date,
        "",
        "EUR",
      ].join("\t")
    );

    // Credit: Net to pay (421)
    rows.push(
      [
        "OD",
        "Opérations Diverses",
        ref,
        date,
        "421000", // Personnel - Rémunérations dues
        "Personnel - Rémunérations dues",
        line.employeeId.substring(0, 17),
        line.employeeName,
        ref,
        date,
        `Net à payer ${line.month} - ${line.employeeName}`,
        formatFecAmount(0),
        formatFecAmount(line.netSalary),
        "",
        "",
        date,
        "",
        "EUR",
      ].join("\t")
    );

    // Credit: Charges (645)
    if (line.charges > 0) {
      rows.push(
        [
          "OD",
          "Opérations Diverses",
          ref,
          date,
          "645000", // Charges de sécurité sociale
          "Charges de sécurité sociale",
          "",
          "",
          ref,
          date,
          `Charges patronales ${line.month} - ${line.employeeName}`,
          formatFecAmount(0),
          formatFecAmount(line.charges),
          "",
          "",
          date,
          "",
          "EUR",
        ].join("\t")
      );
    }

    ecritureNum++;
  }

  return rows.join("\n");
}

export function generateInvoiceFec(lines: InvoiceExportLine[]): string {
  const rows: string[] = [FEC_HEADERS.join("\t")];
  let ecritureNum = 1;

  for (const line of lines) {
    const date = formatFecDate(line.invoiceDate);
    const ref = line.invoiceNumber || `FACT-${String(ecritureNum).padStart(4, "0")}`;

    // Debit: Purchase (607)
    rows.push(
      [
        "AC", // Journal Achats
        "Achats",
        ref,
        date,
        line.accountCode ?? "607000", // Achats de marchandises
        "Achats de marchandises",
        "",
        line.supplierName,
        ref,
        date,
        `Facture ${line.supplierName} - ${ref}`,
        formatFecAmount(line.amount),
        formatFecAmount(0),
        "",
        "",
        date,
        "",
        "EUR",
      ].join("\t")
    );

    // Credit: Supplier (401)
    rows.push(
      [
        "AC",
        "Achats",
        ref,
        date,
        "401000", // Fournisseurs
        "Fournisseurs",
        line.supplierSiret ?? "",
        line.supplierName,
        ref,
        date,
        `Facture ${line.supplierName} - ${ref}`,
        formatFecAmount(0),
        formatFecAmount(line.totalTtc ?? line.amount),
        "",
        "",
        date,
        "",
        "EUR",
      ].join("\t")
    );

    ecritureNum++;
  }

  return rows.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Sage CSV Export
// ─────────────────────────────────────────────────────────────────────────────

function formatSageDate(dateStr: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function generatePayrollSageCsv(lines: PayrollExportLine[]): string {
  const headers = [
    "Nom",
    "Mois",
    "Brut",
    "Net",
    "Total",
    "Heures sup.",
    "Absences",
    "Retards",
    "Charges",
    "Total ajusté",
  ];

  const rows = [headers.join(";")];
  for (const line of lines) {
    rows.push(
      [
        line.employeeName,
        line.month,
        line.grossSalary.toFixed(2),
        line.netSalary.toFixed(2),
        line.totalSalary.toFixed(2),
        line.extras.toFixed(2),
        line.absenceDeduction.toFixed(2),
        line.lateDeduction.toFixed(2),
        line.charges.toFixed(2),
        line.adjustedTotal.toFixed(2),
      ].join(";")
    );
  }

  return rows.join("\n");
}

export function generateInvoiceSageCsv(lines: InvoiceExportLine[]): string {
  const headers = [
    "N° Facture",
    "Date",
    "Fournisseur",
    "SIRET",
    "Montant HT",
    "TVA",
    "Montant TTC",
    "Code compte",
  ];

  const rows = [headers.join(";")];
  for (const line of lines) {
    rows.push(
      [
        line.invoiceNumber,
        formatSageDate(line.invoiceDate),
        line.supplierName,
        line.supplierSiret ?? "",
        line.amount.toFixed(2),
        (line.vatAmount ?? 0).toFixed(2),
        (line.totalTtc ?? line.amount).toFixed(2),
        line.accountCode ?? "607000",
      ].join(";")
    );
  }

  return rows.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Download Helper
// ─────────────────────────────────────────────────────────────────────────────

export function downloadAccountingFile(
  content: string,
  filename: string,
  separator: "tab" | "semicolon" = "tab"
): void {
  const bom = "\uFEFF"; // UTF-8 BOM for Excel
  const mimeType =
    separator === "tab" ? "text/tab-separated-values;charset=utf-8;" : "text/csv;charset=utf-8;";

  const blob = new Blob([bom + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// High-Level Export Functions
// ─────────────────────────────────────────────────────────────────────────────

export function exportPayroll(
  lines: PayrollExportLine[],
  format: AccountingFormat,
  month: string,
  establishmentName: string
): void {
  const date = new Date().toISOString().slice(0, 10);

  switch (format) {
    case "fec": {
      const content = generatePayrollFec(lines, establishmentName);
      downloadAccountingFile(content, `FEC_PAIE_${month}_${date}.txt`, "tab");
      break;
    }
    case "sage": {
      const content = generatePayrollSageCsv(lines);
      downloadAccountingFile(content, `SAGE_PAIE_${month}_${date}.csv`, "semicolon");
      break;
    }
    case "csv":
    default: {
      const content = generatePayrollSageCsv(lines); // Same format, different name
      downloadAccountingFile(content, `PAIE_${month}_${date}.csv`, "semicolon");
      break;
    }
  }
}

export function exportInvoices(
  lines: InvoiceExportLine[],
  format: AccountingFormat,
  period: string
): void {
  const date = new Date().toISOString().slice(0, 10);

  switch (format) {
    case "fec": {
      const content = generateInvoiceFec(lines);
      downloadAccountingFile(content, `FEC_ACHATS_${period}_${date}.txt`, "tab");
      break;
    }
    case "sage": {
      const content = generateInvoiceSageCsv(lines);
      downloadAccountingFile(content, `SAGE_ACHATS_${period}_${date}.csv`, "semicolon");
      break;
    }
    case "csv":
    default: {
      const content = generateInvoiceSageCsv(lines);
      downloadAccountingFile(content, `ACHATS_${period}_${date}.csv`, "semicolon");
      break;
    }
  }
}
