/**
 * Tests for Dashboard page — KPI cards, loading state, no establishment
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "../Dashboard";

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

const mockEstablishment = vi.fn();
const mockPermissions = vi.fn();

vi.mock("@/contexts/EstablishmentContext", () => ({
  useEstablishment: () => mockEstablishment(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => mockPermissions(),
}));

vi.mock("@/components/OnboardingChecklist", () => ({
  OnboardingChecklist: () => <div data-testid="onboarding-checklist">Onboarding</div>,
}));

const mockServiceDay = vi.fn();
vi.mock("@/hooks/useServiceDayToday", () => ({
  useServiceDayToday: () => mockServiceDay(),
}));

const mockPresence = vi.fn();
vi.mock("@/hooks/presence/usePresenceByDate", () => ({
  usePresenceByDate: () => mockPresence(),
}));

const mockAlerts = vi.fn();
vi.mock("@/hooks/alerts/useAlerts", () => ({
  useAlerts: () => mockAlerts(),
}));

const mockPlanning = vi.fn();
vi.mock("@/components/planning/hooks/usePlanningWeek", () => ({
  usePlanningWeek: () => mockPlanning(),
}));

const mockLeaves = vi.fn();
vi.mock("@/modules/congesAbsences", () => ({
  useLeaveRequestsManager: () => mockLeaves(),
}));

const mockKPIs = vi.fn();
vi.mock("@/hooks/dashboard/useEstablishmentKPIs", () => ({
  useEstablishmentKPIs: () => mockKPIs(),
}));

vi.mock("@/lib/planning-engine/format", () => ({
  getMonday: (d: Date) => d.toISOString().split("T")[0],
  getWeekDates: () => [
    "2026-02-09",
    "2026-02-10",
    "2026-02-11",
    "2026-02-12",
    "2026-02-13",
    "2026-02-14",
    "2026-02-15",
  ],
  formatDayShort: (d: string) => d,
  formatMinutesToHours: (m: number) => `${Math.floor(m / 60)}h`,
}));

vi.mock("@/lib/time/paris", () => ({
  formatParisHHMM: (ts: string) => ts.slice(11, 16),
  timeToMinutes: (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  },
}));

vi.mock("@/components/mobile/ResponsiveLayout", () => ({
  ResponsiveLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPermissions.mockReturnValue({ isAdmin: false, can: () => false });
  mockKPIs.mockReturnValue({ data: null });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: No establishment selected
// ═══════════════════════════════════════════════════════════════════════════

describe("Dashboard — no establishment", () => {
  it("shows message when no establishment selected", () => {
    mockEstablishment.mockReturnValue({ activeEstablishment: null });
    mockServiceDay.mockReturnValue({ data: null, isLoading: false });
    mockPresence.mockReturnValue({ employees: [], isLoading: false });
    mockAlerts.mockReturnValue({ alerts: [], isLoading: false });
    mockPlanning.mockReturnValue({ data: null, isLoading: false });
    mockLeaves.mockReturnValue({ data: null, isLoading: false });

    render(<Dashboard />, { wrapper: Wrapper });

    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText(/Sélectionnez un établissement/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Loading state
// ═══════════════════════════════════════════════════════════════════════════

describe("Dashboard — loading state", () => {
  it("shows skeleton when data is loading", () => {
    mockEstablishment.mockReturnValue({
      activeEstablishment: { id: "est-1", name: "Mon Restaurant" },
    });
    mockServiceDay.mockReturnValue({ data: null, isLoading: true });
    mockPresence.mockReturnValue({ employees: [], isLoading: true });
    mockAlerts.mockReturnValue({ alerts: [], isLoading: true });
    mockPlanning.mockReturnValue({ data: null, isLoading: true });
    mockLeaves.mockReturnValue({ data: null, isLoading: true });

    const { container } = render(<Dashboard />, { wrapper: Wrapper });

    // Should render skeleton elements
    const skeletons = container.querySelectorAll("[class*='animate-pulse']");
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Loaded state with data
// ═══════════════════════════════════════════════════════════════════════════

describe("Dashboard — loaded state", () => {
  beforeEach(() => {
    mockEstablishment.mockReturnValue({
      activeEstablishment: { id: "est-1", name: "Mon Restaurant" },
    });
    mockServiceDay.mockReturnValue({ data: "2026-02-14", isLoading: false });
    mockPresence.mockReturnValue({
      employees: [
        {
          userId: "u1",
          fullName: "Jean Dupont",
          sessions: [{ clockIn: "2026-02-14T08:00:00Z", lateMinutes: 0, status: "present" }],
          totalLateMinutes: 0,
          allEvents: [],
        },
        {
          userId: "u2",
          fullName: "Marie Curie",
          sessions: [],
          totalLateMinutes: 0,
          allEvents: [],
        },
      ],
      isLoading: false,
    });
    mockAlerts.mockReturnValue({ alerts: [], isLoading: false });
    mockPlanning.mockReturnValue({
      data: {
        employees: [{ id: "u1" }, { id: "u2" }],
        shiftsByEmployee: {},
      },
      isLoading: false,
    });
    mockLeaves.mockReturnValue({ data: [], isLoading: false });
  });

  it("renders Dashboard heading", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    expect(screen.getByText("Dashboard")).toBeDefined();
  });

  it("renders establishment name and service day", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    // The text is rendered as "Mon Restaurant — 2026-02-14" in a single element
    expect(screen.getByText(/Mon Restaurant.*2026-02-14/)).toBeDefined();
  });

  it("renders stat cards", () => {
    render(<Dashboard />, { wrapper: Wrapper });

    // Check for the new stat card titles
    expect(screen.getByText("Chiffre d'affaires du jour")).toBeDefined();
    expect(screen.getByText("Effectif présent")).toBeDefined();
    expect(screen.getByText("Produits surveillés")).toBeDefined();
    expect(screen.getByText("Factures non payées")).toBeDefined();
  });

  it("renders presence count correctly", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    expect(screen.getByText("1 / 2")).toBeDefined();
  });

  it("renders effectif present card with role region", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    const presenceRegion = screen.getByRole("region", { name: "Effectif présent" });
    expect(presenceRegion).toBeDefined();
    expect(presenceRegion.textContent).toContain("1 / 2");
  });

  it("renders produits surveilles card", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    const stockRegion = screen.getByRole("region", { name: "Produits surveillés" });
    expect(stockRegion).toBeDefined();
  });

  it("renders derniers pointages section", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    expect(screen.getByText("Derniers pointages")).toBeDefined();
  });

  it("renders demandes en attente section", () => {
    render(<Dashboard />, { wrapper: Wrapper });
    expect(screen.getByText(/Demandes en attente \(0\)/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Dashboard with alerts
// ═══════════════════════════════════════════════════════════════════════════

describe("Dashboard — with alerts", () => {
  it("renders alert section when there are alerts", () => {
    mockEstablishment.mockReturnValue({
      activeEstablishment: { id: "est-1", name: "Mon Restaurant" },
    });
    mockServiceDay.mockReturnValue({ data: "2026-02-14", isLoading: false });
    mockPresence.mockReturnValue({ employees: [], isLoading: false });
    mockAlerts.mockReturnValue({
      alerts: [
        { id: "a1", fullName: "Jean Dupont", type: "missing_clock_in" },
        { id: "a2", fullName: "Marie Curie", type: "missing_clock_out" },
      ],
      isLoading: false,
    });
    mockPlanning.mockReturnValue({ data: null, isLoading: false });
    mockLeaves.mockReturnValue({ data: [], isLoading: false });

    render(<Dashboard />, { wrapper: Wrapper });

    expect(screen.getByText(/Alertes du jour \(2\)/)).toBeDefined();
    expect(screen.getByText("Jean Dupont")).toBeDefined();
    expect(screen.getByText("Marie Curie")).toBeDefined();
  });
});
