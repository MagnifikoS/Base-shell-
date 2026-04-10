/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Hook useBrainHealth (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Hook React pour charger les données de santé THE BRAIN.
 * Pas de polling, pas de subscription temps réel.
 */

import { useQuery } from "@tanstack/react-query";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  getHealthSummary,
  getSubjectsSummary,
  getRecentEvents,
} from "../services/theBrainService";
import type { DateRange, HealthSummary, SubjectSummary, BrainEvent } from "../types";

interface UseBrainHealthOptions {
  range: DateRange;
  enabled?: boolean;
}

interface UseBrainHealthResult {
  summary: HealthSummary | null;
  subjects: SubjectSummary[];
  recentEvents: BrainEvent[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useBrainHealth({
  range,
  enabled = true,
}: UseBrainHealthOptions): UseBrainHealthResult {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  // Query pour le résumé de santé
  const summaryQuery = useQuery({
    queryKey: ["brain-health-summary", establishmentId, range],
    queryFn: () => getHealthSummary(establishmentId!, range),
    enabled: enabled && !!establishmentId,
    staleTime: 30_000, // 30 secondes
  });

  // Query pour les sujets
  const subjectsQuery = useQuery({
    queryKey: ["brain-subjects-summary", establishmentId, range],
    queryFn: () => getSubjectsSummary(establishmentId!, range),
    enabled: enabled && !!establishmentId,
    staleTime: 30_000,
  });

  // Query pour les événements récents
  const eventsQuery = useQuery({
    queryKey: ["brain-recent-events", establishmentId],
    queryFn: () => getRecentEvents(establishmentId!, 50),
    enabled: enabled && !!establishmentId,
    staleTime: 30_000,
  });

  const refetch = () => {
    summaryQuery.refetch();
    subjectsQuery.refetch();
    eventsQuery.refetch();
  };

  return {
    summary: summaryQuery.data ?? null,
    subjects: subjectsQuery.data ?? [],
    recentEvents: eventsQuery.data ?? [],
    isLoading: summaryQuery.isLoading || subjectsQuery.isLoading || eventsQuery.isLoading,
    error: summaryQuery.error?.message ?? subjectsQuery.error?.message ?? eventsQuery.error?.message ?? null,
    refetch,
  };
}
