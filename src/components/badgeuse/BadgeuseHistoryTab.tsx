/**
 * BadgeuseHistoryTab - Desktop only
 * View and edit badge events history by day
 * V5: UNIFIED with Presence - uses PresenceEmployeeCard as SINGLE SOURCE OF TRUTH
 *     - No inline modals (uses PresenceEmployeeRow's built-in modals)
 *     - No duplicate edit/delete state
 * V6: PHASE 2.1 - Uses useServiceDayToday for correct initial day
 * V8: PHASE 2.7 - Removed local usePresenceRealtime (now global in AppLayout)
 */

import { useState, useMemo } from "react";
import { format, addDays, subDays, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Users,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePresenceByDate } from "@/hooks/presence/usePresenceByDate";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { useAdminBadgeMutations } from "@/hooks/presence/useAdminBadgeMutations";
import { PresenceEmployeeRow } from "@/components/mobile/presence/PresenceEmployeeRow";
import { formatParisDate } from "@/lib/time/paris";

interface BadgeuseHistoryTabProps {
  establishmentId: string | null;
}

export function BadgeuseHistoryTab({ establishmentId }: BadgeuseHistoryTabProps) {
  // ✅ SINGLE SOURCE OF TRUTH: Service day from RPC (same as Presence)
  const { data: serviceDay, isLoading: isLoadingServiceDay } = useServiceDayToday(establishmentId);

  // Manual date selection state (null = use service day)
  const [manualDate, setManualDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // ✅ dayDate = manual selection OR service day (NO new Date() fallback)
  const dayDate = manualDate ?? serviceDay ?? "";

  // For calendar display: convert dayDate string to Date object
  const selectedDateForDisplay = dayDate ? parseISO(dayDate) : new Date();

  // ✅ SINGLE SOURCE OF TRUTH: Same hook as Presence page
  const {
    employees,
    isLoading: isLoadingPresence,
    refetch,
  } = usePresenceByDate({
    establishmentId,
    dayDate,
    enabled: !!dayDate,
  });

  // Mutations for resetDay (passed to PresenceEmployeeRow)
  const { resetDay, isResetting } = useAdminBadgeMutations(establishmentId ?? undefined);

  // Combined loading state
  const isLoading = isLoadingServiceDay || isLoadingPresence;

  // Navigation handlers - use formatParisDate on Date objects
  // ✅ HISTORY ONLY: Can only navigate to PAST days (not today, not future)
  const goToday = () => setManualDate(null); // Reset to service day (yesterday or last worked day)
  const goPrev = () => {
    const current = dayDate ? parseISO(dayDate) : new Date();
    setManualDate(formatParisDate(subDays(current, 1)));
  };
  const goNext = () => {
    if (!serviceDay) return;
    const current = dayDate ? parseISO(dayDate) : new Date();
    const nextDate = addDays(current, 1);
    // Block navigation to service day or future
    if (formatParisDate(nextDate) >= serviceDay) return;
    setManualDate(formatParisDate(nextDate));
  };

  // ✅ Can we go forward? Only if next day is strictly before service day
  const canGoNext = useMemo(() => {
    if (!serviceDay || !dayDate) return false;
    const nextDate = addDays(parseISO(dayDate), 1);
    return formatParisDate(nextDate) < serviceDay;
  }, [dayDate, serviceDay]);

  // Format date for display
  const formattedDate = dayDate ? format(parseISO(dayDate), "EEEE d MMMM", { locale: fr }) : "—";

  // Compute summary counts
  const { badgedCount, plannedCount } = useMemo(() => {
    const planned = employees.filter((e) => e.source !== "badge_only");
    const badged = planned.filter((e) => e.allEvents.length > 0);
    return {
      plannedCount: planned.length,
      badgedCount: badged.length,
    };
  }, [employees]);

  // Pagination (PERF-08)
  const {
    paginatedData: paginatedEmployees,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
  } = usePagination(employees, { pageSize: 25 });

  // Reset day handler for PresenceEmployeeRow
  // Pass the historical dayDate so the backend deletes the correct day's events
  const handleResetDay = async (params: { targetUserId: string }) => {
    return resetDay.mutateAsync({ ...params, dayDate: dayDate || undefined });
  };

  // Guard: no establishment selected
  if (!establishmentId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Choisis un établissement</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Historique des pointages</h2>
          <p className="text-sm text-muted-foreground capitalize">{formattedDate}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goPrev} aria-label="Jour précédent">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Ouvrir le calendrier">
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDateForDisplay}
                onSelect={(date) => {
                  if (date) {
                    const formatted = formatParisDate(date);
                    // Block selection of service day or future
                    if (serviceDay && formatted >= serviceDay) return;
                    setManualDate(formatted);
                    setCalendarOpen(false);
                  }
                }}
                disabled={(date) => {
                  // Disable service day and all future dates
                  if (!serviceDay) return false;
                  return formatParisDate(date) >= serviceDay;
                }}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            onClick={goNext}
            disabled={!canGoNext}
            aria-label="Jour suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday}>
            Hier
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Actualiser">
            <RefreshCw className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-xl">
        <Users className="h-8 w-8 text-primary" />
        <div>
          <div className="text-2xl font-bold">
            {badgedCount} / {plannedCount}
          </div>
          <div className="text-sm text-muted-foreground">salariés pointés</div>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Employee list - SAME component as Presence page */}
      {!isLoading && employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucun salarie prevu pour cette date</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 max-w-2xl">
            {paginatedEmployees.map((employee) => (
              <PresenceEmployeeRow
                key={employee.userId}
                employee={employee}
                serviceDay={dayDate}
                onResetDay={handleResetDay}
                isResettingOverride={isResetting}
                establishmentId={establishmentId}
              />
            ))}
          </div>
          {/* Pagination (PERF-08) */}
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            hasNextPage={hasNextPage}
            hasPrevPage={hasPrevPage}
            onNextPage={nextPage}
            onPrevPage={prevPage}
            onGoToPage={goToPage}
          />
        </>
      )}
    </div>
  );
}
