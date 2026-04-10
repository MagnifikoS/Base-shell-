import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DayPart, DayPartsNormalized } from "../types/establishment-hours.types";
import { normalizeDayParts } from "../types/establishment-hours.types";

const QUERY_OPTIONS = {
  staleTime: 60000,
  refetchOnWindowFocus: false,
  retry: false,
};

async function callEdgeFunction(action: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Non authentifié");

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/establishment-hours`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Erreur serveur");
  }

  return response.json();
}

// Hook pour l'admin (liste complète pour édition)
export function useDayParts(establishmentId: string | null) {
  return useQuery({
    queryKey: ["establishment-day-parts", establishmentId],
    queryFn: async () => {
      if (!establishmentId) return [];
      const result = await callEdgeFunction("get_day_parts", { establishment_id: establishmentId });
      return result.day_parts as DayPart[];
    },
    enabled: !!establishmentId,
    ...QUERY_OPTIONS,
  });
}

// Hook simplifié pour le planning (format normalisé, lecture seule)
export function useDayPartsNormalized(establishmentId: string | null) {
  return useQuery<DayPartsNormalized>({
    queryKey: ["establishment-day-parts-normalized", establishmentId],
    queryFn: async () => {
      if (!establishmentId) {
        return { morning: null, midday: null, evening: null };
      }
      const result = await callEdgeFunction("get_day_parts", { establishment_id: establishmentId });
      return normalizeDayParts(result.day_parts as DayPart[]);
    },
    enabled: !!establishmentId,
    ...QUERY_OPTIONS,
  });
}

export function useUpsertDayParts(establishmentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (parts: Omit<DayPart, "id">[]) => {
      if (!establishmentId) throw new Error("Établissement non sélectionné");
      return callEdgeFunction("upsert_day_parts", {
        establishment_id: establishmentId,
        parts,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["establishment-day-parts", establishmentId] });
      toast.success("Horaires de journée enregistrés");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
