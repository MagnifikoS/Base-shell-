/**
 * Modal for editing ALL shifts of an employee in one view
 * V3: Unified TimeSelect + shift prefill + simplified BADGE_TOO_EARLY (info-only)
 * V5: Remove auto-prefill for new events, add incoherent time validation,
 *     block future departure times
 */

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Trash2, Loader2, Clock, Check, AlertCircle } from "lucide-react";
import {
  useAdminBadgeMutations,
  type AdminMutationResult,
} from "@/hooks/presence/useAdminBadgeMutations";
import { BadgeDeleteConfirm } from "./BadgeDeleteConfirm";
import { ExtraTimeModal } from "@/components/mobile/badgeuse/ExtraTimeModal";
import { EarlyDepartureModal } from "@/components/mobile/badgeuse/EarlyDepartureModal";
import { EarlyArrivalModal } from "@/components/mobile/badgeuse/EarlyArrivalModal";
import { TimeSelect } from "@/components/ui/time-select";
import { formatParisHHMM, getNowParisHHMM, timeToMinutes } from "@/lib/time/paris";
import { buildOccurredAtFromServiceDay } from "@/lib/time/serviceDayBadge";
import { useEstablishmentCutoff } from "@/hooks/presence/useEstablishmentCutoff";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { toast } from "sonner";
import type { PresenceEmployeeCard, BadgeEvent } from "@/lib/presence/presence.compute";

interface BadgeEditModalMultiProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeCard: PresenceEmployeeCard;
  establishmentId?: string;
  serviceDay?: string;
}

interface SessionState {
  arrivalTime: string;
  departureTime: string;
}

interface PendingExtra {
  type: "create" | "update";
  sessionIndex: number;
  extra_minutes: number;
  planned_end: string;
  targetUserId?: string;
  occurredAt?: string;
  sequenceIndex?: number;
  badgeEventId?: string;
  remainingSessionStates: SessionState[];
}

interface PendingEarlyDeparture {
  type: "create" | "update";
  sessionIndex: number;
  early_minutes: number;
  planned_end: string;
  targetUserId?: string;
  occurredAt?: string;
  sequenceIndex?: number;
  badgeEventId?: string;
  remainingSessionStates: SessionState[];
}

// Info-only early arrival popup state
interface PendingEarlyArrivalInfo {
  shiftStart: string;
  minutesEarly: number;
}

export function BadgeEditModalMulti({
  open,
  onOpenChange,
  employeeCard,
  establishmentId,
  serviceDay,
}: BadgeEditModalMultiProps) {
  const {
    updateBadge,
    createBadge,
    deleteBadge,
    invalidateAfterSuccess: _invalidateAfterSuccess,
    isUpdating,
    isCreating,
    isDeleting,
  } = useAdminBadgeMutations(establishmentId);
  const { data: cutoffHHMM } = useEstablishmentCutoff(establishmentId);
  // Actual current service day (for future-time validation — not the viewed historical day)
  const { data: actualCurrentServiceDay } = useServiceDayToday(establishmentId);

  const getSessionDayDate = (sessionIndex: number): string => {
    const session = employeeCard.sessions[sessionIndex];
    return (
      session?.clockInEvent?.day_date ||
      session?.clockOutEvent?.day_date ||
      employeeCard.allEvents?.[0]?.day_date ||
      serviceDay ||
      ""
    );
  };

  const buildOccurredAt = (serviceDayStr: string, timeHHMM: string): string => {
    return buildOccurredAtFromServiceDay({
      serviceDay: serviceDayStr,
      timeHHMM,
      cutoffHHMM: cutoffHHMM || "03:00",
    });
  };

  const [sessionStates, setSessionStates] = useState<SessionState[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{
    event: BadgeEvent;
    sessionIndex: number;
  } | null>(null);
  const [pendingExtra, setPendingExtra] = useState<PendingExtra | null>(null);
  const [isConfirmingExtra, setIsConfirmingExtra] = useState(false);
  const [pendingEarlyDeparture, setPendingEarlyDeparture] = useState<PendingEarlyDeparture | null>(
    null
  );
  const [isConfirmingEarly, setIsConfirmingEarly] = useState(false);

  // V3: Info-only early arrival popup (no confirmation logic)
  const [pendingEarlyArrivalInfo, setPendingEarlyArrivalInfo] =
    useState<PendingEarlyArrivalInfo | null>(null);

  const [isValidating, setIsValidating] = useState(false);

  const isBusy =
    isUpdating ||
    isCreating ||
    isDeleting ||
    isConfirmingExtra ||
    isConfirmingEarly ||
    isValidating;

  // V6: Initialize with badge time for existing events, or prefill with shift planned time
  // if that time has already passed (smart prefill based on current time)
  // V6.1: For past service days, force nowNorm to end-of-service-day so all shifts are prefilled
  useEffect(() => {
    if (open) {
      const cutoff = cutoffHHMM || "03:00";
      const cutoffMin = timeToMinutes(cutoff);

      // Determine if we're looking at a past service day
      const viewedDay = serviceDay || "";
      const isPastDay = viewedDay && actualCurrentServiceDay && viewedDay < actualCurrentServiceDay;

      let nowNorm: number;
      if (isPastDay) {
        // Past day: all shifts are finished → use last minute of service day (cutoff - 1 min)
        nowNorm = cutoffMin + 1440 - 1;
      } else {
        const nowHHMM = getNowParisHHMM();
        const nowMin = timeToMinutes(nowHHMM);
        nowNorm = nowMin < cutoffMin ? nowMin + 1440 : nowMin;
      }

      const initialStates = employeeCard.sessions.map((session) => {
        // Arrival: badge exists → use badge time, else prefill if shift start has passed
        let arrivalTime = "";
        if (session.clockInEvent) {
          arrivalTime = formatParisHHMM(session.clockInEvent.occurred_at);
        } else if (session.plannedStart) {
          const startMin = timeToMinutes(session.plannedStart);
          const startNorm = startMin < cutoffMin ? startMin + 1440 : startMin;
          if (nowNorm >= startNorm) {
            arrivalTime = session.plannedStart;
          }
        }

        // Departure: badge exists → use badge time, else prefill if shift end has passed
        let departureTime = "";
        if (session.clockOutEvent) {
          departureTime = formatParisHHMM(session.clockOutEvent.occurred_at);
        } else if (session.plannedEnd) {
          const endMin = timeToMinutes(session.plannedEnd);
          const endNorm = endMin < cutoffMin ? endMin + 1440 : endMin;
          if (nowNorm >= endNorm) {
            departureTime = session.plannedEnd;
          }
        }

        return { arrivalTime, departureTime };
      });
      setSessionStates(initialStates);
    }
  }, [open, employeeCard.sessions, cutoffHHMM, serviceDay, actualCurrentServiceDay]);

  const updateSessionState = (index: number, field: keyof SessionState, value: string) => {
    setSessionStates((prev) => {
      if (!prev || prev.length === 0) return prev;
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  };

  /**
   * V5: Validate session states for incoherent times and future departures.
   * Returns per-session error messages (null = no error).
   * Also returns a global hasErrors flag to disable the submit button.
   */
  const { sessionErrors, hasValidationErrors } = useMemo(() => {
    if (!sessionStates.length) {
      return { sessionErrors: [] as (string | null)[], hasValidationErrors: false };
    }

    const nowHHMM = getNowParisHHMM();
    const nowMinutes = timeToMinutes(nowHHMM);
    const cutoff = cutoffHHMM || "03:00";
    const cutoffMinutes = timeToMinutes(cutoff);

    const errors: (string | null)[] = sessionStates.map((state, idx) => {
      const arrivalStr = state.arrivalTime.trim();
      const departureStr = state.departureTime.trim();

      // No fields filled = no error (skip)
      if (!arrivalStr && !departureStr) return null;

      // If departure is filled, check future
      if (departureStr) {
        const depMinutes = timeToMinutes(departureStr);
        // Normalize to service-day timeline for comparison
        const depNorm = depMinutes < cutoffMinutes ? depMinutes + 1440 : depMinutes;
        const nowNorm = nowMinutes < cutoffMinutes ? nowMinutes + 1440 : nowMinutes;

        // Only check future if this is today's ACTUAL service day (not a historical day)
        // Use actualCurrentServiceDay from RPC, NOT the serviceDay prop (which is the viewed day)
        const session = employeeCard.sessions[idx];
        const sessionDayDate =
          session?.clockInEvent?.day_date ||
          session?.clockOutEvent?.day_date ||
          employeeCard.allEvents?.[0]?.day_date ||
          serviceDay ||
          "";
        const isActualToday =
          !!actualCurrentServiceDay && sessionDayDate === actualCurrentServiceDay;

        if (isActualToday && depNorm > nowNorm) {
          return "L'heure de sortie ne peut pas être dans le futur";
        }
      }

      // Both filled: check departure >= arrival (same service-day timeline)
      if (arrivalStr && departureStr) {
        const arrMinutes = timeToMinutes(arrivalStr);
        const depMinutes = timeToMinutes(departureStr);
        // Normalize to service-day timeline
        const arrNorm = arrMinutes < cutoffMinutes ? arrMinutes + 1440 : arrMinutes;
        const depNorm = depMinutes < cutoffMinutes ? depMinutes + 1440 : depMinutes;

        if (depNorm < arrNorm) {
          return "L'heure de sortie doit être après l'heure d'arrivée";
        }
      }

      return null;
    });

    return {
      sessionErrors: errors,
      hasValidationErrors: errors.some((e) => e !== null),
    };
  }, [
    sessionStates,
    employeeCard.sessions,
    employeeCard.allEvents,
    serviceDay,
    cutoffHHMM,
    actualCurrentServiceDay,
  ]);

  const handleExtraChoice = async (isYesExtra: boolean) => {
    if (!pendingExtra) return;
    setIsConfirmingExtra(true);

    try {
      if (pendingExtra.type === "create") {
        const result = await createBadge.mutateAsync({
          targetUserId: pendingExtra.targetUserId!,
          eventType: "clock_out",
          occurredAt: pendingExtra.occurredAt!,
          sequenceIndex: pendingExtra.sequenceIndex,
          extra_confirmed: true,
          force_planned_end: !isYesExtra,
        });

        if (result.kind === "error") {
          if (handleErrorResult(result, "")) return;
          return;
        }
      } else {
        const result = await updateBadge.mutateAsync({
          badgeEventId: pendingExtra.badgeEventId!,
          occurredAt: pendingExtra.occurredAt!,
          extra_confirmed: true,
          force_planned_end: !isYesExtra,
        });

        if (result.kind === "error") {
          if (handleErrorResult(result, "")) return;
          return;
        }
      }

      const remainingStates = pendingExtra.remainingSessionStates;
      const startIndex = pendingExtra.sessionIndex + 1;
      setPendingExtra(null);
      await continueValidation(startIndex, remainingStates);
    } finally {
      setIsConfirmingExtra(false);
    }
  };

  const handleEarlyDepartureChoice = async (confirmEarly: boolean) => {
    if (!pendingEarlyDeparture) return;

    if (!confirmEarly) {
      setPendingEarlyDeparture(null);
      setIsValidating(false);
      return;
    }

    setIsConfirmingEarly(true);

    try {
      if (pendingEarlyDeparture.type === "create") {
        const result = await createBadge.mutateAsync({
          targetUserId: pendingEarlyDeparture.targetUserId!,
          eventType: "clock_out",
          occurredAt: pendingEarlyDeparture.occurredAt!,
          sequenceIndex: pendingEarlyDeparture.sequenceIndex,
          early_exit_confirmed: true,
        });

        if (result.kind === "error") {
          if (handleErrorResult(result, "")) return;
          return;
        }
      } else {
        const result = await updateBadge.mutateAsync({
          badgeEventId: pendingEarlyDeparture.badgeEventId!,
          occurredAt: pendingEarlyDeparture.occurredAt!,
          early_exit_confirmed: true,
        });

        if (result.kind === "error") {
          if (handleErrorResult(result, "")) return;
          return;
        }
      }

      const remainingStates = pendingEarlyDeparture.remainingSessionStates;
      const startIndex = pendingEarlyDeparture.sessionIndex + 1;
      setPendingEarlyDeparture(null);
      await continueValidation(startIndex, remainingStates);
    } finally {
      setIsConfirmingEarly(false);
    }
  };

  const handleErrorResult = (result: AdminMutationResult, prefix: string): boolean => {
    if (result.kind !== "error") return false;
    // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
    if (result.code === "BADGE_CONFLICT" || result.code === "FUTURE_BADGE_BLOCKED") {
      setIsValidating(false);
      return true;
    }
    toast.error(prefix ? `${prefix}: ${result.message}` : result.message);
    return false;
  };

  const continueValidation = async (startIndex: number, states: SessionState[]) => {
    setIsValidating(true);
    let hasChanges = startIndex > 0;
    let hasError = false;

    try {
      for (let idx = startIndex; idx < employeeCard.sessions.length; idx++) {
        const session = employeeCard.sessions[idx];
        const state = states[idx];
        if (!state) continue;

        // === ARRIVAL ===
        const hasExistingArrival = !!session.clockInEvent;
        const currentArrival = hasExistingArrival
          ? formatParisHHMM(session.clockInEvent!.occurred_at)
          : null;
        const fieldArrival = state.arrivalTime.trim();
        // V4: Admin intent = if field filled and no badge → CREATE (even if prefilled)
        // Removed isJustPrefill skip logic per user requirement

        if (!fieldArrival && hasExistingArrival) {
          const result = await deleteBadge.mutateAsync({
            badgeEventId: session.clockInEvent!.id,
            dayDate: serviceDay,
          });
          if (result.kind === "error") {
            if (handleErrorResult(result, `Erreur suppression arrivée shift ${idx + 1}`)) return;
            hasError = true;
          } else {
            hasChanges = true;
          }
        } else if (!fieldArrival && !hasExistingArrival) {
          // Empty field + no badge → SKIP
        } else if (fieldArrival && !hasExistingArrival) {
          // V4: CREATE badge (even if equals prefilled plannedStart)
          const sessionDayDate = getSessionDayDate(idx);
          const occurredAt = buildOccurredAt(sessionDayDate, fieldArrival);
          const result = await createBadge.mutateAsync({
            targetUserId: employeeCard.userId,
            eventType: "clock_in",
            occurredAt,
            sequenceIndex: session.sequenceIndex,
          });
          if (result.kind === "badge_too_early") {
            setPendingEarlyArrivalInfo({
              shiftStart: result.shift_start,
              minutesEarly: result.minutes_early,
            });
            setIsValidating(false);
            return;
          } else if (result.kind === "error") {
            if (handleErrorResult(result, `Erreur arrivée shift ${idx + 1}`)) return;
            hasError = true;
          } else {
            hasChanges = true;
          }
        } else if (fieldArrival && hasExistingArrival && fieldArrival !== currentArrival) {
          // UPDATE existing badge
          const sessionDayDate = getSessionDayDate(idx);
          const occurredAt = buildOccurredAt(sessionDayDate, fieldArrival);
          const result = await updateBadge.mutateAsync({
            badgeEventId: session.clockInEvent!.id,
            occurredAt,
            dayDate: serviceDay,
          });
          if (result.kind === "badge_too_early") {
            setPendingEarlyArrivalInfo({
              shiftStart: result.shift_start,
              minutesEarly: result.minutes_early,
            });
            setIsValidating(false);
            return;
          } else if (result.kind === "error") {
            if (handleErrorResult(result, `Erreur arrivée shift ${idx + 1}`)) return;
            hasError = true;
          } else {
            hasChanges = true;
          }
        }

        // === DEPARTURE ===
        const hasExistingDeparture = !!session.clockOutEvent;
        const currentDeparture = hasExistingDeparture
          ? formatParisHHMM(session.clockOutEvent!.occurred_at)
          : null;
        const fieldDeparture = state.departureTime.trim();
        // V4: Admin intent = if field filled and no badge → CREATE (even if prefilled)

        if (!fieldDeparture && hasExistingDeparture) {
          const result = await deleteBadge.mutateAsync({
            badgeEventId: session.clockOutEvent!.id,
            dayDate: serviceDay,
          });
          if (result.kind === "error") {
            if (handleErrorResult(result, `Erreur suppression départ shift ${idx + 1}`)) return;
            hasError = true;
          } else {
            hasChanges = true;
          }
        } else if (!fieldDeparture && !hasExistingDeparture) {
          // Empty → skip
        } else if (fieldDeparture && !hasExistingDeparture) {
          // V4: CREATE badge (even if equals prefilled plannedEnd)
          const sessionDayDate = getSessionDayDate(idx);
          const occurredAt = buildOccurredAt(sessionDayDate, fieldDeparture);
          const result = await createBadge.mutateAsync({
            targetUserId: employeeCard.userId,
            eventType: "clock_out",
            occurredAt,
            sequenceIndex: session.sequenceIndex,
          });
          if (result.kind === "early_departure") {
            setPendingEarlyDeparture({
              type: "create",
              sessionIndex: idx,
              early_minutes: result.early_minutes || 0,
              planned_end: result.planned_end || session.plannedEnd || "",
              targetUserId: employeeCard.userId,
              occurredAt,
              sequenceIndex: session.sequenceIndex,
              remainingSessionStates: states,
            });
            setIsValidating(false);
            return;
          } else if (result.kind === "warning" && result.warning === "EXTRA_SUSPECTED") {
            setPendingExtra({
              type: "create",
              sessionIndex: idx,
              extra_minutes: result.extra_minutes || 0,
              planned_end: result.planned_end || session.plannedEnd || "",
              targetUserId: employeeCard.userId,
              occurredAt,
              sequenceIndex: session.sequenceIndex,
              remainingSessionStates: states,
            });
            setIsValidating(false);
            return;
          } else if (result.kind === "error") {
            if (handleErrorResult(result, `Erreur départ shift ${idx + 1}`)) return;
            hasError = true;
          } else {
            hasChanges = true;
          }
        } else if (fieldDeparture && hasExistingDeparture && fieldDeparture !== currentDeparture) {
          // UPDATE existing badge
          const sessionDayDate = getSessionDayDate(idx);
          const occurredAt = buildOccurredAt(sessionDayDate, fieldDeparture);
          const result = await updateBadge.mutateAsync({
            badgeEventId: session.clockOutEvent!.id,
            occurredAt,
            dayDate: serviceDay,
          });
          if (result.kind === "early_departure") {
            setPendingEarlyDeparture({
              type: "update",
              sessionIndex: idx,
              early_minutes: result.early_minutes || 0,
              planned_end: result.planned_end || session.plannedEnd || "",
              badgeEventId: session.clockOutEvent!.id,
              occurredAt,
              remainingSessionStates: states,
            });
            setIsValidating(false);
            return;
          } else if (result.kind === "warning" && result.warning === "EXTRA_SUSPECTED") {
            setPendingExtra({
              type: "update",
              sessionIndex: idx,
              extra_minutes: result.extra_minutes || 0,
              planned_end: result.planned_end || session.plannedEnd || "",
              badgeEventId: session.clockOutEvent!.id,
              occurredAt,
              remainingSessionStates: states,
            });
            setIsValidating(false);
            return;
          } else if (result.kind === "error") {
            if (handleErrorResult(result, `Erreur départ shift ${idx + 1}`)) return;
            hasError = true;
          } else {
            hasChanges = true;
          }
        }
      }

      if (hasChanges && !hasError) {
        toast.success("Pointages enregistrés");
      } else if (!hasChanges && !hasError) {
        toast.info("Aucune modification");
      }

      onOpenChange(false);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Validation error:", error);
      toast.error("Erreur lors de l'enregistrement");
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteBadge.mutate(
      { badgeEventId: deleteTarget.event.id, dayDate: serviceDay },
      {
        onSuccess: () => {
          toast.success("Pointage supprimé");
          setDeleteTarget(null);
        },
        onError: (err: unknown) => {
          const errorObj = err as { status?: number; message?: string; body?: unknown };
          if (import.meta.env.DEV) {
            console.error("[BadgeEditModalMulti] delete error", {
              status: errorObj?.status,
              message: errorObj?.message,
              body: errorObj?.body,
              raw: err,
            });
          }
          toast.error(`Suppression impossible: ${errorObj?.message || "Erreur réseau"}`);
          // Dialog stays open for retry
        },
      }
    );
  };

  const handleValidate = () => {
    continueValidation(0, sessionStates);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-[95vw] sm:max-w-lg rounded-xl max-h-[85vh] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg">Pointages de {employeeCard.fullName}</DialogTitle>
            <p className="text-xs text-muted-foreground/70 italic">
              Un badge représente un événement passé ou présent.
            </p>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {sessionStates.length > 0 &&
              employeeCard.sessions.map((session, idx) => {
                const state = sessionStates[idx];
                if (!state) return null;

                return (
                  <div key={session.sequenceIndex} className="space-y-4">
                    {idx > 0 && <Separator />}

                    <div className="text-sm font-medium text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
                      Shift prévu : {session.plannedStart} → {session.plannedEnd}
                    </div>

                    {/* Arrival */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-primary" />
                        Arrivée
                        {!session.clockInEvent && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            (non pointé)
                          </span>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <TimeSelect
                            value={state.arrivalTime}
                            onChange={(v) => updateSessionState(idx, "arrivalTime", v)}
                            disabled={isBusy}
                          />
                        </div>
                        {(state.arrivalTime || session.clockInEvent) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => updateSessionState(idx, "arrivalTime", "")}
                            disabled={isBusy}
                            title="Effacer (le salarié pourra badger)"
                            aria-label="Effacer l'heure d'arrivée"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Departure */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        Départ
                        {!session.clockOutEvent && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            (non pointé)
                          </span>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <TimeSelect
                            value={state.departureTime}
                            onChange={(v) => updateSessionState(idx, "departureTime", v)}
                            disabled={isBusy}
                          />
                        </div>
                        {(state.departureTime || session.clockOutEvent) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => updateSessionState(idx, "departureTime", "")}
                            disabled={isBusy}
                            title="Effacer (le salarié pourra badger)"
                            aria-label="Effacer l'heure de départ"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* V5: Validation error for this session */}
                    {sessionErrors[idx] && (
                      <div className="flex items-center gap-2 text-destructive text-sm px-1">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{sessionErrors[idx]}</span>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          <DialogFooter>
            <Button
              onClick={handleValidate}
              disabled={isBusy || hasValidationErrors}
              className="w-full"
            >
              {isValidating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Valider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteTarget && (
        <BadgeDeleteConfirm
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
          employeeName={employeeCard.fullName}
          eventType={deleteTarget.event.event_type as "clock_in" | "clock_out"}
          time={formatParisHHMM(deleteTarget.event.occurred_at)}
        />
      )}

      <ExtraTimeModal
        open={pendingExtra !== null}
        extraMinutes={pendingExtra?.extra_minutes ?? 0}
        plannedEnd={pendingExtra?.planned_end ?? ""}
        onClose={() => setPendingExtra(null)}
        onNoExtra={() => handleExtraChoice(false)}
        onYesExtra={() => handleExtraChoice(true)}
        isLoading={isConfirmingExtra}
      />

      {pendingEarlyDeparture && (
        <EarlyDepartureModal
          plannedEnd={pendingEarlyDeparture.planned_end}
          onCancel={() => handleEarlyDepartureChoice(false)}
          onConfirmEarly={() => handleEarlyDepartureChoice(true)}
          isLoading={isConfirmingEarly}
        />
      )}

      {/* V3: Early Arrival = info-only popup, no confirm logic */}
      {pendingEarlyArrivalInfo && (
        <EarlyArrivalModal
          open={!!pendingEarlyArrivalInfo}
          onOpenChange={(open) => !open && setPendingEarlyArrivalInfo(null)}
          shiftStart={pendingEarlyArrivalInfo.shiftStart}
          minutesEarly={pendingEarlyArrivalInfo.minutesEarly}
          onCancel={() => setPendingEarlyArrivalInfo(null)}
        />
      )}
    </>
  );
}
