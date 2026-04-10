import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmployeeListItem } from "../types/employee.types";

interface UseArchivedEmployeesOptions {
  establishmentId: string | null;
  enabled?: boolean;
}

export function useArchivedEmployees({ establishmentId, enabled = true }: UseArchivedEmployeesOptions) {
  return useQuery({
    queryKey: ["archived-employees", establishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("employee-archives", {
        body: {
          action: "list_archived",
          establishment_id: establishmentId || undefined,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.employees as EmployeeListItem[];
    },
    enabled,
    staleTime: 60000, // 60s - rule R0.4
    refetchOnWindowFocus: false, // rule R0.4
    retry: false, // rule R0.4
  });
}
