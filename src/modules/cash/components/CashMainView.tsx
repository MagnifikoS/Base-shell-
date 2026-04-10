/**
 * CashMainView — Unified main view for the cash module.
 * Replaces CashMonthAdmin and CashDayOnlyView.
 * Mobile-first, privacy-first, with month list + wizard + drawer.
 */

import { useState, useMemo, useCallback } from "react";
import { Loader2, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCashMonth } from "../hooks/useCashMonth";
import { useServiceDayToday } from "../hooks/useBusinessDayToday";
import { useAmountVisibility } from "../hooks/useAmountVisibility";
import { useMonthlyPayrollCost } from "../hooks/useMonthlyPayrollCost";
import { CashMonthHeader } from "./CashMonthHeader";
import { CashDayList } from "./CashDayList";
import { CashDayDrawer } from "./CashDayDrawer";
import { CashWizardModal } from "./CashWizardModal";
import { VisibilityToggle } from "./VisibilityToggle";
import type { CashDayReport } from "../utils/types";

interface CashMainViewProps {
  establishmentId: string;
  canWrite: boolean;
  canAccessMonth: boolean;
}

export function CashMainView({
  establishmentId,
  canWrite,
  canAccessMonth,
}: CashMainViewProps) {
  const {
    data: businessDayToday,
    isLoading: isLoadingServiceDay,
  } = useServiceDayToday(establishmentId);

  // Month navigation state
  const todayDate = businessDayToday ?? new Date().toISOString().slice(0, 10);
  const [todayYear, todayMonth] = todayDate.split("-").map(Number);

  const [selectedYear, setSelectedYear] = useState(todayYear);
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);

  // Update once service day loads
  useMemo(() => {
    if (businessDayToday) {
      const [y, m] = businessDayToday.split("-").map(Number);
      setSelectedYear(y);
      setSelectedMonth(m);
    }
  }, [businessDayToday]);

  const { reports, isLoading: isLoadingMonth, isError } = useCashMonth({
    establishmentId,
    year: selectedYear,
    month: selectedMonth,
  });

  const { visible, toggle } = useAmountVisibility();

  // Monthly payroll cost (admin-only)
  const {
    costMonthEur,
    isLoading: isPayrollLoading,
    isUnavailable: isPayrollUnavailable,
  } = useMonthlyPayrollCost(establishmentId, selectedYear, selectedMonth);

  // Drawer state
  const [drawerDay, setDrawerDay] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDay, setWizardDay] = useState<string | null>(null);

  const reportsByDate = useMemo(() => {
    const map = new Map<string, CashDayReport>();
    reports.forEach((r) => map.set(r.day_date, r));
    return map;
  }, [reports]);

  const handleDayClick = useCallback((dateStr: string) => {
    setDrawerDay(dateStr);
    setDrawerOpen(true);
  }, []);

  const handlePrevMonth = useCallback(() => {
    setSelectedMonth((m) => {
      if (m === 1) {
        setSelectedYear((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setSelectedMonth((m) => {
      if (m === 12) {
        setSelectedYear((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  }, []);

  // For caisse_day, only show wizard for today
  const canWriteToday = canWrite;
  const isCurrentMonth =
    businessDayToday &&
    selectedYear === Number(businessDayToday.split("-")[0]) &&
    selectedMonth === Number(businessDayToday.split("-")[1]);

  if (isLoadingServiceDay) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error state */}
      {isError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
          <p className="text-sm text-destructive">Erreur lors du chargement des données.</p>
        </div>
      )}

      {/* Month header with indicators + navigation + visibility toggle */}
      <CashMonthHeader
        year={selectedYear}
        month={selectedMonth}
        reports={reports}
        visible={canAccessMonth ? visible : false}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        payrollCostEur={costMonthEur}
        isPayrollLoading={isPayrollLoading}
        isPayrollUnavailable={isPayrollUnavailable}
        visibilityToggle={canAccessMonth ? <VisibilityToggle visible={visible} onToggle={toggle} /> : undefined}
      />

      {/* Day list */}
      {isLoadingMonth ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <CashDayList
          year={selectedYear}
          month={selectedMonth}
          reports={reports}
          businessDayToday={businessDayToday ?? null}
          visible={canAccessMonth ? visible : false}
          canWrite={canWrite}
          canAccessMonth={canAccessMonth}
          onDayClick={handleDayClick}
          onWizardOpen={(dateStr) => {
            setWizardDay(dateStr);
            setWizardOpen(true);
          }}
        />
      )}


      {/* Day drawer */}
      {drawerDay && (
        <CashDayDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          dayDate={drawerDay}
          establishmentId={establishmentId}
          canWrite={
            canWrite && (canAccessMonth || drawerDay === businessDayToday)
          }
          visible={visible}
          isToday={drawerDay === businessDayToday}
        />
      )}

      {/* Wizard modal */}
      {wizardDay && (
        <CashWizardModal
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          dayDate={wizardDay}
          establishmentId={establishmentId}
          existingReport={reportsByDate.get(wizardDay) ?? null}
        />
      )}
    </div>
  );
}
