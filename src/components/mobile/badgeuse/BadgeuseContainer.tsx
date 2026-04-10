import { useState, useCallback, useEffect } from "react";
import { Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { MobileWeekNav } from "../planning/MobileWeekNav";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { getMonday } from "@/lib/planning-engine/format";
import { formatBadgeTime } from "@/lib/badgeuse/computeEffectiveTime";

import { useBadgeSettings } from "@/hooks/badgeuse/useBadgeSettings";
import { useBadgeStatus } from "@/hooks/badgeuse/useBadgeStatus";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { useBadgeFlow } from "@/hooks/badgeuse/useBadgeFlow";

import { ActionSlider } from "./ActionSlider";
import { CameraArrivalCapture } from "./CameraArrivalCapture";
import { PinPad } from "./PinPad";
import { BadgeConfirmationToast } from "./BadgeConfirmationToast";
import { BadgeWeekView } from "./BadgeWeekView";
import { EarlyDepartureModal } from "./EarlyDepartureModal";
import { EarlyArrivalModal } from "./EarlyArrivalModal";
import { EarlyArrivalChoiceModal } from "./EarlyArrivalChoiceModal";
import { ShiftFinishedModal } from "./ShiftFinishedModal";
import { ExtraTimeModal } from "./ExtraTimeModal";
import { SelfieConsentDialog } from "@/components/badgeuse/SelfieConsentDialog";
import { DoubleShiftResolutionDialog } from "@/components/badgeuse/DoubleShiftResolutionDialog";

/**
 * V6 UNIFIED: Single extra flow at clock_out only.
 * Badge flow logic extracted to useBadgeFlow hook for file size compliance.
 */
export function BadgeuseContainer() {
  const { activeEstablishment } = useEstablishment();
  const { can } = usePermissions();

  const canWrite = can("badgeuse", "write");
  const [weekStartInternal, setWeekStartInternal] = useState(() => getMonday(new Date()));

  // Service day (SSOT via RPC)
  const { data: serviceDay, isLoading: serviceDayLoading } = useServiceDayToday(
    activeEstablishment?.id || null
  );

  // Compute current week monday from serviceDay (Paris timezone)
  const serviceDayMonday = serviceDay
    ? getMonday(new Date(serviceDay + "T12:00:00"))
    : getMonday(new Date());

  // Effective weekStart (forced to current if read-only)
  const weekStart = canWrite ? weekStartInternal : serviceDayMonday;

  // Data hooks
  const { data: settings, isLoading: settingsLoading } = useBadgeSettings({
    establishmentId: activeEstablishment?.id || null,
  });

  const {
    data: badgeData,
    isLoading: statusLoading,
    error: statusError,
  } = useBadgeStatus({
    establishmentId: activeEstablishment?.id || null,
    weekStart,
  });

  // Badge flow hook (shared with BadgeuseKioskView)
  const flow = useBadgeFlow(activeEstablishment?.id || null, settings, badgeData);

  // Week navigation handler
  const handleWeekChange = useCallback(
    (newWeek: string) => {
      if (!canWrite) return;
      setWeekStartInternal(newWeek);
    },
    [canWrite]
  );

  // Lock to current week if read-only
  useEffect(() => {
    if (!canWrite && weekStartInternal !== serviceDayMonday) {
      setWeekStartInternal(serviceDayMonday);
    }
  }, [canWrite, serviceDayMonday, weekStartInternal]);

  // No establishment selected
  if (!activeEstablishment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Veuillez sélectionner un établissement</p>
      </div>
    );
  }

  // Loading
  if (settingsLoading || statusLoading || flow.pinStatusLoading || serviceDayLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error
  if (statusError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-destructive">Erreur de chargement</p>
        <p className="text-sm text-muted-foreground mt-2">{statusError.message}</p>
      </div>
    );
  }

  const status = badgeData?.status;
  const weekEvents = badgeData?.weekEvents || [];
  const nextEventType = status?.nextEventType || "clock_in";
  const canBadge = status?.canBadge ?? true;

  return (
    <>
      <div className="p-4 space-y-6">
        {/* Week navigation */}
        <MobileWeekNav
          weekStart={weekStart}
          onWeekChange={handleWeekChange}
          disabled={!canWrite}
          currentWeekMonday={serviceDayMonday}
        />

        {/* Current status + Action */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          {/* Status indicator */}
          <div
            className="flex items-center justify-center gap-3"
            role="status"
            aria-label={status?.isClockedIn ? "Statut : Présent" : "Statut : Absent"}
          >
            <div
              className={`w-3 h-3 rounded-full ${
                status?.isClockedIn
                  ? "bg-green-500 dark:bg-green-600 animate-pulse"
                  : "bg-muted-foreground"
              }`}
              aria-hidden="true"
            />
            <span className="font-medium">{status?.isClockedIn ? "Présent" : "Absent"}</span>
            {status?.lastEvent && (
              <span className="text-sm text-muted-foreground">
                depuis {formatBadgeTime(status.lastEvent.effective_at)}
              </span>
            )}
          </div>

          {/* Camera error message with retry */}
          {flow.cameraError && flow.step === "idle" && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-center">
              <p className="text-sm text-destructive mb-2">{flow.cameraError}</p>
              <button
                onClick={flow.handleCameraRetry}
                className="text-sm font-medium text-primary underline"
                aria-label="Réessayer l'accès caméra"
              >
                Réessayer
              </button>
            </div>
          )}

          {/* V13: Forgotten badge warning */}
          {status?.forgottenBadgeWarning && (
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
              <p className="text-sm text-orange-700 dark:text-orange-300">
                {status.forgottenBadgeWarning}
              </p>
            </div>
          )}

          {/* Action slider */}
          {canBadge ? (
            <ActionSlider
              key={flow.step}
              onComplete={flow.handleSliderComplete}
              label={
                nextEventType === "clock_in"
                  ? "Glissez pour pointer l'arrivée"
                  : "Glissez pour pointer le départ"
              }
              variant={nextEventType === "clock_in" ? "arrival" : "departure"}
              disabled={flow.step !== "idle"}
              isLoading={flow.step === "confirming"}
            />
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              Maximum 2 shifts atteint pour aujourd'hui
            </div>
          )}
        </div>

        {/* Week view */}
        <div>
          <h3 className="font-medium mb-3">Cette semaine</h3>
          <BadgeWeekView weekStart={weekStart} events={weekEvents} serviceDay={serviceDay} />
        </div>
      </div>

      {/* RGPD-03: Selfie consent dialog */}
      <SelfieConsentDialog
        open={flow.showSelfieConsent}
        onAccept={flow.handleSelfieConsentAccept}
        onRefuse={flow.handleSelfieConsentRefuse}
      />

      {/* Camera overlay */}
      {flow.step === "selfie" && flow.cameraStream && (
        <CameraArrivalCapture
          stream={flow.cameraStream}
          onCapture={flow.handleSelfieCapture}
          onCancel={flow.handleSelfieCancel}
          onRetry={flow.handleCameraRetry}
          isLoading={false}
        />
      )}

      {/* PIN overlay */}
      {flow.step === "pin" && (
        <PinPad
          key={flow.pinMode}
          onSubmit={flow.handlePinSubmit}
          onCancel={flow.handlePinCancel}
          isLoading={flow.createPin.isPending || flow.createBadgeEvent.isPending}
          error={flow.pinError}
          mode={flow.pinMode}
        />
      )}

      {/* Success confirmation */}
      {flow.step === "success" && flow.confirmedEvent && (
        <BadgeConfirmationToast
          type={flow.confirmedEvent.event_type}
          effectiveTime={formatBadgeTime(flow.confirmedEvent.effective_at)}
          onClose={flow.handleConfirmationClose}
          lateMinutes={flow.confirmedLateMinutes}
        />
      )}

      {/* Early departure modal */}
      {flow.earlyDepartureData && (
        <EarlyDepartureModal
          plannedEnd={flow.earlyDepartureData.plannedEnd}
          onCancel={flow.handleEarlyDepartureCancel}
          onConfirmEarly={flow.handleEarlyDepartureConfirm}
          isLoading={flow.step === "confirming"}
        />
      )}

      {/* Shift finished modal */}
      {flow.shiftFinishedData && (
        <ShiftFinishedModal
          nextShift={flow.shiftFinishedData.nextShift}
          onClose={flow.handleShiftFinishedClose}
        />
      )}

      {/* Extra time modal */}
      <ExtraTimeModal
        open={flow.extraTimeData !== null}
        extraMinutes={flow.extraTimeData?.extraMinutes ?? 0}
        plannedEnd={flow.extraTimeData?.plannedEnd ?? null}
        isLeaveExtra={flow.extraTimeData?.isLeaveExtra ?? false}
        onClose={flow.handleExtraTimeClose}
        onNoExtra={flow.handleExtraTimeNoExtra}
        onYesExtra={flow.handleExtraTimeYesExtra}
        isLoading={flow.step === "confirming"}
      />

      {/* Early arrival choice modal */}
      <EarlyArrivalChoiceModal
        open={flow.earlyArrivalChoiceData !== null}
        shiftStart={flow.earlyArrivalChoiceData?.shiftStart ?? ""}
        minutesEarly={flow.earlyArrivalChoiceData?.minutesEarly ?? 0}
        onClose={flow.handleEarlyArrivalChoiceClose}
        onConfirmExtra={flow.handleEarlyArrivalConfirmExtra}
        onDeclineExtra={flow.handleEarlyArrivalDeclineExtra}
        isLoading={flow.step === "confirming"}
      />

      {/* Early arrival modal */}
      <EarlyArrivalModal
        open={flow.earlyArrivalData !== null}
        onOpenChange={(open) => !open && flow.handleEarlyArrivalClose()}
        shiftStart={flow.earlyArrivalData?.shiftStart ?? ""}
        minutesEarly={flow.earlyArrivalData?.minutesEarly ?? 0}
        onCancel={flow.handleEarlyArrivalClose}
      />

      {/* V14: Double-shift resolution dialog */}
      <DoubleShiftResolutionDialog
        open={flow.doubleShiftData !== null}
        openClockInTime={flow.doubleShiftData?.openClockInTime ?? ""}
        plannedEndTime={flow.doubleShiftData?.plannedEndTime ?? null}
        nextShiftStart={flow.doubleShiftData?.nextShiftStart ?? null}
        nextShiftEnd={flow.doubleShiftData?.nextShiftEnd ?? null}
        onResolveForget={flow.handleDoubleShiftResolveForget}
        onResolvePlanningChanged={flow.handleDoubleShiftResolvePlanningChanged}
        onCancel={flow.handleDoubleShiftCancel}
        isLoading={flow.step === "confirming"}
      />
    </>
  );
}
