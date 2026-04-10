import { z } from "zod";
import { emailSchema, passwordSchema } from "./common";

/** Login form schema */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Le mot de passe est requis"),
});

/** Password reset request schema */
export const resetPasswordSchema = z.object({
  email: emailSchema,
});

/** Bootstrap (first admin creation) schema */
export const bootstrapSchema = z.object({
  organizationName: z
    .string()
    .min(1, "Le nom de l'organisation est requis")
    .max(100, "100 caractères maximum"),
  fullName: z.string().min(1, "Le nom complet est requis").max(100, "100 caractères maximum"),
  email: emailSchema,
  password: passwordSchema,
});

/** Invite acceptance schema */
export const inviteSchema = z
  .object({
    fullName: z.string().min(1, "Le nom complet est requis").max(100, "100 caractères maximum"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Veuillez confirmer le mot de passe"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

export type LoginFormData = z.infer<typeof loginSchema>;
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;
export type BootstrapFormData = z.infer<typeof bootstrapSchema>;
export type InviteFormData = z.infer<typeof inviteSchema>;
