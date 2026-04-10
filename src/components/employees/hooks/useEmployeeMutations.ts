import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { EmployeeFormData } from "../types/employee.types";

interface ReactivatePayload {
  mode: "mistake" | "rehire";
  rehire_start_date?: string;
}

interface UseEmployeeMutationsOptions {
  userId: string | null;
  /** SSOT: establishmentId from context, required for cache invalidation */
  establishmentId: string | null;
  onSaveSuccess?: () => void;
  onSuspendSuccess?: () => void;
  onReactivateSuccess?: () => void;
}

export function useEmployeeMutations({
  userId,
  establishmentId,
  onSaveSuccess,
  onSuspendSuccess,
  onReactivateSuccess,
}: UseEmployeeMutationsOptions) {
  const queryClient = useQueryClient();

  // Targeted invalidations (rule R0.4 + piège B)
  const invalidateEmployee = () => {
    queryClient.invalidateQueries({ queryKey: ["employee", userId] });
  };

  const invalidateListAndEmployee = () => {
    invalidateEmployee();
    // Guard: skip list invalidation if no establishmentId
    if (!establishmentId) return;
    // Invalidate both active and archived lists when status changes
    queryClient.invalidateQueries({ queryKey: ["employees", establishmentId] });
    queryClient.invalidateQueries({ queryKey: ["archived-employees", establishmentId] });
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (formData: EmployeeFormData) => {
      // Separate second_first_name from details
      const { second_first_name, ...details } = formData;
      
      const response = await supabase.functions.invoke("employees", {
        body: {
          action: "update",
          user_id: userId,
          details,
          second_first_name,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // Save doesn't change status → invalidate only employee, not list
      invalidateEmployee();
      toast.success("Informations enregistrées");
      onSaveSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'enregistrement");
    },
  });

  // Suspend mutation
  const suspendMutation = useMutation({
    mutationFn: async (endDate: string) => {
      const response = await supabase.functions.invoke("employees", {
        body: {
          action: "suspend",
          user_id: userId,
          contract_end_date: endDate,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // Status change → invalidate both + admin users + planning (scoped to establishment)
      invalidateListAndEmployee();
      queryClient.invalidateQueries({ queryKey: ["admin-users"], exact: false });
      // P-PLANNING-2: Scopé à l'établissement pour éviter refetch cross-establishments
      if (establishmentId) {
        queryClient.invalidateQueries({ queryKey: ["planning-week", establishmentId], exact: false });
      }
      toast.success("Contrat terminé - Salarié suspendu");
      onSuspendSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suspension");
    },
  });

  // Reactivate mutation with mode support
  const reactivateMutation = useMutation({
    mutationFn: async (payload: ReactivatePayload) => {
      const response = await supabase.functions.invoke("employees", {
        body: {
          action: "reactivate",
          user_id: userId,
          reactivate_mode: payload.mode,
          rehire_start_date: payload.mode === "rehire" ? payload.rehire_start_date : undefined,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // Status change → invalidate both + admin users + planning (scoped to establishment)
      invalidateListAndEmployee();
      queryClient.invalidateQueries({ queryKey: ["admin-users"], exact: false });
      // P-PLANNING-2: Scopé à l'établissement pour éviter refetch cross-establishments
      if (establishmentId) {
        queryClient.invalidateQueries({ queryKey: ["planning-week", establishmentId], exact: false });
      }
      toast.success("Salarié réintégré");
      onReactivateSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la réintégration");
    },
  });

  return {
    saveMutation,
    suspendMutation,
    reactivateMutation,
  };
}
