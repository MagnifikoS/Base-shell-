/**
 * Month header: compact mobile-first layout
 * Month nav on top with visibility toggle, then KPI row (Total, Moyenne, Masse salariale, Ratio)
 */

import { useMemo, type ReactNode } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmountCell } from "./AmountCell";
import { toSafeMiddayUTC } from "../utils/businessDay";
import { formatEur } from "../utils/money";
import type { CashDayReport } from "../utils/types";

interface CashMonthHeaderProps {
  year: number;
  month: number;
  reports: CashDayReport[];
  visible: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  payrollCostEur?: number;
  isPayrollLoading?: boolean;
  isPayrollUnavailable?: boolean;
  /** Optional visibility toggle element rendered inline with month nav */
  visibilityToggle?: ReactNode;
}

export function CashMonthHeader({
  year,
  month,
  reports,
  visible,
  onPrevMonth,
  onNextMonth,
  payrollCostEur = 0,
  isPayrollLoading = false,
  isPayrollUnavailable = true,
  visibilityToggle,
}: CashMonthHeaderProps) {
  const { monthTotal, totalCb, totalCash, averagePerDay, daysWithData } = useMemo(() => {
    const total = reports.reduce((s, r) => s + (r.total_eur ?? 0), 0);
    const cb = reports.reduce((s, r) => s + (r.cb_eur ?? 0), 0);
    const cash = reports.reduce((s, r) => s + (r.cash_eur ?? 0), 0);
    const count = reports.length;
    return {
      monthTotal: total,
      totalCb: cb,
      totalCash: cash,
      averagePerDay: count > 0 ? total / count : 0,
      daysWithData: count,
    };
  }, [reports]);

  const ratioPercent = !isPayrollUnavailable && monthTotal > 0
    ? (payrollCostEur / monthTotal) * 100
    : null;

  const monthLabel = format(
    toSafeMiddayUTC(`${year}-${String(month).padStart(2, "0")}-15`),
    "MMMM yyyy",
    { locale: fr }
  );

  return (
    <div className="space-y-2">
      {/* Month navigation + visibility toggle inline */}
      <div className="flex items-center justify-between">
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onPrevMonth} aria-label="Mois précédent" className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground capitalize min-w-[120px] text-center">
            {monthLabel}
          </span>
          <Button variant="ghost" size="icon" onClick={onNextMonth} aria-label="Mois suivant" className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 flex justify-end">
          {visibilityToggle}
        </div>
      </div>

      {/* KPI cards — 2×2 grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Total CA */}
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">Total CA</p>
          <AmountCell
            value={monthTotal}
            visible={visible}
            className="text-lg font-bold text-foreground tabular-nums"
          />
          {visible && (
            <div className="flex gap-2 mt-1">
              <span className="text-[10px] text-muted-foreground tabular-nums">CB {formatEur(totalCb)}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">Esp. {formatEur(totalCash)}</span>
            </div>
          )}
        </div>

        {/* Moyenne / jour */}
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">Moy. / jour</p>
          <div className="flex items-baseline gap-1">
            <AmountCell
              value={averagePerDay}
              visible={visible}
              className="text-lg font-bold text-foreground tabular-nums"
            />
            {visible && daysWithData > 0 && (
              <span className="text-[10px] text-muted-foreground">({daysWithData}j)</span>
            )}
          </div>
        </div>

        {/* Masse salariale */}
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">Masse sal.</p>
          <p className="text-lg font-bold text-foreground tabular-nums">
            {isPayrollLoading ? (
              <Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" />
            ) : isPayrollUnavailable || !visible ? (
              <span className="text-muted-foreground">•••• €</span>
            ) : (
              formatEur(payrollCostEur)
            )}
          </p>
        </div>

        {/* Ratio Masse / CA */}
        <div className="rounded-xl bg-card p-3 shadow-sm">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">Masse / CA</p>
          <p className="text-lg font-bold text-foreground tabular-nums">
            {isPayrollLoading ? (
              <Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" />
            ) : !visible || ratioPercent === null ? (
              <span className="text-muted-foreground">— %</span>
            ) : (
              <span className={ratioPercent > 35 ? "text-destructive" : "text-foreground"}>
                {ratioPercent.toFixed(1)} %
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
