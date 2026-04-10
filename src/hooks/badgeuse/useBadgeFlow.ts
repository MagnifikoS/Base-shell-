/**
 * Badge Flow Hook — Shared logic for BadgeuseKioskView and BadgeuseContainer
 *
 * Extracted for file size compliance.
 * Contains: camera management, PIN flow, badge submission, modal state management.
 */

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { getDeviceId } from "@/lib/badgeuse/deviceId";
import { useCreateBadgeEvent, useResolveDoubleShift } from "@/hooks/badgeuse/useCreateBadgeEvent";
import { useBadgePinStatus, useCreateBadgePin } from "@/hooks/badgeuse/useBadgePin";
import { getSelfieConsentStatus } from "@/components/badgeuse/SelfieConsentDialog";
import type { BadgeStep, BadgeEvent } from "@/components/mobile/badgeuse/types/badgeuse.types";

interface BadgeSettings {
  require_selfie?: boolean;
  require_pin?: boolean;
}

interface BadgeData {
  status: {
    nextEventType: string;
    isClockedIn: boolean;
    canBadge: boolean;
    lastEvent?: { occurred_at: string; effective_at: string; event_type: string };
  };
  weekEvents: BadgeEvent[];
}

/** V14: Double-shift resolution data from DOUBLE_SHIFT_DETECTED response */
export interface DoubleShiftData {
  openClockInTime: string;
  plannedEndTime: string | null;
  nextShiftStart: string | null;
  nextShiftEnd: string | null;
  selfieCaptured: boolean;
  pin?: string;
}

export interface UseBadgeFlowReturn {
  // Step state
  step: BadgeStep;
  setStep: (step: BadgeStep) => void;

  // PIN state
  pendingPin: string | null;
  pinError: string | null;
  pinMode: "create" | "confirm" | "enter";

  // Camera state
  cameraStream: MediaStream | null;
  cameraError: string | null;

  // Modal state
  earlyDepartureData: { plannedEnd: string; selfieCaptured: boolean; pin?: string } | null;
  shiftFinishedData: {
    nextShift: { start_time: string; end_time: string; sequence_index: number } | null;
  } | null;
  extraTimeData: {
    selfieCaptured: boolean;
    pin?: string;
    extraMinutes: number;
    plannedEnd: string | null;
    isLeaveExtra?: boolean;
  } | null;
  earlyArrivalChoiceData: {
    shiftStart: string;
    minutesEarly: number;
    selfieCaptured: boolean;
    pin?: string;
  } | null;
  earlyArrivalData: { shiftStart: string; minutesEarly: number } | null;
  doubleShiftData: DoubleShiftData | null; // V14
  confirmedEvent: BadgeEvent | null;
  confirmedLateMinutes: number | null;
  showSelfieConsent: boolean;

  // Hooks
  pinStatus: { has_pin: boolean } | undefined;
  pinStatusLoading: boolean;
  createPin: ReturnType<typeof useCreateBadgePin>;
  createBadgeEvent: ReturnType<typeof useCreateBadgeEvent>;

  // Handlers
  handleSliderComplete: () => void;
  handleSelfieCapture: () => void;
  handleSelfieCancel: () => void;
  handleCameraRetry: () => Promise<void>;
  handlePinSubmit: (pin: string) => Promise<void>;
  handlePinCancel: () => void;
  handleConfirmationClose: () => void;
  handleSelfieConsentAccept: () => void;
  handleSelfieConsentRefuse: () => void;
  handleEarlyDepartureCancel: () => void;
  handleEarlyDepartureConfirm: () => void;
  handleShiftFinishedClose: () => void;
  handleEarlyArrivalChoiceClose: () => void;
  handleEarlyArrivalConfirmExtra: () => Promise<void>;
  handleEarlyArrivalDeclineExtra: () => void;
  handleEarlyArrivalClose: () => void;
  handleExtraTimeClose: () => void;
  handleExtraTimeNoExtra: () => Promise<void>;
  handleExtraTimeYesExtra: () => Promise<void>;
  // V14: Double-shift handlers
  handleDoubleShiftResolveForget: () => Promise<void>;
  handleDoubleShiftResolvePlanningChanged: () => void;
  handleDoubleShiftCancel: () => void;
}

export function useBadgeFlow(
  activeEstablishmentId: string | null,
  settings: BadgeSettings | undefined,
  badgeData: BadgeData | undefined
): UseBadgeFlowReturn {
  // Badge flow state
  const [step, setStep] = useState<BadgeStep>("idle");
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  // Modal states
  const [earlyDepartureData, setEarlyDepartureData] = useState<{
    plannedEnd: string;
    selfieCaptured: boolean;
    pin?: string;
  } | null>(null);
  const [shiftFinishedData, setShiftFinishedData] = useState<{
    nextShift: { start_time: string; end_time: string; sequence_index: number } | null;
  } | null>(null);
  const [extraTimeData, setExtraTimeData] = useState<{
    selfieCaptured: boolean;
    pin?: string;
    extraMinutes: number;
    plannedEnd: string | null;
    isLeaveExtra?: boolean;
  } | null>(null);
  const [earlyArrivalChoiceData, setEarlyArrivalChoiceData] = useState<{
    shiftStart: string;
    minutesEarly: number;
    selfieCaptured: boolean;
    pin?: string;
  } | null>(null);
  const [earlyArrivalData, setEarlyArrivalData] = useState<{
    shiftStart: string;
    minutesEarly: number;
  } | null>(null);

  // V14: Double-shift resolution state
  const [doubleShiftData, setDoubleShiftData] = useState<DoubleShiftData | null>(null);

  const [confirmedEvent, setConfirmedEvent] = useState<BadgeEvent | null>(null);
  const [confirmedLateMinutes, setConfirmedLateMinutes] = useState<number | null>(null);
  const [showSelfieConsent, setShowSelfieConsent] = useState(false);

  // Camera stream state
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Data hooks
  const { data: pinStatus, isLoading: pinStatusLoading } = useBadgePinStatus();
  const createPin = useCreateBadgePin();
  const createBadgeEvent = useCreateBadgeEvent();
  const resolveDoubleShift = useResolveDoubleShift();

  // Camera helpers
  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraStream(null);
  }, []);

  const requestCameraStream = useCallback(async (): Promise<boolean> => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraStream(stream);
      return true;
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error("Camera access error:", err);
      const errorName = (err instanceof Error ? err.name : undefined) || "Unknown";
      setCameraError(
        `Impossible d'accéder à la caméra (${errorName}). Veuillez autoriser l'accès.`
      );
      return false;
    }
  }, []);

  const startCameraFlow = useCallback(() => {
    setCameraError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        setCameraStream(stream);
        setStep("selfie");
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.error("Camera access error:", err);
        const errorName = err?.name || "Unknown";
        setCameraError(
          `Impossible d'accéder à la caméra (${errorName}). Veuillez autoriser l'accès.`
        );
      });
  }, []);

  // Submit badge
  const submitBadge = useCallback(
    async (selfieCaptured = false, pin?: string, earlyExitConfirmed = false) => {
      if (!activeEstablishmentId) return;

      setStep("confirming");

      try {
        const result = await createBadgeEvent.mutateAsync({
          establishmentId: activeEstablishmentId,
          deviceId: getDeviceId(),
          pin,
          selfieCaptured,
          earlyExitConfirmed,
        });

        // V14: Check for DOUBLE_SHIFT_DETECTED (200 with success: false)
        const resultCode = (result as { code?: string }).code;
        if (resultCode === "DOUBLE_SHIFT_DETECTED") {
          setDoubleShiftData({
            openClockInTime:
              (result as { open_clock_in_time?: string }).open_clock_in_time || "??:??",
            plannedEndTime: (result as { planned_end_time?: string }).planned_end_time || null,
            nextShiftStart: (result as { next_shift_start?: string }).next_shift_start || null,
            nextShiftEnd: (result as { next_shift_end?: string }).next_shift_end || null,
            selfieCaptured,
            pin,
          });
          setStep("idle");
          return;
        }

        // V14: Check for DUPLICATE_BADGE (200 with success: false)
        if (resultCode === "DUPLICATE_BADGE") {
          const lastTime = (result as { last_event_time?: string }).last_event_time || "";
          toast.info(`Deja pointe a ${lastTime}`);
          setStep("idle");
          return;
        }

        // Check for EXTRA_SUSPECTED warning
        if ((result as { warning?: string }).warning === "EXTRA_SUSPECTED" && !earlyExitConfirmed) {
          setExtraTimeData({
            selfieCaptured,
            pin,
            extraMinutes: (result as { extra_minutes?: number }).extra_minutes || 0,
            plannedEnd: (result as { planned_end?: string }).planned_end || null,
            isLeaveExtra: (result as { is_leave_extra?: boolean }).is_leave_extra === true,
          });
          setStep("idle");
          return;
        }

        setConfirmedEvent(result.event);
        setConfirmedLateMinutes(result.late_minutes ?? null);
        setEarlyDepartureData(null);
        setShiftFinishedData(null);
        setExtraTimeData(null);
        setDoubleShiftData(null);
        setStep("success");
      } catch (err: unknown) {
        if (import.meta.env.DEV) console.error("Badge error:", err);
        const error = err as {
          code?: string;
          planned_end?: string;
          next_shift?: { start_time: string; end_time: string; sequence_index: number };
          minutes_early?: number;
          shift_start?: string;
        };

        if (error.code === "INVALID_PIN") {
          setPinError("Code PIN incorrect");
          setStep("pin");
          return;
        }

        if (error.code === "PIN_NOT_SET") {
          setStep("pin");
          return;
        }

        if (error.code === "SHIFT_NOT_FINISHED" && error.planned_end) {
          setEarlyDepartureData({ plannedEnd: error.planned_end, selfieCaptured, pin });
          setStep("idle");
          return;
        }

        if (error.code === "SHIFT_FINISHED") {
          setShiftFinishedData({ nextShift: error.next_shift || null });
          setStep("idle");
          return;
        }

        if (error.code === "BADGE_TOO_EARLY") {
          setEarlyArrivalChoiceData({
            shiftStart: error.shift_start || "??:??",
            minutesEarly: error.minutes_early || 0,
            selfieCaptured,
            pin,
          });
          setStep("idle");
          return;
        }

        setStep("error");
      }
    },
    [activeEstablishmentId, createBadgeEvent]
  );

  // RGPD consent handlers
  const handleSelfieConsentAccept = useCallback(() => {
    setShowSelfieConsent(false);
    startCameraFlow();
  }, [startCameraFlow]);

  const handleSelfieConsentRefuse = useCallback(() => {
    setShowSelfieConsent(false);
    if (settings?.require_pin) {
      setStep("pin");
    } else {
      submitBadge(false);
    }
  }, [settings, submitBadge]);

  // Slider handler
  const handleSliderComplete = useCallback(() => {
    if (!badgeData?.status || !settings) return;

    const nextType = badgeData.status.nextEventType;

    if (nextType === "clock_in" && settings.require_selfie) {
      const consentStatus = getSelfieConsentStatus();
      if (consentStatus === "pending") {
        setShowSelfieConsent(true);
        return;
      }
      if (consentStatus === "refused") {
        if (settings.require_pin) {
          setStep("pin");
          return;
        }
        submitBadge(false);
        return;
      }
      startCameraFlow();
      return;
    }

    if (settings.require_pin) {
      setStep("pin");
      return;
    }

    submitBadge();
  }, [badgeData, settings, startCameraFlow, submitBadge]);

  // Camera handlers
  const handleCameraRetry = useCallback(async () => {
    const success = await requestCameraStream();
    if (success) {
      setStep("selfie");
    }
  }, [requestCameraStream]);

  const handleSelfieCapture = useCallback(() => {
    if (!settings) return;
    stopCameraStream();
    if (settings.require_pin) {
      setStep("pin");
    } else {
      submitBadge(true);
    }
  }, [settings, stopCameraStream, submitBadge]);

  const handleSelfieCancel = useCallback(() => {
    stopCameraStream();
    setCameraError(null);
    setStep("idle");
  }, [stopCameraStream]);

  // PIN handlers
  const handlePinSubmit = useCallback(
    async (pin: string) => {
      setPinError(null);

      if (pinStatus && !pinStatus.has_pin) {
        if (!pendingPin) {
          setPendingPin(pin);
          return;
        }

        if (pin !== pendingPin) {
          setPinError("Les codes PIN ne correspondent pas");
          setPendingPin(null);
          return;
        }

        try {
          await createPin.mutateAsync(pin);
          setPendingPin(null);
          submitBadge(badgeData?.status.nextEventType === "clock_in", pin);
        } catch (err: unknown) {
          setPinError(err instanceof Error ? err.message : "Erreur lors de la création du PIN");
        }
        return;
      }

      submitBadge(badgeData?.status.nextEventType === "clock_in", pin);
    },
    [pinStatus, pendingPin, badgeData, createPin, submitBadge]
  );

  const handlePinCancel = useCallback(() => {
    setStep("idle");
    setPendingPin(null);
    setPinError(null);
  }, []);

  // Confirmation handler
  const handleConfirmationClose = useCallback(() => {
    setConfirmedEvent(null);
    setConfirmedLateMinutes(null);
    setStep("idle");
  }, []);

  // Early departure handlers
  const handleEarlyDepartureCancel = useCallback(() => {
    setEarlyDepartureData(null);
    setStep("idle");
  }, []);

  const handleEarlyDepartureConfirm = useCallback(() => {
    if (!earlyDepartureData) return;
    submitBadge(earlyDepartureData.selfieCaptured, earlyDepartureData.pin, true);
  }, [earlyDepartureData, submitBadge]);

  // Shift finished handler
  const handleShiftFinishedClose = useCallback(() => {
    setShiftFinishedData(null);
    setStep("idle");
  }, []);

  // Early arrival choice handlers
  const handleEarlyArrivalChoiceClose = useCallback(() => {
    setEarlyArrivalChoiceData(null);
    setStep("idle");
  }, []);

  const handleEarlyArrivalConfirmExtra = useCallback(async () => {
    if (!earlyArrivalChoiceData || !activeEstablishmentId) return;

    setStep("confirming");
    try {
      const result = await createBadgeEvent.mutateAsync({
        establishmentId: activeEstablishmentId,
        deviceId: getDeviceId(),
        pin: earlyArrivalChoiceData.pin,
        selfieCaptured: earlyArrivalChoiceData.selfieCaptured,
        earlyExtraConfirmed: true,
      });
      setConfirmedEvent(result.event);
      setConfirmedLateMinutes(null);
      setEarlyArrivalChoiceData(null);
      setStep("success");
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error("Badge error (early extra):", err);
      setEarlyArrivalChoiceData(null);
      setStep("error");
    }
  }, [earlyArrivalChoiceData, activeEstablishmentId, createBadgeEvent]);

  const handleEarlyArrivalDeclineExtra = useCallback(() => {
    if (!earlyArrivalChoiceData) return;
    setEarlyArrivalData({
      shiftStart: earlyArrivalChoiceData.shiftStart,
      minutesEarly: earlyArrivalChoiceData.minutesEarly,
    });
    setEarlyArrivalChoiceData(null);
  }, [earlyArrivalChoiceData]);

  const handleEarlyArrivalClose = useCallback(() => {
    setEarlyArrivalData(null);
    setStep("idle");
  }, []);

  // Extra time handlers
  const handleExtraTimeClose = useCallback(() => {
    setExtraTimeData(null);
    setStep("idle");
  }, []);

  const handleExtraTimeNoExtra = useCallback(async () => {
    if (!extraTimeData || !activeEstablishmentId) return;

    setStep("confirming");
    try {
      const result = await createBadgeEvent.mutateAsync({
        establishmentId: activeEstablishmentId,
        deviceId: getDeviceId(),
        pin: extraTimeData.pin,
        selfieCaptured: extraTimeData.selfieCaptured,
        extraConfirmed: true,
        forcePlannedEnd: true,
      });
      setConfirmedEvent(result.event);
      setConfirmedLateMinutes(null);
      setExtraTimeData(null);
      setStep("success");
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error("Badge error (no extra):", err);
      setExtraTimeData(null);
      setStep("error");
    }
  }, [extraTimeData, activeEstablishmentId, createBadgeEvent]);

  const handleExtraTimeYesExtra = useCallback(async () => {
    if (!extraTimeData || !activeEstablishmentId) return;

    setStep("confirming");

    const withTimeout = <T>(promise: Promise<T>, ms: number) =>
      Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error("UI_TIMEOUT")), ms)),
      ]);

    try {
      const result = await withTimeout(
        createBadgeEvent.mutateAsync({
          establishmentId: activeEstablishmentId,
          deviceId: getDeviceId(),
          pin: extraTimeData.pin,
          selfieCaptured: extraTimeData.selfieCaptured,
          extraConfirmed: true,
        }),
        8000
      );

      setConfirmedEvent(result.event);
      setConfirmedLateMinutes(null);
      setExtraTimeData(null);
      setStep("success");
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "UI_TIMEOUT") {
        setStep("idle");
        toast.error("Connexion lente — La demande met trop de temps. Réessayez.");
        return;
      }

      if (import.meta.env.DEV) console.error("Badge error (yes extra):", err);
      setExtraTimeData(null);
      setStep("error");
    }
  }, [extraTimeData, activeEstablishmentId, createBadgeEvent]);

  // V14: Double-shift resolution handlers
  const handleDoubleShiftResolveForget = useCallback(async () => {
    if (!doubleShiftData || !activeEstablishmentId) return;

    setStep("confirming");
    try {
      const clockOutTime = doubleShiftData.plannedEndTime || "12:00";
      const result = await resolveDoubleShift.mutateAsync({
        establishmentId: activeEstablishmentId,
        deviceId: getDeviceId(),
        clockOutTime,
        pin: doubleShiftData.pin,
        selfieCaptured: doubleShiftData.selfieCaptured,
      });
      setConfirmedEvent(result.event);
      setConfirmedLateMinutes(result.late_minutes ?? null);
      setDoubleShiftData(null);
      setStep("success");
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error("Resolve double shift error:", err);
      setDoubleShiftData(null);
      setStep("error");
    }
  }, [doubleShiftData, activeEstablishmentId, resolveDoubleShift]);

  const handleDoubleShiftResolvePlanningChanged = useCallback(() => {
    toast.info("Contactez votre responsable pour corriger votre planning.");
    setDoubleShiftData(null);
    setStep("idle");
  }, []);

  const handleDoubleShiftCancel = useCallback(() => {
    setDoubleShiftData(null);
    setStep("idle");
  }, []);

  // Compute PIN mode
  const pinMode: "create" | "confirm" | "enter" = !pinStatus?.has_pin
    ? pendingPin
      ? "confirm"
      : "create"
    : "enter";

  return {
    step,
    setStep,
    pendingPin,
    pinError,
    pinMode,
    cameraStream,
    cameraError,
    earlyDepartureData,
    shiftFinishedData,
    extraTimeData,
    earlyArrivalChoiceData,
    earlyArrivalData,
    doubleShiftData,
    confirmedEvent,
    confirmedLateMinutes,
    showSelfieConsent,
    pinStatus,
    pinStatusLoading,
    createPin,
    createBadgeEvent,
    handleSliderComplete,
    handleSelfieCapture,
    handleSelfieCancel,
    handleCameraRetry,
    handlePinSubmit,
    handlePinCancel,
    handleConfirmationClose,
    handleSelfieConsentAccept,
    handleSelfieConsentRefuse,
    handleEarlyDepartureCancel,
    handleEarlyDepartureConfirm,
    handleShiftFinishedClose,
    handleEarlyArrivalChoiceClose,
    handleEarlyArrivalConfirmExtra,
    handleEarlyArrivalDeclineExtra,
    handleEarlyArrivalClose,
    handleExtraTimeClose,
    handleExtraTimeNoExtra,
    handleExtraTimeYesExtra,
    handleDoubleShiftResolveForget,
    handleDoubleShiftResolvePlanningChanged,
    handleDoubleShiftCancel,
  };
}
