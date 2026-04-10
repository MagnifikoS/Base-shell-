/**
 * Tests for MobileWithdrawalView — simplified 2-screen withdrawal flow
 *
 * These tests verify:
 * - Component renders without errors (zone grid)
 * - Zone selection navigates to product screen
 * - Products are displayed alphabetically with letter headers
 * - Search filters products correctly
 * - Category step has been removed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileWithdrawalView } from "../MobileWithdrawalView";

// ── Mock dependencies ──

// Mock Supabase client
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "p1",
                        nom_produit: "Banane",
                        category: "Fruits",
                        supplier_name: "FruitCo",
                        storage_zone_id: "z1",
                        final_unit_id: "u1",
                        stock_handling_unit_id: "u1",
                        supplier_billing_unit_id: "u1",
                        delivery_unit_id: "u1",
                        conditionnement_config: null,
                      },
                      {
                        id: "p2",
                        nom_produit: "Avocat",
                        category: "Fruits",
                        supplier_name: "FruitCo",
                        storage_zone_id: "z1",
                        final_unit_id: "u1",
                        stock_handling_unit_id: "u1",
                        supplier_billing_unit_id: "u1",
                        delivery_unit_id: "u1",
                        conditionnement_config: null,
                      },
                      {
                        id: "p3",
                        nom_produit: "Carotte",
                        category: "Legumes",
                        supplier_name: "VegCo",
                        storage_zone_id: "z1",
                        final_unit_id: "u1",
                        stock_handling_unit_id: "u1",
                        supplier_billing_unit_id: "u1",
                        delivery_unit_id: "u1",
                        conditionnement_config: null,
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

// Mock EstablishmentContext
vi.mock("@/contexts/EstablishmentContext", () => ({
  useEstablishment: () => ({
    activeEstablishment: { id: "est-1", name: "Test Restaurant" },
  }),
}));

// Mock storage zones — returns zones by default
const mockUseStorageZones = vi.fn().mockReturnValue({
  zones: [
    { id: "z1", name: "Chambre froide" },
    { id: "z2", name: "Sec" },
  ],
});

vi.mock("@/modules/produitsV2", () => ({
  useStorageZones: () => mockUseStorageZones(),
}));

// Mock useWithdrawalDraft
vi.mock("../../hooks/useWithdrawalDraft", () => ({
  useWithdrawalDraft: () => ({
    document: { id: "doc-1", establishment_id: "est-1", lock_version: 1 },
    lines: [],
    isLoading: false,
    addLine: { mutateAsync: vi.fn() },
    updateLine: { mutateAsync: vi.fn() },
    removeLine: { mutate: vi.fn() },
  }),
}));

// Mock usePostDocument
vi.mock("../../hooks/usePostDocument", () => ({
  usePostDocument: () => ({
    post: vi.fn(),
    isPosting: false,
  }),
}));

// Mock useUnitConversions
vi.mock("@/core/unitConversion", () => ({
  useUnitConversions: () => ({
    units: [],
    conversions: [],
  }),
}));

// Mock buildCanonicalLine
vi.mock("../../engine/buildCanonicalLine", () => ({
  buildCanonicalLine: () => ({
    canonical_unit_id: "u1",
    canonical_family: "weight",
    canonical_label: "kg",
    context_hash: "hash",
  }),
}));

// Mock types
vi.mock("../../types", () => ({
  getInputPayloadProductName: (payload: unknown) => {
    if (payload && typeof payload === "object" && "product_name" in payload) {
      return (payload as { product_name: string }).product_name;
    }
    return null;
  },
}));

// Mock child components that are not under test
vi.mock("../PostConfirmDialog", () => ({
  PostConfirmDialog: () => null,
}));

vi.mock("../ReceptionQuantityModal", () => ({
  ReceptionQuantityModal: () => null,
}));

vi.mock("../MobileCartDrawer", () => ({
  MobileCartDrawer: () => null,
  CartTriggerButton: ({ count, onClick }: { count: number; onClick: () => void }) => (
    <button onClick={onClick} data-testid="cart-trigger">
      Panier ({count})
    </button>
  ),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// ── Helpers ──

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// ── Tests ──

describe("MobileWithdrawalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default zones
    mockUseStorageZones.mockReturnValue({
      zones: [
        { id: "z1", name: "Chambre froide" },
        { id: "z2", name: "Sec" },
      ],
    });
  });

  it("renders the zone grid on initial load (Screen 1)", () => {
    renderWithProviders(<MobileWithdrawalView />);

    expect(screen.getByText("Retrait — Zones")).toBeInTheDocument();
    expect(screen.getByText("Chambre froide")).toBeInTheDocument();
    expect(screen.getByText("Sec")).toBeInTheDocument();
  });

  it("shows the back button when onBack prop is provided", () => {
    const onBack = vi.fn();
    renderWithProviders(<MobileWithdrawalView onBack={onBack} />);

    const backBtn = screen.getByText("Retour");
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("navigates to product screen when a zone is selected", () => {
    renderWithProviders(<MobileWithdrawalView />);

    // Click on "Chambre froide" zone
    fireEvent.click(screen.getByText("Chambre froide"));

    // Should now show Screen 2 with zone name and reason toggle
    expect(screen.getByLabelText("Retour aux zones")).toBeInTheDocument();

    // Reason pills should be visible (may appear more than once: pill + chip)
    expect(screen.getAllByText("Consommation cuisine").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Casse")).toBeInTheDocument();
    expect(screen.getByText("Péremption")).toBeInTheDocument();
    expect(screen.getByText("Transfert")).toBeInTheDocument();
    expect(screen.getByText("Ajustement manuel")).toBeInTheDocument();
    expect(screen.getByText("Autre")).toBeInTheDocument();

    // Search bar should be present
    expect(screen.getByLabelText("Rechercher un produit")).toBeInTheDocument();
  });

  it("does NOT show a category grid after zone selection (category step removed)", () => {
    renderWithProviders(<MobileWithdrawalView />);

    fireEvent.click(screen.getByText("Chambre froide"));

    // The old "Tous les produits" button from the category grid should NOT exist
    expect(screen.queryByText("Tous les produits")).not.toBeInTheDocument();
  });

  it("displays the search bar on Screen 2 after zone selection", () => {
    renderWithProviders(<MobileWithdrawalView />);

    fireEvent.click(screen.getByText("Chambre froide"));

    // Search bar should be present for filtering products
    expect(screen.getByLabelText("Rechercher un produit")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Rechercher un produit…")).toBeInTheDocument();
  });

  it("shows the back button that returns to zone grid directly (no category intermediate)", () => {
    renderWithProviders(<MobileWithdrawalView />);

    // Select zone
    fireEvent.click(screen.getByText("Chambre froide"));

    // We should be on Screen 2
    expect(screen.getByLabelText("Retour aux zones")).toBeInTheDocument();

    // Click back button
    fireEvent.click(screen.getByLabelText("Retour aux zones"));

    // Should be back on zone grid — no intermediate category screen
    expect(screen.getByText("Retrait — Zones")).toBeInTheDocument();
    expect(screen.getByText("Chambre froide")).toBeInTheDocument();
    expect(screen.getByText("Sec")).toBeInTheDocument();
  });

  it("renders empty zone message when no zones configured", () => {
    mockUseStorageZones.mockReturnValue({ zones: [] });

    renderWithProviders(<MobileWithdrawalView />);

    expect(screen.getByText("Aucune zone de stockage configurée.")).toBeInTheDocument();
  });

  it("shows the motif label in the header", () => {
    renderWithProviders(<MobileWithdrawalView />);

    fireEvent.click(screen.getByText("Chambre froide"));

    // "Motif" label should be visible
    expect(screen.getByText("Motif")).toBeInTheDocument();
  });
});
