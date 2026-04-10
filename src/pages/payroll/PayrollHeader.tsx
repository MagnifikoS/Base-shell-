/**
 * PayrollHeader — Masse salariale summary card.
 */

import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { usePayrollMonthData } from "@/hooks/payroll/usePayrollMonthData";
import { formatEuros } from "./payrollHelpers";

interface PayrollHeaderProps {
  totals: ReturnType<typeof usePayrollMonthData>["totals"];
  extrasApplied: number;
}

export function PayrollHeader({ totals, extrasApplied }: PayrollHeaderProps) {
  const extrasDetected = totals.totalExtras;
  const hasExtrasNotApplied = extrasDetected > extrasApplied + 0.01; // epsilon for float comparison

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Masse salariale totale</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatEuros(totals.totalPayrollMass)}</div>
        <p className="text-xs text-muted-foreground">Masse a verser + Charges</p>
        {/* Ligne 1: Masse salariale totale + Charges patronales */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
          <div>
            <p className="text-sm text-muted-foreground">Masse totale a verser</p>
            <p className="text-lg font-semibold text-primary">
              {formatEuros(totals.totalMassToDisburse)}
            </p>
            <p className="text-xs text-muted-foreground">Sigma Salaires totaux ajustes</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Charges patronales</p>
            <p className="text-lg font-semibold">{formatEuros(totals.totalChargesFixed)}</p>
            <p className="text-xs text-muted-foreground">Sigma (Brut - Net) fixe</p>
          </div>
        </div>
        {/* Ligne 2: Masse salariale nette + Paiement especes */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
          <div>
            <p className="text-sm text-muted-foreground">Masse salariale nette</p>
            <p className="text-lg font-semibold">{formatEuros(totals.totalNetBase)}</p>
            <p className="text-xs text-muted-foreground">Sigma Net contractuel</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Paiement especes</p>
            <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">
              {formatEuros(totals.totalCashAmount)}
            </p>
            <p className="text-xs text-muted-foreground">Sigma Especes a verser</p>
          </div>
        </div>
        {/* Ligne 3: Extras detectes vs appliques (si difference) */}
        {extrasDetected > 0 && (
          <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
            <div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                Extras detectes
                {hasExtrasNotApplied && (
                  <Info className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                )}
              </p>
              <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                +{formatEuros(extrasDetected)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Extras appliques</p>
              <p
                className={`text-lg font-semibold ${hasExtrasNotApplied ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
              >
                +{formatEuros(extrasApplied)}
              </p>
              {hasExtrasNotApplied && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Non inclus : {formatEuros(extrasDetected - extrasApplied)}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
