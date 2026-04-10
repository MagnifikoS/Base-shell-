import { ReplaceLeaveOnDropModal } from "../ReplaceLeaveOnDropModal";
import type { PersonnelLeave } from "@/hooks/personnel/usePersonnelLeaves";
import type { DragPayload } from "./PlanningWeekRowDnDHandlers";

interface PendingDropIntent {
  targetDate: string;
  payload: DragPayload;
  leave: PersonnelLeave;
}

interface ReplaceLeaveOnDropControllerProps {
  pendingDropIntent: PendingDropIntent | null;
  employeeName: string;
  isReplacingLeave: boolean;
  isCancelingLeave: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Controller component for the replace leave on drop modal
 * Manages state and delegates to ReplaceLeaveOnDropModal
 */
export function ReplaceLeaveOnDropController({
  pendingDropIntent,
  employeeName,
  isReplacingLeave,
  isCancelingLeave,
  onClose,
  onConfirm,
}: ReplaceLeaveOnDropControllerProps) {
  return (
    <ReplaceLeaveOnDropModal
      isOpen={pendingDropIntent !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      leaveType={pendingDropIntent?.leave.leave_type || "absence"}
      employeeName={employeeName}
      date={pendingDropIntent?.targetDate || ""}
      isLoading={isReplacingLeave || isCancelingLeave}
    />
  );
}
