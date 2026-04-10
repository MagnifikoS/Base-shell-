/**
 * Payroll validation realtime channel.
 * When extras_paid changes, R-Extra balance changes -> invalidate planning + payroll.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidatePlanning, invalidatePayroll } from "../invalidators";

export function usePayrollValidationChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidatePlanning(queryClient, establishmentId);
    invalidatePayroll(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-payroll-validation-${establishmentId}`,
    table: "payroll_employee_month_validation",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "payroll_employee_month_validation change -> invalidating planning + payroll",
  });
}
