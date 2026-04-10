/**
 * PayrollAdjustments — Monthly adjustments summary card.
 */

import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { usePayrollMonthData } from "@/hooks/payroll/usePayrollMonthData";
import { formatEuros } from "./payrollHelpers";

interface PayrollAdjustmentsProps {
  totals: ReturnType<typeof usePayrollMonthData>["totals"];
  extrasApplied: number;
}

export function PayrollAdjustments({ totals, extrasApplied }: PayrollAdjustmentsProps) {
  const extrasDetected = totals.totalExtras;
  const hasExtrasNotApplied = extrasDetected > extrasApplied;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ajustements du mois</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-5">
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              Extras detectes
              {hasExtrasNotApplied && (
                <Info className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
              )}
            </span>
            <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
              +{formatEuros(extrasDetected)}
            </span>
            {hasExtrasNotApplied && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Appliques : {formatEuros(extrasApplied)}
              </span>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">Conges payes (CP)</span>
            <span className="text-lg font-semibold text-sky-600 dark:text-sky-400">
              {totals.totalCpDays} jour{totals.totalCpDays > 1 ? "s" : ""}
            </span>
            <span className="text-xs text-muted-foreground">Pas de deduction</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">Absences (hors CP)</span>
            <span className="text-lg font-semibold text-destructive">
              -{formatEuros(totals.totalAbsences)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">Heures a retirer</span>
            <span className="text-lg font-semibold text-amber-600 dark:text-amber-400">
              -{formatEuros(totals.totalDeductions)}
            </span>
          </div>
          <div className="flex flex-col border-l pl-4">
            <span className="text-sm text-muted-foreground">Masse a verser</span>
            <span className="text-xl font-bold">{formatEuros(totals.totalMassToDisburse)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
