/**
 * Column definitions for PayrollPrep table.
 * Used by both the table component and the PDF generator.
 */

export type PayrollPrepColumnKey =
  | "poste"
  | "hHebdo"
  | "hMens"
  | "debutContrat"
  | "finContrat"
  | "cpDebut"
  | "cpFin"
  | "absDebut"
  | "absFin"
  | "amDebut"
  | "amFin"
  | "navigo"
  | "diversAmount"
  | "diversNature"
  | "remarque";

export interface PayrollPrepColumnDef {
  key: PayrollPrepColumnKey;
  label: string;
  pdfHeader: string;
  pdfWidth: number;
  pdfAlign?: "center" | "left" | "right";
}

export const PAYROLL_PREP_COLUMNS: PayrollPrepColumnDef[] = [
  { key: "poste", label: "Poste", pdfHeader: "Poste", pdfWidth: 20 },
  { key: "hHebdo", label: "H.Hebdo", pdfHeader: "H.Hebdo", pdfWidth: 14, pdfAlign: "center" },
  { key: "hMens", label: "H.Mens.", pdfHeader: "H.Mens.", pdfWidth: 14, pdfAlign: "center" },
  { key: "debutContrat", label: "Début contrat", pdfHeader: "Début contrat", pdfWidth: 18 },
  { key: "finContrat", label: "Fin contrat", pdfHeader: "Fin contrat", pdfWidth: 18 },
  { key: "cpDebut", label: "CP Début", pdfHeader: "CP Début", pdfWidth: 16 },
  { key: "cpFin", label: "CP Fin", pdfHeader: "CP Fin", pdfWidth: 16 },
  { key: "absDebut", label: "Abs. Début", pdfHeader: "Abs. Début", pdfWidth: 16 },
  { key: "absFin", label: "Abs. Fin", pdfHeader: "Abs. Fin", pdfWidth: 16 },
  { key: "amDebut", label: "AM Début", pdfHeader: "AM Début", pdfWidth: 16 },
  { key: "amFin", label: "AM Fin", pdfHeader: "AM Fin", pdfWidth: 16 },
  { key: "navigo", label: "Navigo", pdfHeader: "Navigo", pdfWidth: 12, pdfAlign: "center" },
  { key: "diversAmount", label: "Divers €", pdfHeader: "Divers €", pdfWidth: 16 },
  { key: "diversNature", label: "Divers Nature", pdfHeader: "Divers Nature", pdfWidth: 20 },
  { key: "remarque", label: "Remarque", pdfHeader: "Remarque", pdfWidth: 24 },
];
