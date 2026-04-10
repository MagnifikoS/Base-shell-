/**
 * Invoice-related realtime channels.
 * - invoice_suppliers
 * - invoices
 * - invoice_monthly_statements
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";

export function useInvoiceSuppliersChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    queryClient.invalidateQueries({
      queryKey: ["suppliers", establishmentId],
      exact: false,
    });
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-invoice-suppliers-${establishmentId}`,
    table: "invoice_suppliers",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "invoice_suppliers change -> invalidating suppliers",
  });
}

export function useInvoicesChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    queryClient.invalidateQueries({
      queryKey: ["invoices", establishmentId],
      exact: false,
    });
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-invoices-${establishmentId}`,
    table: "invoices",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "invoices change -> invalidating invoices",
  });
}

export function useInvoiceStatementsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    queryClient.invalidateQueries({
      queryKey: ["statements", establishmentId],
      exact: false,
    });
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-invoice-statements-${establishmentId}`,
    table: "invoice_monthly_statements",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "invoice_monthly_statements change -> invalidating statements",
  });
}
