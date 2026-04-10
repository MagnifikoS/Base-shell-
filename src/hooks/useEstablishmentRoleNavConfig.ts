/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useEstablishmentRoleNavConfig — Per-role nav visibility (UNION merge)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reads establishment_role_nav_config keyed by (establishment_id, role_id).
 *
 * For consumers (MobileHome / BottomNav / InventoryTypeSelector):
 *   hiddenIdsMerged = INTERSECTION of hidden_ids across user's roles
 *   → item hidden only if ALL roles hide it (UNION visibility)
 *
 * For admin (MobileNavConfig):
 *   getRoleHiddenIds(roleId)  → read one role's config
 *   setRoleHiddenIds(roleId, ids) → write one role's config
 *
 * Fallback: if no config rows found → hiddenIds = [] (everything visible)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { MobileNavPrefs } from "@/lib/mobileNavPrefs";

const QUERY_KEY = "establishment-role-nav-config";
const USER_ROLES_KEY = "user-roles-for-nav";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RoleNavRow {
  role_id: string;
  hidden_ids: string[];
}

// ─── Internal: fetch user's role_ids for an establishment ────────────────────

function useUserRoleIds(establishmentId: string | null) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: [USER_ROLES_KEY, userId, establishmentId],
    queryFn: async (): Promise<string[]> => {
      if (!userId || !establishmentId) return [];

      const { data, error } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", userId)
        .eq("establishment_id", establishmentId);

      if (error) {
        if (import.meta.env.DEV) console.error("[RoleNavConfig] fetch user roles error", error);
        return [];
      }

      return (data ?? []).map((r) => r.role_id);
    },
    enabled: !!userId && !!establishmentId,
    staleTime: 120_000,
  });
}

// ─── Internal: fetch all role configs for an establishment ───────────────────

function useAllRoleConfigs(establishmentId: string | null) {
  return useQuery({
    queryKey: [QUERY_KEY, establishmentId],
    queryFn: async (): Promise<RoleNavRow[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase
        .from("establishment_role_nav_config")
        .select("role_id, hidden_ids")
        .eq("establishment_id", establishmentId);

      if (error) {
        if (import.meta.env.DEV) console.error("[RoleNavConfig] read error", error);
        return [];
      }

      return (data ?? []).map((row) => ({
        role_id: row.role_id,
        hidden_ids: row.hidden_ids ?? [],
      }));
    },
    enabled: !!establishmentId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

// ─── Public: Consumer hook (merged prefs for current user) ───────────────────

/**
 * Returns merged hiddenIds for the current user across all their roles.
 * UNION visibility: item hidden only if ALL roles hide it.
 */
export function useEstablishmentRoleNavConfig(establishmentId: string | null) {
  const { data: roleIds = [], isLoading: rolesLoading } = useUserRoleIds(establishmentId);
  const { data: allConfigs = [], isLoading: configsLoading } = useAllRoleConfigs(establishmentId);

  const isLoading = rolesLoading || configsLoading;

  // Compute INTERSECTION of hidden_ids across user's roles
  let hiddenIdsMerged: string[] = [];

  if (!isLoading && roleIds.length > 0 && allConfigs.length > 0) {
    // Get configs for user's roles only
    const userConfigs = allConfigs.filter((c) => roleIds.includes(c.role_id));

    if (userConfigs.length > 0) {
      // Start with first role's hidden_ids, intersect with others
      hiddenIdsMerged = [...userConfigs[0].hidden_ids];
      for (let i = 1; i < userConfigs.length; i++) {
        const otherSet = new Set(userConfigs[i].hidden_ids);
        hiddenIdsMerged = hiddenIdsMerged.filter((id) => otherSet.has(id));
      }
    }
    // If no configs found for user's roles → hiddenIds = [] (all visible)
  }

  const prefs: MobileNavPrefs = { hiddenIds: hiddenIdsMerged };

  return { prefs, isLoading };
}

// ─── Public: Admin hook (read/write per role) ────────────────────────────────

/**
 * Admin hook to read hiddenIds for a specific preview role.
 */
export function useRoleNavConfigForPreview(establishmentId: string | null, roleId: string | null) {
  const { data: allConfigs = [], isLoading } = useAllRoleConfigs(establishmentId);

  const roleConfig = roleId ? allConfigs.find((c) => c.role_id === roleId) : null;

  const prefs: MobileNavPrefs = {
    hiddenIds: roleConfig?.hidden_ids ?? [],
  };

  return { prefs, isLoading };
}

/**
 * Admin mutation to write hiddenIds for a specific role.
 */
export function useRoleNavConfigMutation(establishmentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ roleId, hiddenIds }: { roleId: string; hiddenIds: string[] }) => {
      if (!establishmentId || !roleId) throw new Error("Missing params");

      const { error } = await supabase.from("establishment_role_nav_config").upsert(
        {
          establishment_id: establishmentId,
          role_id: roleId,
          hidden_ids: hiddenIds,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "establishment_id,role_id" }
      );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEY, establishmentId],
      });
    },
    onError: (error: Error) => {
      if (import.meta.env.DEV) console.error("[RoleNavConfig] upsert error", error);
    },
  });
}
