import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatMinutesToHours } from "@/lib/planning-engine/format";
import { Badge } from "@/components/ui/badge";
import { Calendar, Palmtree, Moon, Stethoscope } from "lucide-react";
import type { PlanningShift } from "../types/planning.types";
import type { PersonnelLeave } from "@/hooks/personnel/usePersonnelLeaves";

interface PlanningWeekCellProps {
  shifts: PlanningShift[];
  isWeekend: boolean;
  isToday?: boolean;
  onClick?: () => void;
  onShiftDragStart?: (shift: PlanningShift) => void;
  canManagePlanning: boolean;
  isDragOver?: boolean;
  leave?: PersonnelLeave;
  hasConflict?: boolean; // Kept for interface compat but unused in Option A
  onMarkLeave?: () => void;
  onCancelLeave?: () => void;
  /** PHASE 1 R-EXTRA: Minutes posed as R.Extra for this day */
  rextraMinutes?: number;
  /** Employee ID — needed for leave drag payload */
  employeeId?: string;
  /** Cell date — needed for leave drag payload */
  cellDate?: string;
}

export const PlanningWeekCell = memo(function PlanningWeekCell({
  shifts,
  isWeekend,
  isToday = false,
  onClick,
  onShiftDragStart,
  canManagePlanning,
  isDragOver = false,
  leave,
  rextraMinutes = 0,
  employeeId,
  cellDate,
}: PlanningWeekCellProps) {
  const displayShifts = [...shifts].sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, 2);
  const isEmpty = displayShifts.length === 0 && !leave && rextraMinutes === 0;

  // Format R-Extra minutes for display
  const rextraDisplay =
    rextraMinutes > 0
      ? (() => {
          const h = Math.floor(rextraMinutes / 60);
          const m = rextraMinutes % 60;
          return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
        })()
      : null;

  const handleCellClick = () => {
    if (!onClick) return;
    onClick();
  };

  const handleDragStart = (e: React.DragEvent, shift: PlanningShift) => {
    if (!canManagePlanning || shift.id.startsWith("temp-")) return;

    // Payload for DnD: supports both MOVE (same employee) and COPY (cross-employee)
    const payload = {
      start_time: shift.start_time,
      end_time: shift.end_time,
      fromShiftId: shift.id,
      fromEmployeeId: shift.user_id,
    };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";

    if (onShiftDragStart) {
      onShiftDragStart(shift);
    }
  };

  const handleLeaveDragStart = (e: React.DragEvent) => {
    if (!canManagePlanning || !leave || !employeeId || !cellDate) return;

    const payload = {
      start_time: "",
      end_time: "",
      fromShiftId: "",
      fromEmployeeId: employeeId,
      isLeave: true,
      leaveType: leave.leave_type === "rest" ? ("repos" as const) : leave.leave_type,
      sourceDate: cellDate,
    };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      onClick={handleCellClick}
      role="gridcell"
      className={cn(
        "w-[160px] flex-shrink-0 min-h-[52px] px-1 py-1 border-r flex flex-col justify-center gap-0.5 relative group",
        isWeekend && !isToday && "bg-muted/20",
        isToday && "bg-accent/70",
        !isToday && leave && leave.leave_type === "cp" && "bg-emerald-50 dark:bg-emerald-950/30",
        !isToday && leave && leave.leave_type === "absence" && "bg-amber-50 dark:bg-amber-950/30",
        !isToday && leave && leave.leave_type === "rest" && "bg-slate-50 dark:bg-slate-950/30",
        !isToday && leave && leave.leave_type === "am" && "bg-red-50 dark:bg-red-950/30",
        onClick && "cursor-pointer hover:bg-accent transition-colors",
        isDragOver && "bg-primary/10 ring-2 ring-primary/50 ring-inset"
      )}
    >
      {/* Drop zone indicator */}
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-[10px] font-medium text-primary/70 bg-primary/5 rounded px-1.5 py-0.5">
            Poser ici
          </div>
        </div>
      )}

      {/* Leave badge (CP or Absence) - centered, clickable and draggable like shifts */}
      {leave && (
        <div
          className={cn(
            "flex items-center justify-center",
            canManagePlanning && "cursor-grab active:cursor-grabbing"
          )}
          draggable={canManagePlanning}
          onDragStart={handleLeaveDragStart}
        >
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-medium px-2 py-0.5",
              leave.leave_type === "cp" &&
                "border-emerald-500 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
              leave.leave_type === "absence" &&
                "border-amber-500 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
              leave.leave_type === "rest" &&
                "border-slate-500 bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300",
              leave.leave_type === "am" &&
                "border-red-500 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
            )}
          >
            {leave.leave_type === "cp" ? (
              <>
                <Palmtree className="h-3 w-3 mr-1" />
                CP
              </>
            ) : leave.leave_type === "rest" ? (
              <>
                <Moon className="h-3 w-3 mr-1" />
                Repos
              </>
            ) : leave.leave_type === "am" ? (
              <>
                <Stethoscope className="h-3 w-3 mr-1" />
                AM
              </>
            ) : (
              <>
                <Calendar className="h-3 w-3 mr-1" />
                Absent
              </>
            )}
          </Badge>
        </div>
      )}

      {/* PHASE 1 R-EXTRA: Badge for R.Extra days */}
      {!leave && rextraDisplay && (
        <div className="flex items-center justify-center">
          <Badge
            variant="outline"
            className="text-xs font-medium px-2 py-0.5 border-primary bg-primary/10 text-primary"
          >
            R.Extra {rextraDisplay}
          </Badge>
        </div>
      )}

      {/* Option A: No conflict possible - shifts are deleted when leave is marked */}

      {/* Shifts (shown even if there's a conflict) */}
      {!leave && isEmpty ? (
        <div className="flex items-center justify-center">
          <span className="text-xs text-muted-foreground/40 text-center">—</span>
        </div>
      ) : (
        !leave &&
        displayShifts.map((shift) => (
          <div
            key={shift.id}
            draggable={canManagePlanning && !shift.id.startsWith("temp-")}
            onDragStart={(e) => handleDragStart(e, shift)}
            className={cn(
              "text-xs bg-accent/50 rounded px-1.5 py-0.5 text-center truncate",
              shift.id.startsWith("temp-") && "opacity-60 animate-pulse",
              canManagePlanning &&
                !shift.id.startsWith("temp-") &&
                "cursor-grab active:cursor-grabbing hover:bg-accent/70 transition-colors"
            )}
          >
            <span className="font-medium">
              {shift.start_time}–{shift.end_time}
            </span>
            <span className="text-muted-foreground ml-1">
              ({formatMinutesToHours(shift.net_minutes)})
            </span>
          </div>
        ))
      )}
      {!leave && shifts.length > 2 && (
        <span className="text-[10px] text-muted-foreground text-center">+{shifts.length - 2}</span>
      )}
    </div>
  );
});
