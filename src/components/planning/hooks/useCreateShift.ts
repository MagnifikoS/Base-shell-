import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PlanningWeekData, PlanningShift } from "../types/planning.types";
import { timeDiffMinutes } from "@/lib/planning-engine/format";

interface CreateShiftParams {
  establishmentId: string;
  weekStart: string;
  userId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
}

interface CreateShiftResponse {
  shift: PlanningShift;
}

interface CacheEntry {
  queryKey: readonly unknown[];
  data: PlanningWeekData;
}

/**
 * Get all planning-week cache entries matching a partial key prefix.
 * The actual query key is ["planning-week", estabId, weekStart, teamKey];
 * we match with ["planning-week", estabId, weekStart] to cover any teamKey.
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

export function useCreateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateShiftParams): Promise<CreateShiftResponse> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "create_shift",
          establishment_id: params.establishmentId,
          shift_date: params.shiftDate,
          user_id: params.userId,
          start_time: params.startTime,
          end_time: params.endTime,
        },
      });

      if (error) {
        // Parse real backend message from FunctionsHttpError
        if (error.name === "FunctionsHttpError" && error.context instanceof Response) {
          const body = await error.context.json().catch(() => null);
          throw new Error(body?.error || body?.message || "Erreur lors de la création du shift");
        }
        throw new Error(error.message || "Erreur lors de la création du shift");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as CreateShiftResponse;
    },

    onMutate: async (params) => {
      const partialKey = ["planning-week", params.establishmentId, params.weekStart];

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: partialKey });

      // Generate unique tempId for THIS mutation (collision-resistant)
      const tempId = crypto.randomUUID
        ? `temp-${crypto.randomUUID()}`
        : `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // Snapshot all matching cache entries and apply optimistic update
      const snapshots = getMatchingEntries(queryClient, partialKey);

      const durationMinutes = timeDiffMinutes(params.startTime, params.endTime);
      const netMinutes = Math.max(0, durationMinutes); // No break for optimistic

      const tempShift: PlanningShift = {
        id: tempId,
        user_id: params.userId,
        shift_date: params.shiftDate,
        start_time: params.startTime,
        end_time: params.endTime,
        net_minutes: netMinutes,
        break_minutes: 0,
        updated_at: new Date().toISOString(),
      };

      for (const { queryKey, data } of snapshots) {
        const newData: PlanningWeekData = {
          ...data,
          shiftsByEmployee: {
            ...data.shiftsByEmployee,
            [params.userId]: [...(data.shiftsByEmployee[params.userId] || []), tempShift],
          },
          totalsByEmployee: {
            ...data.totalsByEmployee,
            [params.userId]: (data.totalsByEmployee[params.userId] || 0) + netMinutes,
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }

      // Return context with tempId and snapshots for targeted replacement/rollback
      return { snapshots, partialKey, params, tempId };
    },

    onError: (_error, params, context) => {
      // Targeted rollback: remove ONLY this mutation's temp shift from all cache entries
      if (!context?.partialKey || !context?.tempId) return;

      const entries = getMatchingEntries(queryClient, context.partialKey);
      for (const { queryKey, data } of entries) {
        const employeeShifts = data.shiftsByEmployee[params.userId] || [];
        const tempShift = employeeShifts.find((s) => s.id === context.tempId);

        // Remove only this temp shift
        const updatedShifts = employeeShifts.filter((s) => s.id !== context.tempId);

        // Recalculate total (subtract the temp's net_minutes)
        const removedMinutes = tempShift?.net_minutes || 0;
        const newTotal = Math.max(0, (data.totalsByEmployee[params.userId] || 0) - removedMinutes);

        const newData: PlanningWeekData = {
          ...data,
          shiftsByEmployee: {
            ...data.shiftsByEmployee,
            [params.userId]: updatedShifts,
          },
          totalsByEmployee: {
            ...data.totalsByEmployee,
            [params.userId]: newTotal,
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }
    },

    onSuccess: (data, params, context) => {
      if (!context?.partialKey) return;

      const realShift = data.shift;
      const tempId = context.tempId;

      const entries = getMatchingEntries(queryClient, context.partialKey);
      for (const { queryKey, data: cacheData } of entries) {
        const employeeShifts = cacheData.shiftsByEmployee[params.userId] || [];

        // Targeted replacement: replace ONLY this mutation's temp shift
        let updatedShifts: PlanningShift[];
        const tempIndex = employeeShifts.findIndex((s) => s.id === tempId);

        if (tempIndex !== -1) {
          // Replace the temp shift with real shift
          updatedShifts = employeeShifts.map((s) => (s.id === tempId ? realShift : s));
        } else {
          // Fallback: append only if realShift doesn't exist yet
          const exists = employeeShifts.some((s) => s.id === realShift.id);
          updatedShifts = exists ? employeeShifts : [...employeeShifts, realShift];
        }

        // Recalculate total for this employee
        const newTotal = updatedShifts.reduce((sum, s) => sum + s.net_minutes, 0);

        const newData: PlanningWeekData = {
          ...cacheData,
          shiftsByEmployee: {
            ...cacheData.shiftsByEmployee,
            [params.userId]: updatedShifts,
          },
          totalsByEmployee: {
            ...cacheData.totalsByEmployee,
            [params.userId]: newTotal,
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }

      toast.success("Shift créé");
    },
  });
}
