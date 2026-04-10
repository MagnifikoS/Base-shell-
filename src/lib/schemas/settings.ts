import { z } from "zod";

/** Badgeuse settings schema */
export const badgeuseSettingsSchema = z.object({
  arrival_tolerance_min: z
    .number()
    .min(0, "La valeur minimale est 0")
    .max(120, "La valeur maximale est 120 minutes"),
  departure_tolerance_min: z
    .number()
    .min(0, "La valeur minimale est 0")
    .max(180, "La valeur maximale est 180 minutes"),
  early_arrival_limit_min: z
    .number()
    .min(0, "La valeur minimale est 0")
    .max(120, "La valeur maximale est 120 minutes"),
  require_pin: z.boolean(),
  require_selfie: z.boolean(),
});

/** Opening exception schema */
export const openingExceptionSchema = z
  .object({
    date: z.string().min(1, "La date est requise"),
    open_time: z.string().nullable().optional(),
    close_time: z.string().nullable().optional(),
    closed: z.boolean(),
    reason: z.string().max(200, "200 caractères maximum").optional().or(z.literal("")),
  })
  .refine(
    (data) => {
      if (!data.closed) {
        return !!data.open_time && !!data.close_time;
      }
      return true;
    },
    { message: "Les heures d'ouverture et de fermeture sont requises", path: ["open_time"] }
  );

/** Packaging format schema */
export const packagingFormatSchema = z.object({
  label: z.string().min(1, "Le libelle est requis").max(100, "100 caracteres maximum"),
  unit_id: z.string().min(1, "L'unite est requise"),
  quantity: z.number().min(1, "La quantite minimum est 1"),
  is_active: z.boolean(),
});

/** Cash day report schema */
export const cashDaySchema = z.object({
  cb_eur: z
    .number()
    .min(0, "Le montant CB ne peut pas être négatif")
    .max(999999, "Montant trop élevé"),
  cash_eur: z
    .number()
    .min(0, "Le montant espèces ne peut pas être négatif")
    .max(999999, "Montant trop élevé"),
  delivery_eur: z
    .number()
    .min(0, "Le montant livraison ne peut pas être négatif")
    .max(999999, "Montant trop élevé"),
  courses_eur: z
    .number()
    .min(0, "Le montant courses ne peut pas être négatif")
    .max(999999, "Montant trop élevé"),
  maintenance_eur: z
    .number()
    .min(0, "Le montant maintenance ne peut pas être négatif")
    .max(999999, "Montant trop élevé"),
  shortage_eur: z
    .number()
    .min(0, "Le montant manque ne peut pas être négatif")
    .max(999999, "Montant trop élevé"),
  note: z.string().max(2000, "2000 caractères maximum"),
});

/** Establishment info edit schema */
export const establishmentInfoSchema = z.object({
  trade_name: z.string().max(100, "100 caractères maximum").optional().or(z.literal("")),
  address: z.string().max(500, "500 caractères maximum").optional().or(z.literal("")),
  contact_email: z.string().email("Format d'email invalide").optional().or(z.literal("")),
});

export type BadgeuseSettingsFormData = z.infer<typeof badgeuseSettingsSchema>;
export type OpeningExceptionFormData = z.infer<typeof openingExceptionSchema>;
export type PackagingFormatFormData = z.infer<typeof packagingFormatSchema>;
export type CashDayFormData = z.infer<typeof cashDaySchema>;
export type EstablishmentInfoFormData = z.infer<typeof establishmentInfoSchema>;
