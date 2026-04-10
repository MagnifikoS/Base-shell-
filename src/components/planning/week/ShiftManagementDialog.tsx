import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShiftManagementCore } from "../shared/ShiftManagementCore";
import type { PlanningShift, PlanningOpeningWindow } from "../types/planning.types";

interface ShiftManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess?: () => void;
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
  // Leave props
  onMarkLeave?: (leaveType: "cp" | "absence" | "rest" | "am") => void;
  isMarkingLeave?: boolean;
  existingLeaveType?: "cp" | "absence" | "rest" | "am" | null;
  onCancelLeave?: () => void;
  isCancelingLeave?: boolean;
  // Badge props
  onBadgeShift?: (shift: PlanningShift) => void;
  isBadging?: boolean;
  // R-Extra props (PHASE 1)
  rextraBalanceMinutes?: number;
  existingRextraMinutes?: number;
  onSetRextra?: (minutes: number) => void;
  onClearRextra?: () => void;
  isSettingRextra?: boolean;
  isClearingRextra?: boolean;
  // Unified modal UX
  keepOpenAfterOperation?: boolean;
  onSwitchToShiftMode?: () => void;
}

export function ShiftManagementDialog({
  isOpen,
  onClose,
  onSaveSuccess,
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
  // R-Extra props
  rextraBalanceMinutes = 0,
  existingRextraMinutes = 0,
  onSetRextra,
  onClearRextra,
  isSettingRextra = false,
  isClearingRextra = false,
  // Unified modal UX
  keepOpenAfterOperation = false,
  onSwitchToShiftMode,
}: ShiftManagementDialogProps) {
  const hasShifts = existingShifts.length > 0;
  const hasLeave = existingLeaveType !== null && existingLeaveType !== undefined;

  // Dynamic title: reflects current state
  const dialogTitle = hasLeave
    ? "Gérer le congé"
    : hasShifts
      ? "Gérer les shifts"
      : "Nouveau shift";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            Gestion des horaires de travail pour cet employé.
          </DialogDescription>
        </DialogHeader>

        <ShiftManagementCore
          employeeName={employeeName}
          shiftDate={shiftDate}
          existingShifts={existingShifts}
          openingWindow={openingWindow}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onSaveSuccess={onSaveSuccess}
          isCreating={isCreating}
          isUpdating={isUpdating}
          isDeleting={isDeleting}
          prefillStartTime={prefillStartTime}
          prefillEndTime={prefillEndTime}
          errorMessage={errorMessage}
          onClearError={onClearError}
          onMarkLeave={onMarkLeave}
          isMarkingLeave={isMarkingLeave}
          existingLeaveType={existingLeaveType}
          onCancelLeave={onCancelLeave}
          isCancelingLeave={isCancelingLeave}
          onBadgeShift={onBadgeShift}
          isBadging={isBadging}
          // R-Extra props
          rextraBalanceMinutes={rextraBalanceMinutes}
          existingRextraMinutes={existingRextraMinutes}
          onSetRextra={onSetRextra}
          onClearRextra={onClearRextra}
          isSettingRextra={isSettingRextra}
          isClearingRextra={isClearingRextra}
          // Unified modal UX
          keepOpenAfterOperation={keepOpenAfterOperation}
          onSwitchToShiftMode={onSwitchToShiftMode}
        />
      </DialogContent>
    </Dialog>
  );
}
