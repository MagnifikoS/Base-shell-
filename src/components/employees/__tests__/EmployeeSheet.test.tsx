/**
 * Tests for EmployeeSheet — renders tabs, loading/error states, own profile mode
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmployeeSheet } from "../EmployeeSheet";

// ═══════════════════════════════════════════════════════════════════════════
// Mock all dependencies
// ═══════════════════════════════════════════════════════════════════════════

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockUseEmployee = vi.fn();
vi.mock("../hooks/useEmployee", () => ({
  useEmployee: (...args: unknown[]) => mockUseEmployee(...args),
}));

const mockUseEmployeeForm = vi.fn();
vi.mock("../hooks/useEmployeeForm", () => ({
  useEmployeeForm: (...args: unknown[]) => mockUseEmployeeForm(...args),
}));

const mockUseEmployeeMutations = vi.fn();
vi.mock("../hooks/useEmployeeMutations", () => ({
  useEmployeeMutations: (...args: unknown[]) => mockUseEmployeeMutations(...args),
}));

vi.mock("@/hooks/useEstablishmentAccess", () => ({
  useEstablishmentAccess: () => ({ activeEstablishmentId: "est-1" }),
}));

// Mock sub-components to simplify tests
vi.mock("../tabs/EmployeeInfoTab", () => ({
  EmployeeInfoTab: () => <div data-testid="info-tab">Info Tab</div>,
}));

vi.mock("../tabs/EmployeeContractTab", () => ({
  EmployeeContractTab: () => <div data-testid="contract-tab">Contract Tab</div>,
}));

vi.mock("../tabs/EmployeeDocumentsTab", () => ({
  EmployeeDocumentsTab: () => <div data-testid="documents-tab">Documents Tab</div>,
}));

vi.mock("../sections/EmployeeHeader", () => ({
  EmployeeHeader: ({ employee }: { employee: { full_name: string } }) => (
    <div data-testid="employee-header">{employee?.full_name}</div>
  ),
}));

vi.mock("../sections/EmployeeLoadingState", () => ({
  EmployeeLoadingState: () => <div data-testid="loading-state">Loading...</div>,
}));

vi.mock("../sections/EmployeeErrorState", () => ({
  EmployeeErrorState: ({ message }: { message?: string }) => (
    <div data-testid="error-state">Error: {message || "Unknown"}</div>
  ),
}));

vi.mock("../sections/SuspendDialog", () => ({
  SuspendDialog: () => null,
}));

vi.mock("../sections/ReactivateDialog", () => ({
  ReactivateDialog: () => null,
}));

const defaultFormState = {
  formData: { full_name: "Jean Dupont" },
  hasChanges: false,
  showIban: false,
  setShowIban: vi.fn(),
  showSsn: false,
  setShowSsn: vi.fn(),
  ibanLast4: null,
  ssnLast2: null,
  ibanEdited: false,
  ssnEdited: false,
  hasFullIban: false,
  hasFullSsn: false,
  fieldErrors: {},
  clearFieldError: vi.fn(),
  updateField: vi.fn(),
  updateSensitiveField: vi.fn(),
  onSaveSuccess: vi.fn(),
  validateForm: vi.fn(() => true),
};

const defaultMutations = {
  saveMutation: { mutate: vi.fn(), isPending: false },
  suspendMutation: { mutate: vi.fn(), isPending: false },
  reactivateMutation: { mutate: vi.fn(), isPending: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseEmployeeForm.mockReturnValue(defaultFormState);
  mockUseEmployeeMutations.mockReturnValue(defaultMutations);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("EmployeeSheet — loading state", () => {
  it("shows loading state when employee is loading (own profile mode)", () => {
    mockUseEmployee.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
    });

    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} isOwnProfile={true} />);

    expect(screen.getByTestId("loading-state")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Error state
// ═══════════════════════════════════════════════════════════════════════════

describe("EmployeeSheet — error state", () => {
  it("shows error state when fetch fails (own profile mode)", () => {
    mockUseEmployee.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: { message: "Network error" },
    });

    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} isOwnProfile={true} />);

    expect(screen.getByTestId("error-state")).toBeDefined();
    expect(screen.getByText(/Network error/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Loaded employee — own profile mode (Card)
// ═══════════════════════════════════════════════════════════════════════════

describe("EmployeeSheet — own profile (Card mode)", () => {
  const mockEmployee = {
    user_id: "user-1",
    full_name: "Jean Dupont",
    email: "jean@example.com",
    status: "active",
  };

  beforeEach(() => {
    mockUseEmployee.mockReturnValue({
      data: mockEmployee,
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it("renders employee header", () => {
    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} isOwnProfile={true} />);
    expect(screen.getByTestId("employee-header")).toBeDefined();
  });

  it("renders tab triggers", () => {
    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} isOwnProfile={true} />);
    expect(screen.getByText("Informations")).toBeDefined();
    expect(screen.getByText("Contrat")).toBeDefined();
    expect(screen.getByText("Documents")).toBeDefined();
  });

  it("renders info tab by default", () => {
    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} isOwnProfile={true} />);
    expect(screen.getByTestId("info-tab")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Admin mode (Sheet)
// ═══════════════════════════════════════════════════════════════════════════

describe("EmployeeSheet — admin mode (Sheet)", () => {
  const mockEmployee = {
    user_id: "user-1",
    full_name: "Jean Dupont",
    email: "jean@example.com",
    status: "active",
  };

  beforeEach(() => {
    mockUseEmployee.mockReturnValue({
      data: mockEmployee,
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it("renders employee name in sheet title", () => {
    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} />);
    expect(screen.getByText("Jean Dupont")).toBeDefined();
  });

  it("renders employee email", () => {
    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} />);
    expect(screen.getByText("jean@example.com")).toBeDefined();
  });

  it("shows Actif badge for active employee", () => {
    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} />);
    expect(screen.getByText("Actif")).toBeDefined();
  });

  it("shows Suspendu badge for disabled employee", () => {
    mockUseEmployee.mockReturnValue({
      data: { ...mockEmployee, status: "disabled" },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} />);
    expect(screen.getByText("Suspendu")).toBeDefined();
  });

  it("shows loading text when no employee data yet", () => {
    mockUseEmployee.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
    });

    render(<EmployeeSheet userId="user-1" onClose={vi.fn()} />);
    expect(screen.getByText("Chargement...")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Null userId
// ═══════════════════════════════════════════════════════════════════════════

describe("EmployeeSheet — null userId", () => {
  it("handles null userId gracefully", () => {
    mockUseEmployee.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    // Should not crash
    expect(() => render(<EmployeeSheet userId={null} onClose={vi.fn()} />)).not.toThrow();
  });
});
