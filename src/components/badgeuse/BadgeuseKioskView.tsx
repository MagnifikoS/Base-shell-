/**
 * BadgeuseKioskView - Read-only kiosk view for badgeuse:read users
 *
 * SINGLE SOURCE: This component is used for BOTH mobile and desktop.
 * Shows only:
 * - Current service day
 * - User's own badge events (read-only)
 * - Badge action (clock in/out)
 *
 * NO access to:
 * - Week navigation / history
 * - Settings
 * - Edit/delete actions
 * - Admin tools
 *
 * Badge flow logic extracted to useBadgeFlow hook for file size compliance.
 * Permission: Requires badgeuse:read (enforced by parent)
 */

import { Loader2, AlertCircle } from "lucide-react";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { getMonday } from "@/lib/planning-engine/format";

import { useBadgeSettings } from "@/hooks/badgeuse/useBadgeSettings";
import { useBadgeStatus } from "@/hooks/badgeuse/useBadgeStatus";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { useBadgeFlow } from "@/hooks/badgeuse/useBadgeFlow";

import { ActionSlider } from "@/components/mobile/badgeuse/ActionSlider";
import { CameraArrivalCapture } from "@/components/mobile/badgeuse/CameraArrivalCapture";
import { PinPad } from "@/components/mobile/badgeuse/PinPad";
import { BadgeConfirmationToast } from "@/components/mobile/badgeuse/BadgeConfirmationToast";
import { BadgeWeekView } from "@/components/mobile/badgeuse/BadgeWeekView";
import { EarlyDepartureModal } from "@/components/mobile/badgeuse/EarlyDepartureModal";
import { EarlyArrivalModal } from "@/components/mobile/badgeuse/EarlyArrivalModal";
import { EarlyArrivalChoiceModal } from "@/components/mobile/badgeuse/EarlyArrivalChoiceModal";
import { ShiftFinishedModal } from "@/components/mobile/badgeuse/ShiftFinishedModal";
import { ExtraTimeModal } from "@/components/mobile/badgeuse/ExtraTimeModal";
import { SelfieConsentDialog } from "@/components/badgeuse/SelfieConsentDialog";
import { DoubleShiftResolutionDialog } from "@/components/badgeuse/DoubleShiftResolutionDialog";
import { EstablishmentRequiredPrompt } from "@/components/badgeuse/EstablishmentRequiredPrompt";

export function BadgeuseKioskView() {
  const { activeEstablishment } = useEstablishment();

  // KIOSK: Always locked to current week (no navigation)
  const weekStart = getMonday(new Date());

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

  const { data: serviceDay, isLoading: serviceDayLoading } = useServiceDayToday(
    activeEstablishment?.id || null
  );

  // Badge flow hook (shared with BadgeuseContainer)
  const flow = useBadgeFlow(activeEstablishment?.id || null, settings, badgeData);

  // No establishment selected
  if (!activeEstablishment) {
    return <EstablishmentRequiredPrompt />;
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
        {/* Title for kiosk mode - NO week navigation */}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground">Badgeuse</h1>
          <p className="text-sm text-muted-foreground">
            {serviceDay
              ? `Journée du ${new Date(serviceDay).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`
              : "Journée en cours"}
          </p>
        </div>

        {/* Current status + Action */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          {/* Status indicator */}
          <div
            className="flex items-center justify-center gap-3"
            role="status"
            aria-label={status?.isClockedIn ? "Statut : en service" : "Statut : hors service"}
          >
            <div
              aria-hidden="true"
              className={`w-3 h-3 rounded-full ${
                status?.isClockedIn
                  ? "bg-green-500 dark:bg-green-600 animate-pulse"
                  : "bg-muted-foreground"
              }`}
            />
            <span className="text-lg font-medium text-foreground">
              {status?.isClockedIn ? "En service" : "Hors service"}
            </span>
          </div>

          {/* Last badge info */}
          {status?.lastEvent && (
            <p className="text-center text-sm text-muted-foreground">
              Dernier pointage :{" "}
              {new Date(status.lastEvent.occurred_at).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}

          {/* Action slider */}
          {canBadge && flow.step === "idle" && (
            <ActionSlider
              variant={nextEventType === "clock_in" ? "arrival" : "departure"}
              label={
                nextEventType === "clock_in"
                  ? "Glisser pour pointer l'arrivée"
                  : "Glisser pour pointer le départ"
              }
              onComplete={flow.handleSliderComplete}
              disabled={flow.step !== "idle"}
            />
          )}

          {/* Confirming spinner */}
          {flow.step === "confirming" && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
        </div>

        {/* Today's events only - read-only, no week nav */}
        <BadgeWeekView
          weekStart={weekStart}
          events={weekEvents}
          serviceDay={serviceDay || undefined}
        />
      </div>

      {/* RGPD-03: Selfie consent dialog */}
      <SelfieConsentDialog
        open={flow.showSelfieConsent}
        onAccept={flow.handleSelfieConsentAccept}
        onRefuse={flow.handleSelfieConsentRefuse}
      />

      {/* Camera capture overlay */}
      {flow.step === "selfie" && flow.cameraStream && (
        <CameraArrivalCapture
          stream={flow.cameraStream}
          onCapture={flow.handleSelfieCapture}
          onCancel={flow.handleSelfieCancel}
          onRetry={flow.handleCameraRetry}
        />
      )}

      {/* Camera error overlay */}
      {flow.cameraError && (
        <div className="fixed inset-0 z-[55] bg-black flex flex-col items-center justify-center p-6">
          <AlertCircle className="h-16 w-16 text-destructive mb-4" />
          <p className="text-white text-center mb-4">{flow.cameraError}</p>
          <button
            onClick={flow.handleCameraRetry}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg"
            aria-label="Réessayer l'accès caméra"
          >
            Réessayer
          </button>
          <button
            onClick={flow.handleSelfieCancel}
            className="mt-2 px-4 py-2 text-muted-foreground"
            aria-label="Annuler la capture selfie"
          >
            Annuler
          </button>
        </div>
      )}

      {/* PIN pad overlay */}
      {flow.step === "pin" && (
        <PinPad
          mode={flow.pinMode}
          onSubmit={flow.handlePinSubmit}
          onCancel={flow.handlePinCancel}
          error={flow.pinError}
          isLoading={flow.createPin.isPending}
        />
      )}

      {/* Success confirmation */}
      {flow.step === "success" && flow.confirmedEvent && (
        <BadgeConfirmationToast
          type={flow.confirmedEvent.event_type}
          effectiveTime={new Date(flow.confirmedEvent.effective_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          lateMinutes={flow.confirmedLateMinutes}
          onClose={flow.handleConfirmationClose}
        />
      )}

      {/* Early departure modal */}
      {flow.earlyDepartureData && (
        <EarlyDepartureModal
          plannedEnd={flow.earlyDepartureData.plannedEnd}
          onCancel={flow.handleEarlyDepartureCancel}
          onConfirmEarly={flow.handleEarlyDepartureConfirm}
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
      {flow.extraTimeData && (
        <ExtraTimeModal
          open={true}
          extraMinutes={flow.extraTimeData.extraMinutes}
          plannedEnd={flow.extraTimeData.plannedEnd}
          isLeaveExtra={flow.extraTimeData.isLeaveExtra}
          onClose={flow.handleExtraTimeClose}
          onNoExtra={flow.handleExtraTimeNoExtra}
          onYesExtra={flow.handleExtraTimeYesExtra}
        />
      )}

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
