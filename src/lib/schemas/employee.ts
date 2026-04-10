import { z } from "zod";

// French IBAN: FR + 2 check digits + 23 alphanumeric characters
const ibanRegex = /^FR\d{2}[A-Z0-9]{23}$/;

// French SSN: 1 or 2 (sex) + 2 (year) + 2 (month) + 2 (dept) + 3 (commune) + 3 (order) + 2 (key) = 15 digits
const ssnRegex = /^[12]\d{2}(0[1-9]|1[0-2])\d{2}\d{3}\d{3}\d{2}$/;

export const employeeSchema = z.object({
  first_name: z.string().min(1, "Le prénom est requis").max(100),
  last_name: z.string().min(1, "Le nom est requis").max(100),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  phone: z.string().optional(),
  role: z.string().min(1, "Le rôle est requis"),
  contract_type: z.string().optional(),
  hourly_rate: z.number().min(0, "Le taux horaire doit être positif").optional(),
  weekly_hours: z.number().min(0).max(70, "Maximum 70h/semaine").optional(),
});

export const employeeSensitiveSchema = z.object({
  iban: z
    .string()
    .regex(ibanRegex, "Format IBAN invalide (ex: FR7612345...)")
    .optional()
    .or(z.literal("")),
  ssn: z.string().regex(ssnRegex, "Format N° SS invalide").optional().or(z.literal("")),
});

/**
 * Validation schema for the employee details form (EmployeeInfoTab + EmployeeContractTab).
 * Matches the EmployeeFormData type from employee.types.ts.
 * Fields are nullable to match the existing form data model.
 */
export const employeeDetailsSchema = z
  .object({
    phone: z.string().nullable().optional(),
    address: z
      .string()
      .max(500, "L'adresse ne doit pas dépasser 500 caractères")
      .nullable()
      .optional(),
    position: z
      .string()
      .max(100, "Le poste ne doit pas dépasser 100 caractères")
      .nullable()
      .optional(),
    id_type: z.string().nullable().optional(),
    id_issue_date: z.string().nullable().optional(),
    id_expiry_date: z.string().nullable().optional(),
    social_security_number: z
      .string()
      .refine((val) => !val || ssnRegex.test(val.replace(/\s/g, "")), {
        message: "Format N° SS invalide (ex: 1 85 01 75 123 456 20)",
      })
      .nullable()
      .optional(),
    iban: z
      .string()
      .refine((val) => !val || ibanRegex.test(val.replace(/\s/g, "").toUpperCase()), {
        message: "Format IBAN invalide (ex: FR7612345...)",
      })
      .nullable()
      .optional(),
    contract_type: z.string().nullable().optional(),
    contract_start_date: z.string().nullable().optional(),
    contract_hours: z
      .number()
      .min(0, "Les heures contractuelles doivent être positives")
      .max(70, "Maximum 70h/semaine")
      .nullable()
      .optional(),
    gross_salary: z.number().min(0, "Le salaire brut doit être positif").nullable().optional(),
    net_salary: z.number().min(0, "Le salaire net doit être positif").nullable().optional(),
    contract_end_date: z.string().nullable().optional(),
    second_first_name: z.string().max(100).nullable().optional(),
    cp_n1: z.number().min(0, "Les CP N-1 doivent être positifs").nullable().optional(),
    cp_n: z.number().min(0, "Les CP N doivent être positifs").nullable().optional(),
    total_salary: z.number().min(0, "Le salaire total doit être positif").nullable().optional(),
    has_navigo_pass: z.boolean().optional(),
    navigo_pass_number: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      // Cross-field: if net_salary and gross_salary are both set, net <= gross
      if (data.net_salary != null && data.gross_salary != null) {
        return data.net_salary <= data.gross_salary;
      }
      return true;
    },
    { message: "Le salaire net ne peut pas dépasser le salaire brut", path: ["net_salary"] }
  )
  .refine(
    (data) => {
      // Cross-field: if total_salary and net_salary are both set, total >= net
      if (data.total_salary != null && data.net_salary != null) {
        return data.total_salary >= data.net_salary;
      }
      return true;
    },
    {
      message: "Le salaire total doit être supérieur ou égal au salaire net",
      path: ["total_salary"],
    }
  );

export type EmployeeFormData = z.infer<typeof employeeSchema>;
export type EmployeeSensitiveData = z.infer<typeof employeeSensitiveSchema>;
export type EmployeeDetailsFormData = z.infer<typeof employeeDetailsSchema>;
