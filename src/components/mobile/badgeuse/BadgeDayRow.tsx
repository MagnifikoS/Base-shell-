/**
 * V3.2: Uses Paris timezone for display
 */
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BadgeEvent } from "./types/badgeuse.types";
import { formatParisHHMM } from "@/lib/time/paris";

interface BadgeDayRowProps {
  date: string;
  dayLabel: string;
  events: BadgeEvent[];
  isToday?: boolean;
  isFuture?: boolean;
}

interface ShiftDisplay {
  sequence: number;
  clockIn?: string;
  clockOut?: string;
}

export function BadgeDayRow({
  date,
  dayLabel,
  events,
  isToday = false,
  isFuture = false,
}: BadgeDayRowProps) {
  // Group events by sequence (shift)
  const shifts = useMemo((): ShiftDisplay[] => {
    const shiftMap = new Map<number, ShiftDisplay>();

    events.forEach((event) => {
      const existing = shiftMap.get(event.sequence_index) || {
        sequence: event.sequence_index,
      };

      if (event.event_type === "clock_in") {
        existing.clockIn = event.effective_at;
      } else {
        existing.clockOut = event.effective_at;
      }

      shiftMap.set(event.sequence_index, existing);
    });

    return Array.from(shiftMap.values()).sort((a, b) => a.sequence - b.sequence);
  }, [events]);

  // Safe date parsing - handle invalid/missing date
  const dayNumber = useMemo(() => {
    try {
      if (!date) return "--";
      const d = new Date(date + "T12:00:00Z"); // Use noon UTC to avoid timezone issues
      if (isNaN(d.getTime())) return "--";
      return d.getUTCDate();
    } catch {
      return "--";
    }
  }, [date]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl",
        "bg-card border border-border",
        isToday && "border-primary/50 bg-primary/5",
        isFuture && "opacity-50"
      )}
    >
      {/* Day badge */}
      <div
        className={cn(
          "flex flex-col items-center justify-center w-12 h-12 rounded-lg flex-shrink-0",
          isToday ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        <span className="text-xs font-medium uppercase">
          {dayLabel.slice(0, 3)}
        </span>
        <span className="text-lg font-bold">{dayNumber}</span>
      </div>

      {/* Shifts display */}
      <div className="flex-1 min-w-0">
        {shifts.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            {isFuture ? "—" : "Pas de pointage"}
          </span>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {shifts.map((shift) => (
              <div key={shift.sequence} className="text-sm">
                <span className="font-medium text-green-600 dark:text-green-400">
                  A: {shift.clockIn ? formatParisHHMM(shift.clockIn) : "--:--"}
                </span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="font-medium text-orange-600 dark:text-orange-400">
                  D: {shift.clockOut ? formatParisHHMM(shift.clockOut) : "--:--"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
