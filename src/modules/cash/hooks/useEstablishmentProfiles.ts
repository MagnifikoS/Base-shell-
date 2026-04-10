/**
 * Hook to fetch profiles for the current establishment's organization.
 * Used in the cash wizard to pick an employee for advance.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

interface ProfileOption {
  user_id: string;
  full_name: string | null;
  email: string;
}

export function useEstablishmentProfiles() {
  const { activeEstablishment } = useEstablishment();
  const orgId = activeEstablishment?.organization_id ?? null;

  return useQuery({
    queryKey: ["profiles-for-advance", orgId],
    queryFn: async (): Promise<ProfileOption[]> => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("full_name", { ascending: true });

      if (error) {
        if (import.meta.env.DEV) console.error("Error fetching profiles:", error);
        throw error;
      }

      return (data ?? []) as ProfileOption[];
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
