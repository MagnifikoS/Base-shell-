import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/planning-engine/format";
import type { PlanningShift } from "@/components/planning/types/planning.types";
import type { LeaveType } from "@/hooks/personnel/usePersonnelLeaves";

interface MobileDayCardProps {
  date: string;
  dayLabel: string;
  shifts: PlanningShift[];
  isClosed?: boolean;
  isToday?: boolean;
  onTap?: () => void;
  canEdit?: boolean;
  /** Whether this day is validated (admin validated or week_validated) */
  isValidated?: boolean;
  /** Leave for this day if exists (already filtered by caller) */
  leave?: { leave_type: LeaveType } | null;
}

/** Map leave_type to display label */
function getLeaveLabel(leaveType: LeaveType): string {
  switch (leaveType) {
    case "cp":
      return "CP";
    case "absence":
      return "Absence";
    case "rest":
      return "Repos";
    default:
      return "Congé";
  }
}

/** Get styling classes for leave badge */
function getLeaveClasses(leaveType: LeaveType): string {
  switch (leaveType) {
    case "cp":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "absence":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
    case "rest":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function MobileDayCard({
  date,
  dayLabel,
  shifts,
  isClosed = false,
  isToday = false,
  onTap,
  canEdit = false,
  isValidated = true, // default true for backwards compat (admin view)
  leave = null,
}: MobileDayCardProps) {
  // Compute total worked minutes
  const totalMinutes = shifts.reduce((sum, s) => sum + s.net_minutes, 0);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const totalDisplay = totalMinutes > 0 ? `${hours}h${mins.toString().padStart(2, "0")}` : null;

  // Determine what to display based on validation, leave, shifts
  const displayContent = useMemo(() => {
    // Rule 1: Day not validated => "Planning en cours"
    if (!isValidated) {
      return {
        type: "in_progress" as const,
        label: "Planning en cours",
      };
    }

    // Rule 2: Day is closed
    if (isClosed) {
      return {
        type: "closed" as const,
        label: "Fermé",
      };
    }

    // Rule 3: Has approved leave => show leave
    if (leave) {
      return {
        type: "leave" as const,
        label: getLeaveLabel(leave.leave_type),
        leaveType: leave.leave_type,
      };
    }

    // Rule 4: Has shifts => show shifts
    if (shifts.length > 0) {
      return {
        type: "shifts" as const,
        shifts,
      };
    }

    // Rule 5: Validated day, no shifts, no leave => "Repos"
    return {
      type: "rest" as const,
      label: "Repos",
    };
  }, [isValidated, isClosed, leave, shifts]);

  return (
    <button
      onClick={onTap}
      disabled={!canEdit && !onTap}
      className={cn(
        "flex items-center justify-between w-full p-4 rounded-xl transition-all",
        "bg-card border border-border",
        isToday && "border-primary/50 bg-primary/5",
        (canEdit || onTap) && "active:scale-[0.98] touch-manipulation cursor-pointer",
        (displayContent.type === "closed" || displayContent.type === "in_progress") && "opacity-60"
      )}
    >
      {/* Left: Day info */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex flex-col items-center justify-center w-12 h-12 rounded-lg",
          isToday ? "bg-primary text-primary-foreground" : "bg-muted"
        )}>
          <span className="text-xs font-medium uppercase">
            {dayLabel.slice(0, 3)}
          </span>
          <span className="text-lg font-bold">
            {new Date(date + "T00:00:00").getDate()}
          </span>
        </div>

        <div className="flex flex-col items-start gap-0.5">
          {displayContent.type === "in_progress" && (
            <span className="text-sm text-muted-foreground italic">
              {displayContent.label}
            </span>
          )}

          {displayContent.type === "closed" && (
            <span className="text-sm text-muted-foreground">
              {displayContent.label}
            </span>
          )}

          {displayContent.type === "leave" && (
            <span className={cn(
              "text-sm font-medium px-2 py-0.5 rounded",
              getLeaveClasses(displayContent.leaveType!)
            )}>
              {displayContent.label}
            </span>
          )}

          {displayContent.type === "rest" && (
            <span className="text-sm text-muted-foreground">
              {displayContent.label}
            </span>
          )}

          {displayContent.type === "shifts" && (
            <div className="flex flex-col gap-0.5">
              {displayContent.shifts.map((shift) => (
                <span key={shift.id} className="text-sm font-medium">
                  {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Total hours (only for validated shifts) */}
      {displayContent.type === "shifts" && totalDisplay && (
        <div className="flex items-center">
          <span className="text-sm font-semibold text-primary">
            {totalDisplay}
          </span>
        </div>
      )}
    </button>
  );
}
