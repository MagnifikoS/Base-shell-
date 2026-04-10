/**
 * Tests for usePagination hook
 * Validates page calculation, navigation, edge cases, and auto-reset behavior
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagination } from "../usePagination";

// ═══════════════════════════════════════════════════════════════════════════
// Helper: generate array of N items
// ═══════════════════════════════════════════════════════════════════════════

function makeItems(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Basic page calculation
// ═══════════════════════════════════════════════════════════════════════════

describe("usePagination — page calculation", () => {
  it("returns all items when data fits on one page", () => {
    const { result } = renderHook(() => usePagination(makeItems(10), { pageSize: 25 }));
    expect(result.current.paginatedData).toEqual(makeItems(10));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.totalItems).toBe(10);
  });

  it("correctly paginates data across multiple pages", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 25 }));
    expect(result.current.totalPages).toBe(2);
    expect(result.current.paginatedData.length).toBe(25);
    expect(result.current.paginatedData[0]).toBe(1);
    expect(result.current.paginatedData[24]).toBe(25);
  });

  it("handles data length not evenly divisible by pageSize", () => {
    const items = makeItems(30);
    const { result } = renderHook(() => usePagination(items, { pageSize: 25 }));
    expect(result.current.totalPages).toBe(2);
    expect(result.current.paginatedData.length).toBe(25);
  });

  it("handles single item", () => {
    const { result } = renderHook(() => usePagination([1], { pageSize: 25 }));
    expect(result.current.paginatedData).toEqual([1]);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.totalItems).toBe(1);
  });

  it("handles empty array", () => {
    const { result } = renderHook(() => usePagination([], { pageSize: 25 }));
    expect(result.current.paginatedData).toEqual([]);
    expect(result.current.totalPages).toBe(1);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.currentPage).toBe(1);
  });

  it("uses default pageSize of 25", () => {
    const items = makeItems(30);
    const { result } = renderHook(() => usePagination(items));
    expect(result.current.paginatedData.length).toBe(25);
    expect(result.current.totalPages).toBe(2);
  });

  it("uses initialPage when provided", () => {
    const items = makeItems(100);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 3 }));
    expect(result.current.currentPage).toBe(3);
    expect(result.current.paginatedData[0]).toBe(21);
  });

  it("uses custom pageSize", () => {
    const items = makeItems(100);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.paginatedData.length).toBe(10);
    expect(result.current.totalPages).toBe(10);
  });

  it("handles exact multiple of pageSize", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 25 }));
    expect(result.current.totalPages).toBe(2);
  });

  it("calculates correct totalItems", () => {
    const items = makeItems(73);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.totalItems).toBe(73);
    expect(result.current.totalPages).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Navigation (next/prev)
// ═══════════════════════════════════════════════════════════════════════════

describe("usePagination — navigation", () => {
  it("nextPage moves to the next page", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.currentPage).toBe(1);

    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(2);
    expect(result.current.paginatedData[0]).toBe(11);
  });

  it("prevPage moves to the previous page", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 3 }));
    expect(result.current.currentPage).toBe(3);

    act(() => result.current.prevPage());
    expect(result.current.currentPage).toBe(2);
  });

  it("nextPage does nothing on last page", () => {
    const items = makeItems(20);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 2 }));
    expect(result.current.currentPage).toBe(2);

    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(2);
  });

  it("prevPage does nothing on first page", () => {
    const items = makeItems(20);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.currentPage).toBe(1);

    act(() => result.current.prevPage());
    expect(result.current.currentPage).toBe(1);
  });

  it("goToPage navigates to a specific page", () => {
    const items = makeItems(100);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));

    act(() => result.current.goToPage(5));
    expect(result.current.currentPage).toBe(5);
    expect(result.current.paginatedData[0]).toBe(41);
  });

  it("goToPage clamps to 1 for values below 1", () => {
    const items = makeItems(100);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));

    act(() => result.current.goToPage(0));
    expect(result.current.currentPage).toBe(1);

    act(() => result.current.goToPage(-5));
    expect(result.current.currentPage).toBe(1);
  });

  it("goToPage clamps to totalPages for values above totalPages", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));

    act(() => result.current.goToPage(999));
    expect(result.current.currentPage).toBe(5);
  });

  it("resetPage returns to page 1", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 4 }));
    expect(result.current.currentPage).toBe(4);

    act(() => result.current.resetPage());
    expect(result.current.currentPage).toBe(1);
  });

  it("can navigate through all pages sequentially", () => {
    const items = makeItems(30);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));

    expect(result.current.currentPage).toBe(1);
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(2);
    act(() => result.current.nextPage());
    expect(result.current.currentPage).toBe(3);
    act(() => result.current.nextPage());
    // Should stay on page 3 (last page)
    expect(result.current.currentPage).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: hasNextPage / hasPrevPage indicators
// ═══════════════════════════════════════════════════════════════════════════

describe("usePagination — hasNextPage / hasPrevPage", () => {
  it("hasNextPage is true when more pages exist", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.hasNextPage).toBe(true);
  });

  it("hasNextPage is false on last page", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 5 }));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("hasPrevPage is false on first page", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.hasPrevPage).toBe(false);
  });

  it("hasPrevPage is true when not on first page", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 3 }));
    expect(result.current.hasPrevPage).toBe(true);
  });

  it("single page has both false", () => {
    const items = makeItems(5);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.hasPrevPage).toBe(false);
  });

  it("empty data has both false", () => {
    const { result } = renderHook(() => usePagination([], { pageSize: 10 }));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.hasPrevPage).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Data slice correctness
// ═══════════════════════════════════════════════════════════════════════════

describe("usePagination — data slicing", () => {
  it("page 1 returns first pageSize items", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10 }));
    expect(result.current.paginatedData).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("page 2 returns correct slice", () => {
    const items = makeItems(50);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 2 }));
    expect(result.current.paginatedData).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("last page returns remaining items (partial page)", () => {
    const items = makeItems(23);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10, initialPage: 3 }));
    expect(result.current.paginatedData).toEqual([21, 22, 23]);
    expect(result.current.paginatedData.length).toBe(3);
  });

  it("works with objects, not just numbers", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { result } = renderHook(() => usePagination(items, { pageSize: 2 }));
    expect(result.current.paginatedData).toEqual([{ id: "a" }, { id: "b" }]);

    act(() => result.current.nextPage());
    expect(result.current.paginatedData).toEqual([{ id: "c" }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("usePagination — edge cases", () => {
  it("handles pageSize of 1", () => {
    const items = makeItems(5);
    const { result } = renderHook(() => usePagination(items, { pageSize: 1 }));
    expect(result.current.totalPages).toBe(5);
    expect(result.current.paginatedData).toEqual([1]);

    act(() => result.current.goToPage(5));
    expect(result.current.paginatedData).toEqual([5]);
  });

  it("handles very large pageSize", () => {
    const items = makeItems(5);
    const { result } = renderHook(() => usePagination(items, { pageSize: 10000 }));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.paginatedData.length).toBe(5);
  });

  it("clamps initial page above totalPages", () => {
    const items = makeItems(10);
    const { result } = renderHook(() => usePagination(items, { pageSize: 5, initialPage: 99 }));
    expect(result.current.currentPage).toBe(2);
  });
});
