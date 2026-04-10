/**
 * Admin badge mutations: DELETE, UPDATE, CREATE, RESET_DAY
 * All actions go through the badge-events edge function via supabase.functions.invoke
 * Uses POST with body.action to avoid iOS DELETE/PATCH issues
 * V2: Handle EXTRA_SUSPECTED warning for clock_out create/update
 * V3: PHASE 2.1 - Unified cache invalidation via invalidatePresenceAndBadgeStatus
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import { invalidatePresenceAndBadgeStatus } from "@/lib/cache/invalidatePresence";
import { useBlockingDialog } from "@/contexts/BlockingDialogContext";

interface DeleteBadgeParams {
  badgeEventId: string;
  /** Optional: override day_date for cache invalidation (history mode) */
  dayDate?: string;
}

interface PatchBadgeParams {
  badgeEventId: string;
  occurredAt: string; // ISO string
  extra_confirmed?: boolean;
  force_planned_end?: boolean;
  early_exit_confirmed?: boolean;
  /** Optional: day_date of the badge event (for historical edits) */
  dayDate?: string;
}

interface CreateBadgeParams {
  targetUserId: string;
  eventType: "clock_in" | "clock_out";
  occurredAt: string; // ISO string
  sequenceIndex?: number;
  extra_confirmed?: boolean;
  force_planned_end?: boolean;
  early_exit_confirmed?: boolean;
  early_arrival_confirmed?: boolean; // For BADGE_TOO_EARLY confirmation
}

interface ResetDayParams {
  targetUserId: string;
  /** Optional: override day_date for historical reset (history mode) */
  dayDate?: string;
}

// Result types for typed handling
export type AdminMutationResult =
  | { kind: "success"; event?: unknown; _estId?: string; _date: string }
  | {
      kind: "warning";
      warning: string;
      planned_end?: string;
      extra_minutes?: number;
      _estId?: string;
      _date: string;
    }
  | {
      kind: "early_departure";
      planned_end?: string;
      early_minutes?: number;
      _estId?: string;
      _date: string;
    }
  | {
      kind: "badge_too_early";
      shift_start: string;
      minutes_early: number;
      early_limit: number;
      _estId?: string;
      _date: string;
    }
  | { kind: "error"; code?: string; message: string };

/**
 * Map error codes to French messages
 */
function getErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "NOT_ADMIN":
      return "Action réservée aux administrateurs";
    case "OUT_OF_SCOPE":
      return "Accès non autorisé pour cet établissement";
    case "ADMIN_EDIT_DATE_FORBIDDEN":
      return "La date doit correspondre à la journée de service du pointage";
    case "BADGE_NOT_FOUND":
      return "Pointage introuvable";
    case "BADGE_CONFLICT":
      // More specific message based on the fallback
      if (fallback.includes("clock_out without")) {
        return "Impossible de créer un départ sans entrée préalable";
      }
      if (fallback.includes("Already clocked in")) {
        return "Entrée déjà enregistrée pour ce shift";
      }
      if (fallback.includes("Already clocked out")) {
        return "La sortie est déjà badgée pour ce shift";
      }
      return "Conflit de pointage";
    case "MAX_SHIFTS":
      return "Maximum 2 shifts par jour atteint";
    case "INVALID_JSON_BODY":
      return "Erreur de communication avec le serveur";
    case "DATA_INCONSISTENT_DUPLICATE_EVENTS":
      return "Données incohérentes détectées. Utilisez 'Reset day' pour corriger.";
    case "USER_NOT_IN_ESTABLISHMENT":
      return "L'utilisateur n'est pas rattaché à cet établissement";
    case "FUTURE_BADGE_BLOCKED":
      return fallback; // Use the detailed message from the server
    case "DEPARTURE_BEFORE_ARRIVAL":
      return "L'heure de sortie doit être après l'heure d'arrivée";
    case "ARRIVAL_AFTER_DEPARTURE":
      return "L'heure d'arrivée doit être avant l'heure de sortie";
    default:
      return fallback;
  }
}

/**
 * Get the Monday of the week containing the given date (YYYY-MM-DD)
 */
function _getWeekStart(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(date.setDate(diff));
  const year = monday.getFullYear();
  const month = (monday.getMonth() + 1).toString().padStart(2, "0");
  const dayOfMonth = monday.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

export function useAdminBadgeMutations(establishmentIdOverride?: string) {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const { showBlockingDialog } = useBlockingDialog();

  // ✅ SINGLE TRUTH: desktop passes override, mobile uses context
  const establishmentId = establishmentIdOverride ?? activeEstablishment?.id;

  /**
   * ✅ SINGLE SOURCE OF TRUTH (backend): resolve the service day for an arbitrary timestamp.
   * This prevents any residual calendar-day logic on the frontend (critical for cutoff/overnight).
   */
  const resolveServiceDayForTimestamp = async (estId: string, tsISO: string): Promise<string> => {
    const { data, error } = await supabase.rpc("get_service_day", {
      _establishment_id: estId,
      _ts: tsISO,
    });

    if (error || !data || typeof data !== "string") {
      // Fallback is best-effort only; should not happen in normal conditions.
      // Use current date string as last resort (no local calendar logic)
      if (import.meta.env.DEV) {
        console.warn("[getServiceDay] RPC fallback", {
          estId,
          tsISO,
          error,
          data,
        });
      }
      // Return ISO date portion as fallback (not ideal, but avoids crash)
      return tsISO.slice(0, 10);
    }

    return data;
  };

  /**
   * DELETE a badge event using POST action to avoid iOS DELETE issues
   * Captures establishmentId and today at call time to ensure correct invalidation
   */
  const deleteBadge = useMutation({
    mutationFn: async ({
      badgeEventId,
      dayDate,
    }: DeleteBadgeParams): Promise<AdminMutationResult> => {
      // Use resolved establishmentId for correct invalidation
      const estId = establishmentId;
      // Use provided dayDate (history mode) or resolve via RPC (today mode)
      const date = dayDate
        ? dayDate
        : estId
          ? await resolveServiceDayForTimestamp(estId, new Date().toISOString())
          : "";

      if (!badgeEventId || badgeEventId.trim() === "") {
        return { kind: "error", message: "ID du pointage manquant" };
      }

      const { data, error } = await supabase.functions.invoke("badge-events", {
        method: "POST",
        body: { action: "admin_delete", id: badgeEventId },
      });

      if (error) {
        if (error.message?.includes("CORS") || error.message?.includes("Failed to fetch")) {
          return { kind: "error", message: "Connexion au serveur impossible" };
        }
        return { kind: "error", message: error.message || "Suppression impossible" };
      }

      if (data && !data.success && data.error) {
        return { kind: "error", code: data.code, message: getErrorMessage(data.code, data.error) };
      }

      return { kind: "success", event: data, _estId: estId, _date: date };
    },
    onSuccess: (result) => {
      if (result.kind === "success") {
        toast.success("Pointage supprimé");
        // ✅ PHASE 2.1: Unified invalidation with REAL dayDate
        invalidatePresenceAndBadgeStatus({
          queryClient,
          establishmentId: result._estId,
          dayDate: result._date,
        });
      } else if (result.kind === "error") {
        toast.error(result.message);
      }
    },
  });

  /**
   * UPDATE a badge event's occurred_at using POST action
   * V2: Handle EXTRA_SUSPECTED warning for clock_out
   * OPTION B: Supports historical date edits (pass dayDate for correct invalidation)
   */
  const updateBadge = useMutation({
    mutationFn: async ({
      badgeEventId,
      occurredAt,
      extra_confirmed,
      force_planned_end,
      early_exit_confirmed,
      dayDate,
    }: PatchBadgeParams): Promise<AdminMutationResult> => {
      const estId = establishmentId;
      // OPTION B: Use provided dayDate or fallback to service day RPC
      const date = dayDate || (estId ? await resolveServiceDayForTimestamp(estId, occurredAt) : "");

      if (!badgeEventId || badgeEventId.trim() === "") {
        return { kind: "error", message: "ID du pointage manquant" };
      }

      const { data, error } = await supabase.functions.invoke("badge-events", {
        method: "POST",
        body: {
          action: "admin_update",
          id: badgeEventId,
          occurred_at: occurredAt,
          extra_confirmed,
          force_planned_end,
          early_exit_confirmed,
        },
      });

      // ⚠️ IMPORTANT: Check data.error FIRST - Supabase SDK puts JSON body in `data` even for 4xx errors
      // The `error` object just contains a generic message like "Edge Function returned a non-2xx status code"
      if (data && data.error) {
        const code = data.code as string | undefined;
        const msg = getErrorMessage(code, data.error);
        // Show blocking popup for specific error codes
        if (code === "BADGE_CONFLICT" || code === "FUTURE_BADGE_BLOCKED") {
          showBlockingDialog({
            title: code === "FUTURE_BADGE_BLOCKED" ? "Badge non valide" : "Conflit de pointage",
            message: msg,
          });
        }
        return { kind: "error", code, message: msg };
      }

      if (error) {
        if (error.message?.includes("CORS") || error.message?.includes("Failed to fetch")) {
          return { kind: "error", message: "Connexion au serveur impossible" };
        }
        return { kind: "error", message: error.message || "Modification impossible" };
      }

      // Handle SHIFT_NOT_FINISHED (early departure)
      if (data && data.code === "SHIFT_NOT_FINISHED") {
        return {
          kind: "early_departure",
          planned_end: data.planned_end,
          early_minutes: data.early_minutes,
          _estId: estId,
          _date: date,
        };
      }

      // Handle EXTRA_SUSPECTED warning (1st call)
      if (data && data.warning === "EXTRA_SUSPECTED") {
        return {
          kind: "warning",
          warning: "EXTRA_SUSPECTED",
          planned_end: data.planned_end,
          extra_minutes: data.extra_minutes,
          _estId: estId,
          _date: date,
        };
      }

      // Handle BADGE_TOO_EARLY warning (1st call for clock_in update)
      if (data && (data.code === "BADGE_TOO_EARLY" || data.warning === "BADGE_TOO_EARLY")) {
        return {
          kind: "badge_too_early",
          shift_start: data.shift_start,
          minutes_early: data.minutes_early,
          early_limit: data.early_limit,
          _estId: estId,
          _date: date,
        };
      }

      return { kind: "success", event: data.event, _estId: estId, _date: date };
    },
    onSuccess: (result) => {
      if (result.kind === "success") {
        toast.success("Pointage modifié");
        // ✅ PHASE 2.1: Unified invalidation with REAL dayDate
        invalidatePresenceAndBadgeStatus({
          queryClient,
          establishmentId: result._estId,
          dayDate: result._date,
        });
      } else if (result.kind === "error") {
        if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
          toast.error(result.message);
        }
      }
      // Note: "warning" kind is handled by caller (UI shows ExtraTimeModal)
    },
  });

  /**
   * CREATE a badge for another user (admin action)
   * V2: Handle EXTRA_SUSPECTED warning for clock_out
   */
  const createBadge = useMutation({
    mutationFn: async ({
      targetUserId,
      eventType,
      occurredAt,
      sequenceIndex,
      extra_confirmed,
      force_planned_end,
      early_exit_confirmed,
      early_arrival_confirmed,
    }: CreateBadgeParams): Promise<AdminMutationResult> => {
      const estId = establishmentId;
      if (!estId) return { kind: "error", message: "Aucun établissement sélectionné" };

      // ✅ Use service-day from backend (NOT calendar day)
      const date = await resolveServiceDayForTimestamp(estId, occurredAt);
      if (!targetUserId) return { kind: "error", message: "Utilisateur cible manquant" };

      const { data, error } = await supabase.functions.invoke("badge-events", {
        method: "POST",
        body: {
          action: "admin_create",
          establishment_id: estId,
          target_user_id: targetUserId,
          event_type: eventType,
          occurred_at: occurredAt,
          day_date: date,
          sequence_index: sequenceIndex,
          extra_confirmed,
          force_planned_end,
          early_exit_confirmed,
          early_arrival_confirmed,
        },
      });

      // ⚠️ IMPORTANT: Check data.error FIRST - Supabase SDK puts JSON body in `data` even for 4xx errors
      if (data && data.error) {
        const code = data.code as string | undefined;
        const msg = getErrorMessage(code, data.error);
        // Show blocking popup for specific error codes
        if (code === "BADGE_CONFLICT" || code === "FUTURE_BADGE_BLOCKED") {
          showBlockingDialog({
            title: code === "FUTURE_BADGE_BLOCKED" ? "Badge non valide" : "Conflit de pointage",
            message: msg,
          });
        }
        return { kind: "error", code, message: msg };
      }

      if (error) {
        if (error.message?.includes("CORS") || error.message?.includes("Failed to fetch")) {
          return { kind: "error", message: "Connexion au serveur impossible" };
        }
        return { kind: "error", message: error.message || "Création impossible" };
      }

      // Handle SHIFT_NOT_FINISHED (early departure)
      if (data && data.code === "SHIFT_NOT_FINISHED") {
        return {
          kind: "early_departure",
          planned_end: data.planned_end,
          early_minutes: data.early_minutes,
          _estId: estId,
          _date: date,
        };
      }

      // Handle EXTRA_SUSPECTED warning (1st call)
      if (data && data.warning === "EXTRA_SUSPECTED") {
        return {
          kind: "warning",
          warning: "EXTRA_SUSPECTED",
          planned_end: data.planned_end,
          extra_minutes: data.extra_minutes,
          _estId: estId,
          _date: date,
        };
      }

      // Handle BADGE_TOO_EARLY warning (1st call for clock_in)
      if (data && (data.code === "BADGE_TOO_EARLY" || data.warning === "BADGE_TOO_EARLY")) {
        return {
          kind: "badge_too_early",
          shift_start: data.shift_start,
          minutes_early: data.minutes_early,
          early_limit: data.early_limit,
          _estId: estId,
          _date: date,
        };
      }

      return { kind: "success", event: data.event, _estId: estId, _date: date };
    },
    onSuccess: (result) => {
      if (result.kind === "success") {
        toast.success("Pointage créé");
        // ✅ PHASE 2.1: Unified invalidation with REAL dayDate
        invalidatePresenceAndBadgeStatus({
          queryClient,
          establishmentId: result._estId,
          dayDate: result._date,
        });
      } else if (result.kind === "error") {
        if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
          toast.error(result.message);
        }
      }
      // Note: "warning" kind is handled by caller (UI shows ExtraTimeModal)
    },
  });

  /**
   * RESET DAY: Delete ALL badge events for a user on today
   * Used by Presence trash button to fully reset badgeuse state
   */
  const resetDay = useMutation({
    mutationFn: async ({ targetUserId, dayDate }: ResetDayParams): Promise<AdminMutationResult> => {
      const estId = establishmentId;
      // Use provided dayDate (history mode) or resolve via RPC (today mode)
      const date = dayDate
        ? dayDate
        : estId
          ? await resolveServiceDayForTimestamp(estId, new Date().toISOString())
          : "";

      if (!estId) return { kind: "error", message: "Aucun établissement sélectionné" };
      if (!targetUserId) return { kind: "error", message: "Utilisateur cible manquant" };

      const { data, error } = await supabase.functions.invoke("badge-events", {
        method: "POST",
        body: {
          action: "admin_reset_day",
          target_user_id: targetUserId,
          establishment_id: estId,
          day_date: date,
        },
      });

      if (error) {
        if (error.message?.includes("CORS") || error.message?.includes("Failed to fetch")) {
          return { kind: "error", message: "Connexion au serveur impossible" };
        }
        return { kind: "error", message: error.message || "Réinitialisation impossible" };
      }

      if (data && data.error) {
        return { kind: "error", code: data.code, message: getErrorMessage(data.code, data.error) };
      }

      return { kind: "success", event: data, _estId: estId, _date: date };
    },
    onSuccess: (result) => {
      if (result.kind === "success") {
        const count = (result.event as { deleted_count?: number })?.deleted_count || 0;
        toast.success(
          `Badgeuse réinitialisée (${count} pointage${count > 1 ? "s" : ""} supprimé${count > 1 ? "s" : ""})`
        );
        // ✅ PHASE 2.1: Unified invalidation with REAL dayDate
        invalidatePresenceAndBadgeStatus({
          queryClient,
          establishmentId: result._estId,
          dayDate: result._date,
        });
      } else if (result.kind === "error") {
        toast.error(result.message);
      }
    },
  });

  /**
   * Helper to invalidate queries after a successful 2nd-call confirmation
   * ✅ PHASE 2.1: Now uses unified invalidation
   */
  const invalidateAfterSuccess = (estId: string | undefined, _date: string) => {
    invalidatePresenceAndBadgeStatus({
      queryClient,
      establishmentId: estId,
      dayDate: _date,
    });
  };

  return {
    deleteBadge,
    updateBadge,
    createBadge,
    resetDay,
    invalidateAfterSuccess,
    isDeleting: deleteBadge.isPending,
    isUpdating: updateBadge.isPending,
    isCreating: createBadge.isPending,
    isResetting: resetDay.isPending,
  };
}
