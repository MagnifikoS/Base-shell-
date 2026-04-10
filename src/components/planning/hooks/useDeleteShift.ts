import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PlanningWeekData } from "../types/planning.types";

interface DeleteShiftParams {
  establishmentId: string;
  weekStart: string;
  employeeId: string;
  shiftId: string;
}

interface CacheEntry {
  queryKey: readonly unknown[];
  data: PlanningWeekData;
}

/**
 * Get all planning-week cache entries matching a partial key prefix.
 */
function getMatchingEntries(
  queryClient: ReturnType<typeof useQueryClient>,
  partialKey: string[]
): CacheEntry[] {
  const entries = queryClient.getQueriesData<PlanningWeekData>({
    queryKey: partialKey,
  });

  const result: CacheEntry[] = [];
  for (const [queryKey, data] of entries) {
    if (data) {
      result.push({ queryKey, data });
    }
  }
  return result;
}

export function useDeleteShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: DeleteShiftParams): Promise<{ success: boolean }> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "delete_shift",
          establishment_id: params.establishmentId,
          shift_id: params.shiftId,
        },
      });

      if (error) {
        // Parse real backend message from FunctionsHttpError
        if (error.name === "FunctionsHttpError" && error.context instanceof Response) {
          const body = await error.context.json().catch(() => null);
          throw new Error(body?.error || body?.message || "Erreur lors de la suppression du shift");
        }
        throw new Error(error.message || "Erreur lors de la suppression du shift");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as { success: boolean };
    },

    onMutate: async (params) => {
      const partialKey = ["planning-week", params.establishmentId, params.weekStart];

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: partialKey });

      // Snapshot all matching cache entries and apply optimistic removal
      const snapshots = getMatchingEntries(queryClient, partialKey);

      for (const { queryKey, data } of snapshots) {
        const employeeShifts = data.shiftsByEmployee[params.employeeId] || [];
        const updatedShifts = employeeShifts.filter((s) => s.id !== params.shiftId);

        // Recalculate total for this employee
        const newTotal = updatedShifts.reduce((sum, s) => sum + s.net_minutes, 0);

        const newData: PlanningWeekData = {
          ...data,
          shiftsByEmployee: {
            ...data.shiftsByEmployee,
            [params.employeeId]: updatedShifts,
          },
          totalsByEmployee: {
            ...data.totalsByEmployee,
            [params.employeeId]: newTotal,
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }

      return { snapshots, partialKey };
    },

    onError: (_error, _params, context) => {
      // Rollback all cache entries to their previous state
      if (!context?.snapshots) return;
      for (const { queryKey, data } of context.snapshots) {
        queryClient.setQueryData(queryKey, data);
      }
    },

    onSuccess: () => {
      toast.success("Shift supprimé");
    },
  });
}
