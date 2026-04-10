/**
 * Employee details realtime channel.
 * PHASE D + PHASE C: salary/hours changes affect payroll,
 * profile changes sync to all employee lists.
 *
 * PERF-03: employee_details has organization_id (not establishment_id).
 * Filters by organization_id when available to reduce noise.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidatePayroll, invalidateEmployees } from "../invalidators";

export function useEmployeeDetailsChannel(
  establishmentId: string | null,
  organizationId: string | null | undefined,
  enabled: boolean
) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidatePayroll(queryClient, establishmentId);
    invalidateEmployees(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  const filter = organizationId ? `organization_id=eq.${organizationId}` : undefined;

  useRealtimeChannel({
    channelName: `app-employee-details-${establishmentId}`,
    table: "employee_details",
    filter,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: `employee_details change -> invalidating payroll + employees${organizationId ? `, org=${organizationId}` : ""}`,
  });
}
