/**
 * CP (Congés Payés) Tab for Personnel Management
 * Displays list of employees with CP days taken in a month
 * Navigation: month prev/next
 * Source: personnel_leaves (leave_type="cp", status="approved")
 *
 * TODO: Plus tard : fusionner CP planning + CP validés via demandes paie
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { usePagination } from "@/hooks/usePagination";
import { useCPMonthlyData } from "@/hooks/presence/useCPData";

interface CPTabProps {
  establishmentId?: string | null;
}

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
 * Navigate month by delta (-1 or +1)
 */
function navigateMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  const newYear = date.getFullYear();
  const newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${newYear}-${newMonth}`;
}

/**
 * Format YYYY-MM to readable month name
 */
function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export function CPTab({ establishmentId }: CPTabProps) {
  const [yearMonth, setYearMonth] = useState(getCurrentMonth);

  const { users, totalCpDays, isLoading, error } = useCPMonthlyData(yearMonth, {
    establishmentId,
  });

  // Pagination (PERF-08)
  const {
    paginatedData: paginatedUsers,
    currentPage,
    totalPages,
    totalItems,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
    goToPage,
  } = usePagination(users, { pageSize: 25 });

  const handlePrevMonth = () => setYearMonth((prev) => navigateMonth(prev, -1));
  const handleNextMonth = () => setYearMonth((prev) => navigateMonth(prev, 1));

  return (
    <div className="space-y-6">
      {/* Month Navigation Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="icon"
          onClick={handlePrevMonth}
          className="h-10 w-10"
          aria-label="Mois précédent"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <h2 className="text-lg font-semibold capitalize">{formatMonth(yearMonth)}</h2>

        <Button
          variant="outline"
          size="icon"
          onClick={handleNextMonth}
          className="h-10 w-10"
          aria-label="Mois suivant"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Total CP Summary */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              <span className="font-medium">Total CP</span>
            </div>
            <span className="text-xl font-bold text-primary">
              {totalCpDays} jour{totalCpDays > 1 ? "s" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && <div className="text-center py-8 text-destructive">Erreur : {error.message}</div>}

      {/* Loading State */}
      {isLoading && <div className="text-center py-8 text-muted-foreground">Chargement...</div>}

      {/* Empty State */}
      {!isLoading && !error && users.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">Aucun CP sur ce mois</div>
      )}

      {/* Employee List */}
      {!isLoading && !error && users.length > 0 && (
        <div className="space-y-2">
          {paginatedUsers.map((user) => {
            const fmtDate = (d: string) =>
              new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
            const dateRange =
              user.firstDate === user.lastDate
                ? fmtDate(user.firstDate)
                : `Du ${fmtDate(user.firstDate)} au ${fmtDate(user.lastDate)}`;

            return (
              <Card key={user.userId}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">{user.fullName}</span>
                      <span className="text-xs text-muted-foreground">{dateRange}</span>
                    </div>
                    <span className="text-muted-foreground">
                      {user.cpDaysCount} jour{user.cpDaysCount > 1 ? "s" : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
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
      )}
    </div>
  );
}
