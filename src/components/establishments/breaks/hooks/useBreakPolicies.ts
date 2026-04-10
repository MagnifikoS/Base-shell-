import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BreakPolicyRecord } from "../types/breakPolicy.types";

export function useBreakPolicies(establishmentId: string | null) {
  return useQuery({
    queryKey: ["break-policies", establishmentId],
    queryFn: async (): Promise<BreakPolicyRecord[]> => {
      if (!establishmentId) return [];

      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("establishment-breaks", {
        body: {
          action: "list",
          establishment_id: establishmentId,
        },
      });

      if (response.error) throw new Error(response.error.message);
      if (response.data.error) throw new Error(response.data.error);

      return response.data.policies || [];
    },
    enabled: !!establishmentId,
    staleTime: 60000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
