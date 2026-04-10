import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Employee } from "../types/employee.types";

interface UseEmployeeOptions {
  userId: string | null;
  enabled?: boolean;
}

export function useEmployee({ userId, enabled = true }: UseEmployeeOptions) {
  return useQuery({
    queryKey: ["employee", userId],
    queryFn: async () => {
      if (!userId) return null;

      const response = await supabase.functions.invoke("employees", {
        body: { action: "get", user_id: userId },
      });

      // Handle errors from response body
      if (response.error) {
        throw new Error(response.error.message || "Erreur de chargement");
      }
      if (response.data?.error) {
        const errorCode = response.data.code || "ERROR";
        const errorMessage = response.data.error;
        const err: Error & { code?: string } = new Error(errorMessage);
        err.code = errorCode;
        throw err;
      }
      return response.data.employee as Employee;
    },
    enabled: !!userId && enabled,
    staleTime: 60000, // 60s - rule R0.4
    refetchOnWindowFocus: false, // rule R0.4
    retry: false, // Don't retry on 403
  });
}
