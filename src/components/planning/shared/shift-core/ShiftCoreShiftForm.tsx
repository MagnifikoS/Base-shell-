/**
 * Reusable shift time selection form
 * V2: Uses unified TimeSelect component
 */

import { TimeSelect, type TimeOption } from "@/components/ui/time-select";
import { cn } from "@/lib/utils";

interface ShiftCoreShiftFormProps {
  shiftNumber: 1 | 2;
  startTime: string;
  endTime: string;
  startOptions: TimeOption[];
  endOptions: TimeOption[];
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  errorMessage?: string | null;
  isLeaveMode?: boolean;
  isDashed?: boolean;
}

/**
 * Convert raw minutes value to HH:mm label for display
 */
function minutesToLabel(rawMin: number): string {
  const displayMin = rawMin % 1440;
  const h = Math.floor(displayMin / 60);
  const m = displayMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function ShiftCoreShiftForm({
  shiftNumber,
  startTime,
  endTime,
  startOptions,
  endOptions,
  onStartChange,
  onEndChange,
  errorMessage,
  isLeaveMode = false,
  isDashed = true,
}: ShiftCoreShiftFormProps) {
  // Get display label for a value (raw minutes → HH:mm)
  const _getDisplayValue = (value: string): string => {
    if (!value) return "";
    const min = parseInt(value, 10);
    if (isNaN(min)) return value;
    return minutesToLabel(min);
  };

  return (
    <div
      className={cn(
        "border rounded-md p-3 space-y-3",
        isDashed && "border-dashed",
        isLeaveMode && "opacity-40 pointer-events-none bg-muted/30"
      )}
    >
      <span className="text-sm font-medium">Shift #{shiftNumber}</span>

      <div className="grid grid-cols-2 gap-3">
        <TimeSelect
          label="Début"
          value={startTime}
          onChange={onStartChange}
          options={startOptions}
          mode="minutes"
          disabled={isLeaveMode}
        />
        <TimeSelect
          label="Fin"
          value={endTime}
          onChange={onEndChange}
          options={endOptions}
          mode="minutes"
          disabled={isLeaveMode}
        />
      </div>

      {errorMessage && !isLeaveMode && (
        <div className="text-sm px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
