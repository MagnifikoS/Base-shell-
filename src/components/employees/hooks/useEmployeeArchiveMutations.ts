import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UseEmployeeArchiveMutationsOptions {
  userId: string | null;
  /** SSOT: establishmentId from context, required for cache invalidation */
  establishmentId: string | null;
  onHardDeleteSuccess?: () => void;
}

export function useEmployeeArchiveMutations({
  userId,
  establishmentId,
  onHardDeleteSuccess,
}: UseEmployeeArchiveMutationsOptions) {
  const queryClient = useQueryClient();

  // Hard delete mutation (RGPD - permanent deletion)
  // SEC-DATA-031: Calls the canonical `employees` edge function which covers
  // ALL employee-linked tables (24+ steps). The `employee-archives` endpoint
  // also delegates here, so either path reaches the same comprehensive logic.
  const hardDeleteMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke("employees", {
        body: {
          action: "hard_delete",
          user_id: userId,
          confirm: true,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      // Invalidate archives list (guard for null establishmentId)
      if (establishmentId) {
        queryClient.invalidateQueries({ queryKey: ["archived-employees", establishmentId] });
      }
      // Invalidate employee detail if open
      queryClient.invalidateQueries({ queryKey: ["employee", userId] });
      // Invalidate documents if any
      queryClient.invalidateQueries({ queryKey: ["employee-documents", userId] });

      toast.success(data.message || "Données supprimées définitivement");
      onHardDeleteSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suppression");
    },
  });

  return {
    hardDeleteMutation,
  };
}
