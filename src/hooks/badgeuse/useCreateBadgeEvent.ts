/**
 * Hook to create badge events (clock_in / clock_out)
 *
 * V5 UNIFIED: Single extra flow at clock_out only
 * - EXTRA_SUSPECTED warning when late departure beyond tolerance
 * - No leave-specific flags
 *
 * V6 PHASE 2.1: Unified cache invalidation for Presence sync
 * V7 IDEMPOTENCY: Debounce + idempotency key to prevent duplicate badge events
 */
import { useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { BadgeEvent } from "@/components/mobile/badgeuse/types/badgeuse.types";
import { invalidatePresenceAndBadgeStatus } from "@/lib/cache/invalidatePresence";

/** Extended error type for badge event failures with backend error codes */
interface BadgeEventError extends Error {
  code?: string;
  planned_end?: string;
  next_shift?: { start_time: string; end_time: string; sequence_index: number } | null;
  shift_start?: string;
  early_limit?: string;
  minutes_early?: number;
}

interface CreateBadgeEventParams {
  establishmentId: string;
  deviceId: string;
  pin?: string;
  selfieCaptured?: boolean;
  earlyExitConfirmed?: boolean; // user confirmed early departure
  extraConfirmed?: boolean; // 2nd call after EXTRA_SUSPECTED modal
  forcePlannedEnd?: boolean; // user chose "No extra" → use planned end time
  earlyExtraConfirmed?: boolean; // V11: user confirmed early arrival is an extra
}

interface CreateBadgeEventResponse {
  success: boolean;
  event: BadgeEvent;
  message: string;
  warning?: string;
  late_minutes?: number | null;
  extra_minutes?: number; // minutes after shift end (for EXTRA_SUSPECTED)
  planned_end?: string; // planned end time HH:mm (for EXTRA_SUSPECTED)
  is_leave_extra?: boolean; // for EXTRA_SUSPECTED on approved leave
  // V14: Double-shift detection fields
  code?: string;
  open_clock_in_time?: string;
  open_clock_in_at?: string;
  planned_end_time?: string;
  sequence_index?: number;
  next_shift_start?: string;
  next_shift_end?: string;
  last_event_time?: string; // DUPLICATE_BADGE
  // V14: Resolve double-shift response fields
  resolved_clock_out?: BadgeEvent;
}

/** V14: Parameters for resolving a double-shift forgotten clock-out */
interface ResolveDoubleShiftParams {
  establishmentId: string;
  deviceId: string;
  clockOutTime: string; // HH:mm
  pin?: string;
  selfieCaptured?: boolean;
}

export type { BadgeEventError };

/** Debounce interval in milliseconds to prevent double-tap badge events */
const BADGE_DEBOUNCE_MS = 3000;

export function useCreateBadgeEvent() {
  const queryClient = useQueryClient();
  const lastBadgeTimestampRef = useRef<number>(0);

  const mutation = useMutation({
    mutationFn: async (params: CreateBadgeEventParams): Promise<CreateBadgeEventResponse> => {
      // Debounce: reject if another badge event was fired within BADGE_DEBOUNCE_MS
      const now = Date.now();
      if (now - lastBadgeTimestampRef.current < BADGE_DEBOUNCE_MS) {
        throw new Error("Pointage en cours, veuillez patienter…");
      }
      lastBadgeTimestampRef.current = now;

      // SESSION GUARD: getSession() returns cached token (may be expired on mobile wake-up).
      // If no session, attempt a refresh before failing.
      let { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.access_token) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr || !refreshed?.session?.access_token) {
          throw new Error("Session expirée — reconnectez-vous");
        }
        sessionData = refreshed;
      }
      const session = sessionData;

      // Generate idempotency key to prevent duplicate events on the server
      const idempotencyKey = `${session.session.user.id}-${now}-${Math.random().toString(36).slice(2)}`;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/badge-events`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          establishment_id: params.establishmentId,
          device_id: params.deviceId,
          pin: params.pin,
          selfie_captured: params.selfieCaptured,
          early_exit_confirmed: params.earlyExitConfirmed,
          extra_confirmed: params.extraConfirmed,
          force_planned_end: params.forcePlannedEnd,
          early_extra_confirmed: params.earlyExtraConfirmed,
        }),
      });

      // Guard: if the edge function returns HTML (502/504 gateway), don't crash on .json()
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          `Erreur réseau (${res.status}). Réessayez dans quelques secondes.`
        );
      }

      const data = await res.json();

      // If server detected a duplicate, treat as a soft warning (not an error)
      if (data?.warning === "duplicate_prevented") {
        if (import.meta.env.DEV) {
          console.warn("[useCreateBadgeEvent] Server prevented duplicate badge event");
        }
        return data as CreateBadgeEventResponse;
      }

      if (!res.ok) {
        const error: BadgeEventError = new Error(data.error || "Failed to create badge event");
        error.code = data.code;
        // SSOT: Map ALL error fields from backend response
        error.planned_end = data.planned_end;
        error.next_shift = data.next_shift; // for SHIFT_FINISHED
        error.shift_start = data.shift_start; // for BADGE_TOO_EARLY
        error.early_limit = data.early_limit; // for BADGE_TOO_EARLY
        error.minutes_early = data.minutes_early; // for BADGE_TOO_EARLY
        throw error;
      }

      return data as CreateBadgeEventResponse;
    },
    onSuccess: (data, variables) => {
      // ✅ PHASE 2.1: Invalidate badge-status (for badgeuse UI)
      queryClient.invalidateQueries({
        queryKey: ["badge-status", variables.establishmentId],
        exact: false,
      });

      // ✅ PHASE 2.1: Also invalidate presence for admin views
      // Extract day_date from the created event
      const dayDate = data.event?.day_date;
      if (dayDate) {
        invalidatePresenceAndBadgeStatus({
          queryClient,
          establishmentId: variables.establishmentId,
          dayDate,
        });
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Une erreur est survenue lors du pointage");
    },
  });

  /** Check if a badge action is currently debounced (within BADGE_DEBOUNCE_MS of last call) */
  const isBadgeDebounced = useCallback(() => {
    return Date.now() - lastBadgeTimestampRef.current < BADGE_DEBOUNCE_MS;
  }, []);

  return { ...mutation, isBadgeDebounced };
}

/**
 * V14: Hook to resolve double-shift forgotten clock-out
 * Calls the resolve_double_shift action on the badge-events edge function
 */
export function useResolveDoubleShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: ResolveDoubleShiftParams): Promise<CreateBadgeEventResponse> => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error("Not authenticated");
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/badge-events`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "resolve_double_shift",
          establishment_id: params.establishmentId,
          device_id: params.deviceId,
          resolve_type: "forgot_clockout",
          clock_out_time: params.clockOutTime,
          pin: params.pin,
          selfie_captured: params.selfieCaptured,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const error: BadgeEventError = new Error(data.error || "Failed to resolve double shift");
        error.code = data.code;
        throw error;
      }

      return data as CreateBadgeEventResponse;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["badge-status", variables.establishmentId],
        exact: false,
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la resolution du double shift");
    },
  });
}
