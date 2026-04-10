/**
 * Day-only view for users with caisse_day permission
 * Shows only today's business day with clean header + payroll indicator
 */

import { Loader2, Calendar, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCashDay } from "../hooks/useCashDay";
import { useServiceDayToday } from "../hooks/useBusinessDayToday";
import { useDailyPayrollCost } from "@/hooks/payroll/useDailyPayrollCost";
import { CashDayForm } from "./CashDayForm";
import { formatBusinessDay } from "../utils/businessDay";
import { formatEur } from "../utils/money";

interface CashDayOnlyViewProps {
  establishmentId: string | null;
  canWrite: boolean;
}

export function CashDayOnlyView({ establishmentId, canWrite }: CashDayOnlyViewProps) {
  // ✅ SINGLE SOURCE OF TRUTH: useServiceDayToday(establishmentId)
  const {
    data: businessDay,
    isLoading: isLoadingBusinessDay,
    error: serviceDayError,
  } = useServiceDayToday(establishmentId);

  const { report, isLoading, save, isSaving } = useCashDay({
    establishmentId,
    dayDate: businessDay ?? "",
  });

  // ✅ Payroll indicator (black box from Paie module)
  const {
    costDayEur,
    isLoading: isLoadingPayroll,
    isUnavailable: isPayrollUnavailable,
  } = useDailyPayrollCost(establishmentId, businessDay ?? null);

  if (!establishmentId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Aucun établissement sélectionné
      </div>
    );
  }

  if (isLoadingBusinessDay || !businessDay || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Calculate ratio (handle CA = 0 or unavailable data)
  const totalCa = report?.total_eur ?? 0;
  const ratioPercent = !isPayrollUnavailable && totalCa > 0 ? (costDayEur / totalCa) * 100 : null;

  return (
    <div className="space-y-4">
      {/* Error state */}
      {serviceDayError && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
          <p className="text-sm text-destructive">
            Erreur lors du chargement : {(serviceDayError as Error).message}
          </p>
        </div>
      )}

      {/* Header with date */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-foreground">
            <Calendar className="h-5 w-5 text-primary" />
            <span className="font-medium">{formatBusinessDay(businessDay)}</span>
            <span className="text-xs text-muted-foreground ml-2">(Journée en cours)</span>
          </div>
        </CardContent>
      </Card>

      {/* Payroll Indicator Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Indicateurs</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Masse salariale jour</p>
              <p className="text-lg font-semibold text-foreground">
                {isLoadingPayroll ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : isPayrollUnavailable ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatEur(costDayEur)
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Masse / CA</p>
              <p className="text-lg font-semibold text-foreground">
                {isLoadingPayroll ? (
                  <Loader2 className="h-4 w-4 animate-spin inline" />
                ) : ratioPercent !== null ? (
                  `${ratioPercent.toFixed(1)}%`
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <div className="max-w-md mx-auto">
        <CashDayForm
          dayDate={businessDay}
          initialData={report ?? null}
          onSave={save}
          isSaving={isSaving}
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}
