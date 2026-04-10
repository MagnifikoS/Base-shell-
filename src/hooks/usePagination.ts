/**
 * ═══════════════════════════════════════════════════════════════════════════
 * usePagination — Reusable client-side pagination hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PERF-08: Generic hook for paginating any array of data.
 * Automatically resets to page 1 when data length changes significantly.
 *
 * Usage:
 *   const { paginatedData, ...controls } = usePagination(filteredItems, { pageSize: 25 });
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";

interface PaginationOptions {
  pageSize?: number;
  initialPage?: number;
}

interface PaginationResult<T> {
  /** Slice of data for the current page */
  paginatedData: T[];
  /** Current page number (1-based) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of items in the source data */
  totalItems: number;
  /** Navigate to a specific page (1-based) */
  goToPage: (page: number) => void;
  /** Navigate to next page */
  nextPage: () => void;
  /** Navigate to previous page */
  prevPage: () => void;
  /** Whether there is a next page */
  hasNextPage: boolean;
  /** Whether there is a previous page */
  hasPrevPage: boolean;
  /** Reset pagination to page 1 (useful when filters change) */
  resetPage: () => void;
}

export function usePagination<T>(data: T[], options: PaginationOptions = {}): PaginationResult<T> {
  const { pageSize = 25, initialPage = 1 } = options;
  const [currentPage, setCurrentPage] = useState(initialPage);

  // Track data length to auto-reset page when data changes
  const prevLengthRef = useRef(data.length);
  useEffect(() => {
    if (data.length !== prevLengthRef.current) {
      prevLengthRef.current = data.length;
      setCurrentPage(1);
    }
  }, [data.length]);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));

  // Clamp currentPage to valid range
  const safePage = Math.min(currentPage, totalPages);
  if (safePage !== currentPage) {
    // Sync state if clamped (will re-render)
    setCurrentPage(safePage);
  }

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, safePage, pageSize]);

  const goToPage = (page: number) => {
    const clamped = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(clamped);
  };

  const nextPage = () => {
    if (safePage < totalPages) {
      setCurrentPage(safePage + 1);
    }
  };

  const prevPage = () => {
    if (safePage > 1) {
      setCurrentPage(safePage - 1);
    }
  };

  const resetPage = useCallback(() => {
    setCurrentPage(1);
  }, []);

  return {
    paginatedData,
    currentPage: safePage,
    totalPages,
    totalItems: data.length,
    goToPage,
    nextPage,
    prevPage,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
    resetPage,
  };
}
