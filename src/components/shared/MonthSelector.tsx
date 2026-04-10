/**
 * Month Selector Component -- reusable month navigation.
 *
 * Originally in factures module, extracted to shared to break the
 * blApp <-> factures circular dependency.
 *
 * Used by: factures (FacturesPage), blApp (BlAppTab).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatYearMonth, type MonthNavigation } from "@/modules/shared";

interface MonthSelectorProps {
  value: MonthNavigation;
  onChange: (nav: MonthNavigation) => void;
}

export function MonthSelector({ value, onChange }: MonthSelectorProps) {
  const goToPreviousMonth = () => {
    let newMonth = value.month - 1;
    let newYear = value.year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    onChange({ year: newYear, month: newMonth });
  };

  const goToNextMonth = () => {
    let newMonth = value.month + 1;
    let newYear = value.year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    onChange({ year: newYear, month: newMonth });
  };

  const displayLabel = formatYearMonth(value.year, value.month);

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={goToPreviousMonth} aria-label="Mois precedent">
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <span className="min-w-[160px] text-center font-medium capitalize">{displayLabel}</span>

      <Button variant="outline" size="icon" onClick={goToNextMonth} aria-label="Mois suivant">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
