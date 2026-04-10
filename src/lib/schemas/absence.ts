import { z } from "zod";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Absence declaration schema.
 * Matches AbsenceDeclaration from congesAbsences/types.ts
 */
export const absenceDeclarationSchema = z
  .object({
    date_start: z.string().regex(DATE_REGEX, "Format de date invalide (AAAA-MM-JJ)"),
    date_end: z.string().regex(DATE_REGEX, "Format de date invalide (AAAA-MM-JJ)"),
    motif_type: z.enum(["maladie", "cp", "autre"], {
      message: "Le motif est requis",
    }),
    motif_detail: z.string().max(500, "500 caractères maximum").optional(),
  })
  .refine((data) => data.date_end >= data.date_start, {
    message: "La date de fin doit être après la date de début",
    path: ["date_end"],
  })
  .refine(
    (data) => {
      if (data.motif_type === "autre") {
        return !!data.motif_detail?.trim();
      }
      return true;
    },
    {
      message: "Veuillez préciser le motif",
      path: ["motif_detail"],
    }
  );

export type AbsenceDeclarationFormData = z.infer<typeof absenceDeclarationSchema>;
