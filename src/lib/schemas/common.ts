import { z } from "zod";

export const pinSchema = z
  .string()
  .length(4, "Le code PIN doit contenir 4 chiffres")
  .regex(/^\d{4}$/, "Le code PIN ne doit contenir que des chiffres");

export const emailSchema = z.string().email("Adresse email invalide");

export const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères")
  .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule")
  .regex(/[a-z]/, "Le mot de passe doit contenir au moins une minuscule")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre")
  .regex(
    /[!@#$%^&*()_+\-=]/,
    "Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*()_+-=)"
  );

/** Individual password criteria for the strength indicator */
export const PASSWORD_CRITERIA = [
  { regex: /.{8,}/, label: "Au moins 8 caractères" },
  { regex: /[A-Z]/, label: "Au moins une majuscule" },
  { regex: /[a-z]/, label: "Au moins une minuscule" },
  { regex: /[0-9]/, label: "Au moins un chiffre" },
  { regex: /[!@#$%^&*()_+\-=]/, label: "Au moins un caractère spécial (!@#$%^&*()_+-=)" },
] as const;

export const phoneSchema = z
  .string()
  .regex(/^(\+33|0)[1-9]\d{8}$/, "Numéro de téléphone invalide")
  .optional()
  .or(z.literal(""));
