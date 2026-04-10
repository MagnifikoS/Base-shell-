import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { Database } from "@/integrations/supabase/types";

type AccessLevel = Database["public"]["Enums"]["access_level"];
type PermissionScope = Database["public"]["Enums"]["permission_scope"];

interface RpcPermissionV2 {
  module_key: string;
  access_level: AccessLevel;
  scope: PermissionScope;
}

interface RpcResponseV2 {
  is_admin: boolean;
  permissions: RpcPermissionV2[];
  team_ids: string[];
  establishment_ids: string[];
}

export interface PermissionsDataV2 {
  isAdmin: boolean;
  permissions: RpcPermissionV2[];
  teamIds: string[];
  establishmentIds: string[];
}

/**
 * usePermissionsShadowV2
 *
 * V2 permissions hook using get_my_permissions_v2(_establishment_id).
 * Protected by an `enabled` guard to prevent unnecessary network calls.
 *
 * QUERY KEY: ["my-permissions-v2", userId, establishmentId]
 */
export function usePermissionsShadowV2(options?: { enabled?: boolean }) {
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();

  const userId = user?.id ?? null;
  const establishmentId = activeEstablishment?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-permissions-v2", userId, establishmentId],
    queryFn: async () => {
      if (!establishmentId) throw new Error("establishmentId is required for V2");

      const { data, error } = await supabase.rpc("get_my_permissions_v2", {
        _establishment_id: establishmentId,
      });

      if (error) throw error;

      const rpcData = data as unknown as RpcResponseV2;

      return {
        isAdmin: rpcData.is_admin,
        permissions: rpcData.permissions || [],
        teamIds: rpcData.team_ids || [],
        establishmentIds: rpcData.establishment_ids || [],
      } as PermissionsDataV2;
    },
    // Protected by enabled: only calls if explicitly enabled
    enabled: !!userId && !!establishmentId && options?.enabled === true,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — permissions rarely change mid-session
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    placeholderData: (prev) => prev,
  });

  return {
    data: data as PermissionsDataV2 | undefined,
    isLoading,
    error,
    userId,
    establishmentId,
  };
}
