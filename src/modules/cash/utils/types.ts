/**
 * Type definitions for Cash Module
 */

export interface CashDayReport {
  id: string;
  establishment_id: string;
  day_date: string; // YYYY-MM-DD
  cb_eur: number;
  cash_eur: number;
  delivery_eur: number;
  courses_eur: number;
  maintenance_eur: number;
  shortage_eur: number;
  total_eur: number;
  advance_eur: number;
  advance_employee_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface CashDayFormValues {
  cb_eur: number;
  cash_eur: number;
  delivery_eur: number;
  courses_eur: number;
  maintenance_eur: number;
  shortage_eur: number;
  advance_eur: number;
  advance_employee_id: string | null;
  note: string;
}

export const DEFAULT_FORM_VALUES: CashDayFormValues = {
  cb_eur: 0,
  cash_eur: 0,
  delivery_eur: 0,
  courses_eur: 0,
  maintenance_eur: 0,
  shortage_eur: 0,
  advance_eur: 0,
  advance_employee_id: null,
  note: '',
};

/** Wizard-only values (subset for quick entry) */
export interface CashWizardValues {
  cb_eur: number;
  cash_eur: number;
  delivery_eur: number;
  courses_eur: number;
  maintenance_eur: number;
  advance_eur: number;
  advance_employee_id: string | null;
}

export const DEFAULT_WIZARD_VALUES: CashWizardValues = {
  cb_eur: 0,
  cash_eur: 0,
  delivery_eur: 0,
  courses_eur: 0,
  maintenance_eur: 0,
  advance_eur: 0,
  advance_employee_id: null,
};

export type WizardStep = 'cb' | 'cash' | 'delivery' | 'expenses' | 'advance' | 'summary';

export const WIZARD_STEPS: WizardStep[] = ['cb', 'cash', 'delivery', 'expenses', 'advance', 'summary'];

export type CashPermissionLevel = 'none' | 'caisse_day' | 'caisse_month' | 'admin';
