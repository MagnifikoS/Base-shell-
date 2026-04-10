/**
 * Compact row for a single day in the month list.
 * Shows date, amount (or masked), and delta vs average.
 */

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { toSafeMiddayUTC } from "../utils/businessDay";
import { AmountCell } from "./AmountCell";
import type { CashDayReport } from "../utils/types";

interface CashDayRowProps {
  dateStr: string; // YYYY-MM-DD
  report: CashDayReport | null;
  averagePerDay: number;
  visible: boolean;
  isToday: boolean;
  canWriteDay: boolean;
  onClick: () => void;
  onWizardOpen: () => void;
}

export function CashDayRow({
  dateStr,
  report,
  averagePerDay,
  visible,
  isToday,
  canWriteDay,
  onClick,
  onWizardOpen,
}: CashDayRowProps) {
  const safeDate = useMemo(() => toSafeMiddayUTC(dateStr), [dateStr]);

  const dayOfWeek = safeDate.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
  });

  const dayNum = safeDate.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
  });

  const totalEur = report?.total_eur ?? 0;
  const hasData = report !== null;

  const deltaPct = useMemo(() => {
    if (!hasData || averagePerDay === 0) return null;
    return ((totalEur - averagePerDay) / averagePerDay) * 100;
  }, [hasData, totalEur, averagePerDay]);

  const deltaColor = useMemo(() => {
    if (deltaPct === null) return "";
    if (Math.abs(deltaPct) < 2) return "text-muted-foreground";
    return deltaPct > 0 ? "text-emerald-600" : "text-destructive";
  }, [deltaPct]);

  // Determine click behavior
  const handleClick = () => {
    if (hasData) {
      onClick();
    } else if (canWriteDay) {
      onWizardOpen();
    }
    // No action if no data and no write permission
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!hasData && !canWriteDay}
      className={`w-full flex items-center justify-between min-h-[56px] px-4 py-3 rounded-xl transition-colors
        ${isToday ? "bg-accent/50 ring-1 ring-primary/30" : "bg-card hover:bg-accent/30"}
        ${!hasData && !canWriteDay ? "opacity-40 cursor-default" : ""}
        ${!hasData && canWriteDay ? "opacity-60" : ""}
      `}
    >
      {/* Left: date */}
      <div className="flex flex-col items-start">
        <span className="text-xs text-muted-foreground capitalize">{dayOfWeek}</span>
        <span className="text-sm font-medium text-foreground capitalize">{dayNum}</span>
      </div>

      {/* Right: amount + delta OR + button */}
      <div className="flex items-center gap-2">
        {hasData ? (
          <>
            <AmountCell
              value={totalEur}
              visible={visible}
              className="text-sm font-semibold tabular-nums"
            />
            {visible && deltaPct !== null && (
              <span className={`text-xs font-medium tabular-nums ${deltaColor}`}>
                {deltaPct > 0 ? "+" : ""}
                {deltaPct.toFixed(0)}%
              </span>
            )}
          </>
        ) : canWriteDay ? (
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary">
            <Plus className="h-4 w-4" />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </button>
  );
}
