/**
 * Planning-related realtime channels.
 * - planning_shifts: shift data changes
 * - planning_weeks: validation state changes (day/week validation)
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidatePlanning } from "../invalidators";

export function usePlanningShiftsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidatePlanning(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-planning-shifts-${establishmentId}`,
    table: "planning_shifts",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "planning_shifts change -> invalidating planning",
  });
}

export function usePlanningWeeksChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidatePlanning(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-planning-weeks-${establishmentId}`,
    table: "planning_weeks",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "planning_weeks change -> invalidating planning",
  });
}
