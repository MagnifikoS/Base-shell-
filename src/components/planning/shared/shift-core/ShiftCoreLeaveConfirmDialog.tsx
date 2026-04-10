import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ShiftCoreLeaveConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  leaveType: "cp" | "absence" | "rest" | "am" | null;
  shiftsCount: number;
}

/**
 * Confirmation dialog for marking leave when shifts exist
 */
export function ShiftCoreLeaveConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  leaveType,
  shiftsCount,
}: ShiftCoreLeaveConfirmDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Confirmer{" "}
            {leaveType === "cp"
              ? "CP"
              : leaveType === "rest"
                ? "Repos"
                : leaveType === "am"
                  ? "Arrêt maladie"
                  : "Absence"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Cela va supprimer {shiftsCount > 1 ? `les ${shiftsCount} shifts` : "le shift"} de la
            journée. Cette action est irréversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              leaveType === "cp" &&
                "bg-emerald-600 dark:bg-emerald-700 hover:bg-emerald-700 dark:hover:bg-emerald-600",
              leaveType === "absence" &&
                "bg-amber-600 dark:bg-amber-700 hover:bg-amber-700 dark:hover:bg-amber-600",
              leaveType === "rest" && "bg-slate-600 hover:bg-slate-700",
              leaveType === "am" &&
                "bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-600"
            )}
          >
            Confirmer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
