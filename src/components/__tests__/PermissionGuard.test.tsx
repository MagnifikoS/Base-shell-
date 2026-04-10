/**
 * Tests for PermissionGuard, AdminGuard, and NoPermissionsPage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PermissionGuard, AdminGuard, NoPermissionsPage } from "../PermissionGuard";

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

const mockUsePermissions = vi.fn();
const mockUseAuth = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockUsePermissions(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    user: { id: "test-user", email: "test@test.com" },
    signOut: vi.fn(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: PermissionGuard — loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("PermissionGuard — loading state", () => {
  it("shows loading spinner when data is null and isLoading", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => false,
      isLoading: true,
      isFetching: false,
      data: null,
    });

    const { container } = renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Dashboard Content</div>
      </PermissionGuard>
    );

    expect(screen.queryByText("Dashboard Content")).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows loading spinner when data is null and isFetching", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => false,
      isLoading: false,
      isFetching: true,
      data: null,
    });

    const { container } = renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Dashboard Content</div>
      </PermissionGuard>
    );

    expect(screen.queryByText("Dashboard Content")).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("does NOT show loading when data exists (refetch scenario)", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: true,
      can: () => true,
      isLoading: false,
      isFetching: true,
      data: { permissions: [] },
    });

    renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Dashboard Content</div>
      </PermissionGuard>
    );

    expect(screen.getByText("Dashboard Content")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: PermissionGuard — admin bypass
// ═══════════════════════════════════════════════════════════════════════════

describe("PermissionGuard — admin bypass", () => {
  it("renders children when user is admin regardless of module", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: true,
      can: () => false,
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Admin sees this</div>
      </PermissionGuard>
    );

    expect(screen.getByText("Admin sees this")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: PermissionGuard — module access
// ═══════════════════════════════════════════════════════════════════════════

describe("PermissionGuard — module access", () => {
  it("renders children when user has module access", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: (key: string) => key === "dashboard",
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Dashboard Content</div>
      </PermissionGuard>
    );

    expect(screen.getByText("Dashboard Content")).toBeDefined();
  });

  it("shows access denied when user lacks module access", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => false,
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Dashboard Content</div>
      </PermissionGuard>
    );

    expect(screen.queryByText("Dashboard Content")).toBeNull();
    expect(screen.getByText("Accès refusé")).toBeDefined();
  });

  it("access denied page has a Retour button", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => false,
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Content</div>
      </PermissionGuard>
    );

    const button = screen.getByText("Retour");
    expect(button).toBeDefined();
  });

  it("Retour button navigates to /", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => false,
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <PermissionGuard moduleKey="dashboard">
        <div>Content</div>
      </PermissionGuard>
    );

    fireEvent.click(screen.getByText("Retour"));
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: AdminGuard
// ═══════════════════════════════════════════════════════════════════════════

describe("AdminGuard", () => {
  it("renders children when user is admin", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: true,
      can: () => true,
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <AdminGuard>
        <div>Admin Content</div>
      </AdminGuard>
    );

    expect(screen.getByText("Admin Content")).toBeDefined();
  });

  it("shows access denied when user is not admin", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => true,
      isLoading: false,
      isFetching: false,
      data: { permissions: [] },
    });

    renderWithRouter(
      <AdminGuard>
        <div>Admin Content</div>
      </AdminGuard>
    );

    expect(screen.queryByText("Admin Content")).toBeNull();
    expect(screen.getByText("Accès refusé")).toBeDefined();
  });

  it("shows loading when data is null", () => {
    mockUsePermissions.mockReturnValue({
      isAdmin: false,
      can: () => false,
      isLoading: true,
      isFetching: false,
      data: null,
    });

    const { container } = renderWithRouter(
      <AdminGuard>
        <div>Admin Content</div>
      </AdminGuard>
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: NoPermissionsPage
// ═══════════════════════════════════════════════════════════════════════════

describe("NoPermissionsPage", () => {
  it("renders the no permissions message", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "test" },
      signOut: vi.fn(),
    });

    renderWithRouter(<NoPermissionsPage />);

    expect(screen.getByText("Aucune permission")).toBeDefined();
    expect(screen.getByText(/Votre compte n'a accès à aucun module/)).toBeDefined();
  });

  it("has a disconnect button", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "test" },
      signOut: vi.fn(),
    });

    renderWithRouter(<NoPermissionsPage />);

    expect(screen.getByText("Se déconnecter")).toBeDefined();
  });

  it("calls signOut and navigates on logout click", async () => {
    const mockSignOut = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: { id: "test" },
      signOut: mockSignOut,
    });

    renderWithRouter(<NoPermissionsPage />);

    fireEvent.click(screen.getByText("Se déconnecter"));

    // signOut should be called
    expect(mockSignOut).toHaveBeenCalled();
  });
});
