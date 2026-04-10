// Types for employee module - single source of truth
export interface EmployeeDetails {
  phone: string | null;
  address: string | null;
  position: string | null;
  id_type: string | null;
  id_issue_date: string | null;
  id_expiry_date: string | null;
  social_security_number: string | null;
  ssn_last2: string | null;
  iban: string | null;
  iban_last4: string | null;
  contract_type: string | null;
  contract_start_date: string | null;
  contract_hours: number | null;
  gross_salary: number | null;
  net_salary: number | null;
  contract_end_date: string | null;
  /** CP N-1 : reliquat année précédente (transitoire) */
  cp_n1: number | null;
  /** CP N : droits année en cours (transitoire) */
  cp_n: number | null;
  /** Salaire total mensuel (net + espèces). Saisi manuellement. SSOT. */
  total_salary: number | null;
  /** Whether employee has a Navigo pass */
  has_navigo_pass: boolean;
  /** Navigo pass number (optional) */
  navigo_pass_number: string | null;
}

export interface Employee {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  second_first_name?: string | null;
  status: string;
  role: { id: string; name: string } | null;
  establishments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  details: EmployeeDetails | null;
}

export interface EmployeeListItem {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: string;
  created_at: string;
  establishments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
}

export interface EmployeeFormData {
  phone: string | null;
  address: string | null;
  position: string | null;
  id_type: string | null;
  id_issue_date: string | null;
  id_expiry_date: string | null;
  social_security_number: string | null;
  iban: string | null;
  contract_type: string | null;
  contract_start_date: string | null;
  contract_hours: number | null;
  gross_salary: number | null;
  net_salary: number | null;
  contract_end_date: string | null;
  second_first_name?: string | null;
  /** CP N-1 : reliquat année précédente (transitoire) */
  cp_n1: number | null;
  /** CP N : droits année en cours (transitoire) */
  cp_n: number | null;
  /** Salaire total mensuel (net + espèces). Saisi manuellement. */
  total_salary: number | null;
  /** Whether employee has a Navigo pass */
  has_navigo_pass: boolean;
  /** Navigo pass number (optional) */
  navigo_pass_number: string | null;
}

// Constants
export const CONTRACT_TYPES = [
  { value: "CDI", label: "CDI" },
  { value: "CDD", label: "CDD" },
  { value: "interim", label: "Intérim" },
  { value: "apprenticeship", label: "Apprentissage" },
  { value: "internship", label: "Stage" },
] as const;

export const ID_TYPES = [
  { value: "national_id", label: "Carte d'identité" },
  { value: "passport", label: "Passeport" },
  { value: "driver_license", label: "Permis de conduire" },
  { value: "residence_permit", label: "Titre de séjour" },
] as const;

// Helpers
export function maskIban(last4: string | null): string {
  if (!last4) return "Non renseigné";
  return `**** **** **** ${last4}`;
}

export function maskSsn(last2: string | null): string {
  if (!last2) return "Non renseigné";
  return `*************${last2}`;
}

export const INITIAL_FORM_DATA: EmployeeFormData = {
  phone: null,
  address: null,
  position: null,
  id_type: null,
  id_issue_date: null,
  id_expiry_date: null,
  social_security_number: null,
  iban: null,
  contract_type: null,
  contract_start_date: null,
  contract_hours: null,
  gross_salary: null,
  net_salary: null,
  contract_end_date: null,
  second_first_name: null,
  cp_n1: null,
  cp_n: null,
  total_salary: null,
  has_navigo_pass: false,
  navigo_pass_number: null,
};
