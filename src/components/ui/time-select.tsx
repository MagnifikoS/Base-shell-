/**
 * TimeSelect - Unified time selection component
 *
 * Used across the entire app for consistent time input UX:
 * - Planning shifts
 * - Badge editing (presence)
 * - Any future time selection needs
 *
 * SUPPORTS TWO MODES:
 * - "hhmm": value is "HH:mm" string (e.g., "09:00") - used by badges
 * - "minutes": value is raw minutes string (e.g., "540") - used by planning
 *
 * By default generates options 00:00-23:45 in 15-min steps.
 * Can accept custom options for constrained ranges.
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface TimeOption {
  value: string;
  label: string;
}

interface TimeSelectProps {
  /** Current value (HH:mm or raw minutes depending on mode) */
  value: string;
  /** Called when selection changes */
  onChange: (value: string) => void;
  /** Optional label above the select */
  label?: string;
  /** Disable the select */
  disabled?: boolean;
  /** Custom options (if not provided, generates 00:00-23:45) */
  options?: TimeOption[];
  /** Value mode: "hhmm" for HH:mm strings, "minutes" for raw minute values */
  mode?: "hhmm" | "minutes";
  /** Placeholder text */
  placeholder?: string;
  /** Additional className for the container */
  className?: string;
}

/**
 * Generate default time options (00:00 to 23:45, 15-min intervals)
 * Returns options in HH:mm format
 */
function generateDefaultTimeOptions(): TimeOption[] {
  const options: TimeOption[] = [];
  for (let min = 0; min < 1440; min += 15) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    options.push({ value: label, label });
  }
  return options;
}

// Cache default options
const DEFAULT_OPTIONS = generateDefaultTimeOptions();

/**
 * Convert raw minutes to HH:mm label
 */
function minutesToLabel(rawMin: number): string {
  const displayMin = rawMin % 1440;
  const h = Math.floor(displayMin / 60);
  const m = displayMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TimeSelect({
  value,
  onChange,
  label,
  disabled = false,
  options,
  mode = "hhmm",
  placeholder = "--:--",
  className,
}: TimeSelectProps) {
  // Use provided options or generate defaults
  const timeOptions = options || DEFAULT_OPTIONS;

  // Get display label for current value
  const getDisplayLabel = (): string => {
    if (!value) return placeholder;

    if (mode === "minutes") {
      // Value is raw minutes - convert to HH:mm for display
      const min = parseInt(value, 10);
      if (isNaN(min)) return placeholder;
      return minutesToLabel(min);
    }

    // Value is already HH:mm
    return value;
  };

  return (
    <div className={cn("space-y-1", className)}>
      {label && <Label className="text-xs">{label}</Label>}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder}>{getDisplayLabel()}</SelectValue>
        </SelectTrigger>
        <SelectContent className="w-[100px] min-w-[100px]">
          {timeOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Export default options generator for external use
 */
// eslint-disable-next-line react-refresh/only-export-components
export { generateDefaultTimeOptions, minutesToLabel };
