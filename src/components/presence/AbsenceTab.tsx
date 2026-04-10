/**
 * Absence tab content for Presence admin view
 * Shows monthly aggregation + detail view per employee
 * V4.0: Uses payroll.compute.ts for countAbsenceDays (paie-ready)
 *
 * Displays:
 * - "Absences" = X jours (from personnel_leaves approved, cp/absence only)
 * - Undeclared absences shown separately
 *
 * Sources of truth (NO local calculation):
 * - Planned leaves: personnel_leaves (approved)
 * - Absence days count: payroll.compute.ts → countAbsenceDays()
 */

import { useState } from "react";
import { RefreshCw, ChevronLeft, ChevronRight, UserX, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import { useAbsenceMonthlyData, useAbsenceEmployeeDetail } from "@/hooks/presence/useAbsenceData";
import { minutesToXhYY, formatParisLocale } from "@/lib/time/paris";
import { DAILY_WORK_MINUTES } from "@/lib/payroll/payroll.compute";

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

interface AbsenceTabProps {
  establishmentId?: string | null;
}

export function AbsenceTab({ establishmentId }: AbsenceTabProps) {
  const [yearMonth, setYearMonth] = useState(getCurrentMonth);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    userId: string;
    fullName: string;
  } | null>(null);

  const { summaries, isLoading, refetch } = useAbsenceMonthlyData(yearMonth, { establishmentId });
  const {
    events,
    isLoading: isLoadingDetail,
    refetch: _refetchDetail,
  } = useAbsenceEmployeeDetail(selectedEmployee?.userId || null, yearMonth, { establishmentId });

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

  // Calculate total absence for header
  const totalAbsenceMinutes = summaries.reduce((acc, s) => acc + s.totalAbsenceMinutes, 0);
  const totalAbsenceCount = summaries.reduce((acc, s) => acc + s.absenceCount, 0);

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

          {/* Summary */}
          {totalAbsenceCount > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                {totalAbsenceCount} absence{totalAbsenceCount > 1 ? "s" : ""} •{" "}
                {minutesToXhYY(totalAbsenceMinutes)} prévues
              </p>
            </div>
          )}
        </>
      )}

      {/* Content */}
      {selectedEmployee ? (
        <AbsenceEmployeeDetail
          employeeName={selectedEmployee.fullName}
          events={events}
          isLoading={isLoadingDetail}
          onBack={handleBack}
        />
      ) : (
        <AbsenceMonthlyList
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

interface AbsenceMonthlyListProps {
  summaries: Array<{
    userId: string;
    fullName: string;
    totalAbsenceMinutes: number;
    absenceCount: number;
    leaveCount: number;
    undeclaredCount: number;
  }>;
  isLoading: boolean;
  onSelectEmployee: (userId: string, fullName: string) => void;
}

function AbsenceMonthlyList({ summaries, isLoading, onSelectEmployee }: AbsenceMonthlyListProps) {
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
        <UserX className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Aucune absence ce mois-ci</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {paginatedSummaries.map((summary) => {
        // leaveCount = approved CP/Absence days (paie-relevant)
        // This value comes from the hook, which uses approved leaves only
        const absenceDays = summary.leaveCount;

        return (
          <div
            key={summary.userId}
            className="flex items-center justify-between p-4 bg-card border border-border rounded-xl cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSelectEmployee(summary.userId, summary.fullName)}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{summary.fullName}</div>
              <div className="text-sm text-muted-foreground space-x-2">
                {summary.leaveCount > 0 && (
                  <span className="text-blue-600 dark:text-blue-400">
                    {summary.leaveCount} CP/Absence
                  </span>
                )}
                {summary.undeclaredCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {summary.undeclaredCount} non déclarée{summary.undeclaredCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              {/* Main: Absences (jours) - paie ready */}
              {absenceDays > 0 && (
                <div className="flex items-center justify-end gap-1 text-blue-600 dark:text-blue-400 font-semibold">
                  <Calendar className="h-3 w-3" />
                  <span>
                    {absenceDays} jour{absenceDays > 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {/* Secondary: Undeclared absences (hours) - uses DAILY_WORK_MINUTES from payroll engine */}
              {summary.undeclaredCount > 0 && (
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  +{minutesToXhYY(summary.undeclaredCount * DAILY_WORK_MINUTES)} non décl.
                </div>
              )}
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

interface AbsenceEmployeeDetailProps {
  employeeName: string;
  events: Array<{
    dayDate: string;
    sequenceIndex: number;
    plannedStart: string;
    plannedEnd: string;
    plannedMinutes: number;
    absenceType: "leave" | "undeclared";
    leaveType?: "cp" | "absence";
  }>;
  isLoading: boolean;
  onBack: () => void;
}

/**
 * Group consecutive days into ranges (UI only)
 * Similar logic to groupAbsences.ts but adapted for this data structure
 */
interface AbsenceDetailGroup {
  id: string;
  dateStart: string;
  dateEnd: string;
  days: string[];
  absenceType: "leave" | "undeclared" | "mixed";
  leaveType?: "cp" | "absence";
  totalMinutes: number;
}

function areConsecutiveDays(date1: string, date2: string): boolean {
  const d1 = new Date(date1 + "T12:00:00Z");
  const d2 = new Date(date2 + "T12:00:00Z");
  const diffMs = d2.getTime() - d1.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays === 1;
}

function groupConsecutiveDays(
  sortedDays: string[],
  eventsByDay: Map<string, AbsenceEmployeeDetailProps["events"]>
): AbsenceDetailGroup[] {
  if (sortedDays.length === 0) return [];

  const groups: AbsenceDetailGroup[] = [];
  let currentDays: string[] = [sortedDays[0]];

  for (let i = 1; i < sortedDays.length; i++) {
    const prevDay = sortedDays[i - 1];
    const currDay = sortedDays[i];

    if (areConsecutiveDays(prevDay, currDay)) {
      currentDays.push(currDay);
    } else {
      // Finalize current group
      groups.push(createDetailGroup(currentDays, eventsByDay));
      currentDays = [currDay];
    }
  }

  // Don't forget last group
  if (currentDays.length > 0) {
    groups.push(createDetailGroup(currentDays, eventsByDay));
  }

  return groups;
}

function createDetailGroup(
  days: string[],
  eventsByDay: Map<string, AbsenceEmployeeDetailProps["events"]>
): AbsenceDetailGroup {
  let totalMinutes = 0;
  let hasLeave = false;
  let hasUndeclared = false;
  let leaveType: "cp" | "absence" | undefined;

  for (const day of days) {
    const dayEvents = eventsByDay.get(day) || [];
    for (const e of dayEvents) {
      totalMinutes += e.plannedMinutes;
      if (e.absenceType === "leave") {
        hasLeave = true;
        if (e.leaveType) leaveType = e.leaveType;
      } else {
        hasUndeclared = true;
      }
    }
  }

  return {
    id: days[0],
    dateStart: days[0],
    dateEnd: days[days.length - 1],
    days,
    absenceType: hasLeave && hasUndeclared ? "mixed" : hasLeave ? "leave" : "undeclared",
    leaveType,
    totalMinutes,
  };
}

function AbsenceEmployeeDetail({
  employeeName,
  events,
  isLoading,
  onBack,
}: AbsenceEmployeeDetailProps) {
  // Group events by day
  const eventsByDay = new Map<string, typeof events>();
  for (const event of events) {
    const existing = eventsByDay.get(event.dayDate) || [];
    existing.push(event);
    eventsByDay.set(event.dayDate, existing);
  }

  // Sort days
  const sortedDays = Array.from(eventsByDay.keys()).sort();

  // Group consecutive days into ranges
  const groups = groupConsecutiveDays(sortedDays, eventsByDay);

  // Format date range for display
  const formatDateRange = (group: AbsenceDetailGroup) => {
    try {
      const startDate = new Date(group.dateStart + "T12:00:00Z");

      if (group.days.length === 1) {
        return formatParisLocale(group.dateStart, {
          weekday: "short",
          day: "numeric",
          month: "short",
        });
      }

      const endDate = new Date(group.dateEnd + "T12:00:00Z");
      const startStr = startDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      const endStr = endDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

      return `${startStr} → ${endStr}`;
    } catch {
      return group.dateStart;
    }
  };

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
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <UserX className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucune absence ce mois-ci</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const isLeave = group.absenceType === "leave";
            const isMixed = group.absenceType === "mixed";

            return (
              <div key={group.id} className="p-4 bg-card border border-border rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{formatDateRange(group)}</span>
                    {group.days.length > 1 && (
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                        {group.days.length} jours
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-semibold ${isLeave || isMixed ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}
                  >
                    {isLeave
                      ? group.leaveType === "cp"
                        ? "CP"
                        : "Absence planifiée"
                      : isMixed
                        ? "Absence mixte"
                        : `Absent • ${minutesToXhYY(group.totalMinutes)}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
