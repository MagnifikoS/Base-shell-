/**
 * Tests for RolesPermissionsManager — renders roles list, create dialog
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RolesPermissionsManager } from "../RolesPermissionsManager";

// ═══════════════════════════════════════════════════════════════════════════
// Mock all external dependencies
// ═══════════════════════════════════════════════════════════════════════════

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() })),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/roles", () => ({
  isRoleAssignable: () => true,
}));

const mockUseRoles = vi.fn();
const mockUseRolePermissions = vi.fn();
const mockUseCreateRole = vi.fn();
const mockUseUpdateRole = vi.fn();
const mockUseDeleteRole = vi.fn();
const mockUseSavePermissions = vi.fn();
const mockUseDeleteCancelInvitations = vi.fn();

vi.mock("../useRolesPermissions", () => ({
  useRoles: () => mockUseRoles(),
  useRolePermissions: (id: string | null) => mockUseRolePermissions(id),
  useCreateRole: () => mockUseCreateRole(),
  useUpdateRole: () => mockUseUpdateRole(),
  useDeleteRole: () => mockUseDeleteRole(),
  useDeleteCancelInvitations: () => mockUseDeleteCancelInvitations(),
  useSavePermissions: () => mockUseSavePermissions(),
  ACCESS_LEVELS: [
    { value: "none", label: "Aucun" },
    { value: "read", label: "Lecture" },
    { value: "write", label: "Ecriture" },
  ],
  SCOPES: [
    { value: "self", label: "Personnel" },
    { value: "team", label: "Equipe" },
    { value: "establishment", label: "Etablissement" },
  ],
  CAISSE_SCOPES: [
    { value: "caisse_day", label: "Journée" },
    { value: "caisse_week", label: "Semaine" },
  ],
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: loaded with 2 roles
  mockUseRoles.mockReturnValue({
    data: [
      { id: "role-1", name: "Administrateur", type: "system", user_count: 1 },
      { id: "role-2", name: "Serveur", type: "custom", user_count: 3 },
    ],
    isLoading: false,
  });

  mockUseRolePermissions.mockReturnValue({
    data: [],
    isLoading: false,
  });

  mockUseCreateRole.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseUpdateRole.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseDeleteRole.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseDeleteCancelInvitations.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseSavePermissions.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("RolesPermissionsManager — loading", () => {
  it("shows loading spinner when roles are loading", () => {
    mockUseRoles.mockReturnValue({ data: [], isLoading: true });

    const { container } = render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Roles list rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("RolesPermissionsManager — roles list", () => {
  it("renders the title", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(screen.getByText("Rôles & Permissions")).toBeDefined();
  });

  it("renders role names", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(screen.getByText("Administrateur")).toBeDefined();
    expect(screen.getByText("Serveur")).toBeDefined();
  });

  it("shows system/custom badges", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(screen.getByText("Système")).toBeDefined();
    expect(screen.getByText("Custom")).toBeDefined();
  });

  it("shows user counts", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("renders 'Nouveau role' button", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(screen.getByText("Nouveau rôle")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: No role selected
// ═══════════════════════════════════════════════════════════════════════════

describe("RolesPermissionsManager — no selection", () => {
  it("shows selection prompt when no role is selected", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });
    expect(screen.getByText("Sélectionnez un rôle pour voir ses permissions")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Role selection
// ═══════════════════════════════════════════════════════════════════════════

describe("RolesPermissionsManager — role selection", () => {
  it("shows role details when a role is clicked", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("Serveur"));

    // Should show the role name in the detail panel
    expect(screen.queryByText("Sélectionnez un rôle pour voir ses permissions")).toBeNull();
  });

  it("shows permissions table header when role selected", () => {
    mockUseRolePermissions.mockReturnValue({
      data: [
        {
          module_key: "dashboard",
          access_level: "read",
          scope: "self",
          module: { name: "Dashboard" },
        },
      ],
      isLoading: false,
    });

    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("Serveur"));

    expect(screen.getByText("Permissions par module")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Create role dialog
// ═══════════════════════════════════════════════════════════════════════════

describe("RolesPermissionsManager — create role", () => {
  it("opens create dialog when button is clicked", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("Nouveau rôle"));

    expect(screen.getByText("Créer un rôle")).toBeDefined();
    expect(
      screen.getByText("Créez un nouveau rôle personnalisé pour votre organisation.")
    ).toBeDefined();
  });

  it("has a role name input in the create dialog", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("Nouveau rôle"));

    const input = screen.getByPlaceholderText("Ex: Chef de cuisine");
    expect(input).toBeDefined();
  });

  it("has Creer and Annuler buttons in create dialog", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("Nouveau rôle"));

    expect(screen.getByText("Créer")).toBeDefined();
    expect(screen.getByText("Annuler")).toBeDefined();
  });

  it("closes dialog on Annuler click", () => {
    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText("Nouveau rôle"));
    expect(screen.getByText("Créer un rôle")).toBeDefined();

    fireEvent.click(screen.getByText("Annuler"));
    // Dialog should be closed
    expect(screen.queryByText("Créer un rôle")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Empty roles
// ═══════════════════════════════════════════════════════════════════════════

describe("RolesPermissionsManager — no roles", () => {
  it("renders with empty roles list", () => {
    mockUseRoles.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(<RolesPermissionsManager />, { wrapper: Wrapper });

    expect(screen.getByText("Rôles & Permissions")).toBeDefined();
    expect(screen.getByText("Nouveau rôle")).toBeDefined();
  });
});
