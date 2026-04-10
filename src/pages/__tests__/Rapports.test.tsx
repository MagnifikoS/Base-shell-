/**
 * Tests for Rapports page — renders tabs, no establishment state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Rapports from "../Rapports";

// ═══════════════════════════════════════════════════════════════════════════
// Mock dependencies
// ═══════════════════════════════════════════════════════════════════════════

const mockEstablishment = vi.fn();

vi.mock("@/contexts/EstablishmentContext", () => ({
  useEstablishment: () => mockEstablishment(),
}));

vi.mock("@/hooks/useServiceDayToday", () => ({
  useServiceDayToday: () => ({ data: "2026-02-14", isLoading: false }),
}));

vi.mock("@/hooks/presence/usePresenceByDate", () => ({
  usePresenceByDate: () => ({ employees: [], isLoading: false }),
}));

vi.mock("@/hooks/payroll/usePayrollMonthData", () => ({
  usePayrollMonthData: () => ({
    employees: [],
    totals: {
      totalGrossBase: 0,
      totalNetBase: 0,
      totalExtras: 0,
      totalCpDays: 0,
      totalAbsences: 0,
      totalDeductions: 0,
      totalMassToDisburse: 0,
      totalChargesFixed: 0,
      totalPayrollMass: 0,
      totalCashAmount: 0,
    },
    isLoading: false,
  }),
}));

vi.mock("@/modules/congesAbsences", () => ({
  useLeaveRequestsManager: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/modules/factures", () => ({
  useMonthInvoices: () => ({ data: [], isLoading: false }),
  useInvoiceCalculations: () => ({
    supplierSummaries: [],
    monthTotal: 0,
    invoiceCount: 0,
  }),
}));

vi.mock("@/lib/time/dateKeyParis", () => ({
  getYearMonthFromDateParis: () => "2026-02",
  getMonthEndDateKeyParis: () => "2026-02-28",
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
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: No establishment
// ═══════════════════════════════════════════════════════════════════════════

describe("Rapports — no establishment", () => {
  it("shows message when no establishment selected", () => {
    mockEstablishment.mockReturnValue({ activeEstablishment: null });

    render(<Rapports />, { wrapper: Wrapper });

    expect(screen.getByText("Rapports")).toBeDefined();
    expect(screen.getByText(/Selectionnez un etablissement/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Rendering with establishment
// ═══════════════════════════════════════════════════════════════════════════

describe("Rapports — with establishment", () => {
  beforeEach(() => {
    mockEstablishment.mockReturnValue({
      activeEstablishment: { id: "est-1", name: "Mon Restaurant" },
    });
  });

  it("renders the page title", () => {
    render(<Rapports />, { wrapper: Wrapper });
    expect(screen.getByText("Rapports")).toBeDefined();
  });

  it("renders the establishment name", () => {
    render(<Rapports />, { wrapper: Wrapper });
    expect(screen.getByText("Mon Restaurant")).toBeDefined();
  });

  it("renders period navigation with mode selector", () => {
    render(<Rapports />, { wrapper: Wrapper });
    expect(screen.getByText("Jour")).toBeDefined();
    expect(screen.getByText("Semaine")).toBeDefined();
    expect(screen.getByText("Mois")).toBeDefined();
    expect(screen.getByText("Periode personnalisee")).toBeDefined();
  });

  it("renders period navigation arrows", () => {
    render(<Rapports />, { wrapper: Wrapper });
    expect(screen.getByLabelText("Periode precedente")).toBeDefined();
    expect(screen.getByLabelText("Periode suivante")).toBeDefined();
  });

  it("renders month label", () => {
    render(<Rapports />, { wrapper: Wrapper });
    // Should display "fevrier 2026" or similar
    expect(screen.getByText(/2026/)).toBeDefined();
  });

  it("renders tab triggers including Achats", () => {
    render(<Rapports />, { wrapper: Wrapper });
    expect(screen.getByText("Presence")).toBeDefined();
    expect(screen.getByText("Conges")).toBeDefined();
    expect(screen.getByText("Paie")).toBeDefined();
    expect(screen.getByText("Achats")).toBeDefined();
  });

  it("renders presence tab content by default", () => {
    render(<Rapports />, { wrapper: Wrapper });
    // Default tab is presence, which shows empty state when no employees
    expect(screen.getByText(/Aucune donnee de presence/)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe("Rapports — accessibility", () => {
  beforeEach(() => {
    mockEstablishment.mockReturnValue({
      activeEstablishment: { id: "est-1", name: "Mon Restaurant" },
    });
  });

  it("period navigation has correct aria-label", () => {
    render(<Rapports />, { wrapper: Wrapper });
    const nav = screen.getByRole("navigation", { name: "Navigation par periode" });
    expect(nav).toBeDefined();
  });
});
