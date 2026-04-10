/**
 * usePrefetchAdjacentWeeks
 *
 * NIVEAU 3 OPTIMISATION: Prefetch semaine -1 / +1
 *
 * Hook dédié (~60 lignes) qui prefetch les semaines adjacentes
 * dès que les données de la semaine courante sont disponibles.
 *
 * RÈGLES:
 * - Non-bloquant (pas d'état UI)
 * - Silencieux (pas de toast/log)
 * - Annulable naturellement (React Query gère)
 * - Ne modifie PAS usePlanningWeek métier
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlanningWeekData } from "@/components/planning/types/planning.types";

/**
 * Calcule le lundi de la semaine précédente
 */
function getPrevWeekStart(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() - 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Calcule le lundi de la semaine suivante
 */
function getNextWeekStart(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Fonction de fetch identique à usePlanningWeek
 * (extraite pour réutilisation dans prefetch)
 */
async function fetchPlanningWeek(
  establishmentId: string,
  weekStart: string
): Promise<PlanningWeekData> {
  const { data, error } = await supabase.functions.invoke("planning-week", {
    body: {
      action: "get_week",
      establishment_id: establishmentId,
      week_start: weekStart,
    },
  });

  if (error) {
    throw new Error(error.message || "Erreur lors du chargement du planning");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as PlanningWeekData;
}

interface UsePrefetchAdjacentWeeksParams {
  establishmentId: string | null;
  weekStart: string | null;
  enabled: boolean;
}

export function usePrefetchAdjacentWeeks({
  establishmentId,
  weekStart,
  enabled,
}: UsePrefetchAdjacentWeeksParams) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !establishmentId || !weekStart) {
      return;
    }

    const prevWeek = getPrevWeekStart(weekStart);
    const nextWeek = getNextWeekStart(weekStart);

    // Prefetch silencieux semaine -1
    // PER-EMP-029: 4th query key element "all" matches usePlanningWeek when no team_ids
    queryClient.prefetchQuery({
      queryKey: ["planning-week", establishmentId, prevWeek, "all"],
      queryFn: () => fetchPlanningWeek(establishmentId, prevWeek),
      staleTime: 60000,
    });

    // Prefetch silencieux semaine +1
    queryClient.prefetchQuery({
      queryKey: ["planning-week", establishmentId, nextWeek, "all"],
      queryFn: () => fetchPlanningWeek(establishmentId, nextWeek),
      staleTime: 60000,
    });
  }, [enabled, establishmentId, weekStart, queryClient]);
}
