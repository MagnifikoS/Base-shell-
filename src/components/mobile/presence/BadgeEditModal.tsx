/**
 * Modal for viewing/editing badge events of an employee
 * V5: Unified TimeSelect + shift prefill
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Loader2, Clock } from "lucide-react";
import {
  useAdminBadgeMutations,
  type AdminMutationResult,
} from "@/hooks/presence/useAdminBadgeMutations";
import { BadgeDeleteConfirm } from "./BadgeDeleteConfirm";
import { ExtraTimeModal } from "@/components/mobile/badgeuse/ExtraTimeModal";
import { TimeSelect } from "@/components/ui/time-select";
import { formatParisHHMM } from "@/lib/time/paris";
import { buildOccurredAtFromServiceDay } from "@/lib/time/serviceDayBadge";
import { useEstablishmentCutoff } from "@/hooks/presence/useEstablishmentCutoff";
import { toast } from "sonner";
import type { PresenceEmployee, BadgeEvent } from "@/lib/presence/presence.compute";

interface BadgeEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: PresenceEmployee;
  establishmentId?: string;
  serviceDay?: string;
}

interface PendingExtra {
  type: "create" | "update";
  extra_minutes: number;
  planned_end: string;
  targetUserId?: string;
  occurredAt?: string;
  sequenceIndex?: number;
  badgeEventId?: string;
}

export function BadgeEditModal({
  open,
  onOpenChange,
  employee,
  establishmentId,
  serviceDay,
}: BadgeEditModalProps) {
  const {
    updateBadge,
    createBadge,
    deleteBadge,
    invalidateAfterSuccess,
    isUpdating,
    isCreating,
    isDeleting,
  } = useAdminBadgeMutations(establishmentId);
  const { data: cutoffHHMM } = useEstablishmentCutoff(establishmentId);

  // V5: Prefill with shift times if no badge exists
  const [arrivalTime, setArrivalTime] = useState(
    employee.clockInEvent
      ? formatParisHHMM(employee.clockInEvent.occurred_at)
      : employee.plannedStart || ""
  );
  const [departureTime, setDepartureTime] = useState(
    employee.clockOutEvent
      ? formatParisHHMM(employee.clockOutEvent.occurred_at)
      : employee.plannedEnd || ""
  );

  const [deleteTarget, setDeleteTarget] = useState<BadgeEvent | null>(null);
  const [showCreateArrival, setShowCreateArrival] = useState(false);
  const [showCreateDeparture, setShowCreateDeparture] = useState(false);
  // V5: Prefill new badge creation with shift times
  const [newArrivalTime, setNewArrivalTime] = useState(employee.plannedStart || "09:00");
  const [newDepartureTime, setNewDepartureTime] = useState(employee.plannedEnd || "18:00");
  const [pendingExtra, setPendingExtra] = useState<PendingExtra | null>(null);
  const [isConfirmingExtra, setIsConfirmingExtra] = useState(false);

  const dayDate =
    employee.clockInEvent?.day_date ||
    employee.clockOutEvent?.day_date ||
    employee.allEvents?.[0]?.day_date ||
    serviceDay ||
    "";

  const buildOccurredAt = (timeHHMM: string): string => {
    return buildOccurredAtFromServiceDay({
      serviceDay: dayDate,
      timeHHMM,
      cutoffHHMM: cutoffHHMM || "03:00",
    });
  };

  const isBusy = isUpdating || isCreating || isDeleting || isConfirmingExtra;

  const handleMutationResult = (
    result: AdminMutationResult,
    pendingData: PendingExtra,
    onSuccess: () => void
  ) => {
    if (result.kind === "success") {
      onSuccess();
    } else if (result.kind === "warning" && result.warning === "EXTRA_SUSPECTED") {
      setPendingExtra({
        ...pendingData,
        extra_minutes: result.extra_minutes || 0,
        planned_end: result.planned_end || employee.plannedEnd || "",
      });
    } else if (result.kind === "error") {
      // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
      if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
        toast.error(result.message);
      }
    }
  };

  const handleUpdateArrival = () => {
    if (!employee.clockInEvent || !arrivalTime) return;
    updateBadge.mutate(
      {
        badgeEventId: employee.clockInEvent.id,
        occurredAt: buildOccurredAt(arrivalTime),
      },
      {
        onSuccess: (result) => {
          if (result.kind === "success") {
            onOpenChange(false);
          } else if (result.kind === "error") {
            // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
            if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
              toast.error(result.message);
            }
          }
        },
      }
    );
  };

  const handleUpdateDeparture = async () => {
    if (!employee.clockOutEvent || !departureTime) return;
    const occurredAt = buildOccurredAt(departureTime);

    updateBadge.mutate(
      {
        badgeEventId: employee.clockOutEvent.id,
        occurredAt,
      },
      {
        onSuccess: (result) => {
          handleMutationResult(
            result,
            {
              type: "update",
              badgeEventId: employee.clockOutEvent!.id,
              occurredAt,
              extra_minutes: 0,
              planned_end: "",
            },
            () => onOpenChange(false)
          );
        },
      }
    );
  };

  const handleCreateArrival = () => {
    createBadge.mutate(
      {
        targetUserId: employee.userId,
        eventType: "clock_in",
        occurredAt: buildOccurredAt(newArrivalTime),
        sequenceIndex: employee.sequenceIndex,
      },
      {
        onSuccess: (result) => {
          if (result.kind === "success") {
            setShowCreateArrival(false);
            onOpenChange(false);
          } else if (result.kind === "error") {
            // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
            if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
              toast.error(result.message);
            }
          }
        },
      }
    );
  };

  const handleCreateDeparture = async () => {
    const occurredAt = buildOccurredAt(newDepartureTime);

    createBadge.mutate(
      {
        targetUserId: employee.userId,
        eventType: "clock_out",
        occurredAt,
        sequenceIndex: employee.sequenceIndex,
      },
      {
        onSuccess: (result) => {
          handleMutationResult(
            result,
            {
              type: "create",
              targetUserId: employee.userId,
              occurredAt,
              sequenceIndex: employee.sequenceIndex,
              extra_minutes: 0,
              planned_end: "",
            },
            () => {
              setShowCreateDeparture(false);
              onOpenChange(false);
            }
          );
        },
      }
    );
  };

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

        if (result.kind === "success") {
          toast.success(
            isYesExtra ? "Départ avec extra enregistré" : "Départ enregistré (fin prévue)"
          );
          invalidateAfterSuccess(result._estId, result._date);
          setShowCreateDeparture(false);
        } else if (result.kind === "error") {
          // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
          if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
            toast.error(result.message);
          }
        }
      } else {
        const result = await updateBadge.mutateAsync({
          badgeEventId: pendingExtra.badgeEventId!,
          occurredAt: pendingExtra.occurredAt!,
          extra_confirmed: true,
          force_planned_end: !isYesExtra,
        });

        if (result.kind === "success") {
          toast.success(isYesExtra ? "Départ avec extra modifié" : "Départ modifié (fin prévue)");
          invalidateAfterSuccess(result._estId, result._date);
          onOpenChange(false);
        } else if (result.kind === "error") {
          // BADGE_CONFLICT and FUTURE_BADGE_BLOCKED are handled by global BlockingDialog
          if (result.code !== "BADGE_CONFLICT" && result.code !== "FUTURE_BADGE_BLOCKED") {
            toast.error(result.message);
          }
        }
      }
    } finally {
      setIsConfirmingExtra(false);
      setPendingExtra(null);
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteBadge.mutate(
      { badgeEventId: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-[95vw] sm:max-w-md rounded-xl max-h-[85vh] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg">Pointages de {employee.fullName}</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Shift prévu : {employee.plannedStart} - {employee.plannedEnd}
            </p>
            <p className="text-xs text-muted-foreground/70 italic">
              Un badge représente un événement passé ou présent.
            </p>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Arrival Section */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-primary" />
                Arrivée
              </Label>

              {employee.clockInEvent ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <TimeSelect
                      value={arrivalTime}
                      onChange={setArrivalTime}
                      disabled={isBusy}
                      aria-label="Heure d'arrivée"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleUpdateArrival}
                    disabled={
                      isBusy || arrivalTime === formatParisHHMM(employee.clockInEvent.occurred_at)
                    }
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Modifier"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(employee.clockInEvent)}
                    disabled={isBusy}
                    aria-label="Supprimer le pointage d'arrivée"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : showCreateArrival ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <TimeSelect
                      value={newArrivalTime}
                      onChange={setNewArrivalTime}
                      disabled={isBusy}
                      aria-label="Nouvelle heure d'arrivée"
                    />
                  </div>
                  <Button size="sm" onClick={handleCreateArrival} disabled={isBusy}>
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Créer"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowCreateArrival(false)}
                    disabled={isBusy}
                  >
                    Annuler
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowCreateArrival(true)}
                  disabled={isBusy}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter arrivée
                </Button>
              )}
            </div>

            {/* Departure Section */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Départ
              </Label>

              {employee.clockOutEvent ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <TimeSelect
                      value={departureTime}
                      onChange={setDepartureTime}
                      disabled={isBusy}
                      aria-label="Heure de départ"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleUpdateDeparture}
                    disabled={
                      isBusy ||
                      departureTime === formatParisHHMM(employee.clockOutEvent.occurred_at)
                    }
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Modifier"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(employee.clockOutEvent)}
                    disabled={isBusy}
                    aria-label="Supprimer le pointage de départ"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : showCreateDeparture ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <TimeSelect
                      value={newDepartureTime}
                      onChange={setNewDepartureTime}
                      disabled={isBusy}
                      aria-label="Nouvelle heure de départ"
                    />
                  </div>
                  <Button size="sm" onClick={handleCreateDeparture} disabled={isBusy}>
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Créer"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowCreateDeparture(false)}
                    disabled={isBusy}
                  >
                    Annuler
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowCreateDeparture(true)}
                  disabled={isBusy || !employee.clockInEvent}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter départ
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {deleteTarget && (
        <BadgeDeleteConfirm
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
          employeeName={employee.fullName}
          eventType={deleteTarget.event_type as "clock_in" | "clock_out"}
          time={formatParisHHMM(deleteTarget.occurred_at)}
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
    </>
  );
}
