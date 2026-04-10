/**
 * ═══════════════════════════════════════════════════════════════════════════
 * usePlatformAdmin — P0 Super Admin Plateforme
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hook dédié pour vérifier si l'utilisateur est un Super Admin Plateforme.
 *
 * IMPORTANT:
 *   - Totalement indépendant de usePermissions()
 *   - Totalement indépendant de useEstablishment()
 *   - Appelle directement la RPC is_platform_admin()
 *   - Ne modifie aucun comportement existant
 *
 * QUERY KEY: ["platform-admin", userId]
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePlatformAdmin() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data: isPlatformAdmin, isLoading } = useQuery({
    queryKey: ["platform-admin", userId],
    queryFn: async () => {
      if (!userId) return false;

      const { data, error } = await supabase.rpc("is_platform_admin", {
        _user_id: userId,
      });

      if (error) {
        console.error("[usePlatformAdmin] RPC error:", error.message);
        return false;
      }

      return data === true;
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000, // 10 min — platform admin status rarely changes
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    isPlatformAdmin: isPlatformAdmin ?? false,
    isLoading,
  };
}
