/**
 * R-Extra Module: Mutations for setting/clearing R.Extra
 * Calls Edge Function planning-rextra
 * 
 * PHASE 2 SSOT: Balance is calculated on-the-fly in getWeek.ts
 * No more rextra-balances query to invalidate
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { 
  SetRextraParams, 
  ClearRextraParams, 
  SetRextraResponse, 
  ClearRextraResponse 
} from "./types";

export function useRextraMutations() {
  const queryClient = useQueryClient();

  const setRextraMutation = useMutation({
    mutationFn: async (params: SetRextraParams): Promise<SetRextraResponse> => {
      const { data, error } = await supabase.functions.invoke("planning-rextra", {
        body: {
          action: "set_rextra",
          establishment_id: params.establishmentId,
          user_id: params.userId,
          event_date: params.eventDate,
          minutes: params.minutes,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la pose R.Extra");
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      return data as SetRextraResponse;
    },
    onSuccess: (data, variables) => {
      // PHASE 2 SSOT: Only invalidate planning-week (which now calculates balance on-the-fly)
      queryClient.invalidateQueries({
        queryKey: ["planning-week", variables.establishmentId],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: ["payroll"],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: ["personnel-leaves", variables.establishmentId],
        exact: false,
      });

      const hours = Math.floor(data.minutes / 60);
      const mins = data.minutes % 60;
      const formatted = mins > 0 ? `${hours}h${String(mins).padStart(2, "0")}` : `${hours}h`;
      
      if (data.deleted_shifts_count > 0) {
        toast.success(`R.Extra ${formatted} posé. ${data.deleted_shifts_count} shift(s) supprimé(s).`);
      } else {
        toast.success(`R.Extra ${formatted} posé`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la pose R.Extra");
    },
  });

  const clearRextraMutation = useMutation({
    mutationFn: async (params: ClearRextraParams): Promise<ClearRextraResponse> => {
      const { data, error } = await supabase.functions.invoke("planning-rextra", {
        body: {
          action: "clear_rextra",
          establishment_id: params.establishmentId,
          user_id: params.userId,
          event_date: params.eventDate,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la suppression R.Extra");
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      return data as ClearRextraResponse;
    },
    onSuccess: (data, variables) => {
      // PHASE 2 SSOT: Only invalidate planning-week (which now calculates balance on-the-fly)
      queryClient.invalidateQueries({
        queryKey: ["planning-week", variables.establishmentId],
        exact: false,
      });
      queryClient.invalidateQueries({
        queryKey: ["payroll"],
        exact: false,
      });

      const hours = Math.floor(data.credited_minutes / 60);
      const mins = data.credited_minutes % 60;
      const formatted = mins > 0 ? `${hours}h${String(mins).padStart(2, "0")}` : `${hours}h`;
      
      toast.success(`R.Extra supprimé. ${formatted} recrédité au solde.`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suppression R.Extra");
    },
  });

  return {
    setRextra: setRextraMutation.mutate,
    setRextraAsync: setRextraMutation.mutateAsync,
    clearRextra: clearRextraMutation.mutate,
    clearRextraAsync: clearRextraMutation.mutateAsync,
    isSettingRextra: setRextraMutation.isPending,
    isClearingRextra: clearRextraMutation.isPending,
    isLoading: setRextraMutation.isPending || clearRextraMutation.isPending,
  };
}
