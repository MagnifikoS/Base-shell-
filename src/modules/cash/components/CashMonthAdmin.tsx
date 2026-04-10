/**
 * Admin/Month view component for Cash Module
 * Clean layout: calendar in popover, day navigation, today's form by default
 *
 * SAFE DATE HANDLING:
 * - selectedDay is always a YYYY-MM-DD string (source of truth)
 * - All date manipulation uses UTC-safe helpers from businessDay.ts
 * - No local timezone parsing (parse/new Date with local midnight)
 */

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, ChevronRight, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCashMonth } from "../hooks/useCashMonth";
import { useCashDay } from "../hooks/useCashDay";
import { useServiceDayToday } from "../hooks/useBusinessDayToday";
import { useDailyPayrollCost } from "@/hooks/payroll/useDailyPayrollCost";
import { CashDayForm } from "./CashDayForm";
import { formatEur } from "../utils/money";
import { formatBusinessDay, toSafeMiddayUTC, addDaysSafe } from "../utils/businessDay";

interface CashMonthAdminProps {
  establishmentId: string | null;
  canWrite: boolean;
}

export function CashMonthAdmin({ establishmentId, canWrite }: CashMonthAdminProps) {
  // ✅ SINGLE SOURCE OF TRUTH: useServiceDayToday(establishmentId)
  const {
    data: businessDayToday,
    isLoading: isLoadingBusinessDay,
    error: serviceDayError,
  } = useServiceDayToday(establishmentId);

  // Source of truth: YYYY-MM-DD string from backend
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (!selectedDay && businessDayToday) setSelectedDay(businessDayToday);
  }, [businessDayToday, selectedDay]);

  // Safe Date for calendar UI only - uses UTC midday anchor
  const selectedDate = useMemo(() => {
    if (!selectedDay) return new Date();
    return toSafeMiddayUTC(selectedDay);
  }, [selectedDay]);

  // Extract year/month from selectedDay string directly (no Date parsing needed)
  const [selectedYear, selectedMonth] = useMemo(() => {
    if (!selectedDay) return [new Date().getFullYear(), new Date().getMonth() + 1];
    const [y, m] = selectedDay.split("-").map(Number);
    return [y, m];
  }, [selectedDay]);

  const {
    reportsByDate,
    monthTotal,
    error: cashMonthError,
  } = useCashMonth({
    establishmentId,
    year: selectedYear,
    month: selectedMonth,
  });

  const { report, save, isSaving } = useCashDay({
    establishmentId,
    dayDate: selectedDay,
  });

  // ✅ Payroll indicator for selected day (black box from Paie module)
  const {
    costDayEur,
    isLoading: isLoadingPayroll,
    isUnavailable: isPayrollUnavailable,
  } = useDailyPayrollCost(establishmentId, selectedDay || null);
  // Calculate average per day (only days with entries)
  const { daysWithData, averagePerDay } = useMemo(() => {
    const count = reportsByDate.size;
    const avg = count > 0 ? monthTotal / count : 0;
    return { daysWithData: count, averagePerDay: avg };
  }, [reportsByDate, monthTotal]);

  // Navigation handlers - use safe string-based operations
  const handlePrevDay = () => {
    setSelectedDay(addDaysSafe(selectedDay, -1));
  };

  const handleNextDay = () => {
    setSelectedDay(addDaysSafe(selectedDay, 1));
  };

  const _handleToday = () => {
    if (businessDayToday) setSelectedDay(businessDayToday);
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    if (date) {
      // Extract date parts in UTC to avoid timezone shift
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      setSelectedDay(`${y}-${m}-${d}`);
      setCalendarOpen(false);
    }
  };

  // Custom day render for calendar to show entries - use safe UTC dates
  const modifiers = useMemo(() => {
    const datesWithData: Date[] = [];
    reportsByDate.forEach((_, dateStr) => {
      datesWithData.push(toSafeMiddayUTC(dateStr));
    });

    const result: Record<string, Date | Date[]> = {
      hasData: datesWithData,
    };

    if (businessDayToday) {
      result.businessDay = toSafeMiddayUTC(businessDayToday);
    }

    return {
      ...result,
    };
  }, [reportsByDate, businessDayToday]);

  const modifiersStyles = {
    hasData: {
      backgroundColor: "hsl(var(--accent))",
      fontWeight: "600",
    },
    businessDay: {
      border: "2px solid hsl(var(--primary))",
    },
  };

  const isToday = !!businessDayToday && selectedDay === businessDayToday;

  const queryError = serviceDayError || cashMonthError;

  if (isLoadingBusinessDay || !selectedDay) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">Chargement…</div>
    );
  }

  // Calculate ratio for indicator (handle unavailable data)
  const totalCa = report?.total_eur ?? 0;
  const ratioPercent = !isPayrollUnavailable && totalCa > 0 ? (costDayEur / totalCa) * 100 : null;

  return (
    <div className="space-y-4">
      {/* Error state */}
      {queryError && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">
              Erreur lors du chargement de la caisse :{" "}
              {(queryError as Error).message || "Une erreur est survenue"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Réessayer
          </Button>
        </div>
      )}

      {/* Top bar: Navigation centered */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrevDay}
              aria-label="Jour précédent"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "min-w-[220px] justify-center font-medium",
                    isToday && "ring-2 ring-primary"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {formatBusinessDay(selectedDay)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <CalendarComponent
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleCalendarSelect}
                  locale={fr}
                  modifiers={modifiers}
                  modifiersStyles={modifiersStyles}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="icon" onClick={handleNextDay} aria-label="Jour suivant">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Month Stats + Daily Indicator - unified row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Total {format(selectedDate, "MMMM", { locale: fr })}
            </p>
            <p className="text-xl font-bold text-foreground">{formatEur(monthTotal)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Moyenne / jour
            </p>
            <p className="text-xl font-bold text-foreground">
              {formatEur(averagePerDay)}
              <span className="text-xs text-muted-foreground font-normal ml-1">
                ({daysWithData} j.)
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              Masse salariale
            </p>
            <p className="text-xl font-bold text-foreground">
              {isLoadingPayroll ? (
                <Loader2 className="h-4 w-4 animate-spin inline" />
              ) : isPayrollUnavailable ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                formatEur(costDayEur)
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Masse / CA</p>
            <p className="text-xl font-bold text-foreground">
              {isLoadingPayroll ? (
                <Loader2 className="h-4 w-4 animate-spin inline" />
              ) : ratioPercent !== null ? (
                `${ratioPercent.toFixed(1)}%`
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Day Form */}
      <div className="max-w-2xl mx-auto">
        <CashDayForm
          dayDate={selectedDay}
          initialData={report ?? null}
          onSave={save}
          isSaving={isSaving}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
