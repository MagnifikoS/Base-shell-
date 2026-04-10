/**
 * Retard (Late) tab content for Presence admin view
 * Shows monthly aggregation + detail view per employee
 * V5.0: Uses payroll.compute.ts for "Heures à retirer" calculation
 *
 * Displays:
 * - "Heures à retirer" = Retard arrivée + Départ anticipé (combined)
 * - Individual breakdown per employee
 *
 * Sources of truth (NO local calculation):
 * - Late: badge_events.late_minutes (SSOT, stored at clock_in)
 * - Early departure: badge_events.early_departure_minutes (SSOT, stored at clock_out)
 * - Combined: payroll.compute.ts → computeHeuresARetirer()
 */

import { useState } from "react";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  ArrowDown,
  ArrowUp,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import {
  useLateMonthlyData,
  useLateEmployeeDetail,
  type LateEmployeeSummary,
  type TimingEventDetail,
} from "@/hooks/presence/useLateData";
import { minutesToXhYY, formatParisLocale } from "@/lib/time/paris";
import { computeHeuresARetirer } from "@/lib/payroll/payroll.compute";

/**
 * Get current month in YYYY-MM format (Paris timezone)
 */
function getCurrentMonth(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value || "2024";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  return `${year}-${month}`;
}

/**
 * Navigate months (YYYY-MM format)
 */
function navigateMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  const newYear = date.getFullYear();
  const newMonth = date.getMonth() + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

/**
 * Format month for display
 */
function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

interface RetardTabProps {
  establishmentId?: string | null;
}

export function RetardTab({ establishmentId }: RetardTabProps) {
  const [yearMonth, setYearMonth] = useState(getCurrentMonth);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    userId: string;
    fullName: string;
  } | null>(null);

  const { summaries, isLoading, refetch } = useLateMonthlyData(yearMonth, { establishmentId });
  const {
    events,
    isLoading: isLoadingDetail,
    refetch: _refetchDetail,
  } = useLateEmployeeDetail(selectedEmployee?.userId || null, yearMonth, { establishmentId });

  // Guard: if no establishment selected, show message
  if (!establishmentId) {
    return <div className="p-4 text-sm text-muted-foreground">Choisis un établissement</div>;
  }

  const handlePrevMonth = () => setYearMonth((m) => navigateMonth(m, -1));
  const handleNextMonth = () => setYearMonth((m) => navigateMonth(m, 1));

  const handleSelectEmployee = (userId: string, fullName: string) => {
    setSelectedEmployee({ userId, fullName });
  };

  const handleBack = () => {
    setSelectedEmployee(null);
    refetch();
  };

  // Calculate totals using payroll engine (NO local calculation)
  const totalLateMinutes = summaries.reduce((acc, s) => acc + s.totalLateMinutes, 0);
  const totalEarlyMinutes = summaries.reduce((acc, s) => acc + s.totalEarlyDepartureMinutes, 0);
  const heuresARetirer = computeHeuresARetirer(totalLateMinutes, totalEarlyMinutes);

  return (
    <div className="space-y-4">
      {/* Month navigation (only show in list view) */}
      {!selectedEmployee && (
        <>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrevMonth}
              aria-label="Mois précédent"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="font-medium capitalize">{formatMonth(yearMonth)}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNextMonth}
                aria-label="Mois suivant"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Actualiser">
                <RefreshCw className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Summary - "Heures à retirer" (combined) */}
          {heuresARetirer.totalMinutes > 0 && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl space-y-2">
              {/* Main combined total */}
              <p className="text-sm text-destructive font-semibold flex items-center gap-2">
                <Timer className="h-4 w-4" />
                Heures à retirer : {heuresARetirer.hhmm}
              </p>
              {/* Breakdown */}
              <div className="text-xs text-muted-foreground pl-6 space-y-0.5">
                {totalLateMinutes > 0 && (
                  <p className="flex items-center gap-1">
                    <ArrowDown className="h-3 w-3" />
                    Retards : {minutesToXhYY(totalLateMinutes)}
                  </p>
                )}
                {totalEarlyMinutes > 0 && (
                  <p className="flex items-center gap-1">
                    <ArrowUp className="h-3 w-3" />
                    Départs anticipés : {minutesToXhYY(totalEarlyMinutes)}
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Content */}
      {selectedEmployee ? (
        <LateEmployeeDetail
          employeeName={selectedEmployee.fullName}
          events={events}
          isLoading={isLoadingDetail}
          onBack={handleBack}
        />
      ) : (
        <LateMonthlyList
          summaries={summaries}
          isLoading={isLoading}
          onSelectEmployee={handleSelectEmployee}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface LateMonthlyListProps {
  summaries: LateEmployeeSummary[];
  isLoading: boolean;
  onSelectEmployee: (userId: string, fullName: string) => void;
}

function LateMonthlyList({ summaries, isLoading, onSelectEmployee }: LateMonthlyListProps) {
  // Pagination (PERF-08)
  const {
    paginatedData: paginatedSummaries,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
  } = usePagination(summaries, { pageSize: 25 });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Aucun retard ou départ anticipé ce mois-ci</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {paginatedSummaries.map((summary) => {
        const hasLate = summary.totalLateMinutes > 0;
        const hasEarly = summary.totalEarlyDepartureMinutes > 0;
        const totalEvents = summary.lateCount + summary.earlyDepartureCount;

        // Use payroll engine for combined total (NO local calculation)
        const employeeHeuresARetirer = computeHeuresARetirer(
          summary.totalLateMinutes,
          summary.totalEarlyDepartureMinutes
        );

        return (
          <div
            key={summary.userId}
            className="flex items-center justify-between p-4 bg-card border border-border rounded-xl cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSelectEmployee(summary.userId, summary.fullName)}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{summary.fullName}</div>
              <div className="text-sm text-muted-foreground">
                {totalEvents} événement{totalEvents > 1 ? "s" : ""}
              </div>
            </div>
            <div className="text-right shrink-0">
              {/* Main: Heures à retirer */}
              <div className="flex items-center justify-end gap-1 text-destructive font-semibold">
                <Timer className="h-3 w-3" />
                <span>{employeeHeuresARetirer.hhmm}</span>
              </div>
              {/* Breakdown (smaller) */}
              <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                {hasLate && (
                  <div className="flex items-center justify-end gap-1">
                    <ArrowDown className="h-2.5 w-2.5" />
                    <span>{minutesToXhYY(summary.totalLateMinutes)}</span>
                  </div>
                )}
                {hasEarly && (
                  <div className="flex items-center justify-end gap-1">
                    <ArrowUp className="h-2.5 w-2.5" />
                    <span>{minutesToXhYY(summary.totalEarlyDepartureMinutes)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
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
    </div>
  );
}

interface LateEmployeeDetailProps {
  employeeName: string;
  events: TimingEventDetail[];
  isLoading: boolean;
  onBack: () => void;
}

function LateEmployeeDetail({ employeeName, events, isLoading, onBack }: LateEmployeeDetailProps) {
  // Group events by day
  const eventsByDay = new Map<string, TimingEventDetail[]>();
  for (const event of events) {
    const existing = eventsByDay.get(event.day_date) || [];
    existing.push(event);
    eventsByDay.set(event.day_date, existing);
  }

  // Sort days
  const sortedDays = Array.from(eventsByDay.keys()).sort();

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour à la liste">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h3 className="font-medium">{employeeName}</h3>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : sortedDays.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucun retard ou départ anticipé ce mois-ci</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedDays.map((dayDate) => {
            const dayEvents = eventsByDay.get(dayDate) || [];
            const _totalDayLate = dayEvents.reduce((acc, e) => acc + (e.late_minutes || 0), 0);
            const _totalDayEarly = dayEvents.reduce(
              (acc, e) => acc + (e.early_departure_minutes || 0),
              0
            );

            // Format date: "sam. 17 janv."
            const formattedDate = formatParisLocale(dayDate, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });

            return (
              <div key={dayDate} className="p-4 bg-card border border-border rounded-xl">
                {/* Day header with date */}
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium capitalize">{formattedDate}</span>
                  <div className="text-xs text-muted-foreground">
                    {dayEvents.length} shift{dayEvents.length > 1 ? "s" : ""}
                  </div>
                </div>

                {/* Show explicit shift details */}
                <div className="mt-3 text-sm space-y-2">
                  {dayEvents.map((e) => {
                    const shiftLabel = dayEvents.length > 1 ? `Shift ${e.sequence_index}` : "Shift";

                    // SSOT: planned times from planning_shifts via hook
                    const shiftTimes =
                      e.planned_start && e.planned_end
                        ? `(${e.planned_start} - ${e.planned_end})`
                        : "";

                    // Arrival time from effective_at (SSOT: badge_events)
                    const arrivalTime = e.effective_at
                      ? formatParisLocale(e.effective_at, {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })
                      : null;

                    return (
                      <div key={e.id} className="space-y-1">
                        {/* Late arrival detail */}
                        {e.late_minutes > 0 && (
                          <div className="flex items-start gap-2">
                            <ArrowDown className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                            <div>
                              <span className="text-destructive font-medium">
                                Retard arrivée : +{minutesToXhYY(e.late_minutes)}
                              </span>
                              <p className="text-muted-foreground">
                                {shiftLabel} {shiftTimes} : arrivée à {arrivalTime || "-"}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Early departure detail */}
                        {e.early_departure_minutes > 0 && (
                          <div className="flex items-start gap-2">
                            <ArrowUp className="h-3 w-3 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                            <div>
                              <span className="text-orange-600 dark:text-orange-400 font-medium">
                                Départ anticipé : −{minutesToXhYY(e.early_departure_minutes)}
                              </span>
                              <p className="text-muted-foreground">
                                {shiftLabel} {shiftTimes} : départ à {e.actual_departure || "-"}
                                {e.planned_end ? ` (prévu ${e.planned_end})` : ""}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
