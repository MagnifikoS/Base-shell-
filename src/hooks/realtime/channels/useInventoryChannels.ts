/**
 * Inventory realtime channels.
 *
 * Listens for changes on inventory_sessions and inventory_lines tables.
 * Invalidates inventory-sessions, inventory-lines, desktop-stock, zone-lines-stats-batch,
 * estimated-stock, and stock-alerts so all inventory views stay in sync.
 *
 * Migrated from:
 *   - src/modules/inventaire/hooks/useInventorySessions.ts (local realtime)
 *   - src/modules/inventaire/hooks/useInventoryLines.ts (local realtime)
 *
 * Part of INV-04 / API-PERF-002 migration.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidateInventory } from "../invalidators";

/**
 * Channel for inventory_sessions table changes (scoped by establishment_id).
 *
 * Fires when sessions are created, paused, resumed, completed, or cancelled.
 */
export function useInventorySessionsChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidateInventory(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-inventory-sessions-${establishmentId}`,
    table: "inventory_sessions",
    filter: establishmentId ? `establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "inventory_sessions * -> invalidating inventory queries",
  });
}

/**
 * Channel for inventory_lines table changes (unfiltered — lines lack establishment_id).
 *
 * inventory_lines only has session_id, not establishment_id. Since the central
 * orchestrator is establishment-scoped, we listen to ALL line changes and rely on
 * React Query's stale-while-revalidate to avoid unnecessary refetches for inactive
 * queries. This is safe because only the actively-viewed session's queries are active.
 */
export function useInventoryLinesChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidateInventory(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-inventory-lines-${establishmentId}`,
    table: "inventory_lines",
    // No filter: inventory_lines lacks establishment_id column
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "inventory_lines * -> invalidating inventory queries",
  });
}
