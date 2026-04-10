import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { WeeklyHour, OpeningException, NormalizedHours } from "../types/establishment-hours.types";

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

export function useWeeklyHours(establishmentId: string | null) {
  return useQuery({
    queryKey: ["establishment-hours", establishmentId],
    queryFn: async () => {
      if (!establishmentId) return [];
      const result = await callEdgeFunction("get_weekly_hours", { establishment_id: establishmentId });
      return result.hours as WeeklyHour[];
    },
    enabled: !!establishmentId,
    ...QUERY_OPTIONS,
  });
}

export function useExceptions(establishmentId: string | null) {
  return useQuery({
    queryKey: ["establishment-exceptions", establishmentId],
    queryFn: async () => {
      if (!establishmentId) return [];
      const result = await callEdgeFunction("get_exceptions", { establishment_id: establishmentId });
      return result.exceptions as OpeningException[];
    },
    enabled: !!establishmentId,
    ...QUERY_OPTIONS,
  });
}

export function useNormalizedHours(establishmentId: string | null, weekStart: string | null) {
  return useQuery({
    queryKey: ["establishment-normalized-hours", establishmentId, weekStart],
    queryFn: async () => {
      if (!establishmentId || !weekStart) return null;
      const result = await callEdgeFunction("get_hours", {
        establishment_id: establishmentId,
        week_start: weekStart,
      });
      return result as NormalizedHours;
    },
    enabled: !!establishmentId && !!weekStart,
    ...QUERY_OPTIONS,
  });
}

export function useUpdateWeeklyHours(establishmentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (hours: WeeklyHour[]) => {
      if (!establishmentId) throw new Error("Établissement non sélectionné");
      return callEdgeFunction("update_weekly_hours", {
        establishment_id: establishmentId,
        hours,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["establishment-hours", establishmentId] });
      toast.success("Horaires mis à jour");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useAddException(establishmentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (exception: Omit<OpeningException, "id">) => {
      if (!establishmentId) throw new Error("Établissement non sélectionné");
      return callEdgeFunction("add_exception", {
        establishment_id: establishmentId,
        ...exception,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["establishment-exceptions", establishmentId] });
      toast.success("Exception ajoutée");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useRemoveException(establishmentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (exceptionId: string) => {
      if (!establishmentId) throw new Error("Établissement non sélectionné");
      return callEdgeFunction("remove_exception", {
        establishment_id: establishmentId,
        exception_id: exceptionId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["establishment-exceptions", establishmentId] });
      toast.success("Exception supprimée");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
