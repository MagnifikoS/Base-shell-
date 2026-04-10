/**
 * BL Withdrawal (Retrait) realtime channels.
 * - bl_withdrawal_documents
 * - bl_withdrawal_lines
 *
 * Invalidates BL retrait queries + commande-related shipped data
 * so both restaurant and fournisseur see corrections/shipments instantly.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "../useRealtimeChannel";
import { invalidateBlRetrait } from "../invalidators";

export function useBlWithdrawalDocumentsChannel(
  establishmentId: string | null,
  enabled: boolean
) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidateBlRetrait(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-bl-withdrawal-docs-${establishmentId}`,
    table: "bl_withdrawal_documents",
    filter: establishmentId
      ? `establishment_id=eq.${establishmentId}`
      : undefined,
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "bl_withdrawal_documents change -> invalidating bl-retraits + commande",
  });
}

export function useBlWithdrawalLinesChannel(
  establishmentId: string | null,
  enabled: boolean
) {
  const queryClient = useQueryClient();

  const onEvent = useCallback(() => {
    if (!establishmentId) return;
    invalidateBlRetrait(queryClient, establishmentId);
  }, [queryClient, establishmentId]);

  useRealtimeChannel({
    channelName: `app-bl-withdrawal-lines-${establishmentId}`,
    table: "bl_withdrawal_lines",
    enabled: enabled && !!establishmentId,
    onEvent,
    logLabel: "bl_withdrawal_lines change -> invalidating bl-retraits + commande",
  });
}
