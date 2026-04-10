/**
 * Tests for MobileBottomNav — renders nav items, active state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileBottomNav } from "../MobileBottomNav";
import { LayoutDashboard, Clock, Users } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

const mockNavigate = vi.fn();
const mockLocationPathname = vi.fn();

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mockLocationPathname() }),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-user" } }),
}));

vi.mock("@/contexts/EstablishmentContext", () => ({
  useEstablishment: () => ({
    activeEstablishment: { id: "est-1", organization_id: "org-1" },
  }),
}));

const mockPermissions = vi.fn();

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockPermissions(),
}));

const mockBuildNavFromPermissions = vi.fn();

vi.mock("@/lib/nav/buildNavFromPermissions", () => ({
  buildNavFromPermissions: (...args: unknown[]) => mockBuildNavFromPermissions(...args),
}));

vi.mock("@/hooks/useEstablishmentRoleNavConfig", () => ({
  useEstablishmentRoleNavConfig: () => ({
    prefs: { hiddenIds: [] },
    isLoading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockLocationPathname.mockReturnValue("/");
  mockPermissions.mockReturnValue({
    isAdmin: true,
    can: () => true,
  });
  mockBuildNavFromPermissions.mockReturnValue({
    sidebarItems: [],
    mobileHomeTiles: [],
    mobileBottomNav: [
      {
        id: "home",
        label: "Accueil",
        route: "/",
        icon: LayoutDashboard,
        order: 1,
        placements: ["bottomNav"],
      },
      {
        id: "badgeuse",
        label: "Badgeuse",
        route: "/badgeuse",
        icon: Clock,
        order: 2,
        placements: ["bottomNav"],
      },
      {
        id: "employees",
        label: "Salaries",
        route: "/salaries",
        icon: Users,
        order: 3,
        placements: ["bottomNav"],
      },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("MobileBottomNav — rendering", () => {
  it("renders nav element with correct aria-label", () => {
    render(<MobileBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(nav).toBeDefined();
  });

  it("renders all nav items", () => {
    render(<MobileBottomNav />);
    expect(screen.getByText("Accueil")).toBeDefined();
    expect(screen.getByText("Badgeuse")).toBeDefined();
    expect(screen.getByText("Salaries")).toBeDefined();
  });

  it("renders correct number of nav buttons", () => {
    render(<MobileBottomNav />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(3);
  });

  it("each nav item has an aria-label", () => {
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Accueil")).toBeDefined();
    expect(screen.getByLabelText("Badgeuse")).toBeDefined();
    expect(screen.getByLabelText("Salaries")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Active state
// ═══════════════════════════════════════════════════════════════════════════

describe("MobileBottomNav — active state", () => {
  it("marks home as active when on /", () => {
    mockLocationPathname.mockReturnValue("/");
    render(<MobileBottomNav />);

    const homeBtn = screen.getByLabelText("Accueil");
    expect(homeBtn.getAttribute("aria-current")).toBe("page");
  });

  it("marks badgeuse as active when on /badgeuse", () => {
    mockLocationPathname.mockReturnValue("/badgeuse");
    render(<MobileBottomNav />);

    const badgeuseBtn = screen.getByLabelText("Badgeuse");
    expect(badgeuseBtn.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark other items as active", () => {
    mockLocationPathname.mockReturnValue("/");
    render(<MobileBottomNav />);

    const badgeuseBtn = screen.getByLabelText("Badgeuse");
    expect(badgeuseBtn.getAttribute("aria-current")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Navigation
// ═══════════════════════════════════════════════════════════════════════════

describe("MobileBottomNav — navigation", () => {
  it("navigates to route on click", () => {
    render(<MobileBottomNav />);

    fireEvent.click(screen.getByLabelText("Badgeuse"));
    expect(mockNavigate).toHaveBeenCalledWith("/badgeuse");
  });

  it("navigates to home on home click", () => {
    mockLocationPathname.mockReturnValue("/badgeuse");
    render(<MobileBottomNav />);

    fireEvent.click(screen.getByLabelText("Accueil"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Empty nav items
// ═══════════════════════════════════════════════════════════════════════════

describe("MobileBottomNav — no items", () => {
  it("renders empty nav when no items", () => {
    mockBuildNavFromPermissions.mockReturnValue({
      sidebarItems: [],
      mobileHomeTiles: [],
      mobileBottomNav: [],
    });

    render(<MobileBottomNav />);

    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBe(0);
  });
});
