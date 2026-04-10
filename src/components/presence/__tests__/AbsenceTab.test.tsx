/**
 * Tests for AbsenceTab — renders list, handles empty state, no establishment
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AbsenceTab } from "../AbsenceTab";

// ═══════════════════════════════════════════════════════════════════════════
// Mock hooks
// ═══════════════════════════════════════════════════════════════════════════

const mockAbsenceMonthlyData = vi.fn();
const mockAbsenceEmployeeDetail = vi.fn();

vi.mock("@/hooks/presence/useAbsenceData", () => ({
  useAbsenceMonthlyData: (...args: unknown[]) => mockAbsenceMonthlyData(...args),
  useAbsenceEmployeeDetail: (...args: unknown[]) => mockAbsenceEmployeeDetail(...args),
}));

vi.mock("@/lib/time/paris", () => ({
  minutesToXhYY: (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`,
  formatParisLocale: (dateStr: string) => dateStr,
}));

vi.mock("@/lib/payroll/payroll.compute", () => ({
  DAILY_WORK_MINUTES: 420,
}));

vi.mock("@/components/ui/pagination-controls", () => ({
  PaginationControls: () => <div data-testid="pagination" />,
}));

vi.mock("@/hooks/usePagination", () => ({
  usePagination: (data: unknown[]) => ({
    paginatedData: data,
    currentPage: 1,
    totalPages: 1,
    totalItems: data.length,
    hasNextPage: false,
    hasPrevPage: false,
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    goToPage: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAbsenceMonthlyData.mockReturnValue({
    summaries: [],
    isLoading: false,
    refetch: vi.fn(),
  });
  mockAbsenceEmployeeDetail.mockReturnValue({
    events: [],
    isLoading: false,
    refetch: vi.fn(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: No establishment
// ═══════════════════════════════════════════════════════════════════════════

describe("AbsenceTab — no establishment", () => {
  it("shows message when no establishmentId", () => {
    render(<AbsenceTab establishmentId={null} />);
    expect(screen.getByText(/Choisis un établissement/)).toBeDefined();
  });

  it("shows message when establishmentId is undefined", () => {
    render(<AbsenceTab />);
    expect(screen.getByText(/Choisis un établissement/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Month navigation
// ═══════════════════════════════════════════════════════════════════════════

describe("AbsenceTab — month navigation", () => {
  it("renders month navigation buttons", () => {
    render(<AbsenceTab establishmentId="test-id" />);

    expect(screen.getByLabelText("Mois précédent")).toBeDefined();
    expect(screen.getByLabelText("Mois suivant")).toBeDefined();
    expect(screen.getByLabelText("Actualiser")).toBeDefined();
  });

  it("displays a month label with year", () => {
    render(<AbsenceTab establishmentId="test-id" />);
    const monthEl = screen.getByText(/\d{4}/);
    expect(monthEl).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Empty state
// ═══════════════════════════════════════════════════════════════════════════

describe("AbsenceTab — empty state", () => {
  it("shows empty message when no summaries", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.getByText("Aucune absence ce mois-ci")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Data display
// ═══════════════════════════════════════════════════════════════════════════

describe("AbsenceTab — data display", () => {
  it("renders employee absence summaries", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 2,
          leaveCount: 2,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.getByText("Jean Dupont")).toBeDefined();
  });

  it("renders multiple employees", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 2,
          leaveCount: 2,
          undeclaredCount: 0,
        },
        {
          userId: "u2",
          fullName: "Marie Curie",
          totalAbsenceMinutes: 420,
          absenceCount: 1,
          leaveCount: 1,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.getByText("Jean Dupont")).toBeDefined();
    expect(screen.getByText("Marie Curie")).toBeDefined();
  });

  it("shows absence summary banner when there are absences", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 2,
          leaveCount: 2,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.getByText(/2 absences/)).toBeDefined();
  });

  it("does not show summary banner when there are no absences", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.queryByText(/absences? •/)).toBeNull();
  });

  it("shows leave count when present", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 1,
          leaveCount: 3,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.getByText("3 CP/Absence")).toBeDefined();
  });

  it("shows undeclared count when present", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 420,
          absenceCount: 1,
          leaveCount: 0,
          undeclaredCount: 2,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);
    expect(screen.getByText(/2 non déclarées/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Employee detail navigation
// ═══════════════════════════════════════════════════════════════════════════

describe("AbsenceTab — employee detail", () => {
  it("switches to detail view on employee click", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 2,
          leaveCount: 2,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);

    fireEvent.click(screen.getByText("Jean Dupont"));

    // Should show detail view with back button
    expect(screen.getByLabelText("Retour à la liste")).toBeDefined();
  });

  it("returns to list view on back click", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 2,
          leaveCount: 2,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);

    // Go to detail
    fireEvent.click(screen.getByText("Jean Dupont"));
    expect(screen.getByLabelText("Retour à la liste")).toBeDefined();

    // Go back
    fireEvent.click(screen.getByLabelText("Retour à la liste"));

    // Should show month navigation again
    expect(screen.getByLabelText("Mois précédent")).toBeDefined();
  });

  it("hides month navigation in detail view", () => {
    mockAbsenceMonthlyData.mockReturnValue({
      summaries: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          totalAbsenceMinutes: 840,
          absenceCount: 2,
          leaveCount: 2,
          undeclaredCount: 0,
        },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<AbsenceTab establishmentId="test-id" />);

    fireEvent.click(screen.getByText("Jean Dupont"));

    // Month navigation should be hidden in detail view
    expect(screen.queryByLabelText("Mois précédent")).toBeNull();
    expect(screen.queryByLabelText("Mois suivant")).toBeNull();
  });
});
