/**
 * DLC V1 — Mutation hooks for DLC critique actions.
 * Actions: update DLC date, dismiss alert (mark as removed from stock).
 * SSOT: reception_lot_dlc table.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Update the DLC date on a reception_lot_dlc record.
 * After update, the status will be recalculated on refetch.
 */
export function useUpdateDlcDate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lotId, newDate }: { lotId: string; newDate: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("reception_lot_dlc")
        .update({
          dlc_date: newDate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", lotId);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dlc", "critique"] });
    },
  });
}

/**
 * Dismiss a DLC alert (mark as removed from stock).
 * Sets dismissed_at + dismissed_reason so it's filtered out of the critique view.
 */
export function useDismissDlcAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lotId,
      reason,
    }: {
      lotId: string;
      reason: string;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("reception_lot_dlc")
        .update({
          dismissed_at: new Date().toISOString(),
          dismissed_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", lotId);

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dlc", "critique"] });
    },
  });
}
