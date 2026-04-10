/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useImpersonation — P0 Impersonation Hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Manages impersonation state for platform admins.
 * 
 * IMPORTANT:
 *   - Does NOT modify auth.uid() — stays as the platform admin
 *   - Does NOT bypass RLS — uses establishment context override
 *   - Does NOT touch usePermissions() internals
 *   - Purely additive: removing this hook = zero impact
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { platformStartImpersonation, platformStopImpersonation } from "@/lib/platform/rpcPlatform";

interface ImpersonationSession {
  id: string;
  target_user_id: string;
  target_establishment_id: string;
  target_role_name: string;
  started_at: string;
}

export function useImpersonation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  // Fetch active impersonation session
  const { data: session, isLoading } = useQuery({
    queryKey: ["impersonation-session", userId],
    queryFn: async (): Promise<ImpersonationSession | null> => {
      if (!userId) return null;

      const { data, error } = await supabase
        .from("platform_impersonations" as never)
        .select("id, target_user_id, target_establishment_id, target_role_name, started_at")
        .eq("platform_admin_id", userId)
        .eq("active", true)
        .limit(1)
        .maybeSingle();

      if (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error("[useImpersonation] query error:", error.message);
        }
        return null;
      }

      return data as ImpersonationSession | null;
    },
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // Start impersonation
  const startMutation = useMutation({
    mutationFn: ({ targetUserId, targetEstablishmentId }: {
      targetUserId: string;
      targetEstablishmentId: string;
    }) => platformStartImpersonation(targetUserId, targetEstablishmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["impersonation-session"] });
    },
  });

  // Stop impersonation
  const stopMutation = useMutation({
    mutationFn: () => platformStopImpersonation(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["impersonation-session"] });
    },
  });

  const startImpersonation = useCallback(
    (targetUserId: string, targetEstablishmentId: string) =>
      startMutation.mutateAsync({ targetUserId, targetEstablishmentId }),
    [startMutation]
  );

  const stopImpersonation = useCallback(
    () => stopMutation.mutateAsync(),
    [stopMutation]
  );

  return {
    isImpersonating: !!session,
    session,
    isLoading,
    startImpersonation,
    stopImpersonation,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
