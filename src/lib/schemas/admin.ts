import { z } from "zod";
import { emailSchema } from "./common";

/** Role creation schema */
export const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Le nom du role est requis")
    .max(50, "50 caracteres maximum")
    .regex(/^[a-zA-ZÀ-ÿ0-9\s\-_]+$/, "Caracteres speciaux non autorises"),
});

/** Role name edit schema */
export const editRoleNameSchema = z.object({
  name: z
    .string()
    .min(1, "Le nom du role est requis")
    .max(50, "50 caracteres maximum")
    .regex(/^[a-zA-ZÀ-ÿ0-9\s\-_]+$/, "Caracteres speciaux non autorises"),
});

/** Timepoint break rule schema */
export const timepointRuleSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/, "Format d'heure invalide"),
  break_minutes: z.number().min(0, "La duree doit etre positive").max(120, "120 minutes maximum"),
});

/** Timepoint break policy schema (array of rules) */
export const timepointPolicySchema = z
  .object({
    rules: z.array(timepointRuleSchema).min(1, "Au moins une regle est requise"),
  })
  .refine(
    (data) => {
      const times = data.rules.map((r) => r.time);
      return new Set(times).size === times.length;
    },
    { message: "Heures en doublon detectees", path: ["rules"] }
  );

/** Invitation creation schema */
export const invitationSchema = z.object({
  email: emailSchema,
  establishment_ids: z
    .array(z.string().uuid("ID d'établissement invalide"))
    .min(1, "Au moins un établissement est requis"),
  /** Per-establishment role/team assignments, keyed by establishment ID */
  assignments: z.record(
    z.string().uuid(),
    z.object({
      role_id: z.string().uuid("Le rôle est requis"),
      team_id: z.string().uuid("L'équipe est requise"),
    })
  ),
});

/** Test user creation schema */
export const testUserSchema = z.object({
  email: emailSchema,
  full_name: z.string().min(1, "Le nom complet est requis").max(100, "100 caractères maximum"),
  role_id: z.string().uuid("Le rôle est requis"),
  team_id: z.string().uuid("L'équipe est requise"),
  establishment_id: z.string().uuid("L'établissement est requis"),
});

/** Team creation schema */
export const createTeamSchema = z.object({
  name: z
    .string()
    .min(1, "Le nom de l'équipe est requis")
    .max(100, "100 caractères maximum")
    .regex(/^[a-zA-ZÀ-ÿ0-9\s\-_']+$/, "Caractères spéciaux non autorisés"),
  description: z.string().max(500, "500 caractères maximum").optional().or(z.literal("")),
});

export type CreateRoleFormData = z.infer<typeof createRoleSchema>;
export type EditRoleNameFormData = z.infer<typeof editRoleNameSchema>;
export type TimepointRuleFormData = z.infer<typeof timepointRuleSchema>;
export type TimepointPolicyFormData = z.infer<typeof timepointPolicySchema>;
export type InvitationFormData = z.infer<typeof invitationSchema>;
export type TestUserFormData = z.infer<typeof testUserSchema>;
export type CreateTeamFormData = z.infer<typeof createTeamSchema>;

/** Direct user creation schema (flat payload for admin-invitations edge function) */
export const createUserSchema = z.object({
  email: emailSchema,
  role_id: z.string().uuid("Le rôle est requis"),
  team_id: z.string().uuid("L'équipe est requise"),
  establishment_id: z.string().uuid("L'établissement est requis"),
});

export type CreateUserFormData = z.infer<typeof createUserSchema>;
