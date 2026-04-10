/**
 * Mobile-optimized date range picker
 * Single calendar view where user taps start then end date
 * Supports both single day and date range selection
 */

import { useState } from "react";
import { format, parseISO, isSameDay } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { DateRange, DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerFooter } from "@/components/ui/drawer";

interface MobileDateRangePickerProps {
  dateStart: string; // YYYY-MM-DD
  dateEnd: string;   // YYYY-MM-DD
  onRangeChange: (start: string, end: string) => void;
  disabled?: boolean;
}

export function MobileDateRangePicker({
  dateStart,
  dateEnd,
  onRangeChange,
  disabled = false,
}: MobileDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange | undefined>(undefined);
  // Track if range is complete (both from and to selected)
  const [rangeComplete, setRangeComplete] = useState(false);

  // Always start fresh when drawer opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setTempRange(undefined);
      setRangeComplete(false);
    }
    setOpen(isOpen);
  };

  const handleSelect = (newRange: DateRange | undefined) => {
    if (!newRange?.from) {
      setTempRange(undefined);
      setRangeComplete(false);
      return;
    }

    // If previous selection was complete, clicking any date starts fresh
    if (rangeComplete) {
      // Extract the actual clicked date - it's either the new "from" or "to" 
      // that differs from our previous range
      const clickedDate = newRange.to && (!tempRange?.to || !isSameDay(newRange.to, tempRange.to)) 
        ? newRange.to 
        : newRange.from;
      setTempRange({ from: clickedDate, to: undefined });
      setRangeComplete(false);
      return;
    }

    // Normal flow: first click sets from, second sets to
    setTempRange(newRange);
    
    // Mark complete when we have both dates
    if (newRange.from && newRange.to) {
      setRangeComplete(true);
    }
  };

  const handleConfirm = () => {
    if (!tempRange?.from) return;
    
    const start = format(tempRange.from, "yyyy-MM-dd");
    const end = tempRange.to ? format(tempRange.to, "yyyy-MM-dd") : start;
    onRangeChange(start, end);
    setOpen(false);
  };

  const handleSingleDay = () => {
    if (!tempRange?.from) return;
    const singleDate = format(tempRange.from, "yyyy-MM-dd");
    onRangeChange(singleDate, singleDate);
    setOpen(false);
  };

  const formatDisplayDate = () => {
    if (!dateStart) return "Sélectionner les dates";

    const startDate = parseISO(dateStart);
    const endDate = parseISO(dateEnd);
    
    if (dateStart === dateEnd || !dateEnd) {
      return format(startDate, "EEEE d MMMM yyyy", { locale: fr });
    }

    // Same month
    if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
      return `${format(startDate, "d", { locale: fr })} → ${format(endDate, "d MMMM yyyy", { locale: fr })}`;
    }

    return `${format(startDate, "d MMM", { locale: fr })} → ${format(endDate, "d MMM yyyy", { locale: fr })}`;
  };

  const isSingleDaySelected = tempRange?.from && (!tempRange.to || isSameDay(tempRange.from, tempRange.to));
  const isRangeSelected = tempRange?.from && tempRange?.to && !isSameDay(tempRange.from, tempRange.to);

  const getSelectionHint = () => {
    if (!tempRange?.from) return "Touchez une date pour commencer";
    if (isSingleDaySelected) return "Touchez une autre date pour une plage, ou confirmez";
    return `${format(tempRange.from, "d MMM", { locale: fr })} → ${format(tempRange.to!, "d MMM", { locale: fr })}`;
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-14 px-4",
            !dateStart && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-3 h-5 w-5 text-primary shrink-0" />
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-xs text-muted-foreground">Période</span>
            <span className="text-base font-medium">{formatDisplayDate()}</span>
          </div>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="pb-0">
          <DrawerTitle className="text-center text-lg">
            Sélectionnez les dates
          </DrawerTitle>
          <p className="text-center text-sm text-muted-foreground mt-1">
            {getSelectionHint()}
          </p>
        </DrawerHeader>
        
        <div className="flex justify-center py-4 px-2 overflow-auto">
          <DayPicker
            mode="range"
            selected={tempRange}
            onSelect={handleSelect}
            locale={fr}
            numberOfMonths={1}
            defaultMonth={tempRange?.from || new Date()}
            showOutsideDays={false}
            className="pointer-events-auto"
            components={{
              IconLeft: () => <ChevronLeft className="h-5 w-5" />,
              IconRight: () => <ChevronRight className="h-5 w-5" />,
            }}
            classNames={{
              months: "flex flex-col",
              month: "space-y-4",
              caption: "flex justify-center pt-1 relative items-center h-10",
              caption_label: "text-base font-semibold",
              nav: "space-x-1 flex items-center",
              nav_button: "h-10 w-10 bg-transparent p-0 opacity-70 hover:opacity-100 inline-flex items-center justify-center rounded-full hover:bg-accent transition-colors",
              nav_button_previous: "absolute left-2",
              nav_button_next: "absolute right-2",
              table: "w-full border-collapse",
              head_row: "flex justify-around mb-1",
              head_cell: "text-muted-foreground rounded-md w-11 font-medium text-sm uppercase",
              row: "flex w-full mt-1 justify-around",
              cell: "h-11 w-11 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
              day: "h-11 w-11 p-0 font-normal rounded-full hover:bg-accent transition-colors text-base",
              day_range_start: "day-range-start bg-primary text-primary-foreground rounded-full hover:bg-primary",
              day_range_end: "day-range-end bg-primary text-primary-foreground rounded-full hover:bg-primary",
              day_selected: "bg-primary text-primary-foreground hover:bg-primary",
              day_today: "ring-2 ring-primary ring-offset-2",
              day_outside: "text-muted-foreground opacity-50",
              day_disabled: "text-muted-foreground opacity-50",
              day_range_middle: "bg-primary/15 text-foreground rounded-none",
              day_hidden: "invisible",
            }}
          />
        </div>

        <DrawerFooter className="pt-2 pb-6 gap-3">
          {isSingleDaySelected && (
            <Button 
              onClick={handleSingleDay} 
              className="w-full h-12 text-base"
            >
              Confirmer le {format(tempRange!.from!, "d MMMM", { locale: fr })}
            </Button>
          )}
          {isRangeSelected && (
            <Button 
              onClick={handleConfirm} 
              className="w-full h-12 text-base"
            >
              Confirmer la période
            </Button>
          )}
          <Button 
            variant="ghost" 
            onClick={() => setOpen(false)}
            className="w-full h-10"
          >
            Annuler
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
