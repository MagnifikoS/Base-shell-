/**
 * Stock events realtime channel.
 *
 * Listens for INSERT on stock_events (receipts, withdrawals, inventory posts).
 * Invalidates estimated-stock, stock-alerts, desktop-stock, and stock-documents-posted
 * so the Desktop Inventaire view refreshes automatically after a mobile POST.
 *
 * Migrated from: src/modules/inventaire/hooks/useStockEventsRealtime.ts (INV-04)
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidateStock } from "../invalidators";

export function useStockEventsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidateStock(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-stock-events-${establishmentId}`,
    table: "stock_events",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "stock_events INSERT -> invalidating stock queries",
  });
}
