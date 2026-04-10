/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PaginationControls — Ready-to-use pagination bar (PERF-08)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays:
 * - "X resultats" total count
 * - Previous / Next buttons
 * - Page numbers (first, current neighborhood, last) with ellipsis
 * - "Page X sur Y"
 * - Responsive: simplified on mobile (no page numbers)
 *
 * All labels in French.
 */

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  onGoToPage: (page: number) => void;
}

/**
 * Build the array of page numbers to display.
 * Shows: first page, ellipsis, pages around current, ellipsis, last page.
 * Returns numbers for pages and null for ellipsis.
 */
function buildPageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | null)[] = [];

  // Always show first page
  pages.push(1);

  // Left ellipsis
  if (current > 3) {
    pages.push(null);
  }

  // Pages around current
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  // Right ellipsis
  if (current < total - 2) {
    pages.push(null);
  }

  // Always show last page
  if (total > 1) {
    pages.push(total);
  }

  return pages;
}

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onPrevPage,
  onGoToPage,
}: PaginationControlsProps) {
  const isMobile = useIsMobile();

  // Don't render if only one page
  if (totalPages <= 1) {
    if (totalItems > 0) {
      return (
        <div className="flex justify-center pt-2 pb-1">
          <span className="text-sm text-muted-foreground">
            {totalItems} resultat{totalItems !== 1 ? "s" : ""}
          </span>
        </div>
      );
    }
    return null;
  }

  const pageNumbers = buildPageNumbers(currentPage, totalPages);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-4 pb-2">
      {/* Total count */}
      <span className="text-sm text-muted-foreground order-2 sm:order-1">
        {totalItems} resultat{totalItems !== 1 ? "s" : ""}
      </span>

      {/* Navigation */}
      <div className="flex items-center gap-1 order-1 sm:order-2">
        {/* Previous */}
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevPage}
          disabled={!hasPrevPage}
          aria-label="Page precedente"
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          {!isMobile && <span>Precedent</span>}
        </Button>

        {/* Page numbers (desktop only) */}
        {!isMobile &&
          pageNumbers.map((page, index) =>
            page === null ? (
              <span
                key={`ellipsis-${index}`}
                className="px-1 text-muted-foreground select-none"
                aria-hidden
              >
                ...
              </span>
            ) : (
              <Button
                key={page}
                variant={page === currentPage ? "default" : "outline"}
                size="sm"
                className="min-w-[36px]"
                onClick={() => onGoToPage(page)}
                aria-label={`Page ${page}`}
                aria-current={page === currentPage ? "page" : undefined}
              >
                {page}
              </Button>
            )
          )}

        {/* Mobile: Page X sur Y */}
        {isMobile && (
          <span className="px-3 text-sm text-muted-foreground whitespace-nowrap">
            Page {currentPage} sur {totalPages}
          </span>
        )}

        {/* Next */}
        <Button
          variant="outline"
          size="sm"
          onClick={onNextPage}
          disabled={!hasNextPage}
          aria-label="Page suivante"
          className="gap-1"
        >
          {!isMobile && <span>Suivant</span>}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Page X sur Y (desktop) */}
      {!isMobile && (
        <span className="text-sm text-muted-foreground order-3">
          Page {currentPage} sur {totalPages}
        </span>
      )}
    </div>
  );
}
