import { useState, useEffect, useCallback } from "react";
import type { Employee, EmployeeFormData } from "../types/employee.types";
import { INITIAL_FORM_DATA } from "../types/employee.types";
import { employeeDetailsSchema } from "@/lib/schemas/employee";
import type { ZodError } from "zod";

interface UseEmployeeFormOptions {
  employee: Employee | null | undefined;
}

/** Field-level validation errors keyed by field name */
export type FormFieldErrors = Record<string, string | undefined>;

export function useEmployeeForm({ employee }: UseEmployeeFormOptions) {
  const [formData, setFormData] = useState<EmployeeFormData>(INITIAL_FORM_DATA);
  const [hasChanges, setHasChanges] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});

  // Sensitive field state
  const [showIban, setShowIban] = useState(false);
  const [showSsn, setShowSsn] = useState(false);
  const [ibanLast4, setIbanLast4] = useState<string | null>(null);
  const [ssnLast2, setSsnLast2] = useState<string | null>(null);
  const [ibanEdited, setIbanEdited] = useState(false);
  const [ssnEdited, setSsnEdited] = useState(false);

  // Initialize form when employee data loads
  useEffect(() => {
    if (employee?.details) {
      setFormData({
        phone: employee.details.phone || null,
        address: employee.details.address || null,
        position: employee.details.position || null,
        id_type: employee.details.id_type || null,
        id_issue_date: employee.details.id_issue_date || null,
        id_expiry_date: employee.details.id_expiry_date || null,
        social_security_number: employee.details.social_security_number || null,
        iban: employee.details.iban || null,
        contract_type: employee.details.contract_type || null,
        contract_start_date: employee.details.contract_start_date || null,
        contract_hours: employee.details.contract_hours || null,
        gross_salary: employee.details.gross_salary || null,
        net_salary: employee.details.net_salary || null,
        contract_end_date: employee.details.contract_end_date || null,
        second_first_name: employee.second_first_name || null,
        cp_n1: employee.details.cp_n1 ?? null,
        cp_n: employee.details.cp_n ?? null,
        total_salary: employee.details.total_salary ?? null,
        has_navigo_pass: employee.details.has_navigo_pass ?? false,
        navigo_pass_number: employee.details.navigo_pass_number ?? null,
      });
      setIbanLast4(employee.details.iban_last4 || null);
      setSsnLast2(employee.details.ssn_last2 || null);
      resetEditState();
    } else if (employee) {
      // Reset form for employee without details
      setFormData({
        ...INITIAL_FORM_DATA,
        second_first_name: employee.second_first_name || null,
      });
      setIbanLast4(null);
      setSsnLast2(null);
      resetEditState();
    }
  }, [employee]);

  const resetEditState = () => {
    setHasChanges(false);
    setIbanEdited(false);
    setSsnEdited(false);
    setShowIban(false);
    setShowSsn(false);
  };

  const updateField = (field: keyof EmployeeFormData, value: string | number | boolean | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const updateSensitiveField = (field: "social_security_number" | "iban", value: string | null) => {
    if (field === "social_security_number") {
      setSsnEdited(true);
    } else {
      setIbanEdited(true);
    }
    updateField(field, value);
  };

  const onSaveSuccess = () => {
    setHasChanges(false);
    setIbanEdited(false);
    setSsnEdited(false);
    setFieldErrors({});
  };

  /**
   * Validate formData using zod schema before saving.
   * Returns true if valid, false if there are errors.
   * Populates fieldErrors with per-field messages.
   */
  const validateForm = useCallback((): boolean => {
    const result = employeeDetailsSchema.safeParse(formData);
    if (result.success) {
      setFieldErrors({});
      return true;
    }
    // Map ZodError issues to field-level errors
    const errors: FormFieldErrors = {};
    (result.error as ZodError).issues.forEach((issue) => {
      const fieldName = issue.path.join(".");
      // Keep only the first error per field
      if (!errors[fieldName]) {
        errors[fieldName] = issue.message;
      }
    });
    setFieldErrors(errors);
    return false;
  }, [formData]);

  /** Clear a specific field error (useful when user edits a field) */
  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  // Check if we have the full decrypted value (admin) or just masked (non-admin)
  const hasFullIban = !!employee?.details?.iban;
  const hasFullSsn = !!employee?.details?.social_security_number;

  return {
    formData,
    hasChanges,
    fieldErrors,
    updateField,
    updateSensitiveField,
    onSaveSuccess,
    validateForm,
    clearFieldError,
    // Sensitive field state
    showIban,
    setShowIban,
    showSsn,
    setShowSsn,
    ibanLast4,
    ssnLast2,
    ibanEdited,
    ssnEdited,
    hasFullIban,
    hasFullSsn,
  };
}
