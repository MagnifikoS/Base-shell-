/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Month Selector (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, parse, addMonths, subMonths } from "date-fns";
import { fr } from "date-fns/locale";

interface MonthSelectorProps {
  yearMonth: string; // "YYYY-MM"
  onChange: (yearMonth: string) => void;
}

export function MonthSelector({ yearMonth, onChange }: MonthSelectorProps) {
  const currentDate = parse(yearMonth, "yyyy-MM", new Date());

  const handlePrevious = () => {
    const newDate = subMonths(currentDate, 1);
    onChange(format(newDate, "yyyy-MM"));
  };

  const handleNext = () => {
    const newDate = addMonths(currentDate, 1);
    onChange(format(newDate, "yyyy-MM"));
  };

  const displayLabel = format(currentDate, "MMMM yyyy", { locale: fr });
  const capitalizedLabel = displayLabel.charAt(0).toUpperCase() + displayLabel.slice(1);

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={handlePrevious} aria-label="Mois précédent">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[140px] text-center font-medium">{capitalizedLabel}</span>
      <Button variant="outline" size="icon" onClick={handleNext} aria-label="Mois suivant">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
