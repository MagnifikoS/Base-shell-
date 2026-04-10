/**
 * MobilePlanning - Employee self-view of their weekly planning
 *
 * NO-NAVIGATION EMPLOYEE VIEW:
 * - Employees see only ONE week at a time (no navigation arrows)
 * - The visible week is determined by the backend (employeeWeekStart)
 * - Managers with write access can still navigate between weeks
 *
 * Week selection logic (backend-calculated):
 * - If next week is visible (auto-publish OR manual validation) AND NOT invalidated → next week
 * - Otherwise → current week (service day based)
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { MobileLayout } from "../MobileLayout";
import { MobileWeekSummary } from "./MobileWeekSummary";
import { MobileDayCard } from "./MobileDayCard";
import { MobileWeekNav } from "./MobileWeekNav";
import { MobileShiftManagementDialog } from "./MobileShiftManagementDialog";
import { usePlanningWeek } from "@/components/planning/hooks/usePlanningWeek";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePersonnelLeavesRange, buildLeavesMap } from "@/hooks/personnel/usePersonnelLeaves";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { getMonday, getWeekDates } from "@/lib/planning-engine/format";
import { Loader2, AlertCircle, Building2, ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { PlanningShift } from "@/components/planning/types/planning.types";
import { addDays, format } from "date-fns";

const DAYS_FR = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function MobilePlanning() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const { isAdmin, can } = usePermissions();

  // SSOT: Establishment from Context only (no admin/non-admin branching)
  const selectedEstablishmentId = activeEstablishment?.id ?? null;

  // Determine if user can write planning (for week navigation lock)
  const canWritePlanning = isAdmin || can("planning", "write");

  // ✅ SERVICE DAY: Single source of truth for "today" (Paris timezone, cutoff-aware)
  const { data: serviceDay } = useServiceDayToday(selectedEstablishmentId);

  // Compute current week monday from serviceDay (NOT from new Date())
  const serviceDayMonday = useMemo(() => {
    if (!serviceDay) return getMonday(new Date()); // fallback during load
    const d = new Date(serviceDay + "T12:00:00"); // noon to avoid TZ issues
    return getMonday(d);
  }, [serviceDay]);

  // ══════════════════════════════════════════════════════════════════════════════
  // WEEK STATE:
  // - Managers: can navigate freely (internal state)
  // - Employees: use backend-calculated employeeWeekStart (no navigation)
  // ══════════════════════════════════════════════════════════════════════════════
  const [weekStartInternal, setWeekStartInternal] = useState(() => getMonday(new Date()));
  const [employeeWeekResolved, setEmployeeWeekResolved] = useState<string | null>(null);

  // ✅ GUARDED SETTER: Ignores navigation if read-only
  const setWeekStart = useCallback(
    (newWeek: string) => {
      if (!canWritePlanning) return; // Block navigation for read-only
      setWeekStartInternal(newWeek);
    },
    [canWritePlanning]
  );

  // Query week: managers use internal, employees use service day (initially)
  // After backend responds with employeeWeekStart, employees switch to that
  const queryWeekStart = canWritePlanning
    ? weekStartInternal
    : (employeeWeekResolved ?? serviceDayMonday);

  // Modal state
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalDayLabel, setModalDayLabel] = useState<string>("");

  const { data, isLoading, error } = usePlanningWeek(selectedEstablishmentId, queryWeekStart);

  // ══════════════════════════════════════════════════════════════════════════════
  // EMPLOYEE WEEK SWITCH: When backend provides employeeWeekStart, use it
  // This enables automatic switch to next week when auto-publish is active
  // ══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (
      !canWritePlanning &&
      data?.employeeWeekStart &&
      data.employeeWeekStart !== employeeWeekResolved
    ) {
      setEmployeeWeekResolved(data.employeeWeekStart);
    }
  }, [canWritePlanning, data?.employeeWeekStart, employeeWeekResolved]);

  // Effective weekStart for display
  const weekStart = canWritePlanning
    ? weekStartInternal
    : (data?.employeeWeekStart ?? serviceDayMonday);

  // Compute week date range for leaves query
  const weekDateRange = useMemo(() => {
    const start = new Date(weekStart + "T00:00:00");
    const end = addDays(start, 6);
    return {
      dateFrom: weekStart,
      dateTo: format(end, "yyyy-MM-dd"),
    };
  }, [weekStart]);

  // ══════════════════════════════════════════════════════════════
  // LEAVES: Fetch approved leaves for this week (same as desktop)
  // ══════════════════════════════════════════════════════════════
  const { data: leavesData } = usePersonnelLeavesRange({
    establishmentId: selectedEstablishmentId,
    dateFrom: weekDateRange.dateFrom,
    dateTo: weekDateRange.dateTo,
  });

  // Build leaves map for quick lookup: key = "userId|date"
  const leavesMap = useMemo(() => {
    return buildLeavesMap(leavesData || []);
  }, [leavesData]);

  // Get week dates and today from service day (not browser local time)
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const todayStr = serviceDay ?? "";

  // Current user info
  const currentEmployeeId = user?.id ?? null;
  const currentEmployeeName = useMemo(() => {
    if (!data || !currentEmployeeId) return "Vous";
    const emp = data.employees.find((e) => e.user_id === currentEmployeeId);
    return emp?.full_name || "Vous";
  }, [data, currentEmployeeId]);

  // ══════════════════════════════════════════════════════════════════════════════
  // VISIBILITY LOGIC (Simplified - backend handles auto-publish logic):
  //
  // Priority order:
  // 1. If week_invalidated_at is set → week is HIDDEN (manager override)
  // 2. If week_validated = true → visible unless validated_days[date] === false
  // 3. For employees viewing via employeeWeekStart: days are visible by default
  //    (backend already determined the week is visible)
  // 4. Otherwise: visible only if validated_days[date] === true
  // ══════════════════════════════════════════════════════════════════════════════
  const isDayVisible = useCallback(
    (date: string): boolean => {
      if (!data) return false;
      const validation = data.validation;

      // Priority 1: Manager override (invalidation) - BLOCKS everything
      if (validation.weekInvalidatedAt) {
        return false;
      }

      // Priority 2: Week validated by manager
      if (validation.weekValidated) {
        // All days visible EXCEPT those explicitly set to false
        return validation.validatedDays?.[date] !== false;
      }

      // Priority 3: If backend determined this week is visible for employee
      // (employeeWeekStart === this weekStart), the week is visible via auto-publish
      if (!canWritePlanning && data.employeeWeekStart === weekStart) {
        // Week is visible via auto-publish (backend already checked)
        return validation.validatedDays?.[date] !== false;
      }

      // Priority 4: Day-by-day validation (manual)
      return validation.validatedDays?.[date] === true;
    },
    [data, weekStart, canWritePlanning]
  );

  // Get shifts for current user only (employee self-view)
  const shiftsForUserByDate = useMemo(() => {
    if (!data || !currentEmployeeId) return {};
    const result: Record<string, PlanningShift[]> = {};

    for (const date of weekDates) {
      result[date] = [];
    }

    // Get shifts for current user only
    const userShifts = data.shiftsByEmployee[currentEmployeeId] || [];
    for (const shift of userShifts) {
      if (result[shift.shift_date]) {
        result[shift.shift_date].push(shift);
      }
    }

    return result;
  }, [data, weekDates, currentEmployeeId]);

  // Calculate total from visible days only (for employee)
  const totalMinutes = useMemo(() => {
    if (!data || !currentEmployeeId) return 0;
    let total = 0;
    for (const date of weekDates) {
      if (isDayVisible(date)) {
        const dayShifts = shiftsForUserByDate[date] || [];
        total += dayShifts.reduce((sum, s) => sum + s.net_minutes, 0);
      }
    }
    return total;
  }, [data, weekDates, currentEmployeeId, isDayVisible, shiftsForUserByDate]);

  // Can user edit planning?
  const canEdit = isAdmin || can("planning", "write");

  // Filter shifts for current user (for modal)
  const shiftsForCurrentUser = useMemo(() => {
    if (!modalDate || !currentEmployeeId) return [];
    return shiftsForUserByDate[modalDate] || [];
  }, [modalDate, shiftsForUserByDate, currentEmployeeId]);

  // Memoized modal handlers to prevent unnecessary re-renders
  const openShiftModal = useCallback((date: string, dayLabel: string) => {
    setModalDate(date);
    setModalDayLabel(dayLabel);
  }, []);

  const closeShiftModal = useCallback(() => {
    setModalDate(null);
    setModalDayLabel("");
  }, []);

  // No establishment selected
  if (!selectedEstablishmentId) {
    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            Sélectionnez un établissement pour afficher le planning.
          </p>
        </div>
      </MobileLayout>
    );
  }

  // Loading
  if (!data && isLoading) {
    return (
      <MobileLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileLayout>
    );
  }

  // Error
  if (error) {
    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/70 mb-4" />
          <p className="text-destructive font-medium">Erreur de chargement</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        </div>
      </MobileLayout>
    );
  }

  if (!data) return null;

  return (
    <MobileLayout>
      <div className="px-4 pt-2 pb-4 space-y-2">
        {/* Week navigation - first element under header */}
        <MobileWeekNav
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          disabled={!canWritePlanning}
          currentWeekMonday={serviceDayMonday}
        />

        {/* Back button + Week summary - compact row */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Retour à l'accueil"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour
          </button>
          <MobileWeekSummary totalMinutes={totalMinutes} />
        </div>

        {/* Days list */}
        <div className="space-y-3">
          {weekDates.map((date, index) => {
            const opening = data.openingByDate[date];
            const isClosed = opening?.isClosed ?? false;
            const dayVisible = isDayVisible(date);

            // ═══════════════════════════════════════════════════════════════════════════
            // SECURITY: Only pass shifts/leave data if day is visible (validated)
            // This prevents any data leak in child components
            // ═══════════════════════════════════════════════════════════════════════════
            const shifts = dayVisible ? shiftsForUserByDate[date] || [] : [];
            const leaveKey = currentEmployeeId ? `${currentEmployeeId}|${date}` : "";
            const leave = dayVisible && leaveKey ? (leavesMap.get(leaveKey) ?? null) : null;

            return (
              <MobileDayCard
                key={date}
                date={date}
                dayLabel={DAYS_FR[index]}
                shifts={shifts}
                isClosed={isClosed}
                isToday={date === todayStr}
                isValidated={dayVisible}
                leave={leave}
                canEdit={canEdit && !isClosed && dayVisible}
                onTap={
                  canEdit && !isClosed && dayVisible
                    ? () => openShiftModal(date, DAYS_FR[index])
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>

      {/* Shift management modal - employee = current user (self scope) */}
      {modalDate && selectedEstablishmentId && currentEmployeeId && (
        <MobileShiftManagementDialog
          isOpen={!!modalDate}
          onClose={closeShiftModal}
          date={modalDate}
          dayLabel={modalDayLabel}
          establishmentId={selectedEstablishmentId}
          weekStart={weekStart}
          employeeId={currentEmployeeId}
          employeeName={currentEmployeeName}
          shifts={shiftsForCurrentUser}
          openingWindow={data.openingByDate[modalDate]}
        />
      )}
    </MobileLayout>
  );
}
