/**
 * Commandes realtime channels.
 * Listens on BOTH client_establishment_id and supplier_establishment_id
 * so both CL and FO see changes in real time.
 *
 * Also listens on commande_lines for live preparation updates (multi-user FO).
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";

export function useCommandesChannel(establishmentId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    queryClient.invalidateQueries({ queryKey: ["commandes"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["unified-commandes-products"], exact: false });
  }, [queryClient, establishmentId]);

  /**
   * P0-1 fix: commande_lines has no establishment_id column so events
   * arrive unfiltered. We only invalidate if the user already has cached
   * commandes data (meaning they belong to this establishment).
   * If the cache is empty → the event is for another org → ignored.
   */
  const onCommandeLineEvent = useCallback(() => {
    if (!establishmentId) return;

    const allQueries = queryClient.getQueriesData<Array<{ id: string }>>({
      queryKey: ["commandes"],
      exact: false,
    });
    const hasKnownCommandes = allQueries.some(
      ([, data]) => Array.isArray(data) && data.length > 0
    );
    if (!hasKnownCommandes) {
      return; // No commandes in cache for this establishment → skip
    }

    queryClient.invalidateQueries({ queryKey: ["commandes"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["unified-commandes-products"], exact: false });
  }, [queryClient, establishmentId]);

  // Channel for orders where this establishment is the CLIENT
  useRealtimeChannel({
    channelName: `app-commandes-cl-${establishmentId}`,
    table: "commandes",
    filter: establishmentId ? `client_establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "commandes CL change -> invalidating commandes",
  });

  // Channel for orders where this establishment is the SUPPLIER
  useRealtimeChannel({
    channelName: `app-commandes-fo-${establishmentId}`,
    table: "commandes",
    filter: establishmentId ? `supplier_establishment_id=eq.${establishmentId}` : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "commandes FO change -> invalidating commandes",
  });

  // Channel for commande_lines changes (preparation updates, qty changes)
  // P0-1: filtered client-side via onCommandeLineEvent (only known commandes)
  useRealtimeChannel({
    channelName: `app-commande-lines-${establishmentId}`,
    table: "commande_lines",
    enabled: enabled && !!establishmentId,
    onEvent: onCommandeLineEvent,
    logLabel: "commande_lines change -> invalidating commandes (filtered)",
  });
}
