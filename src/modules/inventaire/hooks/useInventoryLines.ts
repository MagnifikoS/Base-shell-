/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0 — Lines Hook
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useMemo } from "react";
import {
  fetchInventoryLines,
  countProduct,
  updateLineQuantity,
} from "../services/inventoryLineService";

export function useInventoryLines(sessionId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => ["inventory-lines", sessionId], [sessionId]);

  const { data: lines = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchInventoryLines(sessionId!),
    enabled: !!sessionId,
  });

  // Realtime handled centrally by useAppRealtimeSync (useInventoryLinesChannel)

  const countedLines = lines.filter((l) => l.counted_at !== null);
  const uncountedLines = lines.filter((l) => l.counted_at === null);
  const firstUncountedIndex = lines.findIndex((l) => l.counted_at === null);

  const count = useMutation({
    mutationFn: (params: { lineId: string; quantity: number; unitId: string | null }) =>
      countProduct({
        lineId: params.lineId,
        sessionId: sessionId!,
        quantity: params.quantity,
        unitId: params.unitId,
        userId: user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["inventory-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
    },
    onError: () => toast.error("Erreur lors du comptage"),
  });

  const updateQuantity = useMutation({
    mutationFn: (params: { lineId: string; quantity: number; unitId: string | null }) =>
      updateLineQuantity(params.lineId, params.quantity, params.unitId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-sessions"] });
    },
    onError: () => toast.error("Erreur lors de la mise à jour"),
  });

  return {
    lines,
    isLoading,
    countedLines,
    uncountedLines,
    firstUncountedIndex,
    totalCount: lines.length,
    countedCount: countedLines.length,
    count,
    updateQuantity,
  };
}
