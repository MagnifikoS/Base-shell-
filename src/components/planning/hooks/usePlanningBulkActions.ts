import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

interface DeleteWeekShiftsParams {
  establishmentId: string;
  weekStart: string;
}

interface DeleteEmployeeWeekShiftsParams {
  establishmentId: string;
  weekStart: string;
  userId: string;
}

interface CopyPreviousWeekParams {
  establishmentId: string;
  weekStart: string;
  userId: string;
  mode: "merge" | "replace";
}

interface DeleteWeekShiftsResult {
  success: boolean;
  deleted_count: number;
  deleted_leaves_count: number;
  skipped_validated_count: number;
  message?: string;
}

interface DeleteEmployeeWeekShiftsResult {
  success: boolean;
  deleted_count: number;
  skipped_validated_count: number;
  message?: string;
}

interface CopyPreviousWeekResult {
  success: boolean;
  copied_count: number;
  copied_leaves_count: number;
  replaced_deleted_count: number;
  replaced_deleted_leaves_count: number;
  skipped_existing_count: number;
  skipped_leave_count: number;
  message?: string;
}

// ============================================================================
// Mutations
// ============================================================================

export function useDeleteWeekShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: DeleteWeekShiftsParams): Promise<DeleteWeekShiftsResult> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "delete_week_shifts",
          establishment_id: params.establishmentId,
          week_start: params.weekStart,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la suppression");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as DeleteWeekShiftsResult;
    },

    onSuccess: (result, params) => {
      // Invalidate planning-week AND personnel-leaves to refresh deleted leaves (CP/Repos/Absence)
      queryClient.invalidateQueries({
        queryKey: ["planning-week", params.establishmentId, params.weekStart],
      });
      queryClient.invalidateQueries({
        queryKey: ["personnel-leaves", params.establishmentId],
      });

      const totalDeleted = result.deleted_count + result.deleted_leaves_count;
      if (totalDeleted > 0) {
        const parts: string[] = [];
        if (result.deleted_count > 0) parts.push(`${result.deleted_count} shift(s)`);
        if (result.deleted_leaves_count > 0) parts.push(`${result.deleted_leaves_count} congé(s)`);
        toast.success(`${parts.join(" et ")} supprimé(s)`);
      } else {
        toast.info(result.message || "Aucun élément à supprimer");
      }
    },

    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suppression");
    },
  });
}

export function useDeleteEmployeeWeekShifts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: DeleteEmployeeWeekShiftsParams): Promise<DeleteEmployeeWeekShiftsResult> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "delete_employee_week_shifts",
          establishment_id: params.establishmentId,
          week_start: params.weekStart,
          user_id: params.userId,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la suppression");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as DeleteEmployeeWeekShiftsResult;
    },

    onSuccess: (result, params) => {
      queryClient.invalidateQueries({
        queryKey: ["planning-week", params.establishmentId, params.weekStart],
      });

      if (result.deleted_count > 0) {
        toast.success(`${result.deleted_count} shift(s) supprimé(s)`);
      } else {
        toast.info(result.message || "Aucun shift à supprimer");
      }
    },

    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suppression");
    },
  });
}

export function useCopyPreviousWeek() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CopyPreviousWeekParams): Promise<CopyPreviousWeekResult> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "copy_previous_week",
          establishment_id: params.establishmentId,
          week_start: params.weekStart,
          user_id: params.userId,
          mode: params.mode,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la copie");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as CopyPreviousWeekResult;
    },

    onSuccess: (result, params) => {
      // Invalidate both planning-week AND personnel-leaves to refresh copied leaves (CP/Repos/Absence)
      queryClient.invalidateQueries({
        queryKey: ["planning-week", params.establishmentId, params.weekStart],
      });
      queryClient.invalidateQueries({
        queryKey: ["personnel-leaves", params.establishmentId],
      });

      const parts: string[] = [];
      if (result.copied_count > 0) parts.push(`${result.copied_count} shift(s) copié(s)`);
      if (result.copied_leaves_count > 0) parts.push(`${result.copied_leaves_count} congé(s) copié(s)`);
      if (result.replaced_deleted_count > 0) parts.push(`${result.replaced_deleted_count} shift(s) remplacé(s)`);
      if (result.replaced_deleted_leaves_count > 0) parts.push(`${result.replaced_deleted_leaves_count} congé(s) remplacé(s)`);
      if (result.skipped_existing_count > 0) parts.push(`${result.skipped_existing_count} ignoré(s) (existants)`);
      if (result.skipped_leave_count > 0) parts.push(`${result.skipped_leave_count} ignoré(s) (jours de congé)`);

      if (parts.length > 0) {
        toast.success(parts.join(" — "));
      } else {
        toast.info(result.message || "Aucun élément à copier");
      }
    },

    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la copie");
    },
  });
}
