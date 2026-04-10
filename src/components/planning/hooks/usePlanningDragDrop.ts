import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { timeDiffMinutes } from "@/lib/planning-engine/format";
import type { PlanningWeekData, PlanningShift } from "../types/planning.types";
import type { DragPayload } from "../week/row";

/**
 * Get all planning-week cache entries matching [establishmentId, weekStart].
 * Since the actual query key is ["planning-week", estabId, weekStart, teamKey],
 * we use getQueriesData with a 3-element prefix to match any teamKey.
 */
function getPlanningCacheEntries(
  queryClient: ReturnType<typeof useQueryClient>,
  establishmentId: string,
  weekStart: string
): Array<{ queryKey: readonly unknown[]; data: PlanningWeekData }> {
  const partialKey = ["planning-week", establishmentId, weekStart];
  const entries = queryClient.getQueriesData<PlanningWeekData>({
    queryKey: partialKey,
  });

  const result: Array<{ queryKey: readonly unknown[]; data: PlanningWeekData }> = [];
  for (const [queryKey, data] of entries) {
    if (data) {
      result.push({ queryKey, data });
    }
  }
  return result;
}

/**
 * Build an optimistic PlanningShift from a drag payload.
 */
function buildOptimisticShift(
  userId: string,
  targetDate: string,
  _establishmentId: string,
  payload: DragPayload
): PlanningShift {
  const durationMinutes = timeDiffMinutes(payload.start_time, payload.end_time);
  const netMinutes = Math.max(0, durationMinutes);
  const tempId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? `temp-dnd-${crypto.randomUUID()}`
      : `temp-dnd-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id: tempId,
    user_id: userId,
    shift_date: targetDate,
    start_time: payload.start_time,
    end_time: payload.end_time,
    net_minutes: netMinutes,
    break_minutes: 0,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Apply an optimistic "add shift" to a PlanningWeekData cache entry.
 */
function applyOptimisticAdd(
  data: PlanningWeekData,
  userId: string,
  newShift: PlanningShift
): PlanningWeekData {
  const existingShifts = data.shiftsByEmployee[userId] || [];
  const updatedShifts = [...existingShifts, newShift];
  const newTotal = updatedShifts.reduce((sum, s) => sum + s.net_minutes, 0);

  return {
    ...data,
    shiftsByEmployee: {
      ...data.shiftsByEmployee,
      [userId]: updatedShifts,
    },
    totalsByEmployee: {
      ...data.totalsByEmployee,
      [userId]: newTotal,
    },
  };
}

/**
 * Apply an optimistic "remove shift" to a PlanningWeekData cache entry.
 */
function applyOptimisticRemove(
  data: PlanningWeekData,
  userId: string,
  shiftId: string
): PlanningWeekData {
  const existingShifts = data.shiftsByEmployee[userId] || [];
  const updatedShifts = existingShifts.filter((s) => s.id !== shiftId);
  const newTotal = updatedShifts.reduce((sum, s) => sum + s.net_minutes, 0);

  return {
    ...data,
    shiftsByEmployee: {
      ...data.shiftsByEmployee,
      [userId]: updatedShifts,
    },
    totalsByEmployee: {
      ...data.totalsByEmployee,
      [userId]: newTotal,
    },
  };
}

export interface OptimisticDropParams {
  targetDate: string;
  payload: DragPayload;
  /** The userId of the row that received the drop */
  targetUserId: string;
}

interface CacheSnapshot {
  queryKey: readonly unknown[];
  data: PlanningWeekData;
}

/**
 * Directly call the planning-week edge function for creating a shift.
 * Bypasses the mutation hook to avoid double-optimistic updates.
 */
async function apiCreateShift(params: {
  establishmentId: string;
  shiftDate: string;
  userId: string;
  startTime: string;
  endTime: string;
}): Promise<PlanningShift> {
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
    if (error.name === "FunctionsHttpError" && error.context instanceof Response) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error || body?.message || "Erreur lors de la cr\u00e9ation du shift");
    }
    throw new Error(error.message || "Erreur lors de la cr\u00e9ation du shift");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return (data as { shift: PlanningShift }).shift;
}

/**
 * Directly call the planning-week edge function for deleting a shift.
 * Bypasses the mutation hook to avoid double-optimistic updates.
 */
async function apiDeleteShift(params: { establishmentId: string; shiftId: string }): Promise<void> {
  const { data, error } = await supabase.functions.invoke("planning-week", {
    body: {
      action: "delete_shift",
      establishment_id: params.establishmentId,
      shift_id: params.shiftId,
    },
  });

  if (error) {
    if (error.name === "FunctionsHttpError" && error.context instanceof Response) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error || body?.message || "Erreur lors de la suppression du shift");
    }
    throw new Error(error.message || "Erreur lors de la suppression du shift");
  }

  if (data?.error) {
    throw new Error(data.error);
  }
}

/**
 * Hook that provides optimistic drag & drop for planning shifts.
 *
 * - Same employee drag = **move** (delete source + create at target)
 * - Different employee drag = **copy** (create at target only)
 *
 * The cache is updated immediately (optimistic) before API calls complete.
 * On error, the cache is reverted to its previous state.
 *
 * This hook calls the Supabase API directly (bypassing mutation hooks)
 * to avoid double-optimistic updates. The mutation hooks' onMutate would
 * otherwise add a second temp shift to the cache.
 */
export function usePlanningDragDrop(establishmentId: string, weekStart: string) {
  const queryClient = useQueryClient();
  const [isDropPending, setIsDropPending] = useState(false);
  // Track pending operation count to handle rapid sequential drops
  const pendingCountRef = useRef(0);

  const handleOptimisticDrop = useCallback(
    (params: OptimisticDropParams) => {
      const { targetDate, payload, targetUserId } = params;
      // Always copy (duplicate) — never move/delete the source shift
      const isMove = false;

      // 1. Cancel in-flight queries for this planning week
      const partialKey = ["planning-week", establishmentId, weekStart];
      queryClient.cancelQueries({ queryKey: partialKey });

      // 2. Snapshot all matching cache entries (for rollback)
      const snapshots: CacheSnapshot[] = getPlanningCacheEntries(
        queryClient,
        establishmentId,
        weekStart
      );

      // 3. Build optimistic shift
      const optimisticShift = buildOptimisticShift(
        targetUserId,
        targetDate,
        establishmentId,
        payload
      );

      // 4. Apply optimistic update to ALL matching cache entries
      for (const { queryKey, data } of snapshots) {
        let updated = applyOptimisticAdd(data, targetUserId, optimisticShift);

        if (isMove) {
          // For move: also remove the source shift from the same employee
          updated = applyOptimisticRemove(updated, payload.fromEmployeeId, payload.fromShiftId);
        }

        queryClient.setQueryData(queryKey, updated);
      }

      // 5. Revert helper
      const revertToSnapshots = () => {
        for (const { queryKey, data } of snapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      };

      // 6. Invalidate helper — always invalidate to sync with server
      const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: partialKey });
      };

      // 7. Fire API calls in background (directly, bypassing mutation hooks)
      pendingCountRef.current += 1;
      setIsDropPending(true);

      const executeApiCalls = async () => {
        try {
          if (isMove) {
            // Move: delete source first, then create at target
            await apiDeleteShift({
              establishmentId,
              shiftId: payload.fromShiftId,
            });
            await apiCreateShift({
              establishmentId,
              shiftDate: targetDate,
              userId: targetUserId,
              startTime: payload.start_time,
              endTime: payload.end_time,
            });
          } else {
            // Copy: just create at target
            await apiCreateShift({
              establishmentId,
              shiftDate: targetDate,
              userId: targetUserId,
              startTime: payload.start_time,
              endTime: payload.end_time,
            });
          }
        } catch {
          // On any error: revert to snapshot
          revertToSnapshots();
          toast.error(
            isMove ? "Impossible de d\u00e9placer le shift" : "Impossible de copier le shift"
          );
        } finally {
          // Always invalidate to ensure consistency with server
          invalidateAll();
          pendingCountRef.current -= 1;
          if (pendingCountRef.current <= 0) {
            pendingCountRef.current = 0;
            setIsDropPending(false);
          }
        }
      };

      executeApiCalls();

      return { isMove };
    },
    [establishmentId, weekStart, queryClient]
  );

  return {
    handleOptimisticDrop,
    isDropPending,
  };
}

// Export pure functions for testing
export { getPlanningCacheEntries, buildOptimisticShift, applyOptimisticAdd, applyOptimisticRemove };
export type { CacheSnapshot };
