import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { PlanningShift, PlanningOpeningWindow } from "../types/planning.types";
import {
  ShiftCoreHeader,
  ShiftCoreLeaveActions,
  ShiftCoreShiftForm,
  ShiftCoreShiftList,
  ShiftCoreFooter,
  ShiftCoreLeaveConfirmDialog,
  type TimeOption,
  labelToValue,
  valueToLabel,
  generateTimeOptions,
  rangesOverlapByValue,
  getDisplayErrorMessage,
  formatShiftDate,
} from "./shift-core";
import type { ShiftEditState } from "./shift-core/ShiftCoreShiftList";
import { RextraInputModal } from "@/modules/rextra";

export interface ShiftManagementCoreProps {
  employeeName: string;
  shiftDate: string;
  existingShifts: PlanningShift[];
  openingWindow?: PlanningOpeningWindow;
  onCreate: (startTime: string, endTime: string) => void;
  onUpdate: (shiftId: string, startTime: string, endTime: string) => void;
  onDelete: (shiftId: string) => void;
  isCreating?: boolean;
  isUpdating?: boolean;
  isDeleting?: boolean;
  prefillStartTime?: string | null;
  prefillEndTime?: string | null;
  errorMessage?: string | null;
  onClearError?: () => void;
  onMarkLeave?: (leaveType: "cp" | "absence" | "rest" | "am") => void;
  isMarkingLeave?: boolean;
  existingLeaveType?: "cp" | "absence" | "rest" | "am" | null;
  onCancelLeave?: () => void;
  isCancelingLeave?: boolean;
  onBadgeShift?: (shift: PlanningShift) => void;
  isBadging?: boolean;
  rextraBalanceMinutes?: number;
  existingRextraMinutes?: number;
  onSetRextra?: (minutes: number) => void;
  onClearRextra?: () => void;
  isSettingRextra?: boolean;
  isClearingRextra?: boolean;
  keepOpenAfterOperation?: boolean;
  onSwitchToShiftMode?: () => void;
  onSaveSuccess?: () => void;
}

export function ShiftManagementCore({
  employeeName,
  shiftDate,
  existingShifts,
  openingWindow,
  onCreate,
  onUpdate,
  onDelete,
  isCreating = false,
  isUpdating = false,
  isDeleting = false,
  prefillStartTime = null,
  prefillEndTime = null,
  errorMessage = null,
  onClearError,
  onMarkLeave,
  isMarkingLeave = false,
  existingLeaveType = null,
  onCancelLeave,
  isCancelingLeave = false,
  onBadgeShift,
  isBadging = false,
  rextraBalanceMinutes = 0,
  existingRextraMinutes = 0,
  onSetRextra,
  onClearRextra,
  isSettingRextra = false,
  isClearingRextra = false,
  keepOpenAfterOperation = false,
  onSwitchToShiftMode,
  onSaveSuccess,
}: ShiftManagementCoreProps) {
  const isClosed = openingWindow?.isClosed ?? false;
  const openTime = openingWindow?.open_time ?? "00:00";
  const closeTime = openingWindow?.close_time ?? "23:45";

  const openMin = useMemo(() => {
    const [h, m] = openTime.split(":").map(Number);
    return h * 60 + m;
  }, [openTime]);

  const isOvernight = useMemo(() => {
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const closeMin = closeH * 60 + closeM;
    return closeMin < openMin;
  }, [closeTime, openMin]);

  const canAddShift = existingShifts.length < 2 && !isClosed;
  const hasShifts = existingShifts.length > 0;

  // State for leave selection
  const [selectedLeaveType, setSelectedLeaveType] = useState<
    "cp" | "absence" | "rest" | "am" | null
  >(existingLeaveType ?? null);
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [pendingLeaveType, setPendingLeaveType] = useState<"cp" | "absence" | "rest" | "am" | null>(
    null
  );

  // State for R-Extra modal
  const [showRextraModal, setShowRextraModal] = useState(false);

  // State for shift creation forms (new shifts only)
  // Initialize immediately so shift form appears at the same time as leave buttons (no 2-step effect)
  const [showFirstShiftForm, setShowFirstShiftForm] = useState(
    () => existingShifts.length < 2 && !(openingWindow?.isClosed ?? false) && existingShifts.length === 0 && !existingLeaveType
  );
  const [showSecondShiftForm, setShowSecondShiftForm] = useState(false);
  const [firstStartTime, setFirstStartTime] = useState("");
  const [firstEndTime, setFirstEndTime] = useState("");
  const [secondStartTime, setSecondStartTime] = useState("");
  const [secondEndTime, setSecondEndTime] = useState("");
  const [secondInlineError, setSecondInlineError] = useState<string | null>(null);

  // ═══ INLINE EDIT STATE — all existing shifts always editable ═══
  const [editStates, setEditStates] = useState<Record<string, { startTime: string; endTime: string }>>({});

  // Track previous loading states
  const prevIsCreatingRef = useRef(isCreating);
  const prevIsUpdatingRef = useRef(isUpdating);
  const prevIsDeletingRef = useRef(isDeleting);
  // Track if the deleted shift was the last one → close dialog
  const shiftsCountAtDeleteRef = useRef(0);
  const prevIsMarkingLeaveRef = useRef(isMarkingLeave);
  const prevIsCancelingLeaveRef = useRef(isCancelingLeave);
  // Track pending update count for batch saves
  const pendingUpdatesRef = useRef(0);

  const isLeaveMode = selectedLeaveType !== null;
  const hasExistingRextra = existingRextraMinutes > 0;
  const canShowAddSecondButton =
    canAddShift && !showSecondShiftForm && !isLeaveMode && !hasExistingRextra;
  const isLoading =
    isCreating || isUpdating || isDeleting || isMarkingLeave || isSettingRextra || isClearingRextra;

  // Generate time options
  const startOptions = useMemo(() => {
    if (isClosed) return [];
    const opts = generateTimeOptions(openTime, closeTime);
    return opts.slice(0, -1);
  }, [isClosed, openTime, closeTime]);

  const getEndOptions = useCallback(
    (startTimeValue: string): TimeOption[] => {
      if (isClosed || !startTimeValue) return [];
      const allOpts = generateTimeOptions(openTime, closeTime);
      const startMin = parseInt(startTimeValue, 10);
      if (isNaN(startMin)) return [];
      return allOpts.filter((opt) => parseInt(opt.value, 10) > startMin);
    },
    [isClosed, openTime, closeTime]
  );

  // ═══ Initialize edit states from existing shifts ═══
  useEffect(() => {
    const newStates: Record<string, { startTime: string; endTime: string }> = {};
    for (const shift of existingShifts) {
      const startVal = labelToValue(shift.start_time, openMin, isOvernight);
      const endVal = labelToValue(shift.end_time, openMin, isOvernight);
      // Preserve user edits if shift already tracked, otherwise init from DB
      if (editStates[shift.id]) {
        newStates[shift.id] = editStates[shift.id];
      } else {
        newStates[shift.id] = { startTime: startVal, endTime: endVal };
      }
    }
    // Only update if shift IDs changed (added/removed)
    const currentIds = Object.keys(editStates).sort().join(",");
    const newIds = Object.keys(newStates).sort().join(",");
    if (currentIds !== newIds) {
      setEditStates(newStates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingShifts.map(s => s.id).join(","), openMin, isOvernight]);

  // Re-initialize edit states from DB values when shifts data changes (after save)
  const shiftsFingerprint = existingShifts.map(s => `${s.id}:${s.start_time}:${s.end_time}`).join("|");
  const prevShiftsFingerprintRef = useRef(shiftsFingerprint);
  useEffect(() => {
    if (prevShiftsFingerprintRef.current !== shiftsFingerprint) {
      const newStates: Record<string, { startTime: string; endTime: string }> = {};
      for (const shift of existingShifts) {
        newStates[shift.id] = {
          startTime: labelToValue(shift.start_time, openMin, isOvernight),
          endTime: labelToValue(shift.end_time, openMin, isOvernight),
        };
      }
      setEditStates(newStates);
      prevShiftsFingerprintRef.current = shiftsFingerprint;
    }
  }, [shiftsFingerprint, existingShifts, openMin, isOvernight]);

  // Build editStates with endOptions for ShiftCoreShiftList
  const editStatesWithOptions: Record<string, ShiftEditState> = useMemo(() => {
    const result: Record<string, ShiftEditState> = {};
    for (const [id, state] of Object.entries(editStates)) {
      result[id] = {
        startTime: state.startTime,
        endTime: state.endTime,
        endOptions: getEndOptions(state.startTime),
      };
    }
    return result;
  }, [editStates, getEndOptions]);

  // Detect operation completion
  useEffect(() => {
    if (!keepOpenAfterOperation) {
      prevIsCreatingRef.current = isCreating;
      prevIsUpdatingRef.current = isUpdating;
      prevIsDeletingRef.current = isDeleting;
      prevIsMarkingLeaveRef.current = isMarkingLeave;
      prevIsCancelingLeaveRef.current = isCancelingLeave;
      return;
    }

    // Create completed
    if (prevIsCreatingRef.current && !isCreating && !errorMessage) {
      setShowFirstShiftForm(false);
      setShowSecondShiftForm(false);
      setSecondInlineError(null);
      if (startOptions.length > 0) {
        setFirstStartTime(startOptions[0].value);
        setSecondStartTime(startOptions[0].value);
      }
      onSaveSuccess?.();
    }

    // Update completed
    if (prevIsUpdatingRef.current && !isUpdating && !errorMessage) {
      pendingUpdatesRef.current = Math.max(0, pendingUpdatesRef.current - 1);
      if (pendingUpdatesRef.current <= 0) {
        onSaveSuccess?.();
      }
    }

    // Delete completed
    if (prevIsDeletingRef.current && !isDeleting && !errorMessage) {
      setShowSecondShiftForm(false);
      setSecondInlineError(null);
      // Close dialog if deleted the last shift
      if (shiftsCountAtDeleteRef.current <= 1) {
        onSaveSuccess?.();
      }
    }

    // Mark leave completed → close dialog
    if (prevIsMarkingLeaveRef.current && !isMarkingLeave && !errorMessage) {
      setSelectedLeaveType(null);
      onSaveSuccess?.();
    }

    // Cancel leave completed → close dialog
    if (prevIsCancelingLeaveRef.current && !isCancelingLeave && !errorMessage) {
      setSelectedLeaveType(null);
      onSaveSuccess?.();
    }

    prevIsCreatingRef.current = isCreating;
    prevIsUpdatingRef.current = isUpdating;
    prevIsDeletingRef.current = isDeleting;
    prevIsMarkingLeaveRef.current = isMarkingLeave;
    prevIsCancelingLeaveRef.current = isCancelingLeave;
  }, [
    keepOpenAfterOperation,
    isCreating,
    isUpdating,
    isDeleting,
    isMarkingLeave,
    isCancelingLeave,
    errorMessage,
    startOptions,
    onSaveSuccess,
  ]);

  const firstEndOptions = useMemo(
    () => getEndOptions(firstStartTime),
    [firstStartTime, getEndOptions]
  );
  const secondEndOptions = useMemo(
    () => getEndOptions(secondStartTime),
    [secondStartTime, getEndOptions]
  );

  // Handlers for creation forms
  const handleFirstStartChange = (value: string) => {
    onClearError?.();
    setFirstStartTime(value);
  };
  const handleFirstEndChange = (value: string) => {
    onClearError?.();
    setFirstEndTime(value);
  };
  const handleSecondStartChange = (value: string) => {
    onClearError?.();
    setSecondInlineError(null);
    setSecondStartTime(value);
  };
  const handleSecondEndChange = (value: string) => {
    onClearError?.();
    setSecondInlineError(null);
    setSecondEndTime(value);
  };

  // ═══ Inline edit handlers ═══
  const handleInlineStartChange = (shiftId: string, value: string) => {
    onClearError?.();
    setEditStates((prev) => ({
      ...prev,
      [shiftId]: { ...prev[shiftId], startTime: value },
    }));
  };

  const handleInlineEndChange = (shiftId: string, value: string) => {
    onClearError?.();
    setEditStates((prev) => ({
      ...prev,
      [shiftId]: { ...prev[shiftId], endTime: value },
    }));
  };

  const findOptionByValue = (options: TimeOption[], value: string): TimeOption | undefined => {
    return options.find((opt) => opt.value === value);
  };

  // Effects for creation state management
  useEffect(() => {
    setSecondInlineError(null);
    const shouldShowFirstForm = !hasShifts && canAddShift && !existingLeaveType;
    const shouldShowSecondForm = prefillStartTime !== null && hasShifts && canAddShift;
    setShowFirstShiftForm(shouldShowFirstForm);
    setShowSecondShiftForm(shouldShowSecondForm);

    if (startOptions.length > 0) setFirstStartTime(startOptions[0].value);
    if (prefillEndTime) setFirstEndTime(labelToValue(prefillEndTime, openMin, isOvernight));
    if (startOptions.length > 0) setSecondStartTime(startOptions[0].value);
    if (prefillStartTime) setSecondStartTime(labelToValue(prefillStartTime, openMin, isOvernight));
    if (prefillEndTime) setSecondEndTime(labelToValue(prefillEndTime, openMin, isOvernight));
  }, [
    existingShifts.length,
    startOptions,
    prefillStartTime,
    prefillEndTime,
    canAddShift,
    hasShifts,
    openMin,
    isOvernight,
    existingLeaveType,
  ]);

  useEffect(() => {
    if (firstEndOptions.length > 0 && !findOptionByValue(firstEndOptions, firstEndTime)) {
      setFirstEndTime(firstEndOptions[0].value);
    }
  }, [firstEndOptions, firstEndTime]);

  useEffect(() => {
    if (secondEndOptions.length > 0 && !findOptionByValue(secondEndOptions, secondEndTime)) {
      setSecondEndTime(secondEndOptions[0].value);
    }
  }, [secondEndOptions, secondEndTime]);

  useEffect(() => {
    if (!!errorMessage && hasShifts && canAddShift) setShowSecondShiftForm(true);
  }, [errorMessage, hasShifts, canAddShift]);

  // Check overlap with existing shifts (for new shift creation)
  const overlapsWithExistingShifts = (startVal: string, endVal: string): boolean => {
    return existingShifts.some((s) => {
      const sStartVal = labelToValue(s.start_time, openMin, isOvernight);
      const sEndVal = labelToValue(s.end_time, openMin, isOvernight);
      return rangesOverlapByValue(sStartVal, sEndVal, startVal, endVal);
    });
  };

  // ═══ Save ALL modified shifts at once ═══
  const handleSaveAllEdits = () => {
    let updateCount = 0;
    for (const shift of existingShifts) {
      const state = editStates[shift.id];
      if (!state) continue;
      const origStart = labelToValue(shift.start_time, openMin, isOvernight);
      const origEnd = labelToValue(shift.end_time, openMin, isOvernight);
      if (state.startTime !== origStart || state.endTime !== origEnd) {
        updateCount++;
      }
    }
    pendingUpdatesRef.current = updateCount;

    for (const shift of existingShifts) {
      const state = editStates[shift.id];
      if (!state) continue;
      const origStart = labelToValue(shift.start_time, openMin, isOvernight);
      const origEnd = labelToValue(shift.end_time, openMin, isOvernight);
      if (state.startTime !== origStart || state.endTime !== origEnd) {
        onUpdate(shift.id, valueToLabel(state.startTime), valueToLabel(state.endTime));
      }
    }

    // If nothing changed, just close
    if (updateCount === 0) {
      onSaveSuccess?.();
    }
  };

  // Actions for creation
  const handleCreateShift = async () => {
    if (!hasShifts && showSecondShiftForm) {
      if (!firstStartTime || !firstEndTime || !secondStartTime || !secondEndTime) return;
      if (rangesOverlapByValue(firstStartTime, firstEndTime, secondStartTime, secondEndTime)) {
        setSecondInlineError(
          "Le 2e shift chevauche un autre shift. Modifie les horaires pour éviter le chevauchement."
        );
        return;
      }
      setSecondInlineError(null);
      onCreate(valueToLabel(firstStartTime), valueToLabel(firstEndTime));
      onCreate(valueToLabel(secondStartTime), valueToLabel(secondEndTime));
      return;
    }

    if (!hasShifts) {
      if (!firstStartTime || !firstEndTime) return;
      onCreate(valueToLabel(firstStartTime), valueToLabel(firstEndTime));
      return;
    }

    if (!showSecondShiftForm || !secondStartTime || !secondEndTime) return;
    if (overlapsWithExistingShifts(secondStartTime, secondEndTime)) {
      setSecondInlineError(
        "Le 2e shift chevauche un autre shift. Modifie les horaires pour éviter le chevauchement."
      );
      return;
    }
    setSecondInlineError(null);
    onCreate(valueToLabel(secondStartTime), valueToLabel(secondEndTime));
  };

  const handleAddSecondShift = () => {
    setShowSecondShiftForm(true);
    setSecondInlineError(null);
    if (startOptions.length > 0 && !secondStartTime) setSecondStartTime(startOptions[0].value);
  };

  const handleConfirmLeave = () => {
    if (hasShifts) {
      setPendingLeaveType(selectedLeaveType);
      setShowLeaveConfirmation(true);
    } else if (onMarkLeave && selectedLeaveType) {
      onMarkLeave(selectedLeaveType);
    }
  };

  const handleLeaveConfirmed = () => {
    if (pendingLeaveType && onMarkLeave) onMarkLeave(pendingLeaveType);
    setShowLeaveConfirmation(false);
    setPendingLeaveType(null);
  };

  const handleSwitchToShiftMode = () => {
    if (onSwitchToShiftMode) {
      onSwitchToShiftMode();
    }
    setSelectedLeaveType(null);
    // Explicitly show the first shift form — the useEffect won't do it
    // because existingLeaveType (prop) is still truthy until the leave is actually deleted
    if (!hasShifts) {
      setShowFirstShiftForm(true);
    }
  };

  // Computed UI state
  const displayError = getDisplayErrorMessage(errorMessage);
  const formattedDate = formatShiftDate(shiftDate);
  const openingDisplay = isClosed ? "Fermé" : `${openTime} → ${closeTime}`;

  // Show create button for new shifts (creation flow unchanged)
  const showCreateButton =
    !isLeaveMode &&
    !hasExistingRextra &&
    ((showFirstShiftForm && !hasShifts) || (showSecondShiftForm && hasShifts)) &&
    !isClosed;

  // Show save button for existing shifts (always visible when shifts exist)
  const showSaveExistingButton =
    hasShifts && !isLeaveMode && !hasExistingRextra && !isClosed && !showSecondShiftForm;

  const showLeaveButton =
    isLeaveMode &&
    onMarkLeave &&
    !isClosed &&
    !hasExistingRextra &&
    !existingLeaveType &&
    !isCancelingLeave;

  const isCreateDisabled =
    isLoading ||
    (!hasShifts
      ? !firstStartTime ||
        !firstEndTime ||
        (showSecondShiftForm && (!secondStartTime || !secondEndTime))
      : !secondStartTime || !secondEndTime);

  // Handlers for R-Extra
  const handleRextraClick = () => {
    setShowRextraModal(true);
  };

  const handleRextraConfirm = (minutes: number) => {
    if (onSetRextra) {
      onSetRextra(minutes);
    }
    setShowRextraModal(false);
  };

  return (
    <div className="space-y-4">
      <ShiftCoreHeader
        employeeName={employeeName}
        formattedDate={formattedDate}
        openingDisplay={openingDisplay}
        isClosed={isClosed}
      />

      {isClosed ? (
        <div className="text-sm text-destructive text-center py-4">
          Le restaurant est fermé ce jour, aucun shift ne peut être planifié.
        </div>
      ) : (
        <>
          {onMarkLeave && (
            <ShiftCoreLeaveActions
              selectedLeaveType={selectedLeaveType}
              existingLeaveType={existingLeaveType}
              onSelectLeaveType={setSelectedLeaveType}
              onCancelLeave={onCancelLeave}
              isCancelingLeave={isCancelingLeave}
              isLoading={isLoading}
              rextraBalanceMinutes={rextraBalanceMinutes}
              onRextraClick={handleRextraClick}
              existingRextraMinutes={existingRextraMinutes}
              onClearRextra={onClearRextra}
              isClearingRextra={isClearingRextra}
            />
          )}

          {/* Switch from leave to shift mode */}
          {existingLeaveType && onSwitchToShiftMode && !hasExistingRextra && (
            <button
              type="button"
              className="w-full text-sm text-primary hover:underline py-1 text-center"
              onClick={handleSwitchToShiftMode}
              disabled={isLoading}
            >
              Remplacer le congé par un shift
            </button>
          )}

          {/* Hide shift forms if R.Extra is active */}
          {!hasExistingRextra && (
            <>
              {/* Existing shifts — always inline-editable */}
              <ShiftCoreShiftList
                shifts={existingShifts}
                editStates={editStatesWithOptions}
                startOptions={startOptions}
                isLeaveMode={isLeaveMode}
                isLoading={isLoading}
                onDeleteShift={(shiftId) => {
                  shiftsCountAtDeleteRef.current = existingShifts.length;
                  onDelete(shiftId);
                }}
                onEditStartChange={handleInlineStartChange}
                onEditEndChange={handleInlineEndChange}
                onBadgeShift={onBadgeShift}
                isBadging={isBadging}
                hideDeleteButtons={existingShifts.length <= 1}
              />

              {/* Creation form for first shift (only when no shifts exist) */}
              {showFirstShiftForm && !hasShifts && (
                <ShiftCoreShiftForm
                  shiftNumber={1}
                  startTime={firstStartTime}
                  endTime={firstEndTime}
                  startOptions={startOptions}
                  endOptions={firstEndOptions}
                  onStartChange={handleFirstStartChange}
                  onEndChange={handleFirstEndChange}
                  errorMessage={displayError}
                  isLeaveMode={isLeaveMode}
                />
              )}

              {/* Creation form for second shift */}
              {showSecondShiftForm && (
                <div className="relative">
                  <ShiftCoreShiftForm
                    shiftNumber={hasShifts ? 2 : 2}
                    startTime={secondStartTime}
                    endTime={secondEndTime}
                    startOptions={startOptions}
                    endOptions={secondEndOptions}
                    onStartChange={handleSecondStartChange}
                    onEndChange={handleSecondEndChange}
                    errorMessage={secondInlineError || (hasShifts ? displayError : null)}
                    isLeaveMode={false}
                  />
                  <button
                    type="button"
                    className="absolute top-2 right-2 text-xs text-destructive hover:underline"
                    onClick={() => {
                      setShowSecondShiftForm(false);
                      setSecondStartTime("");
                      setSecondEndTime("");
                      setSecondInlineError(null);
                    }}
                    disabled={isLoading}
                  >
                    Retirer
                  </button>
                </div>
              )}

              {/* Save / Delete buttons for existing shifts */}
              {showSaveExistingButton && (
                <div className="flex justify-between items-center pt-2">
                  {/* Delete button only for single shift */}
                  {existingShifts.length === 1 ? (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-destructive text-destructive hover:bg-destructive/10 h-10 px-4 py-2"
                      onClick={() => {
                        shiftsCountAtDeleteRef.current = 1;
                        onDelete(existingShifts[0].id);
                      }}
                      disabled={isLoading}
                    >
                      {isDeleting ? "Suppression..." : "Supprimer"}
                    </button>
                  ) : (
                    <div />
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                    onClick={handleSaveAllEdits}
                    disabled={isLoading}
                  >
                    {isUpdating ? "Enregistrement..." : "Enregistrer"}
                  </button>
                </div>
              )}

              <ShiftCoreFooter
                showCreateButton={showCreateButton}
                isCreateDisabled={isCreateDisabled}
                isCreating={isCreating}
                onCreateShift={handleCreateShift}
                showLeaveButton={!!showLeaveButton}
                selectedLeaveType={selectedLeaveType}
                isMarkingLeave={isMarkingLeave}
                onConfirmLeave={handleConfirmLeave}
                showAddSecondButton={canShowAddSecondButton}
                isLoading={isLoading}
                onAddSecondShift={handleAddSecondShift}
              />
            </>
          )}
        </>
      )}

      <ShiftCoreLeaveConfirmDialog
        isOpen={showLeaveConfirmation}
        onClose={() => {
          setShowLeaveConfirmation(false);
          setPendingLeaveType(null);
        }}
        onConfirm={handleLeaveConfirmed}
        leaveType={pendingLeaveType}
        shiftsCount={existingShifts.length}
      />

      <RextraInputModal
        isOpen={showRextraModal}
        onClose={() => setShowRextraModal(false)}
        onConfirm={handleRextraConfirm}
        isLoading={isSettingRextra}
        employeeName={employeeName}
        date={shiftDate}
        availableMinutes={rextraBalanceMinutes}
      />
    </div>
  );
}
