/**
 * PAYROLL PREP MODULE — État préparatoire du mois
 * 
 * Module autonome et démontable.
 * Suppression : rm -rf src/modules/payrollPrep + retirer import dans Payroll.tsx
 */

export { PayrollPrepButton } from "./PayrollPrepButton";
export { PayrollPrepModal } from "./PayrollPrepModal";
export { PayrollPrepTable } from "./PayrollPrepTable";
export { usePayrollPrepData } from "./hooks/usePayrollPrepData";
export type { PayrollPrepEmployee } from "./hooks/usePayrollPrepData";
export type { EmployeeLocalEdits, LocalEditsState } from "./types";
