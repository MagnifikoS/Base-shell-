import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PlanningWeekData } from "../types/planning.types";

interface ValidateDayParams {
  establishmentId: string;
  weekStart: string;
  date: string;
  validated: boolean;
}

interface ValidateWeekParams {
  establishmentId: string;
  weekStart: string;
  validated: boolean;
}

export function useValidateDay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ValidateDayParams): Promise<{ success: boolean }> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "validate_day",
          establishment_id: params.establishmentId,
          date: params.date,
          validated: params.validated,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la validation");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as { success: boolean };
    },

    onMutate: async (params) => {
      const queryKey = ["planning-week", params.establishmentId, params.weekStart];

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousData = queryClient.getQueryData<PlanningWeekData>(queryKey);

      // Optimistic update
      if (previousData) {
        const newData: PlanningWeekData = {
          ...previousData,
          validation: {
            ...previousData.validation,
            validatedDays: {
              ...previousData.validation.validatedDays,
              [params.date]: params.validated,
            },
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }

      return { previousData, queryKey };
    },

    onError: (error, _params, context) => {
      // Rollback
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      toast.error(error.message || "Erreur lors de la validation");
    },

    onSuccess: (_data, params) => {
      toast.success(params.validated ? "Jour validé" : "Validation retirée");
    },
  });
}

export function useValidateWeek() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ValidateWeekParams): Promise<{ success: boolean }> => {
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "validate_week",
          establishment_id: params.establishmentId,
          week_start: params.weekStart,
          validated: params.validated,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors de la validation");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as { success: boolean };
    },

    onMutate: async (params) => {
      const queryKey = ["planning-week", params.establishmentId, params.weekStart];

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousData = queryClient.getQueryData<PlanningWeekData>(queryKey);

      // Optimistic update avec logique propre:
      // - Validation: weekValidated=true, weekInvalidatedAt=null, autoPublishActive inchangé
      // - Invalidation: weekValidated=false, weekInvalidatedAt=now, autoPublishActive=false (override)
      if (previousData) {
        const newData: PlanningWeekData = {
          ...previousData,
          validation: {
            ...previousData.validation,
            weekValidated: params.validated,
            // L'invalidation manuelle SET week_invalidated_at (override auto-publish)
            weekInvalidatedAt: params.validated ? null : new Date().toISOString(),
            // Si on invalide, autoPublishActive devient false (l'override prend le dessus)
            autoPublishActive: params.validated ? previousData.validation.autoPublishActive : false,
          },
        };

        queryClient.setQueryData(queryKey, newData);
      }

      return { previousData, queryKey };
    },

    onError: (error, _params, context) => {
      // Rollback
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      toast.error(error.message || "Erreur lors de la validation");
    },

    onSuccess: (_data, params, context) => {
      toast.success(params.validated ? "Semaine validée" : "Validation semaine retirée");
      // Force refetch pour synchroniser avec le backend
      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey });
      }
    },
  });
}
