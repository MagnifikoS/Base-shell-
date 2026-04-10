/**
 * Hook for invoking the badgeuse-backfill edge function
 * ISOLATED: Can be deleted without affecting other modules
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BackfillParams {
  establishmentId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  mode: "skip" | "replace"; // skip = don't overwrite, replace = delete then recreate
}

export interface BackfillPreview {
  days_covered: number;
  shifts_found: number;
  events_to_create: number;
}

export interface BackfillResult {
  success: boolean;
  created_count: number;
  skipped_count: number;
  deleted_count: number;
  days_covered: number;
  errors?: string[];
}

export function useBadgeuseBackfill() {
  const queryClient = useQueryClient();

  /**
   * Preview: count shifts in the date range (dry-run)
   */
  const previewMutation = useMutation({
    mutationFn: async (params: Omit<BackfillParams, "mode">): Promise<BackfillPreview> => {
      const { data, error } = await supabase.functions.invoke("badgeuse-backfill", {
        method: "POST",
        body: {
          establishment_id: params.establishmentId,
          start_date: params.startDate,
          end_date: params.endDate,
          preview: true,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la prévisualisation");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return {
        days_covered: data.days_covered || 0,
        shifts_found: data.shifts_found || 0,
        events_to_create: data.events_to_create || 0,
      };
    },
    onError: (error: Error) => {
      toast.error(error.message || "Une erreur est survenue lors de la prévisualisation");
    },
  });

  /**
   * Execute: actually create the badge events
   */
  const executeMutation = useMutation({
    mutationFn: async (params: BackfillParams): Promise<BackfillResult> => {
      const { data, error } = await supabase.functions.invoke("badgeuse-backfill", {
        method: "POST",
        body: {
          establishment_id: params.establishmentId,
          start_date: params.startDate,
          end_date: params.endDate,
          mode: params.mode,
          preview: false,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors du backfill");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return {
        success: true,
        created_count: data.created_count || 0,
        skipped_count: data.skipped_count || 0,
        deleted_count: data.deleted_count || 0,
        days_covered: data.days_covered || 0,
        errors: data.errors,
      };
    },
    onSuccess: (result, params) => {
      const parts: string[] = [];
      if (result.deleted_count > 0) parts.push(`${result.deleted_count} supprimé(s)`);
      parts.push(`${result.created_count} créé(s)`);
      if (result.skipped_count > 0) parts.push(`${result.skipped_count} ignoré(s)`);
      toast.success(`Backfill terminé : ${parts.join(", ")}`);
      // Invalidate history queries for the affected date range
      queryClient.invalidateQueries({ queryKey: ["badgeuse-history", params.establishmentId] });
      // Also invalidate presence queries
      queryClient.invalidateQueries({ queryKey: ["presence"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return {
    preview: previewMutation,
    execute: executeMutation,
    isPreviewing: previewMutation.isPending,
    isExecuting: executeMutation.isPending,
  };
}
