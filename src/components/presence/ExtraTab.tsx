/**
 * Extra tab content for Presence admin view
 * Shows monthly aggregation + detail view per employee
 * V3.3: Admin workflow for extra validation
 */

import { useState, useMemo } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExtraMonthlyData, useExtraEmployeeDetail } from "@/hooks/presence/useExtraData";
import type { ExtraEmployeeSummary } from "@/hooks/presence/useExtraData";
import { ExtraMonthlyList } from "./ExtraMonthlyList";
import { ExtraEmployeeDetail } from "./ExtraEmployeeDetail";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { filterByScope } from "@/lib/rbac/scope";
import { getCurrentParisMonth } from "@/lib/time/paris";

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

interface ExtraTabProps {
  establishmentId?: string | null;
}

export function ExtraTab({ establishmentId }: ExtraTabProps) {
  const [yearMonth, setYearMonth] = useState(getCurrentParisMonth);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    userId: string;
    fullName: string;
  } | null>(null);

  // RBAC scope filtering (PER-MGR-009)
  const { user } = useAuth();
  const { getScope, teamIds, establishmentIds, isAdmin } = usePermissions();

  // Pass establishmentId override to hooks (for desktop admin filtering)
  const { summaries, isLoading, refetch } = useExtraMonthlyData(yearMonth, { establishmentId });
  const {
    events,
    isLoading: isLoadingDetail,
    refetch: _refetchDetail,
  } = useExtraEmployeeDetail(selectedEmployee?.userId || null, yearMonth, { establishmentId });

  // Apply scope filtering on summaries (PER-MGR-009)
  const scopeFilteredSummaries = useMemo(() => {
    if (!user || !summaries.length) return summaries;
    if (isAdmin) return summaries;

    return filterByScope<ExtraEmployeeSummary>({
      scope: getScope("presence"),
      userId: user.id,
      myTeamIds: teamIds,
      selectedEstablishmentId: establishmentId ?? null,
      myEstablishmentIds: establishmentIds,
      items: summaries,
      getUserId: (s) => s.userId,
      getTeamId: (s) => s.teamId,
    });
  }, [summaries, user, isAdmin, getScope, teamIds, establishmentIds, establishmentId]);

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
    refetch(); // Refresh list when coming back
  };

  // HISTORY VIEW: exclude pending (shown in DemandesTab only)
  const historyEvents = events.filter((e) => e.status !== "pending");

  // For monthly list: zero out pendingCount so no badge shows in Extras
  const displaySummaries = scopeFilteredSummaries.map((s) => ({ ...s, pendingCount: 0 }));

  return (
    <div className="space-y-4">
      {/* Month navigation (only show in list view) */}
      {!selectedEmployee && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={handlePrevMonth} aria-label="Mois précédent">
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="font-medium capitalize">{formatMonth(yearMonth)}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleNextMonth} aria-label="Mois suivant">
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Actualiser">
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {selectedEmployee ? (
        <ExtraEmployeeDetail
          employeeName={selectedEmployee.fullName}
          events={historyEvents}
          isLoading={isLoadingDetail}
          onBack={handleBack}
        />
      ) : (
        <ExtraMonthlyList
          summaries={displaySummaries}
          isLoading={isLoading}
          onSelectEmployee={handleSelectEmployee}
        />
      )}
    </div>
  );
}
