/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Roles & Permissions — Data hooks and mutations
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from RolesPermissionsManager.tsx for file size compliance.
 * Contains: queries, mutations, types, constants.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  type: string;
  organization_id: string | null;
  user_count: number;
  created_at: string;
}

export interface Permission {
  role_id: string;
  module_key: string;
  access_level: string;
  scope: string;
  module?: {
    key: string;
    name: string;
    display_order: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Access levels for dropdown - "full" mapped to "Écriture" for display compatibility
export const ACCESS_LEVELS = [
  { value: "none", label: "Aucun" },
  { value: "read", label: "Lecture" },
  { value: "write", label: "Écriture" },
];

// Helper to get display label for access level (handles legacy "full" values)
export const getAccessLevelLabel = (value: string): string => {
  if (value === "full") return "Écriture"; // Legacy compatibility
  return ACCESS_LEVELS.find((al) => al.value === value)?.label || value;
};

export const SCOPES = [
  { value: "self", label: "Soi-même" },
  { value: "team", label: "Équipe" },
  { value: "establishment", label: "Établissement" },
  { value: "org", label: "Organisation" },
];

// Scopes spécifiques au module caisse
export const CAISSE_SCOPES = [
  { value: "caisse_day", label: "Caisse jour" },
  { value: "caisse_month", label: "Caisse mois" },
];

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

export function useRoles() {
  return useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });
      if (response.error) throw response.error;
      return response.data.roles as Role[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

export function useRolePermissions(selectedRoleId: string | null) {
  return useQuery({
    queryKey: ["admin-role-permissions", selectedRoleId],
    queryFn: async () => {
      if (!selectedRoleId) return [];
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "get_role_permissions", role_id: selectedRoleId },
      });
      if (response.error) throw response.error;
      return response.data.permissions as Permission[];
    },
    enabled: !!selectedRoleId,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "create_custom_role", name },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      toast.success("Rôle créé avec succès");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la création");
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ roleId, name }: { roleId: string; name: string }) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "update_role", role_id: roleId, name },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      toast.success("Rôle mis à jour");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la mise à jour");
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      roleId,
      replacementRoleId,
    }: {
      roleId: string;
      replacementRoleId?: string;
    }) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "delete_role", role_id: roleId, replacement_role_id: replacementRoleId },
      });

      let data: Record<string, unknown> | null = response.data;
      if (!data && response.error) {
        try {
          const errWithCtx = response.error as unknown as { context?: { response?: Response } };
          const ctxResp = errWithCtx?.context?.response;
          if (ctxResp) data = await ctxResp.json();
        } catch {
          // ignore
        }
      }

      if (data?.requires_replacement) {
        return {
          __requiresReplacement: true as const,
          user_count: (data.user_count as number) || 0,
          invitation_count: (data.invitation_count as number) || 0,
          message: data.error as string | undefined,
        };
      }

      if (!response.error && !data?.error) {
        return { success: true as const };
      }

      return {
        __error: true as const,
        message:
          (data?.error as string) ||
          (response.error as Error)?.message ||
          "Erreur lors de la suppression",
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
    },
  });
}

export function useDeleteCancelInvitations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { role_id: string }) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "delete_role_with_cancel_invitations", role_id: payload.role_id },
      });

      let data: Record<string, unknown> | null = response.data;
      if (!data && response.error) {
        try {
          const errWithCtx = response.error as unknown as { context?: { response?: Response } };
          const ctxResp = errWithCtx?.context?.response;
          if (ctxResp) data = await ctxResp.json();
        } catch {
          // ignore
        }
      }

      if (response.error || data?.error) {
        return {
          __error: true as const,
          message:
            (data?.error as string) ||
            (response.error as Error)?.message ||
            "Erreur lors de la suppression",
        };
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
    },
  });
}

export function useSavePermissions(selectedRoleId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (perms: Permission[]) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: {
          action: "set_role_permissions",
          role_id: selectedRoleId,
          permissions: perms.map((p) => ({
            module_key: p.module_key,
            access_level: p.access_level,
            scope: p.scope,
          })),
        },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-role-permissions", selectedRoleId] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
      toast.success("Permissions mises à jour");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la sauvegarde");
    },
  });
}
