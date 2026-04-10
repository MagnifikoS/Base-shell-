import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PlanningWeekData, PlanningShift } from "../types/planning.types";
import { timeDiffMinutes } from "@/lib/planning-engine/format";

interface UpdateShiftParams {
  establishmentId: string;
  weekStart: string;
  employeeId: string;
  shiftId: string;
  startTime: string;
  endTime: string;
}

interface UpdateShiftResponse {
  shift: PlanningShift;
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

export function useUpdateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateShiftParams): Promise<UpdateShiftResponse> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "update_shift",
          establishment_id: params.establishmentId,
          shift_id: params.shiftId,
          start_time: params.startTime,
          end_time: params.endTime,
        },
      });

      if (error) {
        // Parse real backend message from FunctionsHttpError
        if (error.name === "FunctionsHttpError" && error.context instanceof Response) {
          const body = await error.context.json().catch(() => null);
          throw new Error(
            body?.error || body?.message || "Erreur lors de la modification du shift"
          );
        }
        throw new Error(error.message || "Erreur lors de la modification du shift");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as UpdateShiftResponse;
    },

    onMutate: async (params) => {
      const partialKey = ["planning-week", params.establishmentId, params.weekStart];

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: partialKey });

      // Snapshot all matching cache entries and apply optimistic update
      const snapshots = getMatchingEntries(queryClient, partialKey);

      const durationMinutes = timeDiffMinutes(params.startTime, params.endTime);
      const netMinutes = Math.max(0, durationMinutes);

      for (const { queryKey, data } of snapshots) {
        const employeeShifts = data.shiftsByEmployee[params.employeeId] || [];
        const updatedShifts = employeeShifts.map((s) =>
          s.id === params.shiftId
            ? {
                ...s,
                start_time: params.startTime,
                end_time: params.endTime,
                net_minutes: netMinutes,
                break_minutes: 0,
                updated_at: new Date().toISOString(),
              }
            : s
        );

        // Recalculate total
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

      return { snapshots, partialKey, params };
    },

    onError: (_error, _params, context) => {
      // Rollback all cache entries to their previous state
      if (!context?.snapshots) return;
      for (const { queryKey, data } of context.snapshots) {
        queryClient.setQueryData(queryKey, data);
      }
    },

    onSuccess: (data, params, context) => {
      if (!context?.partialKey) return;

      const realShift = data.shift;

      const entries = getMatchingEntries(queryClient, context.partialKey);
      for (const { queryKey, data: cacheData } of entries) {
        // Conflict detection: check if another user modified this shift concurrently
        const previousSnapshots = context.snapshots || [];
        const previousEntry = previousSnapshots.find(
          (s) => JSON.stringify(s.queryKey) === JSON.stringify(queryKey)
        );
        if (previousEntry) {
          const previousShifts = previousEntry.data.shiftsByEmployee[params.employeeId] || [];
          const previousShift = previousShifts.find((s) => s.id === params.shiftId);
          if (
            previousShift &&
            realShift.updated_at &&
            previousShift.updated_at &&
            realShift.updated_at !== previousShift.updated_at
          ) {
            // Server data differs from what we had before the optimistic update
            toast.info("Les données ont été mises à jour par un autre utilisateur");
            queryClient.invalidateQueries({ queryKey: context.partialKey });
            return;
          }
        }

        const employeeShifts = cacheData.shiftsByEmployee[params.employeeId] || [];
        const updatedShifts = employeeShifts.map((s) => (s.id === params.shiftId ? realShift : s));

        // Recalculate total with real values
        const newTotal = updatedShifts.reduce((sum, s) => sum + s.net_minutes, 0);

        const newData: PlanningWeekData = {
          ...cacheData,
          shiftsByEmployee: {
            ...cacheData.shiftsByEmployee,
            [params.employeeId]: updatedShifts,
          },
          totalsByEmployee: {
            ...cacheData.totalsByEmployee,
            [params.employeeId]: newTotal,
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }

      toast.success("Shift modifié");
    },
  });
}
