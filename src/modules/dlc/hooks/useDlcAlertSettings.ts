/**
 * DLC V1 — Hook to fetch and mutate DLC alert settings per establishment.
 * SSOT: dlc_alert_settings table (global default + category thresholds).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { DLC_DEFAULT_WARNING_DAYS } from "../types";

export interface DlcAlertSettings {
  establishment_id: string;
  default_warning_days: number;
  category_thresholds: Record<string, number>;
  updated_at: string;
}

const QUERY_KEY = "dlc-alert-settings";

export function useDlcAlertSettings() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;

  const query = useQuery({
    queryKey: [QUERY_KEY, estId],
    queryFn: async (): Promise<DlcAlertSettings | null> => {
      if (!estId) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("dlc_alert_settings")
        .select("*")
        .eq("establishment_id", estId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      return {
        establishment_id: data.establishment_id,
        default_warning_days: data.default_warning_days ?? DLC_DEFAULT_WARNING_DAYS,
        category_thresholds: (data.category_thresholds as Record<string, number>) ?? {},
        updated_at: data.updated_at,
      };
    },
    enabled: !!estId,
    staleTime: 60_000,
  });

  return {
    settings: query.data ?? null,
    isLoading: query.isLoading,
    /** Resolved default: from DB or fallback */
    defaultWarningDays: query.data?.default_warning_days ?? DLC_DEFAULT_WARNING_DAYS,
    /** Category thresholds map */
    categoryThresholds: query.data?.category_thresholds ?? {},
  };
}

export function useUpsertDlcAlertSettings() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id ?? null;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      default_warning_days: number;
      category_thresholds: Record<string, number>;
    }) => {
      if (!estId) throw new Error("No establishment");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("dlc_alert_settings")
        .upsert(
          {
            establishment_id: estId,
            default_warning_days: params.default_warning_days,
            category_thresholds: params.category_thresholds,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "establishment_id" }
        );

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, estId] });
      // Also invalidate DLC critique to reflect new thresholds
      queryClient.invalidateQueries({ queryKey: ["dlc", "critique"] });
    },
  });
}
