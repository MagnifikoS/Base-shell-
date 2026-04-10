/**
 * Mobile wrapper for shift management
 * Uses the shared ShiftManagementCore component
 *
 * DUMB WRAPPER: receives employeeId from parent context
 * - Non-admin: employeeId = current user
 * - Admin: employeeId = selected employee from AdminEmployeePlanningView
 *
 * NO employee selection logic here.
 */

import { useState, useMemo, useCallback } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useCreateShift } from "@/components/planning/hooks/useCreateShift";
import { useUpdateShift } from "@/components/planning/hooks/useUpdateShift";
import { useDeleteShift } from "@/components/planning/hooks/useDeleteShift";
import { ShiftManagementCore } from "@/components/planning/shared/ShiftManagementCore";
import type {
  PlanningShift,
  PlanningOpeningWindow,
} from "@/components/planning/types/planning.types";

interface MobileShiftManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  dayLabel: string;
  establishmentId: string;
  weekStart: string;
  /** Employee already determined by parent context */
  employeeId: string;
  employeeName: string;
  /** Shifts filtered for this employee */
  shifts: PlanningShift[];
  openingWindow?: PlanningOpeningWindow;
}

export function MobileShiftManagementDialog({
  isOpen,
  onClose,
  date,
  dayLabel,
  establishmentId,
  weekStart,
  employeeId,
  employeeName,
  shifts,
  openingWindow,
}: MobileShiftManagementDialogProps) {
  // Mutation hooks - same as desktop
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();

  // Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter shifts for this employee (defensive - parent should already filter)
  const employeeShifts = useMemo(() => {
    return shifts.filter((s) => s.user_id === employeeId);
  }, [shifts, employeeId]);

  // Handlers for ShiftManagementCore
  const handleCreate = useCallback(
    async (startTime: string, endTime: string) => {
      setErrorMessage(null);
      try {
        await createShift.mutateAsync({
          establishmentId,
          weekStart,
          userId: employeeId,
          shiftDate: date,
          startTime,
          endTime,
        });
        // Modal stays open -- data refreshes via React Query
        setErrorMessage(null);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Erreur lors de la création";
        setErrorMessage(msg);
      }
    },
    [employeeId, establishmentId, weekStart, date, createShift]
  );

  const handleUpdate = useCallback(
    async (shiftId: string, startTime: string, endTime: string) => {
      setErrorMessage(null);
      try {
        await updateShift.mutateAsync({
          establishmentId,
          weekStart,
          shiftId,
          employeeId,
          startTime,
          endTime,
        });
        // Modal stays open -- data refreshes via React Query
        setErrorMessage(null);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Erreur lors de la modification";
        setErrorMessage(msg);
      }
    },
    [employeeId, establishmentId, weekStart, updateShift]
  );

  const handleDelete = useCallback(
    async (shiftId: string) => {
      setErrorMessage(null);
      try {
        await deleteShift.mutateAsync({
          establishmentId,
          weekStart,
          employeeId,
          shiftId,
        });
        // Modal stays open -- data refreshes via React Query
        setErrorMessage(null);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Erreur lors de la suppression";
        setErrorMessage(msg);
      }
    },
    [employeeId, establishmentId, weekStart, deleteShift]
  );

  const handleClearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const isLoading = createShift.isPending || updateShift.isPending || deleteShift.isPending;

  // Dynamic title
  const hasShifts = employeeShifts.length > 0;
  const dialogTitle = hasShifts ? "Gérer les shifts" : "Nouveau shift";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {dayLabel} - {date}
          </DialogDescription>
        </DialogHeader>

        {/* Core shift management - employee already determined */}
        <ShiftManagementCore
          employeeName={employeeName}
          shiftDate={date}
          existingShifts={employeeShifts}
          openingWindow={openingWindow}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          isCreating={createShift.isPending}
          isUpdating={updateShift.isPending}
          isDeleting={deleteShift.isPending}
          errorMessage={errorMessage}
          onClearError={handleClearError}
          keepOpenAfterOperation
        />

        {/* Close button */}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
