/**
 * useLeaveRequests - Hooks for leave request workflow
 *
 * Queries:
 *   - useMyLeaveRequests: Employee's own requests (pending/approved/rejected)
 *   - useLeaveRequestsManager: Manager view of pending requests
 *
 * Mutations:
 *   - useDeclareLeaveRequest: Create new pending request (salarié)
 *   - useReviewLeaveRequests: Approve/reject requests (manager)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface LeaveRequest {
  id: string;
  user_id: string;
  leave_date: string;
  leave_type: "absence" | "cp";
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  user_name?: string;
}

export interface DeclareLeaveRequestParams {
  leave_type: "absence" | "cp" | "am";
  date_start: string;
  date_end: string;
  reason?: string;
}

export interface ReviewLeaveRequestsParams {
  review_action: "approve" | "reject";
  request_ids: string[];
  comment?: string;
}

export interface LeaveConflictError {
  code: "LEAVE_CONFLICT";
  conflicts_approved: string[];
  conflicts_pending: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY: useMyLeaveRequests (salarié)
// ═══════════════════════════════════════════════════════════════════════════

export function useMyLeaveRequests(monthsBack = 6) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["leave-requests", "my", establishmentId, monthsBack],
    queryFn: async (): Promise<LeaveRequest[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase.functions.invoke("absence-declaration", {
        body: {
          action: "list_my_leave_requests",
          establishment_id: establishmentId,
          months_back: monthsBack,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data.requests || [];
    },
    enabled: !!establishmentId,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY: useLeaveRequestsManager (manager scope)
// For pending requests, we show ALL pending across all months
// For "all" filter, we limit to a specific month for history
// ═══════════════════════════════════════════════════════════════════════════

export function useLeaveRequestsManager(
  yearMonth?: string,
  statusFilter: "pending" | "all" = "pending"
) {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  // For pending filter, month is ignored (show all pending)
  // For all filter, use specified month or current
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const targetMonth = yearMonth || defaultMonth;

  return useQuery({
    queryKey: [
      "leave-requests",
      "manager",
      establishmentId,
      statusFilter === "pending" ? "all-pending" : targetMonth,
      statusFilter,
    ],
    queryFn: async (): Promise<LeaveRequest[]> => {
      if (!establishmentId) return [];

      const { data, error } = await supabase.functions.invoke("absence-declaration", {
        body: {
          action: "list_leave_requests",
          establishment_id: establishmentId,
          // Pass null for year_month when pending to get all pending
          year_month: statusFilter === "pending" ? null : targetMonth,
          status_filter: statusFilter,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data.requests || [];
    },
    enabled: !!establishmentId,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION: useDeclareLeaveRequest (salarié)
// ═══════════════════════════════════════════════════════════════════════════

export function useDeclareLeaveRequest() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useMutation({
    mutationFn: async (params: DeclareLeaveRequestParams) => {
      if (!establishmentId) throw new Error("Établissement non sélectionné");

      const { data, error } = await supabase.functions.invoke("absence-declaration", {
        body: {
          action: "declare_leave_request",
          establishment_id: establishmentId,
          ...params,
        },
      });

      // Parse FunctionsHttpError to extract conflict data from 409 responses
      if (error) {
        if (error instanceof FunctionsHttpError) {
          try {
            const errorBody = await error.context.json();
            if (errorBody?.code === "LEAVE_CONFLICT") {
              const conflictError = new Error(errorBody.error) as Error & LeaveConflictError;
              conflictError.code = "LEAVE_CONFLICT";
              conflictError.conflicts_approved = errorBody.conflicts_approved || [];
              conflictError.conflicts_pending = errorBody.conflicts_pending || [];
              throw conflictError;
            }
            if (errorBody?.error) throw new Error(errorBody.error);
          } catch (parseErr) {
            if (
              parseErr instanceof Error &&
              "code" in parseErr &&
              (parseErr as Record<string, unknown>).code === "LEAVE_CONFLICT"
            )
              throw parseErr;
          }
        }
        throw error;
      }

      // Handle conflict error from 2xx (fallback, shouldn't happen)
      if (data?.code === "LEAVE_CONFLICT") {
        const conflictError = new Error(data.error) as Error & LeaveConflictError;
        conflictError.code = "LEAVE_CONFLICT";
        conflictError.conflicts_approved = data.conflicts_approved || [];
        conflictError.conflicts_pending = data.conflicts_pending || [];
        throw conflictError;
      }

      if (data?.error) throw new Error(data.error);

      return data as { success: boolean; dates: string[]; message: string };
    },
    onSuccess: () => {
      // Invalidate my requests
      queryClient.invalidateQueries({
        queryKey: ["leave-requests", "my", establishmentId],
        exact: false,
      });
      // Invalidate manager view (in case manager is looking)
      queryClient.invalidateQueries({
        queryKey: ["leave-requests", "manager", establishmentId],
        exact: false,
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Une erreur est survenue lors de la demande de congé");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATION: useReviewLeaveRequests (manager)
// ═══════════════════════════════════════════════════════════════════════════

export function useReviewLeaveRequests() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  return useMutation({
    mutationFn: async (params: ReviewLeaveRequestsParams) => {
      if (!establishmentId) throw new Error("Établissement non sélectionné");

      const { data, error } = await supabase.functions.invoke("absence-declaration", {
        body: {
          action: "review_leave_requests",
          establishment_id: establishmentId,
          ...params,
        },
      });

      // Parse FunctionsHttpError to extract conflict data from 409 responses
      if (error) {
        if (error instanceof FunctionsHttpError) {
          try {
            const errorBody = await error.context.json();
            if (errorBody?.code === "LEAVE_CONFLICT") {
              const conflictError = new Error(errorBody.error) as Error & LeaveConflictError;
              conflictError.code = "LEAVE_CONFLICT";
              conflictError.conflicts_approved = errorBody.conflicts_approved || [];
              conflictError.conflicts_pending = errorBody.conflicts_pending || [];
              throw conflictError;
            }
            if (errorBody?.error) throw new Error(errorBody.error);
          } catch (parseErr) {
            if (
              parseErr instanceof Error &&
              "code" in parseErr &&
              (parseErr as Record<string, unknown>).code === "LEAVE_CONFLICT"
            )
              throw parseErr;
          }
        }
        throw error;
      }

      // Handle conflict error from 2xx (fallback)
      if (data?.code === "LEAVE_CONFLICT") {
        const conflictError = new Error(data.error) as Error & LeaveConflictError;
        conflictError.code = "LEAVE_CONFLICT";
        conflictError.conflicts_approved = data.conflicts_approved || [];
        conflictError.conflicts_pending = data.conflicts_pending || [];
        throw conflictError;
      }

      if (data?.error) throw new Error(data.error);

      return data as { success: boolean; approved_count?: number; rejected_count?: number };
    },
    onSuccess: () => {
      // Invalidate manager view
      queryClient.invalidateQueries({
        queryKey: ["leave-requests", "manager", establishmentId],
        exact: false,
      });
      // Invalidate employee views (their requests + absences)
      queryClient.invalidateQueries({
        queryKey: ["leave-requests", "my"],
        exact: false,
      });
      // Invalidate planning (mark_leave was called)
      queryClient.invalidateQueries({
        queryKey: ["planning-week", establishmentId],
        exact: false,
      });
      // Invalidate absences list
      queryClient.invalidateQueries({
        queryKey: ["my-all-absences", establishmentId],
        exact: false,
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Une erreur est survenue lors du traitement de la demande");
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Check if error is a conflict error
// ═══════════════════════════════════════════════════════════════════════════

export function isLeaveConflictError(error: unknown): error is Error & LeaveConflictError {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "LEAVE_CONFLICT" &&
    "conflicts_approved" in error &&
    "conflicts_pending" in error
  );
}
