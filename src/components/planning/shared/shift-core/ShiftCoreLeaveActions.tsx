import { Button } from "@/components/ui/button";
import { Palmtree, Calendar, Moon, Trash2, Clock, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShiftCoreLeaveActionsProps {
  selectedLeaveType: "cp" | "absence" | "rest" | "am" | null;
  existingLeaveType?: "cp" | "absence" | "rest" | "am" | null;
  onSelectLeaveType: (type: "cp" | "absence" | "rest" | "am" | null) => void;
  onCancelLeave?: () => void;
  isCancelingLeave?: boolean;
  isLoading: boolean;
  // R-Extra integration
  rextraBalanceMinutes?: number;
  onRextraClick?: () => void;
  existingRextraMinutes?: number;
  onClearRextra?: () => void;
  isClearingRextra?: boolean;
}

function formatMinutesToShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/**
 * CP / Absence / Repos / AM toggle buttons for leave selection
 * With delete button when an existing leave is present
 * Includes R.Extra option when balance > 0
 */
export function ShiftCoreLeaveActions({
  selectedLeaveType,
  existingLeaveType,
  onSelectLeaveType,
  onCancelLeave,
  isCancelingLeave = false,
  isLoading,
  rextraBalanceMinutes = 0,
  onRextraClick,
  existingRextraMinutes = 0,
  onClearRextra,
  isClearingRextra = false,
}: ShiftCoreLeaveActionsProps) {
  const hasExistingLeave = existingLeaveType !== null && existingLeaveType !== undefined;
  const hasExistingRextra = existingRextraMinutes > 0;
  const showRextraOption = rextraBalanceMinutes > 0 || hasExistingRextra;

  return (
    <div className="space-y-3">
      {/* Leave type grid — 2×2 for better readability */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={selectedLeaveType === "cp" ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-10 justify-start gap-2",
            selectedLeaveType === "cp" &&
              "bg-emerald-600 dark:bg-emerald-700 hover:bg-emerald-700 dark:hover:bg-emerald-600"
          )}
          onClick={() => onSelectLeaveType(selectedLeaveType === "cp" ? null : "cp")}
          disabled={isLoading || hasExistingRextra}
        >
          <Palmtree className="h-4 w-4 shrink-0" />
          CP
        </Button>
        <Button
          variant={selectedLeaveType === "absence" ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-10 justify-start gap-2",
            selectedLeaveType === "absence" &&
              "bg-amber-600 dark:bg-amber-700 hover:bg-amber-700 dark:hover:bg-amber-600"
          )}
          onClick={() => onSelectLeaveType(selectedLeaveType === "absence" ? null : "absence")}
          disabled={isLoading || hasExistingRextra}
        >
          <Calendar className="h-4 w-4 shrink-0" />
          Absent
        </Button>
        <Button
          variant={selectedLeaveType === "rest" ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-10 justify-start gap-2",
            selectedLeaveType === "rest" && "bg-slate-600 hover:bg-slate-700"
          )}
          onClick={() => onSelectLeaveType(selectedLeaveType === "rest" ? null : "rest")}
          disabled={isLoading || hasExistingRextra}
        >
          <Moon className="h-4 w-4 shrink-0" />
          Repos
        </Button>
        <Button
          variant={selectedLeaveType === "am" ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-10 justify-start gap-2",
            selectedLeaveType === "am" &&
              "bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-600"
          )}
          onClick={() => onSelectLeaveType(selectedLeaveType === "am" ? null : "am")}
          disabled={isLoading || hasExistingRextra}
        >
          <Stethoscope className="h-4 w-4 shrink-0" />
          Arrêt maladie
        </Button>
      </div>

      {/* R.Extra option - only visible if balance > 0 or existing R.Extra */}
      {showRextraOption && onRextraClick && (
        <div>
          {hasExistingRextra ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-10 border-violet-400 dark:border-violet-600 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-900/30 gap-2"
              disabled={true}
            >
              <Clock className="h-4 w-4 shrink-0" />
              R.extra {formatMinutesToShort(existingRextraMinutes)}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-10 border-violet-400 dark:border-violet-600 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 hover:text-violet-800 dark:hover:text-violet-200 gap-2"
              onClick={onRextraClick}
              disabled={isLoading || hasExistingLeave}
            >
              <Clock className="h-4 w-4 shrink-0" />
              R.extra ({formatMinutesToShort(rextraBalanceMinutes)} dispo)
            </Button>
          )}
        </div>
      )}

      {/* Delete existing R.Extra */}
      {hasExistingRextra && onClearRextra && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-10 text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
          onClick={onClearRextra}
          disabled={isLoading || isClearingRextra}
        >
          <Trash2 className="h-4 w-4 shrink-0" />
          {isClearingRextra ? "Suppression..." : "Supprimer R.extra"}
        </Button>
      )}

      {hasExistingLeave && onCancelLeave && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-10 text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
          onClick={onCancelLeave}
          disabled={isLoading || isCancelingLeave}
        >
          <Trash2 className="h-4 w-4 shrink-0" />
          {isCancelingLeave ? "Suppression..." : "Supprimer le congé"}
        </Button>
      )}
    </div>
  );
}
