/**
 * Hook for fetching and upserting a single cash day report
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CashDayReport, CashDayFormValues } from "../utils/types";
import { calculateCA } from "../utils/money";

interface UseCashDayParams {
  establishmentId: string | null;
  dayDate: string; // YYYY-MM-DD
}

export function useCashDay({ establishmentId, dayDate }: UseCashDayParams) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = ["cash-day", establishmentId, dayDate];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<CashDayReport | null> => {
      if (!establishmentId || !dayDate) return null;

      const { data, error } = await supabase
        .from("cash_day_reports")
        .select("*")
        .eq("establishment_id", establishmentId)
        .eq("day_date", dayDate)
        .maybeSingle();

      if (error) {
        if (import.meta.env.DEV) console.error("Error fetching cash day:", error);
        throw error;
      }

      return data as CashDayReport | null;
    },
    enabled: !!establishmentId && !!dayDate,
  });

  const upsertMutation = useMutation({
    mutationFn: async (values: CashDayFormValues) => {
      if (!establishmentId || !dayDate || !user?.id) {
        throw new Error("Missing required data");
      }

      // total_eur stores pure CA (revenue): CB + Especes + Livraison
      const total_eur = calculateCA(values);

      const payload = {
        establishment_id: establishmentId,
        day_date: dayDate,
        cb_eur: values.cb_eur,
        cash_eur: values.cash_eur,
        delivery_eur: values.delivery_eur,
        courses_eur: values.courses_eur,
        maintenance_eur: values.maintenance_eur,
        shortage_eur: values.shortage_eur,
        advance_eur: values.advance_eur ?? 0,
        advance_employee_id: values.advance_employee_id ?? null,
        total_eur,
        note: values.note || null,
        updated_by: user.id,
        ...(query.data ? {} : { created_by: user.id }),
      };

      const { data, error } = await supabase
        .from("cash_day_reports")
        .upsert(payload, {
          onConflict: "establishment_id,day_date",
        })
        .select()
        .single();

      if (error) {
        if (import.meta.env.DEV) console.error("Error upserting cash day:", error);
        throw error;
      }

      return data as CashDayReport;
    },
    onSuccess: () => {
      toast.success("Caisse enregistrée");
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["cash-month", establishmentId] });
    },
    onError: (error: Error) => {
      if (import.meta.env.DEV) console.error("Upsert error:", error);
      if (error.message?.includes("row-level security")) {
        toast.error("Permission refusée. Vous ne pouvez modifier que le jour en cours.");
      } else {
        toast.error("Erreur lors de l'enregistrement");
      }
    },
  });

  return {
    report: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    save: upsertMutation.mutate,
    isSaving: upsertMutation.isPending,
  };
}
