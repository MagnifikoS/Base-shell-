/**
 * Day Part Filter Bar
 * Allows filtering employees by morning/midday/evening
 * Uses establishment day_parts configuration
 */

import { cn } from "@/lib/utils";
import type { DayPartOption, DayPartKey } from "@/hooks/presence/useDayPartFilter";

interface DayPartFilterBarProps {
  options: DayPartOption[];
  selected: DayPartKey;
  onSelect: (key: DayPartKey) => void;
  isLoading?: boolean;
}

export function DayPartFilterBar({
  options,
  selected,
  onSelect,
  isLoading,
}: DayPartFilterBarProps) {
  if (isLoading || options.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {options.map((option) => {
        const isActive = selected === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelect(option.key)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
              "border",
              isActive
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: option.color }}
            />
            <span>{option.label}</span>
            <span className="text-xs opacity-70">
              {option.startTime}–{option.endTime}
            </span>
          </button>
        );
      })}
    </div>
  );
}
