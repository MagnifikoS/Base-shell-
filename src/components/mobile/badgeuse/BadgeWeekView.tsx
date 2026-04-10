import { useMemo } from "react";
import { BadgeDayRow } from "./BadgeDayRow";
import type { BadgeEvent } from "./types/badgeuse.types";

interface BadgeWeekViewProps {
  weekStart: string;
  events: BadgeEvent[];
  /** ✅ GOLD RULE: Service day from RPC - SINGLE SOURCE OF TRUTH for "today" */
  serviceDay?: string;
}

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function BadgeWeekView({ weekStart, events, serviceDay }: BadgeWeekViewProps) {
  const weekDays = useMemo(() => {
    const days: Array<{
      date: string;
      label: string;
      events: BadgeEvent[];
      isToday: boolean;
      isFuture: boolean;
    }> = [];

    // ✅ Use RPC service day (Europe/Paris, cutoff-aware) instead of browser local time
    // If serviceDay not yet loaded, don't mark any day as today/future
    const today = serviceDay || "";
    const startDate = new Date(weekStart + "T12:00:00Z"); // Noon UTC to avoid TZ issues

    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
      // Format as YYYY-MM-DD from UTC date
      const dateStr = date.toISOString().slice(0, 10);

      days.push({
        date: dateStr,
        label: DAY_LABELS[i],
        events: events.filter((e) => e.day_date === dateStr),
        // Only mark isToday/isFuture when serviceDay is available
        isToday: today ? dateStr === today : false,
        isFuture: today ? dateStr > today : false,
      });
    }

    return days;
  }, [weekStart, events, serviceDay]);

  return (
    <div className="space-y-2">
      {weekDays.map((day) => (
        <BadgeDayRow
          key={day.date}
          date={day.date}
          dayLabel={day.label}
          events={day.events}
          isToday={day.isToday}
          isFuture={day.isFuture}
        />
      ))}
    </div>
  );
}
