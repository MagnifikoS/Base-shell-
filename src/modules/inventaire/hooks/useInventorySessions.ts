/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Sessions Hook
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  fetchInventorySessions,
  createInventorySession,
  updateSessionStatus,
  cancelAndDeleteSession,
} from "../services/inventorySessionService";
import type { ZoneWithInventoryStatus } from "../types";
import { useStorageZones } from "@/modules/produitsV2";
import { useMemo } from "react";

export function useInventorySessions() {
  const { activeEstablishment } = useEstablishment();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const estId = activeEstablishment?.id;
  const orgId = activeEstablishment?.organization_id;
  const { zones } = useStorageZones();

  const queryKey = useMemo(() => ["inventory-sessions", estId], [estId]);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchInventorySessions(estId!),
    enabled: !!estId,
  });

  // Realtime handled centrally by useAppRealtimeSync (useInventorySessionsChannel)

  // ═══════════════════════════════════════════════════════════════════════
  // COMPUTE zone statuses from sessions
  // ═══════════════════════════════════════════════════════════════════════
  const zonesWithStatus: ZoneWithInventoryStatus[] = useMemo(
    () =>
      zones.map((zone) => {
        const activeSession = sessions.find(
          (s) =>
            s.storage_zone_id === zone.id && (s.status === "en_cours" || s.status === "en_pause")
        );
        const completedSession = sessions.find(
          (s) => s.storage_zone_id === zone.id && s.status === "termine"
        );

        let inventoryStatus: ZoneWithInventoryStatus["inventoryStatus"] = "not_started";
        let totalProducts = 0;
        let countedProducts = 0;
        let activeSessionId: string | null = null;

        if (activeSession) {
          inventoryStatus = "in_progress";
          totalProducts = activeSession.total_products;
          countedProducts = activeSession.counted_products;
          activeSessionId = activeSession.id;
        } else if (completedSession) {
          inventoryStatus = "completed";
          totalProducts = completedSession.total_products;
          countedProducts = completedSession.counted_products;
        }

        return {
          id: zone.id,
          name: zone.name,
          display_order: zone.display_order,
          inventoryStatus,
          activeSessionId,
          totalProducts,
          countedProducts,
        };
      }),
    [zones, sessions]
  );

  // ═══════════════════════════════════════════════════════════════════════
  // MUTATIONS
  // ═══════════════════════════════════════════════════════════════════════

  const startSession = useMutation({
    mutationFn: (zoneId: string) =>
      createInventorySession({
        organizationId: orgId!,
        establishmentId: estId!,
        zoneId,
        userId: user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Inventaire démarré");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pauseSession = useMutation({
    mutationFn: (sessionId: string) => updateSessionStatus(sessionId, "en_pause"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Inventaire en pause");
    },
    onError: () => toast.error("Erreur lors de la mise en pause"),
  });

  const resumeSession = useMutation({
    mutationFn: (sessionId: string) => updateSessionStatus(sessionId, "en_cours"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const completeSession = useMutation({
    mutationFn: (sessionId: string) => updateSessionStatus(sessionId, "termine"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
      // P0-2: Invalidate estimated stock + alerts so real-time view recalculates
      queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      toast.success("Inventaire terminé ✓");
    },
    onError: () => toast.error("Erreur lors de la clôture"),
  });

  const restartSession = useMutation({
    mutationFn: async (params: { sessionId: string; zoneId: string }) => {
      await cancelAndDeleteSession(params.sessionId);
      return createInventorySession({
        organizationId: orgId!,
        establishmentId: estId!,
        zoneId: params.zoneId,
        userId: user!.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Inventaire recommencé");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    sessions,
    isLoading,
    zonesWithStatus,
    startSession,
    pauseSession,
    resumeSession,
    completeSession,
    restartSession,
  };
}
