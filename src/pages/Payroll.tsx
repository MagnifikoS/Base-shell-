/**
 * PAYROLL PAGE — UI Display Only (SIMPLIFIED VERSION)
 *
 * This page displays payroll data using the payroll.compute.ts engine.
 * NO local calculations. ALL values come from the engine via usePayrollMonthData.
 *
 * CLEANUP: Removed "Reporter" and "Compenser" modes.
 * All deductions are now always directly deducted from salary.
 *
 * Features:
 * - Masse salariale header (Brut, Net, Reste à payer)
 * - Month navigation (default: current month)
 * - Adjusted totals display
 * - Employee table with payroll details
 * - Employee detail drawer
 */

import React, { useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { PrintButton } from "@/components/ui/PrintButton";
import { useCashMonth } from "@/modules/cash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import {
  usePayrollMonthData,
  getCurrentMonth,
  type PayrollEmployeeData,
} from "@/hooks/payroll/usePayrollMonthData";
import { usePayrollValidation } from "@/hooks/payroll/usePayrollValidation";
import { DEFAULT_VALIDATION_FLAGS } from "@/lib/payroll/payroll.compute";
import { usePermissions } from "@/hooks/usePermissions";
import { PayrollPrepButton } from "@/modules/payrollPrep";

import { PayrollHeader } from "./payroll/PayrollHeader";
import { PayrollTable } from "./payroll/PayrollTable";
import { EmployeeDetailSheet } from "./payroll/EmployeeDetailSheet";
import { PayrollSkeleton } from "./payroll/PayrollSkeleton";
import { formatEuros, formatMonthLabel, navigateMonth } from "./payroll/payrollHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Payroll() {
  const isMobile = useIsMobile();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);
  const [selectedEmployee, setSelectedEmployee] = useState<PayrollEmployeeData | null>(null);

  const { activeEstablishmentId: selectedEstablishmentId } = useEstablishmentAccess();
  const {
    employees,
    totals,
    planningPayrollTotal,
    planningPayrollByTeam,
    validationByUserId,
    rextraBalanceByUserId,
    isLoading,
    error,
    refetch,
  } = usePayrollMonthData(selectedMonth);

  // Permission check for paie:write
  const { can } = usePermissions();
  const canWritePaie = can("paie", "write");

  // Mutation for updating payment status from table
  const validationMutation = usePayrollValidation();

  // Handler for payment changes from table (net/cash with partial amounts)
  const handlePaymentChange = (
    userId: string,
    field: "net" | "cash",
    paid: boolean,
    amountPaid: number | null
  ) => {
    if (!selectedEstablishmentId || !canWritePaie) return;
    const currentFlags = validationByUserId.get(userId) || DEFAULT_VALIDATION_FLAGS;
    validationMutation.mutate({
      establishmentId: selectedEstablishmentId,
      userId,
      yearMonth: selectedMonth,
      includeExtras: currentFlags.includeExtras,
      includeAbsences: currentFlags.includeAbsences,
      includeDeductions: currentFlags.includeDeductions,
      cashPaid: field === "cash" ? paid : currentFlags.cashPaid,
      netPaid: field === "net" ? paid : currentFlags.netPaid,
      extrasPaidEur: currentFlags.extrasPaidEur,
      netAmountPaid: field === "net" ? amountPaid : currentFlags.netAmountPaid,
      cashAmountPaid: field === "cash" ? amountPaid : currentFlags.cashAmountPaid,
    });
  };

  // Phase C: CA mensuel pour ratio masse/CA
  const [year, month] = selectedMonth.split("-").map(Number);
  const { monthTotal: caMonthTotal } = useCashMonth({
    establishmentId: selectedEstablishmentId,
    year,
    month,
  });

  // Calcul % masse/CA (affichage uniquement)
  const ratioMasseCa = useMemo(() => {
    if (!caMonthTotal || caMonthTotal === 0 || planningPayrollTotal === 0) return null;
    return (planningPayrollTotal / caMonthTotal) * 100;
  }, [planningPayrollTotal, caMonthTotal]);

  // Calcul "extras appliqués" (uniquement les extras où includeExtras = true)
  const extrasApplied = useMemo(() => {
    let total = 0;
    for (const emp of employees) {
      const flags = validationByUserId.get(emp.userId);
      if (flags?.includeExtras ?? true) {
        total += emp.line.totalExtraAmount;
      }
    }
    return total;
  }, [employees, validationByUserId]);

  return (
    <ResponsiveLayout>
      <div className={isMobile ? "px-3 py-3 space-y-3" : "p-6 space-y-6"}>
        {/* Title + Month navigation */}
        {isMobile ? (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold">Paie</h1>
              <div className="flex items-center gap-1.5">
                <PrintButton />
                <PayrollPrepButton
                  yearMonth={selectedMonth}
                  establishmentId={selectedEstablishmentId}
                />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSelectedMonth((m) => navigateMonth(m, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium capitalize min-w-[130px] text-center">
                {formatMonthLabel(selectedMonth)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSelectedMonth((m) => navigateMonth(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Paie</h1>
            <div className="flex items-center gap-4">
              <PrintButton />
              <PayrollPrepButton
                yearMonth={selectedMonth}
                establishmentId={selectedEstablishmentId}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedMonth((m) => navigateMonth(m, -1))}
                  aria-label="Mois précédent"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[160px] text-center font-medium capitalize">
                  {formatMonthLabel(selectedMonth)}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSelectedMonth((m) => navigateMonth(m, 1))}
                  aria-label="Mois suivant"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="py-4 flex items-center justify-between">
              <p className="text-destructive">
                Erreur : {error.message || "Une erreur est survenue"}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Réessayer
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Loading state */}
        {isLoading && <PayrollSkeleton />}

        {/* Content */}
        {!isLoading && !error && (
          <>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
              <PayrollHeader totals={totals} extrasApplied={extrasApplied} />

              {/* Planning Payroll Cost Card */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Masse salariale prévisionnelle
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatEuros(planningPayrollTotal)}</div>
                  <p className="text-xs text-muted-foreground">
                    {ratioMasseCa !== null ? `${ratioMasseCa.toFixed(1)}% du CA` : "—"}
                  </p>

                  {/* Department percentages based on FORECAST total */}
                  {planningPayrollByTeam.length > 0 && (
                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
                      {planningPayrollByTeam.map((team) => {
                        const teamPct =
                          planningPayrollTotal > 0
                            ? (team.costEur / planningPayrollTotal) * 100
                            : null;
                        return (
                          <div key={team.teamId || "unassigned"}>
                            <p className="text-sm text-muted-foreground">{team.teamName}</p>
                            <p className="text-lg font-semibold tabular-nums">
                              {teamPct !== null ? `${teamPct.toFixed(1)}%` : "—"}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className={isMobile ? "overflow-x-auto -mx-3 px-3" : ""}>
              <PayrollTable
                employees={employees}
                onSelectEmployee={setSelectedEmployee}
                validationByUserId={validationByUserId}
                onPaymentChange={handlePaymentChange}
                canWrite={canWritePaie}
              />
            </div>
          </>
        )}

        {/* Employee detail drawer */}
        <EmployeeDetailSheet
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          validationFlags={
            selectedEmployee
              ? validationByUserId.get(selectedEmployee.userId) || DEFAULT_VALIDATION_FLAGS
              : DEFAULT_VALIDATION_FLAGS
          }
          rextraBalanceMinutes={
            selectedEmployee ? (rextraBalanceByUserId.get(selectedEmployee.userId) ?? 0) : 0
          }
          establishmentId={selectedEstablishmentId}
          yearMonth={selectedMonth}
          canWrite={canWritePaie}
        />
      </div>
    </ResponsiveLayout>
  );
}
