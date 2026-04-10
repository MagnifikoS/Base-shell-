import { z } from "zod";
import { emailSchema, phoneSchema } from "./common";

const SUPPLIER_TYPES = ["grossiste", "producteur", "importateur", "autre"] as const;

/**
 * Supplier creation/edit schema.
 * Matches SupplierInput from fournisseurs/services/supplierService.ts
 */
export const supplierSchema = z.object({
  name: z.string().min(1, "La raison sociale est requise").max(200, "200 caractères maximum"),
  trade_name: z.string().max(200, "200 caractères maximum").nullable().optional(),
  supplier_type: z
    .enum(SUPPLIER_TYPES, { message: "Type de fournisseur invalide" })
    .nullable()
    .optional(),
  siret: z
    .string()
    .refine((val) => !val || /^\d{14}$/.test(val.replace(/\s/g, "")), {
      message: "Le SIRET doit contenir 14 chiffres",
    })
    .nullable()
    .optional(),
  vat_number: z
    .string()
    .refine(
      (val) => !val || /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(val.replace(/\s/g, "").toUpperCase()),
      {
        message: "Format de numéro TVA invalide (ex: FR12345678901)",
      }
    )
    .nullable()
    .optional(),
  internal_code: z.string().max(50, "50 caractères maximum").nullable().optional(),
  contact_name: z.string().max(200, "200 caractères maximum").nullable().optional(),
  contact_email: emailSchema.optional().or(z.literal("")).or(z.null()),
  contact_phone: phoneSchema.or(z.null()).optional(),
  notes: z.string().max(2000, "2000 caractères maximum").nullable().optional(),
  billing_address: z.string().max(500, "500 caractères maximum").nullable().optional(),
  address_line2: z.string().max(500, "500 caractères maximum").nullable().optional(),
  postal_code: z
    .string()
    .refine((val) => !val || /^\d{5}$/.test(val), {
      message: "Le code postal doit contenir 5 chiffres",
    })
    .nullable()
    .optional(),
  city: z.string().max(100, "100 caractères maximum").nullable().optional(),
  country: z.string().max(100, "100 caractères maximum").nullable().optional(),
  payment_terms: z.string().max(200, "200 caractères maximum").nullable().optional(),
  payment_delay_days: z
    .number()
    .int("Le délai doit être un nombre entier")
    .min(0, "Le délai ne peut pas être négatif")
    .max(365, "365 jours maximum")
    .nullable()
    .optional(),
  payment_method: z.string().max(100, "100 caractères maximum").nullable().optional(),
  currency: z.string().max(3, "3 caractères maximum").nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

export type SupplierFormData = z.infer<typeof supplierSchema>;
