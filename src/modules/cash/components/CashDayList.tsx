/**
 * List of all days in the current month, ordered descending (most recent first).
 */

import { useMemo } from "react";
import { getDaysInMonth } from "date-fns";
import { CashDayRow } from "./CashDayRow";
import type { CashDayReport } from "../utils/types";

interface CashDayListProps {
  year: number;
  month: number;
  reports: CashDayReport[];
  businessDayToday: string | null;
  visible: boolean;
  canWrite: boolean;
  canAccessMonth: boolean;
  onDayClick: (dateStr: string) => void;
  onWizardOpen: (dateStr: string) => void;
}

export function CashDayList({
  year,
  month,
  reports,
  businessDayToday,
  visible,
  canWrite,
  canAccessMonth,
  onDayClick,
  onWizardOpen,
}: CashDayListProps) {
  const reportsByDate = useMemo(() => {
    const map = new Map<string, CashDayReport>();
    reports.forEach((r) => map.set(r.day_date, r));
    return map;
  }, [reports]);

  const averagePerDay = useMemo(() => {
    if (reports.length === 0) return 0;
    const total = reports.reduce((s, r) => s + (r.total_eur ?? 0), 0);
    return total / reports.length;
  }, [reports]);

  // Generate day strings up to today only (no future days), descending
  const dayStrings = useMemo(() => {
    const daysCount = getDaysInMonth(new Date(year, month - 1));
    const todayStr = businessDayToday ?? new Date().toISOString().slice(0, 10);
    const result: string[] = [];
    for (let d = daysCount; d >= 1; d--) {
      const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (ds <= todayStr) {
        result.push(ds);
      }
    }
    return result;
  }, [year, month, businessDayToday]);

  return (
    <div className="space-y-1">
      {dayStrings.map((dateStr) => {
        const isToday = dateStr === businessDayToday;
        // caisse_day can only write on today's service day
        const canWriteDay = canWrite && (canAccessMonth || isToday);
        return (
          <CashDayRow
            key={dateStr}
            dateStr={dateStr}
            report={reportsByDate.get(dateStr) ?? null}
            averagePerDay={averagePerDay}
            visible={visible}
            isToday={isToday}
            canWriteDay={canWriteDay}
            onClick={() => onDayClick(dateStr)}
            onWizardOpen={() => onWizardOpen(dateStr)}
          />
        );
      })}
    </div>
  );
}
