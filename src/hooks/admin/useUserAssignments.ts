/**
 * Hook to fetch scoped user assignments (roles + team) per establishment
 * ÉTAPE 50 - Source of truth for READ-ONLY display
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface EstablishmentAssignment {
  establishment_id: string;
  establishment_name: string;
  role_ids: string[];
  role_names: string[];
  team_id: string | null;
  team_name: string | null;
}

export interface UserAssignmentsResponse {
  success: boolean;
  user_id: string;
  establishments: EstablishmentAssignment[];
}

export function useUserAssignments(userId: string | null) {
  return useQuery({
    queryKey: ["user-assignments", userId],
    queryFn: async (): Promise<UserAssignmentsResponse> => {
      if (!userId) throw new Error("No user ID");

      const response = await supabase.functions.invoke("admin-manage-establishments", {
        body: { action: "get_user_assignments", user_id: userId },
      });

      if (response.error) throw response.error;
      if (response.data?.error) throw new Error(response.data.error);

      const data = response.data as UserAssignmentsResponse;

      // DEV-only log for multi-establishment QA
      if (import.meta.env.DEV && data.establishments?.length > 1) {
        // eslint-disable-next-line no-console
        console.log(
          `[USER_ASSIGNMENTS] userId=${userId} establishments=${data.establishments.length}`,
          data.establishments
        );
      }

      return data;
    },
    enabled: !!userId,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
  });
}
