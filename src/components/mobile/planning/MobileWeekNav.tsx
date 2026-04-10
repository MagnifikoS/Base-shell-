import { useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateLocal } from "@/lib/planning-engine/format";
import { Button } from "@/components/ui/button";

interface MobileWeekNavProps {
  weekStart: string;
  onWeekChange: (newWeek: string) => void;
  /** If true, navigation is disabled (read-only mode) */
  disabled?: boolean;
  /** Current week monday from serviceDay (Paris timezone) - used for "go to current" */
  currentWeekMonday: string;
}

export function MobileWeekNav({
  weekStart,
  onWeekChange,
  disabled = false,
  currentWeekMonday,
}: MobileWeekNavProps) {
  const weekLabel = useMemo(() => {
    const start = new Date(weekStart + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const startStr = start.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    });
    const endStr = end.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
    });

    return `${startStr} - ${endStr}`;
  }, [weekStart]);

  const goToPrevWeek = useCallback(() => {
    if (disabled) return;
    const current = new Date(weekStart + "T00:00:00");
    current.setDate(current.getDate() - 7);
    onWeekChange(formatDateLocal(current));
  }, [weekStart, onWeekChange, disabled]);

  const goToNextWeek = useCallback(() => {
    if (disabled) return;
    const current = new Date(weekStart + "T00:00:00");
    current.setDate(current.getDate() + 7);
    onWeekChange(formatDateLocal(current));
  }, [weekStart, onWeekChange, disabled]);

  const goToCurrentWeek = useCallback(() => {
    if (disabled) return;
    onWeekChange(currentWeekMonday);
  }, [onWeekChange, disabled, currentWeekMonday]);

  const isCurrentWeek = weekStart === currentWeekMonday;

  // Read-only mode: show only the week label, no navigation controls
  if (disabled) {
    return (
      <div className="flex items-center justify-center">
        <div className="text-center py-2 px-4 rounded-lg bg-muted">
          <span className="text-sm font-medium">{weekLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={goToPrevWeek}
        className="h-10 w-10"
        aria-label="Semaine précédente"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      <button
        onClick={goToCurrentWeek}
        disabled={isCurrentWeek}
        className="flex-1 text-center py-2 px-4 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
        aria-label="Revenir à la semaine en cours"
      >
        <span className="text-sm font-medium">{weekLabel}</span>
      </button>

      <Button
        variant="outline"
        size="icon"
        onClick={goToNextWeek}
        className="h-10 w-10"
        aria-label="Semaine suivante"
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
