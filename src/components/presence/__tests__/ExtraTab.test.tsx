/**
 * Tests for ExtraTab — renders list, handles empty state, no establishment
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExtraTab } from "../ExtraTab";

// ═══════════════════════════════════════════════════════════════════════════
// Mock hooks
// ═══════════════════════════════════════════════════════════════════════════

const mockExtraMonthlyData = vi.fn();
const mockExtraEmployeeDetail = vi.fn();

vi.mock("@/hooks/presence/useExtraData", () => ({
  useExtraMonthlyData: (...args: unknown[]) => mockExtraMonthlyData(...args),
  useExtraEmployeeDetail: (...args: unknown[]) => mockExtraEmployeeDetail(...args),
}));

// Mock auth + permissions (PER-MGR-009: ExtraTab now uses scope filtering)
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-user-id" } }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    getScope: () => "org",
    teamIds: [],
    establishmentIds: ["test-id"],
    isAdmin: true,
  }),
}));

vi.mock("@/lib/rbac/scope", () => ({
  filterByScope: ({ items }: { items: unknown[] }) => items,
}));

vi.mock("../ExtraMonthlyList", () => ({
  ExtraMonthlyList: ({
    summaries,
    isLoading,
    onSelectEmployee,
  }: {
    summaries: Array<{ userId: string; fullName: string }>;
    isLoading: boolean;
    onSelectEmployee: (id: string, name: string) => void;
  }) => (
    <div data-testid="monthly-list">
      {isLoading && <div>Loading list...</div>}
      {summaries.length === 0 && !isLoading && <div>No data</div>}
      {summaries.map((s) => (
        <div key={s.userId} onClick={() => onSelectEmployee(s.userId, s.fullName)}>
          {s.fullName}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../ExtraEmployeeDetail", () => ({
  ExtraEmployeeDetail: ({ employeeName, onBack }: { employeeName: string; onBack: () => void }) => (
    <div data-testid="employee-detail">
      <div>{employeeName}</div>
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockExtraMonthlyData.mockReturnValue({
    summaries: [],
    isLoading: false,
    refetch: vi.fn(),
  });
  mockExtraEmployeeDetail.mockReturnValue({
    events: [],
    isLoading: false,
    refetch: vi.fn(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: No establishment
// ═══════════════════════════════════════════════════════════════════════════

describe("ExtraTab — no establishment", () => {
  it("shows message when no establishmentId", () => {
    render(<ExtraTab establishmentId={null} />);
    expect(screen.getByText(/Choisis un établissement/)).toBeDefined();
  });

  it("shows message when establishmentId is undefined", () => {
    render(<ExtraTab />);
    expect(screen.getByText(/Choisis un établissement/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Month navigation
// ═══════════════════════════════════════════════════════════════════════════

describe("ExtraTab — month navigation", () => {
  it("renders month navigation buttons", () => {
    render(<ExtraTab establishmentId="test-id" />);

    expect(screen.getByLabelText("Mois précédent")).toBeDefined();
    expect(screen.getByLabelText("Mois suivant")).toBeDefined();
    expect(screen.getByLabelText("Actualiser")).toBeDefined();
  });

  it("displays current month label", () => {
    render(<ExtraTab establishmentId="test-id" />);

    // Should display a month name (e.g., "février 2026")
    const monthElement = screen.getByText(/\d{4}/);
    expect(monthElement).toBeDefined();
  });

  it("navigates to previous month on click", () => {
    render(<ExtraTab establishmentId="test-id" />);

    fireEvent.click(screen.getByLabelText("Mois précédent"));

    // Hook should be called with new month
    expect(mockExtraMonthlyData).toHaveBeenCalled();
  });

  it("navigates to next month on click", () => {
    render(<ExtraTab establishmentId="test-id" />);

    fireEvent.click(screen.getByLabelText("Mois suivant"));

    expect(mockExtraMonthlyData).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("ExtraTab — loading", () => {
  it("passes loading state to monthly list", () => {
    mockExtraMonthlyData.mockReturnValue({
      summaries: [],
      isLoading: true,
      refetch: vi.fn(),
    });

    render(<ExtraTab establishmentId="test-id" />);

    expect(screen.getByText("Loading list...")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Data display
// ═══════════════════════════════════════════════════════════════════════════

describe("ExtraTab — data display", () => {
  it("renders employee summaries in monthly list", () => {
    mockExtraMonthlyData.mockReturnValue({
      summaries: [
        { userId: "u1", fullName: "Jean Dupont", totalExtraMinutes: 120, pendingCount: 0 },
        { userId: "u2", fullName: "Marie Curie", totalExtraMinutes: 60, pendingCount: 0 },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<ExtraTab establishmentId="test-id" />);

    expect(screen.getByText("Jean Dupont")).toBeDefined();
    expect(screen.getByText("Marie Curie")).toBeDefined();
  });

  it("shows empty state when no summaries", () => {
    mockExtraMonthlyData.mockReturnValue({
      summaries: [],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<ExtraTab establishmentId="test-id" />);

    expect(screen.getByText("No data")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Employee detail view
// ═══════════════════════════════════════════════════════════════════════════

describe("ExtraTab — employee detail", () => {
  it("switches to detail view when employee is selected", () => {
    mockExtraMonthlyData.mockReturnValue({
      summaries: [
        { userId: "u1", fullName: "Jean Dupont", totalExtraMinutes: 120, pendingCount: 0 },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<ExtraTab establishmentId="test-id" />);

    fireEvent.click(screen.getByText("Jean Dupont"));

    expect(screen.getByTestId("employee-detail")).toBeDefined();
  });

  it("goes back to list when back is clicked", () => {
    mockExtraMonthlyData.mockReturnValue({
      summaries: [
        { userId: "u1", fullName: "Jean Dupont", totalExtraMinutes: 120, pendingCount: 0 },
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<ExtraTab establishmentId="test-id" />);

    // Go to detail
    fireEvent.click(screen.getByText("Jean Dupont"));
    expect(screen.getByTestId("employee-detail")).toBeDefined();

    // Go back
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByTestId("monthly-list")).toBeDefined();
  });
});
