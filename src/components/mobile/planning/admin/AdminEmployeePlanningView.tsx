/**
 * AdminEmployeePlanningView
 *
 * Vue planning d'un salarié sélectionné par l'admin.
 * Compose les briques existantes (MobileDayCard, MobileWeekNav, etc.)
 *
 * NIVEAU 2 REFACTOR:
 * - Ne fetch plus usePlanningWeek (reçoit planningData via props)
 * - Ne souscrit plus usePlanningRealtime (géré par MobilePlanningRouter)
 * - weekStart/setWeekStart passés en props (source unique au Router)
 *
 * RÈGLES:
 * - Filtre LOCAL sur les données reçues en props
 * - Réutilise exactement les mêmes composants UI
 */

import { useMemo, useCallback } from "react";
import { MobileLayout } from "../../MobileLayout";
import { MobileWeekSummary } from "../MobileWeekSummary";
import { MobileDayCard } from "../MobileDayCard";
import { MobileWeekNav } from "../MobileWeekNav";
import { MobileShiftManagementDialog } from "../MobileShiftManagementDialog";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import { getMonday, getWeekDates } from "@/lib/planning-engine/format";
import { Loader2, AlertCircle, ChevronLeft } from "lucide-react";
import { useState } from "react";
import type { PlanningShift, PlanningWeekData } from "@/components/planning/types/planning.types";

const DAYS_FR = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export interface AdminEmployeePlanningViewProps {
  employeeUserId: string;
  employeeFullName: string;
  onBack: () => void;
  planningData: PlanningWeekData | undefined;
  isLoading: boolean;
  error: Error | null;
  weekStart: string;
  setWeekStart: (weekStart: string) => void;
}

export function AdminEmployeePlanningView({
  employeeUserId,
  employeeFullName,
  onBack,
  planningData,
  isLoading,
  error,
  weekStart,
  setWeekStart,
}: AdminEmployeePlanningViewProps) {
  const { activeEstablishment } = useEstablishment();
  const selectedEstablishmentId = activeEstablishment?.id ?? null;

  // Modal state (local to this view)
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalDayLabel, setModalDayLabel] = useState<string>("");

  // ✅ GOLD RULE: Use RPC get_service_day_now for "today" - SINGLE SOURCE OF TRUTH
  const { data: serviceDay } = useServiceDayToday(selectedEstablishmentId);

  // ✅ Compute current week monday from serviceDay (Paris timezone)
  const serviceDayMonday = serviceDay
    ? getMonday(new Date(serviceDay + "T12:00:00"))
    : getMonday(new Date());

  // Week dates
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const todayStr = serviceDay ?? "";

  // ══════════════════════════════════════════════════════════════
  // FILTRAGE LOCAL: Uniquement les shifts du salarié sélectionné
  // Données reçues via props depuis MobilePlanningRouter
  // ══════════════════════════════════════════════════════════════
  const filteredShiftsByDate = useMemo(() => {
    if (!planningData) return {};

    const result: Record<string, PlanningShift[]> = {};
    for (const date of weekDates) {
      result[date] = [];
    }

    // Get shifts only for selected employee
    const employeeShifts = planningData.shiftsByEmployee[employeeUserId] || [];

    for (const shift of employeeShifts) {
      if (result[shift.shift_date]) {
        result[shift.shift_date].push(shift);
      }
    }

    return result;
  }, [planningData, weekDates, employeeUserId]);

  // Total minutes for this employee only
  const totalMinutes = useMemo(() => {
    if (!planningData) return 0;
    return planningData.totalsByEmployee[employeeUserId] || 0;
  }, [planningData, employeeUserId]);

  // Memoized modal handlers to prevent unnecessary re-renders
  const openShiftModal = useCallback((date: string, dayLabel: string) => {
    setModalDate(date);
    setModalDayLabel(dayLabel);
  }, []);

  const closeShiftModal = useCallback(() => {
    setModalDate(null);
    setModalDayLabel("");
  }, []);

  // Loading
  if (!planningData && isLoading) {
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

  if (!planningData) return null;

  return (
    <MobileLayout>
      <div className="px-4 pt-2 pb-4 space-y-2">
        {/* Week navigation - first element under header */}
        <MobileWeekNav
          weekStart={weekStart}
          onWeekChange={setWeekStart}
          currentWeekMonday={serviceDayMonday}
        />

        {/* Back button + employee name + hours on one compact row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onBack}
              className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label="Retour à la liste des salariés"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium truncate">{employeeFullName}</span>
          </div>
          <MobileWeekSummary totalMinutes={totalMinutes} />
        </div>

        {/* Days list */}
        <div className="space-y-3">
          {weekDates.map((date, index) => {
            const opening = planningData.openingByDate[date];
            const isClosed = opening?.isClosed ?? false;
            const shifts = filteredShiftsByDate[date] || [];

            return (
              <MobileDayCard
                key={date}
                date={date}
                dayLabel={DAYS_FR[index]}
                shifts={shifts}
                isClosed={isClosed}
                isToday={date === todayStr}
                canEdit={!isClosed}
                onTap={!isClosed ? () => openShiftModal(date, DAYS_FR[index]) : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* Shift management modal - employee already selected by admin */}
      {modalDate && selectedEstablishmentId && (
        <MobileShiftManagementDialog
          isOpen={!!modalDate}
          onClose={closeShiftModal}
          date={modalDate}
          dayLabel={modalDayLabel}
          establishmentId={selectedEstablishmentId}
          weekStart={weekStart}
          employeeId={employeeUserId}
          employeeName={employeeFullName}
          shifts={filteredShiftsByDate[modalDate] || []}
          openingWindow={planningData.openingByDate[modalDate]}
        />
      )}
    </MobileLayout>
  );
}
