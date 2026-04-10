/**
 * Monthly list of employees with extra time
 * Shows: employee name, total approved, total pending
 * V3.3: Admin view for extras
 */

import { ChevronRight, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import { formatLateMinutes } from "@/lib/presence/presence.compute";
import type { ExtraEmployeeSummary } from "@/hooks/presence/useExtraData";

interface ExtraMonthlyListProps {
  summaries: ExtraEmployeeSummary[];
  isLoading: boolean;
  onSelectEmployee: (userId: string, fullName: string) => void;
}

export function ExtraMonthlyList({
  summaries,
  isLoading,
  onSelectEmployee,
}: ExtraMonthlyListProps) {
  // Pagination (PERF-08)
  const {
    paginatedData: paginatedSummaries,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
  } = usePagination(summaries, { pageSize: 25 });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">Aucun extra ce mois-ci</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {paginatedSummaries.map((summary) => (
        <div
          key={summary.userId}
          className="flex items-center gap-3 p-4 bg-card border border-border rounded-xl cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => onSelectEmployee(summary.userId, summary.fullName)}
        >
          {/* Employee info */}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{summary.fullName}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
              <Clock className="h-3 w-3" />
              <span>Approuve: {formatLateMinutes(summary.approvedMinutes)}</span>
            </div>
          </div>

          {/* Pending badge */}
          {summary.pendingCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-900/30 dark:text-amber-400"
            >
              {summary.pendingCount} en attente
            </Badge>
          )}

          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </div>
      ))}
      {/* Pagination (PERF-08) */}
      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        hasNextPage={hasNextPage}
        hasPrevPage={hasPrevPage}
        onNextPage={nextPage}
        onPrevPage={prevPage}
        onGoToPage={goToPage}
      />
    </div>
  );
}
