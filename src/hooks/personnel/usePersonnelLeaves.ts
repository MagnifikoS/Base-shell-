import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type LeaveType = "cp" | "absence" | "rest" | "am";

export interface PersonnelLeave {
  id: string;
  user_id: string;
  leave_date: string;
  leave_type: LeaveType;
  status: "approved" | "cancelled";
  reason: string | null;
}

interface UseLeavesRangeParams {
  establishmentId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

/**
 * Fetch approved leaves for a date range and establishment
 * Query key: ["personnel-leaves", establishmentId, dateFrom, dateTo]
 */
export function usePersonnelLeavesRange({
  establishmentId,
  dateFrom,
  dateTo,
}: UseLeavesRangeParams) {
  return useQuery({
    queryKey: ["personnel-leaves", establishmentId, dateFrom, dateTo],
    queryFn: async (): Promise<PersonnelLeave[]> => {
      if (!establishmentId || !dateFrom || !dateTo) {
        return [];
      }

      const { data, error } = await supabase
        .from("personnel_leaves")
        .select("id, user_id, leave_date, leave_type, status, reason")
        .eq("establishment_id", establishmentId)
        .eq("status", "approved")
        .gte("leave_date", dateFrom)
        .lte("leave_date", dateTo);

      if (error) {
        throw new Error(error.message);
      }

      return (data || []) as PersonnelLeave[];
    },
    enabled: !!establishmentId && !!dateFrom && !!dateTo,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });
}

interface CreateLeaveParams {
  establishmentId: string;
  userId: string;
  leaveDate: string;
  leaveType: LeaveType;
  reason?: string;
}

interface CancelLeaveParams {
  userId: string;
  leaveDate: string;
  leaveType: LeaveType;
}

interface MutationContext {
  establishmentId: string;
  weekStart: string;
}

/**
 * Mutations for creating and canceling leaves
 * Uses edge function for mark_leave (Option A: also deletes shifts)
 */
export function usePersonnelLeavesMutations() {
  const queryClient = useQueryClient();

  const createLeaveMutation = useMutation({
    mutationFn: async (params: CreateLeaveParams & MutationContext) => {
      // Call edge function to mark leave + delete shifts atomically
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "mark_leave",
          establishment_id: params.establishmentId,
          user_id: params.userId,
          leave_date: params.leaveDate,
          leave_type: params.leaveType,
        },
      });

      if (error) {
        throw new Error(error.message || "Erreur lors du marquage");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate both leaves and planning queries
      queryClient.invalidateQueries({
        queryKey: ["personnel-leaves", variables.establishmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["planning-week", variables.establishmentId, variables.weekStart],
      });

      const deletedCount = data?.deleted_shifts_count ?? 0;
      const leaveLabel =
        variables.leaveType === "cp"
          ? "CP"
          : variables.leaveType === "rest"
            ? "Repos"
            : variables.leaveType === "am"
              ? "Arrêt maladie"
              : "Absence";

      if (deletedCount > 0) {
        toast.success(
          `${leaveLabel} marqué. ${deletedCount} shift${deletedCount > 1 ? "s" : ""} supprimé${deletedCount > 1 ? "s" : ""}.`
        );
      } else {
        toast.success(`${leaveLabel} marqué avec succès`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors du marquage");
    },
  });

  const cancelLeaveMutation = useMutation({
    mutationFn: async (params: CancelLeaveParams & MutationContext) => {
      // ✅ SSOT: Appel Edge Function planning-week action cancel_leave
      const { data, error } = await supabase.functions.invoke("planning-week", {
        body: {
          action: "cancel_leave",
          establishment_id: params.establishmentId,
          user_id: params.userId,
          leave_date: params.leaveDate,
          leave_type: params.leaveType,
        },
      });

      if (error) {
        if (import.meta.env.DEV) console.error("[cancelLeave] Edge error:", error);
        throw new Error(error.message || "Erreur lors de l'annulation");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return { success: true, wasAlreadyCancelled: data?.was_already_cancelled ?? false };
    },
    onSuccess: (_data, variables) => {
      // Invalidate leaves, planning-week, AND my-all-absences (for Congés & Absences module)
      queryClient.invalidateQueries({
        queryKey: ["personnel-leaves", variables.establishmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["planning-week", variables.establishmentId, variables.weekStart],
      });
      // Invalidate employee absence view (same session)
      queryClient.invalidateQueries({
        queryKey: ["my-all-absences", variables.establishmentId],
        exact: false,
      });
      toast.success("Congé/Absence annulé");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'annulation");
    },
  });

  return {
    createLeave: createLeaveMutation.mutate,
    cancelLeave: cancelLeaveMutation.mutate,
    cancelLeaveAsync: cancelLeaveMutation.mutateAsync,
    isCreating: createLeaveMutation.isPending,
    isCanceling: cancelLeaveMutation.isPending,
  };
}

/**
 * Build a quick-access Map for leaves: key = "userId|date" -> leave
 */
export function buildLeavesMap(leaves: PersonnelLeave[]): Map<string, PersonnelLeave> {
  const map = new Map<string, PersonnelLeave>();
  for (const leave of leaves) {
    const key = `${leave.user_id}|${leave.leave_date}`;
    map.set(key, leave);
  }
  return map;
}
