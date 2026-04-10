/**
 * DemandesTab - Pending extra requests for admin validation
 * Phase 2: UI only, reuses existing hooks and components
 *
 * Shows only employees with pending extras (status = 'pending')
 * Reuses ExtraEmployeeDetail for approve/reject actions
 *
 * Source of truth: extra_events.status (unchanged)
 * Queries: summaries passed from parent (no duplicate fetch), 1 detail on click
 */

import { useState } from "react";
import { RefreshCw, Loader2, FileCheck, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useExtraEmployeeDetail, type ExtraEmployeeSummary } from "@/hooks/presence/useExtraData";
import { ExtraEmployeeDetail } from "./ExtraEmployeeDetail";

/**
 * Get current month in YYYY-MM format (Paris timezone)
 */
function getCurrentMonth(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value || "2024";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  return `${year}-${month}`;
}

/**
 * Format month for display
 */
function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

interface DemandesTabProps {
  establishmentId?: string | null;
  /** Summaries from parent (single hook call in GestionPersonnel) */
  summaries: ExtraEmployeeSummary[];
  isLoadingSummaries: boolean;
  onRefresh: () => void;
}

export function DemandesTab({
  establishmentId,
  summaries,
  isLoadingSummaries,
  onRefresh,
}: DemandesTabProps) {
  // Fixed to current month (Phase 2 scope - no historical navigation)
  const yearMonth = getCurrentMonth();
  const [selectedEmployee, setSelectedEmployee] = useState<{
    userId: string;
    fullName: string;
  } | null>(null);

  // Detail query - only enabled when employee selected (1 query on click)
  const { events: allEvents, isLoading: isLoadingDetail } = useExtraEmployeeDetail(
    selectedEmployee?.userId || null,
    yearMonth,
    { establishmentId }
  );

  // Filter to pending only for display
  const pendingEvents = allEvents.filter((e) => e.status === "pending");

  // Filter summaries to only show employees with pending requests
  const pendingSummaries = summaries.filter((s) => s.pendingCount > 0);

  // Guard: if no establishment selected
  if (!establishmentId) {
    return <div className="p-4 text-sm text-muted-foreground">Choisis un établissement</div>;
  }

  const handleSelectEmployee = (userId: string, fullName: string) => {
    setSelectedEmployee({ userId, fullName });
  };

  const handleBack = () => {
    setSelectedEmployee(null);
    onRefresh(); // Refresh list when coming back
  };

  // Total pending count
  const totalPending = summaries.reduce((acc, s) => acc + s.pendingCount, 0);

  return (
    <div className="space-y-4">
      {/* Header with period info (only in list view) */}
      {!selectedEmployee && (
        <>
          <div className="flex items-center justify-between">
            <span className="font-medium capitalize">{formatMonth(yearMonth)}</span>
            <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Actualiser">
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>

          {/* Summary badge */}
          {totalPending > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                {totalPending} demande{totalPending > 1 ? "s" : ""} en attente de validation
              </p>
            </div>
          )}
        </>
      )}

      {/* Content */}
      {selectedEmployee ? (
        // Detail view - show pending events only
        // BUG 1 FIX: No duplicate header here - ExtraEmployeeDetail handles it
        isLoadingDetail ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : pendingEvents.length === 0 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBack}
                aria-label="Retour à la liste"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h3 className="font-medium">{selectedEmployee.fullName}</h3>
            </div>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Aucune demande en attente</p>
            </div>
          </div>
        ) : (
          <ExtraEmployeeDetail
            employeeName={selectedEmployee.fullName}
            events={pendingEvents}
            isLoading={false}
            onBack={handleBack}
            establishmentId={establishmentId}
            showEditButton
          />
        )
      ) : (
        // List view - employees with pending requests
        <div className="space-y-2">
          {isLoadingSummaries ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : pendingSummaries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileCheck className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Aucune demande en attente</p>
            </div>
          ) : (
            pendingSummaries.map((summary) => (
              <button
                key={summary.userId}
                className="w-full p-4 bg-card border border-border rounded-xl hover:bg-accent/50 transition-colors text-left flex items-center justify-between"
                onClick={() => handleSelectEmployee(summary.userId, summary.fullName)}
              >
                <span className="font-medium">{summary.fullName}</span>
                <Badge
                  variant="secondary"
                  className="bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30 dark:text-amber-400"
                >
                  {summary.pendingCount} en attente
                </Badge>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
