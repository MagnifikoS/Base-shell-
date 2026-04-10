import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EmployeeDocument } from "../types/employee.documents.types";

interface UseEmployeeDocumentsOptions {
  userId: string | null;
  establishmentId: string | null;
}

export function useEmployeeDocuments({ userId, establishmentId }: UseEmployeeDocumentsOptions) {
  return useQuery<EmployeeDocument[]>({
    queryKey: ["employee-documents", userId, establishmentId],
    queryFn: async () => {
      if (!userId || !establishmentId) return [];

      const { data, error } = await supabase.functions.invoke("employee-documents", {
        body: { action: "list", user_id: userId, establishment_id: establishmentId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data?.documents || [];
    },
    enabled: !!userId && !!establishmentId,
    staleTime: 60000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
