import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShiftCoreFooterProps {
  // Create button
  showCreateButton: boolean;
  isCreateDisabled: boolean;
  isCreating: boolean;
  onCreateShift: () => void;
  // Leave button
  showLeaveButton: boolean;
  selectedLeaveType: "cp" | "absence" | "rest" | "am" | null;
  isMarkingLeave: boolean;
  onConfirmLeave: () => void;
  // Add second shift button
  showAddSecondButton: boolean;
  isLoading: boolean;
  onAddSecondShift: () => void;
}

/**
 * Footer section with action buttons
 */
export function ShiftCoreFooter({
  showCreateButton,
  isCreateDisabled,
  isCreating,
  onCreateShift,
  showLeaveButton,
  selectedLeaveType,
  isMarkingLeave,
  onConfirmLeave,
  showAddSecondButton,
  isLoading,
  onAddSecondShift,
}: ShiftCoreFooterProps) {
  return (
    <>
      {/* Add 2nd shift button */}
      {showAddSecondButton && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAddSecondShift}
          className="w-full"
          disabled={isLoading}
        >
          <Plus className="h-4 w-4 mr-2" />
          Ajouter un 2e shift
        </Button>
      )}

      {/* Footer actions */}
      <div className="flex justify-end gap-2 pt-2">
        {showLeaveButton && selectedLeaveType && (
          <Button
            onClick={onConfirmLeave}
            disabled={isMarkingLeave}
            className={cn(
              selectedLeaveType === "cp" &&
                "bg-emerald-600 dark:bg-emerald-700 hover:bg-emerald-700 dark:hover:bg-emerald-600",
              selectedLeaveType === "absence" &&
                "bg-amber-600 dark:bg-amber-700 hover:bg-amber-700 dark:hover:bg-amber-600",
              selectedLeaveType === "rest" && "bg-slate-600 hover:bg-slate-700",
              selectedLeaveType === "am" &&
                "bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-600"
            )}
          >
            {isMarkingLeave
              ? "Validation..."
              : selectedLeaveType === "cp"
                ? "Valider CP"
                : selectedLeaveType === "rest"
                  ? "Valider Repos"
                  : selectedLeaveType === "am"
                    ? "Valider AM"
                    : "Valider Absence"}
          </Button>
        )}
        {showCreateButton && (
          <Button onClick={onCreateShift} disabled={isCreateDisabled}>
            {isCreating ? "Enregistrement..." : "Enregistrer"}
          </Button>
        )}
      </div>
    </>
  );
}
